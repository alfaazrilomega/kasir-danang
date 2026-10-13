import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  Check,
  Copy,
  Landmark,
  LayoutDashboard,
  Link2,
  Lock,
  Mail,
  MessageCircle,
  Network,
  RefreshCw,
  Search,
  Share2,
  ShoppingBag,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { PublicShell } from '@/components/layout/PublicShell';
import { Link, useLocation, useNavigate } from '@/lib/router';
import { cn, formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { useCustomer } from '@/lib/customerAccount';
import {
  affiliateApi,
  LABEL_STATUS_KOMISI,
  LABEL_STATUS_UNDANGAN,
  linkAffiliate,
  statusKomisi,
  type AcquisitionRow,
  type AffiliateCharts,
  type AffiliateCommissionRow,
  type AffiliateInvitations,
  type AffiliateMe,
  type AffiliateNetwork,
  type AffiliateOrderRow,
  type AffiliateProduct,
  type AffiliateStat,
  type AffiliateBonusRow,
  type AffiliateCommissionTotals,
  type AffiliateDeductionRow,
  type AffiliateTarget,
  teksTarif,
  type InvitationStatus,
  type RentangTanggal,
} from '@/lib/affiliate';

type Tab = 'ringkasan' | 'link' | 'order' | 'komisi' | 'jaringan' | 'undang' | 'rekening';
const DAFTAR_TAB: Tab[] = ['ringkasan', 'link', 'order', 'komisi', 'jaringan', 'undang', 'rekening'];

const MENU: { tab: Tab; label: string; ikon: LucideIcon }[] = [
  { tab: 'ringkasan', label: 'Ringkasan', ikon: LayoutDashboard },
  { tab: 'link', label: 'Link', ikon: Link2 },
  { tab: 'order', label: 'Order', ikon: ShoppingBag },
  { tab: 'komisi', label: 'Komisi', ikon: Wallet },
  { tab: 'jaringan', label: 'Jaringan', ikon: Network },
  { tab: 'undang', label: 'Undang', ikon: Mail },
  { tab: 'rekening', label: 'Rekening', ikon: Landmark },
];

const JUDUL: Record<Tab, [string, string]> = {
  ringkasan: ['Ringkasan', 'Kinerja link dan undangan kamu.'],
  link: ['Link Affiliasi', 'Bagikan link ini. Pembelian lewat link tercatat atas namamu.'],
  order: ['Affiliasi Order', 'Pesanan yang datang lewat link atau undangan kamu.'],
  komisi: ['Affiliasi Komisi', 'Komisi masuk saat pesanan selesai, lalu dibayar admin ke rekeningmu.'],
  jaringan: ['Jaringan Anda', 'Member yang bergabung lewat link atau undangan kamu.'],
  undang: ['Undang Teman', 'Kirim undangan lewat email. Yang mendaftar menjadi jaringanmu.'],
  rekening: ['Informasi Rekening', 'Dipakai admin untuk mentransfer komisi.'],
};

const HURUF_BALAP = "font-['Barlow_Condensed',ui-sans-serif,sans-serif] italic";
const PANEL = 'rounded-lg bg-white shadow-card dark:bg-ink-900';
const KOLOM =
  'w-full rounded-md border border-ink-200 bg-white px-3 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100';
/** Huruf dasar 14px membuat h-11 hanya 38,5px, jadi tinggi sentuh ditulis dalam piksel. */
const TINGGI = 'h-[44px]';
const TOMBOL_UTAMA =
  'inline-flex h-[44px] items-center justify-center gap-2 rounded-md bg-brand-500 px-5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-600 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60';
const TOMBOL_GARIS =
  'inline-flex h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-md border border-ink-200 px-3 text-sm font-medium text-ink-700 transition-colors duration-150 hover:bg-ink-50 active:scale-[0.97] dark:border-ink-700 dark:text-ink-200 dark:hover:bg-ink-800';

const CHIP_KOMISI: Record<ReturnType<typeof statusKomisi>, string> = {
  pending: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  added: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
  paid: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  cancelled: 'bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300',
};
const CHIP_ORDER: Record<AffiliateOrderRow['status'], [string, string]> = {
  menunggu: ['Menunggu konfirmasi', CHIP_KOMISI.pending],
  selesai: ['Selesai', CHIP_KOMISI.paid],
  dibatalkan: ['Dibatalkan', CHIP_KOMISI.cancelled],
};
const CHIP_UNDANGAN: Record<InvitationStatus, string> = {
  sent: CHIP_KOMISI.added,
  opened: CHIP_KOMISI.pending,
  registered: CHIP_KOMISI.paid,
  failed: 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
  expired: CHIP_KOMISI.cancelled,
};

interface DataAffiliate {
  me: AffiliateMe;
  charts: AffiliateCharts | null;
  acquisition: AcquisitionRow[] | null;
  products: AffiliateProduct[] | null;
  orders: AffiliateOrderRow[] | null;
  commissions: { totals: AffiliateCommissionTotals; rows: AffiliateCommissionRow[]; bonuses: AffiliateBonusRow[]; deductions: AffiliateDeductionRow[] } | null;
  network: AffiliateNetwork | null;
  invitations: AffiliateInvitations | null;
}

/** Fixture hanya di mode pengembangan: `?fixture=ringkasan` dan seterusnya. */
const FIXTURE = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('fixture') : null;

function useDataAffiliate(token: string | null) {
  const [data, setData] = useState<DataAffiliate | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  // Bagian yang permintaannya gagal. Tanpa ini kegagalan terlihat seperti masih memuat.
  const [gagal, setGagal] = useState<ReadonlySet<keyof DataAffiliate>>(new Set());
  const [versi, setVersi] = useState(0);

  useEffect(() => {
    let batal = false;
    async function muat() {
      setGalat(null);
      setGagal(new Set());
      if (FIXTURE) {
        const { FIXTURE_AFFILIATE } = await import('@/lib/affiliateFixtures');
        const fx = FIXTURE_AFFILIATE[FIXTURE] ?? FIXTURE_AFFILIATE.ringkasan;
        if (!batal) setData({ ...fx });
        return;
      }
      if (!token) return;
      const me = await affiliateApi.me(token);
      if (batal) return;
      if (!me.data) {
        // Jaringan putus atau galat server: pesan AL-1. Penolakan yang disengaja
        // (misalnya bukan akun pembeli) tetap memakai pesan dari server.
        const sementara = me.status === 0 || me.status >= 500;
        setGalat(sementara || !me.error ? 'Data affiliate gagal dimuat. Coba lagi.' : me.error);
        return;
      }
      const dasar: DataAffiliate = {
        me: me.data,
        charts: null,
        acquisition: null,
        products: null,
        orders: null,
        commissions: null,
        network: null,
        invitations: null,
      };
      setData(dasar);
      if (!me.data.eligible) return;
      const [charts, acquisition, products, orders, commissions, network, invitations] = await Promise.all([
        affiliateApi.charts(token),
        affiliateApi.acquisition(token),
        affiliateApi.products(token),
        affiliateApi.orders(token),
        affiliateApi.commissions(token),
        affiliateApi.network(token),
        affiliateApi.invitations(token),
      ]);
      if (batal) return;
      const hasil = { charts, acquisition, products, orders, commissions, network, invitations };
      setGagal(new Set((Object.keys(hasil) as (keyof typeof hasil)[]).filter((k) => hasil[k].error)));
      setData({
        ...dasar,
        charts: charts.data,
        acquisition: acquisition.data,
        products: products.data,
        orders: orders.data,
        commissions: commissions.data,
        network: network.data,
        invitations: invitations.data,
      });
    }
    void muat();
    return () => {
      batal = true;
    };
  }, [token, versi]);

  return { data, setData, galat, gagal, muatUlang: () => setVersi((v) => v + 1) };
}

export function PublicAffiliate() {
  const navigate = useNavigate();
  const location = useLocation();
  const { token, ready } = useCustomer();
  const params = new URLSearchParams(location.search);
  const tab: Tab = DAFTAR_TAB.find((t) => t === params.get('tab')) ?? 'ringkasan';
  const { data, setData, galat, gagal, muatUlang } = useDataAffiliate(token);

  useEffect(() => {
    if (FIXTURE) return;
    // Tab ikut dibawa: tautan di email menuju tab tertentu (order, komisi).
    if (ready && !token) navigate(`/toko/masuk?next=${encodeURIComponent(`/toko/affiliate${location.search}`)}`, { replace: true });
    // Hanya bergantung pada sesi; alamat dibaca saat itu juga.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, token, navigate]);

  const setTab = (t: Tab) => {
    const q = new URLSearchParams(location.search);
    q.set('tab', t);
    navigate(`/toko/affiliate?${q.toString()}`, { replace: true });
    // Tiap tab mulai dari judulnya. Posisi gulir tab sebelumnya membuat judul dan
    // pilihan periode tersembunyi di bawah kepala toko yang menempel.
    window.scrollTo({ top: 0 });
  };

  // Menu HP digeser ke samping. Tab aktif digeser ke tengah supaya tetap terlihat,
  // termasuk saat halaman dibuka langsung di tab Undang atau Rekening.
  const navHp = useRef<HTMLElement>(null);
  const siap = !!data?.me.eligible;
  useEffect(() => {
    const nav = navHp.current;
    const aktif = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (nav && aktif) nav.scrollLeft = aktif.offsetLeft - (nav.clientWidth - aktif.offsetWidth) / 2;
  }, [tab, siap]);

  if (galat) {
    return (
      <PublicShell>
        <div className={cn(PANEL, 'mx-auto max-w-md p-6 text-center')} role="alert" data-gagal-muat>
          <p className="text-sm text-ink-700 dark:text-ink-200">{galat}</p>
          <button type="button" onClick={muatUlang} className={cn(TOMBOL_UTAMA, 'mt-4')}>
            <RefreshCw size={16} /> Coba lagi
          </button>
        </div>
      </PublicShell>
    );
  }

  if (!data) {
    return (
      <PublicShell>
        <div className="grid gap-3 lg:grid-cols-[232px_minmax(0,1fr)] lg:gap-4" aria-busy="true">
          <div className="hidden h-80 animate-pulse rounded-lg bg-ink-100 dark:bg-ink-800 lg:block" />
          <div className="space-y-3">
            <div className="h-24 animate-pulse rounded-lg bg-ink-100 dark:bg-ink-800" />
            <div className="h-56 animate-pulse rounded-lg bg-ink-100 dark:bg-ink-800" />
          </div>
        </div>
      </PublicShell>
    );
  }

  if (!data.me.eligible || !data.me.profile) {
    return (
      <PublicShell>
        <div className={cn(PANEL, 'mx-auto max-w-lg p-6 text-center sm:p-8')} data-affiliate-tanpa-akses>
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-ink-100 text-ink-500 dark:bg-ink-800">
            <Lock size={22} />
          </span>
          <h1 className="mt-3 text-lg font-semibold text-ink-900 dark:text-ink-100">
            {data.me.reason === 'program_off' ? 'Program affiliate belum dibuka' : 'Fitur affiliasi belum aktif untuk akunmu'}
          </h1>
          <p className="mt-2 whitespace-pre-line text-sm text-ink-600 dark:text-ink-300">{data.me.message}</p>
          <Link to="/toko/akun" className={cn(TOMBOL_GARIS, 'mt-5')}>
            <ArrowLeft size={16} /> Kembali ke akun
          </Link>
        </div>
      </PublicShell>
    );
  }

  const me = data.me;
  const profile = data.me.profile;

  const identitas = (
    <>
      <div className="flex items-center gap-3 bg-ink-900 px-4 pb-3 pt-4 text-white">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-500 text-lg font-bold">
          {profile.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <div className={cn(HURUF_BALAP, 'line-clamp-2 break-words text-xl font-extrabold uppercase leading-none')} title={profile.name}>
            {profile.name}
          </div>
          <div className="mt-1 truncate text-xs text-ink-300">
            Affiliate · kode <span className="font-mono font-semibold text-white">{profile.code}</span>
          </div>
        </div>
      </div>
      <div aria-hidden className="h-1.5 [background:repeating-conic-gradient(#141826_0_25%,#fff_0_50%)_0_0/6px_6px]" />
    </>
  );

  return (
    <PublicShell>
      <div
        className={cn(
          'grid items-start gap-y-3 pb-16 lg:grid-cols-[232px_minmax(0,1fr)] lg:gap-4 lg:pb-0',
          '[&_:is(a,button,input,select,textarea)]:scroll-mt-[calc(var(--tinggi-header,64px)+80px)]',
          'lg:[&_:is(a,button,input,select,textarea)]:scroll-mt-[calc(var(--tinggi-header,120px)+16px)]',
        )}
        data-affiliate-layar
      >
        <aside className={cn(PANEL, 'hidden overflow-hidden lg:sticky lg:top-[calc(var(--tinggi-header,120px)+16px)] lg:block')}>
          {identitas}
          <nav aria-label="Menu affiliate" className="py-2">
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
              </button>
            ))}
          </nav>
          <Link
            to="/toko/akun"
            className="flex w-full items-center gap-3 border-t border-ink-100 px-4 py-3 text-sm text-ink-500 transition-colors duration-150 hover:text-brand-600 dark:border-ink-800"
          >
            <ArrowLeft size={16} /> Kembali ke akun
          </Link>
        </aside>

        {/* min-w-0: tanpa ini isi grid selebar 7 menu (532px) dan halaman HP bergeser ke samping. */}
        <div className="min-w-0 lg:hidden">
          <div className="overflow-hidden rounded-t-lg">{identitas}</div>
          <nav
            ref={navHp}
            aria-label="Menu affiliate"
            className="tanpa-bilah sticky top-[var(--tinggi-header,64px)] z-10 flex overflow-x-auto rounded-b-lg border-b border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900"
          >
            {MENU.map((m) => (
              <button
                key={m.tab}
                type="button"
                onClick={() => setTab(m.tab)}
                aria-current={tab === m.tab ? 'page' : undefined}
                className={cn(
                  'flex min-w-[76px] shrink-0 flex-col items-center gap-1 px-2 py-2.5 text-[11px] font-medium transition-colors duration-150',
                  tab === m.tab ? 'text-brand-600 shadow-[inset_0_-2px_0_currentColor]' : 'text-ink-500',
                )}
              >
                <m.ikon size={19} />
                {m.label}
              </button>
            ))}
          </nav>
        </div>

        <section className="min-w-0">
          <div className="mb-3">
            <h1 className="text-lg font-semibold text-ink-900 dark:text-ink-100">{JUDUL[tab][0]}</h1>
            <p className="text-sm text-ink-500">{JUDUL[tab][1]}</p>
          </div>
          {tab === 'ringkasan' && (
            <TabRingkasan me={me} charts={data.charts} acquisition={data.acquisition} gagal={gagal} onUlang={muatUlang} onLink={() => setTab('link')} />
          )}
          {tab === 'link' && <TabLink code={profile.code} me={me} products={data.products} gagal={gagal.has('products')} onUlang={muatUlang} />}
          {tab === 'order' &&
            (gagal.has('orders') ? (
              <GagalMuat onUlang={muatUlang} />
            ) : (
              <TabOrder rows={data.orders} token={token} onLink={() => setTab('link')} />
            ))}
          {tab === 'komisi' &&
            (gagal.has('commissions') ? (
              <GagalMuat onUlang={muatUlang} />
            ) : (
              <TabKomisi
                data={data.commissions}
                rekeningKosong={!profile.bank_info}
                minimal={me.settings?.payout_minimum ?? 0}
                onRekening={() => setTab('rekening')}
                onLink={() => setTab('link')}
                token={token}
              />
            ))}
          {tab === 'jaringan' &&
            (gagal.has('network') ? (
              <GagalMuat onUlang={muatUlang} />
            ) : (
              <TabJaringan data={data.network} onUndang={() => setTab('undang')} />
            ))}
          {tab === 'undang' && gagal.has('invitations') && <GagalMuat onUlang={muatUlang} />}
          {tab === 'undang' && !gagal.has('invitations') && (
            <TabUndang
              data={data.invitations}
              masaBerlaku={me.settings?.invite_days ?? 7}
              token={token}
              onBerubah={(inv) => setData((d) => (d ? { ...d, invitations: inv } : d))}
            />
          )}
          {tab === 'rekening' && (
            <TabRekening
              awal={profile.bank_info ?? ''}
              token={token}
              onTersimpan={(bank) =>
                setData((d) => (d && d.me.profile ? { ...d, me: { ...d.me, profile: { ...d.me.profile, bank_info: bank } } } : d))
              }
            />
          )}
        </section>
      </div>
    </PublicShell>
  );
}

// ---------------------------------------------------------------------------
// Ringkasan

type Periode = 'today' | 'month' | 'all';
// "Semua", bukan "Sepanjang waktu": di HP tiga pilihan berbagi satu baris dan label panjang terlipat dua.
const LABEL_PERIODE: Record<Periode, string> = { today: 'Hari ini', month: 'Bulan ini', all: 'Semua' };

function TabRingkasan({
  me,
  charts,
  acquisition,
  gagal,
  onUlang,
  onLink,
}: {
  me: AffiliateMe;
  charts: AffiliateCharts | null;
  acquisition: AcquisitionRow[] | null;
  gagal: ReadonlySet<string>;
  onUlang: () => void;
  onLink: () => void;
}) {
  const [periode, setPeriode] = useState<Periode>('month');
  const [grafik, setGrafik] = useState<'month' | 'year'>('month');
  const [metrik, setMetrik] = useState<'omset' | 'sales'>('omset');
  const s: AffiliateStat = me.summary?.[periode] ?? { clicks: 0, leads: 0, sales: 0, omset: 0, commission: 0 };
  const kosongSemua = (me.summary?.all.clicks ?? 0) === 0 && (me.summary?.all.leads ?? 0) === 0;
  const konversi = s.clicks > 0 ? `${((s.sales / s.clicks) * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}% dari klik` : 'Belum ada klik';
  const titik = (charts?.[grafik] ?? []).map((p) => ({
    ...p,
    label: grafik === 'month' ? String(Number(p.key.slice(8, 10))) : BULAN[Number(p.key.slice(5, 7)) - 1],
  }));

  return (
    <div className="space-y-3">
      <div className="flex w-full gap-1 rounded-full bg-ink-100 p-1 text-sm font-semibold dark:bg-ink-800 sm:w-fit" role="tablist" aria-label="Periode">
        {(Object.keys(LABEL_PERIODE) as Periode[]).map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={periode === p}
            onClick={() => setPeriode(p)}
            className={cn(
              'min-h-[44px] flex-1 rounded-full px-3 transition-colors duration-150 sm:min-h-[36px] sm:flex-none sm:px-4',
              periode === p ? 'bg-white shadow-card dark:bg-ink-700' : 'text-ink-600 dark:text-ink-300',
            )}
          >
            {LABEL_PERIODE[p]}
          </button>
        ))}
      </div>

      {/* Rupiah butuh ruang lebih lebar dari hitungan, jadi Omset dan Komisi mendapat kolom 1,5 kali. */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-[1fr_1fr_1fr_1.5fr_1.5fr]" data-ringkasan-affiliate>
        <Ubin label="Klik" nilai={s.clicks.toLocaleString('id-ID')} />
        <Ubin label="Lead" nilai={s.leads.toLocaleString('id-ID')} ket="Tanpa pesanan batal" />
        <Ubin label="Sales" nilai={s.sales.toLocaleString('id-ID')} ket={konversi} />
        <Ubin label="Omset" nilai={formatMoney(s.omset)} ket="Barang di pesanan selesai" />
        <Ubin label="Komisi" nilai={formatMoney(s.commission)} ket="Belum + sudah dibayar" tonjol className="col-span-2 lg:col-span-1" />
      </div>

      {me.target && <KartuTarget t={me.target} />}

      {kosongSemua ? (
        <div className={cn(PANEL, 'p-5 text-center')}>
          <p className="text-sm font-medium text-ink-800 dark:text-ink-100">Belum ada kunjungan dari link kamu.</p>
          <p className="mt-1 text-sm text-ink-500">Bagikan link pertamamu ke grup atau status WhatsApp.</p>
          <button type="button" onClick={onLink} className={cn(TOMBOL_UTAMA, 'mt-4')}>
            <Link2 size={16} /> Buat link
          </button>
        </div>
      ) : (
        <>
          <div className={cn(PANEL, 'p-4')}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink-900 dark:text-ink-100">Grafik {metrik === 'omset' ? 'omset' : 'sales'}</h2>
              <div className="flex flex-wrap gap-2">
                <PilGrafik label="Angka grafik" nilai={metrik} onUbah={setMetrik} pilihan={[['omset', 'Omset'], ['sales', 'Sales']]} />
                <PilGrafik label="Periode grafik" nilai={grafik} onUbah={setGrafik} pilihan={[['month', 'Bulan ini'], ['year', 'Tahun ini']]} />
              </div>
            </div>
            {/* Server mengisi setiap tanggal dengan nol, jadi "kosong" berarti tidak ada angka sama sekali. */}
            {gagal.has('charts') ? (
              <GagalMuat onUlang={onUlang} polos />
            ) : charts === null ? (
              <div className="h-52 animate-pulse rounded-md bg-ink-100 dark:bg-ink-800" aria-busy="true" />
            ) : titik.every((t) => t[metrik] === 0) ? (
              <p className="py-10 text-center text-sm text-ink-500">Belum ada penjualan di periode ini.</p>
            ) : (
              <div className="h-52 text-ink-500 dark:text-ink-400">
                <ResponsiveContainer>
                  <BarChart data={titik} margin={{ left: 0, right: 4, top: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="4 4" vertical={false} className="stroke-ink-200 dark:stroke-ink-800" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="currentColor" tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      stroke="currentColor"
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                      tickFormatter={metrik === 'omset' ? ringkas : (v: number) => String(v)}
                      width={metrik === 'omset' ? 58 : 34}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(90,65,229,0.08)' }}
                      contentStyle={{ borderRadius: 12, border: 'none', background: 'rgba(20,24,38,0.95)', color: '#fff', fontSize: 12 }}
                      formatter={(v: number) => (metrik === 'omset' ? [formatMoney(v), 'Omset'] : [`${v} pesanan selesai`, 'Sales'])}
                      labelFormatter={(l: string) => (grafik === 'month' ? `Tanggal ${l}` : l)}
                    />
                    <Bar dataKey={metrik} fill="#5A41E5" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className={cn(PANEL, 'overflow-hidden')}>
            <h2 className="px-4 pt-4 text-sm font-semibold text-ink-900 dark:text-ink-100">Data akuisisi</h2>
            <p className="px-4 pb-3 text-xs text-ink-500">Asal pengunjung dan pembeli dari parameter link kamu, sepanjang waktu.</p>
            {gagal.has('acquisition') ? (
              <GagalMuat onUlang={onUlang} polos />
            ) : acquisition === null ? (
              <div className="mx-4 mb-4 h-24 animate-pulse rounded-md bg-ink-100 dark:bg-ink-800" />
            ) : acquisition.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-ink-500">Belum ada data.</p>
            ) : (
              <>
                <table className="hidden w-full text-sm md:table">
                  <thead className="bg-ink-50 text-left text-xs text-ink-500 dark:bg-ink-800/60">
                    <tr>
                      <th className="px-4 py-2 font-medium">Sumber trafik</th>
                      <th className="px-4 py-2 font-medium">ID</th>
                      <th className="px-4 py-2 text-right font-medium">View</th>
                      <th className="px-4 py-2 text-right font-medium">Lead</th>
                      <th className="px-4 py-2 text-right font-medium">Sale</th>
                      <th className="px-4 py-2 text-right font-medium">Nilai</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                    {acquisition.map((r) => (
                      <tr key={`${r.source}|${r.media}`}>
                        <td className="px-4 py-2.5 font-medium text-ink-900 dark:text-ink-100">{r.label}</td>
                        <td className="max-w-[220px] truncate px-4 py-2.5 text-ink-600 dark:text-ink-300">{r.media || '-'}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{r.views.toLocaleString('id-ID')}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{r.leads.toLocaleString('id-ID')}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{r.sales.toLocaleString('id-ID')}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(r.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <ul className="divide-y divide-ink-100 border-t border-ink-100 dark:divide-ink-800 dark:border-ink-800 md:hidden">
                  {acquisition.map((r) => (
                    <li key={`${r.source}|${r.media}`} className="px-4 py-3">
                      <div className="flex min-w-0 items-baseline gap-2">
                        <span className="shrink-0 text-sm font-semibold text-ink-900 dark:text-ink-100">{r.label}</span>
                        <span className="truncate text-xs text-ink-500">{r.media}</span>
                      </div>
                      <div className="mt-1.5 grid grid-cols-[repeat(3,minmax(0,1fr))_auto] gap-2 text-xs text-ink-500">
                        <span>View <b className="block text-sm font-semibold tabular-nums text-ink-800 dark:text-ink-100">{r.views.toLocaleString('id-ID')}</b></span>
                        <span>Lead <b className="block text-sm font-semibold tabular-nums text-ink-800 dark:text-ink-100">{r.leads.toLocaleString('id-ID')}</b></span>
                        <span>Sale <b className="block text-sm font-semibold tabular-nums text-ink-800 dark:text-ink-100">{r.sales.toLocaleString('id-ID')}</b></span>
                        <span className="text-right">Nilai <b className="block text-sm font-semibold tabular-nums text-ink-800 dark:text-ink-100">{formatMoney(r.value)}</b></span>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function ringkas(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} M`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`;
  if (n >= 1_000) return `${(n / 1_000).toLocaleString('id-ID', { maximumFractionDigits: 0 })} rb`;
  return String(n);
}

/** Target bonus bulan ini (D-38): omset bersih retur dibanding target, dan bonus yang didapat. */
function KartuTarget({ t }: { t: AffiliateTarget }) {
  const persen = Math.min(100, Math.round((t.omset / t.target) * 100));
  const besar = t.bonus_type === 'fixed' ? formatMoney(t.bonus_value) : `${t.bonus_value.toLocaleString('id-ID')}% dari omset bulan ini`;
  return (
    <div className={cn(PANEL, 'p-4')} data-kartu-target>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold text-ink-900 dark:text-ink-100">Target bonus bulan ini</h2>
        <span className="text-xs text-ink-500">Bonus {besar}</span>
      </div>
      <div className="mt-2 text-sm tabular-nums text-ink-700 dark:text-ink-200">
        <b className="text-ink-900 dark:text-white">{formatMoney(t.omset)}</b> dari {formatMoney(t.target)}
      </div>
      <div
        className="mt-2 h-2.5 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800"
        role="progressbar"
        aria-label="Omset bulan ini terhadap target"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={persen}
      >
        <div className={cn('h-full rounded-full', t.tercapai ? 'bg-emerald-500' : 'bg-brand-500')} style={{ width: `${persen}%` }} />
      </div>
      <p className="mt-2 text-xs text-ink-600 dark:text-ink-300">
        {t.tercapai
          ? `Target tercapai. Bonus ${formatMoney(t.bonus)} dibayar setelah bulan ini berakhir, selama omset tetap di atas target.`
          : `Kurang ${formatMoney(t.sisa)} lagi untuk mendapat bonus. Omset dihitung dari pesanan selesai, dikurangi retur.`}
      </p>
    </div>
  );
}

function Ubin({ label, nilai, ket, tonjol, className }: { label: string; nilai: string; ket?: string; tonjol?: boolean; className?: string }) {
  return (
    <div className={cn(PANEL, 'min-w-0 p-3 sm:p-4', tonjol && 'bg-brand-600 text-white dark:bg-brand-700', className)}>
      <div className={cn('text-xs font-medium', tonjol ? 'text-white/80' : 'text-ink-500')}>{label}</div>
      <div className={cn('mt-1 truncate text-lg font-bold tabular-nums sm:text-xl', !tonjol && 'text-ink-900 dark:text-ink-100')} title={nilai}>
        {nilai}
      </div>
      {ket && <div className={cn('mt-0.5 line-clamp-2 text-[11px]', tonjol ? 'text-white/85' : 'text-ink-500')}>{ket}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Link

function asalToko(): string {
  return window.location.origin;
}

async function salin(teks: string) {
  try {
    await navigator.clipboard.writeText(teks);
    toast.success('Link disalin.');
  } catch {
    toast.error('Gagal menyalin. Tahan teks link lalu salin manual.');
  }
}

function BarisLink({ id, label, link, pesanWa }: { id: string; label: string; link: string; pesanWa: string }) {
  const bisaBagikan = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const wa = `https://wa.me/?text=${encodeURIComponent(`${pesanWa} ${link}`)}`;
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-ink-500">
        {label}
      </label>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
        <input id={id} readOnly value={link} onFocus={(e) => e.currentTarget.select()} className={cn(KOLOM, TINGGI, 'min-w-0 font-mono text-[13px] sm:flex-1')} data-link-affiliate />
        <div className="grid grid-cols-3 gap-2 sm:flex">
          <button type="button" onClick={() => void salin(link)} className={TOMBOL_GARIS}>
            <Copy size={15} /> Salin
          </button>
          <a href={wa} target="_blank" rel="noreferrer" className={TOMBOL_GARIS}>
            <MessageCircle size={15} /> WhatsApp
          </a>
          <button
            type="button"
            disabled={!bisaBagikan}
            onClick={() => void navigator.share?.({ text: pesanWa, url: link }).catch(() => undefined)}
            className={cn(TOMBOL_GARIS, !bisaBagikan && 'hidden sm:hidden')}
          >
            <Share2 size={15} /> Bagikan
          </button>
        </div>
      </div>
    </div>
  );
}

function TabLink({ code, me, products, gagal, onUlang }: { code: string; me: AffiliateMe; products: AffiliateProduct[] | null; gagal: boolean; onUlang: () => void }) {
  const [q, setQ] = useState('');
  const [produk, setProduk] = useState<AffiliateProduct | null>(null);
  const [platform, setPlatform] = useState('');
  const [mediaId, setMediaId] = useState('');
  const [param, setParam] = useState<{ source?: string; media?: string }>({});
  const asal = asalToko();
  const hasil = useMemo(() => {
    const kata = q.trim().toLowerCase();
    if (!products || !kata) return [];
    return products
      .filter((p) => p.eligible && `${p.name} ${p.variant_label ?? ''} ${p.sku ?? ''}`.toLowerCase().includes(kata))
      .slice(0, 8);
  }, [products, q]);
  const hari = me.settings?.cookie_days ?? 30;

  return (
    <div className="space-y-3">
      <div className={cn(PANEL, 'flex flex-wrap items-center justify-between gap-3 p-4')}>
        <div>
          <div className="text-xs font-medium text-ink-500">Kode affiliate kamu</div>
          <div className="mt-0.5 font-mono text-2xl font-bold tracking-wider text-ink-900 dark:text-ink-100" data-kode-affiliate>
            {code}
          </div>
          {teksTarif(me.profile?.commission) && (
            <div className="mt-1 text-xs text-ink-600 dark:text-ink-300" data-tarif-affiliate>
              Komisi kamu {teksTarif(me.profile?.commission)}
              {me.profile?.commission?.[0]?.type === 'percentage' ? ' dari nilai barang' : ''}
            </div>
          )}
        </div>
        <button type="button" onClick={() => void salin(code)} className={TOMBOL_GARIS}>
          <Copy size={15} /> Salin kode
        </button>
      </div>

      <div className={cn(PANEL, 'space-y-4 p-4')}>
        <BarisLink id="link-toko" label="Link seluruh toko" link={linkAffiliate(asal, code, null, param)} pesanWa="Belanja part racing di GNNK Racing:" />

        <div>
          <label htmlFor="cari-produk-affiliate" className="mb-1 block text-xs font-medium text-ink-500">
            Link produk
          </label>
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              id="cari-produk-affiliate"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari nama produk atau SKU"
              className={cn(KOLOM, TINGGI, 'pl-9')}
              autoComplete="off"
            />
          </div>
          {products === null && gagal && <GagalMuat onUlang={onUlang} polos />}
          {products === null && !gagal && <div className="mt-2 h-10 animate-pulse rounded-md bg-ink-100 dark:bg-ink-800" />}
          {q.trim() !== '' && products !== null && (
            <ul className="mt-2 divide-y divide-ink-100 overflow-hidden rounded-md border border-ink-100 dark:divide-ink-800 dark:border-ink-800" role="listbox" aria-label="Hasil pencarian produk">
              {hasil.length === 0 && <li className="px-3 py-3 text-sm text-ink-500">Produk tidak ditemukan atau tidak diaffiliasikan.</li>}
              {hasil.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={produk?.id === p.id}
                    onClick={() => {
                      setProduk(p);
                      setQ('');
                    }}
                    className="flex min-h-[44px] w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-ink-50 dark:hover:bg-ink-800"
                  >
                    <span className="min-w-0">
                      <span className="line-clamp-2 text-ink-900 dark:text-ink-100">{p.name}</span>
                      {p.variant_label && <span className="block truncate font-mono text-[11px] text-ink-500">{p.variant_label}</span>}
                    </span>
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-brand-600">{formatMoney(p.price)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {produk && (
            <div className="mt-3 rounded-md bg-ink-50 p-3 dark:bg-ink-800/60">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0 text-sm font-medium text-ink-900 dark:text-ink-100">
                  <span className="line-clamp-2">{produk.name}</span>
                  {produk.variant_label && <span className="block font-mono text-[11px] font-normal text-ink-500">{produk.variant_label}</span>}
                </div>
                <button type="button" onClick={() => setProduk(null)} className="min-h-[44px] shrink-0 px-2 text-xs font-medium text-ink-500 hover:text-ink-800">
                  Ganti
                </button>
              </div>
              <BarisLink id="link-produk" label="Link produk ini" link={linkAffiliate(asal, code, produk.id, param)} pesanWa={`${produk.name}:`} />
            </div>
          )}
        </div>
        <p className="text-xs text-ink-500">Pembeli yang membuka link kamu tercatat atas namamu selama {hari === 0 ? 'seterusnya' : `${hari} hari`}.</p>
      </div>

      <form
        className={cn(PANEL, 'space-y-3 p-4')}
        onSubmit={(e) => {
          e.preventDefault();
          setParam({ source: platform || undefined, media: mediaId.trim() || undefined });
          toast.success(platform || mediaId.trim() ? 'Parameter ditambahkan ke link.' : 'Parameter dihapus dari link.');
        }}
      >
        <div>
          <h2 className="text-sm font-semibold text-ink-900 dark:text-ink-100">Tambah parameter ke link affiliasi kamu</h2>
          <p className="text-xs text-ink-500">Tambahkan platform dan ID supaya kamu tahu dari mana pengunjung dan pembelimu datang.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="param-platform" className="mb-1 block text-xs font-medium text-ink-500">
              Platform
            </label>
            <select id="param-platform" value={platform} onChange={(e) => setPlatform(e.target.value)} className={cn(KOLOM, TINGGI)}>
              <option value="">Pilih platform</option>
              {(me.settings?.platforms ?? []).map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="param-id" className="mb-1 block text-xs font-medium text-ink-500">
              ID
            </label>
            <input
              id="param-id"
              value={mediaId}
              onChange={(e) => setMediaId(e.target.value.replace(/[^\w-]/g, '-').slice(0, 40))}
              placeholder="Contoh: grup-crf-jatim"
              className={cn(KOLOM, TINGGI)}
            />
          </div>
        </div>
        <button type="submit" className={TOMBOL_UTAMA}>
          Tambahkan parameter
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Order

type FilterOrder = 'semua' | AffiliateOrderRow['status'];

function TabOrder({ rows: awal, token, onLink }: { rows: AffiliateOrderRow[] | null; token: string | null; onLink: () => void }) {
  const [filter, setFilter] = useState<FilterOrder>('semua');
  const { rentang, setRentang, data, memuat, terisi, galat, ulang } = useBerentang<AffiliateOrderRow[]>(awal, (r) =>
    token && !FIXTURE ? affiliateApi.orders(token, r) : Promise.resolve({ data: (awal ?? []).filter((o) => dalamRentang(o.created_at, r)), error: null }),
  );
  if (awal === null) return <KerangkaDaftar />;
  const rows = data ?? [];
  const tampil = filter === 'semua' ? rows : rows.filter((r) => r.status === filter);
  return (
    <div className="space-y-3">
      <PilihTanggal nilai={rentang} onUbah={setRentang} />
      <Saring<FilterOrder>
        nilai={filter}
        onUbah={setFilter}
        pilihan={[
          ['semua', `Semua (${rows.length})`],
          ['menunggu', 'Menunggu'],
          ['selesai', 'Selesai'],
          ['dibatalkan', 'Dibatalkan'],
        ]}
      />
      {memuat ? (
        <KerangkaDaftar />
      ) : galat ? (
        <GagalMuat onUlang={ulang} />
      ) : tampil.length === 0 ? (
        <Kosong
          teks={rows.length > 0 ? 'Tidak ada order dengan status ini.' : terisi ? 'Tidak ada order di rentang tanggal ini.' : 'Belum ada order dari link kamu.'}
          onLink={rows.length === 0 && !terisi ? onLink : undefined}
        />
      ) : (
        <ul className="space-y-2" data-daftar-order-affiliate>
          {tampil.map((o) => {
            const [label, chip] = CHIP_ORDER[o.status];
            return (
              <li key={o.order_number} className={cn(PANEL, 'p-3 sm:p-4')}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-sm font-semibold text-ink-900 dark:text-ink-100">{o.order_number}</span>
                  <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', chip)}>{label}</span>
                </div>
                <div className="mt-1 text-xs text-ink-500">
                  {formatDateTime(o.created_at)} · <span className="text-ink-700 dark:text-ink-300">{o.buyer_name}</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 border-t border-ink-100 pt-2 text-xs dark:border-ink-800">
                  <span className="text-ink-500">
                    Nilai barang <b className="block text-sm font-semibold tabular-nums text-ink-900 dark:text-ink-100">{formatMoney(o.items_value)}</b>
                  </span>
                  {/* Pesanan batal tidak menghasilkan komisi. Nilainya dicoret supaya sama dengan tab Komisi. */}
                  {o.status === 'dibatalkan' ? (
                    <span className="text-right text-ink-500">
                      Komisi dibatalkan <b className="block text-sm font-semibold tabular-nums text-ink-500 line-through dark:text-ink-400">{formatMoney(o.commission)}</b>
                    </span>
                  ) : (
                    <span className="text-right text-ink-500">
                      Komisi kamu <b className="block text-sm font-semibold tabular-nums text-brand-600">{formatMoney(o.commission)}</b>
                    </span>
                  )}
                </div>
                {o.returned_value > 0 && (
                  <div className="mt-1.5 text-xs text-amber-700 dark:text-amber-300">
                    Diretur {formatMoney(o.returned_value)}. Komisi barang yang diretur ikut dipotong.
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <CatatanBatas jumlah={rows.length} batas={200} apa="order" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Komisi

type FilterKomisi = 'semua' | ReturnType<typeof statusKomisi>;

function TabKomisi({
  data: awal,
  rekeningKosong,
  minimal,
  onRekening,
  onLink,
  token,
}: {
  data: { totals: AffiliateCommissionTotals; rows: AffiliateCommissionRow[]; bonuses: AffiliateBonusRow[]; deductions: AffiliateDeductionRow[] } | null;
  onLink: () => void;
  rekeningKosong: boolean;
  minimal: number;
  onRekening: () => void;
  token: string | null;
}) {
  const [filter, setFilter] = useState<FilterKomisi>('semua');
  // Rentang tanggal menyaring daftar saja. Tiga total di atas tetap menghitung semua komisi.
  const berentang = useBerentang<AffiliateCommissionRow[]>(awal?.rows ?? null, async (r) => {
    if (!token || FIXTURE) return { data: (awal?.rows ?? []).filter((k) => dalamRentang(k.created_at, r)), error: null };
    const hasil = await affiliateApi.commissions(token, r);
    return { data: hasil.data?.rows ?? null, error: hasil.error };
  });
  if (awal === null) return <KerangkaDaftar />;
  const data = { totals: awal.totals, rows: berentang.data ?? [] };
  const tampil = filter === 'semua' ? data.rows : data.rows.filter((r) => statusKomisi(r) === filter);
  const t = data.totals;
  // Yang akan ditransfer berikutnya (D-40): komisi + bonus - potongan.
  const bersih = t.unpaid + t.bonus_unpaid - t.deductions;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3" data-total-komisi>
        <Ubin label="Komisi potensial" nilai={formatMoney(t.pending)} ket="Order belum selesai" />
        <Ubin label="Belum dibayar" nilai={formatMoney(t.unpaid)} ket="Menunggu transfer admin" tonjol />
        <Ubin label="Sudah dibayar" nilai={formatMoney(t.paid)} ket="Total yang sudah ditransfer" />
      </div>
      {(t.bonus_unpaid > 0 || t.bonus_running > 0 || t.deductions > 0) && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3" data-total-bonus-potongan>
          {(t.bonus_unpaid > 0 || t.bonus_running > 0) && (
            <Ubin label="Bonus target" nilai={formatMoney(t.bonus_unpaid)} ket={t.bonus_running > 0 ? `+ ${formatMoney(t.bonus_running)} masih berjalan bulan ini` : 'Belum dibayar'} />
          )}
          {t.deductions > 0 && <Ubin label="Potongan" nilai={`- ${formatMoney(t.deductions)}`} ket="Dipotong dari transfer berikutnya" />}
          <Ubin label="Transfer berikutnya" nilai={formatMoney(Math.max(0, bersih))} ket="Komisi + bonus - potongan" />
        </div>
      )}
      {minimal > 0 && (
        <p className="text-xs text-ink-600 dark:text-ink-300" data-minimal-pencairan>
          Minimal pencairan {formatMoney(minimal)}.{' '}
          {bersih >= minimal ? 'Saldo kamu sudah mencukupi.' : `Kurang ${formatMoney(Math.max(0, minimal - bersih))} lagi.`}
        </p>
      )}
      {rekeningKosong && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <span>Isi informasi rekening supaya komisi bisa ditransfer.</span>
          <button type="button" onClick={onRekening} className="min-h-[44px] px-1 font-semibold underline underline-offset-2">
            Isi rekening
          </button>
        </div>
      )}
      <PilihTanggal nilai={berentang.rentang} onUbah={berentang.setRentang} />
      <Saring<FilterKomisi>
        nilai={filter}
        onUbah={setFilter}
        pilihan={[
          ['semua', 'Semua'],
          ['pending', LABEL_STATUS_KOMISI.pending],
          ['added', LABEL_STATUS_KOMISI.added],
          ['paid', LABEL_STATUS_KOMISI.paid],
          ['cancelled', LABEL_STATUS_KOMISI.cancelled],
        ]}
      />
      {berentang.memuat ? (
        <KerangkaDaftar />
      ) : berentang.galat ? (
        <GagalMuat onUlang={berentang.ulang} />
      ) : tampil.length === 0 ? (
        <Kosong
          teks={data.rows.length > 0 ? 'Tidak ada komisi dengan status ini.' : berentang.terisi ? 'Tidak ada komisi di rentang tanggal ini.' : 'Belum ada komisi.'}
          onLink={data.rows.length === 0 && !berentang.terisi ? onLink : undefined}
        />
      ) : (
        <ul className={cn(PANEL, 'divide-y divide-ink-100 dark:divide-ink-800')} data-daftar-komisi-affiliate>
          {tampil.map((k) => {
            const st = statusKomisi(k);
            return (
              <li key={k.id} className="flex items-start justify-between gap-3 p-3 sm:p-4">
                <div className="min-w-0">
                  <div className="line-clamp-2 text-sm text-ink-900 dark:text-ink-100">{k.product_name}</div>
                  <div className="mt-0.5 text-xs text-ink-500">
                    <span className="font-mono">{k.order_number}</span> · {formatDate(k.created_at)} · Tier {k.tier}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-semibold tabular-nums text-ink-900 dark:text-ink-100">{formatMoney(k.commission)}</div>
                  {k.commission < k.commission_original && (
                    <div className="text-[11px] tabular-nums text-amber-700 dark:text-amber-300" data-dipotong-retur>
                      Dipotong retur, awal <s>{formatMoney(k.commission_original)}</s>
                    </div>
                  )}
                  <span className={cn('mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold', CHIP_KOMISI[st])}>{LABEL_STATUS_KOMISI[st]}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <CatatanBatas jumlah={data.rows.length} batas={500} apa="komisi" />
      {awal.bonuses.length > 0 && (
        <section className={cn(PANEL, 'p-4')} data-daftar-bonus>
          <h2 className="text-sm font-semibold text-ink-900 dark:text-ink-100">Bonus target</h2>
          <ul className="mt-2 divide-y divide-ink-100 dark:divide-ink-800">
            {awal.bonuses.map((b) => (
              <li key={b.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0 text-sm">
                  <div className="text-ink-900 dark:text-ink-100">{namaBulan(b.month)}</div>
                  <div className="text-xs text-ink-500">
                    Omset {formatMoney(b.omset)} dari target {formatMoney(b.target)}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-semibold tabular-nums text-ink-900 dark:text-ink-100">{formatMoney(b.amount)}</div>
                  <span
                    className={cn(
                      'mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold',
                      b.paid ? CHIP_KOMISI.paid : b.status === 'berjalan' ? CHIP_KOMISI.pending : CHIP_KOMISI.added,
                    )}
                  >
                    {b.paid ? 'Sudah dibayar' : b.status === 'berjalan' ? 'Berjalan' : 'Belum dibayar'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {awal.deductions.length > 0 && (
        <section className={cn(PANEL, 'p-4')} data-daftar-potongan>
          <h2 className="text-sm font-semibold text-ink-900 dark:text-ink-100">Potongan</h2>
          <p className="text-xs text-ink-500">Komisi yang sudah ditransfer lalu barangnya diretur atau pesanannya dibatalkan.</p>
          <ul className="mt-2 divide-y divide-ink-100 dark:divide-ink-800">
            {awal.deductions.map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0 text-sm">
                  <div className="text-ink-900 dark:text-ink-100">{p.kind === 'retur' ? 'Barang diretur' : 'Pesanan dibatalkan'}</div>
                  <div className="text-xs text-ink-500">
                    <span className="font-mono">{p.order_number}</span> · {formatDate(p.created_at)}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-semibold tabular-nums text-ink-900 dark:text-ink-100">- {formatMoney(p.amount)}</div>
                  <span className={cn('mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold', p.settled ? CHIP_KOMISI.paid : CHIP_KOMISI.pending)}>
                    {p.settled ? 'Sudah dipotong' : 'Menunggu transfer berikutnya'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** "Oktober 2026" dari `2026-10-01`. */
function namaBulan(tanggal: string): string {
  return new Date(`${tanggal}T00:00:00`).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// Jaringan

function TabJaringan({ data, onUndang }: { data: AffiliateNetwork | null; onUndang: () => void }) {
  if (data === null) return <KerangkaDaftar />;
  return (
    <div className="space-y-3">
      {data.upline_name && (
        <div className={cn(PANEL, 'px-4 py-3 text-sm text-ink-600 dark:text-ink-300')}>
          Kamu bergabung lewat <b className="text-ink-900 dark:text-ink-100">{data.upline_name}</b>
        </div>
      )}
      {data.nodes.length === 0 ? (
        <div className={cn(PANEL, 'p-5 text-center')}>
          <p className="text-sm font-medium text-ink-800 dark:text-ink-100">Belum ada member yang bergabung lewat link atau undangan kamu.</p>
          <button type="button" onClick={onUndang} className={cn(TOMBOL_UTAMA, 'mt-4')}>
            <Mail size={16} /> Undang teman
          </button>
        </div>
      ) : (
        <ul className={cn(PANEL, 'divide-y divide-ink-100 dark:divide-ink-800')} data-pohon-jaringan>
          {data.nodes.map((n) => (
            <li key={n.id} className="py-3 pr-4" style={{ paddingLeft: `${16 + (n.depth - 1) * 22}px` }}>
              <div className={cn('flex min-w-0 items-center gap-3', n.depth > 1 && 'border-l-2 border-ink-100 pl-3 dark:border-ink-800')}>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-50 text-sm font-bold text-brand-700 dark:bg-brand-950/40 dark:text-brand-200">
                  {n.name.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <div className="break-words text-sm font-medium text-ink-900 dark:text-ink-100">{n.name}</div>
                  <div className="text-xs text-ink-500">
                    Bergabung {formatDate(n.joined_at)} · {n.downline_count} downline{n.depth > 1 ? ` · tingkat ${n.depth}` : ''}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Undang

function TabUndang({
  data,
  masaBerlaku,
  token,
  onBerubah,
}: {
  data: AffiliateInvitations | null;
  masaBerlaku: number;
  token: string | null;
  onBerubah: (inv: AffiliateInvitations) => void;
}) {
  const [email, setEmail] = useState('');
  const [nama, setNama] = useState('');
  const [pesan, setPesan] = useState('');
  const [galat, setGalat] = useState<string | null>(null);
  const [kirim, setKirim] = useState(false);
  if (data === null) return <KerangkaDaftar />;
  // 0 = tanpa batas harian (D-35).
  const penuh = data.daily_limit > 0 && data.sent_today >= data.daily_limit;

  async function onKirim(e: FormEvent) {
    e.preventDefault();
    if (!data) return;
    const bersih = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bersih)) {
      setGalat('Email tidak valid.');
      return;
    }
    if (!token || FIXTURE) {
      toast.success(`Undangan terkirim ke ${bersih}.`);
      return;
    }
    setKirim(true);
    const r = await affiliateApi.invite(token, { email: bersih, name: nama.trim() || undefined, message: pesan.trim() || undefined });
    setKirim(false);
    if (!r.data) {
      setGalat(r.error ?? 'Undangan gagal dikirim.');
      return;
    }
    setGalat(null);
    setEmail('');
    setNama('');
    setPesan('');
    onBerubah({ ...data, sent_today: data.sent_today + 1, rows: [r.data, ...data.rows] });
    toast.success(`Undangan terkirim ke ${bersih}.`);
  }

  async function onUlang(id: string) {
    if (!data || !token || FIXTURE) return;
    const r = await affiliateApi.resend(token, id);
    if (!r.data) {
      toast.error(r.error ?? 'Gagal mengirim ulang.');
      return;
    }
    onBerubah({ ...data, sent_today: data.sent_today + 1, rows: data.rows.map((x) => (x.id === id ? r.data! : x)) });
    toast.success(`Undangan dikirim ulang ke ${r.data.email}.`);
  }

  return (
    <div className="space-y-3">
      <form onSubmit={(e) => void onKirim(e)} className={cn(PANEL, 'space-y-3 p-4')} noValidate>
        <div>
          <label htmlFor="undang-email" className="mb-1 block text-xs font-medium text-ink-500">
            Email teman <span className="text-rose-600 dark:text-rose-400">*</span>
          </label>
          <input
            id="undang-email"
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setGalat(null);
            }}
            placeholder="nama@gmail.com"
            aria-invalid={!!galat}
            aria-describedby={galat ? 'undang-galat' : undefined}
            className={cn(KOLOM, TINGGI, galat && 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/20')}
          />
          {galat && (
            <p id="undang-galat" className="mt-1 text-xs font-medium text-rose-600 dark:text-rose-400" role="alert">
              {galat}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="undang-nama" className="mb-1 block text-xs font-medium text-ink-500">
            Nama (opsional)
          </label>
          <input id="undang-nama" value={nama} maxLength={80} onChange={(e) => setNama(e.target.value)} className={cn(KOLOM, TINGGI, 'sm:max-w-sm')} />
        </div>
        <div>
          <label htmlFor="undang-pesan" className="mb-1 block text-xs font-medium text-ink-500">
            Pesan pribadi (opsional)
          </label>
          <textarea
            id="undang-pesan"
            value={pesan}
            maxLength={300}
            rows={3}
            onChange={(e) => setPesan(e.target.value)}
            placeholder="Contoh: Ini toko part racing langgananku, barangnya ori."
            className={cn(KOLOM, 'py-2')}
          />
          <div className="mt-0.5 flex justify-between gap-2 text-[11px] text-ink-500">
            <span>Tanpa tautan atau alamat web.</span>
            <span>{pesan.length}/300</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5 text-xs text-ink-500">
            <span data-kuota-undangan>
              {data.daily_limit > 0 ? `${data.sent_today} dari ${data.daily_limit} undangan hari ini` : `${data.sent_today} undangan hari ini · tanpa batas harian`}
            </span>
            <span>Tautan undangan berlaku {masaBerlaku} hari.</span>
          </div>
          <button type="submit" disabled={kirim || penuh} className={TOMBOL_UTAMA}>
            <Mail size={16} /> {penuh ? 'Batas hari ini tercapai' : kirim ? 'Mengirim...' : 'Kirim undangan'}
          </button>
        </div>
      </form>

      {data.rows.length === 0 ? (
        <Kosong teks="Belum ada undangan yang dikirim." />
      ) : (
        <ul className={cn(PANEL, 'divide-y divide-ink-100 dark:divide-ink-800')} data-daftar-undangan>
          {data.rows.map((u) => (
            <li key={u.id} className="flex flex-wrap items-start justify-between gap-2 p-3 sm:p-4">
              <div className="min-w-0 flex-1">
                <div className="break-all text-sm font-medium text-ink-900 dark:text-ink-100">{u.email}</div>
                <div className="mt-0.5 text-xs text-ink-500">
                  {u.name ? `${u.name} · ` : ''}Dikirim {formatDate(u.sent_at)}
                  {u.status !== 'registered' && u.status !== 'expired' && ` · berlaku sampai ${formatDate(u.expires_at)}`}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', CHIP_UNDANGAN[u.status])}>{LABEL_STATUS_UNDANGAN[u.status]}</span>
                {u.can_resend && (
                  <button type="button" onClick={() => void onUlang(u.id)} className={cn(TOMBOL_GARIS, 'px-2.5 text-xs sm:h-[36px]')}>
                    <RefreshCw size={13} /> Kirim ulang
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rekening

function TabRekening({ awal, token, onTersimpan }: { awal: string; token: string | null; onTersimpan: (bank: string | null) => void }) {
  const [isi, setIsi] = useState(awal);
  const [simpan, setSimpan] = useState(false);
  const [baru, setBaru] = useState(false);
  return (
    <form
      className={cn(PANEL, 'space-y-3 p-4')}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!token || FIXTURE) {
          toast.success('Informasi rekening tersimpan.');
          return;
        }
        setSimpan(true);
        const r = await affiliateApi.saveBank(token, isi.trim());
        setSimpan(false);
        if (r.error) {
          toast.error(r.error);
          return;
        }
        onTersimpan(r.data?.bank_info ?? null);
        setBaru(true);
        window.setTimeout(() => setBaru(false), 2000);
        toast.success('Informasi rekening tersimpan.');
      }}
    >
      <label htmlFor="rekening" className="block text-xs font-medium text-ink-500">
        Informasi rekening
      </label>
      <textarea
        id="rekening"
        value={isi}
        maxLength={300}
        rows={3}
        onChange={(e) => setIsi(e.target.value)}
        placeholder="Contoh: BCA 1234567890 a.n. Andi Saputra"
        className={cn(KOLOM, 'py-2')}
        data-rekening
      />
      <p className="text-xs text-ink-500">Tulis nama bank, nomor rekening, dan nama pemilik rekening.</p>
      <button type="submit" disabled={simpan} className={TOMBOL_UTAMA}>
        {baru ? <Check size={16} /> : null}
        {simpan ? 'Menyimpan...' : 'Simpan'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Bagian kecil

/** Tanggal lokal `YYYY-MM-DD` dari waktu ISO, untuk menyaring data contoh di mode pengembangan. */
function dalamRentang(iso: string, r: RentangTanggal): boolean {
  const d = new Date(iso);
  const hari = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return (!r.from || hari >= r.from) && (!r.to || hari <= r.to);
}

/**
 * Daftar yang bisa disaring rentang tanggal. Tanpa rentang dipakai daftar awal
 * yang sudah dimuat. Dengan rentang, daftar diminta ulang ke server supaya batas
 * jumlah baris berlaku di dalam rentang itu, bukan memotong data lama.
 */
function useBerentang<T>(awal: T | null, muat: (r: RentangTanggal) => Promise<{ data: T | null; error: string | null }>) {
  const [rentang, setRentang] = useState<RentangTanggal>({});
  const [hasil, setHasil] = useState<T | null>(null);
  const [memuat, setMemuat] = useState(false);
  // Gagal memuat tidak boleh tampil sebagai "tidak ada data di rentang ini".
  const [galat, setGalat] = useState(false);
  const [versi, setVersi] = useState(0);
  const terisi = !!(rentang.from || rentang.to);
  useEffect(() => {
    if (!terisi) {
      setHasil(null);
      setMemuat(false);
      setGalat(false);
      return;
    }
    let batal = false;
    setMemuat(true);
    setGalat(false);
    void muat(rentang).then((r) => {
      if (batal) return;
      setGalat(!!r.error);
      setHasil(r.data);
      setMemuat(false);
    });
    return () => {
      batal = true;
    };
    // Hanya rentang (dan coba lagi) yang memicu muat ulang; fungsi muat dibuat ulang tiap render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rentang.from, rentang.to, versi]);
  return { rentang, setRentang, data: terisi ? hasil : awal, memuat: terisi && memuat, terisi, galat: terisi && galat, ulang: () => setVersi((v) => v + 1) };
}

/** Rentang tanggal untuk daftar Order dan Komisi. Kosong berarti semua tanggal. */
function PilihTanggal({ nilai, onUbah }: { nilai: RentangTanggal; onUbah: (r: RentangTanggal) => void }) {
  return (
    <div className={cn(PANEL, 'grid grid-cols-2 items-end gap-2 p-3 sm:flex sm:flex-wrap sm:gap-3')} data-rentang-tanggal>
      <div className="min-w-0">
        <label htmlFor="dari-tanggal" className="mb-1 block text-xs font-medium text-ink-500">
          Dari tanggal
        </label>
        <input
          id="dari-tanggal"
          type="date"
          value={nilai.from ?? ''}
          max={nilai.to || undefined}
          onChange={(e) => onUbah({ ...nilai, from: e.target.value || undefined })}
          className={cn(KOLOM, TINGGI, 'min-w-0 sm:w-44')}
        />
      </div>
      <div className="min-w-0">
        <label htmlFor="sampai-tanggal" className="mb-1 block text-xs font-medium text-ink-500">
          Sampai tanggal
        </label>
        <input
          id="sampai-tanggal"
          type="date"
          value={nilai.to ?? ''}
          min={nilai.from || undefined}
          onChange={(e) => onUbah({ ...nilai, to: e.target.value || undefined })}
          className={cn(KOLOM, TINGGI, 'min-w-0 sm:w-44')}
        />
      </div>
      {(nilai.from || nilai.to) && (
        <button type="button" onClick={() => onUbah({})} className={cn(TOMBOL_GARIS, 'col-span-2 sm:col-span-1')}>
          Semua tanggal
        </button>
      )}
    </div>
  );
}

/** Pilihan kecil di kepala grafik (angka yang digambar dan periodenya). */
function PilGrafik<T extends string>({ label, nilai, onUbah, pilihan }: { label: string; nilai: T; onUbah: (v: T) => void; pilihan: [T, string][] }) {
  return (
    <div className="flex gap-1 rounded-full bg-ink-100 p-1 text-xs font-semibold dark:bg-ink-800" role="group" aria-label={label}>
      {pilihan.map(([v, teks]) => (
        <button
          key={v}
          type="button"
          onClick={() => onUbah(v)}
          aria-pressed={nilai === v}
          className={cn('min-h-[44px] rounded-full px-3 sm:min-h-[36px]', nilai === v ? 'bg-white shadow-card dark:bg-ink-700' : 'text-ink-600 dark:text-ink-300')}
        >
          {teks}
        </button>
      ))}
    </div>
  );
}

/** Server membatasi panjang daftar. Saat batas tercapai, pengguna diberi tahu daftar tidak lengkap. */
function CatatanBatas({ jumlah, batas, apa }: { jumlah: number; batas: number; apa: string }) {
  if (jumlah < batas) return null;
  return (
    <p className="text-xs text-ink-500" data-catatan-batas>
      Menampilkan {batas} {apa} terbaru. Angka ringkasan tetap menghitung semuanya.
    </p>
  );
}

function Saring<T extends string>({ nilai, onUbah, pilihan }: { nilai: T; onUbah: (v: T) => void; pilihan: [T, string][] }) {
  return (
    <div className="tanpa-bilah -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0" role="tablist">
      {pilihan.map(([v, label]) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={nilai === v}
          onClick={() => onUbah(v)}
          className={cn(
            'min-h-[44px] shrink-0 whitespace-nowrap rounded-full border px-3 text-xs font-semibold transition-colors duration-150 sm:min-h-[36px]',
            nilai === v
              ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-200'
              : 'border-ink-200 bg-white text-ink-600 hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Keadaan kosong. `onLink` menambahkan langkah berikut: membuat link untuk dibagikan. */
function Kosong({ teks, onLink }: { teks: string; onLink?: () => void }) {
  return (
    <div className={cn(PANEL, 'p-6 text-center text-sm text-ink-500')}>
      <p>{teks}</p>
      {onLink && (
        <>
          <p className="mt-1">Komisi masuk dari pesanan lewat link atau undangan kamu.</p>
          <button type="button" onClick={onLink} className={cn(TOMBOL_UTAMA, 'mt-4')}>
            <Link2 size={16} /> Buat link
          </button>
        </>
      )}
    </div>
  );
}

/** Permintaan gagal: pesan AL-1 dan tombol coba lagi. `polos` untuk dipakai di dalam panel lain. */
function GagalMuat({ onUlang, polos }: { onUlang: () => void; polos?: boolean }) {
  return (
    <div className={cn(polos ? 'px-4 py-6' : cn(PANEL, 'p-6'), 'text-center')} role="alert" data-gagal-muat>
      <p className="text-sm text-ink-700 dark:text-ink-200">Data affiliate gagal dimuat. Coba lagi.</p>
      <button type="button" onClick={onUlang} className={cn(TOMBOL_UTAMA, 'mt-3')}>
        <RefreshCw size={16} /> Coba lagi
      </button>
    </div>
  );
}

function KerangkaDaftar() {
  return (
    <div className="space-y-2" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-lg bg-ink-100 dark:bg-ink-800" />
      ))}
    </div>
  );
}
