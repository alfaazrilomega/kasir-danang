// Impor pencairan dana marketplace (Shopee & TikTok).
//
// Pesanan marketplace tidak cair sebesar harga jualnya: Shopee dan TikTok
// memotong komisi, biaya layanan, dan ongkir sebelum uangnya masuk saldo.
// Client mengunduh laporan pencairan itu untuk mencocokkan dana yang
// benar-benar diterima dengan pesanan yang sudah tercatat di aplikasi.
//
// PENTING: importer ini HANYA memperbarui pesanan yang sudah ada. Tidak
// pernah membuat pesanan atau order_items baru, tidak menyentuh stok, dan
// tidak pernah mengubah total, paid_amount, atau payment_status — angka itu
// milik proses penjualan, bukan proses pencairan.

import { db } from './db';
import { getBackendClient } from './api';
import { readSpreadsheet } from './spreadsheet';
import { parseNumber, parseDate } from './salesImport';
import type { Order } from '@/types';

type SettlementLayout = 'shopee_saldo' | 'tiktok_income';

export interface BarisPencairan {
  /** Nomor pesanan apa adanya dari laporan. */
  nomor: string;
  /** Dana yang benar-benar cair ke saldo. */
  net: number;
  /** Potongan marketplace (komisi, layanan, ongkir, dll), besaran positif. */
  fee: number;
  /** Tanggal cair, format yyyy-mm-dd. */
  tanggal: string | null;
  /** Rincian potongan per komponen; null kalau penyedia tidak merincinya (Shopee). */
  rincian: Record<string, number> | null;
  /** Id pesanan lokal yang cocok. */
  orderId: string | null;
  /** Total pesanan menurut aplikasi, pembanding di layar konfirmasi. */
  totalTayang: number | null;
}

export interface RencanaPencairan {
  layout: SettlementLayout | null;
  layoutLabel: string;
  /** Baris yang cocok dengan pesanan lokal, siap diterapkan. */
  baris: BarisPencairan[];
  /** Nomor pesanan di laporan yang tidak ketemu di aplikasi. */
  tidakCocok: string[];
  /** Baris yang bukan pendapatan per pesanan (penarikan saldo, penyesuaian, dll). */
  dilewati: number;
  /** Baris yang cocok tapi pesanannya sudah pernah dicairkan sebelumnya. */
  diperbarui: number;
  totalNet: number;
  totalFee: number;
  /** Masalah per baris, diawali "Baris N: ...". */
  galat: string[];
}

/**
 * Hari kalender LOKAL dari hasil parseDate.
 *
 * parseDate mengembalikan ISO hasil toISOString(), yang sudah digeser ke UTC.
 * Memotong 10 karakter pertamanya di WIB (UTC+7) memundurkan tanggal satu hari
 * untuk tiap pencairan sebelum pukul 07.00 — dan laporan Shopee penuh transaksi
 * dini hari ("2026-09-12 00:45:45"). Jadi digeser balik ke waktu lokal dulu.
 */
function hariLokal(iso: string): string {
  const dt = new Date(iso);
  const lokal = new Date(dt.getTime() - dt.getTimezoneOffset() * 60_000);
  return lokal.toISOString().slice(0, 10);
}

/** Ambil isi sel untuk satu nama kolom persis, atau "" kalau kolomnya tidak ada. */
function ambil(header: string[], row: string[], nama: string): string {
  const at = header.indexOf(nama);
  return at >= 0 ? (row[at] ?? '').trim() : '';
}

/**
 * Kenali susunan berkas dan baris tempat judul kolom sungguhan berada.
 *
 * TikTok selalu menaruh judulnya di baris pertama. Shopee menyisipkan kop
 * laporan (judul, info rekening, ringkasan saldo) sebelum tabel transaksi,
 * jadi baris judulnya dicari lewat isinya, bukan ditebak nomornya — supaya
 * importer tidak rusak kalau Shopee mengubah panjang kopnya.
 */
function detectLayout(rows: string[][]): { layout: SettlementLayout; headerRow: number } | null {
  const headerAwal = rows[0].map((h) => h.trim());
  if (headerAwal.includes('ID Pesanan/Penyesuaian') && headerAwal.includes('Jenis transaksi')) {
    return { layout: 'tiktok_income', headerRow: 0 };
  }

  const batas = Math.min(rows.length, 30);
  for (let i = 0; i < batas; i++) {
    const h = rows[i].map((c) => c.trim());
    if (h.includes('Tanggal Transaksi') && h.includes('No. Pesanan')) {
      return { layout: 'shopee_saldo', headerRow: i };
    }
  }

  return null;
}

/**
 * Baca laporan pencairan dan susun rencana pembaruan, tanpa menulis apa pun.
 *
 * Baris bermasalah dilaporkan dengan nomor barisnya dan dilewati, supaya satu
 * baris rusak tidak menggagalkan seluruh berkas.
 */
