import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  Banknote,
  Download,
  Eye,
  Image as IkonGambar,
  Megaphone,
  MousePointerClick,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings as IkonPengaturan,
  ShoppingCart,
  Trash2,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { cn, formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { resizeImageToDataUrl } from '@/lib/imageUpload';
import { buildCsv, dateTime as csvDateTime, int as csvInt } from '@/lib/csvFormat';
import { downloadFile } from '@/lib/dataTransfer';
import {
  affiliateAdminApi,
  LABEL_AKSES,
  LABEL_STATUS_KOMISI,
  LABEL_STATUS_UNDANGAN,
  PRESET_TARIF,
  statusKomisi,
  teksTarif,
  type AdminCommissionRow,
  type AdminInvitationRow,
  type AdminMemberRow,
  type AdminOverview,
  type AffiliateAccess,
  type AffiliateSettings,
  type CommissionTier,
  type NetworkNode,
  type PayoutHistoryRow,
  type PayoutSummaryRow,
  type RentangTanggal,
} from '@/lib/affiliate';

type Tab = 'ringkasan' | 'komisi' | 'pembayaran' | 'affiliate' | 'pengaturan';
const TABS: { value: Tab; label: string; ikon: LucideIcon }[] = [
  { value: 'ringkasan', label: 'Ringkasan', ikon: Megaphone },
  { value: 'komisi', label: 'Komisi', ikon: Wallet },
  { value: 'pembayaran', label: 'Pembayaran', ikon: Banknote },
  { value: 'affiliate', label: 'Affiliate', ikon: Users },
  { value: 'pengaturan', label: 'Pengaturan', ikon: IkonPengaturan },
];

const FIXTURE = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('fixture') : null;
const KOLOM =
  'w-full rounded-xl border border-ink-200 bg-white px-3 text-sm outline-none transition-colors duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-ink-700 dark:bg-ink-900';
const TINGGI = 'h-[44px] sm:h-[38px]';
/** Target sentuh 44px di HP; di desktop tombol kembali ke ukuran admin biasa. */
const SENTUH = 'min-h-[44px] sm:min-h-0';

const TONE_KOMISI: Record<ReturnType<typeof statusKomisi>, 'warning' | 'info' | 'success' | 'neutral'> = {
  pending: 'warning',
  added: 'info',
  paid: 'success',
  cancelled: 'neutral',
};

function tabAwal(): Tab {
  const t = new URLSearchParams(window.location.search).get('tab');
  return TABS.some((x) => x.value === t) ? (t as Tab) : 'ringkasan';
}

export function AffiliateAdmin() {
  const [tab, setTabState] = useState<Tab>(tabAwal);
  const [settings, setSettings] = useState<AffiliateSettings | null>(null);
  const [galatPengaturan, setGalatPengaturan] = useState(false);
  const [versiPengaturan, setVersiPengaturan] = useState(0);

  const setTab = (t: Tab) => {
    setTabState(t);
    const q = new URLSearchParams(window.location.search);
    q.set('tab', t);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${q.toString()}`);
  };

  useEffect(() => {
    let batal = false;
    void (async () => {
      if (FIXTURE) {
        const m = await import('@/lib/affiliateFixtures');
        if (!batal) setSettings(FIXTURE === 'kosong' ? { ...m.FIXTURE_SETTINGS, enabled: false } : m.FIXTURE_SETTINGS);
        return;
      }
      const r = await affiliateAdminApi.settings();
      if (batal) return;
      if (r.data) setSettings(r.data);
      if (r.error) toast.error(r.error.message);
      setGalatPengaturan(!!r.error);
    })();
    return () => {
      batal = true;
    };
  }, [versiPengaturan]);

  return (
    <div className="space-y-5" data-affiliate-layar>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-brand-600 p-6 text-white md:p-8">
        <div>
          <h1 className="text-2xl font-bold">Affiliate</h1>
          <p className="text-sm opacity-80">
            {settings === null
              ? galatPengaturan
                ? 'Pengaturan gagal dimuat.'
                : 'Memuat pengaturan...'
              : settings.enabled
                ? `Program aktif · ${settings.access_mode === 'all' ? 'semua member boleh' : 'hanya member yang diizinkan'} · cookie ${settings.cookie_days === 0 ? 'selamanya' : `${settings.cookie_days} hari`}`
                : 'Program belum aktif. Nyalakan di tab Pengaturan.'}
          </p>
        </div>
        {settings && !settings.enabled && (
          <Button variant="onBrand" onClick={() => setTab('pengaturan')}>
            <IkonPengaturan size={16} /> Buka pengaturan
          </Button>
        )}
      </div>

      <div className="tanpa-bilah -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex w-max gap-1 rounded-full bg-ink-100 p-1 text-sm font-semibold dark:bg-ink-800" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={tab === t.value}
              onClick={() => setTab(t.value)}
              className={cn(
                'flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-full px-4 sm:min-h-[34px]',
                tab === t.value ? 'bg-white shadow-card dark:bg-ink-700' : 'text-ink-600 dark:text-ink-300',
              )}
            >
              <t.ikon size={14} /> {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'ringkasan' && <TabRingkasan />}
      {tab === 'komisi' && <TabKomisi />}
      {tab === 'pembayaran' && <TabPembayaran minimal={settings?.payout_minimum ?? 0} />}
      {tab === 'affiliate' && <TabAnggota programAktif={settings ? settings.enabled : null} onBukaPengaturan={() => setTab('pengaturan')} />}
      {tab === 'pengaturan' && settings && <TabPengaturan awal={settings} onTersimpan={setSettings} />}
      {tab === 'pengaturan' &&
        !settings &&
        (galatPengaturan ? (
          <GagalMuat
            onUlang={() => {
              setGalatPengaturan(false);
              setVersiPengaturan((v) => v + 1);
            }}
          />
        ) : (
          <Kerangka />
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rentang tanggal

type Preset = '7' | '30' | 'bulan-ini' | 'bulan-lalu' | 'semua' | 'atur';
const PRESET: [Preset, string][] = [
  ['7', '7 hari'],
  ['30', '30 hari'],
  ['bulan-ini', 'Bulan ini'],
  ['bulan-lalu', 'Bulan lalu'],
  ['semua', 'Semua'],
];

function isoLokal(d: Date): string {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return z.toISOString().slice(0, 10);
}

function rentangDariPreset(p: Preset): RentangTanggal {
  const kini = new Date();
  if (p === '7' || p === '30') {
    const awal = new Date(kini);
    awal.setDate(awal.getDate() - (Number(p) - 1));
    return { from: isoLokal(awal), to: isoLokal(kini) };
  }
  if (p === 'bulan-ini') return { from: isoLokal(new Date(kini.getFullYear(), kini.getMonth(), 1)), to: isoLokal(kini) };
  if (p === 'bulan-lalu') {
    return { from: isoLokal(new Date(kini.getFullYear(), kini.getMonth() - 1, 1)), to: isoLokal(new Date(kini.getFullYear(), kini.getMonth(), 0)) };
  }
  return {};
}

function PilihRentang({ nilai, onUbah }: { nilai: { preset: Preset; r: RentangTanggal }; onUbah: (v: { preset: Preset; r: RentangTanggal }) => void }) {
  return (
    // w-full di HP: sebagai anak flex, lebarnya mengikuti isi dan kolom tanggal kedua menembus tepi kartu.
    <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
      <div className="tanpa-bilah flex max-w-full gap-1 overflow-x-auto">
        {PRESET.map(([p, label]) => (
          <button
            key={p}
            type="button"
            onClick={() => onUbah({ preset: p, r: rentangDariPreset(p) })}
            className={cn(
              'min-h-[44px] shrink-0 whitespace-nowrap rounded-full px-3 text-xs font-semibold sm:min-h-[36px]',
              nilai.preset === p ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex w-full items-center gap-1.5 text-xs sm:w-auto">
        <input
          type="date"
          aria-label="Dari tanggal"
          value={nilai.r.from ?? ''}
          onChange={(e) => onUbah({ preset: 'atur', r: { ...nilai.r, from: e.target.value || undefined } })}
          className={cn(KOLOM, 'h-[44px] min-w-0 flex-1 text-xs sm:h-[36px] sm:w-[150px] sm:flex-none')}
        />
        <span className="shrink-0 text-ink-500">s.d.</span>
        <input
          type="date"
          aria-label="Sampai tanggal"
          value={nilai.r.to ?? ''}
          onChange={(e) => onUbah({ preset: 'atur', r: { ...nilai.r, to: e.target.value || undefined } })}
          className={cn(KOLOM, 'h-[44px] min-w-0 flex-1 text-xs sm:h-[36px] sm:w-[150px] sm:flex-none')}
        />
      </div>
    </div>
  );
}

function useRentang(awal: Preset = '30') {
  return useState<{ preset: Preset; r: RentangTanggal }>(() => ({ preset: awal, r: rentangDariPreset(awal) }));
}

// ---------------------------------------------------------------------------
// Ringkasan

type UrutAnggota = 'omset' | 'sales' | 'clicks' | 'commission_unpaid';

function TabRingkasan() {
  const [rentang, setRentang] = useRentang('30');
  const [data, setData] = useState<AdminOverview | null>(null);
  const [galat, setGalat] = useState(false);
  const [versi, setVersi] = useState(0);
  const [urut, setUrut] = useState<UrutAnggota>('omset');

  useEffect(() => {
    let batal = false;
    setData(null);
    void (async () => {
      if (FIXTURE) {
        const m = await import('@/lib/affiliateFixtures');
        if (!batal)
          setData(
            FIXTURE === 'kosong'
              ? { ...m.FIXTURE_OVERVIEW, eligible_affiliates: 0, active_affiliates: 0, affiliates: [], top_products: [], totals: { clicks: 0, leads: 0, sales: 0, omset: 0, commission: 0, pending: 0, unpaid: 0, paid: 0 } }
              : m.FIXTURE_OVERVIEW,
          );
        return;
      }
      const r = await affiliateAdminApi.overview(rentang.r);
      if (batal) return;
      if (r.error) toast.error(r.error.message);
      setGalat(!!r.error);
      setData(r.data);
    })();
    return () => {
      batal = true;
    };
  }, [rentang, versi]);

  const daftar = useMemo(() => {
    if (!data) return [];
    const kunci = (a: AdminOverview['affiliates'][number]) =>
      urut === 'commission_unpaid' ? a.commission_unpaid : urut === 'clicks' ? a.clicks : urut === 'sales' ? a.sales : a.omset;
    return [...data.affiliates].sort((a, b) => kunci(b) - kunci(a));
  }, [data, urut]);

  return (
    <div className="space-y-4">
      <PilihRentang nilai={rentang} onUbah={setRentang} />
      {galat ? (
        <GagalMuat
          onUlang={() => {
            setGalat(false);
            setVersi((v) => v + 1);
          }}
        />
      ) : data === null ? (
        <Kerangka />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-ringkasan-admin>
            <Ubin ikon={Users} label="Affiliate aktif" nilai={`${data.active_affiliates} dari ${data.eligible_affiliates}`} ket="Punya klik atau pesanan di rentang ini" />
            <Ubin ikon={MousePointerClick} label="Klik" nilai={data.totals.clicks.toLocaleString('id-ID')} ket={`${data.totals.leads.toLocaleString('id-ID')} lead`} />
            <Ubin ikon={ShoppingCart} label="Sales" nilai={data.totals.sales.toLocaleString('id-ID')} ket={`Omset ${formatMoney(data.totals.omset)}`} />
            <Ubin ikon={Wallet} label="Komisi" nilai={formatMoney(data.totals.commission)} ket="Belum + sudah dibayar" />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Ubin label="Komisi potensial" nilai={formatMoney(data.totals.pending)} ket="Order belum selesai" />
            <Ubin label="Komisi belum dibayar" nilai={formatMoney(data.totals.unpaid)} ket="Siap dibayar" tonjol />
            <Ubin label="Komisi sudah dibayar" nilai={formatMoney(data.totals.paid)} ket="Di rentang ini" />
          </div>

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 p-4">
              <h2 className="text-sm font-semibold">Kinerja per affiliate</h2>
              <select value={urut} onChange={(e) => setUrut(e.target.value as UrutAnggota)} className={cn(KOLOM, TINGGI, 'w-auto text-xs font-semibold')} aria-label="Urutkan">
                <option value="omset">Omset tertinggi</option>
                <option value="sales">Sales terbanyak</option>
                <option value="clicks">Klik terbanyak</option>
                <option value="commission_unpaid">Komisi belum dibayar</option>
              </select>
            </div>
            {daftar.length === 0 ? (
              <p className="px-4 pb-6 text-sm text-ink-500">Belum ada affiliate dengan aktivitas di rentang ini.</p>
            ) : (
              <>
              {/* Di bawah 1280px wadah isi lebih sempit dari tabelnya, jadi dipakai kartu supaya tidak ada kolom yang keluar layar. */}
              <ul className="divide-y divide-ink-100 border-t border-ink-100 dark:divide-ink-800 dark:border-ink-800 xl:hidden" data-kartu-kinerja>
                {daftar.map((a) => (
                  <li key={a.id} className="space-y-2 px-4 py-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium" title={a.name}>
                          {a.name}
                        </div>
                        <div className="font-mono text-[11px] text-ink-500">{a.code ?? '-'}</div>
                      </div>
                      <span className="shrink-0 text-right text-xs text-ink-500">
                        {a.clicks.toLocaleString('id-ID')} klik · {a.leads.toLocaleString('id-ID')} lead · {a.sales.toLocaleString('id-ID')} sales
                      </span>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                      <div>
                        <dt className="text-ink-500">Omset</dt>
                        <dd className="font-medium tabular-nums">{formatMoney(a.omset)}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-500">Potensial</dt>
                        <dd className="tabular-nums">{formatMoney(a.commission_pending)}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-500">Belum dibayar</dt>
                        <dd className="font-semibold tabular-nums">{formatMoney(a.commission_unpaid)}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-500">Sudah dibayar</dt>
                        <dd className="tabular-nums">{formatMoney(a.commission_paid)}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto xl:block">
                <table className="w-full min-w-[760px] text-sm" data-tabel-kinerja>
                  <thead className="bg-ink-50 text-left text-xs text-ink-500 dark:bg-ink-800/60">
                    <tr>
                      <th className="px-4 py-2 font-medium">Affiliate</th>
                      <th className="px-3 py-2 text-right font-medium">Klik</th>
                      <th className="px-3 py-2 text-right font-medium">Lead</th>
                      <th className="px-3 py-2 text-right font-medium">Sales</th>
                      <th className="px-3 py-2 text-right font-medium">Omset</th>
                      <th className="px-3 py-2 text-right font-medium">Potensial</th>
                      <th className="px-3 py-2 text-right font-medium">Belum dibayar</th>
                      <th className="px-4 py-2 text-right font-medium">Sudah dibayar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                    {daftar.map((a) => (
                      <tr key={a.id}>
                        <td className="max-w-[240px] px-4 py-2.5">
                          <div className="truncate font-medium" title={a.name}>
                            {a.name}
                          </div>
                          <div className="font-mono text-[11px] text-ink-500">{a.code ?? '-'}</div>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{a.clicks.toLocaleString('id-ID')}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{a.leads.toLocaleString('id-ID')}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{a.sales.toLocaleString('id-ID')}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(a.omset)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(a.commission_pending)}</td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{formatMoney(a.commission_unpaid)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(a.commission_paid)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold">10 produk teratas lewat affiliate</h2>
            {data.top_products.length === 0 ? (
              <p className="mt-2 text-sm text-ink-500">Belum ada penjualan lewat affiliate.</p>
            ) : (
              <ol className="mt-3 space-y-2">
                {data.top_products.map((p, i) => (
                  <li key={p.product_id} className="flex items-center gap-3 text-sm">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand-700 dark:bg-brand-950/40">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate" title={p.name}>
                      {p.name}
                    </span>
                    <span className="shrink-0 text-xs text-ink-500">{p.qty} pcs</span>
                    <span className="w-28 shrink-0 text-right font-semibold tabular-nums">{formatMoney(p.omset)}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Komisi

type FilterOrder = '' | 'pending' | 'done' | 'canceled';
type FilterBayar = '' | 'paid' | 'unpaid';

function TabKomisi() {
  const [rentang, setRentang] = useRentang('30');
  const [q, setQ] = useState('');
  const [statusOrder, setStatusOrder] = useState<FilterOrder>('');
  const [bayar, setBayar] = useState<FilterBayar>('');
  const [tindak, setTindak] = useState(false);
  const [rows, setRows] = useState<AdminCommissionRow[] | null>(null);
  const [galat, setGalat] = useState(false);
  const [pilih, setPilih] = useState<Set<string>>(new Set());
  const [versi, setVersi] = useState(0);
  const [sibuk, setSibuk] = useState(false);

  useEffect(() => {
    let batal = false;
    setRows(null);
    setPilih(new Set());
    void (async () => {
      if (FIXTURE) {
        const m = await import('@/lib/affiliateFixtures');
        if (!batal) setRows(FIXTURE === 'kosong' ? [] : m.FIXTURE_ADMIN_COMMISSIONS);
        return;
      }
      const r = await affiliateAdminApi.commissions({ ...rentang.r, q: q.trim() || undefined, order_status: statusOrder || undefined, paid: bayar || undefined, followup: tindak || undefined });
      if (batal) return;
      if (r.error) toast.error(r.error.message);
      // Gagal bukan "tidak ada data": daftar dibiarkan kosong dan pesan gagal yang tampil.
      setGalat(!!r.error);
      setRows(r.error ? null : r.data ?? []);
    })();
    return () => {
      batal = true;
    };
  }, [rentang, statusOrder, bayar, tindak, versi, q]);

  const dipilih = rows?.filter((r) => pilih.has(r.id)) ?? [];
  const semua = !!rows && rows.length > 0 && dipilih.length === rows.length;

  async function aksi(action: 'mark_paid' | 'mark_unpaid') {
    if (!dipilih.length) {
      toast.error('Anda belum memilih komisi');
      return;
    }
    if (!window.confirm('Anda yakin akan melakukan aksi pada komisi yang dipilih?')) return;
    if (FIXTURE) return;
    setSibuk(true);
    const r = await affiliateAdminApi.bulkCommissions(dipilih.map((d) => d.id), action);
    setSibuk(false);
    if (r.error) {
      toast.error(r.error.message);
      return;
    }
    toast.success(`${r.data?.updated ?? 0} komisi diperbarui.`);
    setVersi((v) => v + 1);
  }

  function unduhCsv() {
    if (!rows?.length) return;
    const kepala = ['Tanggal', 'No. Pesanan', 'Affiliate', 'Produk', 'Tier', 'Komisi', 'Status'];
    // Format bersama (sep=; dan titik koma) supaya Excel Indonesia langsung memisah kolom.
    const baris = rows.map((r) => [csvDateTime(r.created_at), r.order_number, r.affiliate_name, r.product_name, csvInt(r.tier), csvInt(r.commission), LABEL_STATUS_KOMISI[statusKomisi(r)]]);
    downloadFile(`komisi-affiliate-${isoLokal(new Date())}.csv`, buildCsv(kepala, baris), 'text/csv');
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pencarian order ID" className={cn(KOLOM, TINGGI, 'pl-9')} aria-label="Pencarian order ID" />
          </div>
          <PilihRentang nilai={rentang} onUbah={setRentang} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Chip<FilterOrder> label="Status order" nilai={statusOrder} onUbah={setStatusOrder} pilihan={[['', 'Semua'], ['pending', 'Order belum selesai'], ['done', 'Order sudah selesai'], ['canceled', 'Order dibatalkan']]} />
          <Chip<FilterBayar> label="Status pembayaran" nilai={bayar} onUbah={setBayar} pilihan={[['', 'Semua'], ['unpaid', 'Belum Dibayar'], ['paid', 'Sudah Dibayar']]} />
          <label className="flex min-h-[44px] items-center gap-2 text-xs font-semibold text-ink-600 dark:text-ink-300 sm:min-h-[36px]">
            <input type="checkbox" checked={tindak} onChange={(e) => setTindak(e.target.checked)} className="h-4 w-4 accent-brand-600" />
            Perlu ditindaklanjuti
          </label>
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* Tampilan kartu (di bawah 1280px) tidak punya kepala tabel, jadi pilih semua ada di sini. */}
          <label className={cn('flex items-center gap-2 text-xs font-medium xl:hidden', SENTUH)}>
            <input
              type="checkbox"
              checked={semua}
              disabled={!rows?.length}
              onChange={(e) => setPilih(e.target.checked ? new Set((rows ?? []).map((r) => r.id)) : new Set())}
              className="h-4 w-4 accent-brand-600"
            />
            Pilih semua
          </label>
          <span className="text-xs text-ink-500">{dipilih.length} dipilih</span>
          <Button size="sm" variant="secondary" disabled={sibuk || !dipilih.length} onClick={() => void aksi('mark_paid')} className={SENTUH}>
            <BadgeCheck size={15} /> Konfirmasi pembayaran komisi
          </Button>
          <Button size="sm" variant="secondary" disabled={sibuk || !dipilih.length} onClick={() => void aksi('mark_unpaid')} className={SENTUH}>
            <RefreshCw size={15} /> Ubah status komisi ke Belum Dibayar
          </Button>
        </div>
        <Button size="sm" variant="ghost" onClick={unduhCsv} disabled={!rows?.length} className={SENTUH}>
          <Download size={15} /> Export CSV
        </Button>
      </div>

      <Card className="overflow-hidden">
        {galat ? (
          <GagalMuat
            polos
            onUlang={() => {
              setGalat(false);
              setVersi((v) => v + 1);
            }}
          />
        ) : rows === null ? (
          <div className="p-4">
            <Kerangka />
          </div>
        ) : rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-ink-500">Tidak ada data yang bisa ditampilkan</p>
        ) : (
          <>
          <ul className="divide-y divide-ink-100 dark:divide-ink-800 xl:hidden" data-kartu-komisi-admin>
            {rows.map((r) => {
              const st = statusKomisi(r);
              return (
                <li key={r.id} className={cn('flex gap-3 px-4 py-3 text-sm', pilih.has(r.id) && 'bg-brand-50/60 dark:bg-brand-950/20')}>
                  <label className="-m-2 flex h-[44px] w-[44px] shrink-0 items-start justify-center pt-2.5">
                    <input
                      type="checkbox"
                      aria-label={`Pilih komisi ${r.order_number}`}
                      checked={pilih.has(r.id)}
                      onChange={(e) =>
                        setPilih((x) => {
                          const n = new Set(x);
                          if (e.target.checked) n.add(r.id);
                          else n.delete(r.id);
                          return n;
                        })
                      }
                      className="h-4 w-4 accent-brand-600"
                    />
                  </label>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <span className="line-clamp-2 min-w-0">{r.product_name}</span>
                      <span className="shrink-0 text-right font-semibold tabular-nums">
                        {formatMoney(r.commission)}
                        {r.commission < r.commission_original && (
                          <span className="block text-[11px] font-normal text-amber-700 dark:text-amber-400">dipotong retur dari {formatMoney(r.commission_original)}</span>
                        )}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-ink-500">
                      <span className="font-mono">{r.order_number}</span> · {r.affiliate_name} · Tier {r.tier} · {formatDate(r.created_at)}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Badge tone={TONE_KOMISI[st]}>{LABEL_STATUS_KOMISI[st]}</Badge>
                      {r.status === 'cancelled' && r.paid && (
                        <span className="flex items-center gap-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                          <AlertTriangle size={12} /> Batal setelah dibayar
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="hidden overflow-x-auto xl:block">
            <table className="w-full min-w-[860px] text-sm" data-tabel-komisi-admin>
              <thead className="bg-ink-50 text-left text-xs text-ink-500 dark:bg-ink-800/60">
                <tr>
                  <th className="w-10 px-4 py-2">
                    <input type="checkbox" aria-label="Pilih semua" checked={semua} onChange={(e) => setPilih(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} className="h-4 w-4 accent-brand-600" />
                  </th>
                  <th className="px-3 py-2 font-medium">Tanggal</th>
                  <th className="px-3 py-2 font-medium">Order</th>
                  <th className="px-3 py-2 font-medium">Affiliasi</th>
                  <th className="px-3 py-2 font-medium">Produk</th>
                  <th className="px-3 py-2 text-center font-medium">Tier</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                {rows.map((r) => {
                  const st = statusKomisi(r);
                  const tindakLanjut = r.status === 'cancelled' && r.paid;
                  return (
                    <tr key={r.id} className={cn(pilih.has(r.id) && 'bg-brand-50/60 dark:bg-brand-950/20')}>
                      <td className="px-4 py-2.5">
                        <input
                          type="checkbox"
                          aria-label={`Pilih komisi ${r.order_number}`}
                          checked={pilih.has(r.id)}
                          onChange={(e) =>
                            setPilih((s) => {
                              const n = new Set(s);
                              if (e.target.checked) n.add(r.id);
                              else n.delete(r.id);
                              return n;
                            })
                          }
                          className="h-4 w-4 accent-brand-600"
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-ink-600 dark:text-ink-300">{formatDateTime(r.created_at)}</td>
                      <td className="px-3 py-2.5 font-mono text-xs">{r.order_number}</td>
                      <td className="max-w-[160px] truncate px-3 py-2.5" title={r.affiliate_name}>
                        {r.affiliate_name}
                      </td>
                      <td className="max-w-[260px] px-3 py-2.5">
                        <span className="line-clamp-2">{r.product_name}</span>
                      </td>
                      <td className="px-3 py-2.5 text-center tabular-nums">{r.tier}</td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                        {formatMoney(r.commission)}
                        {r.commission < r.commission_original && (
                          <div className="text-[11px] font-normal text-amber-700 dark:text-amber-400">dipotong retur dari {formatMoney(r.commission_original)}</div>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge tone={TONE_KOMISI[st]}>{LABEL_STATUS_KOMISI[st]}</Badge>
                        {tindakLanjut && (
                          <span className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                            <AlertTriangle size={12} /> Batal setelah dibayar
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>
      {rows !== null && rows.length >= 500 && (
        <p className="text-xs text-ink-500" data-catatan-batas>
          Menampilkan 500 komisi terbaru. Persempit rentang tanggal atau cari nomor order untuk melihat yang lain.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pembayaran

/** Rincian di bawah angka Belum dibayar: bonus, potongan, dan yang ditransfer (D-40). Kosong bila keduanya 0. */
function RincianBersih({ r, minimal }: { r: PayoutSummaryRow; minimal: number }) {
  if (r.bonus <= 0 && r.deductions <= 0 && r.bonus_running <= 0 && !r.below_minimum) return null;
  return (
    <div className="mt-0.5 space-y-0.5 text-[11px] font-normal text-ink-500" data-rincian-bersih>
      {r.bonus > 0 && <div className="tabular-nums">+ bonus siap dibayar {formatMoney(r.bonus)}</div>}
      {r.bonus_running > 0 && <div className="tabular-nums">bonus bulan ini {formatMoney(r.bonus_running)}, dibayar setelah bulan berakhir</div>}
      {r.deductions > 0 && <div className="tabular-nums text-amber-700 dark:text-amber-400">- potongan {formatMoney(r.deductions)}</div>}
      {(r.bonus > 0 || r.deductions > 0) && <div className="font-semibold tabular-nums text-ink-800 dark:text-ink-100">ditransfer {formatMoney(Math.max(0, r.net))}</div>}
      {r.below_minimum && <div className="font-semibold text-amber-700 dark:text-amber-400">di bawah minimal {formatMoney(minimal)}</div>}
    </div>
  );
}

function TabPembayaran({ minimal }: { minimal: number }) {
  const [rentang, setRentang] = useRentang('semua');
  const [rows, setRows] = useState<PayoutSummaryRow[] | null>(null);
  const [riwayat, setRiwayat] = useState<PayoutHistoryRow[] | null>(null);
  const [galat, setGalat] = useState(false);
  const [bayarUntuk, setBayarUntuk] = useState<PayoutSummaryRow | null>(null);
  const [versi, setVersi] = useState(0);
  const [bukti, setBukti] = useState<string | null>(null);

  useEffect(() => {
    let batal = false;
    setRows(null);
    void (async () => {
      if (FIXTURE) {
        const m = await import('@/lib/affiliateFixtures');
        if (!batal) {
          setRows(FIXTURE === 'kosong' ? [] : m.FIXTURE_PAYOUT_SUMMARY);
          setRiwayat(FIXTURE === 'kosong' ? [] : m.FIXTURE_PAYOUT_HISTORY);
        }
        return;
      }
      const [r, h] = await Promise.all([affiliateAdminApi.payoutSummary(rentang.r), affiliateAdminApi.payoutHistory()]);
      if (batal) return;
      const salah = r.error ?? h.error;
      if (salah) toast.error(salah.message);
      setGalat(!!salah);
      setRows(salah ? null : r.data ?? []);
      setRiwayat(salah ? null : h.data ?? []);
    })();
    return () => {
      batal = true;
    };
  }, [rentang, versi]);

  async function lihatBukti(id: string) {
    if (FIXTURE) return;
    const r = await affiliateAdminApi.payoutProof(id);
    if (r.data?.proof_image) setBukti(r.data.proof_image);
    else toast.error('Bukti transfer tidak ditemukan.');
  }

  return (
    <div className="space-y-4">
      <PilihRentang nilai={rentang} onUbah={setRentang} />
      <Card className="overflow-hidden">
        <div className="p-4">
          <h2 className="text-sm font-semibold">Data Komisi per Affiliasi</h2>
          <p className="text-xs text-ink-500">Bayar menandai semua komisi Belum dibayar milik affiliate itu di rentang ini sebagai Sudah dibayar.</p>
        </div>
        {galat ? (
          <GagalMuat
            polos
            onUlang={() => {
              setGalat(false);
              setVersi((v) => v + 1);
            }}
          />
        ) : rows === null ? (
          <div className="px-4 pb-4">
            <Kerangka />
          </div>
        ) : rows.length === 0 ? (
          <p className="px-4 pb-6 text-sm text-ink-500">Belum ada komisi.</p>
        ) : (
          <>
          {/* HP: kartu, supaya tombol Bayar tidak tersembunyi di ujung tabel yang harus digeser. */}
          <ul className="divide-y divide-ink-100 border-t border-ink-100 dark:divide-ink-800 dark:border-ink-800 xl:hidden" data-kartu-pembayaran>
            {rows.map((r) => (
              <li key={r.affiliate_id} className="space-y-2 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{r.name}</div>
                  <div className="truncate text-[11px] text-ink-500">{r.email ?? '-'}</div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px] text-ink-500">
                  <span>Potensial<b className="block text-sm font-semibold tabular-nums text-ink-800 dark:text-ink-100">{formatMoney(r.pending)}</b></span>
                  <span>
                    Belum dibayar<b className="block text-sm font-semibold tabular-nums text-ink-900 dark:text-white">{formatMoney(r.unpaid)}</b>
                  </span>
                  <span>Sudah dibayar<b className="block text-sm font-semibold tabular-nums text-ink-800 dark:text-ink-100">{formatMoney(r.paid)}</b></span>
                </div>
                <RincianBersih r={r} minimal={minimal} />
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 text-xs">
                    {r.bank_info ? <span className="line-clamp-2">{r.bank_info}</span> : <span className="font-semibold text-amber-700 dark:text-amber-400">Rekening belum diisi</span>}
                  </span>
                  <Button disabled={r.net <= 0} onClick={() => setBayarUntuk(r)} className={cn('shrink-0', SENTUH)}>
                    <Banknote size={15} /> Bayar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto xl:block">
            <table className="w-full min-w-[760px] text-sm" data-tabel-pembayaran>
              <thead className="bg-ink-50 text-left text-xs text-ink-500 dark:bg-ink-800/60">
                <tr>
                  <th className="px-4 py-2 font-medium">Affiliasi</th>
                  <th className="px-3 py-2 text-right font-medium">Komisi potensial</th>
                  <th className="px-3 py-2 text-right font-medium">Komisi belum dibayar</th>
                  <th className="px-3 py-2 text-right font-medium">Komisi sudah dibayar</th>
                  <th className="px-3 py-2 font-medium">Rekening</th>
                  <th className="px-4 py-2 text-right font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                {rows.map((r) => (
                  <tr key={r.affiliate_id}>
                    <td className="max-w-[220px] px-4 py-2.5">
                      <div className="truncate font-medium" title={r.name}>
                        {r.name}
                      </div>
                      <div className="truncate text-[11px] text-ink-500">{r.email ?? '-'}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(r.pending)}</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                      {formatMoney(r.unpaid)}
                      <RincianBersih r={r} minimal={minimal} />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(r.paid)}</td>
                    <td className="max-w-[200px] px-3 py-2.5 text-xs">
                      {r.bank_info ? <span className="line-clamp-2">{r.bank_info}</span> : <span className="font-semibold text-amber-700 dark:text-amber-400">Belum diisi</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Button size="sm" disabled={r.net <= 0} onClick={() => setBayarUntuk(r)}>
                        <Banknote size={15} /> Bayar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>

      <Card className="overflow-hidden">
        <h2 className="p-4 text-sm font-semibold">Riwayat pembayaran</h2>
        {riwayat === null ? null : riwayat.length === 0 ? (
          <p className="px-4 pb-6 text-sm text-ink-500">Belum ada pembayaran.</p>
        ) : (
          <ul className="divide-y divide-ink-100 dark:divide-ink-800">
            {riwayat.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{p.affiliate_name}</div>
                  <div className="text-xs text-ink-500">
                    {formatDateTime(p.paid_at)} · {p.commission_count} komisi{p.note ? ` · ${p.note}` : ''}
                    {p.expense_id ? ' · tercatat di Pengeluaran' : ''}
                  </div>
                  {(p.bonus_total > 0 || p.deduction_total > 0) && (
                    <div className="text-xs tabular-nums text-ink-500">
                      Komisi {formatMoney(p.commission_total)}
                      {p.bonus_total > 0 ? ` + bonus ${formatMoney(p.bonus_total)}` : ''}
                      {p.deduction_total > 0 ? ` - potongan ${formatMoney(p.deduction_total)}` : ''}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {p.has_proof && (
                    <Button size="sm" variant="ghost" onClick={() => void lihatBukti(p.id)} className={SENTUH}>
                      <Eye size={14} /> Bukti
                    </Button>
                  )}
                  <span className="font-semibold tabular-nums">{formatMoney(p.amount)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {bayarUntuk && (
        <DialogBayar
          baris={bayarUntuk}
          minimal={minimal}
          rentang={rentang.r}
          onTutup={() => setBayarUntuk(null)}
          onSelesai={() => {
            setBayarUntuk(null);
            setVersi((v) => v + 1);
          }}
        />
      )}
      <Modal open={!!bukti} onClose={() => setBukti(null)} title="Bukti Transfer" size="md">
        {bukti && <img src={bukti} alt="Bukti transfer komisi" className="mx-auto max-h-[70vh] rounded-lg" />}
      </Modal>
    </div>
  );
}

function DialogBayar({
  baris,
  minimal,
  rentang,
  onTutup,
  onSelesai,
}: {
  baris: PayoutSummaryRow;
  minimal: number;
  rentang: RentangTanggal;
  onTutup: () => void;
  onSelesai: () => void;
}) {
  const [catatan, setCatatan] = useState('');
  // D-34: di bawah minimal, admin memutuskan sendiri dengan mencentang konfirmasi.
  const [tetapBayar, setTetapBayar] = useState(false);
  const [bukti, setBukti] = useState<string | null>(null);
  const [catatPengeluaran, setCatatPengeluaran] = useState(true);
  const [sibuk, setSibuk] = useState(false);

  async function pilihBukti(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      toast.error('Bukti transfer harus gambar JPG, PNG, atau WebP.');
      return;
    }
    try {
      const hasil = await resizeImageToDataUrl(file, { maxDim: 1400, quality: 0.8 });
      if (hasil.bytes > 300 * 1024) {
        const kecil = await resizeImageToDataUrl(file, { maxDim: 1000, quality: 0.7 });
        setBukti(kecil.dataUrl);
      } else setBukti(hasil.dataUrl);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Bukti transfer harus gambar JPG, PNG, atau WebP.');
    }
  }

  async function konfirmasi() {
    if (FIXTURE) {
      toast.success(`Komisi ${baris.name} sebesar ${formatMoney(baris.net)} ditandai TELAH DIBAYAR.`);
      onSelesai();
      return;
    }
    setSibuk(true);
    const r = await affiliateAdminApi.pay({
      affiliate_id: baris.affiliate_id,
      from: rentang.from,
      to: rentang.to,
      note: catatan.trim() || undefined,
      proof_image: bukti,
      record_expense: catatPengeluaran,
      abaikan_minimal: baris.below_minimum ? tetapBayar : undefined,
    });
    setSibuk(false);
    if (r.error) {
      toast.error(r.error.message);
      return;
    }
    toast.success(`Komisi ${baris.name} sebesar ${formatMoney(r.data?.amount ?? baris.net)} ditandai TELAH DIBAYAR.`);
    onSelesai();
  }

  return (
    <Modal open onClose={onTutup} title="Pembayaran Komisi" size="md">
      <div className="space-y-4 text-sm" data-dialog-bayar>
        <div>
          <div className="text-base font-semibold">{baris.name}</div>
          <div className="text-xs text-ink-500">
            Email : {baris.email ?? '-'} · Nomor Telpon : {baris.phone ?? '-'}
          </div>
        </div>
        <div className="rounded-xl bg-ink-50 p-3 dark:bg-ink-800/60">
          <div className="text-xs text-ink-500">Rekening</div>
          {baris.bank_info ? (
            <div className="mt-0.5 whitespace-pre-line font-medium">{baris.bank_info}</div>
          ) : (
            <div className="mt-0.5 flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-400">
              <AlertTriangle size={14} /> Affiliate belum mengisi informasi rekening.
            </div>
          )}
        </div>
        <div data-rincian-bayar>
          {baris.bonus > 0 || baris.deductions > 0 ? (
            <dl className="space-y-1 text-sm tabular-nums">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-500">Komisi belum dibayar</dt>
                <dd>{formatMoney(baris.unpaid)}</dd>
              </div>
              {baris.bonus > 0 && (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-500">Bonus target</dt>
                  <dd>+ {formatMoney(baris.bonus)}</dd>
                </div>
              )}
              {baris.deductions > 0 && (
                <div className="flex justify-between gap-3 text-amber-700 dark:text-amber-400">
                  <dt>Potongan retur dan pembatalan</dt>
                  <dd>- {formatMoney(baris.deductions)}</dd>
                </div>
              )}
              <div className="flex items-baseline justify-between gap-3 border-t border-ink-100 pt-1 dark:border-ink-800">
                <dt className="text-xs text-ink-500">Ditransfer</dt>
                <dd className="text-2xl font-bold">{formatMoney(baris.net)}</dd>
              </div>
            </dl>
          ) : (
            <>
              <div className="text-xs text-ink-500">Total Komisi</div>
              <div className="text-2xl font-bold tabular-nums">{formatMoney(baris.net)}</div>
            </>
          )}
        </div>
        {baris.below_minimum && (
          <label className="flex min-h-[44px] items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <input type="checkbox" checked={tetapBayar} onChange={(e) => setTetapBayar(e.target.checked)} className="mt-0.5 h-4 w-4 accent-amber-600" />
            <span>
              Tetap bayar di bawah minimal pencairan {formatMoney(minimal)}
              <span className="block text-xs opacity-80">Jumlah ini belum mencapai minimal yang diatur di Pengaturan.</span>
            </span>
          </label>
        )}
        <div>
          <span className="mb-1 block text-xs font-medium text-ink-500">Bukti Transfer (opsional)</span>
          {bukti ? (
            <div className="flex items-start gap-3">
              <img src={bukti} alt="Pratinjau bukti transfer" className="h-24 w-24 rounded-lg object-cover" />
              <Button size="sm" variant="ghost" onClick={() => setBukti(null)} className={SENTUH}>
                <Trash2 size={14} /> Hapus
              </Button>
            </div>
          ) : (
            <label className="flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-ink-300 px-3 text-xs font-semibold text-ink-600 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-300">
              <IkonGambar size={16} /> Pilih gambar
              <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => void pilihBukti(e.target.files?.[0])} />
            </label>
          )}
        </div>
        <div>
          <label htmlFor="catatan-bayar" className="mb-1 block text-xs font-medium text-ink-500">
            Catatan
          </label>
          <input id="catatan-bayar" value={catatan} maxLength={300} onChange={(e) => setCatatan(e.target.value)} placeholder="Contoh: Transfer BCA 06/10" className={cn(KOLOM, TINGGI)} />
        </div>
        <label className="flex min-h-[44px] items-start gap-2 py-1 text-sm">
          <input type="checkbox" checked={catatPengeluaran} onChange={(e) => setCatatPengeluaran(e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-600" />
          <span>
            Catat sebagai pengeluaran
            <span className="block text-xs text-ink-500">Kategori "Komisi Affiliate", masuk Laba Rugi.</span>
          </span>
        </label>
        <p className="text-xs text-ink-500">Update komisi untuk affiliate {baris.name} ke TELAH DIBAYAR.</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onTutup} disabled={sibuk} className={SENTUH}>
            Batal
          </Button>
          <Button onClick={() => void konfirmasi()} disabled={sibuk || (baris.below_minimum && !tetapBayar)} className={SENTUH}>
            <BadgeCheck size={16} /> {sibuk ? 'Menyimpan...' : 'Tandai TELAH DIBAYAR'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Anggota (affiliate)

type FilterAkses = '' | 'eligible' | AffiliateAccess;

const PER_HALAMAN_ANGGOTA = 30;

/**
 * Selama program mati tidak ada member yang berhak, termasuk yang Diizinkan.
 * Alasannya ditulis di daftar dan di dialog, karena keterangan di kepala
 * halaman sudah tergulir keluar layar saat admin mengatur member.
 */
function TabAnggota({ programAktif, onBukaPengaturan }: { programAktif: boolean | null; onBukaPengaturan: () => void }) {
  const [q, setQ] = useState('');
  const [akses, setAkses] = useState<FilterAkses>('');
  const [rows, setRows] = useState<AdminMemberRow[] | null>(null);
  // Daftar panjang dibuka bertahap: 96 member sekaligus membuat halaman HP setinggi 13.000 px.
  const [jumlahTampil, setJumlahTampil] = useState(PER_HALAMAN_ANGGOTA);
  const [galat, setGalat] = useState(false);
  const [ubah, setUbah] = useState<AdminMemberRow | null>(null);
  const [versi, setVersi] = useState(0);
  const [undang, setUndang] = useState(false);
  const [versiUndangan, setVersiUndangan] = useState(0);

  useEffect(() => {
    let batal = false;
    const t = window.setTimeout(() => {
      void (async () => {
        if (FIXTURE) {
          const m = await import('@/lib/affiliateFixtures');
          if (!batal) setRows(FIXTURE === 'kosong' ? [] : m.FIXTURE_MEMBERS);
          return;
        }
        const r = await affiliateAdminApi.members({ q: q.trim() || undefined, access: akses || undefined });
        if (batal) return;
        if (r.error) toast.error(r.error.message);
        setGalat(!!r.error);
        setRows(r.error ? null : r.data ?? []);
        setJumlahTampil(PER_HALAMAN_ANGGOTA);
      })();
    }, 250);
    return () => {
      batal = true;
      window.clearTimeout(t);
    };
  }, [q, akses, versi]);

  const lencana = (m: AdminMemberRow) =>
    m.eligible
      ? { tone: 'success' as const, teks: 'Berhak' }
      : programAktif === false && m.access === 'allowed'
        ? { tone: 'warning' as const, teks: 'Program mati' }
        : { tone: m.access === 'blocked' ? ('danger' as const) : ('neutral' as const), teks: 'Tidak berhak' };

  return (
    <div className="space-y-4">
      {programAktif === false && (
        <div
          className="flex flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100"
          data-program-mati
        >
          <p className="min-w-0 sm:flex-1">
            <b>Program affiliate masih mati.</b> Member yang Diizinkan baru bisa memakai affiliate setelah program dinyalakan.
          </p>
          <Button onClick={onBukaPengaturan} className={cn(SENTUH, 'self-start sm:self-auto')}>
            <IkonPengaturan size={15} /> Nyalakan di Pengaturan
          </Button>
        </div>
      )}
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama, email, atau kode" className={cn(KOLOM, TINGGI, 'pl-9')} aria-label="Cari member" />
        </div>
        <Chip<FilterAkses>
          label="Akses"
          nilai={akses}
          onUbah={setAkses}
          pilihan={[['', 'Semua'], ['eligible', 'Berhak'], ['default', LABEL_AKSES.default], ['allowed', LABEL_AKSES.allowed], ['blocked', LABEL_AKSES.blocked]]}
        />
        <Button onClick={() => setUndang(true)} className={cn('sm:ml-auto', SENTUH)}>
          <Plus size={15} /> Undang affiliate
        </Button>
      </Card>
      {/* Di atas daftar member: di HP daftar member bisa ratusan baris. */}
      <DaftarUndanganAdmin versi={versiUndangan} />
      <Card className="overflow-hidden">
        {galat ? (
          <GagalMuat
            polos
            onUlang={() => {
              setGalat(false);
              setVersi((v) => v + 1);
            }}
          />
        ) : rows === null ? (
          <div className="p-4">
            <Kerangka />
          </div>
        ) : rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-ink-500">Tidak ada member yang cocok.</p>
        ) : (
          <>
          <ul className="divide-y divide-ink-100 dark:divide-ink-800 xl:hidden" data-kartu-anggota>
            {rows.slice(0, jumlahTampil).map((m) => (
              <li key={m.id} className="space-y-2 px-4 py-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{m.name}</div>
                    <div className="truncate text-[11px] text-ink-500">{m.email ?? '-'}</div>
                  </div>
                  <Badge tone={lencana(m).tone} className="shrink-0">
                    {lencana(m).teks}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-500">
                  <span>
                    Kode <b className="font-mono text-ink-800 dark:text-ink-100">{m.code ?? '-'}</b>
                  </span>
                  <span>{LABEL_AKSES[m.access]}</span>
                  <span>Tarif {teksTarif(m.commission) ?? 'bawaan'}</span>
                  <span>Upline {m.upline_name ?? '-'}</span>
                  <span>{m.downline_count} downline</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-ink-500">
                    {m.clicks.toLocaleString('id-ID')} klik · {m.sales.toLocaleString('id-ID')} sales · <b className="text-ink-900 dark:text-white">{formatMoney(m.commission_unpaid)}</b> belum dibayar
                  </span>
                  <Button variant="secondary" onClick={() => setUbah(m)} className={cn('shrink-0', SENTUH)}>
                    <Pencil size={14} /> Ubah
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto xl:block">
            <table className="w-full min-w-[900px] text-sm" data-tabel-anggota>
              <thead className="bg-ink-50 text-left text-xs text-ink-500 dark:bg-ink-800/60">
                <tr>
                  <th className="px-4 py-2 font-medium">Member</th>
                  <th className="px-3 py-2 font-medium">Kode</th>
                  <th className="px-3 py-2 font-medium">Akses</th>
                  <th className="px-3 py-2 font-medium">Upline</th>
                  <th className="px-3 py-2 text-right font-medium">Downline</th>
                  <th className="px-3 py-2 text-right font-medium">Klik</th>
                  <th className="px-3 py-2 text-right font-medium">Sales</th>
                  <th className="px-3 py-2 text-right font-medium">Belum dibayar</th>
                  <th className="px-4 py-2 text-right font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                {rows.slice(0, jumlahTampil).map((m) => (
                  <tr key={m.id}>
                    <td className="max-w-[240px] px-4 py-2.5">
                      <div className="truncate font-medium" title={m.name}>
                        {m.name}
                      </div>
                      <div className="truncate text-[11px] text-ink-500" title={m.email ?? ''}>
                        {m.email ?? '-'}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      <div className="font-mono">{m.code ?? '-'}</div>
                      <div className="mt-0.5 text-[11px] text-ink-500">Tarif {teksTarif(m.commission) ?? 'bawaan'}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge tone={lencana(m).tone}>{lencana(m).teks}</Badge>
                      <div className="mt-0.5 text-[11px] text-ink-500">{LABEL_AKSES[m.access]}</div>
                    </td>
                    <td className="max-w-[160px] truncate px-3 py-2.5 text-xs">{m.upline_name ?? '-'}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{m.downline_count}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{m.clicks.toLocaleString('id-ID')}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{m.sales.toLocaleString('id-ID')}</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{formatMoney(m.commission_unpaid)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Button size="sm" variant="secondary" onClick={() => setUbah(m)}>
                        <Pencil size={14} /> Ubah
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > jumlahTampil && (
            <div className="flex flex-col items-center gap-2 border-t border-ink-100 p-4 text-xs text-ink-500 dark:border-ink-800" data-tampilkan-lagi>
              <span>
                Menampilkan {jumlahTampil.toLocaleString('id-ID')} dari {rows.length.toLocaleString('id-ID')} member
              </span>
              <Button variant="secondary" className={SENTUH} onClick={() => setJumlahTampil((n) => n + PER_HALAMAN_ANGGOTA)}>
                Tampilkan {Math.min(PER_HALAMAN_ANGGOTA, rows.length - jumlahTampil).toLocaleString('id-ID')} lagi
              </Button>
            </div>
          )}
          </>
        )}
      </Card>
      {rows !== null && rows.length >= 500 && (
        <p className="text-xs text-ink-500" data-catatan-batas>
          Menampilkan 500 member pertama. Gunakan pencarian untuk menemukan member lain.
        </p>
      )}
      {undang && (
        <DialogUndangAdmin
          onTutup={() => setUndang(false)}
          onSelesai={() => {
            setUndang(false);
            setVersiUndangan((v) => v + 1);
          }}
        />
      )}
      {ubah && (
        <DialogAnggota
          baris={ubah}
          semua={rows ?? []}
          programAktif={programAktif}
          onTutup={() => setUbah(null)}
          onSelesai={() => {
            setUbah(null);
            setVersi((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}

/** Pesan galat tarif di layar, sama dengan validasiTarif di server. */
function periksaTarif(t: CommissionTier[] | null): string | null {
  const x = t?.[0];
  if (!x) return null;
  if (Number.isNaN(x.value)) return 'Tipe dan besar komisi wajib diisi.';
  if (x.type === 'percentage' && !(x.value >= 0 && x.value <= 100)) return 'Persentase komisi harus 0 sampai 100.';
  if (x.type === 'fixed' && !(x.value >= 0 && x.value <= 100_000_000)) return 'Nilai tetap komisi harus 0 sampai 100.000.000.';
  return null;
}

/**
 * Tarif komisi satu affiliate (FR-49): ikut bawaan toko, pilihan cepat 5, 10,
 * 15 persen (AS-3), atau manual. Komisi khusus produk tetap didahulukan (D-31).
 */
function PilihTarif({ nilai, onUbah }: { nilai: CommissionTier[] | null; onUbah: (t: CommissionTier[] | null) => void }) {
  const t = nilai?.[0] ?? null;
  const preset = t && t.type === 'percentage' && (PRESET_TARIF as readonly number[]).includes(t.value) ? t.value : null;
  const [manual, setManual] = useState(!!t && preset === null);
  const pil = (aktif: boolean) =>
    cn(
      'min-h-[44px] rounded-full border px-3.5 text-sm font-medium transition-colors duration-150 sm:min-h-[36px]',
      aktif ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-200' : 'border-ink-200 text-ink-600 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800',
    );
  return (
    <fieldset data-pilih-tarif>
      <legend className="mb-1 text-xs font-medium text-ink-500">Tarif komisi affiliate ini</legend>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={!t && !manual}
          className={pil(!t && !manual)}
          onClick={() => {
            setManual(false);
            onUbah(null);
          }}
        >
          Ikut bawaan
        </button>
        {PRESET_TARIF.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={!manual && preset === p}
            className={pil(!manual && preset === p)}
            onClick={() => {
              setManual(false);
              onUbah([{ type: 'percentage', value: p }]);
            }}
          >
            {p}%
          </button>
        ))}
        <button
          type="button"
          aria-pressed={manual}
          className={pil(manual)}
          onClick={() => {
            setManual(true);
            onUbah([{ type: t?.type ?? 'percentage', value: t?.value ?? NaN }]);
          }}
        >
          Manual
        </button>
      </div>
      {manual && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            aria-label="Jenis tarif manual"
            value={t?.type ?? 'percentage'}
            onChange={(e) => onUbah([{ type: e.target.value as CommissionTier['type'], value: t?.value ?? NaN }])}
            className={cn(KOLOM, TINGGI, 'w-40')}
          >
            <option value="percentage">Persen</option>
            <option value="fixed">Rupiah per barang</option>
          </select>
          <input
            aria-label="Besar tarif manual"
            type="number"
            min={0}
            step={t?.type === 'fixed' ? 500 : 0.5}
            value={t && !Number.isNaN(t.value) ? t.value : ''}
            onChange={(e) => onUbah([{ type: t?.type ?? 'percentage', value: angkaIsian(e.target.value) }])}
            className={cn(KOLOM, TINGGI, 'w-32 tabular-nums')}
          />
        </div>
      )}
      <p className="mt-1 text-xs text-ink-500">Produk yang punya komisi khusus tetap memakai komisi produk itu.</p>
    </fieldset>
  );
}

/** Undangan khusus dari admin (D-32, FR-51): penerima yang mendaftar langsung menjadi affiliate. */
function DialogUndangAdmin({ onTutup, onSelesai }: { onTutup: () => void; onSelesai: () => void }) {
  const [email, setEmail] = useState('');
  const [nama, setNama] = useState('');
  const [pesan, setPesan] = useState('');
  const [tarif, setTarif] = useState<CommissionTier[] | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);

  async function kirim() {
    const e = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      setGalat('Email tidak valid.');
      return;
    }
    const g = periksaTarif(tarif);
    if (g) {
      setGalat(g);
      return;
    }
    if (FIXTURE) {
      onSelesai();
      return;
    }
    setSibuk(true);
    const r = await affiliateAdminApi.invite({ email: e, name: nama.trim() || undefined, message: pesan.trim() || undefined, commission: tarif });
    setSibuk(false);
    if (r.error) {
      setGalat(r.error.message);
      return;
    }
    toast.success(`Undangan affiliate terkirim ke ${e}.`);
    onSelesai();
  }

  return (
    <Modal open onClose={onTutup} title="Undang affiliate" size="md">
      <div className="space-y-4 text-sm" data-dialog-undang-admin>
        <p className="text-xs text-ink-500">Penerima yang mendaftar dengan email ini langsung menjadi affiliate dengan tarif di bawah. Tautan berlaku sesuai pengaturan undangan.</p>
        <div>
          <label htmlFor="undang-admin-email" className="mb-1 block text-xs font-medium text-ink-500">
            Email <span className="text-rose-600">*</span>
          </label>
          <input
            id="undang-admin-email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setGalat(null);
            }}
            placeholder="nama@gmail.com"
            className={cn(KOLOM, TINGGI)}
          />
        </div>
        <div>
          <label htmlFor="undang-admin-nama" className="mb-1 block text-xs font-medium text-ink-500">
            Nama (opsional)
          </label>
          <input id="undang-admin-nama" value={nama} maxLength={80} onChange={(e) => setNama(e.target.value)} className={cn(KOLOM, TINGGI)} />
        </div>
        <PilihTarif
          nilai={tarif}
          onUbah={(t) => {
            setTarif(t);
            setGalat(null);
          }}
        />
        <div>
          <label htmlFor="undang-admin-pesan" className="mb-1 block text-xs font-medium text-ink-500">
            Pesan (opsional)
          </label>
          <textarea id="undang-admin-pesan" rows={3} maxLength={300} value={pesan} onChange={(e) => setPesan(e.target.value)} className={cn(KOLOM, 'py-2')} />
          <p className="mt-0.5 text-[11px] text-ink-500">Tanpa tautan atau alamat web.</p>
        </div>
        {galat && (
          <p className="text-xs font-medium text-rose-600 dark:text-rose-400" role="alert">
            {galat}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onTutup} disabled={sibuk} className={SENTUH}>
            Batal
          </Button>
          <Button onClick={() => void kirim()} disabled={sibuk} className={SENTUH}>
            {sibuk ? 'Mengirim...' : 'Kirim undangan'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Email yang terlalu panjang dipatah sebelum @, bukan di tengah kata. */
function EmailPatah({ email }: { email: string }) {
  const at = email.indexOf('@');
  if (at <= 0) return <>{email}</>;
  return (
    <>
      {email.slice(0, at)}
      <wbr />
      {email.slice(at)}
    </>
  );
}

const CHIP_UNDANGAN_ADMIN: Record<AdminInvitationRow['status'], 'success' | 'warning' | 'neutral' | 'danger'> = {
  registered: 'success',
  opened: 'warning',
  sent: 'neutral',
  failed: 'danger',
  expired: 'neutral',
};

/** Daftar undangan khusus admin dengan Kirim ulang (FR-51). */
function DaftarUndanganAdmin({ versi }: { versi: number }) {
  const [rows, setRows] = useState<AdminInvitationRow[] | null>(null);
  const [ulang, setUlang] = useState(0);
  const [kirimId, setKirimId] = useState<string | null>(null);

  useEffect(() => {
    let batal = false;
    void (async () => {
      if (FIXTURE) {
        if (!batal) setRows([]);
        return;
      }
      const r = await affiliateAdminApi.invitations();
      if (!batal) setRows(r.data ?? []);
    })();
    return () => {
      batal = true;
    };
  }, [versi, ulang]);

  if (!rows || rows.length === 0) return null;

  async function kirimUlang(id: string) {
    setKirimId(id);
    const r = await affiliateAdminApi.resendInvite(id);
    setKirimId(null);
    if (r.error) {
      toast.error(r.error.message);
      return;
    }
    toast.success('Undangan dikirim ulang.');
    setUlang((v) => v + 1);
  }

  return (
    <Card className="overflow-hidden" data-daftar-undangan-admin>
      <h2 className="p-4 pb-2 text-sm font-semibold">Undangan affiliate dari admin</h2>
      <ul className="divide-y divide-ink-100 dark:divide-ink-800">
        {rows.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
            <div className="min-w-0 flex-1">
              <div className="font-medium [overflow-wrap:anywhere]">
                <EmailPatah email={u.email} />
              </div>
              <div className="text-xs text-ink-500">
                Tarif {teksTarif(u.commission) ?? 'bawaan'} · dikirim {formatDate(u.sent_at)}
                {u.registered_name ? ` · terdaftar sebagai ${u.registered_name}` : ''}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={CHIP_UNDANGAN_ADMIN[u.status]}>{LABEL_STATUS_UNDANGAN[u.status]}</Badge>
              {u.can_resend && (
                <Button size="sm" variant="secondary" disabled={kirimId === u.id} onClick={() => void kirimUlang(u.id)} className={SENTUH}>
                  {kirimId === u.id ? 'Mengirim...' : 'Kirim ulang'}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function DialogAnggota({
  baris,
  semua,
  programAktif,
  onTutup,
  onSelesai,
}: {
  baris: AdminMemberRow;
  semua: AdminMemberRow[];
  programAktif: boolean | null;
  onTutup: () => void;
  onSelesai: () => void;
}) {
  const [akses, setAkses] = useState<AffiliateAccess>(baris.access);
  const [kode, setKode] = useState(baris.code ?? '');
  const [upline, setUpline] = useState<string>(baris.upline_id ?? '');
  const [tarif, setTarif] = useState<CommissionTier[] | null>(baris.commission ?? null);
  const [jaringan, setJaringan] = useState<{ uplines: { id: string; name: string; depth: number }[]; nodes: NetworkNode[] } | null>(null);
  // Calon upline dimuat sendiri: daftar di tab bisa sedang tersaring pencarian,
  // sedangkan upline boleh member mana pun.
  const [calon, setCalon] = useState<AdminMemberRow[]>(semua);
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);

  useEffect(() => {
    let batal = false;
    void (async () => {
      if (FIXTURE) {
        if (!batal) setJaringan({ uplines: baris.upline_name ? [{ id: baris.upline_id ?? 'x', name: baris.upline_name, depth: 1 }] : [], nodes: [] });
        return;
      }
      const [r, m] = await Promise.all([affiliateAdminApi.memberNetwork(baris.id), affiliateAdminApi.members({})]);
      if (batal) return;
      setJaringan(r.data ?? { uplines: [], nodes: [] });
      if (m.data) setCalon(m.data);
    })();
    return () => {
      batal = true;
    };
  }, [baris]);

  async function simpan() {
    const kodeBersih = kode.trim().toUpperCase();
    if (kodeBersih && !/^[A-Z0-9]{4,20}$/.test(kodeBersih)) {
      setGalat('Kode hanya boleh huruf besar dan angka, 4 sampai 20 karakter.');
      return;
    }
    const tarifGalat = periksaTarif(tarif);
    if (tarifGalat) {
      setGalat(tarifGalat);
      return;
    }
    if (FIXTURE) {
      onSelesai();
      return;
    }
    setSibuk(true);
    const r = await affiliateAdminApi.updateMember(baris.id, {
      access: akses,
      ...(JSON.stringify(tarif) !== JSON.stringify(baris.commission ?? null) ? { commission: tarif } : {}),
      ...(kodeBersih && kodeBersih !== baris.code ? { code: kodeBersih } : {}),
      ...(upline !== (baris.upline_id ?? '') ? { referred_by: upline || null } : {}),
    });
    setSibuk(false);
    if (r.error) {
      setGalat(r.error.message);
      return;
    }
    toast.success(`Data affiliate ${baris.name} tersimpan.`);
    onSelesai();
  }

  const calonUpline = calon.filter((m) => m.id !== baris.id);
  // Upline saat ini tetap tampil walau berada di luar 500 member pertama.
  if (baris.upline_id && !calonUpline.some((m) => m.id === baris.upline_id)) {
    calonUpline.unshift({ ...baris, id: baris.upline_id, name: baris.upline_name ?? 'Upline saat ini', code: null });
  }

  return (
    <Modal open onClose={onTutup} title={`Ubah affiliate: ${baris.name}`} size="lg">
      <div className="space-y-4 text-sm" data-dialog-anggota>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="akses-member" className="mb-1 block text-xs font-medium text-ink-500">
              Akses affiliate
            </label>
            <select id="akses-member" value={akses} onChange={(e) => setAkses(e.target.value as AffiliateAccess)} className={cn(KOLOM, TINGGI)}>
              <option value="default">{LABEL_AKSES.default}</option>
              <option value="allowed">{LABEL_AKSES.allowed}</option>
              <option value="blocked">{LABEL_AKSES.blocked}</option>
            </select>
            {programAktif === false && akses === 'allowed' && (
              <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400" data-catatan-program-mati>
                Program masih mati. Akses ini berlaku setelah program dinyalakan di tab Pengaturan.
              </p>
            )}
          </div>
          <div>
            <label htmlFor="kode-member" className="mb-1 block text-xs font-medium text-ink-500">
              Kode affiliate
            </label>
            <input
              id="kode-member"
              value={kode}
              onChange={(e) => {
                setKode(e.target.value.toUpperCase());
                setGalat(null);
              }}
              placeholder="Dibuat otomatis"
              className={cn(KOLOM, TINGGI, 'font-mono uppercase')}
            />
          </div>
          <div>
            <label htmlFor="upline-member" className="mb-1 block text-xs font-medium text-ink-500">
              Upline
            </label>
            <select id="upline-member" value={upline} onChange={(e) => setUpline(e.target.value)} className={cn(KOLOM, TINGGI)}>
              <option value="">Tanpa upline</option>
              {calonUpline.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.code ? ` (${m.code})` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
        <PilihTarif
          nilai={tarif}
          onUbah={(t) => {
            setTarif(t);
            setGalat(null);
          }}
        />
        {kode.trim() !== (baris.code ?? '') && baris.code && (
          <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
            <AlertTriangle size={13} /> Link lama dengan kode {baris.code} akan berhenti berfungsi.
          </p>
        )}
        {galat && (
          <p className="text-xs font-medium text-rose-600 dark:text-rose-400" role="alert">
            {galat}
          </p>
        )}

        <div className="rounded-xl border border-ink-100 p-3 dark:border-ink-800">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-ink-600 dark:text-ink-300">
            <Network size={14} /> Jaringan
          </div>
          {jaringan === null ? (
            <div className="h-16 animate-pulse rounded-lg bg-ink-100 dark:bg-ink-800" />
          ) : (
            <div className="space-y-2 text-xs">
              <div>
                <span className="text-ink-500">Upline: </span>
                {jaringan.uplines.length ? jaringan.uplines.map((u) => `${u.name} (tingkat ${u.depth})`).join(' ← ') : 'tidak ada'}
              </div>
              <div>
                <span className="text-ink-500">Downline: </span>
                {jaringan.nodes.length ? `${jaringan.nodes.length} member` : 'belum ada'}
              </div>
              {jaringan.nodes.length > 0 && (
                <ul className="max-h-40 space-y-1 overflow-y-auto">
                  {jaringan.nodes.map((n) => (
                    <li key={n.id} style={{ paddingLeft: `${(n.depth - 1) * 16}px` }} className="truncate">
                      {n.depth > 1 ? '└ ' : ''}
                      {n.name} <span className="text-ink-500">· {formatDate(n.joined_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onTutup} disabled={sibuk} className={SENTUH}>
            Batal
          </Button>
          <Button onClick={() => void simpan()} disabled={sibuk} className={SENTUH}>
            {sibuk ? 'Menyimpan...' : 'Simpan'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Pengaturan

function TabPengaturan({ awal, onTersimpan }: { awal: AffiliateSettings; onTersimpan: (s: AffiliateSettings) => void }) {
  const [s, setS] = useState<AffiliateSettings>(awal);
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const ubah = <K extends keyof AffiliateSettings>(k: K, v: AffiliateSettings[K]) => {
    setS((x) => ({ ...x, [k]: v }));
    setGalat(null);
  };
  const ubahTier = (i: number, t: Partial<CommissionTier>) => ubah('commission', s.commission.map((x, j) => (j === i ? { ...x, ...t } : x)));

  function periksa(): string | null {
    for (const t of s.commission) {
      if (Number.isNaN(t.value)) return 'Tipe dan besar komisi wajib diisi.';
      if (t.type === 'percentage' && !(t.value >= 0 && t.value <= 100)) return 'Persentase komisi harus 0 sampai 100.';
      if (t.type === 'fixed' && !(t.value >= 0 && t.value <= 100_000_000)) return 'Nilai tetap komisi harus 0 sampai 100.000.000.';
    }
    if (!(s.cookie_days >= 0 && s.cookie_days <= 3650)) return 'Umur cookie harus 0 sampai 3.650 hari.';
    if (!(s.downline_depth >= 1 && s.downline_depth <= 10 && s.upline_depth >= 1 && s.upline_depth <= 10)) return 'Kedalaman jaringan harus 1 sampai 10.';
    if (!(s.invite_days >= 1 && s.invite_days <= 90)) return 'Masa berlaku undangan harus 1 sampai 90 hari.';
    if (!(s.invite_daily_limit >= 0 && s.invite_daily_limit <= 200)) return 'Batas undangan per hari harus 0 sampai 200.';
    if (!(s.payout_minimum >= 0 && s.payout_minimum <= 100_000_000)) return 'Minimal pencairan harus 0 sampai 100.000.000.';
    if (!(s.bonus_target >= 1 && s.bonus_target <= 10_000_000_000)) return 'Target bonus harus 1 sampai 10.000.000.000.';
    if (s.bonus_type === 'percentage' && !(s.bonus_value >= 0 && s.bonus_value <= 100)) return 'Persentase bonus harus 0 sampai 100.';
    if (s.bonus_type === 'fixed' && !(s.bonus_value >= 0 && s.bonus_value <= 100_000_000)) return 'Bonus tetap harus 0 sampai 100.000.000.';
    return null;
  }

  async function simpan() {
    const g = periksa();
    if (g) {
      setGalat(g);
      return;
    }
    if (FIXTURE) {
      toast.success('Pengaturan affiliate tersimpan.');
      return;
    }
    setSibuk(true);
    const r = await affiliateAdminApi.saveSettings(s);
    setSibuk(false);
    if (r.error) {
      setGalat(r.error.message);
      return;
    }
    if (r.data) {
      setS(r.data);
      onTersimpan(r.data);
    }
    toast.success('Pengaturan affiliate tersimpan.');
  }

  return (
    <div className="space-y-4" data-pengaturan-affiliate>
      <Bagian judul="Program">
        <Saklar label="Aktifkan program affiliate" ket="Saat mati, link membawa ke toko tanpa mencatat affiliate. Komisi lama tetap bisa dibayar." nilai={s.enabled} onUbah={(v) => ubah('enabled', v)} />
        <div>
          <span className="mb-1 block text-xs font-medium text-ink-500">Siapa yang bisa menjadi affiliate</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ['approved', 'Hanya member yang diizinkan', 'Izinkan member satu per satu di tab Affiliate.'],
                ['all', 'Semua member', 'Setiap akun pembeli bisa langsung berjualan, kecuali yang diblokir.'],
              ] as const
            ).map(([v, label, ket]) => (
              <label
                key={v}
                className={cn(
                  'flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-sm',
                  s.access_mode === v ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-950/20' : 'border-ink-200 dark:border-ink-700',
                )}
              >
                <input type="radio" name="mode-akses" checked={s.access_mode === v} onChange={() => ubah('access_mode', v)} className="mt-0.5 accent-brand-600" />
                <span>
                  <span className="font-medium">{label}</span>
                  <span className="block text-xs text-ink-500">{ket}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
        <div>
          <label htmlFor="pesan-akses" className="mb-1 block text-xs font-medium text-ink-500">
            Pesan untuk member tanpa fitur affiliasi
          </label>
          <textarea id="pesan-akses" rows={2} maxLength={1000} value={s.no_access_text} onChange={(e) => ubah('no_access_text', e.target.value)} className={cn(KOLOM, 'py-2')} />
        </div>
      </Bagian>

      <Bagian judul="Cookie">
        <div className="grid gap-3 sm:grid-cols-[200px_1fr] sm:items-center">
          <label htmlFor="umur-cookie" className="text-sm font-medium">
            Umur cookie (hari)
          </label>
          <div>
            <input
              id="umur-cookie"
              type="number"
              min={0}
              max={3650}
              value={Number.isNaN(s.cookie_days) ? '' : s.cookie_days}
              onChange={(e) => ubah('cookie_days', angkaIsian(e.target.value))}
              className={cn(KOLOM, TINGGI, 'w-32')}
            />
            <p className="mt-1 text-xs text-ink-500">Isi dengan 0 jika umur cookie selamanya.</p>
          </div>
        </div>
        <Saklar label="General cookie" ket="Pembeli otomatis terdaftar sesuai affiliasi ke semua pembelian produk, bukan hanya produk yang diklik." nilai={s.general_cookie} onUbah={(v) => ubah('general_cookie', v)} />
        <Saklar
          label="Kaitkan affiliasi"
          ket="Pembeli yang sudah pernah terdaftar atas affiliasi lain, untuk pembelian selanjutnya akan selalu berdasarkan affiliasi sebelumnya. Link affiliasi lain tidak akan berpengaruh."
          nilai={s.permanent}
          onUbah={(v) => ubah('permanent', v)}
        />
      </Bagian>

      <Bagian judul="Komisi bawaan" ket="Dipakai semua produk yang tidak punya komisi khusus. Persentase dihitung dari nilai barang tanpa ongkir dan pajak.">
        <TierKomisi tier={s.commission} onUbah={(t) => ubah('commission', t)} onUbahSatu={ubahTier} />
      </Bagian>

      <Bagian judul="Jaringan" ket="Downline: jumlah tingkat di halaman Jaringan affiliate. Saat admin melihat jaringan seorang member, upline dan downline tampil sampai tingkat yang diatur di sini.">
        <div className="grid gap-3 sm:grid-cols-2">
          <AngkaKecil id="dalam-downline" label="Kedalaman jaringan (downline)" nilai={s.downline_depth} min={1} max={10} onUbah={(v) => ubah('downline_depth', v)} />
          <AngkaKecil id="dalam-upline" label="Kedalaman jaringan (upline)" nilai={s.upline_depth} min={1} max={10} onUbah={(v) => ubah('upline_depth', v)} />
        </div>
        <p className="text-xs text-ink-500">Nomor HP dan email pembeli serta downline hanya terlihat oleh admin, di Pesanan dan Pelanggan. Affiliate tidak pernah melihatnya.</p>
      </Bagian>

      <Bagian judul="Pembayaran komisi" ket="Komisi Belum dibayar ditambah bonus, dikurangi potongan retur, dibayar lewat tab Pembayaran.">
        <AngkaKecil
          id="minimal-pencairan"
          label="Minimal pencairan (Rp, 0 = tanpa minimal)"
          nilai={s.payout_minimum}
          min={0}
          max={100_000_000}
          lebar="w-44"
          onUbah={(v) => ubah('payout_minimum', v)}
        />
        <p className="text-xs text-ink-500">Di bawah minimal, admin tetap bisa membayar setelah mengonfirmasi.</p>
      </Bagian>

      <Bagian judul="Bonus target bulanan" ket="Affiliate yang omsetnya dalam satu bulan mencapai target mendapat bonus. Omset dihitung dari pesanan selesai yang dibawa affiliate itu, dikurangi retur.">
        <Saklar label="Aktifkan bonus target" nilai={s.bonus_enabled} onUbah={(v) => ubah('bonus_enabled', v)} />
        <div className="grid gap-3 sm:grid-cols-3">
          <AngkaKecil id="target-bonus" label="Target omset per bulan (Rp)" nilai={s.bonus_target} min={1} max={10_000_000_000} lebar="w-44" onUbah={(v) => ubah('bonus_target', v)} />
          <div>
            <label htmlFor="jenis-bonus" className="mb-1 block text-xs font-medium text-ink-500">
              Jenis bonus
            </label>
            <select id="jenis-bonus" value={s.bonus_type} onChange={(e) => ubah('bonus_type', e.target.value as AffiliateSettings['bonus_type'])} className={cn(KOLOM, TINGGI, 'w-full sm:w-44')}>
              <option value="percentage">Persen dari omset</option>
              <option value="fixed">Rupiah tetap</option>
            </select>
          </div>
          <AngkaKecil
            id="nilai-bonus"
            label={s.bonus_type === 'fixed' ? 'Besar bonus (Rp)' : 'Besar bonus (%)'}
            nilai={s.bonus_value}
            min={0}
            max={s.bonus_type === 'fixed' ? 100_000_000 : 100}
            lebar="w-44"
            onUbah={(v) => ubah('bonus_value', v)}
          />
        </div>
      </Bagian>

      <Bagian judul="Undangan email">
        <div className="grid gap-3 sm:grid-cols-2">
          <AngkaKecil id="hari-undangan" label="Masa berlaku undangan (hari)" nilai={s.invite_days} min={1} max={90} onUbah={(v) => ubah('invite_days', v)} />
          <AngkaKecil id="batas-undangan" label="Batas undangan per affiliate per hari (0 = tanpa batas)" nilai={s.invite_daily_limit} min={0} max={200} onUbah={(v) => ubah('invite_daily_limit', v)} />
        </div>
      </Bagian>

      <Bagian judul="Platform akuisisi" ket="Satu baris per platform, format kode;Nama. Dipakai di parameter link affiliate.">
        <textarea rows={7} value={s.platforms} onChange={(e) => ubah('platforms', e.target.value)} className={cn(KOLOM, 'py-2 font-mono text-xs')} aria-label="Daftar platform" />
      </Bagian>

      <Bagian judul="Email">
        <Saklar label="Email order baru ke affiliate" nilai={s.email_new_order} onUbah={(v) => ubah('email_new_order', v)} />
        <Saklar label="Email komisi masuk" nilai={s.email_commission} onUbah={(v) => ubah('email_commission', v)} />
        <Saklar label="Email komisi dibayar" nilai={s.email_paid} onUbah={(v) => ubah('email_paid', v)} />
        <div>
          <label htmlFor="salinan-admin" className="mb-1 block text-xs font-medium text-ink-500">
            Salinan email komisi untuk admin (opsional)
          </label>
          <input id="salinan-admin" value={s.admin_copy_emails} onChange={(e) => ubah('admin_copy_emails', e.target.value)} placeholder="admin@gnnkracing.id, owner@gnnkracing.id" className={cn(KOLOM, TINGGI)} />
          <p className="mt-1 text-xs text-ink-500">Gunakan tanda koma jika penerima ada lebih dari 1.</p>
        </div>
      </Bagian>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t border-ink-100 bg-white/95 px-4 py-3 backdrop-blur dark:border-ink-800 dark:bg-ink-950/95 sm:mx-0 sm:rounded-2xl sm:border">
        {galat && (
          <span className="mr-auto text-xs font-medium text-rose-600 dark:text-rose-400" role="alert">
            {galat}
          </span>
        )}
        <Button onClick={() => void simpan()} disabled={sibuk} className={SENTUH}>
          {sibuk ? 'Menyimpan...' : 'Simpan pengaturan'}
        </Button>
      </div>
    </div>
  );
}

/** Daftar tier komisi; dipakai juga di formulir produk. */
export function TierKomisi({
  tier,
  onUbah,
  onUbahSatu,
  kosongBoleh = false,
}: {
  tier: CommissionTier[];
  onUbah: (t: CommissionTier[]) => void;
  onUbahSatu: (i: number, t: Partial<CommissionTier>) => void;
  kosongBoleh?: boolean;
}) {
  return (
    <div className="space-y-2">
      {tier.length === 0 && <p className="text-xs text-ink-500">Belum ada tier.{kosongBoleh ? ' Produk memakai komisi bawaan toko.' : ''}</p>}
      {tier.map((t, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl bg-ink-50 p-2 dark:bg-ink-800/60">
          <span className="w-14 shrink-0 text-xs font-semibold">Tier {i + 1}</span>
          <select
            aria-label={`Tipe komisi tier ${i + 1}`}
            value={t.type}
            onChange={(e) => onUbahSatu(i, { type: e.target.value as CommissionTier['type'] })}
            className={cn(KOLOM, TINGGI, 'w-36')}
          >
            <option value="percentage">Persentase</option>
            <option value="fixed">Nilai Tetap</option>
          </select>
          <div className="relative">
            {t.type === 'fixed' && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-ink-400">Rp</span>}
            <input
              aria-label={`Besar komisi tier ${i + 1}`}
              type="number"
              min={0}
              step={t.type === 'percentage' ? 0.1 : 500}
              value={Number.isNaN(t.value) ? '' : t.value}
              onChange={(e) => onUbahSatu(i, { value: angkaIsian(e.target.value) })}
              className={cn(KOLOM, TINGGI, 'w-36 tabular-nums', t.type === 'fixed' && 'pl-9', t.type === 'percentage' && 'pr-8')}
            />
            {t.type === 'percentage' && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-400">%</span>}
          </div>
          <button
            type="button"
            onClick={() => onUbah(tier.filter((_, j) => j !== i))}
            disabled={!kosongBoleh && tier.length === 1}
            className="ml-auto grid h-[44px] w-[44px] place-items-center rounded-lg text-ink-400 hover:bg-white hover:text-rose-600 disabled:opacity-30 dark:hover:bg-ink-700 sm:h-9 sm:w-9"
            aria-label={`Hapus tier ${i + 1}`}
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      {tier.length < 5 && (
        <Button size="sm" variant="ghost" onClick={() => onUbah([...tier, { type: 'percentage', value: tier.length ? 1 : 10 }])} className={SENTUH}>
          <Plus size={14} /> Tambah tier
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bagian kecil

function Bagian({ judul, ket, children }: { judul: string; ket?: string; children: ReactNode }) {
  return (
    <Card className="space-y-3 p-4 sm:p-5">
      <div>
        <h2 className="text-sm font-semibold">{judul}</h2>
        {ket && <p className="text-xs text-ink-500">{ket}</p>}
      </div>
      {children}
    </Card>
  );
}

function Saklar({ label, ket, nilai, onUbah }: { label: string; ket?: string; nilai: boolean; onUbah: (v: boolean) => void }) {
  return (
    <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-4 sm:min-h-0">
      <span className="text-sm">
        <span className="font-medium">{label}</span>
        {ket && <span className="block text-xs text-ink-500">{ket}</span>}
      </span>
      <span className="relative inline-flex shrink-0">
        <input type="checkbox" role="switch" checked={nilai} onChange={(e) => onUbah(e.target.checked)} className="peer sr-only" />
        <span className="h-6 w-11 rounded-full bg-ink-200 transition-colors duration-150 peer-checked:bg-brand-600 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500/40 dark:bg-ink-700" />
        <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-150 peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

/**
 * Isian angka yang dikosongkan tetap kosong (NaN), tidak menjadi 0. Number('')
 * bernilai 0, sehingga umur cookie yang dihapus diam-diam tersimpan "selamanya"
 * dan komisi yang dihapus tersimpan 0%. Server menolak NaN dengan pesan PRD.
 */
export function angkaIsian(teks: string): number {
  return teks.trim() === '' ? NaN : Number(teks);
}

function AngkaKecil({ id, label, nilai, min, max, lebar = 'w-32', onUbah }: { id: string; label: string; nilai: number; min: number; max: number; lebar?: string; onUbah: (v: number) => void }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-ink-500">
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        value={Number.isNaN(nilai) ? '' : nilai}
        onChange={(e) => onUbah(angkaIsian(e.target.value))}
        className={cn(KOLOM, TINGGI, lebar)}
      />
    </div>
  );
}

function Ubin({ ikon: Ikon, label, nilai, ket, tonjol }: { ikon?: LucideIcon; label: string; nilai: string; ket?: string; tonjol?: boolean }) {
  return (
    <Card className={cn('min-w-0 p-4', tonjol && 'border-brand-600 bg-brand-600 text-white dark:bg-brand-700')}>
      <div className={cn('flex items-center gap-2 text-xs', tonjol ? 'text-white/80' : 'text-ink-500')}>
        {Ikon && (
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/50">
            <Ikon size={14} />
          </span>
        )}
        <span>{label}</span>
      </div>
      <div className="mt-2 truncate text-xl font-bold tracking-tight tabular-nums" title={nilai}>
        {nilai}
      </div>
      {ket && <div className={cn('mt-0.5 line-clamp-2 text-xs', tonjol ? 'text-white/90' : 'text-ink-500')}>{ket}</div>}
    </Card>
  );
}

function Chip<T extends string>({ label, nilai, onUbah, pilihan }: { label: string; nilai: T; onUbah: (v: T) => void; pilihan: [T, string][] }) {
  return (
    <div className="flex min-w-0 max-w-full items-center gap-1.5">
      <span className="shrink-0 text-xs text-ink-500">{label}:</span>
      <div className="tanpa-bilah flex gap-1 overflow-x-auto rounded-full bg-ink-100 p-1 text-xs font-semibold dark:bg-ink-800">
        {pilihan.map(([v, l]) => (
          <button
            key={v || 'semua'}
            type="button"
            onClick={() => onUbah(v)}
            className={cn('min-h-[44px] shrink-0 whitespace-nowrap rounded-full px-2.5 sm:min-h-[32px]', nilai === v ? 'bg-white shadow-card dark:bg-ink-700' : 'text-ink-600 dark:text-ink-300')}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Permintaan gagal: pesan dan tombol coba lagi. `polos` untuk dipakai di dalam kartu lain. */
function GagalMuat({ onUlang, polos }: { onUlang: () => void; polos?: boolean }) {
  const isi = (
    <div className="p-6 text-center" role="alert" data-gagal-muat>
      <p className="text-sm text-ink-700 dark:text-ink-200">Data affiliate gagal dimuat. Coba lagi.</p>
      <Button variant="secondary" className="mt-3 min-h-[44px] sm:min-h-0" onClick={onUlang}>
        <RefreshCw size={15} /> Coba lagi
      </Button>
    </div>
  );
  return polos ? isi : <Card>{isi}</Card>;
}

function Kerangka() {
  return (
    <div className="space-y-2" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-14 animate-pulse rounded-xl bg-ink-100 dark:bg-ink-800" />
      ))}
    </div>
  );
}
