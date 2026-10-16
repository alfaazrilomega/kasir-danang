-- Batal / hapus pesanan massal dari Riwayat Transaksi (revisi 4.1 dan 6.2).
--
-- Pesanan salah input atau hasil impor yang keliru harus bisa dibatalkan atau
-- dihapus sekaligus. Stok yang sudah terpotong wajib kembali, kalau tidak angka
-- stok meleset sebanyak barang di pesanan itu.
--
-- Stok dikembalikan dari catatan stock_movements pesanan itu sendiri (netto per
-- produk), bukan dari order_items. Dengan begitu isi set, retur sebagian, dan
-- pesanan yang belum pernah memotong stok (menunggu konfirmasi) otomatis benar.
-- Pesanan yang sudah berstatus batal tidak disentuh stoknya lagi, jadi fungsi
-- ini aman dipanggil ulang.
create or replace function public.void_orders(p_store_id uuid, p_order_ids uuid[], p_delete boolean)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_mv record;
  v_count integer := 0;
begin
  for v_order in
    select id, order_number, order_status, customer_id, points_earned
    from public.orders
    where store_id = p_store_id and id = any(p_order_ids)
    for update
  loop
    if v_order.order_status <> 'canceled' then
      for v_mv in
        select product_id, sum(qty_delta) as net
        from public.stock_movements
        where ref_order_id = v_order.id and product_id is not null
        group by product_id
        having sum(qty_delta) < 0
      loop
        update public.products
          set stock_qty = stock_qty - v_mv.net
          where id = v_mv.product_id and track_stock = true;

        insert into public.stock_movements(store_id, product_id, type, qty_delta, ref_order_id, reason)
        values (p_store_id, v_mv.product_id, 'refund', -v_mv.net, v_order.id,
                case when p_delete then 'Hapus pesanan ' else 'Batal pesanan ' end || v_order.order_number);
      end loop;

      -- Poin dari pesanan yang batal ikut ditarik.
      if v_order.customer_id is not null and coalesce(v_order.points_earned, 0) > 0 then
        update public.customers
          set points = greatest(0, points - v_order.points_earned)
          where id = v_order.customer_id;

        insert into public.loyalty_transactions(store_id, customer_id, points_delta, reason, ref_order_id)
        values (p_store_id, v_order.customer_id, -v_order.points_earned,
                'Batal pesanan ' || v_order.order_number, v_order.id);
      end if;

      update public.orders set order_status = 'canceled' where id = v_order.id;
    end if;

    if p_delete then
      delete from public.orders where id = v_order.id;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
