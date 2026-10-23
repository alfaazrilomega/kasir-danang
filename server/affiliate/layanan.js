// Layanan affiliate yang menyentuh basis data. Setiap fungsi menerima `db`
// (pool atau client transaksi) supaya bisa dipakai di dalam transaksi checkout
// dan pendaftaran yang sudah berjalan.
import {
  aksesBerhak,
  ambilCookie,
  bacaTanda,
  bangunRantai,
  cookieBerlaku,
  gabungPengaturan,
  hitungBonus,
  hitungKomisi,
  kodeAcak,
  pilihCalon,
  tarifBarang,
} from './inti.js';

export const ZONA = 'Asia/Jakarta';

/**
 * Kunci yang menyatukan varian satu produk, sama dengan kunciKelompok di
 * src/lib/publicCatalog.ts: SKU Induk bila diisi, selain itu nama produk.
 * Di Sejoli satu produk mencakup semua variannya, sedangkan di sini tiap
 * varian adalah baris produk sendiri. Aturan affiliate per produk (link
 * produk, syarat sudah membeli) memakai kunci ini supaya link untuk satu
 * varian tetap berlaku ketika pembeli memilih varian lain.
 */
export const sqlKunciKelompok = (alias) =>
  `case when btrim(coalesce(${alias}.parent_sku, '')) <> '' then 'induk:' || lower(btrim(${alias}.parent_sku)) else 'nama:' || lower(btrim(${alias}.name)) end`;

const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Isi cookie affiliate yang sah dan masih dalam umurnya, atau null. */
export function cookieSah(cookieHeader, rahasia, pengaturan) {
  const cookie = bacaTanda(ambilCookie(cookieHeader), rahasia);
  return cookieBerlaku(cookie, pengaturan.cookie_days) ? cookie : null;
}

export async function muatPengaturan(db, storeId) {
  const r = await db.query('select affiliate_settings from public.stores where id = $1', [storeId]);
  return gabungPengaturan(r.rows[0]?.affiliate_settings);
}

/** Member (akun pembeli) di toko itu, beserta kolom affiliate. */
export async function ambilMember(db, storeId, customerId) {
  const r = await db.query(
    `select id, store_id, user_id, name, email, phone, affiliate_code, affiliate_access, referred_by, bank_info,
            created_at, referred_at, affiliate_commission
       from public.customers where id = $1 and store_id = $2`,
    [customerId, storeId],
  );
  return r.rows[0] ?? null;
}

export async function memberDariUser(db, storeId, userId) {
  const r = await db.query(
    `select id, store_id, user_id, name, email, phone, affiliate_code, affiliate_access, referred_by, bank_info,
            created_at, referred_at, affiliate_commission
       from public.customers where user_id = $1 and store_id = $2 limit 1`,
    [userId, storeId],
  );
  return r.rows[0] ?? null;
}

export async function cariAffiliateDariKode(db, storeId, kode) {
  const r = await db.query(
    `select id, name, email, affiliate_code, affiliate_access, user_id
       from public.customers
      where store_id = $1 and upper(affiliate_code) = upper($2) and user_id is not null
      limit 1`,
    [storeId, String(kode ?? '').trim()],
  );
  return r.rows[0] ?? null;
}

/** Kode affiliate dibuat sekali saat pertama dibutuhkan (FR-11). */
export async function pastikanKode(db, storeId, member) {
  if (member.affiliate_code) return member.affiliate_code;
  for (let coba = 0; coba < 40; coba += 1) {
    const digit = coba < 15 ? 2 : coba < 30 ? 3 : 4;
    const calon = kodeAcak(member.name, digit);
    try {
      const r = await db.query(
        `update public.customers set affiliate_code = $1
          where id = $2 and store_id = $3 and affiliate_code is null
          returning affiliate_code`,
        [calon, member.id, storeId],
      );
      if (r.rowCount) return r.rows[0].affiliate_code;
      const ada = await db.query('select affiliate_code from public.customers where id = $1', [member.id]);
      if (ada.rows[0]?.affiliate_code) return ada.rows[0].affiliate_code;
    } catch (error) {
      if (error?.code !== '23505') throw error;
    }
  }
  throw new Error('Kode affiliate gagal dibuat.');
}

