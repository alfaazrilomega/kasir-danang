// Perkakas bersama untuk suite verifikasi browser.
//
// Masalah yang diselesaikan: tiap suite membuka browser baru sehingga
// IndexedDB kosong, seed demo berjalan, lalu pushSeedToServer() mengunggah
// ribuan baris di latar belakang. Menunggu dengan waitForTimeout tetap
// (8-16 detik) kadang cukup, kadang tidak — hasilnya suite flaky: lolos
// sendirian, gagal saat dijalankan berurutan.
//
// Solusinya mendeteksi KESEPIAN JARINGAN: pantau semua permintaan ke /api/,
// lalu tunggu sampai tidak ada permintaan berjalan dan tidak ada aktivitas
// baru selama beberapa detik. Ini menunggu selama yang memang dibutuhkan,
// tidak lebih.

const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '..', '.env');
const envText = fs.readFileSync(ENV_PATH, 'utf8');

/** Ambil satu nilai dari .env. */
function envValue(key) {
  const line = envText.split(/\r?\n/).find((l) => l.startsWith(key + '='));
  return line ? line.slice(key.length + 1) : '';
}

const ADMIN_PASSWORD = envValue('BOOTSTRAP_ADMIN_PASSWORD');
const DB_PASSWORD = /:\/\/[^:]+:([^@]*)@/.exec(envValue('DATABASE_URL'))[1];
const BASE_URL = 'http://localhost:5173';

/**
 * Pasang pelacak aktivitas API. Harus dipanggil SEBELUM navigasi pertama,
 * kalau tidak permintaan awal tidak ikut terhitung.
 */
function trackApi(page) {
  const state = { inflight: 0, lastActivity: Date.now(), total: 0 };
  page.on('request', (req) => {
    if (!req.url().includes('/api/')) return;
    state.inflight += 1;
    state.total += 1;
    state.lastActivity = Date.now();
  });
  const settle = (req) => {
    if (!req.url().includes('/api/')) return;
    state.inflight = Math.max(0, state.inflight - 1);
    state.lastActivity = Date.now();
  };
  page.on('requestfinished', settle);
  page.on('requestfailed', settle);
  page.__apiState = state;
  return state;
}

/**
 * Tunggu sampai aplikasi berhenti memanggil API.
 * @param idleMs berapa lama harus sepi sebelum dianggap selesai
 * @param timeoutMs batas atas; kalau terlampaui, lanjut saja (jangan gantung)
 */
async function waitForApiIdle(page, { idleMs = 3000, timeoutMs = 180000, minWaitMs = 1500 } = {}) {
  const state = page.__apiState;
  if (!state) throw new Error('trackApi(page) belum dipanggil');
  const started = Date.now();
  await page.waitForTimeout(minWaitMs);
  for (;;) {
    const quietFor = Date.now() - state.lastActivity;
    if (state.inflight === 0 && quietFor >= idleMs) return { total: state.total, waited: Date.now() - started };
    if (Date.now() - started > timeoutMs) {
      return { total: state.total, waited: Date.now() - started, timedOut: true };
    }
    await page.waitForTimeout(250);
  }
}

/** Login admin asli lalu tunggu seed + push selesai. */
async function loginAdmin(page, { fresh = false, theme } = {}) {
  await page.goto(BASE_URL + '/login', { waitUntil: 'networkidle' });
  if (fresh) {
    await page.evaluate(() => new Promise((resolve) => {
      const req = indexedDB.deleteDatabase('kasir');
      req.onsuccess = req.onerror = req.onblocked = () => resolve(true);
    }));
    await page.evaluate(() => localStorage.clear());
  }
  if (theme) {
    await page.evaluate((m) => {
      localStorage.setItem('kasir.ui', JSON.stringify({ state: { theme: m }, version: 0 }));
    }, theme);
  }
  if (fresh || theme) await page.reload({ waitUntil: 'networkidle' });

  await page.fill('input[type="email"]', 'admin@example.com');
  await page.fill('input[type="password"]', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  return waitForApiIdle(page, { idleMs: 3500, minWaitMs: 2500 });
}

/** Buka rute lalu tunggu API sepi supaya asersi tidak balapan dengan sync. */
async function gotoSettled(page, route, opts = {}) {
  await page.goto(BASE_URL + route, { waitUntil: 'networkidle' });
  return waitForApiIdle(page, { idleMs: 2000, minWaitMs: 800, ...opts });
}

module.exports = {
  BASE_URL,
  ADMIN_PASSWORD,
  DB_PASSWORD,
  envValue,
  trackApi,
  waitForApiIdle,
  loginAdmin,
  gotoSettled,
};
