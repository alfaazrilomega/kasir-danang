import crypto from 'node:crypto';
import { loadIntegration } from './settings.js';
import { readPayment } from './payments.js';
import * as tripay from './tripay.js';
import { loadSettings, prepareMessage, sendMessage, REMINDER_KEYS, WhatsAppError } from './whatsappNotifications.js';

class ReminderSkipped extends WhatsAppError {}

/** Dipanggil dalam transaksi checkout. Pengaktifan tidak mengambil pesanan lama. */
export async function enqueueReminders(db, { storeId, orderId, createdAt, paymentMethod, requiresGateway }) {
  if (paymentMethod === 'cash') return;
  const settings = await loadSettings(db, storeId);
  if (!settings.reminders.enabled) return;
  for (const [index, key] of REMINDER_KEYS.entries()) {
    const scheduledAt = new Date(new Date(createdAt).getTime() + settings.reminders.minutes[index] * 60000);
    await db.query(`insert into public.whatsapp_reminders
      (id, store_id, order_id, template_key, requires_gateway, scheduled_at)
      values ($1,$2,$3,$4,$5,$6) on conflict (order_id, template_key) do nothing`,
    [crypto.randomUUID(), storeId, orderId, key, requiresGateway, scheduledAt.toISOString()]);
  }
}

export function ineligibleReason(order) {
  if (!order || !order.customer_id) return 'Pesanan atau customer tidak tersedia.';
  if (order.sales_channel !== 'website' || order.payment_method === 'cash') return 'Pesanan COD atau bukan dari website.';
  if (order.order_status === 'canceled') return 'Pesanan dibatalkan.';
  if (order.payment_status !== 'unpaid' || Number(order.paid_amount) > 0) return 'Pembayaran sudah tercatat. Reminder dihentikan.';
  return null;
}

async function checkBeforeSend(db, job, message) {
  const settings = await loadSettings(db, job.store_id);
  if (!settings.reminders.enabled) throw new ReminderSkipped('Reminder otomatis dinonaktifkan admin.');
  if (settings.provider !== message.provider) throw new ReminderSkipped('Layanan pengirim berubah. Reminder ini dibatalkan.');
  if (Date.now() >= new Date(job.scheduled_at).getTime() + 5 * 60000) throw new ReminderSkipped('Jadwal terlewat lebih dari 5 menit. Tidak dikirim sekaligus.');
  const readOrder = async () => (await db.query('select * from public.orders where id = $1 and store_id = $2', [job.order_id, job.store_id])).rows[0];
  const order = await readOrder();
  const reason = ineligibleReason(order);
  if (reason) throw new ReminderSkipped(reason);
  if (job.requires_gateway || order.payment_reference) {
    if (!order.payment_reference) throw new ReminderSkipped('Transaksi pembayaran belum tersedia. Perlu diperiksa admin.');
    if (order.payment_provider === 'mayar') {
      const payment = await readPayment(db, order);
      if (!payment.unpaid || !Number.isFinite(payment.expires) || payment.expires <= Date.now()) {
        throw new ReminderSkipped('Pembayaran Mayar sudah selesai, kedaluwarsa, atau belum dapat dipastikan.');
      }
    } else {
      const config = await loadIntegration(db, job.store_id, 'tripay');
      const payment = await tripay.detailTransaksi(order.payment_reference, config);
      if (payment?.reference !== order.payment_reference || payment?.merchant_ref !== order.order_number) {
        throw new ReminderSkipped('Referensi pembayaran tidak cocok. Perlu diperiksa admin.');
      }
      if (payment.status !== 'UNPAID') throw new ReminderSkipped('Status Tripay bukan UNPAID. Reminder dihentikan.');
      if (!Number.isFinite(Number(payment.expired_time)) || Number(payment.expired_time) * 1000 <= Date.now()) {
        throw new ReminderSkipped('Pembayaran sudah kedaluwarsa atau masa berlakunya tidak tersedia.');
      }
    }
  }
  // Callback pembayaran bisa masuk sewaktu API Tripay sedang diperiksa.
  const latestOrder = await readOrder();
  const latestReason = ineligibleReason(latestOrder);
  if (latestReason) throw new ReminderSkipped(latestReason);
  if (latestOrder.payment_reference !== order.payment_reference) throw new ReminderSkipped('Referensi pembayaran berubah. Periksa pesanan.');
  const latestSettings = await loadSettings(db, job.store_id);
  if (!latestSettings.reminders.enabled || latestSettings.provider !== message.provider) throw new ReminderSkipped('Pengaturan pengiriman berubah. Reminder dibatalkan.');
}

