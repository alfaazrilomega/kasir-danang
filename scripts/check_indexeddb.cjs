const { chromium } = require('playwright');

async function check() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true }).catch(() =>
    chromium.launch({ channel: 'chrome', headless: true })
  );
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('Opening Login...');
  await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
  await page.click('button:has-text("admin@example.com")');
  await page.waitForTimeout(300);
  await page.click('button[type="submit"]:has-text("Masuk")');
  await page.waitForTimeout(5000);

  const counts = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const req = indexedDB.open('kasir');
      req.onsuccess = async () => {
        const db = req.result;
        const res = {};
        for (const name of Array.from(db.objectStoreNames)) {
          const count = await new Promise((r) => {
            const tx = db.transaction(name, 'readonly');
            const cr = tx.objectStore(name).count();
            cr.onsuccess = () => r(cr.result);
            cr.onerror = () => r(0);
          });
          res[name] = count;
        }
        resolve(res);
      };
      req.onerror = () => resolve({});
    });
  });

  console.log('INDEXED_DB_LIVE_COUNTS:');
  console.table(counts);
  await browser.close();
}

check().catch(console.error);
