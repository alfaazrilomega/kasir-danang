import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Link } from '@/lib/router';
import { cn } from '@/lib/format';
import { PUBLIC_STORE_ID } from '@/lib/config';
import { customerGoogle, customerSignin, customerSignup, fetchCustomerConfig, useCustomer } from '@/lib/customerAccount';
import { KolomApung, KolomSandi, PemisahAtau, PesanGalat, TOMBOL_AUTH, TombolGoogle, useTokoPublik } from '@/components/public/KerangkaAuth';

type Galat = Partial<Record<'identifier' | 'password' | 'name' | 'email' | 'phone' | 'setuju', string>>;

const TAUTAN_LEGAL = 'text-black/65 underline underline-offset-2 transition-colors duration-150 hover:text-black';

/**
 * Formulir masuk & daftar pembeli. Dipakai di pop-up (layar lebar) dan di
 * halaman penuh (HP); induknya yang menentukan mode dan tindakan sesudahnya.
 */
export function FormMasuk({
  mode,
  onMode,
  next,
  idAwal = '',
  onLupa,
  onBerhasil,
}: {
  mode: 'masuk' | 'daftar';
  onMode: (m: 'masuk' | 'daftar') => void;
  next: string | null;
  idAwal?: string;
  /** Bila diisi, "Lupa Kata Sandi?" ditangani induk (pop-up) alih-alih pindah halaman. */
  onLupa?: (identifier: string) => void;
  onBerhasil: () => void;
}) {
  const masuk = useCustomer((s) => s.masuk);
  const toko = useTokoPublik();
  const namaToko = toko?.name ?? 'toko ini';

  const [identifier, setIdentifier] = useState(idAwal);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [setuju, setSetuju] = useState(false);
  const [galat, setGalat] = useState<Galat>({});
  const [busy, setBusy] = useState(false);
  const [googleId, setGoogleId] = useState<string | null>(null);

  useEffect(() => {
    void fetchCustomerConfig().then(({ data }) => setGoogleId(data?.google_client_id ?? null));
  }, []);

  function gantiMode(m: 'masuk' | 'daftar') {
    // Nomor HP / email yang sudah diketik ikut pindah ke kolom yang sesuai.
    const id = identifier.trim();
    if (m === 'daftar' && id) {
      if (id.includes('@')) setEmail((v) => v || id);
      else setPhone((v) => v || id);
    }
    if (m === 'masuk' && !id) setIdentifier(email.trim() || phone.trim());
    setGalat({});
    setPassword('');
    onMode(m);
  }

  async function masukGoogle(credential: string) {
    setBusy(true);
    const { data, error } = await customerGoogle({ store_id: PUBLIC_STORE_ID, credential });
    setBusy(false);
    if (error || !data) {
      toast.error(error || 'Masuk dengan Google gagal.');
      return;
    }
    masuk(data.token, data.me);
    toast.success(`Selamat datang, ${data.me.name}.`);
    onBerhasil();
  }

  async function kirimMasuk(e: FormEvent) {
    e.preventDefault();
    const g: Galat = {};
    if (!identifier.trim()) g.identifier = 'Isi nomor HP atau email.';
    if (!password) g.password = 'Isi kata sandi.';
    setGalat(g);
    if (Object.keys(g).length) return;
    setBusy(true);
    const { data, error } = await customerSignin({ store_id: PUBLIC_STORE_ID, identifier: identifier.trim(), password });
    setBusy(false);
    if (error || !data) {
      setGalat({ password: error || 'Gagal masuk.' });
      return;
    }
    masuk(data.token, data.me);
    toast.success(`Selamat datang kembali, ${data.me.name}.`);
    onBerhasil();
  }

  async function kirimDaftar(e: FormEvent) {
    e.preventDefault();
    const g: Galat = {};
    if (!name.trim()) g.name = 'Isi nama lengkap.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) g.email = 'Email tidak valid.';
    if (phone.replace(/\D/g, '').length < 8) g.phone = 'Nomor HP tidak valid.';
    if (password.length < 6) g.password = 'Kata sandi minimal 6 karakter.';
    if (!setuju) g.setuju = 'Setujui penggunaan data pribadi untuk melanjutkan.';
    setGalat(g);
    if (Object.keys(g).length) return;
    setBusy(true);
    const { data, error } = await customerSignup({
      store_id: PUBLIC_STORE_ID,
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      password,
      privacy_accepted: setuju,
    });
    setBusy(false);
    if (error || !data) {
      setGalat(/HP/i.test(error ?? '') ? { phone: error ?? '' } : { email: error || 'Gagal mendaftar.' });
      return;
    }
    masuk(data.token, data.me);
    toast.success('Akun berhasil dibuat.');
    onBerhasil();
  }

  const tautanLupa = `/toko/lupa-sandi?${new URLSearchParams({
    ...(identifier.trim() ? { id: identifier.trim() } : {}),
    ...(next ? { next } : {}),
  }).toString()}`;

  return (
    <>
      <h1 id="judul-auth" className="mt-6 text-center text-2xl font-semibold tracking-tight text-[#1a1a1a]">
        {mode === 'masuk' ? 'Selamat datang' : 'Buat akun'}
      </h1>
      <p className="mt-2 text-center text-[15px] text-black/60">
        {mode === 'masuk' ? `Masuk untuk belanja di ${namaToko}` : 'Daftar sekali, checkout lebih cepat.'}
      </p>

      {mode === 'masuk' ? (
        <form data-auth onSubmit={kirimMasuk} className="mt-6" noValidate>
          <KolomApung
            id="masuk-id"
            name="identifier"
            label="No. Handphone/Email"
            autoComplete="username"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            galat={!!galat.identifier}
          />
          <PesanGalat teks={galat.identifier} />
          <KolomSandi
            id="masuk-sandi"
            label="Kata sandi"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            galat={!!galat.password}
          />
          <div className="flex items-start justify-between gap-3">
            <PesanGalat teks={galat.password} />
            <Link
              to={tautanLupa}
              onClick={(e) => {
                if (!onLupa) return;
                e.preventDefault();
                onLupa(identifier.trim());
              }}
              className="shrink-0 pt-1.5 text-[13px] font-medium text-brand-600 transition-colors duration-150 hover:text-brand-700"
            >
              Lupa Kata Sandi?
            </Link>
          </div>
          <button type="submit" disabled={busy || !identifier.trim() || !password} className={cn(TOMBOL_AUTH, 'mt-3')}>
            {busy ? 'Memproses…' : 'Masuk'}
          </button>
        </form>
      ) : (
        <form data-auth onSubmit={kirimDaftar} className="mt-6" noValidate>
          <div className="grid gap-x-3 sm:grid-cols-2">
            <div>
              <KolomApung
                id="daftar-nama"
                name="name"
                label="Nama lengkap"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                galat={!!galat.name}
              />
              <PesanGalat teks={galat.name} />
            </div>
            <div>
              <KolomApung
                id="daftar-hp"
                name="phone"
                label="Nomor HP / WhatsApp"
                autoComplete="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                galat={!!galat.phone}
              />
              <PesanGalat teks={galat.phone} />
            </div>
          </div>
          <KolomApung
            id="daftar-email"
            name="email"
            type="email"
            label="Email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            galat={!!galat.email}
          />
          <PesanGalat teks={galat.email} />
          <KolomSandi
            id="daftar-sandi"
            label="Kata sandi"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            galat={!!galat.password}
          />
          <PesanGalat teks={galat.password} />
          <label className="flex items-start gap-2.5 text-[13px] leading-[18px] text-black/65">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
              checked={setuju}
              onChange={(e) => setSetuju(e.target.checked)}
            />
            <span>Saya setuju nama, nomor HP, email, dan alamat saya dipakai toko untuk memproses dan mengirim pesanan.</span>
          </label>
          <PesanGalat teks={galat.setuju} />
          <button
            type="submit"
            disabled={busy || !name.trim() || !email.trim() || !phone.trim() || !password}
            className={cn(TOMBOL_AUTH, 'mt-1')}
          >
            {busy ? 'Memproses…' : 'Daftar'}
          </button>
        </form>
      )}

      <p className="mt-4 text-[15px] text-black/70">
        {mode === 'masuk' ? 'Belum punya akun?' : 'Sudah punya akun?'}{' '}
        <button
          type="button"
          onClick={() => gantiMode(mode === 'masuk' ? 'daftar' : 'masuk')}
          className="font-semibold text-brand-600 transition-colors duration-150 hover:text-brand-700"
        >
          {mode === 'masuk' ? 'Daftar' : 'Masuk'}
        </button>
      </p>

      <PemisahAtau />
      <TombolGoogle googleId={googleId} onKredensial={masukGoogle} />

      <p className="mt-6 text-center text-xs leading-relaxed text-black/45">
        Dengan {mode === 'masuk' ? 'masuk' : 'mendaftar'}, Anda menyetujui{' '}
        <Link to="/toko/syarat-ketentuan" className={TAUTAN_LEGAL}>
          Syarat &amp; Ketentuan
        </Link>{' '}
        serta{' '}
        <Link to="/toko/kebijakan-privasi" className={TAUTAN_LEGAL}>
          Kebijakan Privasi
        </Link>{' '}
        {namaToko}.
      </p>
    </>
  );
}