/** Affiliate pernah membeli produk itu atau varian lainnya (pesanan selesai). */
export async function sudahMembeli(db, storeId, customerId, productId) {
  const r = await db.query(
    `select 1 from public.order_items i
       join public.orders o on o.id = i.order_id
       join public.products dibeli on dibeli.id = i.product_id
       join public.products dicari on dicari.id = $3 and dicari.store_id = $1
      where o.store_id = $1 and o.customer_id = $2 and o.order_status = 'done'
        and ${sqlKunciKelompok('dibeli')} = ${sqlKunciKelompok('dicari')}
      limit 1`,
    [storeId, customerId, productId],
  );
  return r.rowCount > 0;
}

export async function produkAffiliate(db, storeId, productIds) {
  if (!productIds.length) return new Map();
  const r = await db.query(
    `select p.id, p.name, p.is_active, p.affiliate_enabled, p.affiliate_if_bought, p.affiliate_commission,
            ${sqlKunciKelompok('p')} as kunci
       from public.products p where p.store_id = $1 and p.id = any($2::uuid[])`,
    [storeId, productIds],
  );
  return new Map(r.rows.map((p) => [p.id, p]));
}

/** Barang di pesanan yang boleh menghasilkan komisi untuk affiliate itu. */
async function barangBerhak(db, storeId, affiliateId, items, produkById) {
  const hasil = [];
  for (const it of items) {
    const p = produkById.get(it.product_id);
    if (!p || !p.affiliate_enabled) continue;
    if (p.affiliate_if_bought && !(await sudahMembeli(db, storeId, affiliateId, it.product_id))) continue;
    hasil.push(it);
  }
  return hasil;
}

/** Leluhur seorang affiliate sampai 6 tingkat (tier 1 sampai 5 plus satu untuk deteksi putaran). */
async function petaLeluhur(db, storeId, mulaiId) {
  const r = await db.query(
    `with recursive r as (
       select id, referred_by, affiliate_access, user_id, 1 as lvl from public.customers where id = $1 and store_id = $2
       union all
       select c.id, c.referred_by, c.affiliate_access, c.user_id, r.lvl + 1
         from public.customers c join r on c.id = r.referred_by
        where c.store_id = $2 and r.lvl < 6
     )
     select distinct on (id) id, referred_by, affiliate_access, user_id from r`,
    [mulaiId, storeId],
  );
  return new Map(r.rows.map((x) => [x.id, x]));
}

/**
 * Atribusi pesanan toko online dan pembuatan komisinya (FR-17 sampai FR-22).
 * Dipanggil di dalam transaksi checkout, di dalam savepoint: kegagalan di sini
 * tidak boleh membatalkan pesanan.
 */
