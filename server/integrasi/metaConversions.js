import crypto from 'node:crypto';
import { isIP } from 'node:net';
import { loadIntegration } from './settings.js';

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const PIXEL = /^\d{10,20}$/;
const COOKIE = /^fb\.\d\.\d{10,16}\.[A-Za-z0-9_-]{1,200}$/;

/** Browser attributes are optional and untrusted; payment/amount never come from the browser. */
export function metaTrackingContext({ pixelId, capi, cookies = '', tracking = {}, clientIp, userAgent, origin }) {
  const context = { pixelId: PIXEL.test(pixelId || '') ? pixelId : null, capi: !!capi };
  if (!capi) return context;
  for (const [name, cookieName] of [['fbp', '_fbp'], ['fbc', '_fbc']]) {
    const cookie = String(cookies).split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    const value = cookie || tracking?.[name];
    if (typeof value === 'string' && COOKIE.test(value)) context[name] = value;
  }
  if (isIP(String(clientIp || ''))) context.clientIp = clientIp;
  if (userAgent) context.userAgent = String(userAgent).replace(/[\r\n]/g, '').slice(0, 500);
  try { const url = new URL('/toko/checkout', origin); if (url.protocol === 'https:') context.sourceUrl = url.href; } catch { /* Optional source. */ }
  return context;
}

export function buildMetaPurchase({ event, order, customer = {} }) {
  const tracking = order.meta_tracking || {};
  const user_data = {};
  const email = String(customer.email || '').trim().toLowerCase();
  let phone = String(customer.phone || order.customer_phone || '').replace(/\D/g, '');
  if (phone.startsWith('0')) phone = `62${phone.slice(1)}`;
  else if (phone.startsWith('8')) phone = `62${phone}`;
  if (email) user_data.em = [hash(email)];
  if (/^[1-9]\d{7,14}$/.test(phone)) user_data.ph = [hash(phone)];
  if (order.customer_id) user_data.external_id = [hash(String(order.customer_id))];
  if (tracking.clientIp) user_data.client_ip_address = tracking.clientIp;
  if (tracking.userAgent) user_data.client_user_agent = tracking.userAgent;
  if (tracking.fbp) user_data.fbp = tracking.fbp;
  if (tracking.fbc) user_data.fbc = tracking.fbc;
  const p = event.purchase;
  const contents = p.barang.map((item) => ({ id: item.id, quantity: item.qty, item_price: item.harga }));
  return {
    event_name: 'Purchase', event_time: Math.floor(new Date(event.created_at).getTime() / 1000),
    event_id: event.event_id, action_source: 'website',
    ...(tracking.sourceUrl ? { event_source_url: tracking.sourceUrl } : {}), user_data,
    custom_data: { currency: 'IDR', value: p.nilai, order_id: p.nomorPesanan, content_type: 'product',
      content_ids: contents.map((item) => item.id), contents, num_items: contents.reduce((sum, item) => sum + item.quantity, 0) },
  };
}

export async function kirimMetaPurchase(event, pixelId, config) {
  if (!PIXEL.test(pixelId) || !/^v[1-9]\d{0,2}\.0$/.test(config.apiVersion) || !config.accessToken) throw new Error('Konfigurasi Meta CAPI tidak valid');
  const url = `https://graph.facebook.com/${config.apiVersion}/${pixelId}/events`;
  const body = { data: [event], access_token: config.accessToken };
  if (config.testEventCode) body.test_event_code = config.testEventCode;
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Meta CAPI HTTP ${response.status}`);
  const result = await response.json();
  if (result.error || !(Number(result.events_received) >= 1)) throw new Error('Meta CAPI tidak menerima event');
}

/** Customer-owned, recently paid snapshots only; never replay historical purchases. */
export async function customerPurchases(db, { storeId, customerId, orderId = null }) {
  const result = await db.query(`select e.purchase from public.meta_capi_events e
    join public.orders o on o.id = e.order_id and o.store_id = e.store_id
    where e.store_id = $1 and o.customer_id = $2 and ($3::uuid is null or o.id = $3)
      and o.payment_status = 'paid' and o.order_status <> 'canceled'
      and o.payment_mode is distinct from 'sandbox' and e.created_at > now() - interval '1 day'
    order by e.created_at desc limit 100`, [storeId, customerId, orderId]);
  return result.rows.map((row) => row.purchase);
}

export async function processMetaQueue(db, { send = kirimMetaPurchase } = {}) {
  // Keep attribution only while an unpaid checkout or pending event can still need it.
  await db.query(`update public.orders o set meta_tracking = meta_tracking - 'fbp' - 'fbc' - 'clientIp' - 'userAgent'
    where meta_tracking ?| array['fbp', 'fbc', 'clientIp', 'userAgent'] and o.created_at < now() - interval '7 days'
    and not exists (select 1 from public.meta_capi_events e where e.order_id = o.id and e.processed_at is null and e.created_at > now() - interval '7 days')`);
  await db.query(`update public.meta_capi_events set processed_at = now(), last_error = 'Batas pengiriman berakhir'
    where processed_at is null and (created_at <= now() - interval '7 days' or (attempts >= 5 and next_attempt_at <= now()))`);
  const pending = await db.query(`select id from public.meta_capi_events where processed_at is null
    and next_attempt_at <= now() and attempts < 5 order by created_at limit 10`);
  for (const row of pending.rows) {
    const claimed = await db.query(`update public.meta_capi_events set attempts = attempts + 1,
      next_attempt_at = now() + interval '2 minutes' where id = $1 and processed_at is null
      and attempts < 5 and next_attempt_at <= now() returning *`, [row.id]);
    const event = claimed.rows[0];
    if (!event) continue;
    try {
      const config = await loadIntegration(db, event.store_id, 'meta_capi');
      const result = await db.query(`select o.*, c.email, c.phone, s.meta_pixel_id from public.orders o
        join public.stores s on s.id = o.store_id
        left join public.customers c on c.id = o.customer_id and c.store_id = o.store_id
        where o.id = $1 and o.store_id = $2`, [event.order_id, event.store_id]);
      const order = result.rows[0];
      const eligible = config.enabled && config.accessToken && order?.payment_status === 'paid'
        && order.order_status !== 'canceled' && order.payment_mode !== 'sandbox'
        && order.meta_pixel_id === event.pixel_id;
      if (eligible) await send(buildMetaPurchase({ event, order, customer: order }), event.pixel_id, config);
      await db.query('update public.meta_capi_events set processed_at = now(), last_error = $2 where id = $1',
        [event.id, eligible ? null : 'Dilewati: integrasi nonaktif atau pesanan tidak memenuhi syarat']);
      await db.query('update public.orders set meta_tracking = null where id = $1', [event.order_id]);
    } catch (error) {
      // Never persist arbitrary exception messages: HTTP libraries may embed access tokens or bodies.
      const message = /^Meta CAPI HTTP \d{3}$/.test(error?.message || '') ? error.message : 'Pengiriman Meta CAPI gagal';
      await db.query(`update public.meta_capi_events set last_error = $2,
        processed_at = case when attempts >= 5 then now() else null end,
        next_attempt_at = now() + ($3 * interval '1 minute') where id = $1`, [event.id, message, 2 ** event.attempts]);
      if (event.attempts >= 5) await db.query('update public.orders set meta_tracking = null where id = $1', [event.order_id]);
    }
  }
}
