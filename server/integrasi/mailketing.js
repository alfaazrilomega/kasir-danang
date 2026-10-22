// Mailketing API v2. Override per toko memakai endpoint resmi tetap.
const BASE = process.env.MAILKETING_BASE_URL || 'https://api.mailketing.co.id/api/v2';
export class MailketingError extends Error {
  constructor(message) { super(message); this.status = 502; }
}
export function mailketingAktif() { return !!(process.env.MAILKETING_API_TOKEN && process.env.MAILKETING_FROM_EMAIL); }
async function request(path, payload, config) {
  const token = config?.apiToken || process.env.MAILKETING_API_TOKEN;
  if (!token) throw new MailketingError('API Token Mailketing belum diisi.');
  let res; let json;
  try {
    res = await fetch(`${config ? 'https://api.mailketing.co.id/api/v2' : BASE}${path}`, {
      method: payload ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json' } : {}) },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    json = await res.json();
  } catch { throw new MailketingError('Respons Mailketing belum dapat dipastikan. Periksa koneksi dan log pengiriman di dashboard Mailketing.'); }
  if (!res.ok || json?.success !== true) {
    const messages = { 401: 'API Token Mailketing ditolak. Gunakan token dari menu API Integration, bukan password login.', 402: 'Kredit Mailketing habis. Isi ulang kredit di dashboard.', 403: 'Domain pengirim belum diverifikasi atau akses Mailketing ditolak.', 422: 'Mailketing menolak data email. Periksa pengirim dan penerima.', 429: 'Batas permintaan Mailketing tercapai. Coba lagi nanti.' };
    throw new MailketingError(messages[res.status] || 'Mailketing menolak permintaan. Periksa konfigurasi dan log di dashboard.');
  }
  return json.data;
}
export async function kirimEmailMailketing({ to, subject, html }, config) {
  const data = await request('/send', { from_name: config?.fromName || process.env.MAILKETING_FROM_NAME || 'GNNK Racing', from_email: config?.fromEmail || process.env.MAILKETING_FROM_EMAIL, recipient: to, subject, content: html }, config);
  if (!data?.message_id) throw new MailketingError('Mailketing belum mengembalikan ID pesan. Periksa log sebelum mengirim ulang.');
  return data.message_id;
}
export async function tesMailketing(config) {
  const data = await request('/credits', undefined, config);
  if (!Number.isFinite(Number(data?.credits)) || data?.credits === null) throw new MailketingError('Respons kredit Mailketing tidak valid.');
  return { message: `Koneksi Mailketing berhasil. Kredit: ${Number(data.credits).toLocaleString('id-ID')}. Tes tidak mengirim email. Pastikan domain pengirim sudah diverifikasi.` };
}
