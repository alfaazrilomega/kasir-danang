// HPP penuh per barang di satu nota pembelian (butir 13 PERMINTAAN-CLIENT.md).
//
// Client mencatat biaya bertahap (kirim kontainer, gudang ke toko, kemasan,
// pengurusan) di Pengeluaran lalu menempelkannya ke nota. Biaya itu dibagi ke
// tiap barang sesuai nilai barangnya, jadi tiap pcs menanggung bagian yang
// sebanding dengan harga belinya: tambahan per pcs = biaya × harga beli /
// nilai barang nota. Diskon dan pajak nota dibagi dengan cara yang sama karena
// keduanya mengubah harga yang benar-benar dibayar untuk barang itu.
//
// HPP penuh adalah angka untuk menimbang harga jual. Ia sengaja tidak menimpa
// products.cost_price: biaya nota sudah dipotong sebagai pengeluaran di Laba
// Rugi, dan memasukkannya lagi ke HPP penjualan membuatnya terhitung dua kali.

import type { Expense, Purchase, PurchaseItem } from '@/types';
import { expenseCategoryLabel } from '@/lib/expenseCategories';

export interface BiayaNota {
  id: string;
  /** Keterangan pengeluaran, atau label kategorinya kalau keterangan kosong. */
  nama: string;
  kategori: string;
  tanggal: string;
  jumlah: number;
  /** 'form' = baris otomatis dari form nota, 'pengeluaran' = dicatat di layar Pengeluaran. */
  sumber: 'form' | 'pengeluaran';
}

export interface BagianPcs {
  nama: string;
  perPcs: number;
}

export interface HppBarang {
  item: PurchaseItem;
  /** Jumlah yang dihitung: jumlah diterima kalau barang sudah diterima. */
  qty: number;
  hargaBeli: number;
  rincian: BagianPcs[];
  hppPenuh: number;
  /** Nota sudah diterima tapi baris ini datang 0 pcs: tidak ada stok yang ber-HPP. */
  tidakDiterima: boolean;
}

export interface HppNota {
  biaya: BiayaNota[];
  totalBiaya: number;
  nilaiBarang: number;
  diskon: number;
  pajak: number;
  /** Tambahan bersih sebagai pecahan harga beli: (biaya − diskon + pajak) / nilai barang. */
  faktor: number;
  barang: HppBarang[];
}

/** Semua biaya yang menempel ke satu nota, urut tanggal. */
export function biayaNota(purchase: Purchase, expenses: Expense[]): BiayaNota[] {
  const milikNota = expenses.filter((e) => e.purchase_id === purchase.id);
  // Baris otomatis dari form nota berketerangan "Ongkir - nota PO-xxx". Di
  // dalam nota itu sendiri akhiran nomornya cuma pengulangan.
  const akhiran = ` - nota ${purchase.invoice_number}`;
  const daftar: BiayaNota[] = milikNota.map((e) => ({
    id: e.id,
    nama:
      (e.description?.trim().endsWith(akhiran)
        ? e.description.trim().slice(0, -akhiran.length).trim()
        : e.description?.trim()) || expenseCategoryLabel(e.category),
    kategori: e.category,
    tanggal: e.expense_date,
    jumlah: Number(e.amount || 0),
    sumber: e.purchase_cost_slot ? 'form' : 'pengeluaran',
  }));

  // Nota yang biaya formnya belum pernah dicerminkan ke Pengeluaran tetap
  // dihitung dari kolom notanya sendiri, supaya HPP-nya tidak diam-diam kurang.
  const slotAda = new Set(milikNota.map((e) => e.purchase_cost_slot).filter(Boolean));
  const slotNota = [
    {
      slot: 'other',
      jumlah: Number(purchase.other_cost || 0),
      nama: purchase.other_cost_label?.trim() || 'Biaya lain',
      kategori: purchase.other_cost_category || 'transport',
      tanggal: purchase.other_cost_date || purchase.order_date,
    },
    {
      slot: 'extra',
      jumlah: Number(purchase.extra_cost || 0),
      nama: purchase.extra_cost_label?.trim() || 'Biaya tambahan',
      kategori: purchase.extra_cost_category || 'perlengkapan',
      tanggal: purchase.extra_cost_date || purchase.order_date,
    },
  ];
  for (const s of slotNota) {
    if (slotAda.has(s.slot) || s.jumlah <= 0) continue;
    daftar.push({
      id: `${purchase.id}-${s.slot}`,
      nama: s.nama,
      kategori: s.kategori,
      tanggal: s.tanggal,
      jumlah: s.jumlah,
      sumber: 'form',
    });
  }

  return daftar.sort((a, b) => a.tanggal.localeCompare(b.tanggal));
}

