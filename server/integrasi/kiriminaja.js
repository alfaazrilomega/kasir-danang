// KiriminAja: tarif ongkir dan pembuatan order kirim (15+ kurir).
//
// Aktif bila token tersimpan di Pengaturan > Integrasi (atau KIRIMINAJA_TOKEN).
// Selama kosong, ongkir tetap diisi staff saat mengonfirmasi pesanan.
//
// Jalur dan bentuk request mengikuti OpenAPI KiriminAja Mitra API 6.2.0
// (developer.kiriminaja.com/docs/openapi/json). Sandbox dan production memakai
// host berbeda (tdev vs client).

const BASE = {
  sandbox: 'https://tdev.kiriminaja.com',
  production: 'https://client.kiriminaja.com',
};

// Jalur endpoint bisa ditimpa lewat env bila versi API KiriminAja naik.
const JALUR = {
  ongkir: process.env.KIRIMINAJA_PATH_ONGKIR || '/api/mitra/v6.1/shipping_price',
  provinsi: process.env.KIRIMINAJA_PATH_PROVINSI || '/api/mitra/province',
  kabupaten: process.env.KIRIMINAJA_PATH_KABUPATEN || '/api/mitra/city',
  kecamatan: process.env.KIRIMINAJA_PATH_KECAMATAN || '/api/mitra/kecamatan',
  kelurahan: process.env.KIRIMINAJA_PATH_KELURAHAN || '/api/mitra/kelurahan',
  order: process.env.KIRIMINAJA_PATH_ORDER || '/api/mitra/v6.2/request_pickup',
};

function konfigurasi(override) {
  if (override) return { ...override, base: BASE[override.mode] };
  const mode = (process.env.KIRIMINAJA_MODE || 'sandbox').toLowerCase() === 'production' ? 'production' : 'sandbox';
  return { mode, base: BASE[mode], token: process.env.KIRIMINAJA_TOKEN || '' };
}

function kiriminAjaAktif(config) {
  const c = konfigurasi(config);
  return c.enabled !== false && !!c.token && !!c.base;
}

/** Siap dipakai checkout: aktif dan alamat asal kirim toko sudah dipilih. */
function kiriminAjaSiap(config) {
  return kiriminAjaAktif(config) && /^[1-9]\d*$/.test(String(config?.originDistrict ?? '')) && /^[1-9]\d*$/.test(String(config?.originSubdistrict ?? ''));
}

async function panggil(path, body, config) {
  const c = konfigurasi(config);
  if (!c.base || !c.token) throw new Error('KiriminAja belum dikonfigurasi.');
  const res = await fetch(`${c.base}${path}`, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${c.token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  });
  const teks = await res.text();
  let json = null;
  try {
    json = JSON.parse(teks);
  } catch {
    /* biarkan null */
  }
  if (!res.ok || json?.status === false) {
    if (res.status === 401 || res.status === 403) throw new Error('KiriminAja: token ditolak. Periksa token dan mode (sandbox atau production).');
    if (res.status === 429) throw new Error('KiriminAja: batas permintaan tercapai. Coba lagi sebentar lagi.');
    throw new Error(`KiriminAja: ${json?.text || json?.message || `HTTP ${res.status}`}`.slice(0, 200));
  }
  return json;
}

/**
 * Tarif ongkir express. `origin`/`destination` = id kecamatan,
 * `subdistrict_*` = id kelurahan, berat dalam gram.
 */
async function tarifOngkir({ origin, subdistrictOrigin, destination, subdistrictDestination, weight, itemValue, insurance = 0, courier }, config) {
  if (!kiriminAjaAktif(config)) throw new Error('KiriminAja belum dikonfigurasi.');
  const json = await panggil(JALUR.ongkir, {
    origin: Number(origin),
    subdistrict_origin: Number(subdistrictOrigin),
    destination: Number(destination),
    subdistrict_destination: Number(subdistrictDestination),
    weight: Math.max(1, Math.round(Number(weight) || 0)),
    item_value: Math.max(0, Math.round(Number(itemValue) || 0)),
    insurance: insurance ? '1' : '0',
    ...(courier?.length ? { courier } : {}),
  }, config);
  return Array.isArray(json?.results) ? json.results : [];
}

