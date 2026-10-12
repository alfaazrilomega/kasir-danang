// Perkakas bersama suite affiliate: panggilan API mentah, akun uji, dan SQL.
//
// Semua akun uji memakai domain contoh.id, yang dilewati pengirim email
// (alamatUji di server), jadi suite ini tidak pernah mengirim email sungguhan.

const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { ADMIN_PASSWORD, DB_PASSWORD } = require('./harness.cjs');

const API_URL = process.env.KASIR_API_URL || 'http://localhost:3000';

function psql(q) {
  return execFileSync(
    'C:/Program Files/PostgreSQL/16/bin/psql.exe',
    ['-U', 'kasir_user', '-h', '127.0.0.1', '-d', 'kasir', '-tAq', '-c', q],
    { env: { ...process.env, PGPASSWORD: DB_PASSWORD }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
}

/** Panggilan API tanpa browser. `ip` mengisi X-Forwarded-For supaya uji pembatas laju tidak meracuni suite lain. */
async function panggil(method, path, { token, body, cookie, ip, headers: tambahan } = {}) {
  const headers = { ...(tambahan || {}) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;
  if (ip) headers['X-Forwarded-For'] = ip;
  const kirim = () => fetch(API_URL + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let res;
  try {
    res = await kirim();
  } catch (e) {
    // psql dijalankan sinkron dan bisa menahan proses ini lebih lama dari batas
    // keep-alive server (5 detik). Soket yang sudah ditutup server lalu dipakai
    // lagi dan putus (ECONNRESET). Untuk GET aman diulang sekali.
    if (method !== 'GET') throw e;
    res = await kirim();
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  const setCookie = res.headers.get('set-cookie') || '';
  return {
    status: res.status,
    data: json?.data ?? null,
    error: json?.error ?? null,
    json,
    setCookie,
    /** Nilai `gnnk_aff=...` siap dipakai sebagai header Cookie. */
    cookie: setCookie.split(';')[0] || '',
  };
}

async function tokenAdmin() {
  const r = await panggil('POST', '/api/auth/signin', { body: { email: 'admin@example.com', password: ADMIN_PASSWORD } });
  const token = r.json?.session?.access_token;
  if (!token) throw new Error('Login admin gagal: ' + (r.error || r.status));
  return token;
}

const idToko = () => psql('select id from public.stores order by created_at limit 1');

// Pendaftaran dan checkout dibatasi per IP (20 per 10 menit). Tiap panggilan
// uji memakai alamat dari rentang uji RFC 2544 (198.18.0.0/15), seperti pembeli
// sungguhan yang datang dari alamat berbeda, supaya suite tidak saling meracuni.
let urutIp = 0;
function ipUji() {
  urutIp += 1;
  return `198.18.${process.pid % 250}.${urutIp % 250}`;
}

let urutHp = 10;
/** Daftar akun pembeli lewat API. Mengembalikan token dan id baris customers. */
async function daftarPembeli(storeId, cap, label, { cookie, name } = {}) {
  const email = `aff.${label}.${cap}@contoh.id`;
  const nama = name || `Uji ${label.toUpperCase()} ${cap}`;
  urutHp += 1;
  const r = await panggil('POST', '/api/customer/signup', {
    cookie,
    ip: ipUji(),
    body: {
      store_id: storeId,
      email,
      password: 'rahasia123',
      name: nama,
      phone: `0813${cap}${urutHp}`,
      privacy_accepted: true,
    },
  });
  if (r.status !== 200) throw new Error(`Daftar ${label} gagal: ${r.error}`);
  const id = psql(`select id from public.customers where lower(email) = '${email}'`);
  return { token: r.data.token, id, email, name: nama };
}

/** Pengaturan program lewat API admin; kunci yang tidak disebut memakai nilai tersimpan. */
async function aturProgram(admin, ubah) {
  const kini = await panggil('GET', '/api/admin/affiliate/settings', { token: admin });
  const r = await panggil('PUT', '/api/admin/affiliate/settings', { token: admin, body: { ...kini.data, ...ubah } });
  if (r.status !== 200) throw new Error('Simpan pengaturan gagal: ' + r.error);
  return r.data;
}

const izinkan = (admin, id, access = 'allowed') => panggil('PATCH', `/api/admin/affiliate/members/${id}`, { token: admin, body: { access } });

async function kodeAffiliate(token) {
  const r = await panggil('GET', '/api/customer/affiliate', { token });
  return r.data?.profile?.code ?? null;
}

/** Klik link affiliate; mengembalikan header Cookie hasil klik (kosong bila ditolak). */
async function klik(storeId, kode, { productId = null, cookie, source, media, token, ip } = {}) {
  return panggil('POST', '/api/public/affiliate/click', {
    cookie,
    token,
    ip,
    body: { store_id: storeId, code: kode, product_id: productId, utm_source: source ?? null, utm_media: media ?? null },
  });
}

async function pesan(storeId, pembeli, items, { cookie } = {}) {
  const r = await panggil('POST', '/api/public/orders', {
    token: pembeli.token,
    cookie,
    ip: ipUji(),
    body: {
      store_id: storeId,
      customer_name: pembeli.name,
      customer_phone: '081200000000',
      delivery_address: 'Jl. Uji Affiliate 1',
      payment_method: 'transfer',
      items,
    },
  });
  if (r.status !== 200) throw new Error('Checkout gagal: ' + r.error);
  return { id: r.data.order_id, number: r.data.order_number };
}

const konfirmasi = (admin, orderId, ongkir = 0) =>
  panggil('POST', '/api/rpc/confirm_web_order', { token: admin, body: { p_order_id: orderId, p_shipping_cost: ongkir } });
const tolak = (admin, orderId) => panggil('POST', '/api/rpc/reject_web_order', { token: admin, body: { p_order_id: orderId } });

/** Baris komisi satu pesanan sebagai teks `tier:affiliate:komisi:status:paid`, urut tier lalu barang. */
function komisiPesanan(orderId) {
  const teks = psql(
    `select string_agg(k.tier || ':' || k.affiliate_id || ':' || trunc(k.commission) || ':' || k.status || ':' || k.paid, ',' order by k.tier, k.commission desc)
       from public.affiliate_commissions k where k.order_id = '${orderId}'`,
  );
  return teks ? teks.split(',') : [];
}

/**
 * Produk aktif berstok, tanpa varian ukuran, untuk dipesan. Satu produk per
 * kelompok varian (SKU Induk, atau nama bila SKU Induk kosong), karena link untuk
 * satu varian berlaku untuk semua variannya (D-19). Tanpa ini dua produk bernama
 * sama terpilih sebagai "produk lain", dan uji aturan per produk salah alamat.
 */
function produkUji(storeId, jumlah = 3) {
  return psql(
    `select id || '|' || base_price from (
       select distinct on (kunci) id, base_price, kunci from (
         select id, base_price,
                case when btrim(coalesce(parent_sku, '')) <> '' then 'induk:' || lower(btrim(parent_sku)) else 'nama:' || lower(btrim(name)) end as kunci
           from public.products
          where store_id = '${storeId}' and is_active and base_price >= 10000 and stock_qty >= 20
            and jsonb_array_length(coalesce(sizes, '[]'::jsonb)) = 0
       ) p
       order by kunci, base_price desc, id
     ) q
     order by base_price desc, id limit ${jumlah}`,
  )
    .split('\n')
    .filter(Boolean)
    .map((b) => ({ id: b.split('|')[0], price: Number(b.split('|')[1]) }));
}

const sha256 = (teks) => crypto.createHash('sha256').update(teks).digest('hex');

const kutip = (ids) => ids.map((x) => `'${x}'`).join(',');
const daftarId = (sql) => psql(sql).split(',').map((x) => x.trim()).filter(Boolean);

/**
 * Hapus jejak uji affiliate: akun pembeli yang emailnya cocok `pola` (LIKE,
 * huruf kecil, wajib berakhiran @contoh.id), pesanan yang mereka buat atau bawa
 * (stok dikembalikan lewat RPC void_orders), komisi, pembayaran beserta
 * pengeluarannya, klik, undangan, dan antrean emailnya.
 *
 * Tiap suite memanggilnya di akhir dengan pola ber-cap miliknya. Tanpa ini satu
 * putaran meninggalkan sekitar seratus pesanan, dan suite lain ikut merah:
 * Laba Rugi (pesanan menunggu konfirmasi, batas tarik 500 pesanan) dan tabel HP
 * (nama 117 huruf dari uji nilai terpanjang).
 */
async function bersihkanUji(admin, pola) {
  if (!/@contoh\.id$/.test(pola) || /'/.test(pola)) throw new Error('Pola pembersihan harus berakhiran @contoh.id');
  const akun = daftarId(`select coalesce(string_agg(id::text, ','), '') from public.customers where lower(email) like '${pola}'`);
  // Akun pembeli yang baris pelanggannya sudah dihapus uji (login tanpa pelanggan) ikut dibuang.
  const buangAkunYatim = () =>
    psql(`delete from public.app_users u using public.profiles p
           where p.id = u.id and p.role = 'customer' and lower(u.email) like '${pola}'
             and not exists (select 1 from public.customers c where c.user_id = u.id)`);
  if (!akun.length) {
    buangAkunYatim();
    return { akun: 0, pesanan: 0 };
  }
  const pesanan = daftarId(
    `select coalesce(string_agg(id::text, ','), '') from public.orders where customer_id in (${kutip(akun)}) or affiliate_id in (${kutip(akun)})`,
  );
  psql(`begin;
    delete from public.expenses where id in (select expense_id from public.affiliate_payouts where affiliate_id in (${kutip(akun)}) and expense_id is not null);
    delete from public.affiliate_commissions where affiliate_id in (${kutip(akun)})${pesanan.length ? ` or order_id in (${kutip(pesanan)})` : ''};
    delete from public.affiliate_payouts where affiliate_id in (${kutip(akun)});
    commit;`);
  for (let i = 0; i < pesanan.length; i += 400) {
    const r = await panggil('POST', '/api/rpc/void_orders', { token: admin, body: { p_order_ids: pesanan.slice(i, i + 400), p_delete: true } });
    if (r.status !== 200) throw new Error('Hapus pesanan uji gagal: ' + (r.error || r.status));
  }
  psql(`begin;
    delete from public.affiliate_outbox o
     where not exists (select 1 from public.orders x where x.id = o.ref_id)
       and not exists (select 1 from public.affiliate_commissions x where x.id = o.ref_id)
       and not exists (select 1 from public.affiliate_payouts x where x.id = o.ref_id);
    delete from public.app_users where id in (select user_id from public.customers where id in (${kutip(akun)}) and user_id is not null);
    delete from public.customers where id in (${kutip(akun)});
    commit;`);
  buangAkunYatim();
  return { akun: akun.length, pesanan: pesanan.length };
}

/**
 * Ukur layar di dalam cakupan [data-affiliate-layar]. Dijalankan di browser
 * lewat page.evaluate(UKUR_LAYAR, minSentuh).
 *
 * - geser: halaman bisa digulir ke samping.
 * - keluar: elemen yang melewati tepi layar dan tidak berada di wadah gulir.
 * - terpotong: wadah bergulir mendatar yang isinya lebih lebar dari wadahnya.
 *   Baris tab dan cip (kelas tanpa-bilah) memang digeser, jadi dikecualikan.
 * - kecil: kontrol yang tingginya di bawah minSentuh (0 = tidak diperiksa).
 *   Kotak centang, radio, dan saklar diukur lewat labelnya.
 *
 * `diperiksa` dan `sentuh` ikut dikembalikan: nol berarti selektornya tidak
 * mengenai apa pun dan pengukurannya tidak sah.
 */
const UKUR_LAYAR = (minSentuh) => {
  const akar = document.querySelector('[data-affiliate-layar]');
  if (!akar) return { ada: false };
  const lebar = document.documentElement.clientWidth;
  const tampak = (el) => {
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const dalamGulir = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if ((o === 'auto' || o === 'scroll' || o === 'hidden') && p.scrollWidth > p.clientWidth + 1) return p;
    }
    return null;
  };
  const sebut = (el) => (el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40);
  let diperiksa = 0;
  const keluar = [];
  const terpotong = [];
  akar.querySelectorAll('*').forEach((el) => {
    if (!tampak(el)) return;
    diperiksa += 1;
    const b = el.getBoundingClientRect();
    if ((b.right > lebar + 1 || b.left < -1) && !dalamGulir(el)) keluar.push(`${el.tagName.toLowerCase()} "${sebut(el)}" kanan ${Math.round(b.right)}`);
    const o = getComputedStyle(el).overflowX;
    if ((o === 'auto' || o === 'scroll') && el.scrollWidth > el.clientWidth + 1 && !el.classList.contains('tanpa-bilah')) {
      terpotong.push(`${el.tagName.toLowerCase()} ${el.scrollWidth}/${el.clientWidth}px`);
    }
  });
  const kecil = [];
  let sentuh = 0;
  if (minSentuh) {
    akar.querySelectorAll('button, a[href], input, select, textarea').forEach((el) => {
      if (!tampak(el)) return;
      const jenis = el.getAttribute('type');
      if (el.tagName === 'INPUT' && (jenis === 'hidden' || jenis === 'file')) return;
      const target = el.tagName === 'INPUT' && (jenis === 'checkbox' || jenis === 'radio') ? el.closest('label') || el : el;
      const b = target.getBoundingClientRect();
      sentuh += 1;
      if (b.height < minSentuh - 0.5) kecil.push(`${el.tagName.toLowerCase()} "${sebut(target)}" ${Math.round(b.height)}px`);
    });
  }
  return {
    ada: true,
    geser: document.documentElement.scrollWidth > lebar,
    diperiksa,
    jumlahKeluar: keluar.length,
    keluar: keluar.slice(0, 4),
    terpotong: terpotong.slice(0, 4),
    sentuh,
    jumlahKecil: kecil.length,
    kecil: kecil.slice(0, 6),
  };
};

/** Ringkasan satu baris hasil UKUR_LAYAR untuk keterangan cek. */
function ringkasUkur(r) {
  if (!r.ada) return 'cakupan [data-affiliate-layar] tidak ditemukan';
  const bagian = [`${r.diperiksa} elemen`, `${r.sentuh} kontrol`];
  if (r.geser) bagian.push('HALAMAN BERGESER');
  if (r.jumlahKeluar) bagian.push(`keluar layar: ${r.keluar.join(' ; ')}`);
  if (r.terpotong.length) bagian.push(`terpotong: ${r.terpotong.join(' ; ')}`);
  if (r.jumlahKecil) bagian.push(`di bawah 44px (${r.jumlahKecil}): ${r.kecil.join(' ; ')}`);
  return bagian.join(', ');
}

function pencatat() {
  const hasil = [];
  const record = (nama, ok, ket) => {
    hasil.push({ nama, ok: !!ok });
    console.log((ok ? 'PASS  ' : 'FAIL  ') + nama + (ket !== undefined && ket !== '' ? ' — ' + ket : ''));
  };
  const ringkas = () => {
    const lolos = hasil.filter((h) => h.ok).length;
    console.log(`\n${lolos}/${hasil.length} lolos`);
    process.exitCode = lolos === hasil.length ? 0 : 1;
  };
  return { record, ringkas, hasil };
}

module.exports = {
  API_URL,
  psql,
  panggil,
  tokenAdmin,
  idToko,
  daftarPembeli,
  aturProgram,
  izinkan,
  kodeAffiliate,
  klik,
  pesan,
  konfirmasi,
  tolak,
  komisiPesanan,
  produkUji,
  sha256,
  bersihkanUji,
  ipUji,
  UKUR_LAYAR,
  ringkasUkur,
  pencatat,
};
