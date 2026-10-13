// Pekerja antrean email affiliate (FR-42 sampai FR-44, FR-46).
// Baris antrean dibuat di checkout, oleh pemicu status pesanan, dan saat
// pembayaran komisi. Pekerja ini mengirimnya di luar transaksi apa pun, jadi
// email yang gagal tidak pernah membatalkan pesanan atau pembayaran.
import { gabungPengaturan, satuBaris } from './inti.js';

const MAKS_PERCOBAAN = 3;
const JEDA_MENIT = 5;

const rupiah = (n) => `Rp ${new Intl.NumberFormat('id-ID').format(Math.round(Number(n) || 0))}`;

function esc(nilai) {
  return String(nilai ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Nama produk untuk judul email: satu nama, atau nama pertama plus jumlah sisanya. */
export function judulProduk(nama) {
  const daftar = (nama ?? []).filter(Boolean);
  if (!daftar.length) return 'Produk';
  return daftar.length === 1 ? daftar[0] : `${daftar[0]} +${daftar.length - 1} produk lain`;
}

function bungkus(toko, isi, tautan, tombol) {
  return (
    `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.5">${isi}` +
    `<p><a href="${esc(tautan)}" style="display:inline-block;background:#5A41E5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">${esc(tombol)}</a></p>` +
    `<p style="color:#666;font-size:12px">Email ini dikirim otomatis oleh ${esc(toko)}.</p></div>`
  );
}

/** Judul mengikuti Sejoli: "Order #{{invoice-id}} {{product-name}} baru dari {{buyer-name}}". */
export function emailPesananBaru({ toko, affiliate, order, produk, komisi, tautan }) {
  const judul = judulProduk(produk);
  const subject = satuBaris(`Order #${order.order_number} ${judul} baru dari ${order.buyer_name}`);
  const baris = [
    `Halo ${affiliate.name},`,
    '',
    `Ada order baru dari link affiliasi anda di ${toko}.`,
    `Nomor order: #${order.order_number}`,
    `Produk: ${judul}`,
    `Pembeli: ${order.buyer_name}`,
    `Nilai produk: ${rupiah(order.items_value)}`,
    `Komisi anda: ${rupiah(komisi)} (masuk setelah order selesai)`,
    '',
    `Lihat di dashboard affiliate: ${tautan}`,
  ];
  const html = bungkus(
    toko,
    `<p>Halo ${esc(affiliate.name)},</p><p>Ada order baru dari link affiliasi anda di <b>${esc(toko)}</b>.</p>` +
      `<table style="border-collapse:collapse">` +
      `<tr><td style="padding:2px 12px 2px 0;color:#666">Nomor order</td><td>#${esc(order.order_number)}</td></tr>` +
      `<tr><td style="padding:2px 12px 2px 0;color:#666">Produk</td><td>${esc(judul)}</td></tr>` +
      `<tr><td style="padding:2px 12px 2px 0;color:#666">Pembeli</td><td>${esc(order.buyer_name)}</td></tr>` +
      `<tr><td style="padding:2px 12px 2px 0;color:#666">Nilai produk</td><td>${esc(rupiah(order.items_value))}</td></tr>` +
      `<tr><td style="padding:2px 12px 2px 0;color:#666">Komisi anda</td><td><b>${esc(rupiah(komisi))}</b> (masuk setelah order selesai)</td></tr>` +
      `</table>`,
    tautan,
    'Buka dashboard affiliate',
  );
  return { subject, text: baris.join('\n'), html };
}

/** Judul mengikuti Sejoli: "{{affiliate-name}}, Komisi untuk anda dari order #{{invoice-id}} {{product-name}}". */
export function emailKomisiMasuk({ toko, affiliate, order, produk, komisi, tautan }) {
  const judul = judulProduk(produk);
  const subject = satuBaris(`${affiliate.name}, Komisi untuk anda dari order #${order.order_number} ${judul}`);
  const text = [
    `Halo ${affiliate.name},`,
    '',
    `Order #${order.order_number} (${judul}) di ${toko} sudah selesai.`,
    `Komisi ${rupiah(komisi)} sudah masuk ke akun affiliate anda dan menunggu dibayarkan.`,
    '',
    `Lihat komisi anda: ${tautan}`,
  ].join('\n');
  const html = bungkus(
    toko,
    `<p>Halo ${esc(affiliate.name)},</p><p>Order <b>#${esc(order.order_number)}</b> (${esc(judul)}) di ${esc(toko)} sudah selesai.</p>` +
      `<p>Komisi <b>${esc(rupiah(komisi))}</b> sudah masuk ke akun affiliate anda dan menunggu dibayarkan.</p>`,
    tautan,
    'Lihat komisi',
  );
  return { subject, text, html };
}

/** Judul mengikuti Sejoli: "{{affiliate-name}}, Komisi untuk anda sudah dibayarkan". */
export function emailKomisiDibayar({ toko, affiliate, payout, tautan }) {
  const subject = satuBaris(`${affiliate.name}, Komisi untuk anda sudah dibayarkan`);
  const tanggal = new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeZone: 'Asia/Jakarta' }).format(new Date(payout.paid_at));
  // D-40: bila ada bonus atau potongan, jumlah transfer tidak sama dengan jumlah komisi.
  const bonus = Number(payout.bonus_total) || 0;
  const potongan = Number(payout.deduction_total) || 0;
  const rincian =
    bonus > 0 || potongan > 0
      ? `Rincian: komisi ${rupiah(payout.commission_total)}${bonus > 0 ? ` + bonus target ${rupiah(bonus)}` : ''}${potongan > 0 ? ` - potongan retur dan pembatalan ${rupiah(potongan)}` : ''}`
      : null;
  const text = [
    `Halo ${affiliate.name},`,
    '',
    `${toko} sudah membayarkan komisi affiliate anda.`,
    `Jumlah: ${rupiah(payout.amount)} (${payout.commission_count} komisi)`,
    ...(rincian ? [rincian] : []),
    `Tanggal: ${tanggal}`,
    ...(payout.note ? [`Catatan: ${payout.note}`] : []),
    '',
    `Riwayat komisi: ${tautan}`,
  ].join('\n');
  const html = bungkus(
    toko,
    `<p>Halo ${esc(affiliate.name)},</p><p>${esc(toko)} sudah membayarkan komisi affiliate anda.</p>` +
      `<table style="border-collapse:collapse">` +
      `<tr><td style="padding:2px 12px 2px 0;color:#666">Jumlah</td><td><b>${esc(rupiah(payout.amount))}</b> (${esc(payout.commission_count)} komisi)</td></tr>` +
      (rincian ? `<tr><td style="padding:2px 12px 2px 0;color:#666">Rincian</td><td>${esc(rincian.replace('Rincian: ', ''))}</td></tr>` : '') +
      `<tr><td style="padding:2px 12px 2px 0;color:#666">Tanggal</td><td>${esc(tanggal)}</td></tr>` +
      (payout.note ? `<tr><td style="padding:2px 12px 2px 0;color:#666">Catatan</td><td>${esc(payout.note)}</td></tr>` : '') +
      `</table>`,
    tautan,
    'Lihat riwayat komisi',
  );
  return { subject, text, html };
}

