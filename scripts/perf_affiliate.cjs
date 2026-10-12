// Uji kinerja API affiliate (NFR-2): p95 paling lama 500 ms dengan 10.000
// pesanan dan 50.000 klik.
//
// Dijalankan manual: node scripts/perf_affiliate.cjs
// Data volume dibuat untuk satu affiliate khusus lalu dihapus lagi di akhir.
// Tidak ikut run_all_checks karena menulis puluhan ribu baris.

const A = require('./lib/affiliate.cjs');
const { psql, panggil } = A;

const CAP = Date.now().toString().slice(-6);
const PESANAN = 10000;
const KLIK = 50000;
const ULANG = 30;
const BATAS_MS = 500;

function persentil(nilai, p) {
  const urut = [...nilai].sort((a, b) => a - b);
  return urut[Math.min(urut.length - 1, Math.ceil((p / 100) * urut.length) - 1)];
}

(async () => {
  const toko = A.idToko();
  const admin = await A.tokenAdmin();
  const asli = psql(`select affiliate_settings::text from public.stores where id = '${toko}'`);
  const [produk] = A.produkUji(toko, 1);
  let aff = null;
  let pembeli = null;
  let gagal = 0;

  try {
    await A.aturProgram(admin, { enabled: true, access_mode: 'approved', show_buyer_contact: true, show_downline_contact: true });
    aff = await A.daftarPembeli(toko, CAP, 'perf');
    await A.izinkan(admin, aff.id);
    const kode = await A.kodeAffiliate(aff.token);
    pembeli = await A.daftarPembeli(toko, CAP, 'perfb', { cookie: (await A.klik(toko, kode)).cookie });

    const mulai = Date.now();
    psql(`
      insert into public.orders (id, store_id, customer_id, order_number, subtotal, tax, discount, total, payment_method, payment_status,
                                 order_status, order_type, created_at, sales_channel, payment_term, paid_amount, customer_name, customer_phone,
                                 delivery_address, points_earned, affiliate_id, affiliate_source, acquisition_source, acquisition_media)
      select gen_random_uuid(), '${toko}', '${pembeli.id}', 'PERF-${CAP}-' || g, 100000 + (g % 50) * 10000, 0, 0, 100000 + (g % 50) * 10000, 'transfer',
             case when g % 10 < 7 then 'paid' else 'unpaid' end,
             case when g % 10 < 7 then 'done' when g % 10 < 9 then 'awaiting_confirmation' else 'canceled' end,
             'take_away', now() - (g % 180) * interval '1 day' - (g % 24) * interval '1 hour', 'website', 'cash', 0, 'Pembeli Perf', '081200000000',
             'Jl. Perf', 0, '${aff.id}', 'link', (array['fb', 'ins', 'what', 'tiktok', null])[1 + g % 5], 'kampanye-' || (g % 20)
        from generate_series(1, ${PESANAN}) g;
      insert into public.order_items (id, order_id, product_id, name, size, qty, price, cost_price, note)
      select gen_random_uuid(), o.id, '${produk.id}', 'Produk Perf', null, 1, o.subtotal, null, null
        from public.orders o where o.customer_id = '${pembeli.id}';
      insert into public.affiliate_commissions (store_id, order_id, order_item_id, product_id, affiliate_id, tier, base_amount, rate_type, rate_value, commission, status, created_at)
      select '${toko}', o.id, i.id, '${produk.id}', '${aff.id}', 1, o.subtotal, 'percentage', 10, floor(o.subtotal * 0.1),
             case o.order_status when 'done' then 'added' when 'canceled' then 'cancelled' else 'pending' end, o.created_at
        from public.orders o join public.order_items i on i.order_id = o.id where o.customer_id = '${pembeli.id}';
      insert into public.affiliate_clicks (store_id, affiliate_id, product_id, kind, source, media, visitor_hash, created_at)
      select '${toko}', '${aff.id}', '${produk.id}', 'link', (array['fb', 'ins', 'what', 'tiktok', ''])[1 + g % 5], case when g % 5 = 4 then '' else 'kampanye-' || (g % 20) end,
             md5(g::text), now() - (g % 180) * interval '1 day' - (g % 1440) * interval '1 minute'
        from generate_series(1, ${KLIK}) g;
      analyze public.orders; analyze public.order_items; analyze public.affiliate_commissions; analyze public.affiliate_clicks;
    `);
    const isi = psql(`select (select count(*) from public.orders where affiliate_id = '${aff.id}') || ' pesanan, ' || (select count(*) from public.affiliate_clicks where affiliate_id = '${aff.id}') || ' klik, ' || (select count(*) from public.affiliate_commissions where affiliate_id = '${aff.id}') || ' komisi'`);
    console.log(`Data volume: ${isi} (dibuat dalam ${Date.now() - mulai} ms)`);

    const jalur = [
      ['pembeli', 'GET /api/customer/affiliate (ringkasan)', '/api/customer/affiliate'],
      ['pembeli', 'GET charts', '/api/customer/affiliate/charts'],
      ['pembeli', 'GET acquisition', '/api/customer/affiliate/acquisition'],
      ['pembeli', 'GET orders', '/api/customer/affiliate/orders'],
      ['pembeli', 'GET commissions', '/api/customer/affiliate/commissions'],
      ['pembeli', 'GET network', '/api/customer/affiliate/network'],
      ['pembeli', 'GET products', '/api/customer/affiliate/products'],
      ['pembeli', 'GET invitations', '/api/customer/affiliate/invitations'],
      ['admin', 'GET overview (30 hari)', `/api/admin/affiliate/overview?from=${psql("select ((now() at time zone 'Asia/Jakarta')::date - 29)::text")}&to=${psql("select (now() at time zone 'Asia/Jakarta')::date::text")}`],
      ['admin', 'GET overview (semua)', '/api/admin/affiliate/overview'],
      ['admin', 'GET commissions', '/api/admin/affiliate/commissions'],
      ['admin', 'GET payouts/summary', '/api/admin/affiliate/payouts/summary'],
      ['admin', 'GET payouts', '/api/admin/affiliate/payouts'],
      ['admin', 'GET members', '/api/admin/affiliate/members'],
    ];
    console.log(`\n${'endpoint'.padEnd(44)} p50    p95    maks   ukuran`);
    for (const [siapa, nama, path] of jalur) {
      const token = siapa === 'admin' ? admin : aff.token;
      const waktu = [];
      let ukuran = 0;
      let status = 0;
      await panggil('GET', path, { token });
      for (let i = 0; i < ULANG; i += 1) {
        const t = performance.now();
        const r = await panggil('GET', path, { token });
        waktu.push(performance.now() - t);
        status = r.status;
        ukuran = JSON.stringify(r.json ?? '').length;
      }
      const p95 = persentil(waktu, 95);
      const ok = status === 200 && p95 <= BATAS_MS;
      if (!ok) gagal += 1;
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${nama.padEnd(38)} ${String(Math.round(persentil(waktu, 50))).padStart(4)} ms ${String(Math.round(p95)).padStart(4)} ms ${String(Math.round(Math.max(...waktu))).padStart(4)} ms ${String(Math.round(ukuran / 1024)).padStart(5)} KB${status === 200 ? '' : ' status ' + status}`);
    }
  } catch (e) {
    gagal += 1;
    console.log('GAGAL: ' + (e.stack || e.message) + (e.cause ? ' / sebab: ' + (e.cause.code || e.cause.message) : ''));
  } finally {
    if (pembeli) psql(`delete from public.orders where customer_id = '${pembeli.id}' and order_number like 'PERF-${CAP}-%'`);
    if (aff) psql(`delete from public.affiliate_clicks where affiliate_id = '${aff.id}'`);
    psql(`update public.stores set affiliate_settings = $j$${asli || '{}'}$j$::jsonb where id = '${toko}'`);
    await A.bersihkanUji(admin, `aff.%.${CAP}@contoh.id`).catch((e) => console.log('Pembersihan gagal: ' + e.message));
    const sisa = aff ? psql(`select (select count(*) from public.orders where affiliate_id = '${aff.id}') + (select count(*) from public.affiliate_clicks where affiliate_id = '${aff.id}') + (select count(*) from public.affiliate_commissions where affiliate_id = '${aff.id}')`) : '0';
    console.log(`\nData volume dihapus, sisa baris: ${sisa}`);
  }
  console.log(gagal === 0 ? `\nSemua endpoint p95 <= ${BATAS_MS} ms.` : `\n${gagal} endpoint melewati ${BATAS_MS} ms atau gagal.`);
  process.exitCode = gagal === 0 ? 0 : 1;
})();
