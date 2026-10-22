import { IntegrationError, loadIntegration } from './settings.js';
import * as tripay from './tripay.js';
import * as mayar from './mayar.js';
import * as doku from './doku.js';

export async function selectedGateway(db, storeId) {
  const result = await db.query('select provider from public.store_payment_settings where store_id = $1', [storeId]);
  // Preserve existing Tripay installations until the admin explicitly changes it.
  return result.rows[0]?.provider || 'tripay';
}

export async function selectGateway(db, storeId, provider) {
  if (!['tripay', 'mayar', 'doku', 'manual'].includes(provider)) throw new IntegrationError('Layanan pembayaran tidak dikenal.');
  if (provider === 'doku') {
    const config = await loadIntegration(db, storeId, provider);
    if (!doku.dokuAktif(config)) throw new IntegrationError('Simpan dan aktifkan kredensial layanan tersebut terlebih dahulu.');
    // DOKU Checkout tidak punya daftar kanal; cukup pastikan kunci diterima.
    try { await doku.tesKoneksi(config); } catch (error) { throw new IntegrationError(error.message); }
  } else if (provider !== 'manual') {
    const config = await loadIntegration(db, storeId, provider);
    if (!(provider === 'mayar' ? mayar.mayarAktif(config) : tripay.tripayAktif(config))) {
      throw new IntegrationError('Simpan dan aktifkan kredensial layanan tersebut terlebih dahulu.');
    }
    // Validate API access before switching checkout. No payment is created.
    const channels = await (provider === 'mayar' ? mayar.daftarKanal(config) : tripay.daftarKanal(config, true));
    if (!channels.some((c) => provider === 'mayar' ? c.active : tripay.kanalAktif(c))) throw new IntegrationError('Belum ada kanal pembayaran aktif pada layanan ini.');
  }
  await db.query(`insert into public.store_payment_settings (store_id, provider) values ($1,$2)
    on conflict (store_id) do update set provider = excluded.provider, updated_at = now()`, [storeId, provider]);
  return provider;
}

export async function readPayment(db, order) {
  const provider = order.payment_provider || 'tripay';
  const config = await loadIntegration(db, order.store_id, provider);
  if (order.payment_mode && order.payment_mode !== config.mode) throw new IntegrationError('Mode pembayaran berubah. Periksa transaksi pada mode asal.');
  if (provider === 'mayar') return mayar.verifiedPayment(order, await mayar.detailTransaksi(order.payment_transaction_id, config));
  if (provider === 'doku') return doku.verifiedPayment(order, await doku.cekStatus(order.order_number, config));
  const data = await tripay.detailTransaksi(order.payment_reference, config);
  const amount = Number(order.payment_amount ?? (Number(order.total) - Number(order.shipping_cost || 0)));
  if (data?.reference !== order.payment_reference || data.merchant_ref !== order.order_number
    || data.payment_method !== order.payment_channel || Number(data.amount) - Number(data.fee_customer) !== amount) {
    throw new IntegrationError('Referensi, kanal, atau nominal pembayaran Tripay tidak sesuai pesanan.');
  }
  return { paid: data.status === 'PAID', unpaid: data.status === 'UNPAID',
    closed: ['EXPIRED', 'FAILED', 'REFUND'].includes(data.status), expires: Number(data.expired_time) * 1000 };
}

export async function syncPayment(db, order) {
  const payment = await readPayment(db, order);
  if (payment.paid) {
    await db.query(`update public.orders set payment_status = 'paid', paid_amount = coalesce(payment_amount, total - coalesce(shipping_cost,0)),
      settled_at = coalesce(settled_at, now()), payment_checked_at = now()
      where id = $1 and store_id = $2 and payment_reference = $3 and payment_status <> 'paid'`, [order.id, order.store_id, order.payment_reference]);
  } else if (payment.closed) {
    await db.query(`update public.orders set order_status = 'canceled', payment_checked_at = now()
      where id = $1 and store_id = $2 and payment_reference = $3 and payment_status = 'unpaid'
      and order_status = 'awaiting_confirmation'`, [order.id, order.store_id, order.payment_reference]);
  }
  return payment;
}

/** Periodic fallback for lost/early webhooks. Atomic claim also limits concurrent webhook calls. */
export async function reconcilePayments(db, { limit = 10 } = {}) {
  for (let index = 0; index < limit; index++) {
    const claimed = await db.query(`update public.orders set payment_checked_at = now() where id = (
      select id from public.orders where payment_reference is not null and payment_status = 'unpaid'
        and created_at > now() - interval '7 days'
        and (payment_checked_at is null or payment_checked_at < now() - interval '5 minutes')
      order by payment_checked_at nulls first limit 1 for update skip locked
    ) returning *`);
    if (!claimed.rows[0]) break;
    try { await syncPayment(db, claimed.rows[0]); }
    catch { console.warn('[payment] Pemeriksaan pembayaran belum berhasil. Akan diperiksa kembali.'); }
  }
}

export async function handleMayarWebhook(db, body) {
  if (body?.event !== 'payment.received') return;
  const id = body?.data?.transactionId;
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new IntegrationError('Referensi webhook tidak valid.');
  // Webhook payload is only a hint. Settlement always uses authenticated Mayar API data.
  const claim = await db.query(`update public.orders set payment_checked_at = now()
    where payment_provider = 'mayar' and payment_transaction_id = $1 and payment_status = 'unpaid'
      and (payment_checked_at is null or payment_checked_at < now() - interval '30 seconds') returning *`, [id]);
  for (const order of claim.rows) await syncPayment(db, order);
}
