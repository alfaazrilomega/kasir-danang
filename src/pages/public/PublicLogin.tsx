import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Link, useLocation, useNavigate } from '@/lib/router';
import { cn } from '@/lib/format';
import { PUBLIC_STORE_ID } from '@/lib/config';
import { customerGoogle, customerSignin, customerSignup, fetchCustomerConfig, useCustomer } from '@/lib/customerAccount';
import {
  Bidang,
  KOLOM_AUTH,
  KOLOM_GALAT,
  KerangkaAuth,
  KolomSandi,
  PemisahAtau,
  PesanGalat,
  TOMBOL_AUTH,
  TombolGoogle,
  tujuanAman,
  useTokoPublik,
} from '@/components/public/KerangkaAuth';

type Mode = 'masuk' | 'daftar';
type Galat = Partial<Record<'identifier' | 'password' | 'name' | 'email' | 'phone' | 'setuju', string>>;

const TAUTAN_LEGAL = 'text-black/70 underline underline-offset-2 transition-colors duration-150 hover:text-black';

/**
 * Halaman masuk & daftar pembeli (tanpa navbar dan footer, satu layar penuh).
 * Masuk memakai nomor HP atau email + kata sandi, atau Google. Masuk/Daftar
 * berpindah di tempat lewat tombol segmen; mode tersimpan di URL (?tab=daftar).
 */
export function PublicLogin() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const next = tujuanAman(params.get('next'));
  const tab: Mode = params.get('tab') === 'daftar' ? 'daftar' : 'masuk';
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

  useEffect(() => {
    if (token) navigate(next);
    // `next` dihitung dari URL yang sama selama halaman ini terbuka.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    void fetchCustomerConfig().then(({ data }) => setGoogleId(data?.google_client_id ?? null));
  }, []);

  function gantiTab(t: Mode) {
    if (t === tab) return;
    // Nomor HP / email yang sudah diketik ikut pindah ke kolom yang sesuai.
    const id = identifier.trim();
    if (t === 'daftar' && id) {
      if (id.includes('@')) setEmail((v) => v || id);
      else setPhone((v) => v || id);
    }
    if (t === 'masuk' && !id) setIdentifier(email.trim() || phone.trim());
    setGalat({});
    setPassword('');
    const p = new URLSearchParams(search);
    if (t === 'daftar') p.set('tab', 'daftar');
    else p.delete('tab');
    const q = p.toString();
    navigate(`/toko/masuk${q ? `?${q}` : ''}`, { replace: true });
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

  const [judul, subJudul] =
    tab === 'masuk'
      ? ['Selamat datang kembali', 'Masuk dengan nomor HP atau email Anda.']
      : ['Buat akun baru', 'Satu akun untuk belanja dan melacak pesanan.'];

  return (
    <KerangkaAuth
      kaki={
        <>
          Dengan {tab === 'masuk' ? 'masuk' : 'mendaftar'}, Anda menyetujui{' '}
          <Link to="/toko/syarat-ketentuan" className={TAUTAN_LEGAL}>
            Syarat &amp; Ketentuan
          </Link>{' '}
          serta{' '}
          <Link to="/toko/kebijakan-privasi" className={TAUTAN_LEGAL}>
            Kebijakan Privasi
          </Link>{' '}
          {namaToko}.
        </>
      }
    >
      <h1 className="text-[28px] font-semibold leading-[34px] tracking-tight text-[#0b0c1a]">{judul}</h1>
      <p className="mt-1 text-sm text-black/55">{subJudul}</p>

      <div className="mt-5 grid h-10 grid-cols-2 rounded-xl bg-black/[0.05] p-1 text-sm font-medium">
        {(['masuk', 'daftar'] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={tab === m}
            onClick={() => gantiTab(m)}
            className={cn(
              'rounded-lg transition-[background-color,color,box-shadow] duration-150',
              tab === m ? 'bg-white text-[#0b0c1a] shadow-[0_1px_2px_rgba(0,0,0,0.08)]' : 'text-black/50 hover:text-black/75',
            )}
          >
            {m === 'masuk' ? 'Masuk' : 'Daftar'}
          </button>
        ))}
      </div>

      {tab === 'masuk' ? (
        <form onSubmit={kirimMasuk} className="mt-5" noValidate>
          <Bidang id="identifier" label="No. Handphone/Email" galat={galat.identifier}>
            <input
              id="identifier"
              name="identifier"
              aria-label="No. Handphone/Email"
              placeholder="0812xxxx atau nama@email.com"
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className={cn(KOLOM_AUTH, galat.identifier && KOLOM_GALAT)}
            />
          </Bidang>
          <Bidang
            id="sandi"
            label="Kata sandi"
            galat={galat.password}
            kanan={
              <Link to={tautanLupa} className="text-[13px] font-medium text-brand-600 transition-colors duration-150 hover:text-brand-700">
                Lupa Kata Sandi?
              </Link>
            }
          >
            <KolomSandi
              id="sandi"
              label="Kata sandi"
              placeholder="Masukkan kata sandi"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              galat={!!galat.password}
            />
          </Bidang>
          <button type="submit" disabled={busy || !identifier.trim() || !password} className={cn(TOMBOL_AUTH, 'mt-2')}>
            {busy ? 'Memproses…' : 'Masuk'}
          </button>
        </form>
      ) : (
        <form onSubmit={kirimDaftar} className="mt-5" noValidate>
          <div className="grid grid-cols-2 gap-x-3">
            <Bidang id="nama" label="Nama lengkap" galat={galat.name}>
              <input
                id="nama"
                name="name"
                aria-label="Nama lengkap"
                placeholder="Nama Anda"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={cn(KOLOM_AUTH, galat.name && KOLOM_GALAT)}
              />
            </Bidang>
            <Bidang id="hp" label="Nomor HP / WhatsApp" galat={galat.phone}>
              <input
                id="hp"
                name="phone"
                aria-label="Nomor HP / WhatsApp"
                placeholder="0812xxxx"
                autoComplete="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={cn(KOLOM_AUTH, galat.phone && KOLOM_GALAT)}
              />
            </Bidang>
          </div>
          <Bidang id="email" label="Email" galat={galat.email}>
            <input
              id="email"
              name="email"
              type="email"
              aria-label="Email"
              placeholder="nama@email.com"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={cn(KOLOM_AUTH, galat.email && KOLOM_GALAT)}
            />
          </Bidang>
          <Bidang id="sandi-baru" label="Kata sandi" galat={galat.password}>
            <KolomSandi
              id="sandi-baru"
              label="Kata sandi"
              placeholder="Minimal 6 karakter"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              galat={!!galat.password}
            />
          </Bidang>
          <label className="flex items-start gap-2.5 text-xs leading-[18px] text-black/60">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 rounded accent-brand-500"
              checked={setuju}
              onChange={(e) => setSetuju(e.target.checked)}
            />
            <span>Saya setuju nama, nomor HP, email, dan alamat saya dipakai toko untuk memproses dan mengirim pesanan.</span>
          </label>
          <PesanGalat teks={galat.setuju} />
          <button type="submit" disabled={busy || !name.trim() || !email.trim() || !phone.trim() || !password} className={cn(TOMBOL_AUTH, 'mt-2')}>
            {busy ? 'Memproses…' : 'Daftar'}
          </button>
        </form>
      )}

      <PemisahAtau />
      <TombolGoogle googleId={googleId} onKredensial={masukGoogle} />
    </KerangkaAuth>
  );
}
