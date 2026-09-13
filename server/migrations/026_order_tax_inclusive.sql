-- Pajak yang sudah termasuk di harga jual.
--
-- Client menjual dengan harga tayang yang sudah termasuk pajak (mis. 150rb
-- sudah termasuk pajak 10%). Sebelumnya pajak selalu DITAMBAHKAN di atas
-- harga, sehingga pembeli ditagih 165rb. Mode pajak dicatat per pesanan, bukan
-- dibaca dari pengaturan toko saat mencetak: pengaturan bisa berubah, dan
-- cetak ulang pesanan lama harus tetap sama dengan saat transaksi.

alter table public.orders
  add column if not exists tax_inclusive boolean not null default false;