/**
 * Undangan ke calon member (FR-45). Tidak lewat antrean: token mentah hanya ada
 * saat undangan dibuat, jadi rute mengirimnya langsung. `tautan` disusun
 * pemanggil dari alamat toko di konfigurasi server, tidak pernah dari header
 * permintaan, supaya email resmi toko tidak bisa membawa tautan ke domain lain.
 */
export function emailUndangan({ toko, affiliate, nama, pesan, tautan, hari }) {
  const sapa = nama ? `Halo ${nama},` : 'Halo,';
  const subject = satuBaris(`${affiliate.name} mengundang kamu ke ${toko}`);
  const text =
    `${sapa}\n\n${affiliate.name} mengundang kamu bergabung dan belanja di ${toko}.\n` +
    (pesan ? `\nPesan dari ${affiliate.name}: "${pesan}"\n` : '') +
    `\nTerima undangan: ${tautan}\nTautan ini berlaku ${hari} hari.`;
  const html =
    `<p>${esc(sapa)}</p><p><b>${esc(affiliate.name)}</b> mengundang kamu bergabung dan belanja di <b>${esc(toko)}</b>.</p>` +
    (pesan ? `<blockquote style="margin:12px 0;padding:8px 12px;border-left:3px solid #5A41E5;color:#333">${esc(pesan)}</blockquote>` : '') +
    `<p><a href="${esc(tautan)}" style="display:inline-block;background:#5A41E5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Terima undangan</a></p>` +
    `<p style="color:#666;font-size:12px">Tautan ini berlaku ${esc(hari)} hari. Bila tombol tidak bisa ditekan, buka: ${esc(tautan)}</p>`;
  return { subject, text, html };
}

