// Endpoint program affiliate (spesifikasi docs/specs/0001-program-affiliate).
// Didaftarkan dari server/index.js lewat pasangRuteAffiliate(app, deps), sebelum
// fallback SPA dan errorMiddleware.
import crypto from 'node:crypto';
import {
  NAMA_COOKIE,
  aksesBerhak,
  daftarPlatform,
  memuatTautan,
  normalisasiPengaturan,
  perbaruiCookie,
  rapikanAkuisisi,
  rincianBayar,
  sidikToken,
  tandatangani,
  tarifBarang,
  tokenBaru,
  umurCookieDetik,
  validasiTarif,
} from './inti.js';
import {
  ZONA,
  akuisisiAffiliate,
  ambilMember,
  cariAffiliateDariKode,
  cookieSah,
  grafikAffiliate,
  memberDariUser,
  muatPengaturan,
  OMSET,
  pastikanKode,
  RETUR_PESANAN,
  ringkasanAffiliate,
  segarkanBonus,
  sqlKunciKelompok,
  sudahMembeli,
  targetAffiliate,
} from './layanan.js';
import { emailUndangan, emailUndanganAdmin } from './pekerja.js';

const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POLA_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PESAN = {
  kodeTidakAda: 'Affiliasi tidak terdaftar di database',
  produkTidakAda: 'Produk tidak terdaftar di database',
  produkMati: 'Produk ini sudah tidak diaffiliasikan lagi',
  tidakBoleh: 'Link affiliasi ini tidak diperkenankan. Silahkan hubungi pemilik link affiliasi ini',
  undanganTidakAda: 'Undangan tidak ditemukan. Minta pengundang mengirim ulang.',
  undanganLewat: 'Undangan ini sudah kedaluwarsa. Minta pengundang mengirim ulang.',
};

/** Pembatas laju sederhana per kunci (IP atau affiliate), jendela satu menit. */
function pembatas(maks, jendelaMs = 60_000) {
  const peta = new Map();
  return (kunci) => {
    const kini = Date.now();
    const e = peta.get(kunci);
    if (!e || kini - e.mulai > jendelaMs) {
      peta.set(kunci, { n: 1, mulai: kini });
      if (peta.size > 5000) for (const [k, v] of peta) if (kini - v.mulai > jendelaMs) peta.delete(k);
      return true;
    }
    e.n += 1;
    return e.n <= maks;
  };
}

function rentang(q) {
  const tgl = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : null);
  return { from: tgl(q.from), to: tgl(q.to) };
}

/** Potongan SQL rentang tanggal WIB untuk kolom `kolom`, mulai di parameter $n. */
function sqlRentang(kolom, r, params) {
  const bagian = [];
  if (r.from) {
    params.push(r.from);
    bagian.push(`(${kolom} at time zone '${ZONA}')::date >= $${params.length}::date`);
  }
  if (r.to) {
    params.push(r.to);
    bagian.push(`(${kolom} at time zone '${ZONA}')::date <= $${params.length}::date`);
  }
  return bagian.length ? ` and ${bagian.join(' and ')}` : '';
}

const angka = (v) => Number(v ?? 0);

