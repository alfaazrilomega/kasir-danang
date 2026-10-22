-- Permintaan 20 (15 Okt 2026): alamat halaman produk dari nama produk,
-- /toko/produk/{slug}, bukan /toko/produk?id={uuid}. Aman diulang.
--
-- Satu slug per kelompok varian. Kelompok mengikuti toko online: SKU Induk
-- kalau ada, nama produk untuk data lama (kunciKelompok di publicCatalog.ts).
-- Slug dibuat sekali dari nama saat produk dibuat dan tidak berubah sendiri
-- ketika nama diganti, supaya link yang sudah tersebar tidak putus. Admin bisa
-- mengubahnya manual; perubahan itu berlaku untuk semua varian sekelompok.

alter table public.products add column if not exists slug text;
create index if not exists products_slug_idx on public.products (store_id, slug);

-- "Gear Set Yamaha Fiz R / RX King" -> "gear-set-yamaha-fiz-r-rx-king".
create or replace function public.slug_dari_teks(p text) returns text
language sql immutable as $$
  select coalesce(
    nullif(trim(both '-' from regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '-', 'g')), ''),
    'produk'
  )
$$;

create or replace function public.kunci_kelompok_produk(p_parent text, p_name text) returns text
language sql immutable as $$
  select case
    when nullif(btrim(coalesce(p_parent, '')), '') is not null then 'induk:' || lower(btrim(p_parent))
    else 'nama:' || lower(btrim(coalesce(p_name, '')))
  end
$$;

-- Slug yang belum dipakai kelompok lain di toko yang sama: dasar, dasar-2, ...
create or replace function public.slug_unik_produk(p_store uuid, p_dasar text, p_kunci text) returns text
language plpgsql as $$
declare
  calon text := p_dasar;
  n int := 1;
begin
  loop
    exit when not exists (
      select 1 from public.products
       where store_id = p_store and slug = calon
         and public.kunci_kelompok_produk(parent_sku, name) <> p_kunci
    );
    n := n + 1;
    calon := p_dasar || '-' || n;
  end loop;
  return calon;
end $$;

-- Isi slug produk lama, kelompok tertua lebih dulu (dialah yang mendapat slug tanpa angka).
do $$
declare
  g record;
begin
  for g in
    select store_id, public.kunci_kelompok_produk(parent_sku, name) as kunci,
           (array_agg(name order by created_at, id))[1] as nama
      from public.products
     where slug is null
     group by 1, 2
     order by min(created_at), 2
  loop
    update public.products
       set slug = coalesce(
             (select s.slug from public.products s
               where s.store_id = g.store_id and s.slug is not null
                 and public.kunci_kelompok_produk(s.parent_sku, s.name) = g.kunci
               limit 1),
             public.slug_unik_produk(g.store_id, public.slug_dari_teks(g.nama), g.kunci))
     where store_id = g.store_id and slug is null
       and public.kunci_kelompok_produk(parent_sku, name) = g.kunci;
  end loop;
end $$;

-- Produk baru: ikut slug kelompoknya, atau dibuat dari nama. Slug kiriman yang
-- bentrok dengan kelompok lain (misalnya hasil Duplikat produk) diganti otomatis.
-- Ubahan manual admin dirapikan, ditolak kalau sudah dipakai kelompok lain.
create or replace function public.products_isi_slug() returns trigger
language plpgsql as $$
declare
  kunci text := public.kunci_kelompok_produk(new.parent_sku, new.name);
  bentrok boolean;
begin
  if tg_op = 'UPDATE' and new.slug is not distinct from old.slug and new.slug is not null then
    return new;
  end if;
  if nullif(btrim(coalesce(new.slug, '')), '') is not null then
    new.slug := public.slug_dari_teks(new.slug);
    bentrok := exists (
      select 1 from public.products
       where store_id = new.store_id and slug = new.slug and id <> new.id
         and public.kunci_kelompok_produk(parent_sku, name) <> kunci
    );
    if not bentrok then
      return new;
    end if;
    if tg_op = 'UPDATE' then
      raise exception 'Alamat produk "%" sudah dipakai produk lain.', new.slug using errcode = '23505';
    end if;
  end if;
  new.slug := (
    select s.slug from public.products s
     where s.store_id = new.store_id and s.slug is not null and s.id <> new.id
       and public.kunci_kelompok_produk(s.parent_sku, s.name) = kunci
     limit 1
  );
  if new.slug is null then
    new.slug := public.slug_unik_produk(new.store_id, public.slug_dari_teks(new.name), kunci);
  end if;
  return new;
end $$;

create or replace trigger products_isi_slug
  before insert or update of slug on public.products
  for each row execute function public.products_isi_slug();

-- Ubahan slug manual berlaku untuk semua varian sekelompok.
create or replace function public.products_sebar_slug() returns trigger
language plpgsql as $$
begin
  if pg_trigger_depth() > 1 or new.slug is not distinct from old.slug then
    return null;
  end if;
  update public.products
     set slug = new.slug
   where store_id = new.store_id and id <> new.id
     and public.kunci_kelompok_produk(parent_sku, name) = public.kunci_kelompok_produk(new.parent_sku, new.name)
     and slug is distinct from new.slug;
  return null;
end $$;

create or replace trigger products_sebar_slug
  after update of slug on public.products
  for each row execute function public.products_sebar_slug();
