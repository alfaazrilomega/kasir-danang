'use strict';
// Isi satu toko dengan katalog asli GNNK Racing (katalog-gnnk.json, diambil dari
// gnnkracing.id) ditambah data transaksi contoh yang konsisten dan tetap satu kategori
// dengan barang client (gear set, gear belakang, gear depan, rantai motor).
//
//   node scripts/data-gnnk/bangun-data.cjs --store <uuid>                       uji coba (dibatalkan)
//   node scripts/data-gnnk/bangun-data.cjs --store <uuid> --ya                  tulis permanen
//   ... --mode produksi --db "<postgres url>"                                   untuk server produksi
//
// Mode lokal (bawaan): kategori, produk, supplier, pemetaan SKU, pesanan, pembelian, mutasi
// stok, stok opname, shift + kas, dan ulasan toko itu dihapus lalu dibuat ulang.
//
// Mode produksi: TIDAK menghapus data client. Yang dihapus hanya barang kafe (produk di
// kategori kafe yang namanya bukan gear/rantai) beserta pesanan & pembelian yang isinya
// barang kafe saja. Produk client dilengkapi di tempat (id, foto, dan harga yang sudah ada
// dipertahankan), produk situs yang belum ada ditambahkan, lalu ditambah transaksi contoh.
// Pesanan asli client, isi set, shift, dan biaya tidak disentuh.
//
// Tanpa --db, database diambil dari DATABASE_URL di .env.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..', '..');
const argv = process.argv.slice(2);
const opsi = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : d;
};
const MODE = opsi('mode', 'lokal');
const STORE = opsi('store', '');
const HARI = Number(opsi('hari', 45));
const TULIS = argv.includes('--ya');
const PRODUKSI = MODE === 'produksi';
/** Pembeda id data contoh; id tetap sama untuk kunci yang sama sehingga penjalanan ulang terdeteksi. */
const KUNCI = opsi('kunci', 'v1');

