// Mailketing: pengiriman email transaksional (kode reset kata sandi pembeli).
//
// Dipakai lebih dulu daripada SMTP biasa bila MAILKETING_API_TOKEN terisi,
// karena domain pengirim client sudah terverifikasi di sana. Bila token kosong,
// pengiriman jatuh kembali ke SMTP/outbox lokal seperti sebelumnya.

const BASE = process.env.MAILKETING_BASE_URL || 'https://api.mailketing.co.id/api/v2';

function mailketingAktif() {
  return !!(process.env.MAILKETING_API_TOKEN && process.env.MAILKETING_FROM_EMAIL);
}

/**
 * Kirim satu email. Mengembalikan message_id dari Mailketing.
 * `html` boleh berisi HTML penuh; Mailketing mengirimkannya lewat SMTP relay.
 */
async function kirimEmailMailketing({ to, subject, html }) {
  if (!mailketingAktif()) throw new Error('Mailketing belum dikonfigurasi.');
  const res = await fetch(`${BASE}/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.MAILKETING_API_TOKEN}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from_name: process.env.MAILKETING_FROM_NAME || 'GNNK Racing',
      from_email: process.env.MAILKETING_FROM_EMAIL,
      recipient: to,
      subject,
      content: html,
    }),
  });
  const teks = await res.text();
  let json = null;
  try {
    json = JSON.parse(teks);
  } catch {
    /* biarkan null */
  }
  if (!res.ok || json?.success === false) {
    throw new Error(`Mailketing: ${json?.message || teks.slice(0, 200) || `HTTP ${res.status}`}`);
  }
  return json?.data?.message_id || null;
}

export { mailketingAktif, kirimEmailMailketing };
