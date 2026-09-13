import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { useLocation, useNavigate } from '@/lib/router';
import { cn } from '@/lib/format';
import { PUBLIC_STORE_ID } from '@/lib/config';
import { lupaSandiAturUlang, lupaSandiCekKode, lupaSandiKirimKode, useCustomer } from '@/lib/customerAccount';
import { KOLOM_AUTH, KartuAuth, KerangkaAuth, KolomSandi, PesanGalat, TOMBOL_AUTH, tujuanAman } from '@/components/public/KerangkaAuth';

type Langkah = 'akun' | 'kode' | 'sandi' | 'selesai';

const JUDUL: Record<Langkah, string> = {
  akun: 'Reset Kata Sandi',
  kode: 'Masukkan Kode Verifikasi',
  sandi: 'Atur Kata Sandi Baru',
  selesai: 'Kata Sandi Diperbarui',
};

/**
 * Lupa kata sandi, susunan halaman Reset Password Shopee (kartu di tengah,
 * panah kembali, satu kolom + BERIKUTNYA):
 *   1. nomor HP / email akun → kode 6 digit dikirim ke email akun
 *   2. masukkan kode (bisa kirim ulang setelah 60 detik)
 *   3. kata sandi baru → langsung masuk
 */
export function PublicResetPassword() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const nextParam = params.get('next');
  const next = tujuanAman(nextParam);
  const masuk = useCustomer((s) => s.masuk);

  const [langkah, setLangkah] = useState<Langkah>('akun');
  const [identifier, setIdentifier] = useState(params.get('id') ?? '');
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
    else navigate(`/toko/masuk${nextParam ? `?next=${encodeURIComponent(next)}` : ''}`);
  }

  const siap =
    langkah === 'akun' ? !!identifier.trim() : langkah === 'kode' ? kode.length === 6 : langkah === 'sandi' ? !!sandi && !!ulang : true;

  return (
    <KerangkaAuth panelMerek={false}>
      <KartuAuth lebar="max-w-[500px]">
        <div className="relative flex h-14 items-center justify-center">
          {langkah !== 'selesai' && (
            <button
              type="button"
              onClick={kembali}
              aria-label="Kembali"
              className="absolute left-0 grid h-10 w-10 place-items-center text-brand-600 transition-colors duration-150 hover:text-brand-800"
            >
              <ArrowLeft size={24} />
            </button>
          )}
          <h1 className="text-xl text-black/80 dark:text-ink-100">{JUDUL[langkah]}</h1>
        </div>

        <form onSubmit={kirim} className="mx-auto mt-6 w-full max-w-[340px]" noValidate>
          {langkah === 'akun' && (
            <>
              <p className="mb-4 text-center text-sm text-black/55 dark:text-ink-400">
                Masukkan nomor HP atau email akunmu. Kode verifikasi dikirim ke email akun tersebut.
              </p>
              <input
                aria-label="No. Handphone/Email"
                placeholder="No. Handphone/Email"
                autoComplete="username"
                autoFocus
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className={KOLOM_AUTH}
              />
            </>
          )}

          {langkah === 'kode' && (
            <>
              <p className="mb-4 text-center text-sm text-black/55 dark:text-ink-400">
                Bila <b className="font-medium text-black/75 dark:text-ink-200">{identifier}</b> terdaftar, kode verifikasi 6 digit
                sudah dikirim ke email akunnya. Periksa juga folder Spam.
              </p>
              <input
                aria-label="Kode verifikasi"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                placeholder="••••••"
                value={kode}
                onChange={(e) => setKode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className={cn(KOLOM_AUTH, 'text-center text-lg tracking-[0.6em]')}
              />
              <div className="mt-3 text-center text-sm text-black/55 dark:text-ink-400">
                {jeda > 0 ? (
                  `Kirim ulang kode dalam ${jeda} detik`
                ) : (
                  <button
                    type="button"
                    onClick={() => void kirimKode()}
                    disabled={busy}
                    className="text-brand-600 transition-colors duration-150 hover:text-brand-800"
                  >
                    Kirim ulang kode
                  </button>
                )}
              </div>
            </>
          )}

          {langkah === 'sandi' && (
            <div className="space-y-4">
              <KolomSandi label="Kata sandi baru" value={sandi} onChange={setSandi} autoComplete="new-password" />
              <KolomSandi label="Ulangi kata sandi baru" value={ulang} onChange={setUlang} autoComplete="new-password" />
              <p className="text-xs text-black/45 dark:text-ink-400">Minimal 6 karakter.</p>
            </div>
          )}

          {langkah === 'selesai' && (
            <div className="flex flex-col items-center text-center">
              <span className="grid h-16 w-16 place-items-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10">
                <CheckCircle2 size={36} />
              </span>
              <p className="mt-4 text-sm text-black/65 dark:text-ink-300">Kata sandi akunmu sudah diganti dan kamu sudah masuk.</p>
            </div>
          )}

          <PesanGalat teks={galat} />

          {langkah === 'selesai' ? (
            <button type="button" onClick={() => navigate(next)} className={TOMBOL_AUTH}>
              Lanjut Belanja
            </button>
          ) : (
            <button type="submit" disabled={busy || !siap} className={TOMBOL_AUTH}>
              {busy ? 'Memproses…' : langkah === 'sandi' ? 'Simpan' : 'Berikutnya'}
            </button>
          )}
        </form>
      </KartuAuth>
    </KerangkaAuth>
  );
}