function bacaEnv() {
  const env = {};
  for (const baris of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(baris.trim());
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

// ---------------------------------------------------------------- acak deterministik
let benih = 20260913;
function acak() {
  benih = (benih + 0x6d2b79f5) | 0;
  let t = Math.imul(benih ^ (benih >>> 15), 1 | benih);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const antara = (a, b) => a + Math.floor(acak() * (b - a + 1));
const pilih = (arr) => arr[Math.floor(acak() * arr.length)];
const peluang = (p) => acak() < p;
const bulat = (n, k = 1000) => Math.round(n / k) * k;
function uuid(kunci) {
  const h = crypto.createHash('md5').update(`gnnk:${STORE}:${KUNCI === 'v1' ? '' : `${KUNCI}:`}${kunci}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
function ean13(dua12) {
  const s = dua12.split('').reduce((a, d, i) => a + Number(d) * (i % 2 ? 3 : 1), 0);
  return dua12 + ((10 - (s % 10)) % 10);
}
function pilihBerat(daftar, bobot) {
  const total = daftar.reduce((a, x) => a + bobot(x), 0);
  let r = acak() * total;
  for (const x of daftar) {
    r -= bobot(x);
    if (r <= 0) return x;
  }
  return daftar[daftar.length - 1];
}
/** Kunci pencocokan SKU: huruf besar, tanpa tanda baca ('G-415/12-36Black+R' = 'G-415/12-36-Black+R'). */
const kunciSku = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const SEKARANG = new Date();
function hariLalu(h, jam = 10, menit = 0) {
  const d = new Date(SEKARANG);
  d.setDate(d.getDate() - h);
  d.setHours(jam, menit, antara(0, 59), 0);
  return d > SEKARANG ? new Date(SEKARANG.getTime() - antara(5, 90) * 60000) : d;
}
const tambahHari = (d, n) => new Date(d.getTime() + n * 86400000);
const tgl = (d) => d.toISOString().slice(0, 10);
const yymmdd = (d) => tgl(d).slice(2).replace(/-/g, '');

// ---------------------------------------------------------------- SQL
function lit(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
}
async function sisip(db, tabel, baris) {
  if (!baris.length) return;
  const kolom = Object.keys(baris[0]);
  for (let i = 0; i < baris.length; i += 250) {
    const nilai = baris
      .slice(i, i + 250)
      .map((b) => `(${kolom.map((k) => lit(b[k])).join(', ')})`)
      .join(',\n');
    await db.query(`insert into public.${tabel} (${kolom.join(', ')}) values\n${nilai}`);
  }
}
async function ubah(db, tabel, id, kolom) {
  const set = Object.entries(kolom).map(([k, v]) => `${k} = ${lit(v)}`).join(', ');
  await db.query(`update public.${tabel} set ${set} where id = ${lit(id)}`);
}

// ---------------------------------------------------------------- katalog
const katalog = JSON.parse(fs.readFileSync(path.join(__dirname, 'katalog-gnnk.json'), 'utf8'));
const TOKO = katalog.toko;

const KATEGORI = [
  ['Gear Set Yamaha Fiz R / RX King', 'boxes'],
  ['Gear Set Yamaha MX King', 'boxes'],
  ['Gear Set Yamaha WR155', 'boxes'],
  ['Gear Set Honda CRF150', 'boxes'],
  ['Gear Set Kawasaki KLX150', 'boxes'],
  ['Gear Set Honda Supra X 125 / Kharisma', 'boxes'],
  ['Gear Set Suzuki Satria 2 Tak', 'boxes'],
  ['Gear Set Supermoto', 'boxes'],
  ['Gear Belakang', 'circle-dot'],
  ['Gear Depan', 'circle'],
  ['Rantai', 'link'],
];
const MOTOR = [
  'Yamaha Fiz R, RX King, Force 1, Jupiter Z',
  'Yamaha MX King 150, Jupiter MX 150',
  'Yamaha WR155',
  'Honda CRF150L',
  'Kawasaki KLX150',
  'Honda Supra X 125, Kharisma, Revo',
  'Suzuki Satria 2 Tak (Satria Hiu, Lumba)',
  'Kawasaki KLX150, Honda CRF150L, Yamaha WR155',
  'Yamaha Fiz R, RX King, Jupiter Z',
  'Yamaha Fiz R, RX King, Jupiter Z',
  'Yamaha Fiz R, RX King, Jupiter Z, Honda Supra, Suzuki Satria',
];
function kategoriUntuk(nama) {
  if (/^gear belakang/i.test(nama)) return 8;
  if (/^gear depan/i.test(nama)) return 9;
  if (/^rantai/i.test(nama)) return 10;
  if (/fiz\s*r|rx\s*king/i.test(nama)) return 0;
  if (/mx\s*king/i.test(nama)) return 1;
  if (/wr\s*155/i.test(nama)) return 2;
  if (/crf/i.test(nama)) return 3;
  if (/klx/i.test(nama)) return 4;
  if (/supra|kharisma/i.test(nama)) return 5;
  if (/satria/i.test(nama)) return 6;
  return 7;
}
const tipeRantai = (t) => (/520/.test(t) ? '520' : /428/.test(t) ? '428' : '415');
function warna(t) {
  if (/black|hitam/i.test(t)) return 'Hitam';
  if (/orange|ornge/i.test(t)) return 'Oranye';
  if (/blue|biru/i.test(t)) return 'Biru';
  if (/red|merah/i.test(t)) return 'Merah';
  if (/gold/i.test(t)) return 'Emas';
  return 'Hitam';
}
function material(t) {
  if (/alloy\s*baja|alloy\+b|\+bja|\d{2}ab/i.test(t)) return 'Alloy + Baja';
  if (/alloy/i.test(t)) return 'Aluminium Alloy';
  return 'Baja';
}
function ukuran(nilai, jenis) {
  let m = /\d{3}\/(\d{1,2})-(\d{2})/.exec(nilai);
  if (m) return { depan: +m[1], belakang: +m[2] };
  m = /-(\d{1,2})-(\d{2})/.exec(nilai);
  if (m && jenis === 'set') return { depan: +m[1], belakang: +m[2] };
  m = /\d{3}-(\d{2})/.exec(nilai);
  if (m) return jenis === 'depan' ? { depan: +m[1] } : { belakang: +m[1] };
  return {};
}
const teksUkuran = (u) =>
  [u.depan && `Depan ${u.depan}T`, u.belakang && `Belakang ${u.belakang}T`].filter(Boolean).join(' / ') || 'Standar';
const slug = (s) => s.replace(/[^A-Za-z0-9+/-]+/g, '-').replace(/^-|-$/g, '').toUpperCase();
const jenisDariKategori = (kat) => (kat === 8 ? 'belakang' : kat === 9 ? 'depan' : kat === 10 ? 'rantai' : 'set');

/** Kolom deskriptif produk (dipakai untuk produk situs maupun produk client yang dilengkapi). */
function kolomDeskripsi({ nama, nilai, kat, jenis, deskripsi, ringkas, galeri, urut }) {
  const u = ukuran(nilai, jenis);
  const teks = `${nama} ${nilai}`;
  const tipe = tipeRantai(teks);
  const mat = material(teks);
  const wrn = warna(teks);
  const isiKotak =
    jenis === 'belakang'
      ? '1 pcs Gear Belakang'
      : jenis === 'depan'
        ? '1 pcs Gear Depan'
        : jenis === 'rantai'
          ? `1 pcs Rantai ${tipe}`
          : /\+r\b|\+r$|\+be|rantai/i.test(teks) || kat !== 7
            ? `1 pcs Gear Depan, 1 pcs Gear Belakang, 1 pcs Rantai ${tipe}`
            : '1 pcs Gear Depan, 1 pcs Gear Belakang';
  const dim = jenis === 'set' ? [30, 25, 8] : jenis === 'belakang' ? [22, 22, 2] : jenis === 'rantai' ? [15, 10, 5] : [8, 8, 3];
  return {
    description: deskripsi || `${nama}. Produk asli GNNK Racing, presisi dan awet untuk harian maupun balap.`,
    brand: 'GNNK Racing',
    images: galeri,
    spec: [
      { label: 'Tipe Rantai', value: tipe },
      { label: 'Material', value: jenis === 'rantai' ? 'Baja karbon' : mat },
      { label: 'Warna', value: wrn },
      { label: 'Motor', value: MOTOR[kat] },
      { label: jenis === 'rantai' ? 'Panjang' : 'Ukuran Gear', value: jenis === 'rantai' ? (/(\d{3})\s*l/i.exec(teks)?.[1] ?? '130') + ' mata' : teksUkuran(u) },
      { label: 'Negara Asal', value: 'Indonesia' },
    ],
    variant_label: 'Ukuran',
    warranty_type: 'Garansi Toko',
    warranty_period: '7 Hari',
    box_contents: isiKotak,
    highlights: [
      'Cocok untuk harian, touring, drag race, road race, dan kontes',
      'Teruji ringan, kuat, dan presisi saat dipasang',
      `Material ${(jenis === 'rantai' ? 'baja karbon' : mat).toLowerCase()} dengan finishing warna ${wrn.toLowerCase()}`,
      'Produk asli GNNK Racing, bisa bayar di tempat (COD)',
    ].join('\n'),
    license_type: 'Produk Lokal Indonesia',
    video_url: TOKO.video[urut % TOKO.video.length],
    length_cm: dim[0],
    width_cm: dim[1],
    height_cm: dim[2],
    _ringkas: ringkas,
  };
}

function bangunProduk() {
  const hasil = [];
  const skuDipakai = new Set();
  let nomorBarcode = 1;
  const skuUnik = (dasar) => {
    let s = dasar;
    for (let i = 2; skuDipakai.has(s.toUpperCase()); i++) s = `${dasar}-${i}`;
    skuDipakai.add(s.toUpperCase());
    return s;
  };
  const tambah = (p, v, meta) => {
    const desk = kolomDeskripsi({
      nama: p.nama, nilai: v.nilai, kat: meta.kat, jenis: meta.jenis,
      deskripsi: [p.deskripsi, p.ringkas].filter(Boolean).join('\n\n'), galeri: meta.galeri, urut: hasil.length,
    });
    delete desk._ringkas;
    hasil.push({
      row: {
        id: uuid(`produk-${meta.kunci}`),
        store_id: STORE,
        category_id: null,
        name: p.nama,
        image_url: meta.gambar,
        base_price: meta.harga,
        sizes: [],
        is_active: true,
        sku: skuUnik(meta.sku),
        barcode: ean13(`899${String(20260000 + nomorBarcode++).padStart(9, '0')}`),
        cost_price: bulat(meta.harga * (0.55 + acak() * 0.07)),
        stock_qty: 0,
        min_stock: 3,
        track_stock: true,
        created_at: hariLalu(HARI + 30 - Math.min(20, hasil.length % 21)),
        weight_gram: v.berat || p.berat || (meta.jenis === 'set' ? 1000 : meta.jenis === 'belakang' ? 300 : 100),
        variant_name: meta.varian,
        compare_at_price: v.harga_coret > meta.harga ? v.harga_coret : bulat(meta.harga * 1.25, 5000),
        license_code: `GNNK-${p.id}`,
        ...desk,
      },
      jenis: meta.jenis,
      kat: meta.kat,
      tautan: p.tautan,
      stokAda: v.stok_ada !== false && p.stok_ada !== false,
      bobot: (meta.jenis === 'set' ? 6 : 3) + antara(0, 6),
      supplier: meta.jenis === 'depan' ? 0 : material(`${p.nama} ${v.nilai}`) === 'Baja' ? (warna(`${p.nama} ${v.nilai}`) === 'Hitam' ? 5 : 0) : 1,
      set: false,
      stokLama: 0,
      baru: true,
    });
  };

  for (const p of katalog.produk) {
    const kat = kategoriUntuk(p.nama);
    const hitung = {};
    for (const v of p.variasi) hitung[v.nilai] = (hitung[v.nilai] ?? 0) + 1;
    let urutGanda = 0;
    const jenisDari = (v) => (kat === 8 || /^gb[-\s]/i.test(v.nilai) ? 'belakang' : 'set');
    // Harga kosong di situs diisi median harga variasi sejenis dari produk yang sama.
    const median = (arr) => (arr.length ? [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)] : 0);
    const hargaSejenis = (jenis) => median(p.variasi.filter((x) => x.harga > 0 && jenisDari(x) === jenis).map((x) => x.harga));
    const variasi = p.variasi.length ? p.variasi : [{ id: p.id, sku: p.sku, nilai: p.sku || 'Standar', harga: p.harga, harga_coret: p.harga_coret, gambar: null, berat: p.berat, stok_ada: p.stok_ada }];
    for (const v of variasi) {
      const jenis = jenisDari(v);
      let nilai = v.nilai;
      // Gear Set Supermoto di situs tidak menamai variasinya: diberi ukuran 428 yang umum.
      if (hitung[v.nilai] > 1) {
        const d = [13, 14, 15][urutGanda % 3];
        const b = 40 + Math.floor(urutGanda / 3);
        urutGanda++;
        nilai = `SET-SM-428/${d}-${b}`;
      }
      const harga = v.harga || hargaSejenis(jenis) || p.harga || (jenis === 'set' ? 385000 : 185000);
      const skuSitus = v.sku && v.sku !== p.sku && !p.variasi.some((x) => x !== v && x.sku === v.sku);
      tambah(p, { ...v, nilai }, {
        kunci: `${p.id}-${v.id}`,
        kat,
        jenis,
        varian: nilai,
        sku: skuSitus ? v.sku : slug(nilai),
        harga,
        gambar: v.gambar || p.gambar[0],
        galeri: p.gambar.length > 1 ? p.gambar.filter((g) => g !== (v.gambar || p.gambar[0])) : p.gambar.slice(0, 1),
      });
    }
  }

  // Gear depan dari berkas impor client (docs/impor-produk-gnnk-fizr.csv); harga & foto contoh.
  const csv = fs.readFileSync(path.join(ROOT, 'docs', 'impor-produk-gnnk-fizr.csv'), 'utf8').replace(/^﻿/, '').split(/\r?\n/);
  const kepala = csv[1].split(';');
  const fotoFiz = katalog.produk.find((p) => /Fiz R Rx King Black/i.test(p.nama) && /^Gear Set/i.test(p.nama));
  for (const baris of csv.slice(2)) {
    const kol = Object.fromEntries(baris.split(';').map((x, i) => [kepala[i], x]));
    if (kol.kategori !== 'GEAR-DEPAN-FIZR-BLACK') continue;
    const mata = Number(/-(\d{2})-/.exec(kol.sku)?.[1] ?? 14);
    const p = {
      id: `depan-${mata}`,
      nama: 'Gear Depan Yamaha Fiz R Rx King GNNK Racing Product',
      deskripsi: `Gear Depan Yamaha Fiz R / RX King GNNK Racing Product tipe 415, ${mata} mata. Bahan baja warna black, presisi dan awet untuk harian maupun balap.`,
      ringkas: 'Teruji untuk harian maupun balap road / drag race.',
      gambar: fotoFiz ? fotoFiz.gambar : [],
      berat: Number(kol.berat_gram) || 100,
      tautan: fotoFiz?.tautan,
      stok_ada: true,
    };
    tambah(p, { id: kol.sku, nilai: `${mata}T`, harga_coret: 0, berat: p.berat, stok_ada: true }, {
      kunci: `depan-${kol.sku}`,
      kat: 9,
      jenis: 'depan',
      varian: `${mata}T`,
      sku: kol.sku,
      harga: 45000 + (mata - 12) * 5000,
      gambar: p.gambar[0] ?? TOKO.logo,
      galeri: p.gambar.slice(1, 3),
    });
  }
  return hasil;
}

// ---------------------------------------------------------------- data pendukung
const SUPPLIER = [
  ['CV Mitra Bubut CNC Sidoarjo', 'Hendra Wijaya', '081231450911', 'mitrabubut.cnc@gmail.com', 'Jl. Raya Berbek No. 21, Waru, Sidoarjo', 30, 30, 'Maklon bubut dan potong gear baja (gear depan dan belakang).'],
  ['PT Alloy Presisi Nusantara', 'Ratna Sari', '081332870414', 'sales@alloypresisi.co.id', 'Kawasan Industri SIER Blok C-12, Surabaya', 30, 50, 'Gear aluminium alloy 7075 untuk seri Alloy dan Alloy Baja.'],
  ['PT Rantai Indo Perkasa', 'Yusuf Hidayat', '081515209871', 'order@rantaiindo.co.id', 'Jl. Industri Raya No. 8, Cikarang, Bekasi', 14, 0, 'Rantai 415, 428, dan 520 untuk isi gear set.'],
  ['CV Warna Anodize Mandiri', 'Dimas Pratama', '085732114450', 'anodize.mandiri@gmail.com', 'Jl. Gedangan Permai No. 4, Sidoarjo', 7, 0, 'Jasa anodize warna black, orange, red, blue, dan gold.'],
  ['CV Surya Kemasan Jaya', 'Lina Kurniawati', '081938665102', 'suryakemasan@gmail.com', 'Jl. Kenjeran No. 112, Surabaya', 14, 0, 'Box dan stiker kemasan GNNK Racing.'],
  ['PT Baja Gear Sentosa', 'Anton Setiawan', '082140773190', 'bajagear.sentosa@gmail.com', 'Jl. Raya Taman No. 55, Sidoarjo', 30, 30, 'Gear baja hitam (black oxide) seri harian.'],
];
const KOTA = ['Kab. Sidoarjo', 'Kota Surabaya', 'Kota Malang', 'Kab. Gresik', 'Kota Semarang', 'Kota Yogyakarta', 'Kota Bandung', 'Kota Bekasi', 'Kota Depok', 'Jakarta Timur', 'Kota Denpasar', 'Kota Makassar'];
const JALAN = ['Raya Darmo', 'Ahmad Yani', 'Diponegoro', 'Gatot Subroto', 'Pahlawan', 'Sudirman', 'Merdeka', 'Veteran', 'Kartini', 'Pemuda', 'Imam Bonjol', 'Hasanuddin'];
const PEMBELI = ['Andi Saputra', 'Rudi Hartono', 'Fajar Nugraha', 'Dimas Aditya', 'Bayu Prasetyo', 'Eko Wahyudi', 'Rizal Maulana', 'Agus Salim', 'Yoga Pratama', 'Hendra Gunawan', 'Wahyu Kurniawan', 'Ilham Ramadhan'];
const CATATAN = {
  offline: ['Beli langsung di toko', 'Pasang di tempat', 'Ambil sendiri di toko'],
  shopee: ['Kirim SPX Standard', 'Kirim J&T Express'],
  tiktok: ['Kirim J&T Express', 'Kirim JNE REG'],
  tokopedia: ['Kirim SiCepat REG', 'Kirim AnterAja'],
  website: ['Kirim JNE REG', 'Kirim J&T Express'],
  whatsapp: ['Kirim JNE YES', 'Kirim J&T Express'],
};
const TAG = ['Barang bagus', 'Dikemas dengan baik', 'Penjual ramah', 'Kualitas tinggi', 'Performa bagus', 'Tiba lebih awal'];
const ULASAN = {
  5: ['Presisi saat dipasang di motor, tarikan jadi enteng.', 'Kualitas mantap, finishing rapi dan warnanya sesuai foto.', 'Sudah dipakai harian seminggu, halus dan tidak berisik.', 'Pengiriman cepat, packing aman pakai box. Recommended!', 'Ukuran sesuai pesanan, admin responsif waktu tanya ukuran.'],
  4: ['Barang bagus, cuma pengiriman agak lama.', 'Kualitas oke untuk harga segini, pemasangan lancar.', 'Warna bagus, rantai bawaan juga lumayan.'],
  3: ['Barang sesuai, tapi box agak penyok saat sampai.', 'Lumayan, perlu sedikit penyesuaian waktu pasang.'],
};
const BALASAN = ['Terima kasih sudah belanja di GNNK Racing, Kak. Semoga awet dan makin kencang!', 'Terima kasih ulasannya, Kak. Ditunggu order berikutnya.', 'Terima kasih masukannya, Kak. Kami tingkatkan lagi pengemasannya.'];

/** Kategori & nama barang kafe dari data demo lama. Produk di kategori ini yang namanya gear/rantai tetap milik client. */
const KATEGORI_KAFE = ['Apparel & Kaos Barista', 'Bahan Baku & Biji Kopi Roastery', 'Kopi & Minuman Espresso', 'Makanan Utama & Rice Bowl', 'Merchandise & Tumbler', 'Non-Kopi & Teh Artisan', 'Pastry & Bakery Oven', 'Snack & Makanan Ringan'];
const BUKAN_KAFE = '(gear|rantai|fiz|gnnk|sprocket)';

const TANDA_TANGAN = `data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80"><path d="M10 55 C 40 10, 60 75, 90 35 S 140 20, 150 50 S 200 60, 230 25" fill="none" stroke="#1f2a44" stroke-width="3" stroke-linecap="round"/></svg>',
).toString('base64')}`;

// ---------------------------------------------------------------- penghapusan
async function hapusLokal(db) {
  for (const q of [
    'delete from public.product_reviews where store_id = $1',
    'delete from public.product_questions where store_id = $1',
    'delete from public.loyalty_transactions where store_id = $1',
    'delete from public.order_returns where store_id = $1',
    'delete from public.stock_movements where store_id = $1',
    'delete from public.orders where store_id = $1',
    'delete from public.cash_movements where store_id = $1',
    'update public.expenses set shift_id = null where store_id = $1',
    'delete from public.shifts where store_id = $1',
    'delete from public.stock_opnames where store_id = $1',
    'delete from public.purchases where store_id = $1',
    'delete from public.supplier_product_mappings where store_id = $1',
    'delete from public.product_channel_mappings where store_id = $1',
    'delete from public.product_components where store_id = $1',
    'delete from public.products where store_id = $1',
    'delete from public.suppliers where store_id = $1',
    'delete from public.categories where store_id = $1',
    "delete from public.customers where store_id = $1 and user_id is null and name like 'Pelanggan Uji%'",
    "delete from public.sales_channels where store_id = $1 and code like 'uji-%'",
  ]) {
    await db.query(q, [STORE]);
  }
}

/** Hanya barang kafe dan transaksi yang isinya barang kafe saja. Data client tidak disentuh. */
async function hapusKafe(db) {
  await db.query(
    `create temp table kafe_produk on commit drop as
       select p.id from public.products p join public.categories c on c.id = p.category_id
        where p.store_id = $1 and c.name = any($2) and p.name !~* $3`,
    [STORE, KATEGORI_KAFE, BUKAN_KAFE],
  );
  await db.query(
    `create temp table kafe_pesanan on commit drop as
       select o.id from public.orders o
        where o.store_id = $1
          and exists (select 1 from public.order_items i where i.order_id = o.id and i.product_id in (select id from kafe_produk))
          -- Baris tanpa produk di pesanan kafe adalah barang kafe yang produknya sudah terhapus;
          -- pesanan tetap milik client bila ada SATU saja baris yang menunjuk produk bukan kafe.
          and not exists (select 1 from public.order_items i where i.order_id = o.id and i.product_id is not null and i.product_id not in (select id from kafe_produk))`,
    [STORE],
  );
  await db.query(
    `create temp table kafe_beli on commit drop as
       select p.id from public.purchases p
        where p.store_id = $1
          and exists (select 1 from public.purchase_items i where i.purchase_id = p.id and i.product_id in (select id from kafe_produk))
          and not exists (select 1 from public.purchase_items i where i.purchase_id = p.id and (i.product_id is null or i.product_id not in (select id from kafe_produk)))`,
    [STORE],
  );
  const jumlah = (await db.query('select (select count(*) from kafe_produk) p, (select count(*) from kafe_pesanan) o, (select count(*) from kafe_beli) b')).rows[0];
  for (const q of [
    'delete from public.product_reviews where order_id in (select id from kafe_pesanan) or product_id in (select id from kafe_produk)',
    'delete from public.product_questions where product_id in (select id from kafe_produk)',
    'delete from public.loyalty_transactions where ref_order_id in (select id from kafe_pesanan)',
    'delete from public.order_returns where order_id in (select id from kafe_pesanan)',
    "delete from public.cash_movements where note in (select 'Order ' || id::text from kafe_pesanan)",
    'delete from public.stock_movements where ref_order_id in (select id from kafe_pesanan) or product_id in (select id from kafe_produk)',
    'delete from public.orders where id in (select id from kafe_pesanan)',
    'delete from public.purchases where id in (select id from kafe_beli)',
    'delete from public.stock_opname_items where product_id in (select id from kafe_produk)',
    'delete from public.supplier_product_mappings where product_id in (select id from kafe_produk)',
    'delete from public.product_channel_mappings where product_id in (select id from kafe_produk)',
    'delete from public.product_components where parent_product_id in (select id from kafe_produk) or component_product_id in (select id from kafe_produk)',
    'delete from public.products where id in (select id from kafe_produk)',
  ]) {
    await db.query(q);
  }
  await db.query(
    `delete from public.suppliers s where s.store_id = $1
        and not exists (select 1 from public.purchases p where p.supplier_id = s.id)
        and s.name <> all($2)`,
    [STORE, SUPPLIER.map((x) => x[0])],
  );
  await db.query("delete from public.sales_channels where store_id = $1 and code like 'uji-%'", [STORE]);
  return jumlah;
}

// ---------------------------------------------------------------- utama
async function utama() {
  if (!/^[0-9a-f-]{36}$/i.test(STORE)) throw new Error('Pakai: --store <uuid toko> [--mode produksi --db <url>] [--hari 45] [--ya]');
  const env = bacaEnv();
  const url = opsi('db', '') || env.DATABASE_URL;
  const db = new Client({
    connectionString: url,
    // Server di luar mesin ini (mis. Supabase) memakai SSL; Postgres lokal tidak.
    ssl: !/@(localhost|127\.0\.0\.1)[:/]/.test(url) || env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
  await db.connect();
  await db.query('begin');
  try {
    const toko = (await db.query('select id from public.stores where id = $1', [STORE])).rows[0];
    if (!toko) throw new Error('Toko tidak ditemukan.');
    const staf = (await db.query(`select id, role from public.profiles where store_id = $1 and role in ('admin','cashier') order by created_at`, [STORE])).rows;
    const admin = staf.find((s) => s.role === 'admin')?.id ?? null;
    const kasir = staf.find((s) => s.role === 'cashier')?.id ?? admin;

    // Di produksi data contoh hanya boleh dibuat sekali (data client tidak dihapus ulang).
    if (PRODUKSI && (await db.query('select 1 from public.orders where id = $1', [uuid(`order-${HARI}-0`)])).rowCount) {
      throw new Error(`Data contoh dengan kunci "${KUNCI}" sudah pernah dibuat di toko ini. Pakai --kunci lain bila memang ingin menambah lagi.`);
    }

    // ---------- 1. hapus ----------
    const terhapus = PRODUKSI ? await hapusKafe(db) : (await hapusLokal(db), null);

    // ---------- 2. profil toko, promo, pelanggan ----------
    await db.query(
      `update public.stores set
         name = 'GNNK Racing',
         address = coalesce(nullif(address, ''), 'Jl. Raya Industri No. 45, Sidoarjo, Jawa Timur'),
         logo_url = coalesce(nullif(logo_url, ''), $2),
         receipt_header = coalesce(nullif(receipt_header, ''), 'GNNK RACING' || chr(10) || 'Gear Set & Sparepart Motor' || chr(10) || 'WA 0812-9631-9445'),
         receipt_footer = coalesce(nullif(receipt_footer, ''), 'Terima kasih sudah berbelanja.' || chr(10) || 'Klaim garansi maksimal 7 hari setelah barang diterima.'),
         shop_phone = coalesce(nullif(shop_phone, ''), $3),
         shop_city = coalesce(nullif(shop_city, ''), 'Kab. Sidoarjo'),
         return_policy = coalesce(nullif(return_policy, ''), '100% Original GNNK Racing' || chr(10) || 'Pengembalian 7 Hari' || chr(10) || 'Tukar ukuran jika tidak cocok'),
         warranty_info = coalesce(nullif(warranty_info, ''), 'Garansi toko 7 hari'),
         pdp_banner_url = coalesce(nullif(pdp_banner_url, ''), $4),
         invoice_signer_name = coalesce(nullif(invoice_signer_name, ''), 'Admin GNNK Racing'),
         invoice_signature_url = coalesce(nullif(invoice_signature_url, ''), $5)
       where id = $1`,
      [STORE, TOKO.logo, TOKO.wa, TOKO.banner[0], TANDA_TANGAN],
    );
    await db.query(
      `update public.promos set start_date = coalesce(start_date, current_date - 30),
         end_date = coalesce(end_date, current_date + 60), is_active = coalesce(is_active, true)
       where store_id = $1`,
      [STORE],
    );
    const kotaArr = `array[${KOTA.map(lit).join(',')}]`;
    const jalanArr = `array[${JALAN.map(lit).join(',')}]`;
    await db.query(
      `update public.customers c set
         phone = coalesce(nullif(c.phone, ''), '08' || (11 + abs(hashtext(c.id::text)) % 89)::text || lpad((abs(hashtext(c.id::text || 'p')) % 100000000)::text, 8, '0')),
         location = coalesce(nullif(c.location, ''), (${kotaArr})[1 + abs(hashtext(c.id::text || 'l')) % ${KOTA.length}]),
         email = coalesce(nullif(c.email, ''), btrim(lower(regexp_replace(c.name, '[^A-Za-z]+', '.', 'g')), '.') || (10 + abs(hashtext(c.id::text)) % 90)::text || '@gmail.com'),
         joined_date = coalesce(c.joined_date, (now() - make_interval(days => 30 + abs(hashtext(c.id::text || 'j')) % 300))::date),
         is_active = coalesce(c.is_active, true)
       where c.store_id = $1`,
      [STORE],
    );
    await db.query(
      `update public.customers c set address = coalesce(nullif(c.address, ''),
         'Jl. ' || (${jalanArr})[1 + abs(hashtext(c.id::text || 'a')) % ${JALAN.length}] || ' No. ' || (1 + abs(hashtext(c.id::text || 'n')) % 150)::text || ', ' || c.location)
       where c.store_id = $1`,
      [STORE],
    );
    const pelanggan = (await db.query('select id, name, phone, address from public.customers where store_id = $1 and user_id is null order by name', [STORE])).rows;

    // ---------- 3. kategori ----------
    const produk = bangunProduk();
    const katId = new Map();
    const pakaiKategori = async (i) => {
      if (katId.has(i)) return katId.get(i);
      const [name, icon] = KATEGORI[i];
      let id = PRODUKSI ? (await db.query('select id from public.categories where store_id = $1 and name = $2 limit 1', [STORE, name])).rows[0]?.id : null;
      if (!id) {
        id = uuid(`kategori-${i}`);
        await sisip(db, 'categories', [{ id, store_id: STORE, name, icon, sort_order: i + 1, created_at: hariLalu(HARI + 40) }]);
      } else {
        await db.query('update public.categories set icon = $2, sort_order = $3 where id = $1', [id, icon, i + 1]);
      }
      katId.set(i, id);
      return id;
    };
    for (const p of produk) p.row.category_id = await pakaiKategori(p.kat);

    // ---------- 4. produk ----------
    const semuaProduk = [...produk];
    if (!PRODUKSI) {
      await sisip(db, 'products', produk.map((p) => p.row)); // stok diperbarui di langkah 7
    } else {
      const lama = (await db.query(
        `select p.id, p.sku, p.name, p.image_url, p.base_price, p.cost_price, p.stock_qty, p.barcode, p.weight_gram,
                exists (select 1 from public.product_components c where c.parent_product_id = p.id) as set_induk
           from public.products p where p.store_id = $1`,
        [STORE],
      )).rows;
      const perKunci = new Map(lama.filter((x) => x.sku).map((x) => [kunciSku(x.sku), x]));
      const dipakai = new Set();
      const baru = [];
      for (const p of produk) {
        const ada = perKunci.get(kunciSku(p.row.sku));
        if (!ada || dipakai.has(ada.id)) {
          baru.push(p);
          continue;
        }
        dipakai.add(ada.id);
        // Produk client dipertahankan: id, foto, harga, modal, barcode, dan beratnya.
        p.row.id = ada.id;
        p.row.sku = ada.sku;
        p.row.image_url = ada.image_url || p.row.image_url;
        p.row.base_price = Number(ada.base_price) > 0 ? Number(ada.base_price) : p.row.base_price;
        p.row.cost_price = Number(ada.cost_price) > 0 ? Number(ada.cost_price) : bulat(p.row.base_price * 0.58);
        p.row.barcode = ada.barcode || p.row.barcode;
        p.row.weight_gram = Number(ada.weight_gram) > 0 ? Number(ada.weight_gram) : p.row.weight_gram;
        p.baru = false;
        p.set = ada.set_induk;
        p.stokLama = Number(ada.stock_qty) || 0;
        const { id, store_id: _s, created_at: _c, stock_qty: _q, ...kolom } = p.row;
        await ubah(db, 'products', id, kolom);
      }
      await sisip(db, 'products', baru.map((p) => p.row));

      // Produk client yang tidak ada di situs dilengkapi dari keluarga produk situs yang paling mirip.
      for (const x of lama.filter((l) => !dipakai.has(l.id))) {
        const kat = kategoriUntuk(x.name);
        const jenis = jenisDariKategori(kat);
        const kataX = new Set(x.name.toLowerCase().split(/\W+/));
        const keluarga = produk
          .filter((p) => p.kat === kat)
          .map((p) => ({ p, skor: p.row.name.toLowerCase().split(/\W+/).filter((k) => kataX.has(k)).length }))
          .sort((a, b) => b.skor - a.skor)[0]?.p;
        const nilai = x.sku || x.name;
        const desk = kolomDeskripsi({
          nama: keluarga && x.sku ? keluarga.row.name : x.name, nilai, kat, jenis,
          deskripsi: keluarga?.row.description, galeri: keluarga?.row.images ?? (x.image_url ? [x.image_url] : []), urut: semuaProduk.length,
        });
        delete desk._ringkas;
        const harga = Number(x.base_price) > 0 ? Number(x.base_price) : keluarga?.row.base_price || (jenis === 'rantai' ? 165000 : jenis === 'depan' ? 55000 : 385000);
        const row = {
          id: x.id,
          name: keluarga && x.sku ? keluarga.row.name : x.name.trim(),
          category_id: await pakaiKategori(kat),
          image_url: x.image_url || keluarga?.row.image_url || TOKO.logo,
          base_price: harga,
          cost_price: Number(x.cost_price) > 0 ? Number(x.cost_price) : bulat(harga * 0.58),
          compare_at_price: bulat(harga * 1.25, 5000),
          barcode: x.barcode || ean13(`899${String(20270000 + semuaProduk.length).padStart(9, '0')}`),
          weight_gram: Number(x.weight_gram) > 0 ? Number(x.weight_gram) : jenis === 'set' ? 1000 : jenis === 'belakang' ? 300 : jenis === 'rantai' ? 500 : 100,
          variant_name: x.sku ? x.sku.trim() : 'Standar',
          license_code: `GNNK-${String(x.sku || x.id).trim()}`,
          is_active: true,
          ...desk,
        };
        await ubah(db, 'products', x.id, row);
        semuaProduk.push({
          row: { ...row, sku: x.sku }, jenis, kat, tautan: null, stokAda: true, bobot: 3 + antara(0, 4),
          supplier: jenis === 'rantai' ? 2 : 0, set: x.set_induk, stokLama: Number(x.stock_qty) || 0, baru: false,
        });
      }
      // Kategori lama client yang kini kosong dibuang.
      await db.query(
        `delete from public.categories c where c.store_id = $1 and c.id <> all($2::uuid[])
            and not exists (select 1 from public.products p where p.category_id = c.id)`,
        [STORE, [...katId.values()]],
      );
    }

    // ---------- 5. supplier & pemetaan ----------
    const supplierId = [];
    for (let i = 0; i < SUPPLIER.length; i++) {
      const s = SUPPLIER[i];
      const ada = (await db.query('select id from public.suppliers where store_id = $1 and name = $2 limit 1', [STORE, s[0]])).rows[0]?.id;
      supplierId.push(ada ?? uuid(`supplier-${i}`));
      if (!ada) {
        await sisip(db, 'suppliers', [{
          id: supplierId[i], store_id: STORE, name: s[0], contact_name: s[1], phone: s[2], email: s[3], address: s[4],
          default_term_days: s[5], default_dp_percent: s[6], notes: s[7], is_active: true, created_at: hariLalu(HARI + 40), currency: 'IDR', exchange_rate: 1,
        }]);
      }
    }
    const kanal = (await db.query('select code, default_term_days from public.sales_channels where store_id = $1 and is_active', [STORE])).rows;
    const tempo = Object.fromEntries(kanal.map((k) => [k.code, Number(k.default_term_days) || 0]));
    const promo = (await db.query('select code, type, value from public.promos where store_id = $1 and is_active', [STORE])).rows;
    const adaSpm = new Set((await db.query('select product_id from public.supplier_product_mappings where store_id = $1', [STORE])).rows.map((r) => r.product_id));
    const adaPcm = new Set((await db.query('select product_id || channel_code as k from public.product_channel_mappings where store_id = $1', [STORE])).rows.map((r) => r.k));
    await sisip(db, 'supplier_product_mappings', semuaProduk.filter((p) => !adaSpm.has(p.row.id)).map((p) => ({
      id: uuid(`spm-${p.row.id}`), store_id: STORE, supplier_id: supplierId[p.supplier], product_id: p.row.id, supplier_sku: `SUP-${p.row.sku || p.row.id.slice(0, 8)}`,
      supplier_barcode: p.row.barcode, supplier_product_name: `${p.row.name} ${p.row.variant_name}`, last_cost_price: p.row.cost_price, currency: 'IDR', created_at: hariLalu(HARI + 25),
    })));
    const urlKanal = (k, p) =>
      k === 'website' ? p.tautan || 'https://gnnkracing.id/shop/'
        : k === 'tiktok' ? TOKO.tiktok
          : k === 'shopee' ? `https://shopee.co.id/search?keyword=${encodeURIComponent(`${p.row.name} ${p.row.variant_name}`)}`
            : `https://www.tokopedia.com/search?q=${encodeURIComponent(`${p.row.name} ${p.row.variant_name}`)}`;
    await sisip(db, 'product_channel_mappings', semuaProduk.filter((p) => p.row.sku).flatMap((p) =>
      ['shopee', 'tiktok', 'tokopedia', 'website'].filter((k) => k in tempo && !adaPcm.has(p.row.id + k)).map((k) => ({
        id: uuid(`pcm-${p.row.id}-${k}`), store_id: STORE, product_id: p.row.id, channel_code: k, external_sku: p.row.sku,
        external_url: urlKanal(k, p), is_synced: true, last_synced_at: hariLalu(antara(0, 3)), created_at: hariLalu(HARI + 25),
      }))));

    // ---------- 6. shift (lokal saja; di produksi shift & kas client tidak disentuh) ----------
    const shift = [];
    if (!PRODUKSI) {
      for (let h = HARI; h >= 0; h--) {
        // Semua shift contoh ditutup: kasir yang login membuka shift-nya sendiri.
        const tutup = h === 0 ? new Date(SEKARANG.getTime() - 20 * 60000) : hariLalu(h, 21, 0);
        shift.push({ h, id: uuid(`shift-${h}`), buka: hariLalu(h, 8, 0), tutup, penjualan: 0, tunai: 0, jumlah: 0 });
      }
    }
    const shiftHari = new Map(shift.map((s) => [s.h, s]));

    // ---------- 7. pesanan ----------
    // Produk set (isinya dihitung dari barang lain) tidak ikut dijual/dibeli di data contoh.
    const bisaDijual = semuaProduk.filter((p) => p.stokAda && !p.set);
    const orders = [];
    const items = [];
    const bayar = [];
    const poin = [];
    const mutasi = [];
    const bobotKanal = [['offline', 30], ['shopee', 25], ['tiktok', 20], ['tokopedia', 10], ['website', 10], ['whatsapp', 5]].filter(([c]) => c in tempo);
    let menunggu = 0;
    for (let h = HARI; h >= 0; h--) {
      const n = PRODUKSI ? antara(2, 5) : antara(5, 12);
      for (let i = 0; i < n; i++) {
        const waktu = hariLalu(h, antara(9, 20), antara(0, 59));
        const kode = pilihBerat(bobotKanal, (x) => x[1])[0];
        const cust = pelanggan.length && peluang(kode === 'offline' ? 0.45 : 0.7) ? pilih(pelanggan) : null;
        const namaPembeli = cust?.name ?? pilih(PEMBELI);
        const jumlahItem = peluang(0.7) ? 1 : peluang(0.75) ? 2 : 3;
        const dipilih = new Set();
        while (dipilih.size < Math.min(jumlahItem, bisaDijual.length)) dipilih.add(pilihBerat(bisaDijual, (p) => p.bobot));
        const id = uuid(`order-${h}-${i}`);
        const nomor = `GN${yymmdd(waktu)}${String(i + 1).padStart(3, '0')}`;
        let subtotal = 0;
        for (const p of dipilih) {
          const qty = peluang(0.85) ? 1 : 2;
          subtotal += qty * p.row.base_price;
          items.push({
            id: uuid(`item-${id}-${p.row.id}`), order_id: id, product_id: p.row.id, name: `${p.row.name} - ${p.row.variant_name}`,
            size: p.row.variant_name, qty, price: p.row.base_price, cost_price: p.row.cost_price, note: 'Ukuran dan warna sudah dicek',
            _p: p,
          });
        }
        const batal = peluang(0.03);
        const tunggu = !batal && kode === 'website' && h <= 1 && menunggu < 4 && peluang(0.6);
        if (tunggu) menunggu++;
        const pakaiPromo = !batal && promo.length && peluang(0.15) ? pilih(promo) : null;
        const diskon = pakaiPromo
          ? pakaiPromo.type === 'percent'
            ? bulat((subtotal * Number(pakaiPromo.value)) / 100, 100)
            : Math.min(Number(pakaiPromo.value), bulat(subtotal / 2, 100))
          : 0;
        const ongkir = kode === 'website' || kode === 'whatsapp' ? bulat(antara(12000, 35000)) : 0;
        const total = subtotal - diskon + ongkir;
        const marketplace = ['shopee', 'tiktok', 'tokopedia'].includes(kode);
        const jatuhTempo = marketplace ? tambahHari(waktu, tempo[kode] || 14) : null;
        const lunas = !batal && !tunggu && (!marketplace || jatuhTempo <= SEKARANG);
        const metode = kode === 'offline' ? (peluang(0.65) ? 'cash' : 'qris') : kode === 'website' ? pilih(['qris', 'transfer']) : 'transfer';
        const diterima = metode === 'cash' ? Math.ceil(total / 50000) * 50000 : total;
        const sh = kode === 'offline' ? shiftHari.get(h) : null;
        const poinDidapat = cust && !batal ? Math.floor(total / 10000) : 0;
        orders.push({
          id, store_id: STORE, customer_id: cust?.id ?? null, cashier_id: kode === 'offline' ? kasir : admin, shift_id: sh?.id ?? null,
          order_number: nomor, subtotal, tax: 0, discount: diskon, total, payment_method: metode,
          payment_status: lunas ? 'paid' : 'unpaid', order_status: batal ? 'canceled' : tunggu ? 'awaiting_confirmation' : 'done',
          order_type: 'take_away', notes: pilih(CATATAN[kode]), promo_code: pakaiPromo?.code ?? null,
          received_amount: lunas ? diterima : 0, change_amount: lunas ? diterima - total : 0, points_earned: poinDidapat, created_at: waktu,
          sales_channel: kode, payment_term: marketplace ? 'tempo' : 'cash', due_date: jatuhTempo ? tgl(jatuhTempo) : null,
          paid_amount: lunas ? total : 0, settled_at: lunas ? (jatuhTempo ?? waktu) : null,
          external_order_no: kode === 'shopee' ? `2609${antara(1e9, 9e9)}` : kode === 'tiktok' ? `5773${antara(1e9, 9e9)}${antara(1000, 9999)}` : kode === 'tokopedia' ? `INV/${tgl(waktu).replace(/-/g, '')}/MPL/${antara(1e9, 9e9)}` : null,
          customer_name: namaPembeli, customer_phone: cust?.phone ?? `08${antara(11, 99)}${antara(10000000, 99999999)}`,
          delivery_address: kode === 'offline' ? 'Ambil di toko GNNK Racing, Sidoarjo' : cust?.address ?? `Jl. ${pilih(JALAN)} No. ${antara(1, 150)}, ${pilih(KOTA)}`,
          shipping_cost: ongkir, tax_inclusive: false,
          _cust: cust, _waktu: waktu,
        });
        if (lunas) {
          bayar.push({
            id: uuid(`bayar-${id}`), store_id: STORE, order_id: id, amount: total, method: metode, paid_at: jatuhTempo ?? waktu,
            reference: marketplace ? `Pencairan ${kode} ${nomor}` : metode === 'cash' ? `Kasir ${nomor}` : `${metode.toUpperCase()}-${antara(100000, 999999)}`,
            note: marketplace ? 'Dana dicairkan marketplace' : 'Pembayaran diterima', created_by: kode === 'offline' ? kasir : admin, created_at: jatuhTempo ?? waktu,
          });
        }
        if (poinDidapat > 0) {
          poin.push({ id: uuid(`poin-${id}`), store_id: STORE, customer_id: cust.id, points_delta: poinDidapat, reason: `Belanja ${nomor}`, ref_order_id: id, created_at: waktu });
        }
        if (!batal && !tunggu) {
          for (const it of items.filter((x) => x.order_id === id)) {
            mutasi.push({ id: uuid(`mutasi-jual-${it.id}`), store_id: STORE, product_id: it.product_id, type: 'sale', qty_delta: -it.qty, reason: `Penjualan ${nomor}`, ref_order_id: id, created_at: waktu });
          }
          if (sh) {
            sh.penjualan += total;
            sh.jumlah += 1;
            if (metode === 'cash') sh.tunai += total;
          }
        }
      }
    }

    // ---------- 8. pembelian ----------
    const purchases = [];
    const pItems = [];
    const pBayar = [];
    const dibeli = semuaProduk.filter((p) => !p.set);
    for (let i = 0; i < (PRODUKSI ? 12 : 26); i++) {
      const s = pilih([0, 1, 5, 0, 1, 5, 2, 4]);
      const kandidat = dibeli.filter((p) => p.supplier === s);
      const barang = kandidat.length ? kandidat : dibeli;
      const h = antara(2, HARI + 15);
      const tanggal = hariLalu(h, 10, 0);
      const status = h >= 10 ? 'received' : h >= 5 ? 'partial' : 'ordered';
      const diterima = status === 'ordered' ? null : tambahHari(tanggal, Math.min(h - 1, antara(3, 6)));
      const id = uuid(`po-${i}`);
      // Nomor nota unik per toko; kunci selain v1 ikut ditulis supaya tidak bentrok dengan nota lama.
      const invoice = `PO-GN-${yymmdd(tanggal).slice(0, 4)}-${String(i + 1).padStart(3, '0')}${KUNCI === 'v1' ? '' : `-${KUNCI.toUpperCase()}`}`;
      const dipilih = new Set();
      const n = Math.min(barang.length, antara(4, 8));
      while (dipilih.size < n) dipilih.add(pilih(barang));
      let subtotal = 0;
      for (const p of dipilih) {
        const qty = antara(10, 30);
        const terima = status === 'received' ? qty : status === 'partial' ? Math.floor(qty / 2) : 0;
        subtotal += qty * p.row.cost_price;
        pItems.push({
          id: uuid(`poi-${id}-${p.row.id}`), purchase_id: id, product_id: p.row.id, name: `${p.row.name} - ${p.row.variant_name}`, sku: p.row.sku,
          qty, received_qty: terima, cost_price: p.row.cost_price, subtotal: qty * p.row.cost_price, note: 'Cek ukuran dan warna saat terima',
          barcode: p.row.barcode, original_cost_price: p.row.cost_price, currency: 'IDR',
        });
        if (terima > 0) {
          mutasi.push({ id: uuid(`mutasi-beli-${id}-${p.row.id}`), store_id: STORE, product_id: p.row.id, type: 'restock', qty_delta: terima, reason: `Terima ${invoice}`, ref_order_id: null, created_at: diterima });
        }
      }
      const biayaLain = bulat(antara(25000, 75000));
      const potongan = peluang(0.3) ? bulat(subtotal * 0.02) : 0;
      const total = subtotal - potongan + biayaLain;
      const dp = SUPPLIER[s][6];
      const jatuh = tambahHari(tanggal, SUPPLIER[s][5]);
      let dibayar = 0;
      if (dp > 0) {
        const nilai = bulat((total * dp) / 100);
        dibayar += nilai;
        pBayar.push({ id: uuid(`pob-dp-${id}`), store_id: STORE, purchase_id: id, type: 'dp', amount: nilai, method: 'transfer', paid_at: tanggal, reference: `DP ${invoice}`, note: `Uang muka ${dp}%`, created_by: admin, created_at: tanggal });
      }
      if (status === 'received' && jatuh <= SEKARANG) {
        pBayar.push({ id: uuid(`pob-lunas-${id}`), store_id: STORE, purchase_id: id, type: 'settlement', amount: total - dibayar, method: 'transfer', paid_at: jatuh, reference: `Pelunasan ${invoice}`, note: 'Pelunasan sesuai tempo', created_by: admin, created_at: jatuh });
        dibayar = total;
      }
      purchases.push({
        id, store_id: STORE, supplier_id: supplierId[s], invoice_number: invoice, status, order_date: tgl(tanggal), expected_date: tgl(tambahHari(tanggal, 5)),
        due_date: tgl(jatuh), subtotal, discount: potongan, tax: 0, other_cost: biayaLain, total, paid_amount: dibayar, dp_percent: dp,
        received_at: diterima, notes: `Restock ${SUPPLIER[s][0]}`, created_by: admin, created_at: tanggal, currency: 'IDR', exchange_rate: 1,
      });
    }

    // ---------- 9. stok awal/penyesuaian (stok tidak pernah minus), opname, stok akhir ----------
    const perProduk = new Map(semuaProduk.map((p) => [p.row.id, []]));
    for (const m of mutasi) perProduk.get(m.product_id)?.push(m);
    const awal = hariLalu(HARI + 20, 9, 0);
    for (const p of semuaProduk.filter((x) => !x.set)) {
      const daftar = perProduk.get(p.row.id).sort((a, b) => a.created_at - b.created_at);
      let saldo = p.stokLama;
      let min = saldo;
      for (const m of daftar) {
        saldo += m.qty_delta;
        min = Math.min(min, saldo);
      }
      let tambahan = Math.max(0, -min);
      const target = p.stokAda ? antara(4, 25) : 0;
      if (saldo + tambahan < target) tambahan += target - (saldo + tambahan);
      if (tambahan <= 0) continue;
      const mAwal = { id: uuid(`mutasi-awal-${p.row.id}`), store_id: STORE, product_id: p.row.id, type: 'adjust', qty_delta: tambahan, reason: p.baru ? 'Stok awal' : 'Penyesuaian stok awal data contoh', ref_order_id: null, created_at: awal };
      mutasi.push(mAwal);
      daftar.unshift(mAwal);
    }
    const opnameItems = [];
    const opnameId = uuid('opname-1');
    const waktuOpname = hariLalu(7, 17, 0);
    if (!PRODUKSI) {
      for (const p of semuaProduk.filter((x) => x.stokAda && !x.set).slice(0, 18)) {
        const sistem = p.stokLama + perProduk.get(p.row.id).filter((m) => m.created_at <= waktuOpname).reduce((a, m) => a + m.qty_delta, 0);
        const lebih = peluang(0.2) ? 1 : 0;
        opnameItems.push({ id: uuid(`opi-${p.row.id}`), opname_id: opnameId, product_id: p.row.id, system_qty: sistem, counted_qty: sistem + lebih, note: lebih ? 'Ditemukan 1 pcs di rak cadangan' : 'Sesuai' });
        if (lebih) {
          mutasi.push({ id: uuid(`mutasi-opname-${p.row.id}`), store_id: STORE, product_id: p.row.id, type: 'adjust', qty_delta: lebih, reason: 'Stok opname', ref_order_id: null, created_at: waktuOpname });
        }
      }
    }
    const perubahan = new Map();
    for (const m of mutasi) perubahan.set(m.product_id, (perubahan.get(m.product_id) ?? 0) + m.qty_delta);

    // ---------- 10. tulis transaksi ----------
    if (!PRODUKSI) {
      await sisip(db, 'shifts', shift.map((s) => {
        const keluar = s.h % 3 === 0 ? bulat(antara(25000, 50000)) : 0;
        const harapan = 500000 + s.tunai - keluar;
        const selisih = peluang(0.15) ? bulat(antara(1000, 5000)) : 0;
        s.keluar = keluar;
        s.tutupKas = harapan - selisih;
        return {
          id: s.id, store_id: STORE, cashier_id: kasir, opened_at: s.buka, closed_at: s.tutup, opening_cash: 500000,
          closing_cash: s.tutupKas, expected_cash: harapan, total_sales: s.penjualan, total_orders: s.jumlah,
          notes: selisih ? `Selisih kas Rp ${selisih.toLocaleString('id-ID')}, sudah dicatat` : 'Shift lancar, kas sesuai', created_at: s.buka,
        };
      }));
      const kas = [];
      for (const s of shift) {
        kas.push({ id: uuid(`kas-buka-${s.h}`), store_id: STORE, shift_id: s.id, type: 'open', amount: 500000, note: 'Modal awal kasir', created_at: s.buka });
        if (s.keluar) kas.push({ id: uuid(`kas-keluar-${s.h}`), store_id: STORE, shift_id: s.id, type: 'out', amount: s.keluar, note: 'Beli bensin kurir antar barang', created_at: tambahHari(s.buka, 0.2) });
        kas.push({ id: uuid(`kas-tutup-${s.h}`), store_id: STORE, shift_id: s.id, type: 'close', amount: s.tutupKas, note: 'Tutup kasir', created_at: s.tutup });
      }
      await sisip(db, 'cash_movements', kas);
    }
    const bersih = (arr) => arr.map((o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_'))));
    await sisip(db, 'orders', bersih(orders));
    await sisip(db, 'order_items', bersih(items));
    await sisip(db, 'order_payments', bayar);
    await sisip(db, 'loyalty_transactions', poin);
    await sisip(db, 'purchases', purchases);
    await sisip(db, 'purchase_items', pItems);
    await sisip(db, 'purchase_payments', pBayar);
    if (opnameItems.length) {
      await sisip(db, 'stock_opnames', [{ id: opnameId, store_id: STORE, status: 'posted', note: 'Stok opname rutin gudang gear', counted_by: kasir, started_at: tambahHari(waktuOpname, -0.1), posted_at: waktuOpname, created_at: tambahHari(waktuOpname, -0.1) }]);
      await sisip(db, 'stock_opname_items', opnameItems);
    }
    await sisip(db, 'stock_movements', mutasi);
    for (const [id, delta] of perubahan) {
      await db.query('update public.products set stock_qty = coalesce(stock_qty, 0) + $2 where id = $1', [id, delta]);
    }

    // ---------- 11. ulasan ----------
    const ulasan = [];
    const perKelompok = new Map();
    for (const it of items) {
      const o = orders.find((x) => x.id === it.order_id);
      if (o.order_status !== 'done' || !o._cust || !peluang(0.35)) continue;
      const kunci = it._p.row.name;
      if ((perKelompok.get(kunci) ?? 0) >= 4) continue;
      const waktu = tambahHari(o._waktu, antara(2, 5));
      if (waktu > SEKARANG) continue;
      perKelompok.set(kunci, (perKelompok.get(kunci) ?? 0) + 1);
      const nilai = pilih([5, 5, 5, 5, 5, 4, 4, 4, 3]);
      const balas = peluang(0.5);
      const waktuBalas = tambahHari(waktu, 1) > SEKARANG ? SEKARANG : tambahHari(waktu, 1);
      ulasan.push({
        id: uuid(`ulasan-${it.id}`), store_id: STORE, product_id: it.product_id, order_id: o.id, customer_id: o._cust.id, reviewer_name: o._cust.name,
        rating: nilai, body: pilih(ULASAN[nilai]), images: peluang(0.2) ? [it._p.row.image_url] : [], variant_label: it._p.row.variant_name,
        is_hidden: false, seller_reply: balas ? pilih(BALASAN) : null, replied_at: balas ? waktuBalas : null,
        created_at: waktu, tags: nilai >= 4 ? [...new Set([pilih(TAG), pilih(TAG)])] : [], helpful_count: antara(0, 7),
      });
    }
    await sisip(db, 'product_reviews', ulasan);
    await db.query(
      `update public.customers c set points = coalesce((select sum(points_delta) from public.loyalty_transactions l where l.customer_id = c.id), 0)
       where c.store_id = $1`,
      [STORE],
    );

    const cek = (await db.query(
      `select count(*) filter (where stock_qty < 0 and not exists (select 1 from public.product_components c where c.parent_product_id = p.id)) as minus,
              count(*) as produk, count(*) filter (where is_active) as aktif
         from public.products p where p.store_id = $1`,
      [STORE],
    )).rows[0];
    const ringkas = {
      mode: MODE, ...(terhapus ? { kafe_dihapus: terhapus } : {}), produk_db: Number(cek.produk), aktif: Number(cek.aktif), stok_minus: Number(cek.minus),
      produk_situs_baru: semuaProduk.filter((p) => p.baru).length, produk_client_dilengkapi: semuaProduk.filter((p) => !p.baru).length,
      kategori: katId.size, pesanan_baru: orders.length, pembelian_baru: purchases.length, mutasi_baru: mutasi.length, shift: shift.length, ulasan: ulasan.length, pelanggan: pelanggan.length,
    };
    if (TULIS) {
      await db.query('commit');
      console.log('DITULIS', ringkas);
    } else {
      await db.query('rollback');
      console.log('UJI COBA (dibatalkan, tambahkan --ya untuk menulis)', ringkas);
    }
  } catch (e) {
    await db.query('rollback');
    throw e;
  } finally {
    await db.end();
  }
}

utama().catch((e) => {
  console.error('GAGAL:', e.message);
  process.exitCode = 1;
});
