// Kolom alamat bertingkat: Provinsi → Kota/Kabupaten → Kecamatan → Desa/Kelurahan.
//
// Dipakai di checkout dan di Profil & Alamat akun pembeli supaya keduanya
// menghasilkan bentuk alamat yang sama. Provinsi dan kota disimpan terpisah
// karena ongkir dihitung dari wilayah, bukan dari alamat teks bebas.
//
// Memakai <select> bawaan, bukan dropdown buatan: di HP munculnya jadi pemilih
// asli sistem yang jauh lebih enak dipakai daripada daftar panjang di layar.

import { useEffect, useId, useState } from 'react';
import { cn } from '@/lib/format';
import { PROVINSI, kotaDari, kecamatanDari, alamatLengkap, type Kecamatan } from '@/lib/wilayah';
import { ambilWilayah, type ItemWilayah, type LevelWilayah, type WilayahKirim } from '@/lib/pengirimanToko';

/**
 * Tinggi select ditentukan di sini, bukan diwarisi dari kelas kolom pemanggil:
 * halaman akun memberi kelas tanpa tinggi sehingga select-nya pernah gepeng
 * 20px. Nilainya px, bukan rem: huruf dasar aplikasi 14px, jadi h-11 hanya
 * jadi 38,5px — di bawah ambang sasaran sentuh 44px.
 */
const TINGGI_PILIH = 'h-[44px]';

export interface NilaiAlamat {
  provinsi: string;
  kota: string;
  kecamatan: string;
  kelurahan: string;
  alamat: string;
}

