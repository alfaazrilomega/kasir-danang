import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings, saveSettings } from '../integrasi/whatsappNotifications.js';
import { enqueueReminders, processReminders } from '../integrasi/whatsappReminders.js';
import { encryptConfig } from '../integrasi/settings.js';
import * as onesender from '../integrasi/onesender.js';
import * as mayar from '../integrasi/mayar.js';
import * as tripay from '../integrasi/tripay.js';

const storeId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const customerId = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const orderId = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
let db, send, payment;
const settings = () => ({ ...defaultSettings(), reminders: { enabled: true, minutes: [10, 30, 50] } });
const rows = async () => (await db.query('select * from whatsapp_reminders order by template_key')).rows;
const messages = async () => (await db.query('select * from whatsapp_messages')).rows;
const enqueue = (database = db) => enqueueReminders(database, { storeId, orderId, createdAt: new Date(Date.now() - 11 * 60000), paymentMethod: 'transfer', requiresGateway: false });

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(`create table stores (id uuid primary key, name text);
    create table customers (id uuid primary key, store_id uuid, name text, phone text, address text);
    create table orders (id uuid primary key, store_id uuid, customer_id uuid, order_number text,
      total numeric, shipping_cost numeric, payment_method text, payment_status text, paid_amount numeric,
      order_status text, customer_phone text, customer_name text, delivery_address text,
      payment_url text, payment_channel text, payment_reference text, sales_channel text, created_at timestamptz,
      payment_provider text, payment_mode text, payment_amount numeric, payment_transaction_id text, payment_expires_at timestamptz);
    create table order_items (id uuid primary key, order_id uuid, name text, qty numeric, price numeric);
    create table store_integrations (store_id uuid, provider text, config_encrypted text);`);
  await db.exec(await fs.readFile(new URL('../migrations/049_whatsapp_notifications.sql', import.meta.url), 'utf8'));
  await db.exec(await fs.readFile(new URL('../migrations/051_whatsapp_reminders.sql', import.meta.url), 'utf8'));
}, 30000);

