import { describe, expect, it } from 'vitest';
import { bulatkanRincian, hitungHppNota, hppPenuhProduk } from '@/lib/hppNota';
import type { Expense, Purchase, PurchaseItem } from '@/types';

// Butir 13 PERMINTAAN-CLIENT.md: "Jadi nanti ongkos kirimnya itu menambahkan
// dari si harga barang. Jadi HPP-nya itu bisa full … terperinci secara
// otomatis dari biaya pengiriman sama biaya pengurusan lain-lain sama juga
// biaya packaging".

const nota = (isi: Partial<Purchase> = {}): Purchase =>
  ({
    id: 'n1',
    store_id: 's1',
    supplier_id: null,
    invoice_number: 'PO-UJI-001',
    status: 'received',
    order_date: '2026-09-01',
    expected_date: null,
    due_date: null,
    subtotal: 2000000,
    discount: 0,
    tax: 0,
    other_cost: 0,
    total: 2000000,
    paid_amount: 0,
    dp_percent: 0,
    currency: 'IDR',
    exchange_rate: 1,
    received_at: '2026-09-10T00:00:00.000Z',
    notes: null,
    created_by: null,
    ...isi,
  }) as Purchase;

const baris = (id: string, harga: number, qty: number, diterima = qty, productId: string | null = id): PurchaseItem =>
  ({
    id,
    purchase_id: 'n1',
    product_id: productId,
    name: 'Barang ' + id,
    sku: id,
    qty,
    received_qty: diterima,
    cost_price: harga,
    subtotal: harga * qty,
    note: null,
  }) as PurchaseItem;

const biaya = (id: string, jumlah: number, isi: Partial<Expense> = {}): Expense =>
  ({
    id,
    store_id: 's1',
    category: 'transport',
    description: 'Biaya ' + id,
    amount: jumlah,
    expense_date: '2026-09-20',
    payment_method: 'transfer',
    shift_id: null,
    created_by: null,
    purchase_id: 'n1',
    purchase_cost_slot: null,
    ...isi,
  }) as Expense;

describe('hitungHppNota', () => {
  it('membagi biaya sesuai nilai barang dan mengurangi bagian diskon', () => {
    // A 10 x 100.000, B 5 x 200.000 -> nilai barang 2.000.000.
    // Biaya 400.000, diskon 100.000 -> tambahan bersih 15%.
    const hpp = hitungHppNota(
      nota({ discount: 100000 }),
      [baris('A', 100000, 10), baris('B', 200000, 5)],
      [biaya('x', 220000), biaya('y', 100000), biaya('z', 50000, { purchase_cost_slot: 'other' }), biaya('w', 30000, { purchase_cost_slot: 'extra' })],
    );
    expect(hpp.totalBiaya).toBe(400000);
    expect(hpp.faktor).toBeCloseTo(0.15, 10);
    expect(Math.round(hpp.barang[0].hppPenuh)).toBe(115000);
    expect(Math.round(hpp.barang[1].hppPenuh)).toBe(230000);
  });

  it('nota tanpa baris pengeluaran untuk biaya formnya tetap menghitung biaya itu', () => {
    const hpp = hitungHppNota(nota({ other_cost: 50000, extra_cost: 30000 }), [baris('A', 100000, 20)], []);
    expect(hpp.biaya.map((b) => b.jumlah).sort()).toEqual([30000, 50000]);
    expect(Math.round(hpp.barang[0].hppPenuh)).toBe(104000);
  });

  it('biaya form yang sudah punya baris pengeluaran tidak dihitung dua kali', () => {
    const hpp = hitungHppNota(nota({ other_cost: 50000 }), [baris('A', 100000, 20)], [
      biaya('z', 50000, { purchase_cost_slot: 'other' }),
    ]);
    expect(hpp.totalBiaya).toBe(50000);
  });

  it('barang yang tidak datang dan barang tanpa harga beli tidak menanggung biaya', () => {
    const hpp = hitungHppNota(
      nota(),
      [baris('A', 100000, 10), baris('B', 200000, 5), baris('G', 0, 20, 20, null), baris('T', 100000, 5, 0, null)],
      [biaya('x', 200000)],
    );
    // Nilai barang yang diterima 2.000.000, jadi tambahan 10%.
    expect(Math.round(hpp.barang[0].hppPenuh)).toBe(110000);
    expect(hpp.barang[2].rincian).toEqual([]);
    expect(hpp.barang[2].hppPenuh).toBe(0);
    expect(hpp.barang[3].tidakDiterima).toBe(true);
    expect(hpp.barang[3].rincian).toEqual([]);
  });

  it('nota bernilai nol tidak menghasilkan NaN', () => {
    const hpp = hitungHppNota(nota(), [baris('G', 0, 5)], [biaya('x', 50000)]);
    expect(hpp.faktor).toBe(0);
    expect(Number.isFinite(hpp.barang[0].hppPenuh)).toBe(true);
  });
});

describe('bulatkanRincian', () => {
  it('jumlah bagian tertulis sama persis dengan selisih HPP dan harga beli', () => {
    // Angka dari temuan QC: 400.000 jadi 421.954,38; dibulatkan satu per satu
    // jumlahnya 421.955.
    const hpp = hitungHppNota(
      nota({ discount: 500000, subtotal: 77160000 }),
      [baris('A', 460000, 20), baris('B', 400000, 24), baris('C', 430000, 28), baris('D', 460000, 32), baris('E', 400000, 36), baris('F', 430000, 40)],
      [biaya('k', 3000000), biaya('t', 1250000), biaya('p', 400000), biaya('o', 55000), biaya('d', 30000)],
    );
    for (const b of hpp.barang) {
      const bulat = bulatkanRincian(b.rincian, Math.round(b.hppPenuh) - Math.round(b.hargaBeli));
      expect(b.hargaBeli + bulat.reduce((sum, n) => sum + n, 0)).toBe(Math.round(b.hppPenuh));
    }
  });

  it('rincian kosong tetap kosong', () => {
    expect(bulatkanRincian([], 0)).toEqual([]);
  });
});

describe('hppPenuhProduk', () => {
  it('memakai nota terakhir yang diterima dan melewati nota batal atau belum diterima', () => {
    const lama = nota({ id: 'lama', received_at: '2026-08-01T00:00:00.000Z' });
    const baru = nota({ id: 'baru', received_at: '2026-09-10T00:00:00.000Z' });
    const belum = nota({ id: 'belum', received_at: null, status: 'ordered' });
    const batal = nota({ id: 'batal', received_at: '2026-09-20T00:00:00.000Z', status: 'canceled' });
    const item = (purchase_id: string): PurchaseItem => ({ ...baris('A', 100000, 10), id: purchase_id + '-A', purchase_id });
    const peta = hppPenuhProduk(
      [lama, baru, belum, batal],
      [item('lama'), item('baru'), item('belum'), item('batal')],
      [
        biaya('1', 300000, { purchase_id: 'lama' }),
        biaya('2', 100000, { purchase_id: 'baru' }),
        biaya('3', 500000, { purchase_id: 'belum' }),
        biaya('4', 900000, { purchase_id: 'batal' }),
      ],
    );
    expect(peta.get('A')?.nota.id).toBe('baru');
    expect(peta.get('A')?.faktor).toBeCloseTo(0.1, 10);
  });
});
