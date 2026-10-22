import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptConfig } from '../integrasi/settings.js';
import { selectedGateway, selectGateway, readPayment, syncPayment, reconcilePayments, handleMayarWebhook } from '../integrasi/payments.js';
import * as mayar from '../integrasi/mayar.js';
import * as tripay from '../integrasi/tripay.js';
const storeId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const otherStore = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const orderId = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
const ref = 'dddddddd-dddd-4ddd-dddd-dddddddddddd';
const trx = 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee';
let db, detail;
const order = async () => (await db.query('select * from orders where id = $1', [orderId])).rows[0];
const payload = (patch = {}) => ({ id: trx, paymentLink: { id: ref }, amount: 10000, status: 'paid', expirationDate: Date.now() + 3600000, ...patch });
beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(`create table stores (id uuid primary key);
    create table store_integrations (store_id uuid, provider text, config_encrypted text, constraint store_integrations_provider_check check(provider in ('tripay')), primary key(store_id,provider));
    create table orders (id uuid primary key, store_id uuid, order_number text, total numeric, shipping_cost numeric,
      payment_channel text, payment_reference text, payment_url text, payment_status text, order_status text, paid_amount numeric, settled_at timestamptz, created_at timestamptz default now());`);
  await db.exec(await fs.readFile(new URL('../migrations/052_payment_gateways.sql', import.meta.url), 'utf8'));
}, 30000);
beforeEach(async () => {
  vi.stubEnv('INTEGRATION_SECRET', 'payment-isolated-test');
  await db.exec('truncate orders, store_integrations, store_payment_settings, stores cascade');
  await db.query('insert into stores values ($1),($2)', [storeId, otherStore]);
  for (const provider of ['tripay', 'mayar']) await db.query('insert into store_integrations values ($1,$2,$3)', [storeId, provider, encryptConfig({ enabled: true, mode: 'sandbox', apiKey: 'test-only', privateKey: 'test-only', merchantCode: 'T001' }, `${storeId}:${provider}`)]);
  await db.query(`insert into orders(id,store_id,order_number,total,shipping_cost,payment_channel,payment_reference,payment_provider,
    payment_mode,payment_amount,payment_transaction_id,payment_expires_at,payment_status,order_status,paid_amount)
    values ($1,$2,'WEB-TEST',15000,5000,'MAYAR',$3,'mayar','sandbox',10000,$4,now()+interval '1 hour','unpaid','awaiting_confirmation',0)`, [orderId, storeId, ref, trx]);
  detail = vi.spyOn(mayar, 'detailTransaksi').mockResolvedValue(payload());
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
afterAll(async () => db?.close());
describe('Verifikasi pembayaran dan migrasi SQL', () => {
  it('default Tripay, satu pilihan per toko, manual eksplisit, tanpa menghapus kunci lama', async () => {
    vi.spyOn(mayar, 'daftarKanal').mockResolvedValue([{ active: true }]);
    expect(await selectedGateway(db, storeId)).toBe('tripay');
    await selectGateway(db, storeId, 'mayar'); expect(await selectedGateway(db, storeId)).toBe('mayar');
    expect(await selectedGateway(db, otherStore)).toBe('tripay');
    await selectGateway(db, storeId, 'manual'); expect(await selectedGateway(db, storeId)).toBe('manual');
    expect((await db.query('select * from store_payment_settings')).rows).toHaveLength(1);
    expect((await db.query('select * from store_integrations')).rows).toHaveLength(2);
  });
  it('gagal tes kanal tidak mengganti gateway', async () => {
    vi.spyOn(mayar, 'daftarKanal').mockRejectedValue(new Error('unavailable'));
    await expect(selectGateway(db, storeId, 'mayar')).rejects.toThrow();
    expect(await selectedGateway(db, storeId)).toBe('tripay');
  });
  it('webhook palsu berstatus PAID tidak melunasi jika API masih unpaid', async () => {
    detail.mockResolvedValue(payload({ status: 'unpaid' }));
    await handleMayarWebhook(db, { event: 'payment.received', data: { transactionId: trx, status: 'PAID', amount: 10000 } });
    expect((await order()).payment_status).toBe('unpaid');
  });
  it('melunasi nominal saat checkout tanpa ongkir tambahan, tetap berjalan setelah pindah gateway', async () => {
    await selectGateway(db, storeId, 'manual');
    await handleMayarWebhook(db, { event: 'payment.received', data: { transactionId: trx, amount: 1 } });
    const result = await order(); expect(result.payment_status).toBe('paid'); expect(Number(result.paid_amount)).toBe(10000);
    expect(result.order_status).toBe('awaiting_confirmation'); expect(result.settled_at).toBeTruthy();
    await handleMayarWebhook(db, { event: 'payment.received', data: { transactionId: trx } });
    expect(detail).toHaveBeenCalledOnce();
  });
  it('dua webhook bersamaan hanya memverifikasi satu kali', async () => {
    const body = { event: 'payment.received', data: { transactionId: trx } };
    await Promise.all([handleMayarWebhook(db, body), handleMayarWebhook(db, body)]);
    expect(detail).toHaveBeenCalledOnce(); expect((await order()).payment_status).toBe('paid');
  });
  it.each([{ amount: 9999 }, { id: ref }, { paymentLink: { id: trx } }])('menolak data API tidak cocok %j', async patch => {
    detail.mockResolvedValue(payload(patch));
    await expect(syncPayment(db, await order())).rejects.toThrow(/tidak sesuai/);
    expect((await order()).payment_status).toBe('unpaid');
  });
  it('webhook ID toko lain tidak bisa mengubah pesanan', async () => {
    await handleMayarWebhook(db, { event: 'payment.received', data: { transactionId: crypto.randomUUID(), productId: ref, amount: 10000 } });
    expect(detail).not.toHaveBeenCalled(); expect((await order()).payment_status).toBe('unpaid');
  });
  it('callback datang sebelum referensi tersimpan dipulihkan oleh pemeriksaan berkala', async () => {
    await db.exec('update orders set payment_reference = null, payment_transaction_id = null');
    await handleMayarWebhook(db, { event: 'payment.received', data: { transactionId: trx } });
    expect(detail).not.toHaveBeenCalled();
    await db.query('update orders set payment_reference = $1, payment_transaction_id = $2', [ref,trx]);
    await reconcilePayments(db); expect((await order()).payment_status).toBe('paid');
  });
  it('API gagal tidak melunasi atau dibanjiri retry oleh worker', async () => {
    detail.mockRejectedValue(new Error('unavailable'));
    await reconcilePayments(db); await reconcilePayments(db);
    expect(detail).toHaveBeenCalledOnce(); expect((await order()).payment_status).toBe('unpaid');
  });
  it('status closed tidak menurunkan pembayaran yang sudah lunas', async () => {
    await syncPayment(db, await order());
    detail.mockResolvedValue(payload({ status: 'closed' })); await syncPayment(db, await order());
    expect((await order()).payment_status).toBe('paid'); expect((await order()).order_status).toBe('awaiting_confirmation');
  });
  it('status expired membatalkan pesanan belum dikonfirmasi', async () => {
    detail.mockResolvedValue(payload({ status: 'expired' })); await syncPayment(db, await order());
    expect((await order()).order_status).toBe('canceled'); expect((await order()).payment_status).toBe('unpaid');
  });
  it('mode berubah menghentikan pemeriksaan tanpa menghubungi host mode lain', async () => {
    await db.exec("update orders set payment_mode = 'production'");
    await expect(readPayment(db, await order())).rejects.toThrow(/Mode pembayaran berubah/); expect(detail).not.toHaveBeenCalled();
  });
  it('memulihkan Tripay dari API dengan nominal asli dan biaya pelanggan', async () => {
    await db.exec("update orders set payment_provider = 'tripay', payment_channel = 'BRIVA'");
    const spy = vi.spyOn(tripay, 'detailTransaksi').mockResolvedValue({ reference: ref, merchant_ref: 'WEB-TEST', payment_method: 'BRIVA', amount: 14250, fee_customer: 4250, status: 'PAID' });
    await reconcilePayments(db); expect(spy).toHaveBeenCalledOnce(); expect((await order()).payment_status).toBe('paid');
    expect(Number((await order()).paid_amount)).toBe(10000);
  });
  it('Tripay nominal tidak cocok gagal tertutup', async () => {
    await db.exec("update orders set payment_provider = 'tripay', payment_channel = 'BRIVA'");
    vi.spyOn(tripay, 'detailTransaksi').mockResolvedValue({ reference: ref, merchant_ref: 'WEB-TEST', payment_method: 'BRIVA', amount: 9999, fee_customer: 0, status: 'PAID' });
    await expect(syncPayment(db, await order())).rejects.toThrow(/nominal/); expect((await order()).payment_status).toBe('unpaid');
  });
});