export async function catatAtribusiPesanan(db, { storeId, orderId, pembeliId, items, discount = 0, cookieHeader, rahasia }) {
  const pengaturan = await muatPengaturan(db, storeId);
  if (!pengaturan.enabled) return null;
  const pembeli = await ambilMember(db, storeId, pembeliId);
  if (!pembeli) return null;
  const cookie = cookieSah(cookieHeader, rahasia, pengaturan);
  const productIds = [...new Set(items.map((it) => it.product_id))];
  // Klik atas satu varian berlaku untuk semua varian produk itu: produk di
  // cookie yang sekelompok dengan barang pesanan ikut dianggap cocok.
  const diCookie = (Array.isArray(cookie?.p) ? cookie.p : []).map((e) => e?.[0]).filter((id) => POLA_UUID.test(String(id ?? '')));
  const produkById = await produkAffiliate(db, storeId, [...new Set([...productIds, ...diCookie])]);
  const kelompokPesanan = new Set(productIds.map((id) => produkById.get(id)?.kunci).filter(Boolean));
  const cocok = [...productIds, ...diCookie.filter((id) => kelompokPesanan.has(produkById.get(id)?.kunci))];
  const calon = pilihCalon({ pengaturan, pembeli, cookie, productIds: cocok });
  if (!calon.length) return null;

  let terpilih = null;
  let affTerpilih = null;
  let barang = [];
  for (const c of calon) {
    const aff = await ambilMember(db, storeId, c.affiliateId);
    if (!aff || !aff.user_id || aff.id === pembeli.id || !aksesBerhak(pengaturan, aff.affiliate_access)) continue;
    const boleh = await barangBerhak(db, storeId, aff.id, items, produkById);
    if (!boleh.length) continue;
    terpilih = c;
    affTerpilih = aff;
    barang = boleh;
    break;
  }
  if (!terpilih) return null;

  if (pengaturan.permanent && !pembeli.referred_by) {
    await db.query(
      `update public.customers set referred_by = $1, referred_at = now(), referral_source = 'checkout'
        where id = $2 and store_id = $3 and referred_by is null`,
      [terpilih.affiliateId, pembeli.id, storeId],
    );
  }
  await db.query(
    `update public.orders set affiliate_id = $2, affiliate_source = $3, acquisition_source = $4, acquisition_media = $5
      where id = $1`,
    [orderId, terpilih.affiliateId, terpilih.source, terpilih.acquisition.source || null, terpilih.acquisition.media || null],
  );

  // D-31: komisi khusus produk, lalu tarif affiliate yang membawa pesanan, lalu bawaan toko.
  const tierPerItem = (it) => tarifBarang(produkById.get(it.product_id), affTerpilih?.affiliate_commission, pengaturan);
  const maksTier = Math.max(...barang.map((it) => tierPerItem(it).length));
  const leluhur = await petaLeluhur(db, storeId, terpilih.affiliateId);
  const rantai = bangunRantai({
    tier1: terpilih.affiliateId,
    maksTier,
    uplineDari: (id) => leluhur.get(id)?.referred_by ?? null,
    berhak: (id) => {
      const m = leluhur.get(id);
      return !!(m && m.user_id && aksesBerhak(pengaturan, m.affiliate_access));
    },
    pembeliId: pembeli.id,
  });
  const komisi = hitungKomisi({ items: barang, discount, tierPerItem, rantai });
  for (const k of komisi) {
    await db.query(
      `insert into public.affiliate_commissions
         (store_id, order_id, order_item_id, product_id, affiliate_id, tier, base_amount, rate_type, rate_value, commission, commission_awal)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
       on conflict (order_item_id, tier) do nothing`,
      [storeId, orderId, k.order_item_id, k.product_id, k.affiliate_id, k.tier, k.base_amount, k.rate_type, k.rate_value, k.commission],
    );
  }
  if (pengaturan.email_new_order) {
    await db.query(`insert into public.affiliate_outbox (store_id, kind, ref_id) values ($1, 'pesanan_baru', $2)`, [storeId, orderId]);
  }
  return { affiliateId: terpilih.affiliateId, source: terpilih.source, komisi: komisi.length };
}

/**
 * Upline akun baru (FR-17, FR-35): affiliate umum di cookie, atau undangan
 * berlaku tertua untuk email yang sama. Dipanggil di dalam savepoint.
 */
export async function catatReferralDaftar(db, { storeId, customerId, email, cookieHeader, rahasia }) {
  await terapkanUndanganAdmin(db, { storeId, customerId, email });
  const pengaturan = await muatPengaturan(db, storeId);
  if (!pengaturan.enabled) return null;
  const cookie = cookieSah(cookieHeader, rahasia, pengaturan);
  let affiliateId = cookie?.g ?? null;
  let undanganId = cookie?.k === 'undangan' ? cookie.i ?? null : null;
  let sumber = cookie?.k === 'undangan' ? 'undangan' : 'link';
  if (!affiliateId && email) {
    const u = await db.query(
      `select id, affiliate_id from public.affiliate_invitations
        where store_id = $1 and lower(email) = lower($2) and status in ('sent', 'opened') and expires_at > now()
          and not dari_admin
        order by sent_at asc limit 1`,
      [storeId, email],
    );
    if (u.rowCount) {
      affiliateId = u.rows[0].affiliate_id;
      undanganId = u.rows[0].id;
      sumber = 'undangan';
    }
  }
  if (!affiliateId || affiliateId === customerId) return null;
  const aff = await ambilMember(db, storeId, affiliateId);
  if (!aff || !aff.user_id || !aksesBerhak(pengaturan, aff.affiliate_access)) return null;
  const r = await db.query(
    `update public.customers set referred_by = $1, referred_at = now(), referral_source = $2
      where id = $3 and store_id = $4 and referred_by is null`,
    [affiliateId, sumber, customerId, storeId],
  );
  if (undanganId) {
    await db.query(
      `update public.affiliate_invitations set status = 'registered', registered_customer_id = $2
        where id = $1 and store_id = $3 and status <> 'registered'`,
      [undanganId, customerId, storeId],
    );
  }
  return r.rowCount ? { affiliateId, sumber } : null;
}

