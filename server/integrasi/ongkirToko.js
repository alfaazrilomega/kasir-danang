// Ongkir checkout dari KiriminAja (spec 0002, AC-9 sampai AC-12, AC-16).
// Angka ongkir selalu dihitung di server; checkout hanya menampilkan pilihan.
import * as kiriminaja from './kiriminaja.js';
import { loadIntegration } from './settings.js';

/** Berat cadangan untuk produk yang belum diisi beratnya (spec 0002, AS-2). */
export const BERAT_CADANGAN_GRAM = 1000;

/** Konfigurasi KiriminAja toko bila siap dipakai checkout, selain itu null. */
export async function konfigurasiKirim(db, storeId) {
  const config = await loadIntegration(db, storeId, 'kiriminaja');
  return kiriminaja.kiriminAjaSiap(config) ? config : null;
}

export function beratPesanan(items, produkById) {
  return items.reduce((jumlah, it) => {
    const berat = Number(produkById.get(it.product_id)?.weight_gram);
    return jumlah + (Number.isFinite(berat) && berat > 0 ? berat : BERAT_CADANGAN_GRAM) * it.qty;
  }, 0);
}

const angkaId = (v) => (/^[1-9]\d{0,9}$/.test(String(v ?? '')) ? Number(v) : null);

/** Wilayah KiriminAja dari body: semua ID wajib bilangan bulat positif. */
export function bacaWilayah(w) {
  if (!w || typeof w !== 'object') return null;
  const hasil = {
    provinsi_id: angkaId(w.provinsi_id), kota_id: angkaId(w.kota_id),
    kecamatan_id: angkaId(w.kecamatan_id), kelurahan_id: angkaId(w.kelurahan_id),
  };
  return Object.values(hasil).every(Boolean) ? hasil : null;
}

// Tarif sama untuk tujuan dan berat yang sama selama beberapa menit; simpanan
// singkat ini menjaga kuota KiriminAja saat pembeli bolak balik di checkout.
const SIMPAN_TARIF_MS = 10 * 60 * 1000;
const simpananTarif = new Map();

/** Pilihan kurir untuk satu tujuan: [{ courier, service, nama, ongkir, etd, grup }] urut termurah. */
export async function opsiOngkir(config, { kecamatanId, kelurahanId, berat, nilaiBarang }) {
  const kunci = `${config.mode}:${config.originSubdistrict}:${kelurahanId}:${berat}`;
  const ada = simpananTarif.get(kunci);
  if (ada && ada.sampai > Date.now()) return ada.data;
  const hasil = await kiriminaja.tarifOngkir({
    origin: config.originDistrict, subdistrictOrigin: config.originSubdistrict,
    destination: kecamatanId, subdistrictDestination: kelurahanId,
    weight: berat, itemValue: nilaiBarang, insurance: 0,
  }, config);
  const data = hasil
    .map((r) => ({
      courier: String(r?.service ?? '').trim().toLowerCase(),
      service: String(r?.service_type ?? '').trim(),
      nama: String(r?.service_name ?? r?.service ?? '').trim(),
      ongkir: Math.round(Number(r?.cost)),
      etd: String(r?.etd ?? '').trim(),
      grup: String(r?.group ?? '').trim(),
    }))
    .filter((o) => o.courier && o.service && Number.isSafeInteger(o.ongkir) && o.ongkir > 0)
    .sort((a, b) => a.ongkir - b.ongkir || a.nama.localeCompare(b.nama, 'id'));
  if (simpananTarif.size > 2000) simpananTarif.clear();
  simpananTarif.set(kunci, { data, sampai: Date.now() + SIMPAN_TARIF_MS });
  return data;
}

// Batas sederhana per IP untuk rute publik wilayah dan ongkir.
const hitungan = new Map();
export function bolehPerIp(jenis, ip, maks, jendelaMs) {
  const kunci = `${jenis}:${ip}`;
  const kini = Date.now();
  const ada = hitungan.get(kunci);
  if (!ada || kini - ada.mulai > jendelaMs) {
    if (hitungan.size > 5000) hitungan.clear();
    hitungan.set(kunci, { mulai: kini, jumlah: 1 });
    return true;
  }
  ada.jumlah += 1;
  return ada.jumlah <= maks;
}
