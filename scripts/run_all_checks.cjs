// Runner tunggal untuk seluruh pemeriksaan. Menjalankan tiap suite berurutan,
// merangkum hasilnya, dan mengembalikan exit code non-nol bila ada yang gagal.
const { execFileSync } = require('child_process');
const SUITES = [
  'qc_endpoints', 'qc_all_writes',
  'verify_sku_mapping', 'verify_expenses_pnl', 'verify_three_features',
  'verify_outbox', 'verify_seed_push', 'verify_pnl_math',
  'verify_opname_logic', 'verify_security_logic', 'verify_stock_mutation',
  'verify_dark_mode', 'verify_import_export', 'verify_supplier_catalog',
  'verify_currency_logic', 'verify_returns', 'verify_sales_import',
  'verify_marketplace_import', 'verify_pos_online', 'verify_purchase_rate_lock',
  'verify_purchase_revisions',
  'verify_product_sets',
  'verify_opname_import',
  'verify_settlement_import',
  'verify_client_additions',
  'verify_guest_checkout',
  'verify_flash_sale',
];
let pass = 0, total = 0, failed = [];
for (const s of SUITES) {
  let out = '';
  try {
    out = execFileSync('node', [`scripts/${s}.cjs`], { encoding: 'utf8', timeout: 600000 });
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '');
  }
  const m = /(\d+)\/(\d+) (?:jalur tulis )?lolos/.exec(out);
  if (!m) {
    // Tanpa ringkasan berarti suite mati sebelum selesai. Cetak ekor keluarannya,
    // kalau tidak penyebabnya ikut tertelan dan tidak bisa didiagnosis.
    const ekor = out.trim().split(String.fromCharCode(10)).slice(-6).join(' / ').slice(0, 400);
    failed.push(`${s}: tidak ada ringkasan — ${ekor}`);
    console.log(`${s.padEnd(24)} ???`);
    continue;
  }
  const [p, t] = [Number(m[1]), Number(m[2])];
  pass += p; total += t;
  const bad = out.split('\n').filter((l) => l.startsWith('FAIL')).map((l) => l.trim());
  if (p !== t) failed.push(`${s}: ${bad.join(' | ')}`);
  console.log(`${s.padEnd(24)} ${p}/${t}` + (p === t ? '' : '   <-- GAGAL'));
}
console.log('\n=========================================');
console.log(`TOTAL ${pass}/${total}`);
if (failed.length) { console.log('\nRINCIAN GAGAL:'); failed.forEach((f) => console.log(' - ' + f)); }
process.exitCode = pass === total && !failed.length ? 0 : 1;
