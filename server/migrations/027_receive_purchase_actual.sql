-- Terima barang dengan jumlah aktual.
--
-- Pesanan ke supplier sering tidak pas: dipesan 100, jadi 105 atau 95 setelah
-- produksi. receive_purchase lama selalu menganggap yang datang sama dengan
-- yang dipesan. Fungsi ini menerima jumlah aktual per baris, lalu:
--   - received_qty dan subtotal baris mengikuti jumlah aktual,
--   - subtotal & total nota dihitung ulang, sehingga sisa pelunasan ikut
--     jumlah yang benar-benar datang,
--   - stok bertambah sebanyak jumlah aktual.
-- qty (jumlah dipesan) tidak diubah, supaya riwayat "dipesan 100, datang 110"
-- tetap terbaca.
--
-- subtotal, diskon, pajak, dan biaya lain di nota disimpan dalam IDR,
-- sama seperti cost_price baris, jadi penjumlahan ulang tidak perlu kurs.

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
      total = s.sub - coalesce(p.discount, 0) + coalesce(p.tax, 0) + coalesce(p.other_cost, 0),
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
