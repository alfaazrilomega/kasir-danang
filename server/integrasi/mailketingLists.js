// API v2: https://api.mailketing.co.id/docs/#lists
import { loadSettings } from './emailSettings.js';

const OFFICIAL_BASE = 'https://api.mailketing.co.id/api/v2';
export function mailketingStoreId() {
  return process.env.MAILKETING_STORE_ID || process.env.VITE_PUBLIC_STORE_ID || '5d3e9a20-66ac-4012-9bab-103fbf9b08e4';
}
// Token API dari menu Email & Template toko dipakai lebih dulu, sama seperti pengiriman email.
// Token server hanya untuk toko MAILKETING_STORE_ID.
export async function mailketingAuth(db, storeId) {
  const { config } = await loadSettings(db, storeId);
  if (config.provider === 'mailketing' && config.apiToken) return { token: config.apiToken, base: OFFICIAL_BASE };
  if (storeId === mailketingStoreId() && process.env.MAILKETING_API_TOKEN) {
    return { token: process.env.MAILKETING_API_TOKEN, base: process.env.MAILKETING_BASE_URL || OFFICIAL_BASE };
  }
  return null;
}
async function request(path, payload, auth) {
  if (!auth?.token) throw new Error('Token Mailketing belum diatur.');
  const response = await fetch(`${auth.base.replace(/\/$/, '')}${path}`, {
    method: payload ? 'POST' : 'GET', redirect: 'error',
    headers: { Authorization: `Bearer ${auth.token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
    signal: AbortSignal.timeout(10000),
  });
  let body;
  try { body = await response.json(); } catch { throw new Error('Respons Mailketing tidak valid.'); }
  // Jangan teruskan respons mentah provider: bisa mengandung data pelanggan/token.
  if (!response.ok || body?.success !== true) throw new Error(`Mailketing menolak permintaan (HTTP ${response.status}).`);
  return body.data;
}
export async function getMailketingLists(auth) {
  const data = await request('/lists', undefined, auth);
  if (!Array.isArray(data?.lists)) throw new Error('Daftar list Mailketing tidak valid.');
  const unique = new Map();
  for (const list of data.lists) {
    if (!['string', 'number'].includes(typeof list?.list_id)) continue;
    const id = Number(list.list_id);
    // ID harus dapat disimpan di kolom integer produk. Abaikan baris rusak dari provider.
    if (!Number.isInteger(id) || id <= 0 || id > 2147483647 || unique.has(id)) continue;
    const name = typeof list.list_name === 'string' ? list.list_name.trim() : '';
    unique.set(id, { id, name: name || `List #${id}` });
  }
  return [...unique.values()];
}
export async function subscribeMailketing(job, auth) {
  const parts = String(job.name || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/);
  const data = await request('/subscribers', {
    list_id: Number(job.list_id), email: job.email,
    first_name: (parts.shift() || '').slice(0, 255), last_name: parts.join(' ').slice(0, 255),
    mobile: String(job.phone || '').slice(0, 30),
  }, auth);
  if (!['added', 'already_exists'].includes(data?.status)) throw new Error('Status sinkronisasi Mailketing tidak dikenal.');
}

export async function processMailketingQueue(pool, { send = subscribeMailketing, limit = 10 } = {}) {
  const stores = await pool.query(`select distinct store_id from public.mailketing_subscriptions
    where processed_at is null and attempts < 5 and next_attempt_at <= now()`);
  for (const { store_id: storeId } of stores.rows) {
    let auth;
    // Kredensial satu toko rusak tidak boleh menghentikan antrean toko lain.
    try { auth = await mailketingAuth(pool, storeId); } catch { continue; }
    if (auth) await processStoreQueue(pool, storeId, auth, send, limit);
  }
}
async function processStoreQueue(pool, storeId, auth, send, limit) {
  for (let i = 0; i < limit; i++) {
    // Klaim satu pekerjaan dengan lease. Aman saat PM2 memakai beberapa proses.
    const claimed = await pool.query(`with job as (
      select id from public.mailketing_subscriptions
      where store_id = $1 and processed_at is null and attempts < 5 and next_attempt_at <= now()
      order by created_at for update skip locked limit 1
    ) update public.mailketing_subscriptions q
      set attempts = attempts + 1, next_attempt_at = now() + interval '2 minutes'
      from job where q.id = job.id returning q.*`, [storeId]);
    const job = claimed.rows[0];
    if (!job) break;
    try {
      await send(job, auth);
      await pool.query('update public.mailketing_subscriptions set processed_at = now(), last_error = null where id = $1', [job.id]);
    } catch {
      await pool.query(`update public.mailketing_subscriptions
        set last_error = 'Sinkronisasi Mailketing gagal. Periksa token dan list tujuan.',
            next_attempt_at = now() + interval '2 minutes' * attempts where id = $1`, [job.id]);
    }
  }
}