async function finish(db, job, status, reason = null) {
  await db.query(`update public.whatsapp_reminders set status = $2, reason = $3, updated_at = now() where id = $1`, [job.id, status, reason]);
}

/** Klaim atomik antarproses. Pesan yang mungkin sudah dikirim tidak dicoba ulang. */
export async function processReminders(db, { limit = 10 } = {}) {
  await db.query(`update public.whatsapp_reminders r set status = case
      when exists (select 1 from public.whatsapp_messages m where m.id = r.message_id and m.status = 'accepted') then 'sent' else 'failed' end,
      reason = 'Proses sebelumnya terhenti. Periksa riwayat sebelum mengirim manual.', updated_at = now()
    where r.status = 'processing' and r.updated_at < now() - interval '5 minutes'`);
  // Pembatalan tetap berlaku bila admin menyalakan kembali opsi di kemudian hari.
  await db.query(`update public.whatsapp_reminders r set status = 'skipped', reason = 'Reminder otomatis dinonaktifkan admin.', updated_at = now()
    where r.status = 'pending' and not exists (select 1 from public.whatsapp_settings s
      where s.store_id = r.store_id and s.config->'reminders'->>'enabled' = 'true')`);
  await db.query(`update public.whatsapp_reminders r set status = 'skipped',
    reason = case when o.order_status = 'canceled' then 'Pesanan dibatalkan.'
      when o.payment_method = 'cash' then 'Pesanan COD.' else 'Pembayaran sudah tercatat. Reminder dihentikan.' end, updated_at = now()
    from public.orders o where o.id = r.order_id and r.status = 'pending'
      and (o.payment_status <> 'unpaid' or o.paid_amount > 0 or o.order_status = 'canceled' or o.payment_method = 'cash')`);
  let processed = 0;
  for (let index = 0; index < limit; index++) {
    const claimed = await db.query(`update public.whatsapp_reminders set status = 'processing', updated_at = now()
      where id = (select id from public.whatsapp_reminders where status = 'pending' and scheduled_at <= now()
        order by scheduled_at limit 1 for update skip locked) and status = 'pending' returning *`);
    const job = claimed.rows[0];
    if (!job) break;
    processed++;
    try {
      const order = (await db.query('select * from public.orders where id = $1 and store_id = $2', [job.order_id, job.store_id])).rows[0];
      const reason = ineligibleReason(order);
      if (reason) throw new ReminderSkipped(reason);
      const settings = await loadSettings(db, job.store_id);
      if (!settings.reminders.enabled) throw new ReminderSkipped('Reminder otomatis dinonaktifkan admin.');
      if (Date.now() >= new Date(job.scheduled_at).getTime() + 5 * 60000) throw new ReminderSkipped('Jadwal terlewat lebih dari 5 menit. Tidak dikirim sekaligus.');
      const previous = await db.query(`select id from public.whatsapp_messages where store_id = $1 and order_id = $2
        and template_key = $3 and status in ('accepted','sending','unknown') limit 1`, [job.store_id, job.order_id, job.template_key]);
      if (previous.rows.length) throw new ReminderSkipped('Tahap ini sudah dikirim atau status pengirimannya belum pasti.');
      const message = await prepareMessage(db, { storeId: job.store_id, orderId: job.order_id,
        customerId: order.customer_id, key: job.template_key, useOrderPhone: true, dedupeKey: `reminder:${job.order_id}:${job.template_key}` });
      if (!message) throw new ReminderSkipped('Reminder ini sudah pernah diproses.');
      await db.query('update public.whatsapp_reminders set message_id = $2 where id = $1', [job.id, message.id]);
      let stopped = null;
      await sendMessage(db, job.store_id, message.id, { beforeSend: async (row) => {
        try { await checkBeforeSend(db, job, row); }
        catch (error) { stopped = error; throw error; }
      } }).catch((error) => { throw stopped || error; });
      await finish(db, job, 'sent');
    } catch (error) {
      const skipped = error instanceof ReminderSkipped;
      const reason = error instanceof WhatsAppError ? error.message : 'Status pembayaran atau pengiriman tidak dapat dipastikan. Periksa sebelum mengirim manual.';
      await finish(db, job, skipped ? 'skipped' : 'failed', reason);
    }
  }
  return processed;
}
