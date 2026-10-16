-- Migrasi 011: Stock Opname (perhitungan stok fisik) dengan posting selisih.
--
-- Latar belakang:
--   Menu "Stock Opname" sebelumnya hanya menampilkan 10 produk dengan stok
--   menipis dan mengarahkan ke halaman Produk. Tidak ada lembar hitung, tidak
--   ada pencatatan selisih, dan tidak ada penyesuaian stok — jadi bukan opname.
--
-- Alur:
--   1. Buat sesi opname (status 'draft') berisi stok sistem saat itu.
--   2. Petugas mengisi hasil hitung fisik per produk.
--   3. Posting: selisih ditulis ke stock_movements ('adjust') dan
--      products.stock_qty disamakan dengan hasil hitung fisik.
--   Posting dijalankan lewat fungsi database supaya atomik dan tidak bisa
--   dijalankan dua kali (idempoten lewat posted_at).

create table if not exists public.stock_opnames (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  status text not null default 'draft',
  note text,
  counted_by uuid references public.profiles(id) on delete set null,
  started_at timestamptz not null default now(),
  posted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists stock_opnames_store_status_idx
  on public.stock_opnames(store_id, status, started_at desc);

create table if not exists public.stock_opname_items (
  id uuid primary key default gen_random_uuid(),
  opname_id uuid not null references public.stock_opnames(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  -- Stok menurut sistem saat sesi dibuat; dibekukan supaya selisih tetap
  -- bermakna walau ada penjualan setelahnya.
  system_qty numeric(12,2) not null default 0,
  counted_qty numeric(12,2),
  note text
);

create index if not exists stock_opname_items_opname_idx
  on public.stock_opname_items(opname_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stock_opnames_status_check') then
    alter table public.stock_opnames
      add constraint stock_opnames_status_check
      check (status in ('draft','posted','canceled'));
  end if;
end $$;

-- Posting opname: tulis mutasi 'adjust' untuk tiap selisih, samakan stok.
create or replace function public.post_stock_opname(p_opname_id uuid)
returns void
language plpgsql
as $$
declare
  v_store uuid;
  v_posted timestamptz;
  v_status text;
  item record;
  v_delta numeric(12,2);
begin
  select store_id, posted_at, status
    into v_store, v_posted, v_status
  from public.stock_opnames
  where id = p_opname_id
  for update;

  if v_store is null then
    raise exception 'Sesi opname tidak ditemukan';
  end if;
  if v_posted is not null then
    return; -- idempoten: sudah pernah diposting
  end if;
  if v_status = 'canceled' then
    raise exception 'Sesi opname sudah dibatalkan';
  end if;

  for item in
    select i.product_id, i.system_qty, i.counted_qty
    from public.stock_opname_items i
    join public.products p on p.id = i.product_id
    where i.opname_id = p_opname_id
      and i.counted_qty is not null
      and p.track_stock
  loop
    v_delta := item.counted_qty - item.system_qty;
    if v_delta <> 0 then
      insert into public.stock_movements(
        store_id, product_id, type, qty_delta, reason, created_at
      )
      values (
        v_store, item.product_id, 'adjust', v_delta,
        'Stock opname ' || p_opname_id::text, now()
      );
    end if;

    -- Stok disamakan dengan hasil hitung fisik, bukan ditambah delta, supaya
    -- hasil akhir persis sama dengan yang dihitung petugas.
    update public.products
       set stock_qty = item.counted_qty
     where id = item.product_id;
  end loop;

  update public.stock_opnames
     set posted_at = now(), status = 'posted'
   where id = p_opname_id;
end;
$$;