/** Teks tarif komisi untuk email: "15% dari nilai barang" atau "Rp 5.000 per barang". */
export function teksTarif(tarif) {
  const t = Array.isArray(tarif) ? tarif[0] : null;
  if (!t) return null;
  return t.type === 'fixed' ? `${rupiah(t.value)} per barang` : `${new Intl.NumberFormat('id-ID').format(Number(t.value))}% dari nilai barang`;
}

/** Undangan khusus dari admin (D-32): penerima yang mendaftar langsung menjadi affiliate. */
export function emailUndanganAdmin({ toko, nama, pesan, tautan, hari, tarif }) {
  const sapa = nama ? `Halo ${nama},` : 'Halo,';
  const subject = satuBaris(`${toko} mengundang kamu menjadi affiliate`);
  const komisi = teksTarif(tarif);
  const text =
    `${sapa}\n\n${toko} mengundang kamu menjadi affiliate. Bagikan link produk ${toko} dan dapatkan komisi dari setiap pembelian lewat link kamu.\n` +
    (komisi ? `\nKomisi kamu: ${komisi}.\n` : '') +
    (pesan ? `\nPesan dari ${toko}: "${pesan}"\n` : '') +
    `\nDaftar sebagai affiliate: ${tautan}\nTautan ini berlaku ${hari} hari. Daftar dengan alamat email ini supaya akses affiliate langsung aktif.`;
  const html =
    `<p>${esc(sapa)}</p><p><b>${esc(toko)}</b> mengundang kamu menjadi affiliate. Bagikan link produk dan dapatkan komisi dari setiap pembelian lewat link kamu.</p>` +
    (komisi ? `<p>Komisi kamu: <b>${esc(komisi)}</b>.</p>` : '') +
    (pesan ? `<blockquote style="margin:12px 0;padding:8px 12px;border-left:3px solid #5A41E5;color:#333">${esc(pesan)}</blockquote>` : '') +
    `<p><a href="${esc(tautan)}" style="display:inline-block;background:#5A41E5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Daftar sebagai affiliate</a></p>` +
    `<p style="color:#666;font-size:12px">Tautan ini berlaku ${esc(hari)} hari. Daftar dengan alamat email ini supaya akses affiliate langsung aktif. Bila tombol tidak bisa ditekan, buka: ${esc(tautan)}</p>`;
  return { subject, text, html };
}

async function namaToko(pool, storeId) {
  const r = await pool.query('select name from public.stores where id = $1', [storeId]);
  return r.rows[0]?.name || 'GNNK Racing';
}

async function affiliatePenerima(pool, storeId, customerId) {
  const r = await pool.query(
    `select c.id, c.name, coalesce(nullif(c.email, ''), u.email) as email
       from public.customers c left join public.app_users u on u.id = c.user_id
      where c.id = $1 and c.store_id = $2`,
    [customerId, storeId],
  );
  return r.rows[0] ?? null;
}

async function ringkasOrder(pool, orderId) {
  const r = await pool.query(
    `select o.id, o.store_id, o.order_number, o.affiliate_id, (o.subtotal - o.discount)::float8 as items_value,
            coalesce(nullif(o.customer_name, ''), c.name, 'Pembeli') as buyer_name,
            array(select i.name from public.order_items i where i.order_id = o.id order by i.name) as produk
       from public.orders o left join public.customers c on c.id = o.customer_id
      where o.id = $1`,
    [orderId],
  );
  return r.rows[0] ?? null;
}

