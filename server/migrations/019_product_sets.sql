-- Produk set: satu SKU jual yang terdiri dari beberapa barang satuan.
--
-- Client menjual "Gear Set" yang isinya gear depan, gear belakang, dan rantai.
-- Barang-barang itu juga dijual satuan. Tanpa konsep set, satu barang fisik
-- harus dicatat dua kali sebagai produk berbeda, dan stoknya langsung meleset:
-- menjual satu set tidak mengurangi stok satuannya, padahal barangnya keluar
-- dari rak yang sama.
--
-- Karena itu set TIDAK punya stok sendiri. Stoknya adalah stok komponennya, dan
-- menjual satu set memotong stok tiap komponen sebanyak takarannya.

create table if not exists public.product_components (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  parent_product_id uuid not null references public.products(id) on delete cascade,
  -- Sengaja restrict: menghapus barang satuan yang masih dipakai sebuah set
  -- akan membuat set itu diam-diam kehilangan isinya.
  component_product_id uuid not null references public.products(id) on delete restrict,
  qty numeric(12,2) not null default 1 check (qty > 0),
  created_at timestamptz not null default now(),
  unique (parent_product_id, component_product_id)
);

create index if not exists product_components_store_idx
  on public.product_components(store_id, parent_product_id);
create index if not exists product_components_component_idx
  on public.product_components(component_product_id);

-- Set tidak boleh berisi set lain, dan tidak boleh berisi dirinya sendiri.
--
-- Susunan bertingkat membuat perhitungan stok harus menelusuri pohon, dan
-- lingkaran (A berisi B, B berisi A) membuatnya tidak pernah selesai. Satu
-- tingkat sudah cukup untuk gear set, dan batas ini menjaga angka stoknya tetap
-- bisa dijelaskan.
create or replace function public.guard_product_component()
returns trigger
language plpgsql
as $$
begin
  if new.parent_product_id = new.component_product_id then
    raise exception 'Produk set tidak boleh berisi dirinya sendiri.';
  end if;

  if exists (select 1 from public.product_components
              where parent_product_id = new.component_product_id) then
    raise exception 'Isi set tidak boleh berupa produk set lain.';
  end if;

  if exists (select 1 from public.product_components
              where component_product_id = new.parent_product_id) then
    raise exception 'Produk yang sudah dipakai sebagai isi set tidak bisa dijadikan set.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_product_component on public.product_components;

create trigger trg_guard_product_component
before insert or update on public.product_components
for each row
execute function public.guard_product_component();

-- Penjualan set memotong stok komponennya, bukan stok set itu sendiri.
create or replace function public.apply_order_stock(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  c record;
begin
  for r in
    select oi.product_id, oi.qty
    from public.order_items oi
    where oi.order_id = p_order_id
      and oi.product_id is not null
  loop
    if exists (select 1 from public.product_components
                where parent_product_id = r.product_id) then
      -- Produk set: yang berkurang adalah isinya.
      for c in
        select component_product_id, qty
        from public.product_components
        where parent_product_id = r.product_id
      loop
        update public.products
          set stock_qty = stock_qty - (r.qty * c.qty)
          where id = c.component_product_id and track_stock = true;

        insert into public.stock_movements(store_id, product_id, type, qty_delta, ref_order_id, reason)
        select store_id, c.component_product_id, 'sale', -(r.qty * c.qty), p_order_id,
               'POS sale (isi set)'
        from public.products where id = c.component_product_id;
      end loop;
    else
      update public.products
        set stock_qty = stock_qty - r.qty
        where id = r.product_id and track_stock = true;

      insert into public.stock_movements(store_id, product_id, type, qty_delta, ref_order_id, reason)
      select store_id, r.product_id, 'sale', -r.qty, p_order_id, 'POS sale'
      from public.products where id = r.product_id;
    end if;
  end loop;
end;
$$;
