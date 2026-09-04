-- Kunci kurs nota yang nilainya sudah terjadi.
--
-- Kurs sebuah nota adalah angka historis: begitu barangnya diterima, biaya
-- perolehannya sudah terjadi pada kurs hari itu. Begitu ada pembayaran, uang
-- yang keluar juga sudah nyata. Mengubah kursnya sesudah itu berarti menulis
-- ulang masa lalu — nilai nota bergeser tanpa ada transaksi baru.
--
-- Ini bukan hal teoretis. Memilih ulang supplier pada nota yang sudah diterima
-- membuat formulir mengambil kurs supplier HARI INI, dan penyimpanan berikutnya
-- menaikkan seluruh nilai nota. Nota $100 yang dibukukan Rp 1.600.000 berubah
-- jadi Rp 1.800.000 hanya karena kursnya bergerak.
--
-- Penjagaan ditaruh di database, bukan di layar saja, karena seluruh penulisan
-- tabel lewat satu endpoint umum: penjagaan di formulir bisa dilewati, yang di
-- sini tidak.
--
-- Sengaja MENOLAK, bukan diam-diam mengembalikan nilainya. Kalau kurs dipaksa
-- kembali sementara angka rupiahnya sudah terlanjur dihitung memakai kurs baru,
-- barisnya jadi tidak konsisten: kurs 16.000 tapi total dihitung pada 18.000.
-- Penolakan yang terlihat lebih baik daripada catatan yang diam-diam salah.

create or replace function public.guard_purchase_exchange_rate()
returns trigger
language plpgsql
as $$
begin
  if old.received_at is null and coalesce(old.paid_amount, 0) = 0 then
    return new;
  end if;

  if coalesce(new.exchange_rate, 0) is distinct from coalesce(old.exchange_rate, 0) then
    raise exception
      'Kurs nota tidak bisa diubah: barang sudah diterima atau sudah ada pembayaran.';
  end if;

  if coalesce(new.currency, '') is distinct from coalesce(old.currency, '') then
    raise exception
      'Mata uang nota tidak bisa diubah: barang sudah diterima atau sudah ada pembayaran.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_purchase_exchange_rate on public.purchases;

create trigger trg_guard_purchase_exchange_rate
before update on public.purchases
for each row
execute function public.guard_purchase_exchange_rate();
