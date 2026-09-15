// Kolom alamat bertingkat: Provinsi → Kota/Kabupaten → Alamat lengkap.
//
// Dipakai di checkout dan di Profil & Alamat akun pembeli supaya keduanya
// menghasilkan bentuk alamat yang sama. Provinsi dan kota disimpan terpisah
// karena ongkir dihitung dari wilayah, bukan dari alamat teks bebas.
//
// Memakai <select> bawaan, bukan dropdown buatan: di HP munculnya jadi pemilih
// asli sistem yang jauh lebih enak dipakai daripada daftar panjang di layar.

import { useId } from 'react';
import { cn } from '@/lib/format';
import { PROVINSI, kotaDari } from '@/lib/wilayah';

export interface NilaiAlamat {
  provinsi: string;
  kota: string;
  alamat: string;
}

export function KolomAlamat({
  nilai,
  onChange,
  kelasKolom,
  kelasGalat,
  galat,
  label = 'Alamat Pengiriman',
  bantuan,
}: {
  nilai: NilaiAlamat;
  onChange: (v: NilaiAlamat) => void;
  /** Kelas dasar kolom, mengikuti gaya halaman pemakainya. */
  kelasKolom: string;
  kelasGalat?: string;
  galat?: { provinsi?: string; kota?: string; alamat?: string };
  label?: string;
  bantuan?: string;
}) {
  const id = useId();
  const daftarKota = kotaDari(nilai.provinsi);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-prov`} className="mb-1.5 block text-[13px] font-medium text-ink-700 dark:text-ink-300">
            Provinsi
          </label>
          <select
            id={`${id}-prov`}
            name="province"
            aria-label="Provinsi"
            value={nilai.provinsi}
            onChange={(e) => onChange({ ...nilai, provinsi: e.target.value, kota: '' })}
            className={cn(kelasKolom, galat?.provinsi && kelasGalat)}
          >
            <option value="">Pilih provinsi…</option>
            {PROVINSI.map((p) => (
              <option key={p.kode} value={p.nama}>
                {p.nama}
              </option>
            ))}
          </select>
          {galat?.provinsi && <p className="mt-1 text-xs text-rose-600">{galat.provinsi}</p>}
        </div>

        <div>
          <label htmlFor={`${id}-kota`} className="mb-1.5 block text-[13px] font-medium text-ink-700 dark:text-ink-300">
            Kota/Kabupaten
          </label>
          <select
            id={`${id}-kota`}
            name="city"
            aria-label="Kota/Kabupaten"
            value={nilai.kota}
            disabled={!nilai.provinsi}
            onChange={(e) => onChange({ ...nilai, kota: e.target.value })}
            className={cn(kelasKolom, 'disabled:cursor-not-allowed disabled:opacity-60', galat?.kota && kelasGalat)}
          >
            <option value="">{nilai.provinsi ? 'Pilih kota/kabupaten…' : 'Pilih provinsi dulu'}</option>
            {daftarKota.map((k) => (
              <option key={k.kode} value={k.nama}>
                {k.nama}
              </option>
            ))}
          </select>
          {galat?.kota && <p className="mt-1 text-xs text-rose-600">{galat.kota}</p>}
        </div>
      </div>

      <div>
        <label htmlFor={`${id}-alamat`} className="mb-1.5 block text-[13px] font-medium text-ink-700 dark:text-ink-300">
          {label}
        </label>
        <textarea
          id={`${id}-alamat`}
          name="delivery_address"
          aria-label={label}
          rows={3}
          placeholder="Jalan, nomor rumah, RT/RW, kelurahan, kecamatan, kode pos"
          value={nilai.alamat}
          onChange={(e) => onChange({ ...nilai, alamat: e.target.value })}
          className={cn(kelasKolom, 'h-auto resize-none py-2.5', galat?.alamat && kelasGalat)}
        />
        {galat?.alamat ? (
          <p className="mt-1 text-xs text-rose-600">{galat.alamat}</p>
        ) : (
          bantuan && <p className="mt-1 text-xs text-ink-500">{bantuan}</p>
        )}
      </div>
    </div>
  );
}