beforeEach(async () => {
  vi.stubEnv('INTEGRATION_SECRET', 'isolated-reminder-test');
  await db.exec('truncate whatsapp_reminders, whatsapp_messages, whatsapp_settings, store_integrations, order_items, orders, customers, stores cascade');
  await db.query('insert into stores values ($1, $2)', [storeId, 'Toko Uji']);
  await db.query('insert into customers values ($1,$2,$3,$4,$5)', [customerId, storeId, 'Pembeli Uji', 'pi', 'Alamat']);
  await db.query(`insert into orders values ($1,$2,$3,'WEB-UJI',10000,0,'transfer','unpaid',0,'awaiting_confirmation',
    '081234567890','Pembeli Uji','Alamat',null,null,null,'website', now() - interval '11 minutes')`, [orderId, storeId, customerId]);
  await db.query('insert into order_items values ($1,$2,$3,1,10000)', [crypto.randomUUID(), orderId, 'Produk Uji']);
  await db.query('insert into store_integrations values ($1,$2,$3)', [storeId, 'onesender', encryptConfig({ apiKey: 'test-key', apiUrl: 'https://example.com/api/v1/messages' }, `${storeId}:onesender`)]);
  await db.query('insert into store_integrations values ($1,$2,$3)', [storeId, 'tripay', encryptConfig({ apiKey: 'tripay-test-key', mode: 'sandbox' }, `${storeId}:tripay`)]);
  await saveSettings(db, storeId, settings());
  send = vi.spyOn(onesender, 'kirimPesan').mockResolvedValue({ id: 'mock-delivery' });
  payment = vi.spyOn(tripay, 'detailTransaksi').mockResolvedValue({ reference: 'REF-UJI', merchant_ref: 'WEB-UJI', status: 'UNPAID', expired_time: Math.floor(Date.now() / 1000) + 3600 });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
afterAll(async () => { await db?.close(); });

async function gateway() {
  await db.exec("update orders set payment_reference = 'REF-UJI', payment_channel = 'BRIVA'");
  await enqueue();
  await db.exec('update whatsapp_reminders set requires_gateway = true');
}

describe('Reminder dengan database SQL dan penyedia simulasi', () => {
  it('menyimpan tiga jadwal unik dan ikut rollback checkout', async () => {
    await expect(db.transaction(async tx => { await enqueue(tx); throw new Error('rollback'); })).rejects.toThrow('rollback');
    expect(await rows()).toHaveLength(0);
    await enqueue(); await enqueue();
    expect(await rows()).toHaveLength(3);
    expect((await rows()).map(row => row.status)).toEqual(['pending', 'pending', 'pending']);
  });
  it('dua worker hanya mengirim tahap jatuh tempo satu kali ke nomor checkout', async () => {
    await enqueue();
    await Promise.all([processReminders(db), processReminders(db)]);
    await processReminders(db);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]).toMatchObject({ to: '6281234567890', text: expect.stringContaining('WEB-UJI') });
    expect((await rows()).map(row => row.status)).toEqual(['sent', 'pending', 'pending']);
    expect((await messages())[0].status).toBe('accepted');
  });
  it('WA 1, WA 2, WA 3 masing-masing dikirim sekali pada jadwalnya', async () => {
    await enqueue();
    for (const key of ['wa1', 'wa2', 'wa3']) {
      await db.query("update whatsapp_reminders set scheduled_at = now() - interval '1 minute' where template_key = $1", [key]);
      await processReminders(db); await processReminders(db);
    }
    expect(send).toHaveBeenCalledTimes(3);
    expect((await rows()).map(row => row.status)).toEqual(['sent', 'sent', 'sent']);
  });
  it.each(["payment_status = 'paid'", "payment_status = 'partial', paid_amount = 1000", "order_status = 'canceled'", "payment_method = 'cash'"])('menghentikan semua tahap termasuk jadwal mendatang jika %s', async sql => {
    await enqueue(); await db.exec(`update orders set ${sql}`);
    await processReminders(db);
    expect(send).not.toHaveBeenCalled();
    expect((await rows()).every(row => row.status === 'skipped')).toBe(true);
  });
  it.each(['PAID', 'EXPIRED', 'FAILED', 'REFUND'])('tidak menagih status Tripay %s meskipun callback belum masuk', async status => {
    await gateway(); payment.mockResolvedValue({ reference: 'REF-UJI', merchant_ref: 'WEB-UJI', status });
    await processReminders(db);
    expect(payment).toHaveBeenCalledTimes(1); expect(send).not.toHaveBeenCalled();
    expect((await rows())[0].status).toBe('skipped');
  });
  it.each([0, null, 'invalid', Math.floor(Date.now()/1000)-1])('menolak masa berlaku Tripay %s', async expired_time => {
    await gateway(); payment.mockResolvedValue({ reference: 'REF-UJI', merchant_ref: 'WEB-UJI', status: 'UNPAID', expired_time });
    await processReminders(db); expect(send).not.toHaveBeenCalled();
  });
  it('memeriksa pembayaran dan mengirim Tripay UNPAID yang masih berlaku', async () => {
    await gateway(); await processReminders(db);
    expect(payment).toHaveBeenCalledWith('REF-UJI', expect.objectContaining({ mode: 'sandbox' }));
    expect(send).toHaveBeenCalledOnce();
  });
  it('gagal tertutup saat Tripay tidak dapat diperiksa, tanpa percobaan kirim ulang', async () => {
    await gateway(); payment.mockRejectedValue(new Error('network failure'));
    await processReminders(db); await processReminders(db);
    expect(send).not.toHaveBeenCalled(); expect((await rows())[0].status).toBe('failed');
  });
  it('memeriksa ulang status lokal setelah callback masuk saat pemeriksaan Tripay', async () => {
    await gateway();
    payment.mockImplementation(async () => {
      await db.exec("update orders set payment_status = 'paid'");
      return { reference: 'REF-UJI', merchant_ref: 'WEB-UJI', status: 'UNPAID', expired_time: Math.floor(Date.now()/1000)+3600 };
    });
    await processReminders(db); expect(send).not.toHaveBeenCalled();
  });
  it('mematikan opsi membatalkan antrean dan menyalakannya lagi tidak menghidupkan jadwal lama', async () => {
    await enqueue(); await saveSettings(db, storeId, { ...settings(), reminders: { enabled: false, minutes: [10,30,50] } });
    await saveSettings(db, storeId, settings()); await processReminders(db);
    expect(send).not.toHaveBeenCalled(); expect((await rows()).every(row => row.status === 'skipped')).toBe(true);
  });
  it('melewati jadwal terlambat setelah downtime tanpa mengirim tiga pesan sekaligus', async () => {
    await enqueue(); await db.exec("update whatsapp_reminders set scheduled_at = now() - interval '6 minutes'");
    await processReminders(db); expect(send).not.toHaveBeenCalled();
    expect((await rows()).every(row => row.status === 'skipped')).toBe(true);
  });
  it('tidak mencoba ulang pengiriman yang statusnya belum pasti', async () => {
    await enqueue(); send.mockRejectedValue(new onesender.OneSenderError('Respons belum pasti', true));
    await processReminders(db); await processReminders(db);
    expect(send).toHaveBeenCalledOnce(); expect((await messages())[0].status).toBe('unknown');
    expect((await rows())[0].status).toBe('failed');
  });
  it('restart tidak mengirim ulang job processing yang mungkin sudah dikirim', async () => {
    await enqueue();
    await db.exec("update whatsapp_reminders set status = 'processing', updated_at = now() - interval '6 minutes' where template_key = 'wa1'");
    await processReminders(db); expect(send).not.toHaveBeenCalled(); expect((await rows())[0].status).toBe('failed');
  });
  it('memulihkan status job jika pesan diterima API sebelum proses terhenti', async () => {
    await enqueue(); await processReminders(db);
    await db.exec("update whatsapp_reminders set status = 'processing', updated_at = now() - interval '6 minutes' where template_key = 'wa1'");
    await processReminders(db); expect(send).toHaveBeenCalledOnce(); expect((await rows())[0].status).toBe('sent');
  });
  it('nomor tidak valid tercatat gagal, tanpa menghubungi penyedia', async () => {
    await enqueue(); await db.exec("update orders set customer_phone = 'pi'");
    await processReminders(db); expect(send).not.toHaveBeenCalled(); expect((await rows())[0].reason).toMatch(/Nomor WhatsApp/);
  });
  it('tahap yang sudah dikirim manual tidak dikirim otomatis lagi', async () => {
    await enqueue();
    await db.query(`insert into whatsapp_messages (id, store_id, customer_id, order_id, template_key, provider, recipient, message_text, status)
      values ($1,$2,$3,$4,'wa1','onesender','6281234567890','Pesan manual','accepted')`, [crypto.randomUUID(),storeId,customerId,orderId]);
    await processReminders(db); expect(send).not.toHaveBeenCalled(); expect((await rows())[0].status).toBe('skipped');
  });
});