export function pasangRuteAffiliate(app, deps) {
  const {
    pool,
    asyncHandler,
    galat,
    requireUser,
    requireRoles,
    requireCustomer,
    writeAdminAudit,
    kirimEmail,
    alamatUji,
    verifyToken,
    rahasia,
    clientIp,
    idAktor,
    asalToko,
  } = deps;
  const batasBuka = pembatas(60);
  const batasUndang = pembatas(10);

  function pasangCookie(req, res, data, hari) {
    const aman = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https' || req.secure;
    res.cookie(NAMA_COOKIE, tandatangani(data, rahasia), {
      maxAge: umurCookieDetik(hari) * 1000,
      httpOnly: true,
      sameSite: 'lax',
      secure: aman,
      path: '/',
    });
  }

  function sidikPengunjung(req) {
    const hari = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
    return crypto.createHash('sha256').update(`${clientIp(req)}|${req.headers['user-agent'] ?? ''}|${hari}`).digest('hex').slice(0, 32);
  }

  async function idPembeliDariToken(req, storeId) {
    const auth = String(req.headers.authorization ?? '');
    if (!auth.toLowerCase().startsWith('bearer ')) return null;
    try {
      const payload = verifyToken(auth.slice(7).trim());
      const m = await memberDariUser(pool, storeId, payload.sub);
      return m?.id ?? null;
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Publik: membuka link dan undangan

  app.post('/api/public/affiliate/click', asyncHandler(async (req, res) => {
    if (!batasBuka(clientIp(req))) throw galat(429, 'Terlalu banyak permintaan, coba lagi sebentar.');
    const storeId = String(req.body?.store_id ?? '').trim();
    const kode = String(req.body?.code ?? '').trim();
    const productId = req.body?.product_id ? String(req.body.product_id) : null;
    if (!POLA_UUID.test(storeId)) throw galat(400, 'store_id tidak valid.');
    const pengaturan = await muatPengaturan(pool, storeId);
    // Link /aff/KODE/{id produk} tetap memakai id; pengunjung diantar ke alamat
    // slug produk itu dengan varian yang sama (permintaan 20).
    let tujuanProduk = '/toko';
    if (productId && POLA_UUID.test(productId)) {
      const p = (await pool.query('select slug, sku from public.products where id = $1 and store_id = $2', [productId, storeId])).rows[0];
      tujuanProduk = p?.slug
        ? `/toko/produk/${encodeURIComponent(p.slug)}?varian=${encodeURIComponent(p.sku || productId)}`
        : `/toko/produk?id=${productId}`;
    }
    if (!pengaturan.enabled) {
      res.json({ data: { redirect: tujuanProduk } });
      return;
    }
    const aff = await cariAffiliateDariKode(pool, storeId, kode);
    if (!aff) throw galat(404, PESAN.kodeTidakAda);
    if (!aksesBerhak(pengaturan, aff.affiliate_access)) throw galat(403, PESAN.tidakBoleh);
    if (productId) {
      if (!POLA_UUID.test(productId)) throw galat(404, PESAN.produkTidakAda);
      const p = await pool.query(
        'select id, is_active, affiliate_enabled, affiliate_if_bought from public.products where id = $1 and store_id = $2',
        [productId, storeId],
      );
      const produk = p.rows[0];
      if (!produk || !produk.is_active) throw galat(404, PESAN.produkTidakAda);
      if (!produk.affiliate_enabled) throw galat(403, PESAN.produkMati);
      if (produk.affiliate_if_bought && !(await sudahMembeli(pool, storeId, aff.id, productId))) throw galat(403, PESAN.tidakBoleh);
    }
    const { source, media } = rapikanAkuisisi(req.body?.utm_source, req.body?.utm_media);
    const lama = cookieSah(req.headers.cookie, rahasia, pengaturan);
    pasangCookie(req, res, perbaruiCookie(lama, { affiliateId: aff.id, productId, source, media, kind: 'link' }), pengaturan.cookie_days);
    const pembeliId = await idPembeliDariToken(req, storeId);
    if (pembeliId !== aff.id) {
      await pool.query(
        `insert into public.affiliate_clicks (store_id, affiliate_id, product_id, kind, source, media, visitor_hash)
         values ($1, $2, $3, 'link', $4, $5, $6)`,
        [storeId, aff.id, productId, source, media, sidikPengunjung(req)],
      );
    }
    res.json({ data: { redirect: tujuanProduk } });
  }));

  app.post('/api/public/affiliate/invitation', asyncHandler(async (req, res) => {
    if (!batasBuka(clientIp(req))) throw galat(429, 'Terlalu banyak permintaan, coba lagi sebentar.');
    const storeId = String(req.body?.store_id ?? '').trim();
    const token = String(req.body?.token ?? '').trim();
    if (!POLA_UUID.test(storeId)) throw galat(400, 'store_id tidak valid.');
    if (!token || token.length > 200) throw galat(404, PESAN.undanganTidakAda);
    const r = await pool.query(
      `select id, affiliate_id, email, status, expires_at, dari_admin from public.affiliate_invitations
        where store_id = $1 and token_hash = $2`,
      [storeId, sidikToken(token)],
    );
    const u = r.rows[0];
    if (!u) throw galat(404, PESAN.undanganTidakAda);
    const daftar = `/toko/masuk?tab=daftar&email=${encodeURIComponent(u.email)}`;
    if (u.status === 'registered') {
      res.json({ data: { redirect: '/toko/masuk' } });
      return;
    }
    if (new Date(u.expires_at).getTime() < Date.now()) throw galat(410, PESAN.undanganLewat);
    // Undangan khusus admin (D-32): tanpa affiliate pengirim, jadi tanpa cookie dan
    // tanpa klik. Pendaftar dikenali dari email yang sudah terisi di formulir.
    if (u.dari_admin) {
      await pool.query(
        `update public.affiliate_invitations
            set opened_at = coalesce(opened_at, now()), status = case when status = 'sent' then 'opened' else status end
          where id = $1`,
        [u.id],
      );
      res.json({ data: { redirect: daftar } });
      return;
    }
    const pengaturan = await muatPengaturan(pool, storeId);
    if (!pengaturan.enabled) {
      res.json({ data: { redirect: daftar } });
      return;
    }
    const aff = await ambilMember(pool, storeId, u.affiliate_id);
    if (!aff || !aksesBerhak(pengaturan, aff.affiliate_access)) throw galat(403, PESAN.tidakBoleh);
    const lama = cookieSah(req.headers.cookie, rahasia, pengaturan);
    pasangCookie(req, res, perbaruiCookie(lama, { affiliateId: aff.id, kind: 'undangan', invitationId: u.id }), pengaturan.cookie_days);
    await pool.query(
      `update public.affiliate_invitations
          set opened_at = coalesce(opened_at, now()), status = case when status = 'sent' then 'opened' else status end
        where id = $1`,
      [u.id],
    );
    await pool.query(
      `insert into public.affiliate_clicks (store_id, affiliate_id, kind, visitor_hash) values ($1, $2, 'undangan', $3)`,
      [storeId, aff.id, sidikPengunjung(req)],
    );
    res.json({ data: { redirect: daftar } });
  }));

  // -------------------------------------------------------------------------
  // Pembeli (affiliate)

  async function affiliateBerhak(req) {
    const member = await memberDariUser(pool, req.user.store_id, req.user.id);
    if (!member) throw galat(403, 'Halaman ini khusus akun pembeli.');
    const pengaturan = await muatPengaturan(pool, req.user.store_id);
    if (!aksesBerhak(pengaturan, member.affiliate_access)) throw galat(403, pengaturan.no_access_text);
    return { member, pengaturan, storeId: req.user.store_id };
  }

  app.get('/api/customer/affiliate', requireCustomer, asyncHandler(async (req, res) => {
    const storeId = req.user.store_id;
    const member = await memberDariUser(pool, storeId, req.user.id);
    if (!member) throw galat(403, 'Halaman ini khusus akun pembeli.');
    const pengaturan = await muatPengaturan(pool, storeId);
    if (!aksesBerhak(pengaturan, member.affiliate_access)) {
      const reason = !pengaturan.enabled ? 'program_off' : member.affiliate_access === 'blocked' ? 'blocked' : 'no_access';
      res.json({ data: { eligible: false, reason, message: pengaturan.no_access_text } });
      return;
    }
    const code = await pastikanKode(pool, storeId, member);
    const upline = member.referred_by ? await ambilMember(pool, storeId, member.referred_by) : null;
    await segarkanBonus(pool, storeId);
    res.json({
      data: {
        eligible: true,
        profile: {
          code,
          name: member.name,
          bank_info: member.bank_info ?? null,
          upline_name: upline?.name ?? null,
          // Tarif yang berlaku untuk produk tanpa komisi khusus (D-31).
          commission: tarifBarang(null, member.affiliate_commission, pengaturan),
        },
        settings: {
          cookie_days: pengaturan.cookie_days,
          platforms: daftarPlatform(pengaturan.platforms),
          invite_days: pengaturan.invite_days,
          invite_daily_limit: pengaturan.invite_daily_limit,
          downline_depth: pengaturan.downline_depth,
          payout_minimum: pengaturan.payout_minimum,
        },
        summary: await ringkasanAffiliate(pool, storeId, member.id),
        target: await targetAffiliate(pool, storeId, member.id, pengaturan),
      },
    });
  }));

  app.get('/api/customer/affiliate/charts', requireCustomer, asyncHandler(async (req, res) => {
    const { member, storeId } = await affiliateBerhak(req);
    res.json({ data: await grafikAffiliate(pool, storeId, member.id) });
  }));

  app.get('/api/customer/affiliate/acquisition', requireCustomer, asyncHandler(async (req, res) => {
    const { member, storeId, pengaturan } = await affiliateBerhak(req);
    res.json({ data: await akuisisiAffiliate(pool, storeId, member.id, daftarPlatform(pengaturan.platforms)) });
  }));

  app.get('/api/customer/affiliate/products', requireCustomer, asyncHandler(async (req, res) => {
    const { member, storeId } = await affiliateBerhak(req);
    // ?id= dipakai tombol "Bagikan & dapat komisi" di halaman satu produk.
    const satu = POLA_UUID.test(String(req.query.id ?? '')) ? String(req.query.id) : null;
    const r = await pool.query(
      `select p.id, p.name, p.variant_label, p.sku, p.base_price::float8 as price,
              (not p.affiliate_if_bought or exists (
                 select 1 from public.order_items i
                   join public.orders o on o.id = i.order_id
                   join public.products dibeli on dibeli.id = i.product_id
                  where o.store_id = $1 and o.customer_id = $2 and o.order_status = 'done'
                    and ${sqlKunciKelompok('dibeli')} = ${sqlKunciKelompok('p')}
              )) as eligible
         from public.products p
        where p.store_id = $1 and p.is_active and p.affiliate_enabled and ($3::uuid is null or p.id = $3::uuid)
        order by p.name, p.variant_label nulls first
        limit 3000`,
      [storeId, member.id, satu],
    );
    res.json({ data: r.rows });
  }));

  app.get('/api/customer/affiliate/orders', requireCustomer, asyncHandler(async (req, res) => {
    const { member, storeId } = await affiliateBerhak(req);
    const params = [storeId, member.id];
    const tanggal = sqlRentang('o.created_at', rentang(req.query), params);
    const r = await pool.query(
      `select o.order_number, o.created_at, coalesce(nullif(o.customer_name, ''), c.name, 'Pembeli') as buyer_name,
              (o.subtotal - o.discount)::float8 as items_value, o.order_status,
              coalesce((select sum(r.refund_amount) from public.order_returns r where r.order_id = o.id), 0)::float8 as returned_value,
              coalesce((select sum(k.commission) from public.affiliate_commissions k where k.order_id = o.id and k.affiliate_id = $2), 0)::float8 as commission
         from public.orders o
         left join public.customers c on c.id = o.customer_id
        where o.store_id = $1 and o.affiliate_id = $2${tanggal}
        order by o.created_at desc
        limit 200`,
      params,
    );
    const status = (s) => (s === 'done' ? 'selesai' : s === 'canceled' ? 'dibatalkan' : 'menunggu');
    res.json({
      data: r.rows.map((o) => ({
        order_number: o.order_number,
        created_at: o.created_at,
        buyer_name: o.buyer_name,
        items_value: o.items_value,
        returned_value: o.returned_value,
        status: status(o.order_status),
        commission: o.commission,
      })),
    });
  }));

  app.get('/api/customer/affiliate/commissions', requireCustomer, asyncHandler(async (req, res) => {
    const { member, storeId } = await affiliateBerhak(req);
    // Rentang tanggal hanya menyaring daftar. Total tetap menghitung semua komisi.
    const params = [storeId, member.id];
    const tanggal = sqlRentang('k.created_at', rentang(req.query), params);
    await segarkanBonus(pool, storeId);
    const [total, baris, bonus, potongan] = await Promise.all([
      pool.query(
        `select coalesce(sum(commission) filter (where status = 'pending'), 0)::float8 as pending,
                coalesce(sum(commission) filter (where status = 'added' and not paid), 0)::float8 as unpaid,
                -- Uang yang benar-benar ditransfer: komisi + bonus - potongan (D-40).
                (select coalesce(sum(amount), 0) from public.affiliate_payouts
                  where store_id = $1 and affiliate_id = $2)::float8 as paid,
                (select coalesce(sum(amount), 0) from public.affiliate_potongan
                  where store_id = $1 and affiliate_id = $2 and payout_id is null)::float8 as deductions,
                (select coalesce(sum(amount), 0) from public.affiliate_bonuses
                  where store_id = $1 and affiliate_id = $2 and status = 'added' and not paid)::float8 as bonus_unpaid,
                (select coalesce(sum(amount), 0) from public.affiliate_bonuses
                  where store_id = $1 and affiliate_id = $2 and status = 'berjalan')::float8 as bonus_running
           from public.affiliate_commissions where store_id = $1 and affiliate_id = $2`,
        [storeId, member.id],
      ),
      pool.query(
        `select k.id, k.created_at, o.order_number, coalesce(i.name, 'Produk') as product_name, k.tier,
                k.commission::float8 as commission, coalesce(k.commission_awal, k.commission)::float8 as commission_original,
                k.status, k.paid, k.paid_at
           from public.affiliate_commissions k
           join public.orders o on o.id = k.order_id
           left join public.order_items i on i.id = k.order_item_id
          where k.store_id = $1 and k.affiliate_id = $2${tanggal}
          order by k.created_at desc, k.tier
          limit 500`,
        params,
      ),
      pool.query(
        `select id, to_char(bulan, 'YYYY-MM-DD') as month, omset::float8 as omset, target::float8 as target, amount::float8 as amount,
                status, paid, paid_at
           from public.affiliate_bonuses where store_id = $1 and affiliate_id = $2
          order by bulan desc limit 24`,
        [storeId, member.id],
      ),
      pool.query(
        `select p.id, p.jenis as kind, p.amount::float8 as amount, p.created_at, (p.payout_id is not null) as settled, o.order_number
           from public.affiliate_potongan p
           join public.affiliate_commissions k on k.id = p.commission_id
           join public.orders o on o.id = k.order_id
          where p.store_id = $1 and p.affiliate_id = $2
          order by p.created_at desc limit 100`,
        [storeId, member.id],
      ),
    ]);
    res.json({ data: { totals: total.rows[0], rows: baris.rows, bonuses: bonus.rows, deductions: potongan.rows } });
  }));

  app.get('/api/customer/affiliate/network', requireCustomer, asyncHandler(async (req, res) => {
    const { member, storeId, pengaturan } = await affiliateBerhak(req);
    const upline = member.referred_by ? await ambilMember(pool, storeId, member.referred_by) : null;
    const r = await pool.query(
      `with recursive t as (
         select id, referred_by, name, coalesce(referred_at, created_at) as joined_at, email, phone, 1 as depth, array[id] as jalur
           from public.customers where store_id = $1 and referred_by = $2
         union all
         select c.id, c.referred_by, c.name, coalesce(c.referred_at, c.created_at), c.email, c.phone, t.depth + 1, t.jalur || c.id
           from public.customers c join t on c.referred_by = t.id
          where c.store_id = $1 and t.depth < $3 and not c.id = any(t.jalur)
       )
       select t.id, t.referred_by, t.name, t.joined_at, t.email, t.phone, t.depth,
              (select count(*) from public.customers d where d.store_id = $1 and d.referred_by = t.id)::int as downline_count
         from t order by t.jalur
         limit 1000`,
      [storeId, member.id, pengaturan.downline_depth],
    );
    res.json({
      data: {
        upline_name: upline?.name ?? null,
        nodes: r.rows.map((n) => ({
          id: n.id,
          parent_id: n.depth === 1 ? null : n.referred_by,
          name: n.name,
          joined_at: n.joined_at,
          downline_count: n.downline_count,
          depth: n.depth,
        })),
      },
    });
  }));

  // Undangan email ----------------------------------------------------------

  async function hitungKirimHariIni(storeId, affiliateId, db = pool) {
    const r = await db.query(
      `select count(*)::int as n from public.affiliate_invitations
        where store_id = $1 and affiliate_id = $2 and (sent_at at time zone '${ZONA}')::date = (now() at time zone '${ZONA}')::date`,
      [storeId, affiliateId],
    );
    return r.rows[0].n;
  }

  /**
   * Menjalankan `kerja` di dalam transaksi yang memegang kunci per affiliate.
   * Cek undangan ganda dan batas harian dibaca dulu lalu ditulis. Tanpa kunci,
   * dua permintaan bersamaan sama-sama lolos cek dan penerima mendapat dua email.
   */
  async function denganKunciUndangan(affiliateId, kerja) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [`affiliate-undang:${affiliateId}`]);
      const hasil = await kerja(client);
      await client.query('commit');
      return hasil;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  function barisUndangan(u) {
    const lewat = u.status !== 'registered' && new Date(u.expires_at).getTime() < Date.now();
    const status = lewat ? 'expired' : u.status;
    const sehari = Date.now() - new Date(u.sent_at).getTime() > 24 * 3600_000;
    return {
      id: u.id,
      email: u.email,
      name: u.name ?? null,
      status,
      sent_at: u.sent_at,
      opened_at: u.opened_at ?? null,
      expires_at: u.expires_at,
      can_resend: u.status !== 'registered' && (u.status === 'failed' || sehari),
    };
  }

  async function kirimEmailUndangan({ storeId, affiliate, email, nama, pesan, token, hari }) {
    if (alamatUji(email)) return;
    const toko = (await pool.query('select name from public.stores where id = $1', [storeId])).rows[0]?.name || 'GNNK Racing';
    // Alamat toko dari konfigurasi server, bukan dari header Origin atau Host permintaan.
    const tautan = `${asalToko}/aff/undangan/${token}`;
    await kirimEmail({ to: email, ...emailUndangan({ toko, affiliate, nama, pesan, tautan, hari }) });
  }

  app.get('/api/customer/affiliate/invitations', requireCustomer, asyncHandler(async (req, res) => {
    const { member, storeId, pengaturan } = await affiliateBerhak(req);
    const r = await pool.query(
      `select id, email, name, status, sent_at, opened_at, expires_at from public.affiliate_invitations
        where store_id = $1 and affiliate_id = $2 order by sent_at desc limit 100`,
      [storeId, member.id],
    );
    res.json({ data: { rows: r.rows.map(barisUndangan), sent_today: await hitungKirimHariIni(storeId, member.id), daily_limit: pengaturan.invite_daily_limit } });
  }));

  app.post('/api/customer/affiliate/invitations', requireCustomer, asyncHandler(async (req, res) => {
    const { member, storeId, pengaturan } = await affiliateBerhak(req);
    if (!batasUndang(member.id)) throw galat(429, 'Terlalu banyak undangan dalam semenit. Tunggu sebentar.');
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const nama = String(req.body?.name ?? '').trim().slice(0, 80) || null;
    const pesan = String(req.body?.message ?? '').trim().slice(0, 300) || null;
    if (!POLA_EMAIL.test(email) || email.length > 200) throw galat(400, 'Email tidak valid.');
    if (memuatTautan(nama) || memuatTautan(pesan)) throw galat(400, 'Nama dan pesan undangan tidak boleh memuat tautan.');
    const token = tokenBaru();
    const baris = await denganKunciUndangan(member.id, async (db) => {
      const anggota = await db.query(
        'select 1 from public.customers where store_id = $1 and lower(email) = $2 and user_id is not null limit 1',
        [storeId, email],
      );
      if (anggota.rowCount) throw galat(409, 'Email ini sudah terdaftar sebagai member.');
      const ganda = await db.query(
        `select 1 from public.affiliate_invitations
          where store_id = $1 and affiliate_id = $2 and lower(email) = $3 and sent_at > now() - interval '24 hours' limit 1`,
        [storeId, member.id, email],
      );
      if (ganda.rowCount) throw galat(409, 'Email ini sudah kamu undang dalam 24 jam terakhir.');
      if (pengaturan.invite_daily_limit > 0 && (await hitungKirimHariIni(storeId, member.id, db)) >= pengaturan.invite_daily_limit) {
        throw galat(429, `Batas undangan hari ini sudah tercapai (${pengaturan.invite_daily_limit} undangan). Coba lagi besok.`);
      }
      const ins = await db.query(
        `insert into public.affiliate_invitations (store_id, affiliate_id, email, name, message, token_hash, expires_at)
         values ($1, $2, $3, $4, $5, $6, now() + make_interval(days => $7))
         returning id, email, name, status, sent_at, opened_at, expires_at`,
        [storeId, member.id, email, nama, pesan, sidikToken(token), pengaturan.invite_days],
      );
      return ins.rows[0];
    });
    // Email dikirim setelah transaksi selesai, supaya kunci tidak ditahan selama memanggil layanan email.
    try {
      await kirimEmailUndangan({ storeId, affiliate: member, email, nama, pesan, token, hari: pengaturan.invite_days });
    } catch (error) {
      await pool.query(`update public.affiliate_invitations set status = 'failed', last_error = $2 where id = $1`, [baris.id, String(error.message).slice(0, 300)]);
      throw galat(502, 'Undangan gagal dikirim. Coba kirim ulang beberapa saat lagi.');
    }
    res.json({ data: barisUndangan(baris) });
  }));

  app.post('/api/customer/affiliate/invitations/:id/resend', requireCustomer, asyncHandler(async (req, res) => {
    const { member, storeId, pengaturan } = await affiliateBerhak(req);
    const id = String(req.params.id);
    if (!POLA_UUID.test(id)) throw galat(404, 'Undangan tidak ditemukan.');
    const token = tokenBaru();
    const { u, baru } = await denganKunciUndangan(member.id, async (db) => {
      const r = await db.query(
        `select id, email, name, message, status, sent_at, expires_at from public.affiliate_invitations
          where id = $1 and store_id = $2 and affiliate_id = $3
          for update`,
        [id, storeId, member.id],
      );
      const lama = r.rows[0];
      if (!lama) throw galat(404, 'Undangan tidak ditemukan.');
      if (lama.status === 'registered') throw galat(409, 'Penerima sudah mendaftar.');
      // Penerima bisa saja sudah mendaftar lewat jalan lain sejak undangan dikirim.
      const anggota = await db.query(
        'select 1 from public.customers where store_id = $1 and lower(email) = lower($2) and user_id is not null limit 1',
        [storeId, lama.email],
      );
      if (anggota.rowCount) throw galat(409, 'Email ini sudah terdaftar sebagai member.');
      if (lama.status !== 'failed' && Date.now() - new Date(lama.sent_at).getTime() < 24 * 3600_000) {
        throw galat(409, 'Undangan baru bisa dikirim ulang 24 jam setelah pengiriman terakhir.');
      }
      if (pengaturan.invite_daily_limit > 0 && (await hitungKirimHariIni(storeId, member.id, db)) >= pengaturan.invite_daily_limit) {
        throw galat(429, `Batas undangan hari ini sudah tercapai (${pengaturan.invite_daily_limit} undangan). Coba lagi besok.`);
      }
      const up = await db.query(
        `update public.affiliate_invitations
            set token_hash = $2, sent_at = now(), expires_at = now() + make_interval(days => $3),
                status = 'sent', resend_count = resend_count + 1, last_error = null
          where id = $1
          returning id, email, name, status, sent_at, opened_at, expires_at`,
        [id, sidikToken(token), pengaturan.invite_days],
      );
      return { u: lama, baru: up.rows[0] };
    });
    try {
      await kirimEmailUndangan({ storeId, affiliate: member, email: u.email, nama: u.name, pesan: u.message, token, hari: pengaturan.invite_days });
    } catch (error) {
      await pool.query(`update public.affiliate_invitations set status = 'failed', last_error = $2 where id = $1`, [id, String(error.message).slice(0, 300)]);
      throw galat(502, 'Undangan gagal dikirim. Coba kirim ulang beberapa saat lagi.');
    }
    res.json({ data: barisUndangan(baru) });
  }));

  app.patch('/api/customer/affiliate/bank', requireCustomer, asyncHandler(async (req, res) => {
    const { member, storeId } = await affiliateBerhak(req);
    const isi = String(req.body?.bank_info ?? '').trim();
    if (isi.length > 300) throw galat(400, 'Informasi rekening maksimal 300 karakter.');
    const r = await pool.query(
      'update public.customers set bank_info = $3 where id = $1 and store_id = $2 returning bank_info',
      [member.id, storeId, isi || null],
    );
    res.json({ data: { bank_info: r.rows[0]?.bank_info ?? null } });
  }));

  // -------------------------------------------------------------------------
  // Admin

  const admin = [requireUser, requireRoles(['admin'])];
  const tokoAdmin = (req) => {
    if (!req.user.store_id) throw galat(403, 'Admin belum terhubung ke toko.');
    return req.user.store_id;
  };

  app.get('/api/admin/affiliate/settings', ...admin, asyncHandler(async (req, res) => {
    res.json({ data: await muatPengaturan(pool, tokoAdmin(req)) });
  }));

  app.put('/api/admin/affiliate/settings', ...admin, asyncHandler(async (req, res) => {
    const storeId = tokoAdmin(req);
    const { pengaturan, galat: pesan } = normalisasiPengaturan(req.body);
    if (pesan) throw galat(400, pesan);
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('update public.stores set affiliate_settings = $2::jsonb where id = $1', [storeId, JSON.stringify(pengaturan)]);
      await writeAdminAudit(client, req.user, 'affiliate.settings', 'store', storeId, pengaturan);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    res.json({ data: pengaturan });
  }));

  app.get('/api/admin/affiliate/overview', ...admin, asyncHandler(async (req, res) => {
    const storeId = tokoAdmin(req);
    const r = rentang(req.query);
    const pengaturan = await muatPengaturan(pool, storeId);

    const pk = [storeId];
    const klikRentang = sqlRentang('created_at', r, pk);
    const po = [storeId];
    const pesananRentang = sqlRentang('o.created_at', r, po);
    const pc = [storeId];
    const komisiRentang = sqlRentang('k.created_at', r, pc);

    const [klik, pesanan, komisi, berhak, top] = await Promise.all([
      pool.query(`select affiliate_id, count(*)::int as n from public.affiliate_clicks where store_id = $1${klikRentang} group by 1`, pk),
      pool.query(
        `select o.affiliate_id,
                count(*) filter (where o.order_status <> 'canceled')::int as leads,
                count(*) filter (where o.order_status = 'done')::int as sales,
                coalesce(sum(${OMSET}) filter (where o.order_status = 'done'), 0)::float8 as omset
           from public.orders o
           ${RETUR_PESANAN}
          where o.store_id = $1 and o.affiliate_id is not null${pesananRentang} group by 1`,
        po,
      ),
      pool.query(
        `select k.affiliate_id,
                coalesce(sum(k.commission) filter (where k.status = 'pending'), 0)::float8 as pending,
                coalesce(sum(k.commission) filter (where k.status = 'added' and not k.paid), 0)::float8 as unpaid,
                -- Sudah dibayar dikurangi potongan yang sudah dipotong dari pembayaran berikutnya.
                coalesce(sum(k.commission - pt.terpakai) filter (where k.paid), 0)::float8 as paid
           from public.affiliate_commissions k
           left join lateral (
                select coalesce(sum(p.amount), 0) as terpakai from public.affiliate_potongan p
                 where p.commission_id = k.id and p.payout_id is not null
              ) pt on true
          where k.store_id = $1${komisiRentang} group by 1`,
        pc,
      ),
      pool.query(
        `select count(*)::int as n from public.customers
          where store_id = $1 and user_id is not null
            and (affiliate_access = 'allowed' or (affiliate_access = 'default' and $2::boolean))`,
        [storeId, pengaturan.access_mode === 'all'],
      ),
      pool.query(
        `select i.product_id, max(i.name) as name, sum(i.qty)::int as qty, sum(i.price * i.qty)::float8 as omset
           from public.order_items i join public.orders o on o.id = i.order_id
          where o.store_id = $1 and o.affiliate_id is not null and o.order_status = 'done'${pesananRentang}
          group by i.product_id order by omset desc limit 10`,
        po,
      ),
    ]);
    const peta = new Map();
    const ambil = (id) => {
      if (!peta.has(id)) peta.set(id, { clicks: 0, leads: 0, sales: 0, omset: 0, commission_pending: 0, commission_unpaid: 0, commission_paid: 0 });
      return peta.get(id);
    };
    for (const x of klik.rows) ambil(x.affiliate_id).clicks = x.n;
    for (const x of pesanan.rows) Object.assign(ambil(x.affiliate_id), { leads: x.leads, sales: x.sales, omset: x.omset });
    for (const x of komisi.rows) Object.assign(ambil(x.affiliate_id), { commission_pending: x.pending, commission_unpaid: x.unpaid, commission_paid: x.paid });
    // Penerima komisi tier atas bisa belum punya kode (belum pernah membuka dashboard), jadi nama diambil per id.
    const perAff = peta.size
      ? await pool.query('select id, name, email, affiliate_code, affiliate_access, user_id from public.customers where store_id = $1 and id = any($2::uuid[])', [storeId, [...peta.keys()]])
      : { rows: [] };
    const nama = new Map(perAff.rows.map((a) => [a.id, a]));
    const daftar = [...peta.entries()].map(([id, v]) => ({ id, name: nama.get(id)?.name ?? 'Member', email: nama.get(id)?.email ?? null, code: nama.get(id)?.affiliate_code ?? null, ...v }));
    const jumlah = (k) => daftar.reduce((s, a) => s + angka(a[k]), 0);
    // "X dari Y": X adalah yang berhak DAN punya klik atau pesanan, supaya tidak pernah melebihi Y.
    const masihBerhak = (id) => {
      const m = nama.get(id);
      return !!(m && m.user_id && aksesBerhak(pengaturan, m.affiliate_access));
    };
    const aktif = daftar.filter((a) => (a.clicks > 0 || a.leads > 0) && masihBerhak(a.id)).length;
    res.json({
      data: {
        eligible_affiliates: pengaturan.enabled ? berhak.rows[0].n : 0,
        active_affiliates: aktif,
        totals: {
          clicks: jumlah('clicks'),
          leads: jumlah('leads'),
          sales: jumlah('sales'),
          omset: jumlah('omset'),
          commission: jumlah('commission_unpaid') + jumlah('commission_paid'),
          pending: jumlah('commission_pending'),
          unpaid: jumlah('commission_unpaid'),
          paid: jumlah('commission_paid'),
        },
        affiliates: daftar.sort((a, b) => b.omset - a.omset),
        top_products: top.rows,
      },
    });
  }));

  const PILIH_KOMISI_ADMIN = `
    select k.id, k.created_at, k.order_id, o.order_number, o.order_status, coalesce(i.name, 'Produk') as product_name,
           k.affiliate_id, a.name as affiliate_name, k.tier, k.commission::float8 as commission,
           coalesce(k.commission_awal, k.commission)::float8 as commission_original, k.status, k.paid, k.paid_at,
           k.base_amount::float8 as base_amount, k.rate_type, k.rate_value::float8 as rate_value
      from public.affiliate_commissions k
      join public.orders o on o.id = k.order_id
      join public.customers a on a.id = k.affiliate_id
      left join public.order_items i on i.id = k.order_item_id`;

  app.get('/api/admin/affiliate/commissions', ...admin, asyncHandler(async (req, res) => {
    const storeId = tokoAdmin(req);
    const params = [storeId];
    let where = ' where k.store_id = $1';
    where += sqlRentang('k.created_at', rentang(req.query), params);
    const q = String(req.query.q ?? '').trim();
    if (q) {
      params.push(`%${q}%`);
      where += ` and (o.order_number ilike $${params.length} or coalesce(o.external_order_no, '') ilike $${params.length})`;
    }
    const st = String(req.query.order_status ?? '');
    if (st === 'done') where += ` and o.order_status = 'done'`;
    else if (st === 'canceled') where += ` and o.order_status = 'canceled'`;
    else if (st === 'pending') where += ` and o.order_status not in ('done', 'canceled')`;
    if (req.query.paid === 'paid') where += ' and k.paid';
    if (req.query.paid === 'unpaid') where += ` and not k.paid and k.status = 'added'`;
    if (String(req.query.followup ?? '') === 'true') where += ` and k.status = 'cancelled' and k.paid`;
    const orderId = String(req.query.order_id ?? '');
    if (POLA_UUID.test(orderId)) {
      params.push(orderId);
      where += ` and k.order_id = $${params.length}`;
    }
    const r = await pool.query(`${PILIH_KOMISI_ADMIN}${where} order by k.created_at desc, k.tier limit 500`, params);
    res.json({ data: r.rows });
  }));

  app.get('/api/admin/affiliate/order/:id', ...admin, asyncHandler(async (req, res) => {
    const storeId = tokoAdmin(req);
    const id = String(req.params.id);
    if (!POLA_UUID.test(id)) throw galat(404, 'Pesanan tidak ditemukan.');
    const o = await pool.query(
      `select o.affiliate_id, o.affiliate_source, o.acquisition_source, o.acquisition_media, a.name, a.affiliate_code
         from public.orders o left join public.customers a on a.id = o.affiliate_id
        where o.id = $1 and o.store_id = $2`,
      [id, storeId],
    );
    if (!o.rowCount) throw galat(404, 'Pesanan tidak ditemukan.');
    const x = o.rows[0];
    const k = await pool.query(`${PILIH_KOMISI_ADMIN} where k.store_id = $1 and k.order_id = $2 order by k.tier`, [storeId, id]);
    res.json({
      data: {
        affiliate: x.affiliate_id ? { id: x.affiliate_id, name: x.name, code: x.affiliate_code } : null,
        source: x.affiliate_source,
        acquisition: x.acquisition_source ? { source: x.acquisition_source, media: x.acquisition_media } : null,
        commissions: k.rows,
      },
    });
  }));

  /**
   * Tandai komisi dibayar per affiliate di dalam transaksi `client`; mengembalikan
   * pembayaran yang dibuat. Dengan `rincian` (Bayar biasa, D-40) bonus Belum
   * dibayar ikut dibayar dan potongan yang belum terpakai mengurangi jumlahnya;
   * konfirmasi massal tidak memakai keduanya.
   */
  async function bayarKomisi(client, req, { storeId, affiliateId, ids, note, proofImage, catatPengeluaran, rincian = null }) {
    const terkunci = await client.query(
      `select id, commission from public.affiliate_commissions
        where store_id = $1 and affiliate_id = $2 and id = any($3::uuid[]) and status = 'added' and not paid
        for update`,
      [storeId, affiliateId, ids],
    );
    const bonusIds = rincian?.bonusIds ?? [];
    const potonganIds = rincian?.potonganIds ?? [];
    if (!terkunci.rowCount && !bonusIds.length) return null;
    const komisiTotal = terkunci.rows.reduce((s, x) => s + Number(x.commission), 0);
    const jumlah = rincian ? rincian.bersih : komisiTotal;
    const aff = await ambilMember(client, storeId, affiliateId);
    const p = await client.query(
      `insert into public.affiliate_payouts
         (store_id, affiliate_id, amount, commission_count, paid_by, note, proof_image, commission_total, bonus_total, deduction_total)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       returning id, amount::float8 as amount, commission_count, paid_at, note, (proof_image is not null) as has_proof,
                 commission_total::float8 as commission_total, bonus_total::float8 as bonus_total, deduction_total::float8 as deduction_total`,
      [storeId, affiliateId, jumlah, terkunci.rowCount, idAktor(req.user), note || null, proofImage || null,
       komisiTotal, rincian?.bonus ?? 0, rincian?.potongan ?? 0],
    );
    const payout = p.rows[0];
    await client.query(
      `update public.affiliate_commissions set paid = true, paid_at = now(), payout_id = $2, updated_at = now()
        where id = any($1::uuid[])`,
      [terkunci.rows.map((x) => x.id), payout.id],
    );
    if (bonusIds.length) {
      await client.query(
        'update public.affiliate_bonuses set paid = true, paid_at = now(), payout_id = $2, updated_at = now() where id = any($1::uuid[])',
        [bonusIds, payout.id],
      );
    }
    if (potonganIds.length) {
      await client.query('update public.affiliate_potongan set payout_id = $2 where id = any($1::uuid[])', [potonganIds, payout.id]);
    }
    let expenseId = null;
    if (catatPengeluaran) {
      const e = await client.query(
        `insert into public.expenses (store_id, category, description, amount, expense_date, payment_method, created_by)
         values ($1, 'komisi_affiliate', $2, $3, (now() at time zone '${ZONA}')::date, 'transfer', $4)
         returning id`,
        [storeId, `Komisi affiliate ${aff?.name ?? ''}`.trim(), jumlah, idAktor(req.user)],
      );
      expenseId = e.rows[0].id;
      await client.query('update public.affiliate_payouts set expense_id = $2 where id = $1', [payout.id, expenseId]);
    }
    const pengaturan = await muatPengaturan(client, storeId);
    if (pengaturan.email_paid) {
      await client.query(`insert into public.affiliate_outbox (store_id, kind, ref_id) values ($1, 'komisi_dibayar', $2)`, [storeId, payout.id]);
    }
    await writeAdminAudit(client, req.user, 'affiliate.payout', 'customer', affiliateId, { amount: jumlah, commissions: terkunci.rowCount, expense: !!expenseId });
    return { ...payout, affiliate_id: affiliateId, affiliate_name: aff?.name ?? 'Member', expense_id: expenseId };
  }

  app.post('/api/admin/affiliate/commissions/bulk', ...admin, asyncHandler(async (req, res) => {
    const storeId = tokoAdmin(req);
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(String).filter((x) => POLA_UUID.test(x)).slice(0, 500);
    const action = String(req.body?.action ?? '');
    if (!ids.length) throw galat(400, 'Anda belum memilih komisi');
    if (action !== 'mark_paid' && action !== 'mark_unpaid') throw galat(400, 'Anda belum memilih aksi');
    const client = await pool.connect();
    let updated = 0;
    try {
      await client.query('begin');
      if (action === 'mark_paid') {
        const per = await client.query(
          `select distinct affiliate_id from public.affiliate_commissions
            where store_id = $1 and id = any($2::uuid[]) and status = 'added' and not paid`,
          [storeId, ids],
        );
        for (const { affiliate_id: affiliateId } of per.rows) {
          const p = await bayarKomisi(client, req, { storeId, affiliateId, ids, note: 'Konfirmasi massal', proofImage: null, catatPengeluaran: false });
          updated += p?.commission_count ?? 0;
        }
      } else {
        const lepas = await client.query(
          `select id, commission, payout_id from public.affiliate_commissions
            where store_id = $1 and id = any($2::uuid[]) and paid for update`,
          [storeId, ids],
        );
        await client.query(
          `update public.affiliate_commissions set paid = false, paid_at = null, payout_id = null, updated_at = now()
            where id = any($1::uuid[])`,
          [lepas.rows.map((x) => x.id)],
        );
        updated = lepas.rowCount;
        // Pembayaran dan pengeluarannya ikut dikurangi supaya Laba Rugi tetap benar.
        const perBayar = new Map();
        for (const x of lepas.rows) {
          if (!x.payout_id) continue;
          const v = perBayar.get(x.payout_id) ?? { n: 0, s: 0 };
          v.n += 1;
          v.s += Number(x.commission);
          perBayar.set(x.payout_id, v);
        }
        for (const [payoutId, v] of perBayar) {
          const p = await client.query(
            `select amount::float8 as amount, commission_count, expense_id from public.affiliate_payouts
              where id = $1 and store_id = $2 for update`,
            [payoutId, storeId],
          );
          const kini = p.rows[0];
          if (!kini) continue;
          const sisa = Math.round((kini.amount - v.s) * 100) / 100;
          // Pembayaran yang habis dihapus, bukan dinolkan: kolom amount wajib lebih dari nol.
          // Bonus dan potongan yang ikut di dalamnya kembali menunggu (AC-84).
          if (sisa <= 0 || kini.commission_count - v.n <= 0) {
            await client.query('update public.affiliate_bonuses set paid = false, paid_at = null, payout_id = null, updated_at = now() where payout_id = $1', [payoutId]);
            await client.query('update public.affiliate_potongan set payout_id = null where payout_id = $1', [payoutId]);
            await client.query('delete from public.affiliate_payouts where id = $1', [payoutId]);
            if (kini.expense_id) await client.query('delete from public.expenses where id = $1 and store_id = $2', [kini.expense_id, storeId]);
          } else {
            await client.query(
              'update public.affiliate_payouts set amount = $2, commission_count = commission_count - $3, commission_total = commission_total - $4 where id = $1',
              [payoutId, sisa, v.n, v.s],
            );
            if (kini.expense_id) await client.query('update public.expenses set amount = $2 where id = $1 and store_id = $3', [kini.expense_id, sisa, storeId]);
          }
        }
        await writeAdminAudit(client, req.user, 'affiliate.unpay', 'commission', null, { ids: lepas.rows.map((x) => x.id) });
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    res.json({ data: { updated } });
  }));

  /** Bulan pertama dan terakhir dari rentang tanggal, untuk menyaring bonus. */
  function sqlRentangBulan(kolom, r, params) {
    const bagian = [];
    if (r.from) {
      params.push(r.from);
      bagian.push(`${kolom} >= date_trunc('month', $${params.length}::date)`);
    }
    if (r.to) {
      params.push(r.to);
      bagian.push(`${kolom} <= $${params.length}::date`);
    }
    return bagian.length ? ` and ${bagian.join(' and ')}` : '';
  }

  /** Yang bisa dibayar ke satu affiliate: komisi, bonus, potongan, dan bersihnya (D-40). */
  async function isiBayar(db, storeId, affiliateId, r, { kunci = false } = {}) {
    const pk = [storeId, affiliateId];
    const fk = sqlRentang('created_at', r, pk);
    const pb = [storeId, affiliateId];
    const fb = sqlRentangBulan('bulan', r, pb);
    const kunciSql = kunci ? ' for update' : '';
    // Berurutan: satu koneksi transaksi tidak boleh menjalankan dua query sekaligus.
    const komisi = await db.query(`select id, commission::float8 as commission from public.affiliate_commissions
               where store_id = $1 and affiliate_id = $2 and status = 'added' and not paid${fk}${kunciSql}`, pk);
    const bonus = await db.query(`select id, amount::float8 as amount from public.affiliate_bonuses
               where store_id = $1 and affiliate_id = $2 and status = 'added' and not paid${fb}${kunciSql}`, pb);
    const potongan = await db.query(`select id, amount::float8 as amount from public.affiliate_potongan
               where store_id = $1 and affiliate_id = $2 and payout_id is null${kunciSql}`, [storeId, affiliateId]);
    const jumlah = (rows, k) => Math.round(rows.reduce((s, x) => s + Number(x[k]), 0) * 100) / 100;
    return {
      komisiIds: komisi.rows.map((x) => x.id),
      bonusIds: bonus.rows.map((x) => x.id),
      potonganIds: potongan.rows.map((x) => x.id),
      komisi: jumlah(komisi.rows, 'commission'),
      bonus: jumlah(bonus.rows, 'amount'),
      potongan: jumlah(potongan.rows, 'amount'),
    };
  }

  app.get('/api/admin/affiliate/payouts/summary', ...admin, asyncHandler(async (req, res) => {
    const storeId = tokoAdmin(req);
    await segarkanBonus(pool, storeId);
    const pengaturan = await muatPengaturan(pool, storeId);
    const r = rentang(req.query);
    const params = [storeId];
    const filter = sqlRentang('k.created_at', r, params);
    const fBonus = sqlRentangBulan('b.bulan', r, params);
    const q = await pool.query(
      `with k as (
         select k.affiliate_id,
                coalesce(sum(k.commission) filter (where k.status = 'pending'), 0) as pending,
                coalesce(sum(k.commission) filter (where k.status = 'added' and not k.paid), 0) as unpaid,
                coalesce(sum(k.commission - pt.terpakai) filter (where k.paid), 0) as paid
           from public.affiliate_commissions k
           left join lateral (
                select coalesce(sum(p.amount), 0) as terpakai from public.affiliate_potongan p
                 where p.commission_id = k.id and p.payout_id is not null
              ) pt on true
          where k.store_id = $1${filter} group by 1
       ), b as (
         select b.affiliate_id,
                coalesce(sum(b.amount) filter (where b.status = 'added' and not b.paid), 0) as bonus,
                coalesce(sum(b.amount) filter (where b.paid), 0) as bonus_paid,
                coalesce(sum(b.amount) filter (where b.status = 'berjalan'), 0) as bonus_running
           from public.affiliate_bonuses b where b.store_id = $1${fBonus} group by 1
       ), p as (
         select affiliate_id, coalesce(sum(amount), 0) as deductions
           from public.affiliate_potongan where store_id = $1 and payout_id is null group by 1
       ), semua as (select affiliate_id from k union select affiliate_id from b union select affiliate_id from p)
       select a.id as affiliate_id, a.name, a.email, a.phone, a.bank_info,
              coalesce(k.pending, 0)::float8 as pending, coalesce(k.unpaid, 0)::float8 as unpaid,
              (coalesce(k.paid, 0) + coalesce(b.bonus_paid, 0))::float8 as paid,
              coalesce(b.bonus, 0)::float8 as bonus, coalesce(b.bonus_running, 0)::float8 as bonus_running,
              coalesce(p.deductions, 0)::float8 as deductions
         from semua s
         join public.customers a on a.id = s.affiliate_id
         left join k on k.affiliate_id = s.affiliate_id
         left join b on b.affiliate_id = s.affiliate_id
         left join p on p.affiliate_id = s.affiliate_id
        order by coalesce(k.unpaid, 0) + coalesce(b.bonus, 0) - coalesce(p.deductions, 0) desc, coalesce(k.paid, 0) desc
        limit 500`,
      params,
    );
    const minimal = pengaturan.payout_minimum;
    res.json({
      data: q.rows.map((x) => {
        const net = Math.round((x.unpaid + x.bonus - x.deductions) * 100) / 100;
        return { ...x, net, below_minimum: minimal > 0 && net > 0 && net < minimal };
      }),
      payout_minimum: minimal,
    });
  }));

  app.get('/api/admin/affiliate/payouts', ...admin, asyncHandler(async (req, res) => {
    const storeId = tokoAdmin(req);
    const r = await pool.query(
      `select p.id, p.affiliate_id, a.name as affiliate_name, p.amount::float8 as amount, p.commission_count, p.paid_at, p.note,
              (p.proof_image is not null) as has_proof, p.expense_id, p.commission_total::float8 as commission_total,
              p.bonus_total::float8 as bonus_total, p.deduction_total::float8 as deduction_total
         from public.affiliate_payouts p join public.customers a on a.id = p.affiliate_id
        where p.store_id = $1 order by p.paid_at desc limit 100`,
      [storeId],
    );
    res.json({ data: r.rows });
  }));

  app.get('/api/admin/affiliate/payouts/:id/proof', ...admin, asyncHandler(async (req, res) => {
    const storeId = tokoAdmin(req);
    const id = String(req.params.id);
    if (!POLA_UUID.test(id)) throw galat(404, 'Bukti transfer tidak ditemukan.');
    const r = await pool.query('select proof_image from public.affiliate_payouts where id = $1 and store_id = $2', [id, storeId]);
    if (!r.rows[0]?.proof_image) throw galat(404, 'Bukti transfer tidak ditemukan.');
    res.json({ data: { proof_image: r.rows[0].proof_image } });
  }));

  app.post('/api/admin/affiliate/payouts', ...admin, asyncHandler(async (req, res) => {
    const storeId = tokoAdmin(req);
    const affiliateId = String(req.body?.affiliate_id ?? '');
    if (!POLA_UUID.test(affiliateId)) throw galat(400, 'Affiliate belum dipilih.');
    const note = String(req.body?.note ?? '').trim().slice(0, 300);
    const bukti = req.body?.proof_image ? String(req.body.proof_image) : null;
    if (bukti && (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(bukti) || bukti.length > 400 * 1024 * 1.37)) {
      throw galat(400, 'Bukti transfer harus gambar JPG, PNG, atau WebP.');
    }
    const r = rentang(req.body ?? {});
    await segarkanBonus(pool, storeId, { paksa: true });
    const pengaturan = await muatPengaturan(pool, storeId);
    const client = await pool.connect();
    try {
      await client.query('begin');
      // Satu pembayaran per affiliate pada satu waktu: komisi, bonus, dan potongan dikunci bersama.
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [`affiliate-bayar:${affiliateId}`]);
      const isi = await isiBayar(client, storeId, affiliateId, r, { kunci: true });
      const hasil = rincianBayar({
        komisi: isi.komisi,
        bonus: isi.bonus,
        potongan: isi.potongan,
        minimal: pengaturan.payout_minimum,
        abaikanMinimal: req.body?.abaikan_minimal === true,
      });
      if (hasil.galat) throw galat(409, hasil.galat);
      const payout = await bayarKomisi(client, req, {
        storeId,
        affiliateId,
        ids: isi.komisiIds,
        note,
        proofImage: bukti,
        catatPengeluaran: req.body?.record_expense !== false,
        rincian: { bersih: hasil.bersih, bonus: isi.bonus, potongan: isi.potongan, bonusIds: isi.bonusIds, potonganIds: isi.potonganIds },
      });
      if (!payout) throw galat(409, 'Tidak ada komisi Belum dibayar untuk affiliate ini pada rentang tanggal ini.');
      await client.query('commit');
      res.json({ data: payout });
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }));

  app.get('/api/admin/affiliate/members', ...admin, asyncHandler(async (req, res) => {
    const storeId = tokoAdmin(req);
    const pengaturan = await muatPengaturan(pool, storeId);
    const params = [storeId, pengaturan.access_mode === 'all', pengaturan.enabled];
    let where = ' where c.store_id = $1 and c.user_id is not null';
    const q = String(req.query.q ?? '').trim();
    if (q) {
      params.push(`%${q}%`);
      where += ` and (c.name ilike $${params.length} or coalesce(c.email, '') ilike $${params.length} or coalesce(c.affiliate_code, '') ilike $${params.length})`;
    }
    const akses = String(req.query.access ?? '');
    if (['default', 'allowed', 'blocked'].includes(akses)) {
      params.push(akses);
      where += ` and c.affiliate_access = $${params.length}`;
    } else if (akses === 'eligible') {
      where += ` and $3::boolean and (c.affiliate_access = 'allowed' or (c.affiliate_access = 'default' and $2::boolean))`;
    }
    const r = await pool.query(
      `select c.id, c.name, c.email, c.phone, c.affiliate_code as code, c.affiliate_access as access,
              ($3::boolean and (c.affiliate_access = 'allowed' or (c.affiliate_access = 'default' and $2::boolean))) as eligible,
              c.referred_by as upline_id, u.name as upline_name, coalesce(c.referred_at, c.created_at) as joined_at,
              c.affiliate_commission as commission,
              (select count(*) from public.customers d where d.store_id = c.store_id and d.referred_by = c.id)::int as downline_count,
              (select count(*) from public.affiliate_clicks k where k.store_id = c.store_id and k.affiliate_id = c.id)::int as clicks,
              (select count(*) from public.orders o where o.store_id = c.store_id and o.affiliate_id = c.id and o.order_status = 'done')::int as sales,
              (select coalesce(sum(k.commission), 0) from public.affiliate_commissions k
                where k.store_id = c.store_id and k.affiliate_id = c.id and k.status = 'added' and not k.paid)::float8 as commission_unpaid
         from public.customers c
         left join public.customers u on u.id = c.referred_by
        ${where}
        order by (c.affiliate_code is null), c.name
        limit 500`,
      params,
    );
    res.json({ data: r.rows });
  }));

  app.patch('/api/admin/affiliate/members/:id', ...admin, asyncHandler(async (req, res) => {
    const storeId = tokoAdmin(req);
    const id = String(req.params.id);
    if (!POLA_UUID.test(id)) throw galat(404, 'Member tidak ditemukan.');
    const member = await ambilMember(pool, storeId, id);
    if (!member || !member.user_id) throw galat(404, 'Member tidak ditemukan.');
    const ubah = {};
    if (req.body?.access !== undefined) {
      if (!['default', 'allowed', 'blocked'].includes(req.body.access)) throw galat(400, 'Akses affiliate tidak valid.');
      ubah.affiliate_access = req.body.access;
    }
    if (req.body?.code !== undefined) {
      const kode = String(req.body.code ?? '').trim().toUpperCase();
      if (!/^[A-Z0-9]{4,20}$/.test(kode)) throw galat(400, 'Kode hanya boleh huruf besar dan angka, 4 sampai 20 karakter.');
      // /aff/undangan/{token} adalah alamat undangan, jadi kata itu tidak boleh menjadi kode.
      if (kode === 'UNDANGAN') throw galat(400, 'Kode UNDANGAN tidak bisa dipakai. Pilih kode lain.');
      ubah.affiliate_code = kode;
    }
    if (req.body?.commission !== undefined) {
      const t = validasiTarif(req.body.commission);
      if (t.galat) throw galat(400, t.galat);
      ubah.affiliate_commission = t.tier;
    }
    let uplineBaru;
    if (req.body?.referred_by !== undefined) {
      uplineBaru = req.body.referred_by ? String(req.body.referred_by) : null;
      if (uplineBaru) {
        if (!POLA_UUID.test(uplineBaru) || uplineBaru === id) throw galat(400, 'Upline tidak boleh dirinya sendiri atau downline-nya.');
        const calon = await ambilMember(pool, storeId, uplineBaru);
        if (!calon || !calon.user_id) throw galat(400, 'Upline tidak ditemukan.');
        const turunan = await pool.query(
          `with recursive d as (
             select id, 1 as lvl from public.customers where store_id = $1 and referred_by = $2
             union all
             select c.id, d.lvl + 1 from public.customers c join d on c.referred_by = d.id where c.store_id = $1 and d.lvl < 50
           ) select 1 from d where id = $3 limit 1`,
          [storeId, id, uplineBaru],
        );
        if (turunan.rowCount) throw galat(400, 'Upline tidak boleh dirinya sendiri atau downline-nya.');
      }
    }
    const client = await pool.connect();
    try {
      await client.query('begin');
      if (ubah.affiliate_access) await client.query('update public.customers set affiliate_access = $2 where id = $1', [id, ubah.affiliate_access]);
      if ('affiliate_commission' in ubah) {
        await client.query('update public.customers set affiliate_commission = $2::jsonb where id = $1', [id, ubah.affiliate_commission ? JSON.stringify(ubah.affiliate_commission) : null]);
      }
      if (ubah.affiliate_code && ubah.affiliate_code !== member.affiliate_code) {
        await client.query('update public.customers set affiliate_code = $2 where id = $1', [id, ubah.affiliate_code]);
      }
      if (uplineBaru !== undefined && uplineBaru !== member.referred_by) {
        await client.query(
          `update public.customers set referred_by = $2, referred_at = case when $2::uuid is null then null else now() end,
                  referral_source = case when $2::uuid is null then null else 'admin' end
            where id = $1`,
          [id, uplineBaru],
        );
      }
      await writeAdminAudit(client, req.user, 'affiliate.member', 'customer', id, { ...ubah, ...(uplineBaru !== undefined ? { referred_by: uplineBaru } : {}) });
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      if (error?.code === '23505') throw galat(409, 'Kode ini sudah dipakai affiliate lain.');
      throw error;
    } finally {
      client.release();
    }
    res.json({ data: { id } });
  }));

  // Undangan khusus admin (D-32, FR-51) -----------------------------------

  function barisUndanganAdmin(u) {
    return { ...barisUndangan(u), commission: u.commission ?? null, registered_name: u.registered_name ?? null };
  }

  async function kirimEmailUndanganAdmin({ storeId, email, nama, pesan, token, hari, tarif }) {
    if (alamatUji(email)) return;
    const toko = (await pool.query('select name from public.stores where id = $1', [storeId])).rows[0]?.name || 'GNNK Racing';
    await kirimEmail({ to: email, ...emailUndanganAdmin({ toko, nama, pesan, tautan: `${asalToko}/aff/undangan/${token}`, hari, tarif }) });
  }

  app.get('/api/admin/affiliate/invitations', ...admin, asyncHandler(async (req, res) => {
    const storeId = tokoAdmin(req);
    const r = await pool.query(
      `select u.id, u.email, u.name, u.status, u.sent_at, u.opened_at, u.expires_at, u.commission, c.name as registered_name
         from public.affiliate_invitations u
         left join public.customers c on c.id = u.registered_customer_id
        where u.store_id = $1 and u.dari_admin
        order by u.sent_at desc limit 200`,
      [storeId],
    );
    res.json({ data: r.rows.map(barisUndanganAdmin) });
  }));

  app.post('/api/admin/affiliate/invitations', ...admin, asyncHandler(async (req, res) => {
    const storeId = tokoAdmin(req);
    const pengaturan = await muatPengaturan(pool, storeId);
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const nama = String(req.body?.name ?? '').trim().slice(0, 80) || null;
    const pesan = String(req.body?.message ?? '').trim().slice(0, 300) || null;
    if (!POLA_EMAIL.test(email) || email.length > 200) throw galat(400, 'Email tidak valid.');
    if (memuatTautan(nama) || memuatTautan(pesan)) throw galat(400, 'Nama dan pesan undangan tidak boleh memuat tautan.');
    const t = validasiTarif(req.body?.commission ?? null);
    if (t.galat) throw galat(400, t.galat);
    const token = tokenBaru();
    const client = await pool.connect();
    let baris;
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [`affiliate-undang-admin:${storeId}`]);
      const anggota = await client.query(
        'select 1 from public.customers where store_id = $1 and lower(email) = $2 and user_id is not null limit 1',
        [storeId, email],
      );
      if (anggota.rowCount) throw galat(409, 'Email ini sudah terdaftar sebagai member. Ubah aksesnya di daftar Affiliate.');
      const ganda = await client.query(
        `select 1 from public.affiliate_invitations
          where store_id = $1 and dari_admin and lower(email) = $2 and sent_at > now() - interval '24 hours' limit 1`,
        [storeId, email],
      );
      if (ganda.rowCount) throw galat(409, 'Email ini sudah diundang dalam 24 jam terakhir.');
      const ins = await client.query(
        `insert into public.affiliate_invitations (store_id, affiliate_id, dari_admin, email, name, message, token_hash, expires_at, commission)
         values ($1, null, true, $2, $3, $4, $5, now() + make_interval(days => $6), $7::jsonb)
         returning id, email, name, status, sent_at, opened_at, expires_at, commission`,
        [storeId, email, nama, pesan, sidikToken(token), pengaturan.invite_days, t.tier ? JSON.stringify(t.tier) : null],
      );
      baris = ins.rows[0];
      await writeAdminAudit(client, req.user, 'affiliate.invite', 'invitation', baris.id, { email, commission: t.tier });
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    try {
      await kirimEmailUndanganAdmin({ storeId, email, nama, pesan, token, hari: pengaturan.invite_days, tarif: t.tier });
    } catch (error) {
      await pool.query(`update public.affiliate_invitations set status = 'failed', last_error = $2 where id = $1`, [baris.id, String(error.message).slice(0, 300)]);
      throw galat(502, 'Undangan gagal dikirim. Coba kirim ulang beberapa saat lagi.');
    }
    res.json({ data: barisUndanganAdmin(baris) });
  }));

  app.post('/api/admin/affiliate/invitations/:id/resend', ...admin, asyncHandler(async (req, res) => {
    const storeId = tokoAdmin(req);
    const id = String(req.params.id);
    if (!POLA_UUID.test(id)) throw galat(404, 'Undangan tidak ditemukan.');
    const pengaturan = await muatPengaturan(pool, storeId);
    const token = tokenBaru();
    const client = await pool.connect();
    let lama;
    let baru;
    try {
      await client.query('begin');
      const r = await client.query(
        `select id, email, name, message, status, sent_at, commission from public.affiliate_invitations
          where id = $1 and store_id = $2 and dari_admin for update`,
        [id, storeId],
      );
      lama = r.rows[0];
      if (!lama) throw galat(404, 'Undangan tidak ditemukan.');
      if (lama.status === 'registered') throw galat(409, 'Penerima sudah mendaftar.');
      const anggota = await client.query(
        'select 1 from public.customers where store_id = $1 and lower(email) = lower($2) and user_id is not null limit 1',
        [storeId, lama.email],
      );
      if (anggota.rowCount) throw galat(409, 'Email ini sudah terdaftar sebagai member. Ubah aksesnya di daftar Affiliate.');
      if (lama.status !== 'failed' && Date.now() - new Date(lama.sent_at).getTime() < 24 * 3600_000) {
        throw galat(409, 'Undangan baru bisa dikirim ulang 24 jam setelah pengiriman terakhir.');
      }
      const up = await client.query(
        `update public.affiliate_invitations
            set token_hash = $2, sent_at = now(), expires_at = now() + make_interval(days => $3),
                status = 'sent', resend_count = resend_count + 1, last_error = null
          where id = $1
          returning id, email, name, status, sent_at, opened_at, expires_at, commission`,
        [id, sidikToken(token), pengaturan.invite_days],
      );
      baru = up.rows[0];
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    try {
      await kirimEmailUndanganAdmin({ storeId, email: lama.email, nama: lama.name, pesan: lama.message, token, hari: pengaturan.invite_days, tarif: lama.commission });
    } catch (error) {
      await pool.query(`update public.affiliate_invitations set status = 'failed', last_error = $2 where id = $1`, [id, String(error.message).slice(0, 300)]);
      throw galat(502, 'Undangan gagal dikirim. Coba kirim ulang beberapa saat lagi.');
    }
    res.json({ data: barisUndanganAdmin(baru) });
  }));

  app.get('/api/admin/affiliate/members/:id/network', ...admin, asyncHandler(async (req, res) => {
    const storeId = tokoAdmin(req);
    const id = String(req.params.id);
    if (!POLA_UUID.test(id)) throw galat(404, 'Member tidak ditemukan.');
    const member = await ambilMember(pool, storeId, id);
    if (!member) throw galat(404, 'Member tidak ditemukan.');
    // Sejoli: tampilan jaringan member di sisi admin dibatasi kedua pengaturan kedalaman.
    const pengaturan = await muatPengaturan(pool, storeId);
    const [atas, bawah] = await Promise.all([
      pool.query(
        `with recursive u as (
           select c.id, c.name, c.referred_by, 1 as depth, array[c.id] as jalur
             from public.customers c where c.id = $2 and c.store_id = $1
           union all
           select p.id, p.name, p.referred_by, u.depth + 1, u.jalur || p.id
             from public.customers p join u on p.id = u.referred_by
            where p.store_id = $1 and u.depth <= $3 and not p.id = any(u.jalur)
         ) select id, name, depth - 1 as depth from u where depth > 1 order by depth`,
        [storeId, id, pengaturan.upline_depth],
      ),
      pool.query(
        `with recursive t as (
           select id, referred_by, name, coalesce(referred_at, created_at) as joined_at, 1 as depth, array[id] as jalur
             from public.customers where store_id = $1 and referred_by = $2
           union all
           select c.id, c.referred_by, c.name, coalesce(c.referred_at, c.created_at), t.depth + 1, t.jalur || c.id
             from public.customers c join t on c.referred_by = t.id
            where c.store_id = $1 and t.depth < $3 and not c.id = any(t.jalur)
         )
         select t.id, t.referred_by, t.name, t.joined_at, t.depth,
                (select count(*) from public.customers d where d.store_id = $1 and d.referred_by = t.id)::int as downline_count
           from t order by t.jalur limit 1000`,
        [storeId, id, pengaturan.downline_depth],
      ),
    ]);
    res.json({
      data: {
        uplines: atas.rows,
        nodes: bawah.rows.map((n) => ({ id: n.id, parent_id: n.depth === 1 ? null : n.referred_by, name: n.name, joined_at: n.joined_at, downline_count: n.downline_count, depth: n.depth })),
      },
    });
  }));
}