// Wilayah jarang berubah: disimpan di memori 24 jam per mode supaya kuota
// KiriminAja (sandbox 10, Basic 60 permintaan per menit) tidak habis.
const SIMPAN_WILAYAH_MS = 24 * 60 * 60 * 1000;
const simpananWilayah = new Map();

const LEVEL = {
  provinsi: { jalur: 'provinsi', induk: null, nama: 'provinsi_name' },
  kota: { jalur: 'kabupaten', induk: 'provinsi_id', nama: 'kabupaten_name' },
  kecamatan: { jalur: 'kecamatan', induk: 'kabupaten_id', nama: 'kecamatan_name' },
  kelurahan: { jalur: 'kelurahan', induk: 'kecamatan_id', nama: 'kelurahan_name' },
};

/** Daftar wilayah satu tingkat: [{ id, nama }] urut nama. */
async function daftarWilayah(level, induk, config) {
  const aturan = LEVEL[level];
  if (!aturan) throw new Error('Tingkat wilayah tidak dikenal.');
  if (aturan.induk && !/^[1-9]\d{0,9}$/.test(String(induk ?? ''))) throw new Error('Wilayah induk tidak valid.');
  const c = konfigurasi(config);
  const kunci = `${c.mode}:${level}:${aturan.induk ? induk : ''}`;
  const ada = simpananWilayah.get(kunci);
  if (ada && ada.sampai > Date.now()) return ada.data;
  const json = await panggil(JALUR[aturan.jalur], aturan.induk ? { [aturan.induk]: Number(induk) } : {}, config);
  const baris = Array.isArray(json?.datas) ? json.datas : Array.isArray(json?.results) ? json.results : Array.isArray(json?.data) ? json.data : [];
  const data = baris
    .map((b) => {
      const nama = String(b?.[aturan.nama] ?? '').trim();
      const jenis = level === 'kota' && b?.type && !new RegExp(`^${b.type}\\b`, 'i').test(nama) ? `${b.type} ` : '';
      return { id: Number(b?.id), nama: `${jenis}${nama}`.trim() };
    })
    .filter((b) => Number.isSafeInteger(b.id) && b.id > 0 && b.nama)
    .sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
  simpananWilayah.set(kunci, { data, sampai: Date.now() + SIMPAN_WILAYAH_MS });
  return data;
}

/**
 * Memastikan rantai wilayah pilihan pembeli benar-benar bersambung
 * (kelurahan ada di kecamatan, dan seterusnya) dan mengembalikan nama resminya.
 */
async function pastikanWilayah(w, config) {
  const provinsi = (await daftarWilayah('provinsi', null, config)).find((x) => x.id === w.provinsi_id);
  const kota = provinsi && (await daftarWilayah('kota', w.provinsi_id, config)).find((x) => x.id === w.kota_id);
  const kecamatan = kota && (await daftarWilayah('kecamatan', w.kota_id, config)).find((x) => x.id === w.kecamatan_id);
  const kelurahan = kecamatan && (await daftarWilayah('kelurahan', w.kecamatan_id, config)).find((x) => x.id === w.kelurahan_id);
  if (!kelurahan) return null;
  return {
    provinsi_id: provinsi.id, provinsi: provinsi.nama, kota_id: kota.id, kota: kota.nama,
    kecamatan_id: kecamatan.id, kecamatan: kecamatan.nama, kelurahan_id: kelurahan.id, kelurahan: kelurahan.nama,
  };
}

// Pencarian wilayah lama, dipertahankan untuk pemanggil yang sudah ada.
async function daftarKecamatan(kabupatenId, config) {
  return daftarWilayah('kecamatan', kabupatenId, config);
}

async function daftarKelurahan(kecamatanId, config) {
  return daftarWilayah('kelurahan', kecamatanId, config);
}

export { konfigurasi, kiriminAjaAktif, kiriminAjaSiap, tarifOngkir, daftarWilayah, pastikanWilayah, daftarKecamatan, daftarKelurahan, JALUR };

export async function tesKoneksi(config) {
  const result = await panggil(JALUR.provinsi, {}, config);
  if (result?.status !== true) throw new Error('Respons KiriminAja tidak valid.');
}
