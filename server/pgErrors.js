// Klasifikasi error PostgreSQL.
//
// Latar belakang: seluruh jalur tulis /api/query dulu menelan SEMUA error
// database dan tetap membalas sukses. Itu memang membuat aplikasi jalan saat
// database mati, tapi juga menyembunyikan pelanggaran foreign key, unique,
// dan tipe data — baris hanya mendarat di IndexedDB, dan pengguna baru sadar
// jauh belakangan ketika angkanya tidak cocok.
//
// Pemisahannya: hanya kegagalan KONEKSI yang boleh jatuh ke mode offline.
// Kesalahan data harus muncul ke pengguna.
//
// File terpisah dari index.js supaya bisa diimpor unit test tanpa ikut
// menjalankan server (index.js langsung listen dan process.exit saat dimuat).

/** Error tingkat soket Node, bukan dari server Postgres. */
const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
]);

/**
 * SQLSTATE yang berarti "database tidak bisa dipakai sekarang", bukan
 * "data Anda salah".
 *   08xxx connection_exception
 *   53xxx insufficient_resources (mis. too_many_connections)
 *   57P01-03 admin_shutdown / crash_shutdown / cannot_connect_now
 *   28xxx invalid_authorization (kredensial salah = tidak bisa konek)
 *   3D000 database tidak ada
 */
function isConnectionState(code) {
  if (typeof code !== 'string') return false;
  if (code.startsWith('08') || code.startsWith('53') || code.startsWith('28')) return true;
  if (code === '57P01' || code === '57P02' || code === '57P03') return true;
  if (code === '3D000') return true;
  return false;
}

/** True bila error ini pantas memicu fallback offline. */
export function isConnectionError(error) {
  if (!error) return false;
  if (NETWORK_CODES.has(error.code)) return true;
  if (isConnectionState(error.code)) return true;
  // Pool pg melempar ini saat tidak ada koneksi yang bisa dipakai.
  if (typeof error.message === 'string' && /terminated|Connection terminated/i.test(error.message)) {
    return true;
  }
  return false;
}

/**
 * Terjemahkan error Postgres jadi { status, message } yang aman ditampilkan.
 * Mengembalikan null kalau error ini bukan sesuatu yang perlu dilaporkan
 * sebagai kesalahan data (artinya: pemanggil boleh fallback offline).
 */
export function describePgError(error) {
  if (!error || isConnectionError(error)) return null;
  const code = typeof error.code === 'string' ? error.code : '';

  switch (code) {
    case '23505':
      return { status: 409, message: 'Data duplikat: nilai ini sudah dipakai.' };
    case '23503':
      return {
        status: 409,
        message: 'Data terkait tidak ditemukan atau masih dipakai baris lain.',
      };
    case '23502':
      return { status: 400, message: 'Ada kolom wajib yang kosong.' };
    case '23514':
      return { status: 400, message: 'Nilai tidak memenuhi aturan yang berlaku.' };
    case '22P02':
      return { status: 400, message: 'Format data tidak valid (mis. id bukan UUID).' };
    case '22001':
      return { status: 400, message: 'Teks terlalu panjang untuk kolom ini.' };
    case '22003':
      return { status: 400, message: 'Angka di luar rentang yang diizinkan.' };
    default:
      break;
  }

  // 23xxx lain: tetap pelanggaran integritas.
  if (code.startsWith('23')) {
    return { status: 409, message: 'Data melanggar aturan integritas database.' };
  }
  // 22xxx lain: kesalahan data.
  if (code.startsWith('22')) {
    return { status: 400, message: 'Format data tidak valid.' };
  }
  // 42xxx: skema/SQL salah — bug server, bukan salah pengguna.
  if (code.startsWith('42')) {
    return { status: 500, message: 'Skema database tidak cocok dengan aplikasi.' };
  }

  return { status: 500, message: 'Kesalahan database.' };
}