/**
 * Isi satu kelompok antrean: penerima dan email, atau alasan dilewati.
 * Kelompok `komisi_masuk` = semua komisi satu affiliate dari satu order, supaya
 * pesanan berisi tiga barang menghasilkan satu email, bukan tiga.
 */
async function susunKelompok(pool, k, pengaturan, asalToko) {
  const tautanKomisi = `${asalToko}/toko/affiliate?tab=komisi`;
  if (k.kind === 'pesanan_baru') {
    if (!pengaturan.email_new_order) return { lewati: 'email order baru dimatikan' };
    const order = await ringkasOrder(pool, k.refId);
    if (!order?.affiliate_id) return { lewati: 'order tanpa affiliate' };
    const affiliate = await affiliatePenerima(pool, k.storeId, order.affiliate_id);
    if (!affiliate) return { lewati: 'affiliate tidak ditemukan' };
    const komisi = await pool.query(
      `select coalesce(sum(commission), 0)::float8 as n from public.affiliate_commissions
        where order_id = $1 and affiliate_id = $2 and status <> 'cancelled'`,
      [order.id, order.affiliate_id],
    );
    const toko = await namaToko(pool, k.storeId);
    return { to: affiliate.email, ...emailPesananBaru({ toko, affiliate, order, produk: order.produk, komisi: komisi.rows[0].n, tautan: `${asalToko}/toko/affiliate?tab=order` }) };
  }
  if (k.kind === 'komisi_masuk') {
    if (!pengaturan.email_commission) return { lewati: 'email komisi dimatikan' };
    const r = await pool.query(
      `select k.order_id, k.affiliate_id, coalesce(sum(k.commission) filter (where k.status = 'added'), 0)::float8 as komisi,
              array_agg(distinct i.name) filter (where k.status = 'added') as produk
         from public.affiliate_commissions k left join public.order_items i on i.id = k.order_item_id
        where k.id = any($1::uuid[])
        group by k.order_id, k.affiliate_id`,
      [k.refIds],
    );
    const g = r.rows[0];
    if (!g || g.komisi <= 0) return { lewati: 'komisi tidak lagi berstatus masuk' };
    const order = await ringkasOrder(pool, g.order_id);
    const affiliate = await affiliatePenerima(pool, k.storeId, g.affiliate_id);
    if (!order || !affiliate) return { lewati: 'order atau affiliate tidak ditemukan' };
    const toko = await namaToko(pool, k.storeId);
    return { to: affiliate.email, ...emailKomisiMasuk({ toko, affiliate, order, produk: g.produk, komisi: g.komisi, tautan: tautanKomisi }) };
  }
  if (k.kind === 'komisi_dibayar') {
    if (!pengaturan.email_paid) return { lewati: 'email pembayaran dimatikan' };
    const r = await pool.query(
      `select id, affiliate_id, amount::float8 as amount, commission_count, paid_at, note,
              commission_total::float8 as commission_total, bonus_total::float8 as bonus_total, deduction_total::float8 as deduction_total
         from public.affiliate_payouts where id = $1`,
      [k.refId],
    );
    const payout = r.rows[0];
    if (!payout) return { lewati: 'pembayaran sudah dibatalkan' };
    const affiliate = await affiliatePenerima(pool, k.storeId, payout.affiliate_id);
    if (!affiliate) return { lewati: 'affiliate tidak ditemukan' };
    const toko = await namaToko(pool, k.storeId);
    return { to: affiliate.email, ...emailKomisiDibayar({ toko, affiliate, payout, tautan: tautanKomisi }) };
  }
  return { lewati: `jenis antrean tidak dikenal: ${k.kind}` };
}

/**
 * Satu putaran pekerja. Baris diklaim dengan menggeser next_attempt_at 10 menit
 * (FOR UPDATE SKIP LOCKED), sehingga dua proses yang berjalan bersamaan tidak
 * mengirim email yang sama dua kali.
 */
