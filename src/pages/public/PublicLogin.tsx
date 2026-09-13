import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Link, useLocation, useNavigate } from '@/lib/router';
import { cn } from '@/lib/format';
import { PUBLIC_STORE_ID } from '@/lib/config';
import { customerGoogle, customerSignin, customerSignup, fetchCustomerConfig, useCustomer } from '@/lib/customerAccount';
import {
  KOLOM_AUTH,
  KartuAuth,
  KerangkaAuth,
  KolomSandi,
  PemisahAtau,
  PesanGalat,
  TOMBOL_AUTH,
  TombolGoogle,
  tujuanAman,
  useTokoPublik,
} from '@/components/public/KerangkaAuth';

type Galat = Partial<Record<'identifier' | 'password' | 'name' | 'email' | 'phone' | 'setuju', string>>;

/**
 * Halaman masuk & daftar pembeli mengikuti halaman login Shopee (tanpa navbar
 * dan footer, satu layar penuh): latar warna toko dengan logo di kiri, kartu
 * putih di kanan. Masuk memakai nomor HP atau email + kata sandi, atau Google.
 */
export function PublicLogin() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const next = tujuanAman(params.get('next'));
  const [tab, setTab] = useState<'masuk' | 'daftar'>(params.get('tab') === 'daftar' ? 'daftar' : 'masuk');
  const token = useCustomer((s) => s.token);
  const masuk = useCustomer((s) => s.masuk);
  const toko = useTokoPublik();
  const namaToko = toko?.name ?? 'toko ini';

  const [identifier, setIdentifier] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [setuju, setSetuju] = useState(false);
  const [galat, setGalat] = useState<Galat>({});
  const [busy, setBusy] = useState(false);
  const [googleId, setGoogleId] = useState<string | null>(null);

  useEffect(() => setTab(params.get('tab') === 'daftar' ? 'daftar' : 'masuk'), [params]);

  useEffect(() => {
    if (token) navigate(next);
    // `next` dihitung dari URL yang sama selama halaman ini terbuka.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    void fetchCustomerConfig().then(({ data }) => setGoogleId(data?.google_client_id ?? null));
  }, []);

  function gantiTab(t: 'masuk' | 'daftar') {
    setTab(t);
    setGalat({});
    setPassword('');
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
  }

  const tautanLupa = `/toko/lupa-sandi?${new URLSearchParams({
    ...(identifier.trim() ? { id: identifier.trim() } : {}),
    ...(params.get('next') ? { next } : {}),
  }).toString()}`;

  return (
    <KerangkaAuth>
      <KartuAuth>
        <h1 className="flex h-[58px] items-center text-xl text-black/80 dark:text-ink-100">{tab === 'masuk' ? 'Masuk' : 'Daftar'}</h1>

        {tab === 'masuk' ? (
          <form onSubmit={kirimMasuk} className="mt-5" noValidate>
            <input
              name="identifier"
              aria-label="No. Handphone/Email"
              placeholder="No. Handphone/Email"
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className={cn(KOLOM_AUTH, galat.identifier && 'border-rose-500 focus:border-rose-500')}
            />
            <PesanGalat teks={galat.identifier} />
            <KolomSandi
              label="Kata sandi"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              kanan={
                <>
                  <span className="h-6 w-px bg-black/10" />
                  <Link
                    to={tautanLupa}
                    className="w-[76px] shrink-0 px-2 text-center text-xs leading-tight text-brand-700 transition-colors duration-150 hover:text-brand-900 dark:text-brand-300"
                  >
                    Lupa Kata Sandi?
                  </Link>
                </>
              }
            />
            <PesanGalat teks={galat.password} />
            <button type="submit" disabled={busy || !identifier.trim() || !password} className={TOMBOL_AUTH}>
              {busy ? 'Memproses…' : 'Masuk'}
            </button>
          </form>
        ) : (
          <form onSubmit={kirimDaftar} className="mt-5" noValidate>
            <input
              name="name"
              aria-label="Nama lengkap"
              placeholder="Nama lengkap"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={cn(KOLOM_AUTH, galat.name && 'border-rose-500')}
            />
            <PesanGalat teks={galat.name} />
            <input
              name="email"
              type="email"
              aria-label="Email"
              placeholder="Email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={cn(KOLOM_AUTH, galat.email && 'border-rose-500')}
            />
            <PesanGalat teks={galat.email} />
            <input
              name="phone"
              aria-label="Nomor HP / WhatsApp"
              placeholder="Nomor HP / WhatsApp"
              autoComplete="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={cn(KOLOM_AUTH, galat.phone && 'border-rose-500')}
            />
            <PesanGalat teks={galat.phone} />
            <KolomSandi
              label="Kata sandi"
              placeholder="Kata sandi (minimal 6 karakter)"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
            />
            <PesanGalat teks={galat.password} />
            <label className="flex items-start gap-2 text-xs text-black/60 dark:text-ink-300">
              <input type="checkbox" className="mt-0.5 accent-brand-600" checked={setuju} onChange={(e) => setSetuju(e.target.checked)} />
              <span>Saya setuju nama, nomor HP, email, dan alamat saya dipakai toko untuk memproses dan mengirim pesanan.</span>
            </label>
            <PesanGalat teks={galat.setuju} />
            <button type="submit" disabled={busy || !name.trim() || !email.trim() || !phone.trim() || !password} className={TOMBOL_AUTH}>
              {busy ? 'Memproses…' : 'Daftar'}
            </button>
          </form>
        )}

        <PemisahAtau />
        <TombolGoogle googleId={googleId} onKredensial={masukGoogle} />

        <p className="mt-[30px] text-center text-xs text-black/60 dark:text-ink-400">
          Data pribadimu hanya dipakai untuk memproses dan mengirim pesanan.
        </p>
        <p className="mt-4 text-center text-sm text-black/25 dark:text-ink-500">
          {tab === 'masuk' ? `Baru di ${namaToko}? ` : 'Punya akun? '}
          <button
            type="button"
            onClick={() => gantiTab(tab === 'masuk' ? 'daftar' : 'masuk')}
            className="font-medium text-brand-600 transition-colors duration-150 hover:text-brand-800"
          >
            {tab === 'masuk' ? 'Daftar' : 'Masuk'}
          </button>
        </p>
      </KartuAuth>
    </KerangkaAuth>
  );
}