export async function planPencairan(file: File, storeId: string): Promise<RencanaPencairan> {
  const kosong = (pesan: string): RencanaPencairan => ({
    layout: null,
    layoutLabel: 'tidak dikenali',
    baris: [],
    tidakCocok: [],
    dilewati: 0,
    diperbarui: 0,
    totalNet: 0,
    totalFee: 0,
    galat: [pesan],
  });

  const rows = await readSpreadsheet(file);
  if (rows.length < 2) return kosong('Berkas kosong.');

  const deteksi = detectLayout(rows);
  if (!deteksi) {
    return kosong(
      'Susunan berkas tidak dikenali. Harus laporan saldo Shopee atau laporan pendapatan TikTok.',
    );
  }
  const { layout, headerRow } = deteksi;
  const header = rows[headerRow].map((h) => h.trim());
  const layoutLabel = layout === 'shopee_saldo' ? 'laporan saldo Shopee' : 'laporan pendapatan TikTok';

  // Pesanan yang sudah ada dimuat sekali di awal, dicocokkan lewat nomor
  // platform dulu baru nomor pesanan lokal — sama seperti planSalesImport.
  const existing = await db.orders.where('store_id').equals(storeId).toArray();
  const byExternal = new Map<string, Order>();
  const byNomor = new Map<string, Order>();
  for (const o of existing) {
    const ext = (o.external_order_no ?? '').trim().toUpperCase();
    if (ext) byExternal.set(ext, o);
    const nom = (o.order_number ?? '').trim().toUpperCase();
    if (nom) byNomor.set(nom, o);
  }
  const cariPesanan = (nomor: string): Order | null => {
    const key = nomor.trim().toUpperCase();
    return byExternal.get(key) ?? byNomor.get(key) ?? null;
  };

  const baris: BarisPencairan[] = [];
  const tidakCocok = new Set<string>();
  const galat: string[] = [];
  let dilewati = 0;
  let diperbarui = 0;

  for (let i = headerRow + 1; i < rows.length; i++) {
    const nomorBaris = i + 1; // nomor baris asli di Excel (rows[0] = baris 1)
    const row = rows[i];

    if (layout === 'tiktok_income') {
      const jenis = ambil(header, row, 'Jenis transaksi');
      const nomor = ambil(header, row, 'ID Pesanan/Penyesuaian');
      const jumlahRaw = ambil(header, row, 'Jumlah penyelesaian pembayaran');
      if (!jenis && !nomor && !jumlahRaw) continue; // baris kosong di akhir berkas

      if (jenis !== 'Pesanan') {
        // "Penyesuaian" dan sejenisnya bukan pencairan pesanan.
        dilewati++;
        continue;
      }
      if (!nomor) {
        galat.push(`Baris ${nomorBaris}: ID Pesanan/Penyesuaian kosong.`);
        continue;
      }
      const net = parseNumber(jumlahRaw);
      if (net === null) {
        galat.push(`Baris ${nomorBaris}: "Jumlah penyelesaian pembayaran" (${jumlahRaw}) bukan angka.`);
        continue;
      }
      const waktuRaw = ambil(header, row, 'Waktu pembayaran pesanan');
      const tanggalIso = parseDate(waktuRaw);
      if (!tanggalIso) {
        galat.push(`Baris ${nomorBaris}: tanggal "${waktuRaw}" tidak dikenali.`);
        continue;
      }
      const totalBiayaRaw = ambil(header, row, 'Total Biaya');
      const totalBiaya = parseNumber(totalBiayaRaw);
      if (totalBiaya === null) {
        galat.push(`Baris ${nomorBaris}: "Total Biaya" (${totalBiayaRaw}) bukan angka.`);
        continue;
      }

      // Cuma komponen yang benar-benar dipotong yang dicatat — rincian penuh
      // nol untuk semua komponen sama saja dengan tidak ada rincian.
      const rincian: Record<string, number> = {};
      const tambah = (kunci: string, nama: string) => {
        const v = parseNumber(ambil(header, row, nama));
        if (v) rincian[kunci] = Math.abs(v);
      };
      tambah('komisi', 'Biaya komisi platform');
      tambah('layanan_pre_order', 'Biaya layanan pre-order');
      tambah('pembayaran', 'Biaya Pembayaran');
      tambah('ongkir', 'Ongkir');

      const order = cariPesanan(nomor);
      if (!order) {
        tidakCocok.add(nomor);
        continue;
      }
      if (order.net_settled != null) diperbarui++;

      baris.push({
        nomor,
        net,
        fee: Math.abs(totalBiaya),
        tanggal: hariLokal(tanggalIso),
        rincian: Object.keys(rincian).length ? rincian : null,
        orderId: order.id,
        totalTayang: order.total,
      });
      continue;
    }

    // layout === 'shopee_saldo'
    const tipe = ambil(header, row, 'Tipe Transaksi');
    const nomor = ambil(header, row, 'No. Pesanan');
    const jumlahRaw = ambil(header, row, 'Jumlah');
    if (!tipe && !nomor && !jumlahRaw) continue; // baris kosong di akhir berkas

    if (!tipe.includes('Penghasilan dari Pesanan')) {
      // Penarikan saldo, penyesuaian, dll — bukan pencairan pesanan.
      dilewati++;
      continue;
    }
    if (!nomor) {
      galat.push(`Baris ${nomorBaris}: No. Pesanan kosong.`);
      continue;
    }
    const net = parseNumber(jumlahRaw);
    if (net === null) {
      galat.push(`Baris ${nomorBaris}: "Jumlah" (${jumlahRaw}) bukan angka.`);
      continue;
    }
    const tanggalRaw = ambil(header, row, 'Tanggal Transaksi');
    const tanggalIso = parseDate(tanggalRaw);
    if (!tanggalIso) {
      galat.push(`Baris ${nomorBaris}: tanggal "${tanggalRaw}" tidak dikenali.`);
      continue;
    }

    const order = cariPesanan(nomor);
    if (!order) {
      tidakCocok.add(nomor);
      continue;
    }
    if (order.net_settled != null) diperbarui++;

    // Shopee tidak memberi rincian potongan, cuma dana bersihnya — potongan
    // dihitung dari selisih. Bonus/refund kadang membuat dana cair melebihi
    // total pesanan; itu dilaporkan, bukan ditulis sebagai potongan negatif.
    const selisih = order.total - net;
    const fee = selisih < 0 ? 0 : selisih;
    if (selisih < 0) {
      galat.push(
        `Baris ${nomorBaris}: dana cair (${net}) pesanan ${nomor} melebihi total pesanan (${order.total}); potongan dicatat 0.`,
      );
    }

    baris.push({
      nomor,
      net,
      fee,
      tanggal: hariLokal(tanggalIso),
      rincian: null,
      orderId: order.id,
      totalTayang: order.total,
    });
  }

  return {
    layout,
    layoutLabel,
    baris,
    tidakCocok: [...tidakCocok],
    dilewati,
    diperbarui,
    totalNet: baris.reduce((sum, b) => sum + b.net, 0),
    totalFee: baris.reduce((sum, b) => sum + b.fee, 0),
    galat,
  };
}

