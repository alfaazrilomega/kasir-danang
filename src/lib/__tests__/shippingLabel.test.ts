import { describe, expect, it } from 'vitest';
import { buildShippingLabelHTML, shippingTarget } from '@/lib/receipt';
import { channelTone } from '@/lib/channels';
import type { Customer, Order, OrderItem, Store } from '@/types';

// Butir 16 dan 17 PERMINTAAN-CLIENT.md: label alamat pengiriman dan channel di
// daftar Riwayat Transaksi.

const order = (isi: Partial<Order> = {}): Order =>
  ({
    id: 'o1',
    order_number: 'WEB-UJI-1',
    created_at: '2026-10-03T03:00:00.000Z',
    customer_id: null,
    customer_name: null,
    customer_phone: null,
    delivery_address: null,
    delivery_city: null,
    delivery_province: null,
    notes: null,
    ...isi,
  }) as Order;

const pelanggan = (isi: Partial<Customer> = {}): Customer =>
  ({
    id: 'c1',
    name: 'Bengkel Aldo',
    phone: '081277770001',
    address: 'Jl. Melati No. 7, Purwokerto Selatan',
    address_city: 'Kabupaten Banyumas',
    address_province: 'Jawa Tengah',
    ...isi,
  }) as Customer;

describe('shippingTarget', () => {
  it('alamat kirim pesanan menang atas alamat utama pelanggan', () => {
    const t = shippingTarget(order({ delivery_address: 'Jl. Kenanga 1, Kota Surabaya', customer_phone: '0811' }), pelanggan());
    expect(t?.address).toBe('Jl. Kenanga 1, Kota Surabaya');
    expect(t?.phone).toBe('0811');
    expect(t?.name).toBe('Bengkel Aldo');
  });

  it('pesanan toko online oleh akun: penerima yang diketik di checkout menang atas nama dan telepon akun', () => {
    // Pembeli boleh mengirim ke orang lain; label harus menyebut penerimanya.
    const t = shippingTarget(
      order({ customer_id: 'c1', customer_name: 'Bengkel Jaya Motor', customer_phone: '0899', delivery_address: 'Jl. Bengkel 3, Kota Malang' }),
      pelanggan({ name: 'Budi Santoso', phone: '0811' }),
    );
    expect(t?.name).toBe('Bengkel Jaya Motor');
    expect(t?.phone).toBe('0899');
  });

  it('alamat dari pelanggan: nama dan telepon pelanggan yang dipakai, walau pesanan menyimpan nama lain', () => {
    const t = shippingTarget(order({ customer_id: 'c1', customer_name: 'Nama ketikan kasir', customer_phone: '0899' }), pelanggan());
    expect(t?.name).toBe('Bengkel Aldo');
    expect(t?.phone).toBe('081277770001');
  });

  it('pesanan tanpa alamat kirim memakai alamat utama pelanggan beserta kota dan provinsinya', () => {
    const t = shippingTarget(order(), pelanggan());
    expect(t?.address).toBe('Jl. Melati No. 7, Purwokerto Selatan');
    expect(t?.region).toBe('Kabupaten Banyumas, Jawa Tengah');
    expect(t?.phone).toBe('081277770001');
  });

  it('kota atau provinsi yang sudah tertulis di alamat tidak diulang, yang belum tetap ditulis', () => {
    const t = shippingTarget(order({ delivery_address: 'Jl janoko No. 5, kabupaten banyumas', delivery_city: 'Kabupaten Banyumas', delivery_province: 'Jawa Tengah' }));
    expect(t?.region).toBe('Jawa Tengah');
  });

  it('tanpa alamat di pesanan maupun pelanggan berarti tidak ada label', () => {
    expect(shippingTarget(order({ customer_name: 'Walk-in' }))).toBeNull();
    expect(shippingTarget(order(), pelanggan({ address: '   ' }))).toBeNull();
  });

  it('nama penerima: pelanggan tertaut, lalu nama yang diketik di pesanan, lalu "Penerima"', () => {
    expect(shippingTarget(order({ delivery_address: 'Jl. A', customer_name: 'Nanang' }))?.name).toBe('Nanang');
    expect(shippingTarget(order({ delivery_address: 'Jl. A' }))?.name).toBe('Penerima');
  });
});

describe('buildShippingLabelHTML', () => {
  const store = { id: 's1', name: 'GNNK Racing', currency: 'IDR', address: 'Jl. Raya Industri No. 45' } as Store;
  const items = [{ id: 'i1', order_id: 'o1', product_id: 'p1', name: 'Gear <b>Set</b>', size: null, qty: 2, price: 655000, note: null }] as OrderItem[];

  it('isian pembeli dan nama barang ditulis sebagai teks, bukan HTML', () => {
    const o = order({ delivery_address: '<img src=x onerror=alert(1)>', customer_name: '"><script>alert(1)</script>', notes: '<i>pelan</i>' });
    const html = buildShippingLabelHTML({ store, order: o, items, target: shippingTarget(o)! });
    const badan = html.replace(/<script>\s*window\.addEventListener[\s\S]*?<\/script>/, '');
    expect(badan).not.toMatch(/<img src=x|<script>alert|<i>pelan|<b>Set/);
    expect(badan).toContain('&lt;img src=x');
    expect(badan).toContain('&lt;b&gt;Set&lt;/b&gt;');
  });

  it('label tanpa harga dan berukuran 100 x 150 mm', () => {
    const o = order({ delivery_address: 'Jl. A' });
    const html = buildShippingLabelHTML({ store, order: o, items, target: shippingTarget(o)! });
    expect(html).toMatch(/@page \{ size: 100mm 150mm/);
    expect(html).not.toMatch(/Rp|655\.000/);
  });
});

describe('channelTone', () => {
  it('channel buatan toko ikut warna keluarga platformnya', () => {
    expect(channelTone('shopee-gnnk-1')).toBe(channelTone('shopee'));
    expect(channelTone('tiktok-gnnk-2')).toBe(channelTone('tiktok'));
    expect(channelTone('shopee')).not.toBe(channelTone('tiktok'));
  });

  it('channel kosong atau tak dikenal memakai warna netral', () => {
    expect(channelTone(null)).toBe('neutral');
    expect(channelTone('offline')).toBe('neutral');
    expect(channelTone('miaw')).toBe('neutral');
  });
});
