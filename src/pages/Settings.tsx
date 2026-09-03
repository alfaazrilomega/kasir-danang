import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  Building2,
  Check,
  CheckCircle2,
  Coins,
  Database,
  Download,
  ImagePlus,
  Link2,
  LogOut,
  Monitor,
  Lock,
  LockOpen,
  Receipt as ReceiptIcon,
  RefreshCcw,
  Settings as SettingsIcon,
  ShieldCheck,
  Store as StoreIcon,
  Trash2,
  Upload,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, TextArea } from '@/components/ui/Input';
import { useAuth } from '@/stores/auth';
import { ImportExportModal } from '@/components/data/ImportExportModal';
import { usePinLock } from '@/stores/pinLock';
import { useUI } from '@/stores/ui';
import { PinSetupModal } from '@/components/pin/PinSetupModal';
import { SalesChannelsPanel } from '@/components/settings/SalesChannelsPanel';
import { loadConfig, resetConfig } from '@/lib/config';
import { resetBackendClient, getBackendClient } from '@/lib/api';
import { clearLocalCache, db } from '@/lib/db';
import { usePwaInstall } from '@/lib/pwaInstall';
import {
  flushPending,
  pullInventoryReference,
  pullLoyalty,
  pullRecentOrders,
  pullReference,
  pullShifts,
  pendingCount,
} from '@/lib/sync';
import { useNavigate } from '@/lib/router';
import { cn, formatDateTime, formatMoney } from '@/lib/format';
import { resizeImageToDataUrl, formatBytes } from '@/lib/imageUpload';
import { ACCENTS } from '@/lib/accents';
import { hasCapability } from '@/lib/roles';
import {
  DEFAULT_INDUSTRY,
  SELECTABLE_INDUSTRIES,
  getIndustry,
  resolveFeatures,
  type IndustryFeatures,
  type IndustryId,
} from '@/lib/industries';
import type { Store } from '@/types';

const LAST_SYNC_KEY = 'kasir.lastSync.v1';

interface FormState {
  storeName: string;
  address: string;
  currency: string;
  taxRate: number;
  receiptHeader: string;
  receiptFooter: string;
  pointsPerAmount: number;
  lowStock: number;
  industry: IndustryId;
  features: IndustryFeatures;
  logoUrl: string | null;
}

function snapshot(store: Store | null): FormState {
  return {
    storeName: store?.name ?? '',
    address: store?.address ?? '',
    currency: store?.currency ?? 'IDR',
    taxRate: Number(store?.tax_rate ?? 10),
    receiptHeader: store?.receipt_header ?? '',
    receiptFooter: store?.receipt_footer ?? '',
    pointsPerAmount: Number(store?.points_per_amount ?? 0),
    lowStock: Number(store?.low_stock_threshold ?? 5),
    industry: (store?.industry as IndustryId) ?? DEFAULT_INDUSTRY,
    features: resolveFeatures(store?.industry, store?.features as never),
    logoUrl: store?.logo_url ?? null,
  };
}

const SECTIONS: { id: string; label: string; icon: typeof SettingsIcon }[] = [
  { id: 'profile', label: 'Profil', icon: Building2 },
  { id: 'business', label: 'Jenis Usaha', icon: SettingsIcon },
  { id: 'receipt', label: 'Struk', icon: ReceiptIcon },
  { id: 'loyalty', label: 'Loyalitas', icon: Coins },
  { id: 'channels', label: 'Channel', icon: StoreIcon },
  { id: 'security', label: 'Keamanan', icon: ShieldCheck },
  { id: 'display', label: 'Tampilan', icon: Monitor },
  { id: 'connection', label: 'Koneksi', icon: Link2 },
];

