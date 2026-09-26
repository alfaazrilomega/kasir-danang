// Uji footer toko online, saklar chat, dan deskripsi produk yang dipotong.
//
// Cakupan (lihat task-5-brief.md):
// 1. Ikon media sosial footer: hanya URL yang terisi yang tampil, dengan href
//    benar dan target="_blank"; kosong semua -> blok ikon tidak tampil sama
//    sekali.
// 2. Blok "Jelajahi" footer: footer_links terisi menggantikan daftar kategori
//    bawaan (Beranda/Semua Produk/kategori); dikosongkan, daftar bawaan
//    kembali.
// 3. Saklar chat_enabled mematikan TIGA pintu sekaligus: tautan chat footer,
//    tombol mengambang "Pesan", dan DUA tombol Chat di halaman detail produk
//    (kartu penjual + bilah bawah HP, yang terakhir cuma tampil di layar
//    sempit karena kelasnya lg:hidden).
// 4. Deskripsi produk: dipotong 6 baris dengan tombol "Lihat lebih banyak"/
//    "Lihat lebih sedikit"; tombol hanya muncul kalau teksnya memang
//    terpotong (dibuktikan lewat scrollHeight/Range, bukan isVisible()).
//
// Baris `stores` yang dipakai (facebook/instagram/tiktok/youtube/footer_links/
// chat_enabled) milik client -- nilai aslinya disimpan di awal dan
// DIKEMBALIKAN di `finally` apa pun yang terjadi. Produk uji dibuat sendiri
// dengan SKU bertanda unik dan dihapus di `finally` juga.

const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const { trackApi, waitForApiIdle, BASE_URL, DB_PASSWORD } = require('./lib/harness.cjs');

function psql(q) {
  return execFileSync(
    'C:/Program Files/PostgreSQL/16/bin/psql.exe',
    ['-U', 'kasir_user', '-h', '127.0.0.1', '-d', 'kasir', '-tAq', '-c', q],
    { env: { ...process.env, PGPASSWORD: DB_PASSWORD }, encoding: 'utf8' },
  ).trim();
}

const TAG = 'UJIFOOTER' + Date.now().toString().slice(-6);
const NULL_SENTINEL = 'TANDA_NULL_UJI';

const hasil = [];
const rec = (nama, ok, ket) => {
  hasil.push(ok);
  console.log((ok ? 'PASS  ' : 'FAIL  ') + nama + (ket ? ' - ' + ket : ''));
};

// Harus jauh lebih tinggi daripada batas klem (360px di desktop) ditambah sisa
// minimal 120px: tombol memang sengaja TIDAK muncul untuk isi yang cuma lebih
// panjang sedikit — itu keluhan client, tombol yang membuka dua kata.
const DESKRIPSI_PANJANG = Array.from(
  { length: 60 },
  (_, i) =>
    `Baris deskripsi ke-${i + 1} untuk produk uji ${TAG}: bahan baja pilihan, presisi saat dipasang, ` +
    'cocok untuk pemakaian harian maupun balap, dan sudah melewati pengujian ketahanan.',
).join('\n');

async function buka(browser, viewport, url) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  trackApi(page);
  // Sengaja BUKAN networkidle: foto produk toko ini dimuat dari situs client
  // (gnnkracing.id) dan sering menggantung, jadi networkidle tidak pernah
  // tercapai walau halaman sudah siap dipakai.
  await page.goto(BASE_URL + url, { waitUntil: 'domcontentloaded' });
  await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 2000 });
  return page;
}

