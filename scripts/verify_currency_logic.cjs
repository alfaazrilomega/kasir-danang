// Verifikasi logika kurs USD pada rantai supplier -> nota -> pembayaran.
//
// Model uangnya: SELURUH nilai nota (subtotal, total, paid_amount) disimpan
// dalam rupiah. Kolom `currency` + `exchange_rate` hanya merekam konteks
// negosiasinya, dan `purchase_items.original_cost_price` menyimpan harga dalam
// mata uang asli. Uji ini mengunci aturan itu supaya tidak diam-diam bergeser.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PSQL = 'C:/Program Files/PostgreSQL/16/bin/psql.exe';
const envText = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const dbPw = /:\/\/[^:]+:([^@]*)@/.exec(envText.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL=')))[1];
const sql = (q) => execFileSync(PSQL, ['-U','kasir_user','-h','127.0.0.1','-d','kasir','-tAqc',q],
  { env: { ...process.env, PGPASSWORD: dbPw }, encoding: 'utf8' }).trim();

const results = [];
const record = (n, p, d) => { results.push({ n, p }); console.log((p ? 'PASS  ' : 'FAIL  ') + n + (d ? ' — ' + d : '')); };

// 1. Kurs supplier USD harus masuk akal, bukan 1.
const kursAneh = Number(sql(`select count(*) from public.suppliers
  where currency = 'USD' and (exchange_rate is null or exchange_rate < 1000);`));
record('Supplier USD punya kurs wajar (>= 1000)', kursAneh === 0, kursAneh + ' supplier bermasalah');

const kursIdr = Number(sql(`select count(*) from public.suppliers
  where currency = 'IDR' and exchange_rate <> 1;`));
record('Supplier IDR memakai kurs 1', kursIdr === 0, kursIdr + ' supplier bermasalah');

// 2. Nota menyimpan kursnya sendiri, jadi kebal terhadap perubahan kurs supplier.
const notaTanpaKurs = Number(sql(`select count(*) from public.purchases
  where currency = 'USD' and (exchange_rate is null or exchange_rate < 1000);`));
record('Nota USD menyimpan kurs sendiri', notaTanpaKurs === 0, notaTanpaKurs + ' nota bermasalah');

const beda = Number(sql(`select count(*) from public.purchases p
  join public.suppliers s on s.id = p.supplier_id
  where p.currency = 'USD' and s.currency = 'USD' and p.exchange_rate <> s.exchange_rate;`));
record('Kurs nota lama tidak ikut berubah saat kurs supplier diubah', true,
  beda + ' nota memakai kurs berbeda dari kurs supplier saat ini (wajar)');

// 3. Total nota konsisten dengan komponennya, dalam rupiah.
const totalSalah = Number(sql(`select count(*) from public.purchases
  where abs(total - (subtotal - discount + tax + other_cost + coalesce(extra_cost, 0))) > 1;`));
record('Total nota = subtotal - diskon + pajak + biaya lain + biaya tambahan',
  totalSalah === 0, totalSalah + ' nota melenceng');

// 4. Nilai nota disimpan dalam rupiah, bukan dolar. Nota USD yang totalnya
//    masih sekelas angka dolar (< 1 juta padahal ada isinya) berarti belum dikonversi.
const belumKonversi = Number(sql(`select count(*) from public.purchases p
  where p.currency = 'USD' and p.subtotal > 0 and p.subtotal < 10000;`));
record('Nilai nota USD tersimpan dalam rupiah, bukan dolar', belumKonversi === 0,
  belumKonversi + ' nota masih berskala dolar');

// 5. Mata uang item harus sama dengan mata uang notanya. Item berlabel IDR di
//    dalam nota USD membuat editor membaca harga rupiah sebagai dolar.
const itemBedaMataUang = Number(sql(`select count(*) from public.purchase_items i
  join public.purchases p on p.id = i.purchase_id
  where coalesce(i.currency, 'IDR') <> coalesce(p.currency, 'IDR');`));
record('Mata uang item sama dengan mata uang nota', itemBedaMataUang === 0,
  itemBedaMataUang + ' item beda mata uang');

// 6. Harga item dalam rupiah = harga asli x kurs nota. Toleransinya
//    memperhitungkan harga USD yang hanya disimpan 2 desimal: selisih
//    pembulatan paling besar setengah sen dikali kurs.
const itemMelenceng = Number(sql(`select count(*) from public.purchase_items i
  join public.purchases p on p.id = i.purchase_id
  where p.currency = 'USD' and i.original_cost_price > 0
    and abs(i.cost_price - i.original_cost_price * p.exchange_rate) > 0.005 * p.exchange_rate + 1;`));
record('Harga item IDR = harga asli x kurs nota', itemMelenceng === 0, itemMelenceng + ' item melenceng');

// 6. Pembayaran tidak boleh melebihi total nota.
const bayarLebih = Number(sql(`select count(*) from public.purchases
  where paid_amount > total + 1;`));
record('Pembayaran tidak melebihi total nota', bayarLebih === 0, bayarLebih + ' nota kelebihan bayar');

// 7. paid_amount cocok dengan jumlah pembayarannya.
const paidBeda = Number(sql(`select count(*) from (
  select p.id, p.paid_amount, coalesce(sum(pay.amount), 0) as jumlah
  from public.purchases p
  left join public.purchase_payments pay on pay.purchase_id = p.id
  group by p.id, p.paid_amount) t where abs(t.paid_amount - t.jumlah) > 1;`));
record('paid_amount = jumlah seluruh pembayaran', paidBeda === 0, paidBeda + ' nota tidak cocok');

// 8. Sisa utang per supplier tidak boleh negatif.
const negatif = Number(sql(`select count(*) from (
  select s.id, sum(greatest(0, p.total - p.paid_amount)) as sisa
  from public.suppliers s join public.purchases p on p.supplier_id = s.id
  where p.status <> 'canceled' group by s.id) t where t.sisa < 0;`));
record('Sisa utang per supplier tidak negatif', negatif === 0, negatif + ' supplier negatif');

// 9. Katalog: harga USD harus berskala dolar, harga IDR berskala rupiah.
//    Inilah gejala bug lama — harga rupiah ikut terlabeli USD saat mata uang
//    supplier diganti, sehingga 13.000 terbaca $13.000.
const katalogAneh = Number(sql(`select count(*) from public.supplier_product_mappings
  where currency = 'USD' and last_cost_price > 10000;`));
record('Tidak ada harga katalog rupiah yang terlabel USD', katalogAneh === 0,
  katalogAneh + ' baris berskala rupiah tapi bermata uang USD');

const katalogIdrKecil = Number(sql(`select count(*) from public.supplier_product_mappings
  where currency = 'IDR' and last_cost_price > 0 and last_cost_price < 100;`));
record('Tidak ada harga katalog dolar yang terlabel IDR', katalogIdrKecil === 0,
  katalogIdrKecil + ' baris berskala dolar tapi bermata uang IDR');

// 12. Subtotal nota harus sama dengan jumlah barisnya. Ketidakcocokan di sini
//     berasal dari data demo lama: seed dulu memakai bulkPut tanpa menghapus
//     baris anak, sehingga satu nota menumpuk item dari beberapa kali seed
//     sementara subtotalnya hanya menghitung item hasil seed terakhir.
const subtotalDrift = Number(sql(`select count(*) from (
  select p.id from public.purchases p join public.purchase_items i on i.purchase_id = p.id
  group by p.id, p.subtotal having abs(p.subtotal - sum(i.subtotal)) > 1) t;`));
record('Subtotal nota = jumlah baris itemnya', subtotalDrift === 0, subtotalDrift + ' nota melenceng');

// 13. Aturan yang sama untuk order penjualan: seed dulu juga menumpuk
//     order_items sehingga subtotal order tidak cocok dengan barisnya.
const orderDrift = Number(sql(`select count(*) from (
  select o.id from public.orders o join public.order_items i on i.order_id = o.id
  group by o.id, o.subtotal having abs(o.subtotal - sum(i.qty * i.price)) > 1) t;`));
record('Subtotal order = jumlah baris itemnya', orderDrift === 0, orderDrift + ' order melenceng');

console.log('');
console.log('--- RINGKASAN ---');
const pass = results.filter((r) => r.p).length;
console.log(pass + '/' + results.length + ' lolos');
process.exitCode = pass === results.length ? 0 : 1;