export function Settings() {
  const navigate = useNavigate();
  const { profile, store, signOut, refreshProfile } = useAuth();
  const { theme, setTheme, accent, setAccent } = useUI();
  const { canInstall, installed: pwaInstalled, promptInstall } = usePwaInstall();
  const cfg = loadConfig();
  const canManageStore = hasCapability(profile?.role, 'manageStoreSettings');
  const canManageInventory = hasCapability(profile?.role, 'manageInventory');
  const canUseCashier = hasCapability(profile?.role, 'useCashier');
  const visibleSections = useMemo(
    () =>
      SECTIONS.filter(
        (section) =>
          canManageStore || !['business', 'receipt', 'loyalty'].includes(section.id),
      ),
    [canManageStore],
  );

  const [form, setForm] = useState<FormState>(() => snapshot(store));
  const [initial, setInitial] = useState<FormState>(() => snapshot(store));
  const [profileName, setProfileName] = useState(() => displayEditableProfileName(profile?.full_name));
  const [initialProfileName, setInitialProfileName] = useState(() =>
    displayEditableProfileName(profile?.full_name),
  );

  const [pending, setPending] = useState(0);
  const [busy, setBusy] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [online, setOnline] = useState<boolean>(navigator.onLine);
  const [pinModal, setPinModal] = useState<null | 'create' | 'change' | 'disable'>(null);
  const pinEnabled = usePinLock((s) => s.pinEnabled);
  const pinTimeout = usePinLock((s) => s.inactivityTimeoutMinutes);
  const setPinTimeout = usePinLock((s) => s.setTimeoutMinutes);
  const lockNow = usePinLock((s) => s.lock);
  const [lastSync, setLastSync] = useState<string | null>(() => localStorage.getItem(LAST_SYNC_KEY));
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const snap = snapshot(store);
    setForm(snap);
    setInitial(snap);
  }, [store]);

  useEffect(() => {
    const name = displayEditableProfileName(profile?.full_name);
    setProfileName(name);
    setInitialProfileName(name);
  }, [profile?.id, profile?.full_name]);

  useEffect(() => {
    pendingCount().then(setPending);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const storeDirty = useMemo(
    () => canManageStore && !shallowEqualForm(form, initial),
    [canManageStore, form, initial],
  );
  const profileDirty = profileName.trim() !== initialProfileName.trim();
  const dirty = storeDirty || profileDirty;

  const patch = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((s) => ({ ...s, [key]: value }));

  const setFeature = <K extends keyof IndustryFeatures>(key: K, value: IndustryFeatures[K]) =>
    setForm((s) => ({ ...s, features: { ...s.features, [key]: value } }));

  async function handleLogoChange(file: File | undefined | null) {
    if (!file) return;
    try {
      const processed = await resizeImageToDataUrl(file, { maxDim: 600, quality: 0.85 });
      patch('logoUrl', processed.dataUrl);
      toast.success(`Logo dimuat (${formatBytes(processed.bytes)}).`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal memproses gambar.');
    }
  }

  async function saveStore() {
    if (!store || !canManageStore) return;
    const payload = {
      name: form.storeName,
      address: form.address,
      currency: form.currency,
      tax_rate: form.taxRate,
      receipt_header: form.receiptHeader || null,
      receipt_footer: form.receiptFooter || null,
      points_per_amount: form.pointsPerAmount,
      low_stock_threshold: form.lowStock,
      industry: form.industry,
      features: form.features as unknown as Record<string, unknown>,
      logo_url: form.logoUrl,
    };
    setBusy(true);
    const api = getBackendClient();
    if (api) {
      const { error } = await api.from('stores').update(payload).eq('id', store.id);
      if (error) {
        setBusy(false);
        toast.error(error.message);
        return;
      }
    }
    await db.stores.put({ ...store, ...payload });
    await refreshProfile();
    setBusy(false);
    toast.success('Pengaturan toko disimpan.');
  }

  async function saveProfile(): Promise<boolean> {
    if (!profile || !profileDirty) return true;
    const fullName = profileName.trim();
    if (!fullName) {
      toast.error('Nama pengguna wajib diisi.');
      return false;
    }

    setBusy(true);
    const api = getBackendClient();
    if (!api) {
      setBusy(false);
      toast.error('Backend API belum siap.');
      return false;
    }

    const { error } = await api
      .from('profiles')
      .update({ full_name: fullName })
      .eq('id', profile.id);
    if (error) {
      setBusy(false);
      toast.error(error.message);
      return false;
    }

    await refreshProfile();
    setInitialProfileName(fullName);
    setBusy(false);
    toast.success('Profil pengguna disimpan.');
    return true;
  }

  async function saveSettings() {
    if (profileDirty && !(await saveProfile())) return;
    if (canManageStore && storeDirty) await saveStore();
  }

  function discard() {
    setForm(initial);
    setProfileName(initialProfileName);
    toast.message('Perubahan dibatalkan.');
  }

  async function manualSync() {
    if (!profile?.store_id) return;
    setBusy(true);
    const flushed = canUseCashier ? await flushPending() : { ok: 0 };
    if (canUseCashier) {
      await Promise.all([
        pullReference(profile.store_id),
        pullRecentOrders(profile.store_id, 200),
        pullShifts(profile.store_id),
        pullLoyalty(profile.store_id),
      ]);
    } else if (canManageInventory) {
      await pullInventoryReference(profile.store_id);
    }
    const now = new Date().toISOString();
    localStorage.setItem(LAST_SYNC_KEY, now);
    setLastSync(now);
    setBusy(false);
    setPending(await pendingCount());
    toast.success(`Sinkronisasi selesai. ${flushed.ok} pesanan terkirim.`);
  }

  async function wipeLocal() {
    if (!confirm('Hapus semua cache lokal? Data di Postgres tetap aman.')) return;
    await clearLocalCache();
    toast.success('Cache lokal dihapus.');
  }

  async function resetLocalConnection() {
    if (!confirm('Reset konfigurasi koneksi lokal, hapus cache, lalu keluar?')) return;
    resetConfig();
    resetBackendClient();
    await clearLocalCache();
    await signOut();
    navigate('/login', { replace: true });
  }

  async function installDesktopApp() {
    const outcome = await promptInstall();
    if (outcome === 'accepted') {
      toast.success('Aplikasi terpasang di desktop.');
    } else if (outcome === 'dismissed') {
      toast.message('Install dibatalkan.');
    } else {
      toast.message('Install belum tersedia. Coba dari Chrome/Edge saat online.');
    }
  }

  function jumpTo(id: string) {
    const el = document.getElementById(`section-${id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="space-y-5 pb-28">
      <ImportExportModal
        open={transferOpen}
        storeId={profile?.store_id ?? ''}
        onClose={() => setTransferOpen(false)}
        onImported={() => { void refreshProfile(); }}
      />
      <div className="rounded-3xl bg-brand-600 text-white p-6 md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Settings</h1>
            <p className="opacity-80">Profil toko, struk, loyalitas, dan koneksi.</p>
          </div>
          <div className="flex flex-wrap gap-1.5 rounded-full bg-white/10 p-1">
            {visibleSections.map((s) => {
              const Icon = s.icon;
              return (
                <button
                  key={s.id}
                  onClick={() => jumpTo(s.id)}
                  className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-white/85 hover:bg-white/15 hover:text-white"
                >
                  <Icon size={12} /> {s.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <Section id="profile" icon={Building2} title="Profil Toko" description="Identitas yang muncul di struk dan dashboard.">
        <div className="flex flex-col gap-5 md:flex-row">
          {canManageStore && (
            <div className="flex shrink-0 flex-col items-center gap-2">
              <div className="h-24 w-24 overflow-hidden rounded-2xl border border-ink-100 bg-ink-50 dark:border-ink-800 dark:bg-ink-900 grid place-items-center">
                {form.logoUrl ? (
                  <img src={form.logoUrl} alt="Logo" className="h-full w-full object-cover" />
                ) : (
                  <ImagePlus className="text-ink-400" size={28} />
                )}
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-lg border border-ink-200 px-2.5 py-1 text-xs font-medium hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800"
                >
                  <Upload size={12} className="inline mr-1" />
                  {form.logoUrl ? 'Ganti' : 'Upload'}
                </button>
                {form.logoUrl && (
                  <button
                    type="button"
                    onClick={() => patch('logoUrl', null)}
                    className="rounded-lg border border-ink-200 px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:border-ink-700 dark:hover:bg-rose-500/10"
                  >
                    <X size={12} className="inline" />
                  </button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  handleLogoChange(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </div>
          )}
          <div className="grid flex-1 gap-3 md:grid-cols-2">
            <Input
              label="Nama Pengguna"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              placeholder="Nama kasir / admin"
              hint="Nama ini dipakai untuk sapaan Welcome di Dashboard."
            />
            <Input label="Email Akun" value={profile?.email ?? ''} disabled />
            {canManageStore && (
              <>
                <Input label="Nama Toko" value={form.storeName} onChange={(e) => patch('storeName', e.target.value)} />
                <Input label="Alamat" value={form.address} onChange={(e) => patch('address', e.target.value)} />
                <div>
                  <label className="block text-sm font-medium mb-1.5">Mata Uang</label>
                  <select
                    className="input"
                    value={form.currency}
                    onChange={(e) => patch('currency', e.target.value)}
                  >
                    <option value="IDR">IDR — Rupiah</option>
                    <option value="USD">USD — Dollar</option>
                    <option value="MYR">MYR — Ringgit</option>
                    <option value="SGD">SGD — Singapore Dollar</option>
                  </select>
                  <p className="text-xs text-ink-500 mt-1">
                    Contoh: {formatMoney(25000, form.currency)}
                  </p>
                </div>
                <Input
                  label="Pajak (%)"
                  type="number"
                  step="0.01"
                  value={form.taxRate}
                  onChange={(e) => patch('taxRate', parseFloat(e.target.value) || 0)}
                  hint={`Pajak ${form.taxRate}% otomatis ditambahkan ke setiap order.`}
                />
              </>
            )}
          </div>
        </div>
      </Section>

      {canManageStore && (
        <>
          <Section
            id="business"
            icon={SettingsIcon}
            title="Jenis Usaha & Fitur POS"
            description="Jenis usaha menentukan fitur bawaan POS. Tiap saklar di bawah tetap bisa diatur sendiri."
          >
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {SELECTABLE_INDUSTRIES.map((opt) => {
                const Icon = opt.Icon;
                const active = form.industry === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() =>
                      setForm((s) => ({ ...s, industry: opt.id, features: opt.features }))
                    }
                    className={cn(
                      'relative flex items-start gap-2 rounded-xl border-2 p-3 text-left transition',
                      active
                        ? 'border-brand-600 bg-brand-50 dark:bg-brand-950/30'
                        : 'border-ink-100 dark:border-ink-800 hover:border-brand-300',
                    )}
                  >
                    {active && (
                      <CheckCircle2
                        size={14}
                        className="absolute right-2 top-2 text-brand-600"
                      />
                    )}
                    <span
                      className={cn(
                        'grid h-8 w-8 shrink-0 place-items-center rounded-lg',
                        active ? 'bg-brand-600 text-white' : 'bg-ink-100 dark:bg-ink-800 text-ink-500',
                      )}
                    >
                      <Icon size={14} />
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">{opt.label}</div>
                      <div className="text-[11px] text-ink-500 line-clamp-2">{opt.tagline}</div>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="mt-4 rounded-xl border border-ink-100 dark:border-ink-800 p-3 space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                Fitur aktif
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <FeatureToggle
                  label="Order type (Dine-in / Take-away)"
                  hint="Tampilkan tombol pilih tipe order di kasir."
                  checked={form.features.useOrderType}
                  onChange={(v) => setFeature('useOrderType', v)}
                />
                <FeatureToggle
                  label="Nomor meja"
                  hint="Field nomor meja di panel order."
                  checked={form.features.useTable}
                  onChange={(v) => setFeature('useTable', v)}
                />
                <FeatureToggle
                  label="Varian ukuran (S/M/L)"
                  hint="Tampilkan size pill di kartu produk."
                  checked={form.features.useSizes}
                  onChange={(v) => setFeature('useSizes', v)}
                />
                <FeatureToggle
                  label="Lacak stok default"
                  hint="Produk baru otomatis on stock tracking."
                  checked={form.features.defaultTrackStock}
                  onChange={(v) => setFeature('defaultTrackStock', v)}
                />
              </div>
              <button
                onClick={() =>
                  setForm((s) => ({ ...s, features: getIndustry(s.industry).features }))
                }
                className="text-xs text-brand-600 hover:underline"
              >
                Reset ke default {getIndustry(form.industry).label}
              </button>
            </div>
          </Section>

          <Section
            id="receipt"
            icon={ReceiptIcon}
            title="Template Struk"
            description="Header & footer tercetak di struk fisik maupun struk digital."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-3">
                <TextArea
                  label="Header struk"
                  placeholder="Selamat datang!"
                  value={form.receiptHeader}
                  onChange={(e) => patch('receiptHeader', e.target.value)}
                />
                <TextArea
                  label="Footer struk"
                  placeholder="Terima kasih atas kunjungan Anda!"
                  value={form.receiptFooter}
                  onChange={(e) => patch('receiptFooter', e.target.value)}
                />
              </div>
              <ReceiptPreview
                storeName={form.storeName || 'Nama Toko'}
                address={form.address}
                header={form.receiptHeader}
                footer={form.receiptFooter}
                currency={form.currency}
                taxRate={form.taxRate}
              />
            </div>
          </Section>

          <Section
            id="loyalty"
            icon={Coins}
            title="Loyalitas & Stok"
            description="Aturan poin pelanggan & ambang stok menipis."
          >
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                label={`Poin per ${form.currency} 1`}
                type="number"
                step="0.0001"
                value={form.pointsPerAmount}
                onChange={(e) => patch('pointsPerAmount', parseFloat(e.target.value) || 0)}
                hint={`Contoh: 0.001 -> setiap ${form.currency} 1.000 = 1 poin. 0 = matikan loyalitas.`}
              />
              <Input
                label="Ambang stok menipis (default)"
                type="number"
                value={form.lowStock}
                onChange={(e) => patch('lowStock', parseFloat(e.target.value) || 0)}
                hint="Bisa di-override per produk."
              />
            </div>
          </Section>

          <Section
            id="channels"
            icon={StoreIcon}
            title="Channel Penjualan"
            description="Marketplace dan potongannya. Dipakai POS untuk memperkirakan penerimaan bersih dan jatuh tempo piutang."
          >
            <SalesChannelsPanel storeId={profile?.store_id ?? ''} />
          </Section>
        </>
      )}

      <Section
        id="security"
        icon={ShieldCheck}
        title="Keamanan & PIN"
        description="Kunci aplikasi dengan PIN saat idle atau saat Anda menutupnya."
        headerExtra={
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
              pinEnabled
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                : 'bg-ink-100 text-ink-500 dark:bg-ink-800',
            )}
          >
            {pinEnabled ? <Lock size={12} /> : <LockOpen size={12} />}
            {pinEnabled ? 'Aktif' : 'Nonaktif'}
          </span>
        }
      >
        {!pinEnabled ? (
          <div className="rounded-xl border border-dashed border-ink-200 p-4 dark:border-ink-700">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950/40">
                <ShieldCheck size={18} />
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold">
                  PIN belum diaktifkan{' '}
                  <span className="ml-1 text-[10px] font-bold uppercase text-amber-600">
                    Direkomendasikan
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-ink-500">
                  PIN melindungi aplikasi saat ditinggal — otomatis terkunci setelah idle.
                  Hanya tersimpan di perangkat ini.
                </p>
              </div>
              <Button size="sm" onClick={() => setPinModal('create')}>
                <ShieldCheck size={14} /> Aktifkan PIN
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Auto-lock setelah idle</label>
              <div className="flex flex-wrap gap-1.5">
                {[15, 30, 60, 120].map((m) => (
                  <button
                    key={m}
                    onClick={() => setPinTimeout(m)}
                    className={cn(
                      'rounded-full px-3 py-1 text-xs font-semibold transition',
                      pinTimeout === m
                        ? 'bg-brand-600 text-white'
                        : 'bg-ink-100 text-ink-700 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-200',
                    )}
                  >
                    {m < 60 ? `${m} menit` : `${m / 60} jam`}
                  </button>
                ))}
              </div>
              <p className="text-xs text-ink-500 mt-1.5">
                Saat idle melewati durasi ini, aplikasi mengunci diri dan minta PIN.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => setPinModal('change')}>
                <ShieldCheck size={14} /> Ganti PIN
              </Button>
              <Button variant="secondary" size="sm" onClick={lockNow}>
                <Lock size={14} /> Kunci sekarang
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setPinModal('disable')}>
                <LockOpen size={14} /> Nonaktifkan PIN
              </Button>
            </div>
          </div>
        )}
        <PinSetupModal
          open={pinModal !== null}
          mode={pinModal ?? 'create'}
          onClose={() => setPinModal(null)}
        />
      </Section>

      <Section id="display" icon={Monitor} title="Tampilan" description="Skema warna aplikasi.">
        <div className="text-sm font-semibold mb-2">Mode</div>
        <div className="grid gap-2 sm:grid-cols-2 max-w-md">
          <button
            onClick={() => setTheme('light')}
            className={cn(
              'flex items-center gap-3 rounded-xl border-2 p-3 text-left transition',
              theme === 'light'
                ? 'border-brand-600 bg-brand-50 dark:bg-brand-950/30'
                : 'border-ink-100 dark:border-ink-800',
            )}
          >
            <div className="h-10 w-10 rounded-lg bg-white border border-ink-200" />
            <div>
              <div className="text-sm font-semibold">Light</div>
              <div className="text-[11px] text-ink-500">Terang, ideal siang hari.</div>
            </div>
          </button>
          <button
            onClick={() => setTheme('dark')}
            className={cn(
              'flex items-center gap-3 rounded-xl border-2 p-3 text-left transition',
              theme === 'dark'
                ? 'border-brand-600 bg-brand-50 dark:bg-brand-950/30'
                : 'border-ink-100 dark:border-ink-800',
            )}
          >
            <div className="h-10 w-10 rounded-lg bg-ink-900 border border-ink-700" />
            <div>
              <div className="text-sm font-semibold">Dark</div>
              <div className="text-[11px] text-ink-500">Mata adem, hemat baterai OLED.</div>
            </div>
          </button>
        </div>

        <div className="mt-6 text-sm font-semibold">Warna Aksen</div>
        <div className="text-[11px] text-ink-500 mb-2">Warna utama tombol, navigasi, dan sorotan.</div>
        <div className="flex flex-wrap gap-2">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setAccent(a.id)}
              className={cn(
                'flex items-center gap-2 rounded-xl border-2 py-1.5 pl-1.5 pr-3 transition',
                accent === a.id
                  ? 'border-brand-600 bg-brand-50 dark:bg-brand-950/30'
                  : 'border-ink-100 dark:border-ink-800',
              )}
            >
              <span
                className="grid h-7 w-7 place-items-center rounded-lg"
                style={{ backgroundColor: a.swatch }}
              >
                {accent === a.id && <Check size={14} className="text-white" />}
              </span>
              <span className="text-xs font-semibold">{a.label}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section
        id="connection"
        icon={Link2}
        title="Koneksi & Sinkronisasi"
        description="Status sambungan ke backend API dan kontrol sinkronisasi."
        headerExtra={
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
              online
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                : 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
            )}
          >
            {online ? <Wifi size={12} /> : <WifiOff size={12} />}
            {online ? 'Online' : 'Offline'}
          </span>
        }
      >
        <div className="grid gap-3 md:grid-cols-2">
          <Info label="Backend API" value={cfg.apiBaseUrl || 'Same-origin'} />
          <Info label="Toko ID" value={profile?.store_id ?? '—'} />
          <Info
            label="Pending pesanan"
            value={String(pending)}
            tone={pending > 0 ? 'warning' : undefined}
            icon={pending > 0 ? <WifiOff size={14} /> : undefined}
          />
          <Info label="Akun" value={profile?.email ?? '—'} />
          <Info
            label="Sinkronisasi terakhir"
            value={lastSync ? formatDateTime(lastSync) : 'Belum pernah'}
          />
          <Info label="Versi data" value="Postgres" />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={manualSync} variant="secondary" disabled={busy}>
            <RefreshCcw size={14} /> Sync sekarang
          </Button>
          <Button onClick={() => setTransferOpen(true)} variant="secondary" disabled={busy}>
            <Database size={14} /> Impor / Ekspor Data
          </Button>
          <Button onClick={wipeLocal} variant="secondary">
            <Trash2 size={14} /> Hapus cache lokal
          </Button>
          <Button onClick={resetLocalConnection} variant="secondary">
            <Database size={14} /> Reset koneksi lokal
          </Button>
          <Button
            onClick={async () => {
              await signOut();
              navigate('/login');
            }}
            variant="danger"
          >
            <LogOut size={14} /> Sign out
          </Button>
        </div>
        <div className="mt-4 rounded-xl border border-ink-100 dark:border-ink-800 p-3 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="font-semibold mb-0.5">Install Desktop/PWA</div>
              <p className="text-xs text-ink-500">
                Akses cepat & mode offline lebih andal dari desktop.
              </p>
            </div>
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
                pwaInstalled
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                  : canInstall
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200'
                    : 'bg-ink-100 text-ink-500 dark:bg-ink-800',
              )}
            >
              {pwaInstalled ? 'Terpasang' : canInstall ? 'Siap install' : 'Menunggu browser'}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={installDesktopApp} disabled={!canInstall}>
              <Download size={14} /> Install Desktop
            </Button>
            <Button variant="secondary" onClick={() => location.reload()}>
              <RefreshCcw size={14} /> Update Service Worker
            </Button>
          </div>
        </div>
      </Section>

      {dirty && (
        <div className="fixed inset-x-0 bottom-4 z-30 flex justify-center px-4 pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-3 rounded-2xl bg-ink-900 text-white px-4 py-3 shadow-xl shadow-black/30 border border-white/10">
            <span className="inline-flex h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-sm font-medium">Ada perubahan belum disimpan</span>
            <button
              onClick={discard}
              className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold hover:bg-white/20"
              disabled={busy}
            >
              Batalkan
            </button>
            <button
              onClick={saveSettings}
              className="rounded-full bg-brand-500 px-3.5 py-1.5 text-xs font-semibold hover:bg-brand-400 disabled:opacity-60"
              disabled={busy}
            >
              <Check size={12} className="inline mr-1" />
              {busy ? 'Menyimpan…' : 'Simpan'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({
  id,
  icon: Icon,
  title,
  description,
  headerExtra,
  children,
}: {
  id: string;
  icon: typeof SettingsIcon;
  title: string;
  description?: string;
  headerExtra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card id={`section-${id}`} className="p-5 scroll-mt-4">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/40">
            <Icon size={15} />
          </span>
          <div>
            <h2 className="font-semibold">{title}</h2>
            {description && <p className="text-xs text-ink-500">{description}</p>}
          </div>
        </div>
        {headerExtra}
      </div>
      {children}
    </Card>
  );
}

function FeatureToggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className={cn(
        'flex items-start gap-2 rounded-xl p-2.5 cursor-pointer border transition',
        checked
          ? 'bg-brand-50 border-brand-200 dark:bg-brand-950/30 dark:border-brand-800'
          : 'bg-ink-50 border-transparent dark:bg-ink-900',
      )}
    >
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 accent-brand-600"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-[11px] text-ink-500">{hint}</div>
      </div>
    </label>
  );
}

function Info({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
  tone?: 'warning';
}) {
  return (
    <div
      className={cn(
        'rounded-xl border p-3',
        tone === 'warning'
          ? 'border-amber-200 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-700'
          : 'border-ink-100 dark:border-ink-800',
      )}
    >
      <div className="text-xs text-ink-500">{label}</div>
      <div className="mt-0.5 flex items-center gap-1.5 font-medium truncate">
        {icon}
        <span className="truncate">{value}</span>
      </div>
    </div>
  );
}

function ReceiptPreview({
  storeName,
  address,
  header,
  footer,
  currency,
  taxRate,
}: {
  storeName: string;
  address: string;
  header: string;
  footer: string;
  currency: string;
  taxRate: number;
}) {
  const subtotal = 75000;
  const tax = Math.round((subtotal * taxRate) / 100);
  const total = subtotal + tax;
  return (
    <div>
      <div className="text-xs font-medium text-ink-500 mb-1.5">Pratinjau struk</div>
      <div className="rounded-xl border border-dashed border-ink-200 bg-ink-50 dark:border-ink-700 dark:bg-ink-900 p-4 font-mono text-[11px] leading-relaxed text-ink-700 dark:text-ink-200">
        <div className="text-center">
          <div className="font-semibold uppercase tracking-wide">{storeName}</div>
          {address && <div className="text-[10px] text-ink-500">{address}</div>}
        </div>
        {header && (
          <div className="mt-2 text-center whitespace-pre-wrap text-[10px]">{header}</div>
        )}
        <div className="my-2 border-t border-dashed border-ink-300 dark:border-ink-700" />
        <div className="flex justify-between">
          <span>2× Espresso</span>
          <span>{formatMoney(36000, currency)}</span>
        </div>
        <div className="flex justify-between">
          <span>1× Iced Latte</span>
          <span>{formatMoney(39000, currency)}</span>
        </div>
        <div className="my-2 border-t border-dashed border-ink-300 dark:border-ink-700" />
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{formatMoney(subtotal, currency)}</span>
        </div>
        <div className="flex justify-between text-ink-500">
          <span>Pajak {taxRate}%</span>
          <span>{formatMoney(tax, currency)}</span>
        </div>
        <div className="flex justify-between font-semibold">
          <span>Total</span>
          <span>{formatMoney(total, currency)}</span>
        </div>
        {footer && (
          <>
            <div className="my-2 border-t border-dashed border-ink-300 dark:border-ink-700" />
            <div className="text-center whitespace-pre-wrap text-[10px]">{footer}</div>
          </>
        )}
      </div>
    </div>
  );
}

function shallowEqualForm(a: FormState, b: FormState): boolean {
  return (
    a.storeName === b.storeName &&
    a.address === b.address &&
    a.currency === b.currency &&
    a.taxRate === b.taxRate &&
    a.receiptHeader === b.receiptHeader &&
    a.receiptFooter === b.receiptFooter &&
    a.pointsPerAmount === b.pointsPerAmount &&
    a.lowStock === b.lowStock &&
    a.industry === b.industry &&
    a.logoUrl === b.logoUrl &&
    a.features.useOrderType === b.features.useOrderType &&
    a.features.useTable === b.features.useTable &&
    a.features.useSizes === b.features.useSizes &&
    a.features.defaultTrackStock === b.features.defaultTrackStock
  );
}

function displayEditableProfileName(value: string | null | undefined): string {
  const name = value?.trim() ?? '';
  return name.includes('@') ? '' : name;
}
