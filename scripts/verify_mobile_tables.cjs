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
const { BASE_URL, trackApi, loginAdmin } = require('./lib/harness.cjs');

const SELEKTOR_BARIS = '[class*="max-w-[1400px]"] table tbody tr';

// gotoSettled menunggu jaringan benar-benar sepi. Untuk sebelas layar berdata
// berat itu memakan lebih dari 600 detik dan suite dibunuh runner sebelum
// mencetak ringkasan. Yang diukur di sini cuma tata letak, jadi cukup tunggu
// sampai baris tabelnya benar-benar ada.
async function bukaSampaiBarisAda(page, rute) {
  await page.goto(BASE_URL + rute, { waitUntil: 'domcontentloaded' });
  await page
    .waitForSelector(SELEKTOR_BARIS, { timeout: 60000 })
    .catch(() => {});
  await page.waitForTimeout(400);
}

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
  ['/', 'Dashboard'],
  ['/users', 'User'],
];

// 393 HP. 640 titik sm menyala. 1024 titik lg menyala DAN bilah sisi ikut
// melebar, jadi wadah isinya justru menyempit jadi 681px. 1280 titik xl.
// Tiga cacat terakhir masing-masing muncul tepat di salah satu titik ini.
const LEBAR = [393, 640, 1024, 1280];

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

    // Tiap rute dibuka SEKALI lalu lebarnya diubah di tempat. Membuka ulang
    // per lebar berarti 22 navigasi dan suite melewati batas 600 detik di
    // run_all_checks, lalu mati tanpa ringkasan.
    for (const [rute, nama] of RUTE) {
      await page.setViewportSize({ width: LEBAR[0], height: 900 });
      await bukaSampaiBarisAda(page, rute);

      for (const lebar of LEBAR) {
        const label = nama + ' @' + lebar + 'px';
        await page.setViewportSize({ width: lebar, height: 852 });
        // Data masih menyusul dari sinkron; tabel bisa belum terpasang saat
        // lebarnya diubah. Ditunggu lagi tepat sebelum diukur, bukan sekali
        // saja setelah navigasi.
        await page
          .waitForSelector(SELEKTOR_BARIS, { timeout: 45000 })
          .catch(() => {});
        await page.waitForTimeout(500);
        // Komponen sempat dipasang ulang saat sinkron menyusul, jadi sekali
        // ukur bisa kebetulan jatuh di detik tabelnya tidak ada. Diulang
        // sampai tiga kali; kalau tetap kosong, memang kosong.
        let r = await page.evaluate(UKUR);
        // Diulang juga saat tabelnya ADA tapi barisnya belum termuat:
        // sinkron kadang menyusul, dan sekali ukur bisa jatuh tepat di detik
        // tabel masih kosong. Tanpa ini suite merah palsu di lari panjang.
        for (let coba = 0; coba < 3 && r.adaWadah && (!r.adaTabel || r.jumlahBaris === 0); coba += 1) {
          await page.waitForTimeout(2500);
          r = await page.evaluate(UKUR);
        }

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
        // Baris tinggi di layar sempit berarti kolom terhimpit. Di layar
        // lebar tinggi yang sama datang dari isi yang memang kaya (lencana
        // marketplace, dua tombol aksi), dan tidak ada yang tersembunyi.
        if (lebar <= 640) record(label + ': baris tidak membengkak',
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
