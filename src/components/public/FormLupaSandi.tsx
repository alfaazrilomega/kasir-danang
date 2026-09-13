import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/format';
import { PUBLIC_STORE_ID } from '@/lib/config';
import { lupaSandiAturUlang, lupaSandiCekKode, lupaSandiKirimKode, useCustomer } from '@/lib/customerAccount';
import { KolomApung, KolomSandi, PesanGalat, TOMBOL_AUTH } from '@/components/public/KerangkaAuth';

type Langkah = 'akun' | 'kode' | 'sandi' | 'selesai';

const JUDUL: Record<Langkah, string> = {
  akun: 'Reset Kata Sandi',
  kode: 'Masukkan Kode Verifikasi',
  sandi: 'Atur Kata Sandi Baru',
  selesai: 'Kata Sandi Diperbarui',
};

/**
 * Lupa kata sandi dalam tiga langkah, dipakai di pop-up maupun halaman penuh:
 *   1. nomor HP / email akun → kode 6 digit dikirim ke email akun
 *   2. masukkan kode (bisa kirim ulang setelah 60 detik)
 *   3. kata sandi baru → langsung masuk
 */
export function FormLupaSandi({
  idAwal = '',
  onKembaliMasuk,
  onSelesai,
}: {
  idAwal?: string;
  onKembaliMasuk: () => void;
  onSelesai: () => void;
}) {
  const masuk = useCustomer((s) => s.masuk);

  const [langkah, setLangkah] = useState<Langkah>('akun');
  const [identifier, setIdentifier] = useState(idAwal);
  const [kode, setKode] = useState('');
  const [sandi, setSandi] = useState('');
  const [ulang, setUlang] = useState('');
  const [galat, setGalat] = useState('');
  const [busy, setBusy] = useState(false);
  const [jeda, setJeda] = useState(0);

  useEffect(() => {
    if (jeda <= 0) return;
    const t = window.setTimeout(() => setJeda(jeda - 1), 1000);
    return () => window.clearTimeout(t);
  }, [jeda]);

  const pindah = (l: Langkah) => {
    setGalat('');
    setLangkah(l);
  };

  async function kirimKode() {
    setBusy(true);
    setGalat('');
    const { error } = await lupaSandiKirimKode({ store_id: PUBLIC_STORE_ID, identifier: identifier.trim() });
    setBusy(false);
    if (error) {
      setGalat(error);
      return;
    }
    setKode('');
    pindah('kode');
    setJeda(60);
  }

  async function cekKode() {
    setBusy(true);
    const { error } = await lupaSandiCekKode({ store_id: PUBLIC_STORE_ID, identifier: identifier.trim(), code: kode });
    setBusy(false);
    if (error) {
      setGalat(error);
      return;
    }
    pindah('sandi');
  }

  async function simpan() {
    if (sandi.length < 6) return setGalat('Kata sandi minimal 6 karakter.');
    if (sandi !== ulang) return setGalat('Kedua kata sandi belum sama.');
    setBusy(true);
    const { data, error } = await lupaSandiAturUlang({
      store_id: PUBLIC_STORE_ID,
      identifier: identifier.trim(),
      code: kode,
      password: sandi,
    });
    setBusy(false);
    if (error || !data) {
      setGalat(error || 'Gagal menyimpan kata sandi.');
      return;
    }
    masuk(data.token, data.me);
    pindah('selesai');
  }

  function kirim(e: FormEvent) {
    e.preventDefault();
    if (langkah === 'akun') void kirimKode();
    else if (langkah === 'kode') void cekKode();
    else if (langkah === 'sandi') void simpan();
  }

  function kembali() {
    if (langkah === 'kode') pindah('akun');
    else if (langkah === 'sandi') pindah('kode');
    else onKembaliMasuk();
  }

  const siap =
    langkah === 'akun' ? !!identifier.trim() : langkah === 'kode' ? kode.length === 6 : langkah === 'sandi' ? !!sandi && !!ulang : true;
  const langkahKe = { akun: 1, kode: 2, sandi: 3, selesai: 3 }[langkah];

  return (
    <>
      <div className="relative mt-6 flex h-9 items-center justify-center">
        {langkah !== 'selesai' && (
          <button
            type="button"
            onClick={kembali}
            aria-label="Kembali"
            className="absolute left-0 -ml-2 grid h-9 w-9 place-items-center rounded-full text-black/55 transition-colors duration-150 hover:bg-black/[0.05] hover:text-black"
          >
            <ArrowLeft size={18} />
          </button>
        )}
        {langkah === 'selesai' ? (
          <CheckCircle2 size={36} className="text-brand-600" />
        ) : (
          <span className="text-xs font-medium text-brand-600">Langkah {langkahKe} dari 3</span>
        )}
      </div>
      <h1 id="judul-auth" className="mt-2 text-center text-2xl font-semibold tracking-tight text-[#1a1a1a]">
        {JUDUL[langkah]}
      </h1>
      <p className="mt-2 text-center text-[15px] text-black/60">
        {langkah === 'akun' && 'Masukkan nomor HP atau email akun Anda. Kode verifikasi dikirim ke email akun tersebut.'}
        {langkah === 'kode' && (
          <>
            Bila <b className="font-medium text-black/80">{identifier}</b> terdaftar, kode 6 digit sudah dikirim ke email akunnya.
            Periksa juga folder Spam.
          </>
        )}
        {langkah === 'sandi' && 'Buat kata sandi baru, minimal 6 karakter.'}
        {langkah === 'selesai' && 'Kata sandi akun Anda sudah diganti dan Anda sudah masuk.'}
      </p>

      <form data-auth onSubmit={kirim} className="mt-6" noValidate>
        {langkah === 'akun' && (
          <KolomApung
            id="lupa-id"
            label="No. Handphone/Email"
            autoComplete="username"
            autoFocus
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
          />
        )}

        {langkah === 'kode' && (
          <>
            <KolomApung
              id="lupa-kode"
              label="Kode verifikasi"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              value={kode}
              onChange={(e) => setKode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="text-lg tracking-[0.5em]"
            />
            <div className="mt-3 text-sm text-black/60">
              {jeda > 0 ? (
                `Kirim ulang kode dalam ${jeda} detik`
              ) : (
                <button
                  type="button"
                  onClick={() => void kirimKode()}
                  disabled={busy}
                  className="font-semibold text-brand-600 transition-colors duration-150 hover:text-brand-700"
                >
                  Kirim ulang kode
                </button>
              )}
            </div>
          </>
        )}

        {langkah === 'sandi' && (
          <div className="space-y-4">
            <KolomSandi id="lupa-sandi-baru" label="Kata sandi baru" value={sandi} onChange={setSandi} autoComplete="new-password" />
            <KolomSandi id="lupa-sandi-ulang" label="Ulangi kata sandi baru" value={ulang} onChange={setUlang} autoComplete="new-password" />
          </div>
        )}

        <PesanGalat teks={galat} />

        {langkah === 'selesai' ? (
          <button type="button" onClick={onSelesai} className={cn(TOMBOL_AUTH, 'mt-2')}>
            Lanjut Belanja
          </button>
        ) : (
          <button type="submit" disabled={busy || !siap} className={cn(TOMBOL_AUTH, 'mt-2')}>
            {busy ? 'Memproses…' : langkah === 'sandi' ? 'Simpan' : 'Berikutnya'}
          </button>
        )}
      </form>
    </>
  );
}
