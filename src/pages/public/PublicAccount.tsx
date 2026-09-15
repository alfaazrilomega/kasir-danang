import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, Copy, Heart, ImagePlus, LogOut, MapPin, MessageSquareText, Package, Star, UserRound, X, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { TextArea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { PublicShell } from '@/components/layout/PublicShell';
import { KartuProduk } from '@/components/public/KartuProduk';
import { Link, useLocation, useNavigate } from '@/lib/router';
import { cn, formatDateTime, formatMoney } from '@/lib/format';
import { resizeImageToDataUrl } from '@/lib/imageUpload';
import { PUBLIC_STORE_ID } from '@/lib/config';
import {
  fetchPublicCatalog,
  kelompokkanVarian,
  lokasiToko,
  type PublicCatalogCategory,
  type PublicCatalogData,
} from '@/lib/publicCatalog';
import { useWishlist } from '@/stores/wishlist';
import { KolomAlamat, type NilaiAlamat } from '@/components/public/KolomAlamat';
import { provinsiDariKota } from '@/lib/wilayah';
import {
  fetchCustomerOrders,
  fetchReviewable,
  submitReview,
  TAG_ULASAN,
  updateCustomerMe,
  useCustomer,
  type CustomerOrder,
  type ReviewableItem,
} from '@/lib/customerAccount';

type Tab = 'pesanan' | 'ulasan' | 'favorit' | 'profil';
type KunciStatus = 'menunggu' | 'diproses' | 'dikonfirmasi' | 'dibatalkan';
type Status = 'semua' | KunciStatus;

const DAFTAR_TAB: Tab[] = ['pesanan', 'ulasan', 'favorit', 'profil'];
const URUTAN_STATUS: Status[] = ['semua', 'menunggu', 'diproses', 'dikonfirmasi', 'dibatalkan'];
const LABEL_BINTANG = ['', 'Sangat buruk', 'Buruk', 'Cukup', 'Baik', 'Sangat baik'];

/** Huruf condensed miring khas balap; di halaman ini hanya dipakai untuk nama pembeli. */
const HURUF_BALAP = "font-['Barlow_Condensed',ui-sans-serif,sans-serif] italic";
const PANEL = 'rounded-lg bg-white shadow-card dark:bg-ink-900';
const KOLOM =
  'w-full rounded-md border border-ink-200 bg-white px-3 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100';
/** Tinggi kolom isian, px: huruf dasar 14px membuat h-11 cuma 38,5px. */
const TINGGI_KOLOM = 'h-[44px]';
const TOMBOL_UTAMA =
  'inline-flex h-10 items-center justify-center rounded-md bg-brand-500 px-5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50';
const TOMBOL_GARIS =
  'inline-flex h-9 shrink-0 items-center rounded-md border border-brand-500 px-4 text-sm font-medium text-brand-600 transition-colors duration-150 hover:bg-brand-50 dark:hover:bg-brand-950/40';

const STATUS: Record<KunciStatus, { label: string; chip: string; keterangan: string }> = {
  menunggu: {
    label: 'Menunggu Konfirmasi',
    chip: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
    keterangan: 'Toko sedang memeriksa pesanan Anda dan akan mengonfirmasi ongkos kirimnya.',
  },
  diproses: {
    label: 'Diproses',
    chip: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
    keterangan: 'Pesanan sedang disiapkan toko.',
  },
  dikonfirmasi: {
    label: 'Dikonfirmasi',
    chip: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
    keterangan: 'Pembayaran diterima dan pesanan telah dikonfirmasi.',
  },
  dibatalkan: {
    label: 'Dibatalkan',
    chip: 'bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400',
    keterangan: 'Pesanan ini dibatalkan.',
  },
};

function kunciStatus(o: CustomerOrder): KunciStatus {
  if (o.order_status === 'awaiting_confirmation') return 'menunggu';
  if (o.order_status === 'canceled') return 'dibatalkan';
  if (o.order_status === 'done' && o.payment_status === 'paid') return 'dikonfirmasi';
  return 'diproses';
}

/**
 * Akun pembeli ala "Manage My Account" Lazada: menu di kiri (desktop) atau
 * baris 4 menu yang menempel di bawah header (HP), isi di kanan. Tab dan filter
 * status pesanan disimpan di URL (?tab=…&status=…) supaya tautan "Lacak
 * Pesanan"/"Akun" di header dan tombol kembali browser selalu cocok.
 */
export function PublicAccount() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const token = useCustomer((s) => s.token);
  const me = useCustomer((s) => s.me);
  const ready = useCustomer((s) => s.ready);
  const muat = useCustomer((s) => s.muat);
  const setMe = useCustomer((s) => s.setMe);
  const keluar = useCustomer((s) => s.keluar);
  const favoritIds = useWishlist((s) => s.ids);

  const params = new URLSearchParams(search);
  const tab: Tab = DAFTAR_TAB.find((t) => t === params.get('tab')) ?? 'pesanan';
  const status: Status = URUTAN_STATUS.find((s) => s === params.get('status')) ?? 'semua';
  const setTab = (t: Tab) => navigate(`/toko/akun?tab=${t}`);
  const setStatus = (s: Status) => navigate(`/toko/akun?tab=pesanan${s === 'semua' ? '' : `&status=${s}`}`, { replace: true });

  const [orders, setOrders] = useState<CustomerOrder[] | null>(null);
  const [reviewable, setReviewable] = useState<ReviewableItem[] | null>(null);
  const [catalog, setCatalog] = useState<PublicCatalogData | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', address: '' });
  const [wilayah, setWilayah] = useState<NilaiAlamat>({ provinsi: '', kota: '', alamat: '' });
  const [busy, setBusy] = useState(false);
  const [menilai, setMenilai] = useState<ReviewableItem | null>(null);
  const [subUlasan, setSubUlasan] = useState<'belum' | 'riwayat'>('belum');

  useEffect(() => {
    if (ready && !token) navigate('/toko/masuk?next=/toko/akun');
  }, [ready, token, navigate]);

  useEffect(() => {
    if (token && !me) void muat();
  }, [token, me, muat]);

  useEffect(() => {
    if (me) {
      setForm({ name: me.name, phone: me.phone ?? '', address: me.address ?? '' });
      const kota = me.city ?? '';
      setWilayah({ provinsi: me.province || provinsiDariKota(kota), kota, alamat: me.address ?? '' });
    }
  }, [me]);

  function muatUlasan() {
    if (!token) return;
    void fetchReviewable(token).then(({ data }) => setReviewable(data ?? []));
  }

  useEffect(() => {
    if (!token) return;
    void fetchCustomerOrders(token).then(({ data, error }) => {
      if (error) toast.error(error);
      setOrders(data ?? []);
    });
    muatUlasan();
    // muatUlasan hanya bergantung pada token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Katalog dipakai favorit, rekomendasi di keadaan kosong, dan pintasan kategori.
  useEffect(() => {
    fetchPublicCatalog(PUBLIC_STORE_ID).then(setCatalog).catch(() => {});
  }, []);

  const semuaKelompok = useMemo(() => (catalog ? kelompokkanVarian(catalog.products) : []), [catalog]);
  const favorit = useMemo(
    () => (catalog ? kelompokkanVarian(catalog.products.filter((p) => favoritIds.includes(p.id))) : []),
    [catalog, favoritIds],
  );
  const terlaris = useMemo(() => [...semuaKelompok].sort((a, b) => b.terjual - a.terjual).slice(0, 4), [semuaKelompok]);

  const belumDiulas = (reviewable ?? []).filter((r) => !r.reviewed);
  const sudahDiulas = (reviewable ?? []).filter((r) => r.reviewed);

  const jumlahStatus = useMemo(() => {
    const j: Record<Status, number> = { semua: 0, menunggu: 0, diproses: 0, dikonfirmasi: 0, dibatalkan: 0 };
    for (const o of orders ?? []) {
      j.semua += 1;
      j[kunciStatus(o)] += 1;
    }
    return j;
  }, [orders]);
  const pesananTampil = (orders ?? []).filter((o) => status === 'semua' || kunciStatus(o) === status);

  const berubah =
    !!me &&
    (form.name !== me.name ||
      form.phone !== (me.phone ?? '') ||
      wilayah.alamat !== (me.address ?? '') ||
      wilayah.provinsi !== (me.province ?? '') ||
      wilayah.kota !== (me.city ?? ''));

  async function simpan() {
    if (!token) return;
    if (!form.name.trim()) return void toast.error('Nama wajib diisi.');
    setBusy(true);
    const { data, error } = await updateCustomerMe(token, {
      name: form.name.trim(),
      phone: form.phone.trim(),
      address: wilayah.alamat.trim(),
      province: wilayah.provinsi,
      city: wilayah.kota,
    });
    setBusy(false);
    if (error || !data) {
      toast.error(error || 'Gagal menyimpan profil.');
      return;
    }
    setMe(data);
    toast.success('Profil tersimpan.');
  }

  function keluarAkun() {
    keluar();
    navigate('/toko');
  }

  async function salin(nomor: string) {
    try {
      await navigator.clipboard.writeText(nomor);
      toast.success('Nomor pesanan disalin.');
    } catch {
      toast.error('Nomor pesanan gagal disalin.');
    }
  }

  if (!token || !me) {
    return (
      <PublicShell>
        <div className="h-40 animate-pulse rounded-lg bg-ink-100 dark:bg-ink-800" />
      </PublicShell>
    );
  }

  const MENU: { tab: Tab; label: string; labelHp: string; ikon: LucideIcon; jumlah: number }[] = [
    { tab: 'pesanan', label: 'Pesanan Saya', labelHp: 'Pesanan', ikon: Package, jumlah: orders?.length ?? 0 },
    { tab: 'ulasan', label: 'Ulasan', labelHp: 'Ulasan', ikon: MessageSquareText, jumlah: belumDiulas.length },
    { tab: 'favorit', label: 'Favorit', labelHp: 'Favorit', ikon: Heart, jumlah: favoritIds.length },
    { tab: 'profil', label: 'Profil & Alamat', labelHp: 'Profil', ikon: UserRound, jumlah: 0 },
  ];
  const JUDUL: Record<Tab, [string, string]> = {
    pesanan: ['Pesanan Saya', 'Pantau status setiap pesanan Anda di sini.'],
    ulasan: ['Ulasan', 'Beri penilaian untuk barang dari pesanan yang sudah dikonfirmasi.'],
    favorit: ['Favorit', favoritIds.length ? `${favoritIds.length} produk tersimpan` : 'Produk yang Anda simpan dengan ikon hati.'],
    profil: ['Profil & Alamat', 'Data ini otomatis mengisi formulir checkout.'],
  };

  const identitas = (
    <>
      <div className="flex items-center gap-3 bg-ink-900 px-4 pb-3 pt-4 text-white">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-500 text-lg font-bold">
          {me.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <div className={cn(HURUF_BALAP, 'truncate text-xl font-extrabold uppercase leading-none')}>{me.name}</div>
          <div className="mt-1 truncate text-xs text-ink-300" title={me.email}>
            {me.email}
          </div>
        </div>
      </div>
      {/* Strip bendera kotak dari logo GNNK: satu-satunya ornamen balap di halaman ini. */}
      <div aria-hidden className="h-1.5 [background:repeating-conic-gradient(#141826_0_25%,#fff_0_50%)_0_0/6px_6px]" />
    </>
  );

  return (
    <PublicShell>
      <div className="grid items-start gap-y-3 lg:grid-cols-[232px_minmax(0,1fr)] lg:gap-4">
        {/* ---------- Menu kiri (desktop) ---------- */}
        <aside className={cn(PANEL, 'hidden overflow-hidden lg:sticky lg:top-[calc(var(--tinggi-header,120px)+16px)] lg:block')}>
          {identitas}
          <nav aria-label="Menu akun" className="py-2">
            {MENU.map((m) => (
              <button
                key={m.tab}
                type="button"
                onClick={() => setTab(m.tab)}
                aria-current={tab === m.tab ? 'page' : undefined}
                className={cn(
                  'flex w-full items-center gap-3 border-l-[3px] px-4 py-2.5 text-left text-sm transition-colors duration-150',
                  tab === m.tab
                    ? 'border-brand-500 bg-brand-50 font-semibold text-brand-700 dark:bg-brand-950/40 dark:text-brand-200'
                    : 'border-transparent text-ink-700 hover:bg-ink-50 dark:text-ink-300 dark:hover:bg-ink-800',
                )}
              >
                <m.ikon size={17} className="shrink-0" />
                {m.label}
                {m.jumlah > 0 && <span className="ml-auto text-xs font-normal tabular-nums text-ink-400">{m.jumlah}</span>}
              </button>
            ))}
          </nav>
          <button
            type="button"
            onClick={keluarAkun}
            className="flex w-full items-center gap-3 border-t border-ink-100 px-4 py-3 text-sm text-ink-500 transition-colors duration-150 hover:text-rose-600 dark:border-ink-800"
          >
            <LogOut size={16} /> Keluar
          </button>
        </aside>

        {/* ---------- Identitas + menu 4 kolom (HP) ---------- */}
        <div className="lg:hidden">
          <div className="overflow-hidden rounded-t-lg">{identitas}</div>
          <nav
            aria-label="Menu akun"
            className="sticky top-[var(--tinggi-header,64px)] z-10 grid grid-cols-4 rounded-b-lg border-b border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900"
          >
            {MENU.map((m) => (
              <button
                key={m.tab}
                type="button"
                onClick={() => setTab(m.tab)}
                aria-current={tab === m.tab ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors duration-150',
                  tab === m.tab ? 'text-brand-600 shadow-[inset_0_-2px_0_currentColor]' : 'text-ink-500',
                )}
              >
                <span className="relative">
                  <m.ikon size={19} />
                  {m.jumlah > 0 && (
                    <span className="absolute -right-3 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-brand-500 px-1 text-[10px] leading-none text-white">
                      {m.jumlah}
                    </span>
                  )}
                </span>
                {m.labelHp}
              </button>
            ))}
          </nav>
        </div>

        {/* ---------- Isi ---------- */}
        <section className="min-w-0">
          <div className="mb-3">
            <h1 className="text-lg font-semibold text-ink-900 dark:text-ink-100">{JUDUL[tab][0]}</h1>
            <p className="text-sm text-ink-500">{JUDUL[tab][1]}</p>
          </div>

          {tab === 'pesanan' &&
            (orders === null ? (
              <Kerangka />
            ) : orders.length === 0 ? (
              <PesananKosong kategori={catalog?.categories ?? []} />
            ) : (
              <>
                <div className={cn(PANEL, 'tanpa-bilah flex snap-x overflow-x-auto')}>
                  {URUTAN_STATUS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setStatus(s)}
                      aria-pressed={status === s}
                      className={cn(
                        'relative shrink-0 snap-start px-4 py-3 text-sm font-medium transition-colors duration-150',
                        status === s
                          ? 'text-brand-600 after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-brand-500'
                          : 'text-ink-600 hover:text-brand-600 dark:text-ink-300',
                      )}
                    >
                      {s === 'semua' ? 'Semua' : STATUS[s].label}
                      <span className="ml-1 text-xs font-normal tabular-nums text-ink-400">({jumlahStatus[s]})</span>
                    </button>
                  ))}
                </div>
                {pesananTampil.length === 0 ? (
                  <p className={cn(PANEL, 'mt-3 py-10 text-center text-sm text-ink-500')}>
                    Tidak ada pesanan berstatus {status === 'semua' ? '' : STATUS[status].label}.
                  </p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {pesananTampil.map((o) => (
                      <KartuPesanan
                        key={o.id}
                        o={o}
                        ulas={belumDiulas.find((r) => r.order_id === o.id) ?? null}
                        onUlas={setMenilai}
                        onSalin={salin}
                      />
                    ))}
                  </div>
                )}
              </>
            ))}

          {tab === 'ulasan' &&
            (reviewable === null ? (
              <Kerangka />
            ) : (
              <div className={PANEL}>
                <div className="flex border-b border-ink-100 dark:border-ink-800">
                  {(
                    [
                      ['belum', `Belum Diulas (${belumDiulas.length})`],
                      ['riwayat', `Riwayat Ulasan (${sudahDiulas.length})`],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setSubUlasan(k)}
                      aria-pressed={subUlasan === k}
                      className={cn(
                        'relative px-4 py-3 text-sm font-medium transition-colors duration-150',
                        subUlasan === k
                          ? 'text-brand-600 after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-brand-500'
                          : 'text-ink-600 hover:text-brand-600 dark:text-ink-300',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {(subUlasan === 'belum' ? belumDiulas : sudahDiulas).length === 0 ? (
                  <p className="px-5 py-10 text-center text-sm text-ink-500">
                    {subUlasan === 'belum'
                      ? 'Belum ada barang untuk diulas. Barang muncul di sini setelah pesanan dikonfirmasi toko.'
                      : 'Anda belum menulis ulasan.'}
                  </p>
                ) : (
                  <ul className="divide-y divide-ink-100 dark:divide-ink-800">
                    {(subUlasan === 'belum' ? belumDiulas : sudahDiulas).map((r) => (
                      <li key={`${r.order_id}-${r.product_id}`} className="flex items-center gap-4 px-4 py-3 sm:px-5">
                        <span className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-white ring-1 ring-ink-100 dark:ring-ink-800">
                          {r.image_url ? <img src={r.image_url} alt="" className="h-full w-full object-contain" /> : null}
                        </span>
                        <div className="min-w-0 flex-1">
                          <Link to={`/toko/produk?id=${r.product_id}`} className="line-clamp-2 text-sm hover:text-brand-600">
                            {r.name}
                          </Link>
                          <div className="mt-0.5 text-xs text-ink-500">
                            {r.variant_name ? `Variasi: ${r.variant_name} · ` : ''}Dari pesanan {r.order_number}
                          </div>
                        </div>
                        {r.reviewed ? (
                          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                            <Check size={14} /> Sudah diulas
                          </span>
                        ) : (
                          <button type="button" onClick={() => setMenilai(r)} className={TOMBOL_GARIS}>
                            Beri Ulasan
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}

          {tab === 'favorit' &&
            (favoritIds.length === 0 ? (
              <div className={cn(PANEL, 'px-5 py-7 sm:px-7')}>
                <h2 className="text-base font-semibold">Belum ada produk favorit</h2>
                <p className="mt-1 max-w-md text-sm text-ink-500">
                  Simpan produk dengan ikon hati di halaman produk agar mudah ditemukan lagi.
                </p>
                {terlaris.length > 0 && (
                  <>
                    <h3 className="mt-6 text-sm font-semibold">Produk Terlaris</h3>
                    <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
                      {terlaris.map((k) => (
                        <KartuProduk key={k.key} kelompok={k} currency={catalog?.store?.currency} lokasi={lokasiToko(catalog?.store ?? null)} />
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
                {favorit.map((k) => (
                  <KartuProduk key={k.key} kelompok={k} currency={catalog?.store?.currency} lokasi={lokasiToko(catalog?.store ?? null)} />
                ))}
              </div>
            ))}

          {tab === 'profil' && (
            <>
              <div className={cn(PANEL, 'max-w-2xl')}>
                <div className="space-y-6 p-4 sm:p-6">
                  <section>
                    <h2 className="text-sm font-semibold">Data Diri</h2>
                    <div className="mt-3 grid gap-4 sm:grid-cols-2">
                      <Kolom label="Nama">
                        <input name="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={cn(KOLOM, TINGGI_KOLOM)} />
                      </Kolom>
                      <Kolom label="Nomor HP / WhatsApp">
                        <input
                          name="phone"
                          inputMode="tel"
                          value={form.phone}
                          onChange={(e) => setForm({ ...form, phone: e.target.value })}
                          className={cn(KOLOM, TINGGI_KOLOM)}
                        />
                      </Kolom>
                      <Kolom label="Email" bantuan="Email dipakai untuk masuk dan tidak dapat diubah." className="sm:col-span-2">
                        <input value={me.email} readOnly className={cn(KOLOM, TINGGI_KOLOM, 'bg-ink-50 text-ink-500 dark:bg-ink-800')} />
                      </Kolom>
                    </div>
                  </section>
                  <section>
                    <h2 className="text-sm font-semibold">Alamat Pengiriman Utama</h2>
                    <div className="mt-3">
                      <KolomAlamat
                        nilai={wilayah}
                        onChange={setWilayah}
                        kelasKolom={KOLOM}
                        label="Alamat lengkap"
                        bantuan="Otomatis terisi saat checkout."
                      />
                    </div>
                  </section>
                </div>
                <div className="sticky bottom-0 flex justify-end rounded-b-lg border-t border-ink-100 bg-white px-4 py-3 sm:px-6 dark:border-ink-800 dark:bg-ink-900">
                  <button type="button" onClick={simpan} disabled={!berubah || busy} className={TOMBOL_UTAMA}>
                    {busy ? 'Menyimpan…' : 'Simpan Perubahan'}
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={keluarAkun}
                className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-md border border-ink-200 bg-white text-sm font-medium text-ink-700 lg:hidden dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200"
              >
                <LogOut size={16} /> Keluar dari Akun
              </button>
            </>
          )}
        </section>
      </div>

      <ModalUlasan
        item={menilai}
        token={token}
        onClose={() => setMenilai(null)}
        onTerkirim={() => {
          setMenilai(null);
          muatUlasan();
        }}
      />
    </PublicShell>
  );
}

function Kerangka() {
  return <div className="h-32 animate-pulse rounded-lg bg-ink-100 dark:bg-ink-800" />;
}

function Kolom({ label, bantuan, className, children }: { label: string; bantuan?: string; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink-700 dark:text-ink-300">{label}</span>
        {children}
      </label>
      {bantuan && <p className="mt-1 text-xs text-ink-500">{bantuan}</p>}
    </div>
  );
}

/** Keadaan kosong yang tetap berguna: pintasan ke kategori motor, bukan sekadar ikon + dua baris. */
function PesananKosong({ kategori }: { kategori: PublicCatalogCategory[] }) {
  return (
    <div className={cn(PANEL, 'px-5 py-7 sm:px-7')}>
      <h2 className="text-base font-semibold">Belum ada pesanan</h2>
      <p className="mt-1 max-w-md text-sm text-ink-500">Gear set dan sprocket yang Anda pesan akan tercatat di sini beserta statusnya.</p>
      {kategori.length > 0 && (
        <>
          <div className="mt-5 text-xs font-medium uppercase tracking-wide text-ink-400">Cari sesuai motor Anda</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {kategori.slice(0, 8).map((c) => (
              <Link
                key={c.id}
                to={`/toko?kategori=${c.id}`}
                className="rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-700 transition-colors duration-150 hover:border-brand-500 hover:text-brand-600 dark:border-ink-700 dark:text-ink-300"
              >
                {c.name.replace(/^Gear Set\s+/i, '')}
              </Link>
            ))}
          </div>
        </>
      )}
      <Link to="/toko?semua=1" className={cn(TOMBOL_UTAMA, 'mt-6')}>
        Lihat Semua Produk
      </Link>
    </div>
  );
}

function KartuPesanan({
  o,
  ulas,
  onUlas,
  onSalin,
}: {
  o: CustomerOrder;
  ulas: ReviewableItem | null;
  onUlas: (r: ReviewableItem) => void;
  onSalin: (nomor: string) => void;
}) {
  const st = STATUS[kunciStatus(o)];
  return (
    <article className={PANEL}>
      <header className="flex items-start justify-between gap-3 border-b border-ink-100 px-4 py-3 sm:px-5 dark:border-ink-800">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold tabular-nums text-ink-900 dark:text-ink-100">{o.order_number}</span>
            <button
              type="button"
              onClick={() => onSalin(o.order_number)}
              aria-label="Salin nomor pesanan"
              className="text-ink-400 transition-colors duration-150 hover:text-brand-600"
            >
              <Copy size={14} />
            </button>
          </div>
          <div className="text-xs text-ink-500">{formatDateTime(o.created_at)}</div>
        </div>
        <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded px-2 py-0.5 text-xs font-semibold', st.chip)}>
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {st.label}
        </span>
      </header>
      <p className="px-4 pt-3 text-xs text-ink-600 sm:px-5 dark:text-ink-400">{st.keterangan}</p>
      <ul className="divide-y divide-ink-100 px-4 sm:px-5 dark:divide-ink-800">
        {o.items.map((it, i) => (
          <li key={i} className="flex items-baseline gap-3 py-2.5 text-sm">
            <span className="w-8 shrink-0 tabular-nums text-ink-500">{it.qty}×</span>
            <span className="min-w-0 flex-1">{it.name}</span>
            <span className="shrink-0 tabular-nums">{formatMoney(it.price * it.qty)}</span>
          </li>
        ))}
      </ul>
      <footer className="flex flex-col items-stretch gap-3 rounded-b-lg bg-ink-50 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:px-5 dark:bg-ink-950/40">
        <div className="flex min-w-0 max-w-full items-start gap-1.5 text-xs text-ink-500 sm:max-w-[55%]">
          {o.delivery_address && (
            <>
              <MapPin size={13} className="mt-0.5 shrink-0" />
              <span className="line-clamp-1">{o.delivery_address}</span>
            </>
          )}
        </div>
        <div className="flex flex-col-reverse items-stretch gap-3 sm:ml-auto sm:flex-row sm:items-center sm:gap-4">
          {ulas && (
            <button type="button" onClick={() => onUlas(ulas)} className={cn(TOMBOL_GARIS, 'justify-center')}>
              Beri Ulasan
            </button>
          )}
          <div className="text-right">
            {o.shipping_cost > 0 && <div className="text-xs text-ink-500">Ongkir {formatMoney(o.shipping_cost)}</div>}
            <div className="text-xs text-ink-500">
              Total Pesanan <span className="ml-1 text-lg font-bold tabular-nums text-brand-600">{formatMoney(o.total)}</span>
            </div>
          </div>
        </div>
      </footer>
    </article>
  );
}

function ModalUlasan({
  item,
  token,
  onClose,
  onTerkirim,
}: {
  item: ReviewableItem | null;
  token: string;
  onClose: () => void;
  onTerkirim: () => void;
}) {
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRating(5);
    setBody('');
    setImages([]);
    setTags([]);
  }, [item?.order_id, item?.product_id]);

  if (!item) return null;

  async function tambahFoto(files: FileList | null) {
    if (!files) return;
    const baru: string[] = [];
    for (const f of Array.from(files).slice(0, 3 - images.length)) {
      try {
        const hasil = await resizeImageToDataUrl(f, { maxDim: 800, quality: 0.8 });
        baru.push(hasil.dataUrl);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Gagal memproses foto.');
      }
    }
    setImages((prev) => [...prev, ...baru].slice(0, 3));
  }

  async function kirim() {
    if (!item) return;
    setBusy(true);
    const { error } = await submitReview(token, {
      order_id: item.order_id,
      product_id: item.product_id,
      rating,
      body: body.trim(),
      images,
      tags,
    });
    setBusy(false);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success('Terima kasih, ulasan Anda sudah tampil di halaman produk.');
    onTerkirim();
  }

  return (
    <Modal open onClose={onClose} title="Beri Ulasan">
      <div className="space-y-4 text-sm">
        <div className="line-clamp-2 font-medium">{item.name}</div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((i) => (
              <button key={i} type="button" onClick={() => setRating(i)} aria-label={`${i} bintang`}>
                <Star size={30} className={i <= rating ? 'fill-amber-400 text-amber-400' : 'fill-ink-200 text-ink-200 dark:fill-ink-700 dark:text-ink-700'} />
              </button>
            ))}
          </div>
          <span className="text-xs text-ink-500">{LABEL_BINTANG[rating]}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {TAG_ULASAN.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tags.includes(t)}
              onClick={() => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t])}
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition',
                tags.includes(t)
                  ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-200'
                  : 'border-ink-200 hover:border-brand-300 dark:border-ink-700',
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <TextArea
          name="ulasan"
          label="Ulasan"
          placeholder="Bagaimana kualitas barang dan pelayanannya?"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div>
          <div className="mb-1.5 text-sm font-medium">Foto (maks. 3)</div>
          <div className="flex flex-wrap gap-2">
            {images.map((src, i) => (
              <span key={i} className="relative h-16 w-16 overflow-hidden rounded-lg ring-1 ring-ink-100 dark:ring-ink-800">
                <img src={src} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  aria-label="Hapus foto"
                  onClick={() => setImages(images.filter((_, j) => j !== i))}
                  className="absolute right-0.5 top-0.5 grid h-5 w-5 place-items-center rounded-full bg-black/60 text-white"
                >
                  <X size={11} />
                </button>
              </span>
            ))}
            {images.length < 3 && (
              <label className="grid h-16 w-16 cursor-pointer place-items-center rounded-lg border border-dashed border-ink-300 text-ink-400 hover:border-brand-400 hover:text-brand-600 dark:border-ink-700">
                <ImagePlus size={20} />
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    void tambahFoto(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button onClick={kirim} disabled={busy}>
            {busy ? 'Mengirim…' : 'Kirim Ulasan'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
