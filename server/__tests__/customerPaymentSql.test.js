import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { customerPayment } from '../integrasi/customerPayment.js';
import { encryptConfig } from '../integrasi/settings.js';
import * as mayar from '../integrasi/mayar.js';
import * as tripay from '../integrasi/tripay.js';
const storeId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const customerId = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const orderId = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
const ref = 'dddddddd-dddd-4ddd-dddd-dddddddddddd';
const trx = 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee';
const args = { storeId, customerId, orderId };
let db, detail;
beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(`create table orders (id uuid primary key,store_id uuid,customer_id uuid,order_number text,
    payment_provider text,payment_mode text,payment_channel text,payment_reference text,payment_transaction_id text,
    payment_amount numeric,payment_status text,order_status text,payment_expires_at timestamptz,payment_checked_at timestamptz,
    payment_url text,paid_amount numeric,settled_at timestamptz,total numeric,shipping_cost numeric);
    create table store_integrations (store_id uuid,provider text,config_encrypted text);`);
  await db.exec(await fs.readFile(new URL('../migrations/053_inline_payment.sql', import.meta.url),'utf8'));
  await db.exec(await fs.readFile(new URL('../migrations/061_tripay_direct.sql', import.meta.url),'utf8'));
}, 30000);
beforeEach(async () => {
  vi.stubEnv('INTEGRATION_SECRET','isolated-payment-page');
  await db.exec('truncate orders,store_integrations');
  await db.query(`insert into orders(id,store_id,customer_id,order_number,payment_provider,payment_mode,payment_channel,payment_reference,
    payment_transaction_id,payment_amount,payment_status,order_status,payment_expires_at,payment_url,paid_amount,total,shipping_cost,payment_instructions)
    values ($1,$2,$3,'WEB-PAGE','mayar','sandbox','VA/BNI',$4,$5,10000,'unpaid','awaiting_confirmation',now()+interval '1 hour','https://merchant.myr.id/pl/order',0,10000,0,$6::jsonb)`,
    [orderId,storeId,customerId,ref,trx,JSON.stringify({kind:'va',bank:'BNI',pay_code:'001234567890'})]);
  await db.query('insert into store_integrations values ($1,$2,$3)',[storeId,'mayar',encryptConfig({mode:'sandbox',apiKey:'test-api'},`${storeId}:mayar`)]);
  detail = vi.spyOn(mayar,'detailTransaksi').mockResolvedValue({id:trx,paymentLink:{id:ref},amount:10000,status:'unpaid',expirationDate:Date.now()+3600000});
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs()});
afterAll(async()=>db?.close());
describe('Pembayaran checkout milik customer',()=>{
  it('pemilik dapat memuat ulang instruksi tersimpan tanpa membuat tagihan baru',async()=>{
    const create = vi.spyOn(mayar,'buatTransaksi');
    const result = await customerPayment(db,args);
    expect(result).toMatchObject({order_number:'WEB-PAGE',status:'unpaid',amount:10000,instructions:{pay_code:'001234567890'}});
    await customerPayment(db,args);
    expect(create).not.toHaveBeenCalled();expect(detail).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain('test-api');expect(result.customer_id).toBeUndefined();
  });
  it('customer atau tenant berbeda tidak dapat membaca kode maupun memicu request penyedia',async()=>{
    await expect(customerPayment(db,{...args,customerId:storeId})).rejects.toMatchObject({status:404});
    await expect(customerPayment(db,{...args,storeId:customerId})).rejects.toMatchObject({status:404});
    expect(detail).not.toHaveBeenCalled();
  });
  it('lunasan terverifikasi menyembunyikan kode dan link bayar',async()=>{
    detail.mockResolvedValue({id:trx,paymentLink:{id:ref},amount:10000,status:'paid'});
    const result=await customerPayment(db,args);
    expect(result).toMatchObject({status:'paid',instructions:null,checkout_url:null});
  });
  it('kedaluwarsa menyembunyikan kode tanpa mengasumsikan uang sudah diterima',async()=>{
    await db.exec("update orders set payment_expires_at=now()-interval '1 second'");
    const result=await customerPayment(db,args);
    expect(result).toMatchObject({status:'expired',instructions:null,checkout_url:null});
  });
  it('kegagalan API tidak menjadi status lunas dan tidak menghilangkan instruksi tersimpan',async()=>{
    detail.mockRejectedValue(new Error('upstream-secret'));
    const result=await customerPayment(db,args);
    expect(result.status).toBe('unpaid');expect(result.warning).toMatch(/belum dapat/);expect(result.instructions.kind).toBe('va');
    expect(JSON.stringify(result)).not.toContain('upstream-secret');
  });
  it('link javascript tidak diteruskan ke customer',async()=>{
    await db.exec("update orders set payment_instructions=null,payment_url='javascript:alert(1)'");
    expect((await customerPayment(db,args)).checkout_url).toBeNull();
  });
  it('dua pemeriksaan serentak tidak membanjiri Mayar',async()=>{
    await Promise.all([customerPayment(db,args),customerPayment(db,args)]);
    expect(detail).toHaveBeenCalledOnce();
  });
});