export function hitungHppNota(purchase: Purchase, items: PurchaseItem[], expenses: Expense[]): HppNota {
  const biaya = biayaNota(purchase, expenses);
  const totalBiaya = biaya.reduce((sum, b) => sum + b.jumlah, 0);
  const qtyDihitung = (it: PurchaseItem) =>
    purchase.received_at ? Number(it.received_qty || 0) : Number(it.qty || 0);
  const nilaiBarang = items.reduce((sum, it) => sum + qtyDihitung(it) * Number(it.cost_price || 0), 0);
  const diskon = Number(purchase.discount || 0);
  const pajak = Number(purchase.tax || 0);
  const faktor = nilaiBarang > 0 ? (totalBiaya - diskon + pajak) / nilaiBarang : 0;

  const barang = items.map((item) => {
    const hargaBeli = Number(item.cost_price || 0);
    const qty = qtyDihitung(item);
    const tidakDiterima = !!purchase.received_at && qty <= 0;
    // Barang tanpa harga beli (bonus) dan barang yang tidak datang tidak ikut
    // menanggung biaya; rinciannya dikosongkan supaya tidak berisi deretan +0.
    const bagian = nilaiBarang > 0 && hargaBeli > 0 && !tidakDiterima ? hargaBeli / nilaiBarang : 0;
    const rincian: BagianPcs[] = [];
    if (bagian > 0) {
      for (const b of biaya) rincian.push({ nama: b.nama, perPcs: b.jumlah * bagian });
      if (diskon) rincian.push({ nama: 'Diskon nota', perPcs: -diskon * bagian });
      if (pajak) rincian.push({ nama: 'Pajak nota', perPcs: pajak * bagian });
    }
    const hppPenuh = hargaBeli + rincian.reduce((sum, r) => sum + r.perPcs, 0);
    return { item, qty, hargaBeli, rincian, hppPenuh, tidakDiterima };
  });

  return { biaya, totalBiaya, nilaiBarang, diskon, pajak, faktor, barang };
}

/**
 * Bagian per pcs dibulatkan ke rupiah sehingga jumlahnya sama persis dengan
 * selisih HPP penuh dan harga beli yang tertulis. Dibulatkan satu per satu,
 * jumlahnya bisa meleset Rp 1 dari angka HPP di sebelahnya, dan pembaca yang
 * menjumlahkan sendiri menganggap hitungannya salah. Selisihnya diberikan ke
 * bagian yang paling banyak tergeser oleh pembulatan.
 */
export function bulatkanRincian(rincian: BagianPcs[], target: number): number[] {
  const bulat = rincian.map((r) => Math.round(r.perPcs));
  let selisih = Math.round(target) - bulat.reduce((sum, n) => sum + n, 0);
  if (!rincian.length || selisih === 0) return bulat;
  const naik = selisih > 0;
  const urutan = rincian
    .map((r, i) => ({ i, sisa: r.perPcs - bulat[i] }))
    .sort((a, b) => (naik ? b.sisa - a.sisa : a.sisa - b.sisa));
  for (let k = 0; selisih !== 0; k = (k + 1) % urutan.length) {
    bulat[urutan[k].i] += naik ? 1 : -1;
    selisih += naik ? -1 : 1;
  }
  return bulat;
}

export interface HppProduk {
  /** Pecahan tambahan dari nota terakhir; HPP penuh = modal × (1 + faktor). */
  faktor: number;
  nota: Purchase;
}

/**
 * Faktor HPP penuh tiap produk, diambil dari nota terakhir yang barangnya
 * sudah diterima — itulah nota yang stoknya sedang dijual.
 */
export function hppPenuhProduk(
  purchases: Purchase[],
  items: PurchaseItem[],
  expenses: Expense[],
): Map<string, HppProduk> {
  const itemsByPurchase = new Map<string, PurchaseItem[]>();
  for (const it of items) {
    const list = itemsByPurchase.get(it.purchase_id) ?? [];
    list.push(it);
    itemsByPurchase.set(it.purchase_id, list);
  }
  const expensesByPurchase = new Map<string, Expense[]>();
  for (const e of expenses) {
    if (!e.purchase_id) continue;
    const list = expensesByPurchase.get(e.purchase_id) ?? [];
    list.push(e);
    expensesByPurchase.set(e.purchase_id, list);
  }

  const diterima = purchases
    .filter((p) => p.received_at && p.status !== 'canceled')
    .sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)));

  const hasil = new Map<string, HppProduk>();
  for (const p of diterima) {
    const milik = itemsByPurchase.get(p.id) ?? [];
    if (!milik.some((it) => it.product_id && !hasil.has(it.product_id))) continue;
    const hpp = hitungHppNota(p, milik, expensesByPurchase.get(p.id) ?? []);
    for (const b of hpp.barang) {
      const pid = b.item.product_id;
      if (!pid || hasil.has(pid) || b.qty <= 0) continue;
      hasil.set(pid, { faktor: hpp.faktor, nota: p });
    }
  }
  return hasil;
}