(async () => {
  const browser = await chromium.launch();
  let storeId = null;
  let asli = null;
  let idPanjang = '';
  let idPendek = '';

  try {
    storeId = psql('select id from public.stores order by created_at limit 1;');

    // ---------- Simpan nilai asli 6 kolom milik client ----------
    const baca = (kolom) => psql(`select coalesce(${kolom}, '${NULL_SENTINEL}') from public.stores where id = '${storeId}';`);
    asli = {
      social_facebook: baca('social_facebook'),
      social_instagram: baca('social_instagram'),
      social_tiktok: baca('social_tiktok'),
      social_youtube: baca('social_youtube'),
      // footer_links NOT NULL default '[]'::jsonb, jadi cast ::text selalu aman.
      footer_links: psql(`select footer_links::text from public.stores where id = '${storeId}';`),
      // Cast ::text pada boolean menghasilkan kata "true"/"false" -- bisa
      // ditulis apa adanya (tanpa kutip) di pernyataan SQL berikutnya.
      chat_enabled: psql(`select chat_enabled::text from public.stores where id = '${storeId}';`),
    };

    // ---------- Produk uji: deskripsi panjang & pendek ----------
    idPanjang = psql(
      `insert into public.products (store_id, name, description, base_price, is_active, sku, spec, box_contents)
       values ('${storeId}', 'Produk Deskripsi Panjang ${TAG}', '${DESKRIPSI_PANJANG}', 150000, true, '${TAG}-P',
               '[{"label":"Merek","value":"Penanda ${TAG}"}]'::jsonb, 'Satu set penanda ${TAG}')
       returning id;`,
    );
    idPendek = psql(
      `insert into public.products (store_id, name, description, base_price, is_active, sku)
       values ('${storeId}', 'Produk Deskripsi Pendek ${TAG}', 'Satu baris deskripsi saja.', 120000, true, '${TAG}-S')
       returning id;`,
    );

    // ================= Keadaan A: semua sosial terisi, tautan artikel terisi, chat MENYALA =================
    psql(`update public.stores set
            social_facebook = 'https://facebook.com/gnnkracing',
            social_instagram = 'https://instagram.com/gnnkracing',
            social_tiktok = 'https://tiktok.com/@gnnkracing',
            social_youtube = 'https://youtube.com/@gnnkracing',
            footer_links = '[{"label":"Cara memilih gear set","url":"https://gnnkracing.id/a/gear"},
                             {"label":"Perawatan rantai","url":"https://gnnkracing.id/a/rantai"}]'::jsonb,
            chat_enabled = true
          where id = '${storeId}';`);

    const dkA = await buka(browser, { width: 1440, height: 900 }, '/toko');
    await dkA.waitForSelector('footer', { timeout: 60000 });
    const footerA = dkA.locator('footer');

    for (const [href, nama] of [
      ['https://facebook.com/gnnkracing', 'Facebook'],
      ['https://instagram.com/gnnkracing', 'Instagram'],
      ['https://tiktok.com/@gnnkracing', 'TikTok'],
      ['https://youtube.com/@gnnkracing', 'YouTube'],
    ]) {
      const a = footerA.locator(`a[href="${href}"]`);
      rec(`Ikon ${nama} tampil dengan href sesuai isian`, (await a.count()) === 1);
      rec(
        `Ikon ${nama} dibuka di tab baru`,
        (await a.getAttribute('target')) === '_blank' && (await a.getAttribute('rel') || '').includes('noreferrer'),
      );
    }

    const teksFooterA = await footerA.innerText();
    rec(
      'footer_links terisi menggantikan daftar kategori di blok Jelajahi',
      /Cara memilih gear set/.test(teksFooterA) && /Perawatan rantai/.test(teksFooterA) && !/Semua Produk/.test(teksFooterA),
      teksFooterA.split('\n').slice(0, 4).join(' | ').slice(0, 90),
    );
    rec('Chat menyala: tautan chat footer tampil', /Hubungi kami lewat chat/.test(teksFooterA));
    rec('Chat menyala: tombol mengambang "Pesan" tampil', (await dkA.getByRole('link', { name: /^Pesan$/ }).count()) > 0);

    // Bilah bawah tombol Chat kedua cuma tampil di layar sempit (lg:hidden),
    // jadi halaman produk dibuka di lebar HP supaya kedua tombol Chat kelihatan sekaligus.
    const pdA = await buka(browser, { width: 393, height: 852 }, '/toko/produk?id=' + idPanjang);
    await pdA.getByRole('heading', { name: 'Deskripsi', exact: true }).waitFor({ timeout: 60000 });
    rec('Chat menyala: tombol Chat kartu penjual tampil', (await pdA.getByRole('link', { name: /^Chat$/ }).count()) === 1);
    rec('Chat menyala: tombol Chat bilah bawah tampil', (await pdA.locator('a[aria-label="Chat penjual"]').count()) === 1);

    // --- Bagian "Detail Produk" bisa diketuk di HP (permintaan client: jangan
    //     menumpuk panjang ke bawah, munculkan sesuai kebutuhan) ---
    const blokDetailHp = pdA.locator('#detail-produk');
    const barisSpek = blokDetailHp.getByRole('button', { name: /Spesifikasi/i }).first();
    rec('HP: Spesifikasi berupa baris yang bisa diketuk',
      (await barisSpek.count()) === 1 && (await barisSpek.getAttribute('aria-expanded')) === 'false');
    rec('HP: isi spesifikasi tersembunyi sebelum diketuk',
      !(await blokDetailHp.getByText(`Penanda ${TAG}`).first().isVisible().catch(() => false)));
    const kotakBarisSpek = await barisSpek.boundingBox();
    rec('HP: target sentuh baris lipat 44px', !!kotakBarisSpek && kotakBarisSpek.height >= 44,
      kotakBarisSpek ? Math.round(kotakBarisSpek.height) + 'px' : 'tidak terlihat');
    await barisSpek.click();
    await pdA.waitForTimeout(600);
    rec('HP: isi spesifikasi muncul setelah diketuk',
      await blokDetailHp.getByText(`Penanda ${TAG}`).first().isVisible());
    await barisSpek.click();
    await pdA.waitForTimeout(500);
    rec('HP: bagian bisa ditutup lagi',
      !(await blokDetailHp.getByText(`Penanda ${TAG}`).first().isVisible().catch(() => false)));
    rec('HP: "Apa yang ada di dalam kotak" juga bisa diketuk',
      (await blokDetailHp.getByRole('button', { name: /Apa yang ada di dalam kotak/i }).count()) === 1);

    const pdDesk = await buka(browser, { width: 1440, height: 900 }, '/toko/produk?id=' + idPanjang);
    await pdDesk.getByRole('heading', { name: 'Detail Produk', exact: true }).first().waitFor({ timeout: 60000 });
    rec('Desktop: isi spesifikasi langsung terlihat tanpa diketuk',
      await pdDesk.locator('#detail-produk').getByText(`Penanda ${TAG}`).first().isVisible());

    // ================= Keadaan B: chat DIMATIKAN, tautan artikel dikosongkan =================
    psql(`update public.stores set chat_enabled = false, footer_links = '[]'::jsonb where id = '${storeId}';`);

    const dkB = await buka(browser, { width: 1440, height: 900 }, '/toko');
    await dkB.waitForSelector('footer', { timeout: 60000 });
    const teksFooterB = await dkB.locator('footer').innerText();
    rec('Chat mati: tautan chat footer hilang', !/Hubungi kami lewat chat/.test(teksFooterB));
    rec('Chat mati: tombol mengambang "Pesan" hilang', (await dkB.getByRole('link', { name: /^Pesan$/ }).count()) === 0);
    rec('footer_links dikosongkan: Beranda kembali tampil', /Beranda/.test(teksFooterB));
    rec('footer_links dikosongkan: Semua Produk kembali tampil', /Semua Produk/.test(teksFooterB));

    const pdB = await buka(browser, { width: 393, height: 852 }, '/toko/produk?id=' + idPanjang);
    await pdB.getByRole('heading', { name: 'Deskripsi', exact: true }).waitFor({ timeout: 60000 });
    rec('Chat mati: tombol Chat kartu penjual hilang', (await pdB.getByRole('link', { name: /^Chat$/ }).count()) === 0);
    rec('Chat mati: tombol Chat bilah bawah hilang', (await pdB.locator('a[aria-label="Chat penjual"]').count()) === 0);

    // ================= Keadaan C: chat MENYALA lagi, semua ikon sosial dikosongkan =================
    psql(`update public.stores set
            chat_enabled = true,
            social_facebook = null, social_instagram = null, social_tiktok = null, social_youtube = null
          where id = '${storeId}';`);

    const dkC = await buka(browser, { width: 1440, height: 900 }, '/toko');
    await dkC.waitForSelector('footer', { timeout: 60000 });
    rec('Chat dinyalakan lagi: tautan chat footer tampil kembali', /Hubungi kami lewat chat/.test(await dkC.locator('footer').innerText()));
    rec(
      'Semua ikon sosial dikosongkan: blok ikon media sosial tidak tampil sama sekali',
      (await dkC.locator('footer nav[aria-label="Media sosial"]').count()) === 0,
    );

    // ================= Deskripsi produk: panjang dipotong, pendek tidak =================
    const pDesk = await buka(browser, { width: 1440, height: 900 }, '/toko/produk?id=' + idPanjang);
    await pDesk.getByRole('heading', { name: 'Deskripsi', exact: true }).waitFor({ timeout: 60000 });
    await pDesk.waitForTimeout(1200); // beri waktu ResizeObserver mengukur elemen

    const tombolBanyak = pDesk.getByRole('button', { name: /Lihat lebih banyak/i });
    rec('Tombol "Lihat lebih banyak" muncul untuk deskripsi panjang', (await tombolBanyak.count()) === 1);

    // isVisible() tidak bisa dipakai untuk membuktikan potongan line-clamp:
    // elemen induknya tetap dianggap "visible" walau isinya terpotong. Yang
    // membuktikan potongan adalah posisi baris terakhir jatuh di luar kotak
    // yang tampil (dibandingkan lewat Range, bukan hitungan karakter).
    const ukur = await pDesk.evaluate(() => {
      const h = Array.from(document.querySelectorAll('h3')).find((el) => el.textContent.trim() === 'Deskripsi');
      const wadah = h?.parentElement?.querySelector('div.relative.overflow-hidden');
      if (!wadah) return null;
      return { tampil: Math.round(wadah.clientHeight), isi: Math.round(wadah.scrollHeight) };
    });
    rec(
      'Isi deskripsi melampaui kotak yang tampil (memang terpotong)',
      !!ukur && ukur.isi > ukur.tampil + 1,
      ukur ? `tampil ${ukur.tampil}px, isi ${ukur.isi}px` : 'tidak terukur',
    );
    rec(
      'Yang disembunyikan banyak, bukan cuma satu dua baris',
      !!ukur && ukur.isi - ukur.tampil > 120,
      ukur ? `${ukur.isi - ukur.tampil}px tersembunyi` : 'tidak terukur',
    );

    await tombolBanyak.first().click();
    await pDesk.waitForTimeout(800);
    rec('Setelah diklik, tombol berubah jadi "Lihat lebih sedikit"', (await pDesk.getByRole('button', { name: /Lihat lebih sedikit/i }).count()) === 1);
    rec('Setelah dibentangkan, baris terakhir deskripsi terlihat penuh', await pDesk.getByText(/Baris deskripsi ke-60/).first().isVisible());

    const pPendek = await buka(browser, { width: 1440, height: 900 }, '/toko/produk?id=' + idPendek);
    await pPendek.getByRole('heading', { name: 'Deskripsi', exact: true }).waitFor({ timeout: 60000 });
    await pPendek.waitForTimeout(1200);
    // Produk pendek ini juga tidak punya gambar deskripsi, jadi memang tidak
    // ada apa pun yang pantas disembunyikan.
    rec(
      'Deskripsi pendek tidak menampilkan tombol apa pun',
      (await pPendek.getByRole('button', { name: /Lihat lebih (banyak|sedikit)/i }).count()) === 0,
    );

    console.log('');
    console.log(hasil.filter(Boolean).length + '/' + hasil.length + ' lolos');
  } catch (e) {
    console.log('ERROR: ' + String(e.message).slice(0, 400));
  } finally {
    await browser.close();
    try {
      if (idPanjang || idPendek) {
        psql(`delete from public.products where sku like '${TAG}%';`);
        console.log('produk uji dihapus');
      }
    } catch (e) {
      console.log('bersih-bersih produk: ' + String(e.message).slice(0, 200));
    }
    try {
      if (storeId && asli) {
        const q = (v) => (v === NULL_SENTINEL ? 'null' : `'${v.replace(/'/g, "''")}'`);
        psql(`update public.stores set
                social_facebook = ${q(asli.social_facebook)},
                social_instagram = ${q(asli.social_instagram)},
                social_tiktok = ${q(asli.social_tiktok)},
                social_youtube = ${q(asli.social_youtube)},
                footer_links = '${asli.footer_links.replace(/'/g, "''")}'::jsonb,
                chat_enabled = ${asli.chat_enabled}
              where id = '${storeId}';`);
        console.log('pengaturan toko (sosial/footer_links/chat_enabled) dikembalikan ke nilai semula');
      }
    } catch (e) {
      console.log('bersih-bersih toko: ' + String(e.message).slice(0, 200));
    }
  }
})();