/**
 * Undangan khusus dari admin (D-32, FR-52): pendaftar dengan email yang diundang
 * admin, selama undangannya berlaku, langsung Diizinkan dengan tarif dari
 * undangan. Berlaku juga saat program mati, supaya undangan yang sudah dikirim
 * tidak hangus.
 */
export async function terapkanUndanganAdmin(db, { storeId, customerId, email }) {
  if (!email) return null;
  const u = await db.query(
    `select id, commission from public.affiliate_invitations
      where store_id = $1 and dari_admin and lower(email) = lower($2) and status in ('sent', 'opened') and expires_at > now()
      order by sent_at desc limit 1`,
    [storeId, email],
  );
  if (!u.rowCount) return null;
  const inv = u.rows[0];
  await db.query(
    `update public.customers
        set affiliate_access = 'allowed',
            affiliate_commission = coalesce($3::jsonb, affiliate_commission)
      where id = $1 and store_id = $2`,
    [customerId, storeId, inv.commission ? JSON.stringify(inv.commission) : null],
  );
  await db.query(
    `update public.affiliate_invitations set status = 'registered', registered_customer_id = $2
      where id = $1 and store_id = $3`,
    [inv.id, customerId, storeId],
  );
  return { invitationId: inv.id };
}

// ---------------------------------------------------------------------------
// Angka

const HARI_INI = `(now() at time zone '${ZONA}')::date`;

/** Retur per pesanan, untuk omset bersih (D-39). Memakai $1 = store_id dan alias `o` untuk pesanan. */
export const RETUR_PESANAN = `left join (select order_id, sum(refund_amount) as retur from public.order_returns where store_id = $1 group by order_id) rt on rt.order_id = o.id`;
/** Omset satu pesanan: nilai barang dikurangi retur (D-39). */
export const OMSET = `(o.subtotal - o.discount - coalesce(rt.retur, 0))`;
const AWAL_BULAN = `(date_trunc('month', now() at time zone '${ZONA}') at time zone '${ZONA}')`;

/** Klik, Lead, Sales, Omset, Komisi untuk hari ini, bulan ini, sepanjang waktu (D-10). */
export async function ringkasanAffiliate(db, storeId, affiliateId) {
  const [klik, pesanan, komisi] = await Promise.all([
    db.query(
      `select count(*) filter (where (created_at at time zone '${ZONA}')::date = ${HARI_INI})::int as hari,
              count(*) filter (where created_at >= ${AWAL_BULAN})::int as bulan,
              count(*)::int as semua
         from public.affiliate_clicks where store_id = $1 and affiliate_id = $2`,
      [storeId, affiliateId],
    ),
    db.query(
      `select count(*) filter (where o.order_status <> 'canceled' and (o.created_at at time zone '${ZONA}')::date = ${HARI_INI})::int as lead_hari,
              count(*) filter (where o.order_status <> 'canceled' and o.created_at >= ${AWAL_BULAN})::int as lead_bulan,
              count(*) filter (where o.order_status <> 'canceled')::int as lead_semua,
              count(*) filter (where o.order_status = 'done' and (o.created_at at time zone '${ZONA}')::date = ${HARI_INI})::int as sales_hari,
              count(*) filter (where o.order_status = 'done' and o.created_at >= ${AWAL_BULAN})::int as sales_bulan,
              count(*) filter (where o.order_status = 'done')::int as sales_semua,
              coalesce(sum(${OMSET}) filter (where o.order_status = 'done' and (o.created_at at time zone '${ZONA}')::date = ${HARI_INI}), 0)::float8 as omset_hari,
              coalesce(sum(${OMSET}) filter (where o.order_status = 'done' and o.created_at >= ${AWAL_BULAN}), 0)::float8 as omset_bulan,
              coalesce(sum(${OMSET}) filter (where o.order_status = 'done'), 0)::float8 as omset_semua
         from public.orders o
         ${RETUR_PESANAN}
        where o.store_id = $1 and o.affiliate_id = $2`,
      [storeId, affiliateId],
    ),
    db.query(
      `select coalesce(sum(k.commission - pt.potong) filter (where (k.created_at at time zone '${ZONA}')::date = ${HARI_INI}), 0)::float8 as hari,
              coalesce(sum(k.commission - pt.potong) filter (where k.created_at >= ${AWAL_BULAN}), 0)::float8 as bulan,
              coalesce(sum(k.commission - pt.potong), 0)::float8 as semua
         from public.affiliate_commissions k
         left join lateral (
           select coalesce(sum(p.amount), 0) as potong from public.affiliate_potongan p where p.commission_id = k.id
         ) pt on true
        where k.store_id = $1 and k.affiliate_id = $2 and k.status = 'added'`,
      [storeId, affiliateId],
    ),
  ]);
  const k = klik.rows[0];
  const p = pesanan.rows[0];
  const c = komisi.rows[0];
  const periode = (a) => ({ clicks: k[a], leads: p[`lead_${a}`], sales: p[`sales_${a}`], omset: p[`omset_${a}`], commission: c[a] });
  return { today: periode('hari'), month: periode('bulan'), all: periode('semua') };
}

