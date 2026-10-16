import { describe, expect, it } from 'vitest';
import { buildInvoiceHTML } from '@/lib/receipt';
import type { Order, OrderItem, Store } from '@/types';

// Butir 14b PERMINTAAN-CLIENT.md: "di 2-digit SKU-nya lumayan banyak, 20-30-an.
// Disini bagian kiri ditambahkan nomor … Jadi, bisa pengecekan seperti itu."

const store = { id: 's1', name: 'GNNK Racing', currency: 'IDR', tax_rate: 10 } as Store;
const order = {
  id: 'o1',
  order_number: 'ORDER ALDO - 28 SEPT',
  created_at: '2026-09-28T13:10:00.000Z',
  subtotal: 0,
  tax: 0,
  discount: 0,
  total: 0,
  payment_method: 'cash',
  payment_status: 'unpaid',
} as Order;

function baris(n: number): OrderItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `i${i}`,
    order_id: 'o1',
    product_id: `p${i}`,
    name: `Gear Set Kawasaki Klx150 Blue ${i}`,
    size: null,
    qty: 10,
    price: 655000,
    note: null,
  })) as OrderItem[];
}

/** Isi sel pertama tiap baris badan tabel barang, urut seperti tercetak. */
function selPertama(html: string): string[] {
  const badan = /<tbody>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? '';
  return [...badan.matchAll(/<tr>\s*<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1].trim());
}

describe('faktur A4: nomor urut barang', () => {
  it('kolom paling kiri tabel barang berjudul No', () => {
    const html = buildInvoiceHTML({ store, order, items: baris(3) });
    const judul = /<thead><tr>([\s\S]*?)<\/tr><\/thead>/.exec(html)?.[1] ?? '';
    expect(/<th[^>]*>([^<]*)<\/th>/.exec(judul)?.[1]).toBe('No');
  });

  it('tiap baris bernomor 1 sampai jumlah barang, berurutan', () => {
    const html = buildInvoiceHTML({ store, order, items: baris(12) });
    expect(selPertama(html)).toEqual(Array.from({ length: 12 }, (_, i) => String(i + 1)));
  });

  it('barang diurutkan menurut SKU, bukan menurut id baris yang acak', () => {
    const items = baris(3);
    const sku = { p0: 'SETKLX-13-46-R', p1: 'SETCRF-11-46-R', p2: 'SETCRF-2-46-R' };
    const html = buildInvoiceHTML({ store, order, items, skuByProductId: sku });
    const badan = /<tbody>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? '';
    const urutanSku = [...badan.matchAll(/<td class="sku">([^<]*)<\/td>/g)].map((m) => m[1]);
    // Angka di tengah SKU dibandingkan sebagai angka: 2 sebelum 11.
    expect(urutanSku).toEqual(['SETCRF-2-46-R', 'SETCRF-11-46-R', 'SETKLX-13-46-R']);
    expect(selPertama(html)).toEqual(['1', '2', '3']);
  });

  it('total, tanda tangan, dan kaki faktur berada dalam satu blok yang tidak boleh terbelah halaman', () => {
    const html = buildInvoiceHTML({ store, order, items: baris(18) });
    const penutup = /<div class="penutup">([\s\S]*)<\/div>\s*<script>/.exec(html)?.[1] ?? '';
    expect(penutup).toContain('class="totals"');
    expect(penutup).toContain('class="sign"');
    expect(penutup).toContain('class="footer"');
    expect(html).toMatch(/\.penutup \{[^}]*break-inside: avoid/);
  });

  it('nomor tetap urut untuk 30 baris, jumlah yang client sebut', () => {
    const html = buildInvoiceHTML({ store, order, items: baris(30) });
    const nomor = selPertama(html);
    expect(nomor).toHaveLength(30);
    expect(nomor[29]).toBe('30');
  });
});
