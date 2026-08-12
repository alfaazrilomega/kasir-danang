import nodemailer from 'nodemailer';

const MAX_MESSAGE_LENGTH = 60000;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    setJsonHeaders(res);
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    setJsonHeaders(res);
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  try {
    const payload = await readJsonBody(req);
    const channel = String(payload.channel ?? '');
    const message = String(payload.message ?? '').trim();
    const to = String(payload.to ?? '').trim();

    if (channel !== 'email' && channel !== 'whatsapp') {
      throw new HttpError(400, 'Channel harus email atau whatsapp.');
    }
    if (!to) throw new HttpError(400, 'Tujuan pengiriman wajib diisi.');
    if (!message) throw new HttpError(400, 'Isi pesan wajib diisi.');
    if (message.length > MAX_MESSAGE_LENGTH) {
      throw new HttpError(400, `Isi pesan maksimal ${MAX_MESSAGE_LENGTH} karakter.`);
    }

    const result =
      channel === 'email'
        ? await sendEmail({ ...payload, to, message })
        : await sendWhatsApp({ ...payload, to, message });

    setJsonHeaders(res);
    res.status(200).json({ ok: true, channel, result });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message =
      error instanceof Error ? error.message : 'Gagal mengirim notifikasi.';
    setJsonHeaders(res);
    res.status(status).json({ error: message });
  }
}

async function sendEmail(payload) {
  const user = process.env.GMAIL_SMTP_USER;
  const pass = process.env.GMAIL_SMTP_APP_PASSWORD;
  if (!user || !pass) {
    throw new HttpError(
      501,
      'Gmail SMTP belum dikonfigurasi. Isi GMAIL_SMTP_USER dan GMAIL_SMTP_APP_PASSWORD.',
    );
  }

  const subject =
    String(payload.subject ?? '').trim() ||
    `Struk ${String(payload.orderNumber ?? '').trim() || 'Kasir'}`;
  const fromEmail = process.env.GMAIL_SMTP_FROM || user;
  const fromName =
    process.env.GMAIL_SMTP_FROM_NAME ||
    String(payload.storeName ?? '').trim() ||
    'Aplikasi Kasir';

  const transporter = nodemailer.createTransport({
    host: process.env.GMAIL_SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.GMAIL_SMTP_PORT || 465),
    secure: String(process.env.GMAIL_SMTP_SECURE ?? 'true') !== 'false',
    auth: { user, pass },
  });

  const info = await transporter.sendMail({
    from: { name: fromName, address: fromEmail },
    to: payload.to,
    subject,
    text: payload.message,
    html: receiptTextToHtml(payload.message),
  });

  return { messageId: info.messageId, accepted: info.accepted, rejected: info.rejected };
}

async function sendWhatsApp(payload) {
  const token = process.env.FONNTE_TOKEN;
  if (!token) {
    throw new HttpError(501, 'Fonnte belum dikonfigurasi. Isi FONNTE_TOKEN.');
  }

  const defaultCountryCode = process.env.FONNTE_DEFAULT_COUNTRY_CODE || '62';
  const target = normalizePhone(payload.to, defaultCountryCode);
  if (target.length < 8) throw new HttpError(400, 'Nomor WhatsApp belum valid.');

  const form = new FormData();
  form.append('target', target);
  form.append('message', payload.message);
  form.append('countryCode', '0');
  if (process.env.FONNTE_DELAY) form.append('delay', process.env.FONNTE_DELAY);

  const response = await fetch('https://api.fonnte.com/send', {
    method: 'POST',
    headers: { Authorization: token },
    body: form,
  });

  const text = await response.text();
  const body = parseJson(text);

  if (!response.ok || body?.status === false || body?.Status === false) {
    const reason = body?.reason || body?.detail || text || 'Fonnte menolak request.';
    throw new HttpError(response.ok ? 400 : response.status, String(reason));
  }

  return body ?? { detail: text };
}

async function readJsonBody(req) {
  if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8') || '{}');
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function normalizePhone(value, defaultCountryCode) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) return `${defaultCountryCode}${digits.slice(1)}`;
  if (defaultCountryCode === '62' && digits.startsWith('8')) return `62${digits}`;
  return digits;
}

function receiptTextToHtml(text) {
  return `
    <div style="font-family:Arial,sans-serif;color:#111;line-height:1.5">
      <pre style="font-family:ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;background:#f7f7f7;border:1px solid #e5e5e5;border-radius:8px;padding:16px">${escapeHtml(text)}</pre>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function setJsonHeaders(res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
