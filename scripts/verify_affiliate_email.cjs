// Antrean email affiliate (FR-42 sampai FR-46, AC-51, AC-52).
//
// Bagian 1 memakai pekerja yang hidup di server: alamat uji harus dilewati.
// Bagian 2 menjalankan pekerja yang sama di proses ini dengan pengirim palsu,
// di dalam transaksi yang dibatalkan di akhir. Baris antrean yang dibuat di
// transaksi itu tidak terlihat pekerja server, jadi tidak ada email sungguhan
// yang terkirim dan tidak ada sisa data.

const path = require('path');
const { pathToFileURL } = require('url');
const { Pool } = require('pg');
const { envValue } = require('./lib/harness.cjs');
const A = require('./lib/affiliate.cjs');
const { psql, panggil } = A;

const CAP = Date.now().toString().slice(-6);
const { record, ringkas } = A.pencatat();
const tunggu = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const toko = A.idToko();
  const admin = await A.tokenAdmin();
  const asli = psql(`select affiliate_settings::text from public.stores where id = '${toko}'`);
  const pool = new Pool({ connectionString: envValue('DATABASE_URL'), max: 2 });
  const [P1, P2] = A.produkUji(toko, 2);

  try {
    await A.aturProgram(admin, {
      enabled: true, access_mode: 'approved', general_cookie: true, permanent: false,
      commission: [{ type: 'percentage', value: 10 }],
      email_new_order: true, email_commission: true, email_paid: true, admin_copy_emails: '',
    });
    const Af = await A.daftarPembeli(toko, CAP, 'a');
    await A.izinkan(admin, Af.id);
    const kode = await A.kodeAffiliate(Af.token);
    const k = await A.klik(toko, kode);
    const C = await A.daftarPembeli(toko, CAP, 'c', { cookie: k.cookie });
    const o = await A.pesan(toko, C, [{ product_id: P1.id, qty: 1 }, { product_id: P2.id, qty: 2 }], { cookie: k.cookie });
    await A.konfirmasi(admin, o.id, 10000);
    const bayar = await panggil('POST', '/api/admin/affiliate/payouts', { token: admin, body: { affiliate_id: Af.id, note: 'Transfer BCA uji', record_expense: false } });
    const idKomisi = psql(`select string_agg(id::text, ',') from public.affiliate_commissions where order_id = '${o.id}'`).split(',');
    const jumlahKomisi = Math.floor((P1.price * 10) / 100) + Math.floor((P2.price * 2 * 10) / 100);
    record('Persiapan: pesanan dua barang menghasilkan dua komisi dan satu pembayaran', idKomisi.length === 2 && bayar.status === 200 && bayar.data.amount === jumlahKomisi, `${idKomisi.length} komisi, bayar ${bayar.status}`);

    // ---- Bagian 1: pekerja server melewati alamat uji (AC-52) -------------
    const refs = `'${o.id}', '${bayar.data.id}', ${idKomisi.map((x) => `'${x}'`).join(', ')}`;
    let status = '';
    for (let i = 0; i < 40; i += 1) {
      status = psql(`select string_agg(kind || ':' || status || ':' || coalesce(last_error, ''), ',' order by kind, id) from public.affiliate_outbox where ref_id in (${refs})`);
      if (!/:pending:/.test(status)) break;
      await tunggu(500);
    }
    record('Pekerja server menandai empat baris antrean alamat contoh.id sebagai dilewati (AC-52)',
      status === 'komisi_dibayar:skipped:alamat uji,komisi_masuk:skipped:alamat uji,komisi_masuk:skipped:alamat uji,pesanan_baru:skipped:alamat uji', status);

    // ---- Bagian 2: pekerja di proses ini, di dalam transaksi --------------
    const { prosesOutbox } = await import(pathToFileURL(path.join(__dirname, '..', 'server', 'affiliate', 'pekerja.js')).href);
    const client = await pool.connect();
    const db = { query: (...a) => client.query(...a) };
    const terkirim = [];
    const kirim = async (email) => {
      terkirim.push(email);
    };
    const jalankan = (kirimEmail = kirim) => prosesOutbox({ pool: db, kirimEmail, alamatUji: () => false, asalToko: 'https://toko.uji' });
    const antre = async (kind, ref) => (await client.query(`insert into public.affiliate_outbox (store_id, kind, ref_id) values ($1, $2, $3) returning id`, [toko, kind, ref])).rows[0].id;
    const baris = async (ids) => (await client.query(`select id, status, attempts, last_error, sent_at, next_attempt_at > now() + interval '4 minutes' as tertunda from public.affiliate_outbox where id = any($1::bigint[]) order by id`, [ids])).rows;
    const untukA = () => terkirim.filter((e) => e.to === Af.email);

    await client.query('begin');
    try {
      const ids = [
        await antre('pesanan_baru', o.id),
        await antre('komisi_masuk', idKomisi[0]),
        await antre('komisi_masuk', idKomisi[1]),
        await antre('komisi_dibayar', bayar.data.id),
      ];
      await jalankan();
      const e = untukA();
      record('Empat baris antrean menjadi tiga email: dua komisi satu pesanan digabung', e.length === 3, e.map((x) => x.subject).join(' | '));
      const baru = e.find((x) => x.subject.startsWith('Order #'));
      record('Judul email order baru mengikuti Sejoli (AC-51)', !!baru && baru.subject.startsWith(`Order #${o.number} `) && baru.subject.endsWith(` baru dari ${C.name}`) && / \+1 produk lain /.test(baru.subject), baru?.subject);
      const masuk = e.find((x) => x.subject.includes('Komisi untuk anda dari order'));
      record('Judul email komisi masuk mengikuti Sejoli dan isinya jumlah kedua komisi',
        !!masuk && masuk.subject.startsWith(`${Af.name}, Komisi untuk anda dari order #${o.number} `) && masuk.text.includes(`Rp ${new Intl.NumberFormat('id-ID').format(jumlahKomisi)}`), masuk?.subject);
      const dibayar = e.find((x) => x.subject.endsWith('sudah dibayarkan'));
      record('Judul email komisi dibayar mengikuti Sejoli, memuat jumlah dan catatan',
        !!dibayar && dibayar.subject === `${Af.name}, Komisi untuk anda sudah dibayarkan` && dibayar.text.includes(`Rp ${new Intl.NumberFormat('id-ID').format(jumlahKomisi)} (2 komisi)`) && dibayar.text.includes('Catatan: Transfer BCA uji'), dibayar?.subject);
      record('Tautan di email menuju dashboard affiliate di alamat toko', e.every((x) => x.text.includes('https://toko.uji/toko/affiliate?tab=') && x.html.includes('https://toko.uji/toko/affiliate?tab=')));
      const b1 = await baris(ids);
      record('Baris yang terkirim bertanda sent dengan waktu kirim', b1.every((x) => x.status === 'sent' && x.attempts === 1 && x.sent_at), JSON.stringify(b1.map((x) => x.status)));

      // Salinan untuk admin.
      await client.query(`update public.stores set affiliate_settings = affiliate_settings || '{"admin_copy_emails":"salinan@toko.uji, kedua@toko.uji"}'::jsonb where id = $1`, [toko]);
      terkirim.length = 0;
      await antre('komisi_dibayar', bayar.data.id);
      await jalankan();
      const salinan = terkirim.filter((x) => x.subject === `[Salinan] ${Af.name}, Komisi untuk anda sudah dibayarkan`).map((x) => x.to).sort();
      record('Alamat salinan admin menerima salinan tiap email', salinan.join(',') === 'kedua@toko.uji,salinan@toko.uji' && untukA().length === 1, salinan.join(','));
      await client.query(`update public.stores set affiliate_settings = affiliate_settings || '{"admin_copy_emails":""}'::jsonb where id = $1`, [toko]);

      // Gagal kirim: coba ulang sampai tiga kali, lalu berhenti (AC-51).
      let panggilan = 0;
      const menolak = async () => {
        panggilan += 1;
        throw new Error('Mailketing menolak');
      };
      const idGagal = await antre('pesanan_baru', o.id);
      await jalankan(menolak);
      let g = (await baris([idGagal]))[0];
      record('Kirim gagal: baris tetap antre, percobaan 1, ditunda sekitar 5 menit', g.status === 'pending' && g.attempts === 1 && g.last_error === 'Mailketing menolak' && g.tertunda, JSON.stringify(g));
      await jalankan(menolak);
      record('Baris yang ditunda tidak dicoba sebelum waktunya', panggilan === 1, String(panggilan));
      await client.query(`update public.affiliate_outbox set next_attempt_at = now() - interval '1 second' where id = $1`, [idGagal]);
      await jalankan(menolak);
      await client.query(`update public.affiliate_outbox set next_attempt_at = now() - interval '1 second' where id = $1`, [idGagal]);
      await jalankan(menolak);
      g = (await baris([idGagal]))[0];
      record('Setelah tiga percobaan baris bertanda failed', g.status === 'failed' && g.attempts === 3 && panggilan === 3, JSON.stringify(g));
      await client.query(`update public.affiliate_outbox set next_attempt_at = now() - interval '1 second' where id = $1`, [idGagal]);
      await jalankan(menolak);
      record('Baris failed tidak dicoba lagi', panggilan === 3, String(panggilan));

      // Email dimatikan dan komisi yang sudah batal.
      terkirim.length = 0;
      await client.query(`update public.stores set affiliate_settings = affiliate_settings || '{"email_commission":false,"email_paid":false}'::jsonb where id = $1`, [toko]);
      const idMati = [await antre('komisi_masuk', idKomisi[0]), await antre('komisi_dibayar', bayar.data.id)];
      await jalankan();
      const bm = await baris(idMati);
      record('Email yang dimatikan di pengaturan dilewati', bm.map((x) => `${x.status}:${x.last_error}`).join(',') === 'skipped:email komisi dimatikan,skipped:email pembayaran dimatikan' && untukA().length === 0, bm.map((x) => `${x.status}:${x.last_error}`).join(','));
      await client.query(`update public.stores set affiliate_settings = affiliate_settings || '{"email_commission":true,"email_paid":true}'::jsonb where id = $1`, [toko]);
      await client.query(`update public.affiliate_commissions set status = 'cancelled' where id = any($1::uuid[])`, [idKomisi]);
      const idBatal = await antre('komisi_masuk', idKomisi[0]);
      await jalankan();
      const bb = (await baris([idBatal]))[0];
      record('Komisi yang sudah batal sebelum email terkirim tidak diemailkan', bb.status === 'skipped' && untukA().length === 0, `${bb.status}:${bb.last_error}`);
    } finally {
      await client.query('rollback');
      client.release();
    }
    record('Transaksi uji dibatalkan: tidak ada baris antrean tersisa', psql(`select count(*) from public.affiliate_outbox where ref_id in (${refs})`) === '4' && psql(`select count(*) from public.affiliate_commissions where order_id = '${o.id}' and status = 'added'`) === '2');
  } catch (e) {
    record('Suite berjalan sampai selesai', false, e.stack || e.message);
  } finally {
    // Akun, pesanan (stok dikembalikan), komisi, dan pembayaran putaran ini dihapus,
    // supaya suite lain tidak membaca data uji affiliate.
    await A.bersihkanUji(admin, `aff.%.${CAP}@contoh.id`).catch((e) => record('Data uji putaran ini terhapus', false, e.message));
    psql(`update public.stores set affiliate_settings = $j$${asli || '{}'}$j$::jsonb where id = '${toko}'`);
    await pool.end();
  }
  ringkas();
})();
