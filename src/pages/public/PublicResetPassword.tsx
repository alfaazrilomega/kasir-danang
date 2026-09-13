import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { useLocation, useNavigate } from '@/lib/router';
import { cn } from '@/lib/format';
import { PUBLIC_STORE_ID } from '@/lib/config';
import { lupaSandiAturUlang, lupaSandiCekKode, lupaSandiKirimKode, useCustomer } from '@/lib/customerAccount';
import { Bidang, KOLOM_AUTH, KerangkaAuth, KolomSandi, PesanGalat, TOMBOL_AUTH, tujuanAman } from '@/components/public/KerangkaAuth';

type Langkah = 'akun' | 'kode' | 'sandi' | 'selesai';

const JUDUL: Record<Langkah, string> = {
  akun: 'Reset Kata Sandi',
  kode: 'Masukkan Kode Verifikasi',
  sandi: 'Atur Kata Sandi Baru',
  selesai: 'Kata Sandi Diperbarui',
};

/**
 * Lupa kata sandi, memakai kerangka yang sama dengan halaman masuk (penanda
 * "Langkah N dari 3", satu kolom per langkah):
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

  const langkahKe = { akun: 1, kode: 2, sandi: 3, selesai: 3 }[langkah];

  return (
    <KerangkaAuth
      label="Pemulihan Akun"
      kembali={{ to: `/toko/masuk${nextParam ? `?next=${encodeURIComponent(next)}` : ''}`, teks: 'Kembali ke Masuk' }}
    >
      {langkah !== 'selesai' && (
        <div className="flex h-8 items-center gap-1.5">
          {langkah !== 'akun' && (
            <button
              type="button"
              onClick={kembali}
              aria-label="Kembali"
              className="-ml-1.5 grid h-8 w-8 place-items-center rounded-lg text-black/55 transition-colors duration-150 hover:bg-black/[0.05] hover:text-black"
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <span className="text-xs font-medium text-brand-600">Langkah {langkahKe} dari 3</span>
        </div>
      )}
      {langkah === 'selesai' && <CheckCircle2 size={40} className="text-brand-500" />}
      <h1 className="mt-1 text-[28px] font-semibold leading-[34px] tracking-tight text-[#0b0c1a]">{JUDUL[langkah]}</h1>

      <form onSubmit={kirim} className="mt-2" noValidate>
        {langkah === 'akun' && (
          <>
            <p className="mb-5 text-sm text-black/55">
              Masukkan nomor HP atau email akun Anda. Kode verifikasi dikirim ke email akun tersebut.
            </p>
            <Bidang id="identifier" label="No. Handphone/Email" slotGalat={false}>
              <input
                id="identifier"
                aria-label="No. Handphone/Email"
                placeholder="0812xxxx atau nama@email.com"
                autoComplete="username"
                autoFocus
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className={KOLOM_AUTH}
              />
            </Bidang>
          </>
        )}

        {langkah === 'kode' && (
          <>
            <p className="mb-5 text-sm text-black/55">
              Bila <b className="font-medium text-black/75">{identifier}</b> terdaftar, kode verifikasi 6 digit sudah dikirim ke email
              akunnya. Periksa juga folder Spam.
            </p>
            <Bidang id="kode" label="Kode verifikasi" slotGalat={false}>
              <input
                id="kode"
                aria-label="Kode verifikasi"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                placeholder="••••••"
                value={kode}
                onChange={(e) => setKode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className={cn(KOLOM_AUTH, 'h-12 text-center text-lg tracking-[0.5em]')}
              />
            </Bidang>
            <div className="mt-3 text-sm text-black/55">
              {jeda > 0 ? (
                `Kirim ulang kode dalam ${jeda} detik`
              ) : (
                <button
                  type="button"
                  onClick={() => void kirimKode()}
                  disabled={busy}
                  className="font-medium text-brand-600 transition-colors duration-150 hover:text-brand-700"
                >
                  Kirim ulang kode
                </button>
              )}
            </div>
          </>
        )}

        {langkah === 'sandi' && (
          <div className="mt-3 space-y-4">
            <Bidang id="sandi-baru" label="Kata sandi baru" slotGalat={false}>
              <KolomSandi id="sandi-baru" label="Kata sandi baru" placeholder="Minimal 6 karakter" value={sandi} onChange={setSandi} autoComplete="new-password" />
            </Bidang>
            <Bidang id="sandi-ulang" label="Ulangi kata sandi baru" slotGalat={false}>
              <KolomSandi id="sandi-ulang" label="Ulangi kata sandi baru" placeholder="Ketik ulang kata sandi" value={ulang} onChange={setUlang} autoComplete="new-password" />
            </Bidang>
          </div>
        )}

        {langkah === 'selesai' && (
          <p className="text-sm text-black/55">Kata sandi akun Anda sudah diganti dan Anda sudah masuk.</p>
        )}

        <div className="mt-2">
          <PesanGalat teks={galat} />
        </div>

        {langkah === 'selesai' ? (
          <button type="button" onClick={() => navigate(next)} className={cn(TOMBOL_AUTH, 'mt-2')}>
            Lanjut Belanja
          </button>
        ) : (
          <button type="submit" disabled={busy || !siap} className={cn(TOMBOL_AUTH, 'mt-2')}>
            {busy ? 'Memproses…' : langkah === 'sandi' ? 'Simpan' : 'Berikutnya'}
          </button>
        )}
      </form>
    </KerangkaAuth>
  );
}
