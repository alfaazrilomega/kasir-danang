import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, beforeEach, afterAll, expect, it, vi } from 'vitest';
import { processMetaQueue, customerPurchases } from '../integrasi/metaConversions.js';
import { encryptConfig } from '../integrasi/settings.js';
let db;
const store = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const buyer = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const order = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
const pixel = '1234567890123456';
const send = vi.fn();
const config = { enabled: true, accessToken: 'test-private-token', apiVersion: 'v26.0', testEventCode: '' };
beforeAll(async () => {
  vi.stubEnv('INTEGRATION_SECRET', 'tracking-test-secret');
  db = await PGlite.create();
  await db.exec(`create table stores(id uuid primary key, meta_pixel_id text);
    create table store_integrations(store_id uuid,provider text,config_encrypted text);
    create table customers(id uuid primary key,store_id uuid,email text,phone text);
    create table orders(id uuid primary key,store_id uuid,customer_id uuid,payment_status text,sales_channel text,order_status text,payment_mode text,total numeric,shipping_cost numeric,tax numeric,order_number text,created_at timestamptz default now());
    create table order_items(id uuid default gen_random_uuid(),order_id uuid,product_id uuid,name text,qty numeric,price numeric);`);
  await db.exec(await fs.readFile(new URL('../migrations/062_tracking_conversions.sql', import.meta.url), 'utf8'));
}, 30000);
beforeEach(async () => {
  await db.exec('truncate stores,customers,store_integrations,orders,order_items cascade');
  await db.query('insert into stores(id,meta_pixel_id) values ($1,$2)', [store,pixel]);
  await db.query("insert into customers values ($1,$2,'buyer@example.test','08123456789')", [buyer,store]);
  await db.query("insert into orders(id,store_id,customer_id,payment_status,sales_channel,order_status,total,shipping_cost,tax,order_number,meta_tracking) values ($1,$2,$3,'unpaid','website','processing',270000,20000,10000,'WEB-1',$4)", [order,store,buyer,JSON.stringify({ pixelId: pixel,capi:true,clientIp:'203.0.113.1' })]);
  await db.query("insert into order_items(order_id,product_id,name,qty,price) values ($1,$1,'Gear',2,125000)", [order]);
  await db.query("insert into store_integrations values ($1,'meta_capi',$2)", [store,encryptConfig(config,`${store}:meta_capi`)]);
  send.mockReset().mockResolvedValue(undefined);
});
afterAll(async () => { await db?.close(); vi.unstubAllEnvs(); });
const paid = () => db.exec("update orders set payment_status='paid'");
const jobs = async () => (await db.query('select * from meta_capi_events')).rows;
it('queues paid website transition exactly once and keeps immutable purchase facts', async () => {
  expect(await jobs()).toEqual([]); await paid();
  const [first] = await jobs(); expect(first.purchase).toMatchObject({ nilai:240000,shipping:20000,tax:10000,idPesanan:order });
  await db.exec("update orders set total=1,payment_status='unpaid'; update orders set payment_status='paid'");
  expect(await jobs()).toHaveLength(1); expect((await jobs())[0].purchase).toEqual(first.purchase);
  await processMetaQueue(db,{send}); await processMetaQueue(db,{send});
  expect(send).toHaveBeenCalledTimes(1); expect(send.mock.calls[0][0]).toMatchObject({event_id:order,custom_data:{value:240000}});
  expect((await jobs())[0].processed_at).not.toBeNull();
  expect((await db.query('select meta_tracking from orders')).rows[0].meta_tracking).toBeNull();
});
it.each(["sales_channel='pos'","payment_mode='sandbox'","order_status='canceled'","meta_tracking=null"] )('does not enqueue %s', async patch => {
  await db.exec(`update orders set ${patch}`); await paid(); expect(await jobs()).toEqual([]);
});
it('rolls back jobs together with failed payments', async () => {
  await db.exec('begin'); await paid(); await db.exec('rollback'); expect(await jobs()).toEqual([]);
});
it('browser snapshots enforce tenant/customer ownership, paid state and recent window', async () => {
  await paid(); expect(await customerPurchases(db,{storeId:store,customerId:buyer})).toHaveLength(1);
  expect(await customerPurchases(db,{storeId:buyer,customerId:buyer})).toEqual([]);
  expect(await customerPurchases(db,{storeId:store,customerId:store})).toEqual([]);
  await db.exec("update orders set payment_status='unpaid'"); expect(await customerPurchases(db,{storeId:store,customerId:buyer})).toEqual([]);
  await paid(); await db.exec("update meta_capi_events set created_at=now()-interval '2 days'"); expect(await customerPurchases(db,{storeId:store,customerId:buyer})).toEqual([]);
});
it('retries safely without exposing credentials and stops after five failures', async () => {
  await paid(); send.mockRejectedValue(new Error('private-token URL?access_token=secret'));
  for(let i=0;i<5;i++) { await processMetaQueue(db,{send}); await db.exec("update meta_capi_events set next_attempt_at=now()-interval '1 second'"); }
  const [job]=await jobs(); expect(job.attempts).toBe(5); expect(job.processed_at).not.toBeNull(); expect(job.last_error).toBe('Pengiriman Meta CAPI gagal');
  await processMetaQueue(db,{send}); expect(send).toHaveBeenCalledTimes(5);
});
it('disabling CAPI or changing pixel stops pending deliveries', async () => {
  await paid(); await db.query('update stores set meta_pixel_id=$1',['99999999999999']);
  await processMetaQueue(db,{send}); expect(send).not.toHaveBeenCalled(); expect((await jobs())[0].processed_at).not.toBeNull();
});
it('without CAPI still exposes browser purchase, with no server delivery', async () => {
  await db.exec("update orders set meta_tracking='{\"capi\":false}'"); await paid();
  await processMetaQueue(db,{send}); expect(send).not.toHaveBeenCalled(); expect(await customerPurchases(db,{storeId:store,customerId:buyer})).toHaveLength(1);
});
it('retention strips attribution without losing tracking eligibility for delayed payments', async () => {
  await db.exec("update orders set created_at=now()-interval '8 days'"); await processMetaQueue(db,{send});
  const context=(await db.query('select meta_tracking from orders')).rows[0].meta_tracking;
  expect(context).toEqual({capi:true,pixelId:pixel}); await paid(); expect(await jobs()).toHaveLength(1);
});