export async function grafikAffiliate(db, storeId, affiliateId) {
  const bulan = await db.query(
    `select to_char(d, 'YYYY-MM-DD') as key, coalesce(x.sales, 0)::int as sales, coalesce(x.omset, 0)::float8 as omset
       from generate_series(date_trunc('month', now() at time zone '${ZONA}')::date, ${HARI_INI}, interval '1 day') d
       left join (
         select (o.created_at at time zone '${ZONA}')::date as hari, count(*) as sales, sum(${OMSET}) as omset
           from public.orders o
           ${RETUR_PESANAN}
          where o.store_id = $1 and o.affiliate_id = $2 and o.order_status = 'done' and o.created_at >= ${AWAL_BULAN}
          group by 1
       ) x on x.hari = d::date
      order by d`,
    [storeId, affiliateId],
  );
  const tahun = await db.query(
    `select to_char(d, 'YYYY-MM') as key, coalesce(x.sales, 0)::int as sales, coalesce(x.omset, 0)::float8 as omset
       from generate_series(date_trunc('year', now() at time zone '${ZONA}'), date_trunc('month', now() at time zone '${ZONA}'), interval '1 month') d
       left join (
         select date_trunc('month', o.created_at at time zone '${ZONA}') as bln, count(*) as sales, sum(${OMSET}) as omset
           from public.orders o
           ${RETUR_PESANAN}
          where o.store_id = $1 and o.affiliate_id = $2 and o.order_status = 'done'
            and o.created_at >= (date_trunc('year', now() at time zone '${ZONA}') at time zone '${ZONA}')
          group by 1
       ) x on x.bln = d
      order by d`,
    [storeId, affiliateId],
  );
  return { month: bulan.rows, year: tahun.rows };
}

/** Sumber trafik: klik dan pesanan per pasangan sumber/ID (FR-39). */
export async function akuisisiAffiliate(db, storeId, affiliateId, platforms) {
  const r = await db.query(
    `with k as (
       select source, media, count(*)::int as views
         from public.affiliate_clicks where store_id = $1 and affiliate_id = $2 group by 1, 2
     ), o as (
       select coalesce(o.acquisition_source, '') as source, coalesce(o.acquisition_media, '') as media,
              count(*) filter (where o.order_status <> 'canceled')::int as leads,
              count(*) filter (where o.order_status = 'done')::int as sales,
              coalesce(sum(${OMSET}) filter (where o.order_status = 'done'), 0)::float8 as value
         from public.orders o
         ${RETUR_PESANAN}
        where o.store_id = $1 and o.affiliate_id = $2 group by 1, 2
     )
     select coalesce(k.source, o.source) as source, coalesce(k.media, o.media) as media,
            coalesce(k.views, 0) as views, coalesce(o.leads, 0) as leads, coalesce(o.sales, 0) as sales, coalesce(o.value, 0) as value
       from k full join o on k.source = o.source and k.media = o.media
      order by coalesce(k.views, 0) desc, coalesce(o.value, 0) desc
      limit 100`,
    [storeId, affiliateId],
  );
  const label = new Map(platforms.map((p) => [p.key, p.label]));
  return r.rows.map((x) => ({ ...x, label: x.source ? label.get(x.source) ?? x.source : 'Langsung' }));
}

// ---------------------------------------------------------------------------
// Bonus target bulanan (D-38)

const segarTerakhir = new Map();

