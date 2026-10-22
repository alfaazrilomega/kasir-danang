import { IntegrationError } from './settings.js';
import { syncPayment } from './payments.js';

export async function customerPayment(db, { orderId, storeId, customerId }) {
  const read = async () => (await db.query(`select * from public.orders where id = $1 and store_id = $2 and customer_id = $3`, [orderId, storeId, customerId])).rows[0];
  let order = await read();
  if (!order || order.payment_provider !== 'mayar') throw new IntegrationError('Pembayaran tidak ditemukan.', 404);
  let warning = null;
  if (order.payment_status === 'unpaid' && order.payment_reference && order.payment_transaction_id) {
    const claim = await db.query(`update public.orders set payment_checked_at = now()
      where id = $1 and store_id = $2 and customer_id = $3 and payment_status = 'unpaid'
      and (payment_checked_at is null or payment_checked_at < now() - interval '30 seconds') returning *`, [orderId, storeId, customerId]);
    if (claim.rows[0]) {
      try { await syncPayment(db, claim.rows[0]); }
      catch { warning = 'Status terbaru belum dapat diperiksa. Jangan membuat pembayaran baru. Coba periksa kembali.'; }
    }
    order = await read();
  }
  const expires = order.payment_expires_at ? new Date(order.payment_expires_at).getTime() : null;
  const paid = order.payment_status === 'paid';
  const closed = order.order_status === 'canceled' || (expires !== null && expires <= Date.now());
  let checkoutUrl = null;
  try {
    const url = new URL(order.payment_url);
    if (url.protocol === 'https:' && !url.username && !url.password) checkoutUrl = url.href;
  } catch { /* Do not expose malformed legacy URLs. */ }
  return {
    order_id: order.id, order_number: order.order_number, provider: 'mayar', mode: order.payment_mode,
    channel: order.payment_channel, amount: Number(order.payment_amount ?? 0),
    status: paid ? 'paid' : closed ? 'expired' : 'unpaid', expires_at: order.payment_expires_at,
    server_time: new Date().toISOString(), instructions: !paid && !closed ? order.payment_instructions : null,
    checkout_url: !paid && !closed ? checkoutUrl : null, warning,
    // Pesanan berongkir KiriminAja: nominal di atas sudah termasuk ongkir (spec 0002).
    termasuk_ongkir: !!order.shipping_service && Number(order.shipping_cost || 0) > 0,
  };
}
