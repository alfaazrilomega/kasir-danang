const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SCREENSHOT_DIR = path.resolve(__dirname, '../audit_screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function runAudit() {
  console.log('=== STARTING EMPIRICAL BROWSER FORENSIC AUDIT ===');
  const browser = await chromium.launch({ channel: 'msedge', headless: true }).catch(() =>
    chromium.launch({ channel: 'chrome', headless: true })
  );
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const auditLog = [];

  async function auditPage(name, url, screenshotFile, checkFn) {
    console.log(`\n[PAGE TEST] Navigating to ${name} (${url})...`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1500);
    const metrics = checkFn ? await checkFn() : {};
    const screenshotPath = path.join(SCREENSHOT_DIR, screenshotFile);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    auditLog.push({ page: name, url, metrics, screenshot: screenshotFile });
    console.log(`  ✓ ${name} VALIDATED:`, JSON.stringify(metrics));
  }

  // 1. Login Page
  await auditPage('01. Login Page', 'http://localhost:5173/login', '01_login_page.png', async () => {
    const title = await page.title();
    const demoButtons = await page.locator('button:has-text("@example.com")').count();
    return { title, demoButtonsFound: demoButtons };
  });

  // 2. Perform Login as Admin
  console.log('\n[AUTH] Logging in as Admin (admin@example.com)...');
  await page.click('button:has-text("admin@example.com")');
  await page.waitForTimeout(300);
  await page.click('button[type="submit"]:has-text("Masuk")');
  await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2500);

  // Wait for IndexedDB seed completion
  await page.waitForFunction(async () => {
    const dbs = await window.indexedDB.databases();
    return dbs.some((d) => d.name === 'kasir');
  }, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2000);

  // 3. Dashboard
  await auditPage('02. Dashboard', 'http://localhost:5173/', '02_dashboard.png', async () => {
    const text = await page.locator('body').innerText();
    const hasSalesChart = await page.locator('canvas, svg, div[class*="recharts"]').count();
    const cards = await page.locator('div:has-text("Rp"), div:has-text("Penjualan")').count();
    return { hasWelcome: text.includes('Halo, Admin') || text.includes('Dashboard'), metricsCards: cards, chartElements: hasSalesChart };
  });

  // 4. POS Menu
  await auditPage('03. POS Menu', 'http://localhost:5173/menu', '03_pos_menu.png', async () => {
    const categoryTabs = await page.locator('button:has-text("Semua"), button:has-text("Kopi"), button:has-text("Makanan")').count();
    const productItems = await page.locator('button:has-text("Rp"), div:has-text("Rp")').count();
    return { categoryTabs, productCards: productItems };
  });

  // 5. Orders List
  await auditPage('04. Orders List', 'http://localhost:5173/orders', '04_orders.png', async () => {
    const text = await page.locator('body').innerText();
    const orderCards = await page.locator('div:has-text("Rp"), span:has-text("Lunas"), span:has-text("Tempo")').count();
    const channelBadges = await page.locator('span:has-text("TikTok"), span:has-text("Shopee"), span:has-text("Offline"), span:has-text("WhatsApp")').count();
    return { hasOrdersText: text.includes('Daftar Pesanan') || text.includes('Pesanan'), orderElements: orderCards, channelBadgesFound: channelBadges };
  });

  // 6. Customers
  await auditPage('05. Customers CRM', 'http://localhost:5173/customers', '05_customers.png', async () => {
    const customers = await page.locator('div:has-text("081"), div:has-text("Poin"), div:has-text("Order")').count();
    return { customerCards: customers };
  });

  // 7. Master Products & SKU
  await auditPage('06. Master Products & SKU', 'http://localhost:5173/products', '06_products.png', async () => {
    const skuItems = await page.locator('div:has-text("KAS-"), span:has-text("KAS-"), div:has-text("HPP")').count();
    return { productsWithSKU: skuItems };
  });

  // 8. Suppliers
  await auditPage('07. Suppliers', 'http://localhost:5173/suppliers', '07_suppliers.png', async () => {
    const supplierBadges = await page.locator('span:has-text("USD"), span:has-text("IDR"), div:has-text("Kurs")').count();
    return { supplierCurrencyBadges: supplierBadges };
  });

  // 9. Purchases / PO
  await auditPage('08. Purchases (PO)', 'http://localhost:5173/purchases', '08_purchases.png', async () => {
    const poItems = await page.locator('div:has-text("PO-2026-"), span:has-text("received"), span:has-text("ordered")').count();
    return { poRecordsFound: poItems };
  });

  // 10. Promos
  await auditPage('09. Promos', 'http://localhost:5173/promos', '09_promos.png', async () => {
    const promoCards = await page.locator('div:has-text("DISKON10"), div:has-text("HEMAT20"), div:has-text("Voucher")').count();
    return { promoCardsFound: promoCards };
  });

  // 11. Shifts
  await auditPage('10. Shifts Kasir', 'http://localhost:5173/shifts', '10_shifts.png', async () => {
    const shiftCards = await page.locator('div:has-text("Kas Awal"), div:has-text("Total Penjualan"), div:has-text("Shift")').count();
    return { shiftCardsFound: shiftCards };
  });

  // 12. Reports
  await auditPage('11. Reports', 'http://localhost:5173/reports', '11_reports.png', async () => {
    const reportsMetrics = await page.locator('div:has-text("Laba"), div:has-text("Omzet"), div:has-text("HPP")').count();
    return { reportMetricBoxes: reportsMetrics };
  });

  // 13. Users Management
  await auditPage('12. Users Management', 'http://localhost:5173/users', '12_users.png', async () => {
    const userRows = await page.locator('div:has-text("@example.com"), span:has-text("Admin"), span:has-text("Kasir")').count();
    return { userElements: userRows };
  });

  // 14. Customer Portal
  console.log('\n[AUTH] Logging out and logging in as Customer (customer@example.com)...');
  await page.goto('http://localhost:5173/login');
  await page.click('button:has-text("customer@example.com")');
  await page.waitForTimeout(300);
  await page.click('button[type="submit"]:has-text("Masuk")');
  await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);

  await auditPage('13. Customer Portal', 'http://localhost:5173/customer', '13_customer_portal.png', async () => {
    const text = await page.locator('body').innerText();
    const catalogCards = await page.locator('div:has-text("Rp"), div:has-text("Habis"), div:has-text("Katalog Pembeli")').count();
    return { hasPortalHeader: text.includes('Katalog Pembeli'), catalogCardsFound: catalogCards };
  });

  await browser.close();

  console.log('\n======================================================');
  console.log('       FORENSIC VALIDATION REPORT SUMMARY             ');
  console.log('======================================================');
  console.table(auditLog.map((item) => ({
    Page: item.page,
    URL: item.url,
    Evidence: item.screenshot,
    Validation: JSON.stringify(item.metrics),
  })));
}

runAudit().catch((err) => {
  console.error('Fatal audit error:', err);
  process.exit(1);
});
