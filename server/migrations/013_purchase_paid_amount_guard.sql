-- purchases.paid_amount adalah nilai turunan: jumlah seluruh baris
-- purchase_payments milik nota itu.
--
-- Trigger yang ada hanya memantau tabel purchase_payments, jadi nilai hasil
-- hitungannya bisa ditimpa oleh UPDATE/INSERT ke tabel purchases sendiri.
-- Halaman Pembelian mengirim `paid_amount: existing?.paid_amount ?? 0` saat
-- menyimpan nota; bila salinan lokalnya belum memuat pembayaran terbaru,
-- angka yang benar tertimpa 0. Akibatnya nota yang sudah dibayar tetap dihitung
-- penuh sebagai sisa utang di kartu supplier.
--
-- Perbaikannya di database supaya berlaku untuk semua klien, termasuk sinkronisasi.

create or replace function public.force_purchase_paid_amount()
returns trigger
language plpgsql
as $$
begin
  new.paid_amount := coalesce((
    select sum(pp.amount)
    from public.purchase_payments pp
    where pp.purchase_id = new.id
  ), 0);
  return new;
end;
$$;

drop trigger if exists purchases_force_paid_amount on public.purchases;
create trigger purchases_force_paid_amount
  before insert or update on public.purchases
  for each row execute function public.force_purchase_paid_amount();

-- Perbaiki baris yang sudah terlanjur salah.
update public.purchases p
set paid_amount = coalesce((
  select sum(pp.amount) from public.purchase_payments pp where pp.purchase_id = p.id
), 0)
where p.paid_amount is distinct from coalesce((
  select sum(pp.amount) from public.purchase_payments pp where pp.purchase_id = p.id
), 0);
