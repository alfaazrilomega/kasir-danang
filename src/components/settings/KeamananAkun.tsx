import { useEffect, useState } from 'react';
import { Copy, KeyRound, ShieldCheck, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/format';
import { mfaApi, type StatusMfa } from '@/lib/mfa';

/** Kunci rahasia dibagi per 4 huruf supaya mudah diketik ke aplikasi authenticator. */
function kelompokkan(rahasia: string) {
  return rahasia.match(/.{1,4}/g)?.join(' ') ?? rahasia;
}

/**
 * Verifikasi dua langkah akun staf yang sedang masuk (TOTP). Setelah aktif,
 * masuk butuh sandi + kode 6 angka dari aplikasi authenticator.
 */
export function KeamananAkun() {
  const [status, setStatus] = useState<StatusMfa | null>(null);
  const [pasang, setPasang] = useState<{ secret: string; otpauth: string } | null>(null);
  const [kodePemulihan, setKodePemulihan] = useState<string[] | null>(null);
  const [kode, setKode] = useState('');
  const [sandi, setSandi] = useState('');
  const [matikan, setMatikan] = useState(false);
  const [sibuk, setSibuk] = useState(false);

  const muat = async () => {
    const r = await mfaApi.status();
    if (r.error) toast.error(r.error);
    setStatus(r.data);
  };
  useEffect(() => {
    void muat();
  }, []);

  if (!status?.available) return null;

  async function mulai() {
    setSibuk(true);
    const r = await mfaApi.setup();
    setSibuk(false);
    if (r.error || !r.data) return void toast.error(r.error || 'Gagal memulai.');
    setPasang(r.data);
    setKode('');
  }

  async function aktifkan() {
    setSibuk(true);
    const r = await mfaApi.enable(kode);
    setSibuk(false);
    if (r.error || !r.data) return void toast.error(r.error || 'Kode salah.');
    setPasang(null);
    setKode('');
    setKodePemulihan(r.data.recovery_codes);
    // Status diperbarui seketika: tanpa ini kartu sempat menulis "Belum aktif"
    // dan menawarkan tombol aktifkan di samping kode pemulihan.
    setStatus((s) => (s ? { ...s, enabled: true, recovery_left: r.data!.recovery_codes.length } : s));
  }

  async function nonaktifkan() {
    setSibuk(true);
    const r = await mfaApi.disable(sandi, kode);
    setSibuk(false);
    if (r.error) return void toast.error(r.error);
    toast.success('Verifikasi dua langkah dimatikan.');
    setMatikan(false);
    setSandi('');
    setKode('');
    setStatus((s) => (s ? { ...s, enabled: false, recovery_left: 0 } : s));
  }

  const salin = async (teks: string, pesan: string) => {
    try {
      await navigator.clipboard.writeText(teks);
      toast.success(pesan);
    } catch {
      toast.error('Gagal menyalin. Salin manual.');
    }
  };

  return (
    <Card id="section-keamanan-akun" className="p-5 scroll-mt-4" data-keamanan-akun>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/40">
            <ShieldCheck size={15} />
          </span>
          <div>
            <h2 className="font-semibold">Verifikasi dua langkah</h2>
            <p className="text-xs text-ink-500">Masuk akun ini butuh sandi dan kode 6 angka dari aplikasi authenticator di ponsel.</p>
          </div>
        </div>
        <span
          className={cn(
            'inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
            status.enabled
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
              : 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200',
          )}
        >
          {status.enabled ? 'Aktif' : 'Belum aktif'}
        </span>
      </div>

      {kodePemulihan && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100" data-kode-pemulihan>
          <p className="font-semibold">Simpan kode pemulihan ini sekarang. Kode hanya tampil sekali.</p>
          <p className="mt-1 text-xs">Tiap kode bisa dipakai satu kali untuk masuk kalau ponsel hilang.</p>
          <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm sm:grid-cols-4">
            {kodePemulihan.map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" className="min-h-[44px] sm:min-h-0" onClick={() => void salin(kodePemulihan.join('\n'), 'Kode pemulihan disalin.')}>
              <Copy size={14} /> Salin semua
            </Button>
            <Button className="min-h-[44px] sm:min-h-0" onClick={() => setKodePemulihan(null)}>
              Sudah saya simpan
            </Button>
          </div>
        </div>
      )}

      {!status.enabled && !pasang && (
        <Button onClick={() => void mulai()} disabled={sibuk} className="min-h-[44px] sm:min-h-0">
          <Smartphone size={14} /> Aktifkan verifikasi dua langkah
        </Button>
      )}

      {pasang && (
        <ol className="space-y-4 text-sm" data-pasang-mfa>
          <li>
            <div className="font-medium">1. Pasang aplikasi authenticator di ponsel</div>
            <p className="text-xs text-ink-500">Google Authenticator, Microsoft Authenticator, atau sejenisnya.</p>
          </li>
          <li>
            <div className="font-medium">2. Tambahkan akun dengan kunci ini</div>
            <p className="text-xs text-ink-500">Pilih "Masukkan kunci penyiapan", jenis berbasis waktu. Di ponsel bisa langsung lewat tombol buka.</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="rounded-lg bg-ink-100 px-3 py-2 font-mono text-[13px] tracking-wider dark:bg-ink-800" data-kunci-mfa>
                {kelompokkan(pasang.secret)}
              </code>
              <Button variant="secondary" className="min-h-[44px] sm:min-h-0" onClick={() => void salin(pasang.secret, 'Kunci disalin.')}>
                <Copy size={14} /> Salin kunci
              </Button>
              <a href={pasang.otpauth} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-brand-600 sm:min-h-0">
                <KeyRound size={14} /> Buka di aplikasi
              </a>
            </div>
          </li>
          <li>
            <div className="font-medium">3. Masukkan kode 6 angka yang muncul</div>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <div className="w-40">
                <Input name="kode-pasang-mfa" label="Kode" inputMode="numeric" autoComplete="one-time-code" value={kode} onChange={(e) => setKode(e.target.value)} placeholder="123456" />
              </div>
              <Button onClick={() => void aktifkan()} disabled={sibuk || kode.replace(/\s/g, '').length !== 6} className="min-h-[44px] sm:min-h-0">
                Aktifkan
              </Button>
              <Button variant="ghost" onClick={() => setPasang(null)} className="min-h-[44px] sm:min-h-0">
                Batal
              </Button>
            </div>
          </li>
        </ol>
      )}

      {status.enabled && !kodePemulihan && (
        <div className="space-y-3 text-sm">
          <p className="text-ink-600 dark:text-ink-300">Sisa kode pemulihan: {status.recovery_left} dari 8.</p>
          {!matikan ? (
            <Button variant="secondary" onClick={() => setMatikan(true)} className="min-h-[44px] sm:min-h-0">
              Matikan verifikasi dua langkah
            </Button>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-56">
                <Input name="sandi-matikan-mfa" label="Sandi akun" type="password" autoComplete="current-password" value={sandi} onChange={(e) => setSandi(e.target.value)} />
              </div>
              <div className="w-40">
                <Input name="kode-matikan-mfa" label="Kode authenticator" inputMode="numeric" autoComplete="one-time-code" value={kode} onChange={(e) => setKode(e.target.value)} />
              </div>
              <Button variant="danger" onClick={() => void nonaktifkan()} disabled={sibuk || !sandi || !kode} className="min-h-[44px] sm:min-h-0">
                Matikan
              </Button>
              <Button variant="ghost" onClick={() => setMatikan(false)} className="min-h-[44px] sm:min-h-0">
                Batal
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
