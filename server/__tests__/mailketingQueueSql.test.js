import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';
let db;
const store = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const other = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const customer = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
const product = 'dddddddd-dddd-4ddd-dddd-dddddddddddd';
const order = 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee';
beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(`create table stores(id uuid primary key);
    create table customers(id uuid primary key,store_id uuid,email text,name text,phone text);
    create table products(id uuid primary key,store_id uuid);
    create table orders(id uuid primary key,store_id uuid,customer_id uuid,order_status text,customer_name text,customer_phone text);
    create table order_items(id uuid default gen_random_uuid(),order_id uuid,product_id uuid);`);
  await db.exec(await fs.readFile(new URL('../migrations/060_product_mailketing.sql', import.meta.url), 'utf8'));
}, 30000);
beforeEach(async () => {
  await db.exec('truncate stores,customers,products,orders,order_items cascade');
  await db.query('insert into stores values ($1),($2)', [store, other]);
  await db.query("insert into customers values ($1,$2,' Buyer@example.test ','Nama Akun','0812')", [customer, store]);
  await db.query('insert into products values ($1,$2,12,25)', [product, store]);
  await db.query("insert into orders values ($1,$2,$3,'awaiting_confirmation','Penerima','081234')", [order, store, customer]);
});
afterAll(async () => db?.close());
const add = () => db.query('insert into order_items(order_id,product_id) values ($1,$2)', [order, product]);
const jobs = async () => (await db.query('select event,list_id,email,name,phone from mailketing_subscriptions order by list_id')).rows;
it('pesanan dan selesai memilih list berbeda, email dinormalisasi dan event tidak berulang', async () => {
  await add(); await add();
  expect(await jobs()).toEqual([{ event: 'order', list_id: 12, email: 'buyer@example.test', name: 'Penerima', phone: '081234' }]);
  await db.exec("update orders set order_status='done'");
  await db.exec("update orders set order_status='processing'");
  await db.exec("update orders set order_status='done'");
  expect((await jobs()).map(j => [j.event,j.list_id])).toEqual([['order',12],['complete',25]]);
});
it('checkout yang rollback tidak menyisakan antrean', async () => {
  await db.exec('begin'); await add(); await db.exec('rollback'); expect(await jobs()).toEqual([]);
});
it('pesanan POS langsung selesai tetap menghasilkan kedua tahap', async () => {
  await db.exec("update orders set order_status='done'"); await add(); expect(await jobs()).toHaveLength(2);
});
it('produk toko lain, pelanggan toko lain, email kosong dan pesanan batal tidak dikirim', async () => {
  await db.query('update products set store_id=$1', [other]); await add(); expect(await jobs()).toEqual([]);
  await db.query('update products set store_id=$1', [store]);
  await db.query('update customers set store_id=$1', [other]); await add(); expect(await jobs()).toEqual([]);
  await db.query("update customers set store_id=$1,email=''", [store]); await add(); expect(await jobs()).toEqual([]);
  await db.exec("update customers set email='buyer@example.test'; update orders set order_status='canceled'"); await add(); expect(await jobs()).toEqual([]);
});
it('mengosongkan list menonaktifkan sinkronisasi produk', async () => {
  await db.exec('update products set mailketing_order_list_id=null,mailketing_complete_list_id=null');
  await add(); await db.exec("update orders set order_status='done'"); expect(await jobs()).toEqual([]);
});
