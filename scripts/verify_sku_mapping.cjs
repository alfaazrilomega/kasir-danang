// Verifikasi empiris Fase 1: upgrade Dexie v8, tabel mapping SKU platform,
// section "SKU Platform / Marketplace" di form produk, pencarian POS via SKU
// platform, dan No. Pesanan Platform di halaman Orders.
const { chromium } = require('playwright');
const { trackApi, waitForApiIdle } = require('./lib/harness.cjs');
const path = require('path');

const BASE = 'http://localhost:5173';
const SHOTS = path.join(__dirname, '..', 'audit_screenshots');

function openKasir(evalFn) {
  return evalFn;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  trackApi(page);
  const results = [];
  const record = (name, pass, detail) => {
    results.push({ name, pass, detail });
    console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail ? ' — ' + detail : ''));
  };

  page.on('pageerror', (e) => console.log('  [pageerror] ' + e.message));

  try {
    // Mulai dari nol supaya seed berjalan ulang di schema v8.
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await page.evaluate(() => new Promise((resolve) => {
      const req = indexedDB.deleteDatabase('kasir');
      req.onsuccess = req.onerror = req.onblocked = () => resolve(true);
    }));
    await page.evaluate(() => { localStorage.clear(); });
    await page.reload({ waitUntil: 'networkidle' });
    await page.fill('input[type="email"]', 'admin@example.com');
    await page.fill('input[type="password"]', 'change-me-strong-password');
    await page.click('button[type="submit"]');
    await waitForApiIdle(page, { idleMs: 3500, minWaitMs: 2500 });
    // Login bisa gagal saat server sibuk; tunggu eksplisit sampai keluar
    // dari /login agar kegagalannya jelas, bukan merembet ke asersi lain.
    await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 60000 })
      .catch(() => {});
    record('Login admin', await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 90000 }).then(() => true).catch(() => false), page.url());

    const dbInfo = await page.evaluate(() => {
      return new Promise((resolve) => {
        const req = indexedDB.open('kasir');
        req.onsuccess = () => {
          const db = req.result;
          const stores = Array.from(db.objectStoreNames);
          if (!stores.includes('product_channel_mappings')) {
            resolve({ version: db.version, stores, idx: [], mappingCount: 0 });
            db.close();
            return;
          }
          const os = db.transaction('product_channel_mappings', 'readonly').objectStore('product_channel_mappings');
          const idx = Array.from(os.indexNames);
          const cnt = os.count();
          cnt.onsuccess = () => {
            resolve({ version: db.version, stores, idx, mappingCount: cnt.result });
            db.close();
          };
        };
        req.onerror = () => resolve({ error: String(req.error), stores: [], idx: [] });
      });
    });

    record('Dexie version minimal 8', dbInfo.version >= 8, 'v' + dbInfo.version);
    record('Tabel product_channel_mappings ada', dbInfo.stores.indexOf('product_channel_mappings') >= 0);
    record('Tabel supplier_product_mappings ada', dbInfo.stores.indexOf('supplier_product_mappings') >= 0);
    // Retur sempat dihapus, lalu dipulihkan karena client memang memintanya.
    // Assertion lama mengunci keadaan 'sudah hilang' — sekarang justru harus ada.
    record(
      'Tabel retur tersedia kembali',
      dbInfo.stores.indexOf('order_returns') >= 0 && dbInfo.stores.indexOf('order_return_items') >= 0,
      dbInfo.stores.filter((s) => s.indexOf('return') >= 0).join(',') || 'tidak ada',
    );
    record(
      'Compound index store_id+channel_code',
      dbInfo.idx.some((i) => i.indexOf('store_id') >= 0 && i.indexOf('channel_code') >= 0),
      dbInfo.idx.join(' | ')
    );
    record('Seed mapping terisi', dbInfo.mappingCount > 0, dbInfo.mappingCount + ' baris');

    const ordInfo = await page.evaluate(() => {
      return new Promise((resolve) => {
        const req = indexedDB.open('kasir');
        req.onsuccess = () => {
          const db = req.result;
          const all = db.transaction('orders', 'readonly').objectStore('orders').getAll();
          all.onsuccess = () => {
            const rows = all.result;
            const withExt = rows.filter((r) => r.external_order_no);
            resolve({
              total: rows.length,
              withExt: withExt.length,
              sample: withExt.slice(0, 3).map((r) => r.external_order_no),
            });
            db.close();
          };
        };
      });
    });
    record(
      'Order punya external_order_no',
      ordInfo.withExt > 0,
      ordInfo.withExt + '/' + ordInfo.total + ' — cth. ' + ordInfo.sample.join(', ')
    );

    await page.goto(BASE + '/products', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 2000, minWaitMs: 800 });
    const rowCount = await page.locator('tbody tr').count();
    record('Halaman Produk render baris', rowCount > 0, rowCount + ' baris');

    const chipCount = await page.locator('tbody tr span').filter({ hasText: /Shopee|TikTok|Tokopedia|Toko fisik/ }).count();
    record('Chip channel asli tampil', chipCount > 0, chipCount + ' chip');
    await page.screenshot({ path: path.join(SHOTS, '20_products_channel_chips.png') });

    // Baris produk juga punya ikon riwayat & label, jadi tombol Edit dipilih lewat judulnya.
    const editBtn = page.locator('tbody tr').first().locator('button[title="Edit"]');
    await editBtn.click({ timeout: 10000 }).catch((e) => console.log('  [edit click] ' + e.message));
    await page.waitForTimeout(2000);
    const sectionVisible = await page.getByText('SKU Platform / Marketplace').first().isVisible().catch(() => false);
    record('Section SKU Platform tampil di form produk', sectionVisible);
    await page.screenshot({ path: path.join(SHOTS, '21_product_form_channel_sku.png'), fullPage: true });
    await page.keyboard.press('Escape').catch(() => {});

    const someSku = await page.evaluate(() => {
      return new Promise((resolve) => {
        const req = indexedDB.open('kasir');
        req.onsuccess = () => {
          const db = req.result;
          const all = db.transaction('product_channel_mappings', 'readonly').objectStore('product_channel_mappings').getAll();
          all.onsuccess = () => {
            resolve(all.result.length ? all.result[0].external_sku : null);
            db.close();
          };
        };
      });
    });

    if (someSku) {
      await page.goto(BASE + '/menu', { waitUntil: 'networkidle' });
      await waitForApiIdle(page, { idleMs: 2000, minWaitMs: 800 });
      const search = page.locator('input[placeholder*="Cari menu"]').first();
      const placeholder = await search.getAttribute('placeholder');
      record('Placeholder POS menyebut SKU platform', /SKU platform/i.test(placeholder || ''), placeholder);
      await search.fill(someSku);
      await page.waitForTimeout(1500);
      const bodyText = await page.locator('body').innerText();
      const noResult = /tidak ada|kosong|not found/i.test(bodyText.slice(0, 4000));
      record('Cari via SKU platform menemukan produk', !noResult, 'SKU ' + someSku);
      await page.screenshot({ path: path.join(SHOTS, '22_pos_search_platform_sku.png') });
    } else {
      record('Cari via SKU platform', false, 'tidak ada mapping untuk diuji');
    }

    await page.goto(BASE + '/orders', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 2000, minWaitMs: 800 });
    const ordSearch = page.locator('input[placeholder*="Cari ID"]').first();
    const ordPh = await ordSearch.getAttribute('placeholder');
    record('Placeholder Orders menyebut No. Pesanan Platform', /Pesanan Platform/i.test(ordPh || ''), ordPh);

    if (ordInfo.sample[0]) {
      // Rentang tanggal default menyembunyikan order seed yang lama, jadi
      // dilebarkan dulu supaya yang diuji benar-benar fungsi pencariannya.
      const dateInputs = page.locator('input[type="date"]');
      if (await dateInputs.count() >= 2) {
        await dateInputs.nth(0).fill('2020-01-01').catch(() => {});
        await dateInputs.nth(1).fill('2030-12-31').catch(() => {});
        await page.waitForTimeout(1200);
      }
      // Pull berkala mengganti isi tabel orders lokal, jadi contoh yang dibaca
      // di awal bisa sudah hilang saat pencarian dijalankan. Contohnya dibaca
      // ulang di sini supaya yang diuji benar-benar fungsi pencariannya.
      const extKini = await page.evaluate(() => new Promise((resolve) => {
        const req = indexedDB.open('kasir');
        req.onsuccess = () => {
          const all = req.result.transaction('orders', 'readonly').objectStore('orders').getAll();
          all.onsuccess = () => {
            const punya = all.result.filter((r) => r.external_order_no);
            resolve(punya.length ? punya[0].external_order_no : '');
          };
        };
        req.onerror = () => resolve('');
      }));
      const kunci = extKini || ordInfo.sample[0];
      await ordSearch.fill(kunci);
      await page.waitForTimeout(1500);
      const found = await page.locator('tbody tr').count();
      record('Cari order via No. Pesanan Platform', found > 0, kunci + ' -> ' + found + ' baris');
    }
    await page.screenshot({ path: path.join(SHOTS, '23_orders_external_no.png') });

    console.log('');
    console.log('--- RINGKASAN ---');
    const pass = results.filter((r) => r.pass).length;
    console.log(pass + '/' + results.length + ' lolos');
    process.exitCode = pass === results.length ? 0 : 1;
  } catch (e) {
    console.log('ERROR: ' + e.message);
    await page.screenshot({ path: path.join(SHOTS, '99_error.png') }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
