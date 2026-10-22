// Voucher di checkout toko online (permintaan client: "ada voucher tapi di
// bagian payment gateway gabisa input voucher"). Voucher = kode promo yang
// sudah dibuat admin di menu Promo; tidak ada tabel baru.
//
// Aturan berlaku sama dengan status di halaman Promo admin: aktif dan hari ini
// (WIB) di dalam rentang tanggal mulai-selesai. Diskon dibulatkan ke rupiah
// utuh karena Tripay dan Mayar hanya menerima nominal bulat.

export const PANJANG_KODE_MAKS = 60;

/** Diskon voucher untuk subtotal barang; tidak pernah melebihi subtotal. */
export function diskonVoucher(voucher, subtotal) {
  const dasar = Math.max(0, Number(subtotal) || 0);
  const nilai = Math.max(0, Number(voucher?.value) || 0);
  const diskon = voucher?.type === 'percent' ? Math.round((dasar * Math.min(nilai, 100)) / 100) : Math.round(nilai);
  return Math.min(diskon, dasar);
}

/** Promo yang berlaku hari ini untuk kode itu (tanpa beda huruf besar/kecil), atau null. */
export async function cariVoucher(db, storeId, kode) {
  const bersih = String(kode ?? '').trim();
  if (!bersih || bersih.length > PANJANG_KODE_MAKS) return null;
  const r = await db.query(
    `select id, code, name, type, value::float8 as value
       from public.promos
      where store_id = $1 and lower(btrim(code)) = lower($2) and is_active
        and (start_date is null or start_date <= (now() at time zone 'Asia/Jakarta')::date)
        and (end_date is null or end_date >= (now() at time zone 'Asia/Jakarta')::date)
      order by created_at desc
      limit 1`,
    [storeId, bersih],
  );
  return r.rows[0] ?? null;
}

// Cek kode dibatasi per IP supaya kode voucher tidak bisa ditebak beruntun.
const percobaan = new Map();
const JENDELA_MS = 10 * 60 * 1000;
const BATAS = 30;

export function bolehCekVoucher(ip, sekarang = Date.now()) {
  const kunci = String(ip || 'tanpa-ip');
  const catatan = (percobaan.get(kunci) ?? []).filter((t) => sekarang - t < JENDELA_MS);
  if (catatan.length >= BATAS) {
    percobaan.set(kunci, catatan);
    return false;
  }
  catatan.push(sekarang);
  percobaan.set(kunci, catatan);
  if (percobaan.size > 5000) {
    for (const [k, daftar] of percobaan) if (!daftar.some((t) => sekarang - t < JENDELA_MS)) percobaan.delete(k);
  }
  return true;
}

/**
 * Baris barang untuk Tripay. Tanpa voucher, barang dikirim apa adanya. Dengan
 * voucher, satu baris senilai total: dokumentasi Tripay tidak menjamin baris
 * berharga negatif diterima, dan jumlah baris harus sama dengan nominal tagihan.
 */
export function barisTagihanTripay(items, total, diskon, orderNumber, kirim = null) {
  // Ongkir KiriminAja ikut ditagih sebagai baris sendiri (spec 0002, AC-12).
  const ongkir = kirim?.ongkir ? [{ name: `Ongkir ${kirim.nama || 'pengiriman'}`.slice(0, 100), price: kirim.ongkir, quantity: 1 }] : [];
  if (!diskon) return [...items.map((it) => ({ name: it.name, price: it.price, quantity: it.qty })), ...ongkir];
  return [{ name: `Pesanan ${orderNumber} (setelah voucher)`, price: total - (kirim?.ongkir || 0), quantity: 1 }, ...ongkir];
}
