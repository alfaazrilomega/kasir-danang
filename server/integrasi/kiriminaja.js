// KiriminAja: tarif ongkir dan pembuatan order kirim (15+ kurir).
//
// Aktif hanya bila KIRIMINAJA_TOKEN terisi. Selama kosong, ongkir tetap diisi
// staff saat mengonfirmasi pesanan seperti sekarang.
//
// Sandbox dan production memakai host berbeda (tdev vs client); isi
// KIRIMINAJA_MODE=production setelah tarifnya cocok dengan tagihan asli.

const BASE = {
  sandbox: 'https://tdev.kiriminaja.com',
  production: 'https://client.kiriminaja.com',
};

// Jalur endpoint bisa ditimpa lewat env: versi API KiriminAja naik sendiri
// tanpa mengubah bentuk request, jadi lebih aman disetel daripada dikunci.
const JALUR = {
  ongkir: process.env.KIRIMINAJA_PATH_ONGKIR || '/api/mitra/v6.1/shipping_price',
  kabupaten: process.env.KIRIMINAJA_PATH_KABUPATEN || '/api/mitra/v1/coverage/kabupaten',
  kecamatan: process.env.KIRIMINAJA_PATH_KECAMATAN || '/api/mitra/v1/coverage/district',
  kelurahan: process.env.KIRIMINAJA_PATH_KELURAHAN || '/api/mitra/v1/coverage/sub-district',
  order: process.env.KIRIMINAJA_PATH_ORDER || '/api/mitra/v6/request_pickup',
};

function konfigurasi() {
  const mode = (process.env.KIRIMINAJA_MODE || 'sandbox').toLowerCase() === 'production' ? 'production' : 'sandbox';
  return { mode, base: BASE[mode], token: process.env.KIRIMINAJA_TOKEN || '' };
}

function kiriminAjaAktif() {
  return !!konfigurasi().token;
}

async function panggil(path, body) {
  const c = konfigurasi();
  const res = await fetch(`${c.base}${path}`, {
    method: 'POST',
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
    throw new Error(`KiriminAja: ${json?.text || json?.message || teks.slice(0, 200) || `HTTP ${res.status}`}`);
  }
  return json;
}

/**
 * Tarif ongkir reguler/express. `origin`/`destination` = id kecamatan,
 * `subdistrict_*` = id kelurahan, berat dalam gram.
 */
async function tarifOngkir({ origin, subdistrictOrigin, destination, subdistrictDestination, weight, itemValue, insurance = 0, courier }) {
  if (!kiriminAjaAktif()) throw new Error('KiriminAja belum dikonfigurasi.');
  const json = await panggil(JALUR.ongkir, {
    origin,
    subdistrict_origin: subdistrictOrigin,
    destination,
    subdistrict_destination: subdistrictDestination,
    weight,
    item_value: String(itemValue ?? 0),
    insurance: insurance ? 1 : 0,
    ...(courier?.length ? { courier } : {}),
  });
  return Array.isArray(json?.results) ? json.results : [];
}

/** Pencarian wilayah untuk mengubah alamat teks menjadi id kecamatan/kelurahan. */
async function daftarKecamatan(kabupatenId) {
  const json = await panggil(JALUR.kecamatan, { kabupaten_id: kabupatenId });
  return json?.data ?? [];
}

async function daftarKelurahan(kecamatanId) {
  const json = await panggil(JALUR.kelurahan, { kecamatan_id: kecamatanId });
  return json?.data ?? [];
}

export { konfigurasi, kiriminAjaAktif, tarifOngkir, daftarKecamatan, daftarKelurahan, JALUR };