export async function prosesOutbox({ pool, kirimEmail, alamatUji, asalToko, batas = 50 }) {
  const hasil = { sent: 0, skipped: 0, failed: 0, retry: 0 };
  const klaim = await pool.query(
    `update public.affiliate_outbox set next_attempt_at = now() + interval '10 minutes'
      where id in (
        select id from public.affiliate_outbox
         where status = 'pending' and next_attempt_at <= now()
         order by id limit $1
         for update skip locked)
      returning id, store_id, kind, ref_id, attempts`,
    [batas],
  );
  if (!klaim.rowCount) return hasil;

  const komisiMasuk = klaim.rows.filter((x) => x.kind === 'komisi_masuk');
  const pemilik = new Map();
  if (komisiMasuk.length) {
    const r = await pool.query(
      'select id, order_id, affiliate_id from public.affiliate_commissions where id = any($1::uuid[])',
      [komisiMasuk.map((x) => x.ref_id)],
    );
    for (const x of r.rows) pemilik.set(x.id, `${x.affiliate_id}:${x.order_id}`);
  }
  const kelompok = new Map();
  for (const x of klaim.rows) {
    const kunci = x.kind === 'komisi_masuk' ? `komisi_masuk:${pemilik.get(x.ref_id) ?? x.ref_id}` : `${x.kind}:${x.ref_id}`;
    if (!kelompok.has(kunci)) kelompok.set(kunci, { kind: x.kind, storeId: x.store_id, refId: x.ref_id, refIds: [], ids: [], attempts: 0 });
    const k = kelompok.get(kunci);
    k.ids.push(x.id);
    k.refIds.push(x.ref_id);
    k.attempts = Math.max(k.attempts, x.attempts);
  }

  const pengaturanToko = new Map();
  for (const k of kelompok.values()) {
    if (!pengaturanToko.has(k.storeId)) {
      const r = await pool.query('select affiliate_settings from public.stores where id = $1', [k.storeId]);
      pengaturanToko.set(k.storeId, gabungPengaturan(r.rows[0]?.affiliate_settings));
    }
    const pengaturan = pengaturanToko.get(k.storeId);
    let email;
    try {
      email = await susunKelompok(pool, k, pengaturan, asalToko);
      if (!email.lewati && (!email.to || alamatUji(email.to))) email = { lewati: email.to ? 'alamat uji' : 'penerima tanpa email' };
    } catch (error) {
      email = { galat: error };
    }
    if (email.lewati) {
      await pool.query(
        `update public.affiliate_outbox set status = 'skipped', last_error = $2 where id = any($1::bigint[])`,
        [k.ids, email.lewati],
      );
      hasil.skipped += 1;
      continue;
    }
    try {
      if (email.galat) throw email.galat;
      await kirimEmail({ to: email.to, subject: email.subject, text: email.text, html: email.html });
      await pool.query(
        `update public.affiliate_outbox set status = 'sent', sent_at = now(), attempts = attempts + 1, last_error = null
          where id = any($1::bigint[])`,
        [k.ids],
      );
      hasil.sent += 1;
      const salinan = String(pengaturan.admin_copy_emails ?? '').split(',').map((s) => s.trim()).filter((s) => s && !alamatUji(s));
      for (const alamat of salinan) {
        try {
          await kirimEmail({ to: alamat, subject: `[Salinan] ${email.subject}`, text: email.text, html: email.html });
        } catch (error) {
          console.error('[affiliate] salinan email admin gagal:', error.message);
        }
      }
    } catch (error) {
      const ke = k.attempts + 1;
      const habis = ke >= MAKS_PERCOBAAN;
      await pool.query(
        `update public.affiliate_outbox
            set attempts = $2, last_error = $3, status = $4,
                next_attempt_at = now() + make_interval(mins => $5)
          where id = any($1::bigint[])`,
        [k.ids, ke, String(error?.message ?? error).slice(0, 300), habis ? 'failed' : 'pending', JEDA_MENIT * ke],
      );
      if (habis) hasil.failed += 1;
      else hasil.retry += 1;
    }
  }
  return hasil;
}
