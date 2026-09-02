-- Migrasi 012: Pengaturan hak akses per role, per toko.
--
-- Latar belakang:
--   Matriks kemampuan (capability) sebelumnya di-hardcode di src/lib/roles.ts
--   dan tab "Role & Permission" di halaman Users hanya bisa dibaca. Pemilik
--   toko tidak punya cara membatasi apa yang boleh diakses kasir/gudang.
--
-- Aturan penting:
--   Baris di sini hanya bisa MENGURANGI akses dari default di kode, tidak
--   pernah menambah. Server tetap memakai TABLE_ROLE_ACCESS sebagai batas
--   keras; override cuma dipakai untuk menolak lebih lanjut. Dengan begitu
--   salah konfigurasi tidak bisa menaikkan hak sebuah role.

create table if not exists public.role_permissions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  role text not null,
  capability text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create unique index if not exists role_permissions_unique_idx
  on public.role_permissions(store_id, role, capability);

create index if not exists role_permissions_store_idx
  on public.role_permissions(store_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'role_permissions_role_check') then
    alter table public.role_permissions
      add constraint role_permissions_role_check
      check (role in ('admin','warehouse','cashier','customer'));
  end if;
end $$;