describe('Invoice Tripay DIRECT', () => {
  let tripayDetail;
  const payload = { reference: ref, merchant_ref: 'WEB-PAGE', payment_method: 'BCAVA', amount: 11500, fee_customer: 1500, status: 'UNPAID', expired_time: 2000000000 };
  beforeEach(async () => {
    await db.query(`update orders set payment_provider='tripay',payment_channel='BCAVA',payment_transaction_id=null,payment_details=$1::jsonb`, [JSON.stringify({checkout_mode:'direct',channel_name:'BCA Virtual Account',amount:11500,pay_code:'001234567890',instructions:[{title:'ATM',steps:['Bayar VA']} ]})]);
    await db.query('insert into store_integrations values ($1,$2,$3)',[storeId,'tripay',encryptConfig({mode:'sandbox',apiKey:'test-tripay'},`${storeId}:tripay`)]);
    tripayDetail = vi.spyOn(tripay,'detailTransaksi').mockResolvedValue(payload);
  });
  it('menampilkan total termasuk biaya, tanpa link keluar, dan polling dibatasi', async () => {
    const result = await customerPayment(db,args);
    expect(result).toMatchObject({provider:'tripay',status:'unpaid',amount:11500,base_amount:10000,checkout_url:null,instructions:{kind:'va',pay_code:'001234567890'},steps:[{title:'ATM',steps:['Bayar VA']}]});
    await customerPayment(db,args); expect(tripayDetail).toHaveBeenCalledOnce();
  });
  it('API terverifikasi melunasi dan menyembunyikan seluruh instruksi bayar', async () => {
    tripayDetail.mockResolvedValue({...payload,status:'PAID'});
    expect(await customerPayment(db,args)).toMatchObject({status:'paid',instructions:null,steps:[],checkout_url:null});
    expect(Number((await db.query('select paid_amount from orders')).rows[0].paid_amount)).toBe(10000);
  });
  it.each([{amount:1}, {reference:'WRONG'}, {payment_method:'QRIS'}])('data provider tidak cocok tidak melunasi: %j', async patch => {
    tripayDetail.mockResolvedValue({...payload,status:'PAID',...patch});
    expect(await customerPayment(db,args)).toMatchObject({status:'unpaid',warning:expect.any(String)});
  });
  it('akun lain tidak membaca invoice atau memanggil provider', async () => {
    await expect(customerPayment(db,{...args,customerId:storeId})).rejects.toMatchObject({status:404});
    await expect(customerPayment(db,{...args,storeId:customerId})).rejects.toMatchObject({status:404});
    expect(tripayDetail).not.toHaveBeenCalled();
  });
  it('invoice kadaluwarsa tidak menampilkan kode dan QRIS', async () => {
    await db.exec("update orders set payment_expires_at=now()-interval '1 second'");
    expect(await customerPayment(db,args)).toMatchObject({status:'expired',instructions:null,steps:[]});
  });
  it('Tripay REDIRECT lama tidak berubah menjadi invoice DIRECT', async () => {
    await db.exec("update orders set payment_details=null");
    await expect(customerPayment(db,args)).rejects.toMatchObject({status:404});
  });
});
