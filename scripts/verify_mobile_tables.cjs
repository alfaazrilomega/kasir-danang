// Tabel admin di layar sempit.
//
// Masalah yang dikunci di sini: tabel konsol admin dirancang untuk desktop,
// lalu di layar 393px dipaksa masuk wadah 328px. Kolom terakhir, termasuk
// tombol aksi, jatuh di luar layar dan hanya bisa dicapai dengan menggeser
// tabel ke samping - yang tidak terlihat sebagai gulir oleh pemakainya.
//
// Acuan yang benar adalah WADAH GULIR tabel, bukan lebar layar. Tabel 335px
// di layar 393px terdengar aman, padahal wadahnya 328px dan tetap terpotong.
//
// Dua lebar diuji. 393 mewakili HP. 640 adalah titik sm menyala: kolom baru
// muncul sementara wadahnya belum cukup lebar, dan di sana cacat terakhir
// ditemukan setelah 393 sendiri sudah bersih.
const { chromium } = require('playwright');
const { trackApi, loginAdmin, gotoSettled } = require('./lib/harness.cjs');

const RUTE = [
  ['/products', 'Produk'],
  ['/orders', 'Pesanan'],
  ['/customers', 'Pelanggan'],
  ['/purchases', 'Pembelian Supplier'],
  ['/promos', 'Promo'],
  ['/shifts', 'Shift Kasir'],
  ['/stock-mutation', 'Mutasi Stok'],
  ['/stock-opname', 'Opname Stok'],
  ['/expenses', 'Pengeluaran'],
  ['/reports', 'Laporan'],
  ['/users', 'User'],
];

const LEBAR = [393, 640];

const UKUR = () => {
  // AdminLayout tidak memakai <main>; wadah isinya div max-w-[1400px].
  const wadahIsi = document.querySelector('[class*="max-w-[1400px]"]');
  if (!wadahIsi) return { adaWadah: false };
  const tabel = wadahIsi.querySelector('table');
  if (!tabel) return { adaWadah: true, adaTabel: false };
  const gulir = tabel.parentElement;
  const baris = Array.from(tabel.querySelectorAll('tbody tr')).slice(0, 12);
  const thTampak = Array.from(tabel.querySelectorAll('thead th')).filter(
    (th) => th.getBoundingClientRect().width > 0,
  );
  const terakhir = thTampak[thTampak.length - 1];
  return {
    adaWadah: true,
    adaTabel: true,
    lebarTabel: Math.round(tabel.getBoundingClientRect().width),
    wadahTampak: gulir.clientWidth,
    wadahGulir: gulir.scrollWidth,
    kananKolomTerakhir: terakhir ? Math.round(terakhir.getBoundingClientRect().right) : 0,
    kananWadah: Math.round(gulir.getBoundingClientRect().right),
    jumlahBaris: baris.length,
    tertinggi: baris.length
      ? Math.max(...baris.map((tr) => Math.round(tr.getBoundingClientRect().height)))
      : 0,
  };
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: LEBAR[0], height: 852 } });
  const page = await ctx.newPage();
  trackApi(page);
  const hasil = [];
  const record = (n, p, d) => {
    hasil.push({ n, p });
    console.log((p ? 'PASS  ' : 'FAIL  ') + n + (d ? ' — ' + d : ''));
  };

  try {
    await loginAdmin(page);

    for (const lebar of LEBAR) {
      await page.setViewportSize({ width: lebar, height: 852 });
      console.log('');
      console.log('--- lebar ' + lebar + 'px ---');

      for (const [rute, nama] of RUTE) {
        const label = nama + ' @' + lebar + 'px';
        await gotoSettled(page, rute);
        await page.waitForTimeout(700);
        const r = await page.evaluate(UKUR);

        if (!r.adaWadah) {
          record(label + ': wadah isi ditemukan', false, 'selektor tidak cocok, pengukuran tidak sah');
          continue;
        }
        // Tanpa tabel tidak boleh dilewat diam-diam: layar yang gagal memuat
        // datanya akan terlihat lolos padahal tidak ada yang diperiksa.
        record(label + ': tabel ada untuk diperiksa', r.adaTabel === true, 'tidak ada <table> di wadah isi');
        if (!r.adaTabel) continue;

        record(label + ': tabel tidak terpotong di wadahnya',
          r.wadahGulir <= r.wadahTampak + 1,
          'gulir ' + r.wadahGulir + 'px vs tampak ' + r.wadahTampak + 'px (tabel ' + r.lebarTabel + 'px)');
        record(label + ': kolom terakhir tidak keluar dari wadah',
          r.kananKolomTerakhir <= r.kananWadah + 1,
          'kanan kolom ' + r.kananKolomTerakhir + 'px vs kanan wadah ' + r.kananWadah + 'px');
        // Tabel kosong membuat pengukuran tinggi baris tidak berarti, jadi
        // ketiadaan baris dilaporkan, bukan dilewat.
        record(label + ': ada baris isi untuk diukur', r.jumlahBaris > 0,
          'baris terbaca ' + r.jumlahBaris);
        record(label + ': baris tidak membengkak',
          r.jumlahBaris > 0 && r.tertinggi <= 140,
          'tertinggi ' + r.tertinggi + 'px dari ' + r.jumlahBaris + ' baris');
      }
    }
  } catch (e) {
    console.log('ERROR: ' + e.message);
    record('Suite selesai tanpa galat', false, e.message.slice(0, 120));
  } finally {
    await browser.close();
  }

  console.log('');
  console.log('--- RINGKASAN ---');
  const pass = hasil.filter((h) => h.p).length;
  console.log(pass + '/' + hasil.length + ' lolos');
  process.exitCode = pass === hasil.length ? 0 : 1;
})();