/**
 * Terapkan rencana ke pesanan yang cocok.
 *
 * Server dulu, baru Dexie — kalau server menolak, tampilan lokal tidak ikut
 * menyimpan angka yang sebenarnya gagal tersimpan. Cuma empat medan
 * pencairan yang ditulis; total, paid_amount, dan payment_status tidak
 * pernah disentuh.
 */
export async function runPencairan(rencana: RencanaPencairan, storeId: string): Promise<number> {
  const api = getBackendClient();
  const online = navigator.onLine;
  let sukses = 0;

  // Tiap pesanan punya angka pencairannya sendiri, jadi tidak bisa digabung
  // jadi satu perintah update. Tapi satu laporan berisi ratusan pesanan (182 di
  // berkas client), dan menunggu giliran satu per satu membuat impor terasa
  // menggantung berpuluh detik. Jadi dikirim sepuluh-sepuluh.
  const SEKALI_KIRIM = 10;
  for (let i = 0; i < rencana.baris.length; i += SEKALI_KIRIM) {
    const kelompok = rencana.baris.slice(i, i + SEKALI_KIRIM);
    const hasil = await Promise.all(
      kelompok.map(async (baris) => {
        if (!baris.orderId) return false;
        // Dimuat ulang dari Dexie (bukan dipercaya dari rencana) supaya patch
        // digabung dengan data pesanan yang paling baru, dan supaya pesanan yang
        // ternyata bukan milik toko ini tidak ikut ditulis.
        const current = await db.orders.get(baris.orderId);
        if (!current || current.store_id !== storeId) return false;

        const patch: Pick<Order, 'marketplace_fee' | 'net_settled' | 'settlement_date' | 'fee_detail'> = {
          marketplace_fee: baris.fee,
          net_settled: baris.net,
          settlement_date: baris.tanggal,
          fee_detail: baris.rincian,
        };

        if (online) {
          const { error } = await api.from('orders').update(patch).eq('id', baris.orderId);
          if (error) throw new Error(error.message);
        }

        await db.orders.put({ ...current, ...patch });
        return true;
      }),
    );
    sukses += hasil.filter(Boolean).length;
  }

  return sukses;
}