/** Omset bersih per affiliate untuk pesanan Selesai yang dibuat di bulan `bulan` (YYYY-MM-01, WIB). */
async function omsetBulanan(db, storeId, bulan, affiliateId = null) {
  const r = await db.query(
    `select o.affiliate_id, coalesce(sum(${OMSET}), 0)::float8 as omset
       from public.orders o
       ${RETUR_PESANAN}
      where o.store_id = $1 and o.affiliate_id is not null and o.order_status = 'done'
        and (o.created_at at time zone '${ZONA}') >= $2::date
        and (o.created_at at time zone '${ZONA}') < ($2::date + interval '1 month')
        and ($3::uuid is null or o.affiliate_id = $3::uuid)
      group by 1`,
    [storeId, bulan, affiliateId],
  );
  return new Map(r.rows.map((x) => [x.affiliate_id, Number(x.omset)]));
}

/** Hari pertama bulan ini dan bulan lalu (WIB), sebagai teks YYYY-MM-DD. */
async function duaBulan(db) {
  const r = await db.query(
    `select to_char(date_trunc('month', now() at time zone '${ZONA}'), 'YYYY-MM-DD') as ini,
            to_char(date_trunc('month', now() at time zone '${ZONA}') - interval '1 month', 'YYYY-MM-DD') as lalu`,
  );
  return r.rows[0];
}

/**
 * Hitung ulang baris bonus bulan ini dan bulan lalu (FR-58). Baris yang sudah
 * dibayar tidak disentuh. Dibatasi sekali per 5 detik per toko kecuali `paksa`.
 */
export async function segarkanBonus(db, storeId, { paksa = false } = {}) {
  const kini = Date.now();
  if (!paksa && kini - (segarTerakhir.get(storeId) ?? 0) < 5000) return;
  segarTerakhir.set(storeId, kini);
  const pengaturan = await muatPengaturan(db, storeId);
  const { ini, lalu } = await duaBulan(db);
  for (const bulan of [lalu, ini]) {
    const omset = await omsetBulanan(db, storeId, bulan);
    const ids = [...omset.keys()];
    const anggota = ids.length
      ? await db.query('select id, user_id, affiliate_access from public.customers where store_id = $1 and id = any($2::uuid[])', [storeId, ids])
      : { rows: [] };
    const berhak = new Set(anggota.rows.filter((m) => m.user_id && aksesBerhak(pengaturan, m.affiliate_access)).map((m) => m.id));
    const dapat = [];
    for (const [affiliateId, nilai] of omset) {
      const jumlah = berhak.has(affiliateId) ? hitungBonus(nilai, pengaturan) : 0;
      if (jumlah > 0) dapat.push({ affiliateId, nilai, jumlah });
    }
    for (const d of dapat) {
      await db.query(
        `insert into public.affiliate_bonuses (store_id, affiliate_id, bulan, omset, target, rate_type, rate_value, amount, status)
         values ($1, $2, $3::date, $4, $5, $6, $7, $8, $9)
         on conflict (store_id, affiliate_id, bulan) do update
           set omset = excluded.omset, target = excluded.target, rate_type = excluded.rate_type,
               rate_value = excluded.rate_value, amount = excluded.amount, status = excluded.status, updated_at = now()
         where not public.affiliate_bonuses.paid`,
        [storeId, d.affiliateId, bulan, d.nilai, pengaturan.bonus_target, pengaturan.bonus_type, pengaturan.bonus_value, d.jumlah, bulan === ini ? 'berjalan' : 'added'],
      );
    }
    await db.query(
      `delete from public.affiliate_bonuses
        where store_id = $1 and bulan = $2::date and not paid and not (affiliate_id = any($3::uuid[]))`,
      [storeId, bulan, dapat.map((d) => d.affiliateId)],
    );
  }
}

/** Kartu target untuk ringkasan affiliate (FR-60). */
export async function targetAffiliate(db, storeId, affiliateId, pengaturan) {
  if (!pengaturan.bonus_enabled || !(Number(pengaturan.bonus_value) > 0)) return null;
  const { ini } = await duaBulan(db);
  const omset = (await omsetBulanan(db, storeId, ini, affiliateId)).get(affiliateId) ?? 0;
  const target = Number(pengaturan.bonus_target);
  return {
    bulan: ini,
    target,
    omset,
    sisa: Math.max(0, target - omset),
    tercapai: omset >= target,
    bonus_type: pengaturan.bonus_type,
    bonus_value: Number(pengaturan.bonus_value),
    bonus: hitungBonus(omset, pengaturan),
  };
}