describe('Reminder Mayar', () => {
  const ref = '11111111-1111-4111-a111-111111111111';
  const trx = '22222222-2222-4222-a222-222222222222';
  async function mayarGateway() {
    await db.query(`update orders set payment_provider = 'mayar', payment_reference = $1, payment_transaction_id = $2,
      payment_mode = 'sandbox', payment_amount = 10000, payment_expires_at = now() + interval '1 hour'`, [ref, trx]);
    await db.query('insert into store_integrations values ($1,$2,$3)', [storeId, 'mayar', encryptConfig({ enabled: false, mode: 'sandbox', apiKey: 'test-mayar' }, `${storeId}:mayar`)]);
    await enqueue();
  }
  it('memakai Mayar untuk order asal Mayar meski sudah dinonaktifkan untuk order baru', async () => {
    await mayarGateway();
    const mock = vi.spyOn(mayar, 'detailTransaksi').mockResolvedValue({ id: trx, paymentLink: { id: ref }, amount: 10000, status: 'unpaid', expirationDate: Date.now() + 3600000 });
    await processReminders(db);
    expect(send).toHaveBeenCalledOnce(); expect(mock).toHaveBeenCalledOnce(); expect(payment).not.toHaveBeenCalled();
  });
  it.each(['paid', 'expired', 'closed', 'unknown'])('tidak mengirim reminder untuk status %s', async status => {
    await mayarGateway(); vi.spyOn(mayar, 'detailTransaksi').mockResolvedValue({ id: trx, paymentLink: { id: ref }, amount: 10000, status, expirationDate: Date.now() + 3600000 });
    await processReminders(db); expect(send).not.toHaveBeenCalled(); expect((await rows())[0].status).toBe('skipped');
  });
  it('API Mayar gagal atau nominal berbeda tidak mengirim reminder', async () => {
    await mayarGateway(); vi.spyOn(mayar, 'detailTransaksi').mockResolvedValue({ id: trx, paymentLink: { id: ref }, amount: 1, status: 'unpaid' });
    await processReminders(db); expect(send).not.toHaveBeenCalled(); expect((await rows())[0].status).toBe('failed');
  });
});