export function KolomAlamat({
  nilai,
  onChange,
  kelasKolom,
  kelasGalat,
  galat,
  label = 'RT/RW dan patokan rumah',
  bantuan,
}: {
  nilai: NilaiAlamat;
  onChange: (v: NilaiAlamat) => void;
  /** Kelas dasar kolom, mengikuti gaya halaman pemakainya. */
  kelasKolom: string;
  kelasGalat?: string;
  galat?: { provinsi?: string; kota?: string; kecamatan?: string; kelurahan?: string; alamat?: string };
  label?: string;
  bantuan?: string;
}) {
  const id = useId();
  const daftarKota = kotaDari(nilai.provinsi);
  const kunci = `${nilai.provinsi}/${nilai.kota}`;
  const [ulang, setUlang] = useState(0);
  const [data, setData] = useState<{ kunci: string; rows: Kecamatan[]; loading: boolean; error: boolean }>({
    kunci: '', rows: [], loading: false, error: false,
  });
  const memuat = !!nilai.kota && (data.kunci !== kunci || data.loading);
  const gagal = data.kunci === kunci && data.error;
  const daftarKecamatan = data.kunci === kunci && !data.loading ? data.rows : [];
  const daftarDesa = daftarKecamatan.find((k) => k.nama === nilai.kecamatan)?.desa ?? [];

  useEffect(() => {
    let aktif = true;
    setData({ kunci, rows: [], loading: !!nilai.kota, error: false });
    if (nilai.kota) {
      kecamatanDari(nilai.provinsi, nilai.kota).then(
        (rows) => aktif && setData({ kunci, rows, loading: false, error: rows.length === 0 }),
        () => aktif && setData({ kunci, rows: [], loading: false, error: true }),
      );
    }
    return () => { aktif = false; };
  }, [nilai.provinsi, nilai.kota, kunci, ulang]);

  useEffect(() => {
    if (data.kunci !== kunci || data.loading || data.error || !data.rows.length) return;
    const kecamatan = data.rows.find((k) => k.nama === nilai.kecamatan);
    if (nilai.kecamatan && !kecamatan) onChange({ ...nilai, kecamatan: '', kelurahan: '' });
    else if (nilai.kelurahan && !kecamatan?.desa.some((d) => d.nama === nilai.kelurahan)) {
      onChange({ ...nilai, kelurahan: '' });
    }
  }, [data, kunci, nilai, onChange]);

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
            onChange={(e) => onChange({ ...nilai, provinsi: e.target.value, kota: '', kecamatan: '', kelurahan: '' })}
            className={cn(kelasKolom, TINGGI_PILIH, galat?.provinsi && kelasGalat)}
          >
            <option value="">Pilih provinsi…</option>
            {PROVINSI.map((p) => (
              <option key={p.kode} value={p.nama}>
                {p.nama}
              </option>
            ))}
          </select>
          {galat?.provinsi && <p data-galat className="mt-1 text-xs text-rose-600">{galat.provinsi}</p>}
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
            onChange={(e) => onChange({ ...nilai, kota: e.target.value, kecamatan: '', kelurahan: '' })}
            className={cn(kelasKolom, TINGGI_PILIH, 'disabled:cursor-not-allowed disabled:opacity-60', galat?.kota && kelasGalat)}
          >
            <option value="">{nilai.provinsi ? 'Pilih kota/kabupaten…' : 'Pilih provinsi dulu'}</option>
            {daftarKota.map((k) => (
              <option key={k.kode} value={k.nama}>
                {k.nama}
              </option>
            ))}
          </select>
          {galat?.kota && <p data-galat className="mt-1 text-xs text-rose-600">{galat.kota}</p>}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-kecamatan`} className="mb-1.5 block text-[13px] font-medium text-ink-700 dark:text-ink-300">Kecamatan</label>
          <select
            id={`${id}-kecamatan`}
            name="district"
            aria-label="Kecamatan"
            value={nilai.kecamatan}
            disabled={!nilai.kota || memuat || gagal}
            onChange={(e) => onChange({ ...nilai, kecamatan: e.target.value, kelurahan: '' })}
            className={cn(kelasKolom, TINGGI_PILIH, 'disabled:cursor-not-allowed disabled:opacity-60', galat?.kecamatan && kelasGalat)}
          >
            <option value="">{!nilai.kota ? 'Pilih kota/kabupaten dulu' : memuat ? 'Memuat kecamatan…' : gagal ? 'Daftar wilayah belum tersedia' : 'Pilih kecamatan…'}</option>
            {(memuat || gagal) && nilai.kecamatan && <option value={nilai.kecamatan}>{nilai.kecamatan}</option>}
            {daftarKecamatan.map((k) => <option key={k.kode} value={k.nama}>{k.nama}</option>)}
          </select>
          {galat?.kecamatan && <p data-galat className="mt-1 text-xs text-rose-600">{galat.kecamatan}</p>}
        </div>
        <div>
          <label htmlFor={`${id}-desa`} className="mb-1.5 block text-[13px] font-medium text-ink-700 dark:text-ink-300">Desa/Kelurahan</label>
          <select
            id={`${id}-desa`}
            name="village"
            aria-label="Desa/Kelurahan"
            value={nilai.kelurahan}
            disabled={!nilai.kecamatan || memuat || gagal}
            onChange={(e) => onChange({ ...nilai, kelurahan: e.target.value })}
            className={cn(kelasKolom, TINGGI_PILIH, 'disabled:cursor-not-allowed disabled:opacity-60', galat?.kelurahan && kelasGalat)}
          >
            <option value="">{!nilai.kecamatan ? 'Pilih kecamatan dulu' : memuat ? 'Memuat desa/kelurahan…' : 'Pilih desa/kelurahan…'}</option>
            {(memuat || gagal) && nilai.kelurahan && <option value={nilai.kelurahan}>{nilai.kelurahan}</option>}
            {daftarDesa.map((d) => <option key={d.kode} value={d.nama}>{d.nama}</option>)}
          </select>
          {galat?.kelurahan && <p data-galat className="mt-1 text-xs text-rose-600">{galat.kelurahan}</p>}
        </div>
      </div>
      {gagal && (
        <p role="alert" className="text-xs text-rose-600">
          Daftar wilayah gagal dimuat. Periksa koneksi lalu{' '}
          <button type="button" className="font-semibold underline" onClick={() => setUlang((v) => v + 1)}>coba lagi</button>.
        </p>
      )}

      <div>
        <label htmlFor={`${id}-alamat`} className="mb-1.5 block text-[13px] font-medium text-ink-700 dark:text-ink-300">
          {label}
        </label>
        <textarea
          id={`${id}-alamat`}
          name="delivery_address"
          aria-label={label}
          rows={3}
          placeholder="Contoh: RT 003/RW 005, rumah pagar hijau dekat masjid"
          value={nilai.alamat}
          onChange={(e) => onChange({ ...nilai, alamat: e.target.value })}
          className={cn(kelasKolom, 'h-auto resize-none py-2.5', galat?.alamat && kelasGalat)}
        />
        {galat?.alamat ? (
          <p data-galat className="mt-1 text-xs text-rose-600">{galat.alamat}</p>
        ) : (
          bantuan && <p className="mt-1 text-xs text-ink-500">{bantuan}</p>
        )}
      </div>
      <p className="text-xs text-ink-500">Cukup isi RT/RW dan patokan rumah. Nama jalan atau nomor rumah boleh ditambahkan agar mudah ditemukan.</p>
      {nilai.kelurahan && nilai.alamat.trim() && (
        <div className="rounded-lg bg-ink-50 p-3 text-sm dark:bg-ink-900">
          <div className="mb-1 text-xs font-medium text-ink-500">Alamat pengiriman lengkap</div>
          {alamatLengkap(nilai)}
        </div>
      )}
    </div>
  );
}

/**
 * Alamat bertingkat versi KiriminAja (spec 0002, AC-9): Provinsi, Kota,
 * Kecamatan, Kelurahan dengan ID resmi KiriminAja, karena ongkir dihitung dari
 * ID kecamatan dan kelurahan. Dipakai checkout hanya saat KiriminAja aktif.
 */
export function KolomAlamatKirim({
  wilayah,
  onWilayah,
  alamat,
  onAlamat,
  kelasKolom,
  kelasGalat,
  galat,
}: {
  wilayah: WilayahKirim;
  onWilayah: (w: WilayahKirim) => void;
  alamat: string;
  onAlamat: (v: string) => void;
  kelasKolom: string;
  kelasGalat?: string;
  galat?: { provinsi?: string; kota?: string; kecamatan?: string; kelurahan?: string; alamat?: string };
}) {
  const id = useId();
  const [daftar, setDaftar] = useState<Record<LevelWilayah, ItemWilayah[]>>({ provinsi: [], kota: [], kecamatan: [], kelurahan: [] });
  const [memuat, setMemuat] = useState<LevelWilayah | null>(null);
  const [gagal, setGagal] = useState<string | null>(null);
  const [ulang, setUlang] = useState(0);

  // Tiap tingkat dimuat setelah induknya dipilih; daftar yang sama tersimpan di pengirimanToko.
  const induk: Record<LevelWilayah, number | null | undefined> = {
    provinsi: undefined, kota: wilayah.provinsi_id, kecamatan: wilayah.kota_id, kelurahan: wilayah.kecamatan_id,
  };
  useEffect(() => {
    let hidup = true;
    (async () => {
      for (const level of TINGKAT) {
        const ind = induk[level];
        if (ind === null) { setDaftar((d) => (d[level].length ? { ...d, [level]: [] } : d)); continue; }
        setMemuat(level);
        try {
          const { items } = await ambilWilayah(level, ind);
          if (!hidup) return;
          setDaftar((d) => ({ ...d, [level]: items }));
          setGagal(null);
        } catch (error) {
          if (hidup) setGagal(error instanceof Error ? error.message : 'Daftar wilayah belum dapat dimuat.');
          break;
        }
      }
      if (hidup) setMemuat(null);
    })();
    return () => { hidup = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wilayah.provinsi_id, wilayah.kota_id, wilayah.kecamatan_id, ulang]);

  function pilih(level: LevelWilayah, nilaiId: string) {
    const item = daftar[level].find((x) => String(x.id) === nilaiId);
    const urutan = TINGKAT.indexOf(level);
    const baru: WilayahKirim = { ...wilayah, [`${level}_id`]: item?.id ?? null, [level]: item?.nama ?? '' };
    // Mengganti satu tingkat mengosongkan tingkat di bawahnya.
    for (const bawah of TINGKAT.slice(urutan + 1)) Object.assign(baru, { [`${bawah}_id`]: null, [bawah]: '' });
    onWilayah(baru);
  }

  const LABEL: Record<LevelWilayah, [string, string]> = {
    provinsi: ['Provinsi', 'Pilih provinsi…'],
    kota: ['Kota/Kabupaten', 'Pilih kota/kabupaten…'],
    kecamatan: ['Kecamatan', 'Pilih kecamatan…'],
    kelurahan: ['Kelurahan/Desa', 'Pilih kelurahan/desa…'],
  };

  return (
    <div className="space-y-3" data-alamat-kiriminaja>
      {gagal && (
        <div role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          {gagal}{' '}
          <button type="button" onClick={() => setUlang((n) => n + 1)} className="font-semibold underline">Coba lagi</button>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {TINGKAT.map((level, i) => {
          const atas = i > 0 ? TINGKAT[i - 1] : null;
          const terkunci = !!atas && !wilayah[`${atas}_id` as const];
          const pesan = galat?.[level];
          return (
            <div key={level}>
              <label htmlFor={`${id}-${level}`} className="mb-1.5 block text-[13px] font-medium text-ink-700 dark:text-ink-300">
                {LABEL[level][0]}
              </label>
              <select
                id={`${id}-${level}`}
                name={`wilayah_${level}`}
                aria-label={LABEL[level][0]}
                value={wilayah[`${level}_id` as const] ? String(wilayah[`${level}_id` as const]) : ''}
                disabled={terkunci}
                onChange={(e) => pilih(level, e.target.value)}
                className={cn(kelasKolom, TINGGI_PILIH, 'disabled:cursor-not-allowed disabled:opacity-60', pesan && kelasGalat)}
              >
                <option value="">
                  {terkunci ? `Pilih ${LABEL[atas!][0].toLowerCase()} dulu` : memuat === level ? 'Memuat…' : LABEL[level][1]}
                </option>
                {/* Pilihan tersimpan tetap tampil walau daftarnya belum termuat. */}
                {wilayah[`${level}_id` as const] && !daftar[level].some((x) => x.id === wilayah[`${level}_id` as const]) && (
                  <option value={String(wilayah[`${level}_id` as const])}>{wilayah[level]}</option>
                )}
                {daftar[level].map((x) => (
                  <option key={x.id} value={String(x.id)}>{x.nama}</option>
                ))}
              </select>
              {pesan && <p data-galat className="mt-1 text-xs text-rose-600">{pesan}</p>}
            </div>
          );
        })}
      </div>

      <div>
        <label htmlFor={`${id}-alamat`} className="mb-1.5 block text-[13px] font-medium text-ink-700 dark:text-ink-300">
          RT/RW dan patokan rumah
        </label>
        <textarea
          id={`${id}-alamat`}
          name="delivery_address"
          aria-label="RT/RW dan patokan rumah"
          rows={3}
          placeholder="Contoh: RT 003/RW 005, rumah pagar hijau dekat masjid"
          value={alamat}
          onChange={(e) => onAlamat(e.target.value)}
          className={cn(kelasKolom, 'h-auto resize-none py-2.5', galat?.alamat && kelasGalat)}
        />
        {galat?.alamat && <p data-galat className="mt-1 text-xs text-rose-600">{galat.alamat}</p>}
        <p className="mt-1 text-xs text-ink-500">Cukup isi RT/RW dan patokan rumah. Nama jalan atau nomor rumah boleh ditambahkan.</p>
      </div>
      {wilayah.kelurahan && alamat.trim() && (
        <div className="rounded-lg bg-ink-50 p-3 text-sm dark:bg-ink-900">
          <div className="mb-1 text-xs font-medium text-ink-500">Alamat pengiriman lengkap</div>
          {alamatLengkap({ ...wilayah, alamat })}
        </div>
      )}
    </div>
  );
}

const TINGKAT: LevelWilayah[] = ['provinsi', 'kota', 'kecamatan', 'kelurahan'];
