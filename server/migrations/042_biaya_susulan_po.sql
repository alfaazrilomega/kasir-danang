-- Biaya susulan PO (butir 13 PERMINTAAN-CLIENT.md) dan perbaikan total nota
-- saat barang diterima.
--
-- 1. receive_purchase_actual (027) menghitung ulang total nota tanpa
--    extra_cost. Kolom itu baru ada sejak 039 ("Biaya tambahan"), dan fungsi
--    ini tidak ikut diperbarui, jadi begitu barang diterima total nota dan
--    sisa pelunasan berkurang sebesar Biaya tambahan.
--
-- 2. Biaya susulan adalah baris expenses yang ditempel ke nota dari layar
--    Pengeluaran: purchase_id terisi, purchase_cost_slot kosong. Uangnya
--    benar-benar keluar (ongkir kontainer, gudang, kemasan), jadi menghapus
--    nota tidak boleh ikut menghapusnya seperti ON DELETE CASCADE pada baris
--    otomatis dari form nota. Pemicu ini melepasnya dulu sebelum nota hilang.

create or replace function public.receive_purchase_actual(p_purchase_id uuid, p_items jsonb)
returns void
language plpgsql
as $$
declare
  v_store uuid;
  v_received timestamptz;
  v_invoice text;
  v_qty numeric;
  item record;
begin
  select store_id, received_at, invoice_number
    into v_store, v_received, v_invoice
  from public.purchases
  where id = p_purchase_id
  for update;

  if v_store is null then
    raise exception 'Nota pembelian tidak ditemukan';
  end if;
  if v_received is not null then
    raise exception 'Barang nota ini sudah diterima';
  end if;

  for item in
    select id, product_id, qty, cost_price
    from public.purchase_items
    where purchase_id = p_purchase_id
  loop
    -- Baris yang tidak dikirim dianggap datang sesuai jumlah pesanan.
    v_qty := null;
    select (e->>'qty')::numeric into v_qty
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
    where (e->>'id')::uuid = item.id;
    if v_qty is null then
      v_qty := item.qty;
    end if;
    if v_qty < 0 then
      raise exception 'Jumlah diterima tidak boleh negatif';
    end if;

    update public.purchase_items
    set received_qty = v_qty,
        subtotal = v_qty * cost_price
    where id = item.id;

    if item.product_id is null or v_qty = 0 then
      continue;
    end if;

    update public.products
    set stock_qty = case when track_stock then coalesce(stock_qty, 0) + v_qty else stock_qty end,
        cost_price = case when item.cost_price > 0 then item.cost_price else cost_price end
    where id = item.product_id;

    insert into public.stock_movements(store_id, product_id, type, qty_delta, reason)
    values (
      v_store,
      item.product_id,
      'restock',
      v_qty,
      concat('Pembelian ', coalesce(v_invoice, ''),
             case when v_qty <> item.qty then concat(' (dipesan ', item.qty, ', diterima ', v_qty, ')') else '' end)
    );
  end loop;

  update public.purchases p
  set subtotal = s.sub,
      total = s.sub - coalesce(p.discount, 0) + coalesce(p.tax, 0)
              + coalesce(p.other_cost, 0) + coalesce(p.extra_cost, 0),
      received_at = now(),
      status = 'received'
  from (
    select coalesce(sum(subtotal), 0) as sub
    from public.purchase_items
    where purchase_id = p_purchase_id
  ) s
  where p.id = p_purchase_id;
end;
$$;

create or replace function public.lepas_biaya_susulan_nota()
returns trigger
language plpgsql
as $$
begin
  update public.expenses
     set purchase_id = null
   where purchase_id = old.id
     and purchase_cost_slot is null;
  return old;
end;
$$;

create or replace trigger purchases_lepas_biaya_susulan
  before delete on public.purchases
  for each row execute function public.lepas_biaya_susulan_nota();
