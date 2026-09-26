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
  Plus,
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
import { Globe } from 'lucide-react';
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
  signatureUrl: string | null;
  signerName: string;
  shopPhone: string;
  shopCity: string;
  returnPolicy: string;
  warrantyInfo: string;
  pdpBanner: string | null;
  bankName: string;
  bankAccountNumber: string;
  bankAccountName: string;
  qrisImage: string | null;
  socialFacebook: string;
  socialInstagram: string;
  socialTiktok: string;
  socialYoutube: string;
  footerLinks: { label: string; url: string }[];
  chatEnabled: boolean;
}

/** Batas baris tautan artikel di footer toko online, biar daftarnya tidak kepanjangan. */
const MAX_FOOTER_LINKS = 8;

/** "Seadanya": cukup pastikan skemanya http/https, tidak perlu parser URL penuh. */
function hasUrlScheme(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
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
    signatureUrl: store?.invoice_signature_url ?? null,
    signerName: store?.invoice_signer_name ?? '',
    shopPhone: store?.shop_phone ?? '',
    shopCity: store?.shop_city ?? '',
    returnPolicy: store?.return_policy ?? '',
    warrantyInfo: store?.warranty_info ?? '',
    pdpBanner: store?.pdp_banner_url ?? null,
    bankName: store?.bank_name ?? '',
    bankAccountNumber: store?.bank_account_number ?? '',
    bankAccountName: store?.bank_account_name ?? '',
    qrisImage: store?.qris_image_url ?? null,
    socialFacebook: store?.social_facebook ?? '',
    socialInstagram: store?.social_instagram ?? '',
    socialTiktok: store?.social_tiktok ?? '',
    socialYoutube: store?.social_youtube ?? '',
    footerLinks: store?.footer_links ?? [],
    chatEnabled: store?.chat_enabled ?? true,
  };
}

const SECTIONS: { id: string; label: string; icon: typeof SettingsIcon }[] = [
  { id: 'profile', label: 'Profil', icon: Building2 },
  { id: 'business', label: 'Jenis Usaha', icon: SettingsIcon },
  { id: 'receipt', label: 'Struk', icon: ReceiptIcon },
  { id: 'online', label: 'Toko Online', icon: Globe },
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
  const signatureInputRef = useRef<HTMLInputElement | null>(null);

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

  async function handleSignatureChange(file: File | undefined | null) {
    if (!file) return;
    try {
      // PNG tetap PNG, jadi latar transparan tanda tangan tidak berubah hitam.
      const processed = await resizeImageToDataUrl(file, { maxDim: 600, quality: 0.9 });
      patch('signatureUrl', processed.dataUrl);
      toast.success(`Tanda tangan dimuat (${formatBytes(processed.bytes)}).`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal memproses gambar.');
    }
  }

  async function saveStore() {
    if (!store || !canManageStore) return;

    // Validasi URL seadanya: kolom kosong sah (berarti tidak dipakai), yang
    // diisi wajib berskema http/https supaya ikon/tautan di toko online tidak
    // menunjuk ke alamat yang salah.
    const socialInputs: [string, string][] = [
      ['Facebook', form.socialFacebook],
      ['Instagram', form.socialInstagram],
      ['TikTok', form.socialTiktok],
      ['YouTube', form.socialYoutube],
    ];
    for (const [nama, value] of socialInputs) {
      if (value.trim() && !hasUrlScheme(value)) {
        toast.error(`URL ${nama} harus diawali http:// atau https://.`);
        return;
      }
    }

    const footerLinks: { label: string; url: string }[] = [];
    for (let i = 0; i < form.footerLinks.length; i += 1) {
      const url = form.footerLinks[i].url.trim();
      const label = form.footerLinks[i].label.trim();
      // Baris yang benar-benar kosong memang belum dipakai. Tapi baris yang
      // judulnya sudah diketik lalu URL-nya lupa diisi jangan dibuang diam-diam:
      // orangnya mengira tersimpan, padahal hilang begitu halaman dimuat ulang.
      if (!url && !label) continue;
      if (!url) {
        toast.error(`Tautan artikel baris ${i + 1} belum punya URL. Isi URL-nya atau hapus barisnya.`);
        return;
      }
      if (!hasUrlScheme(url)) {
        toast.error(`URL tautan artikel baris ${i + 1} harus diawali http:// atau https://.`);
        return;
      }
      footerLinks.push({ label, url });
    }

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
      invoice_signature_url: form.signatureUrl,
      invoice_signer_name: form.signerName.trim() || null,
      shop_phone: form.shopPhone.trim() || null,
      shop_city: form.shopCity.trim() || null,
      return_policy: form.returnPolicy.trim() || null,
      warranty_info: form.warrantyInfo.trim() || null,
      pdp_banner_url: form.pdpBanner,
      bank_name: form.bankName.trim() || null,
      bank_account_number: form.bankAccountNumber.trim() || null,
      bank_account_name: form.bankAccountName.trim() || null,
      qris_image_url: form.qrisImage,
      social_facebook: form.socialFacebook.trim() || null,
      social_instagram: form.socialInstagram.trim() || null,
      social_tiktok: form.socialTiktok.trim() || null,
      social_youtube: form.socialYoutube.trim() || null,
      footer_links: footerLinks,
      chat_enabled: form.chatEnabled,
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
                  hint={
                    form.taxRate > 0
                      ? form.features.taxInclusive
                        ? `Harga jual dianggap sudah termasuk pajak ${form.taxRate}%. Isi 0 untuk mematikan pajak.`
                        : `Pajak ${form.taxRate}% ditambahkan di atas harga jual. Isi 0 untuk mematikan pajak.`
                      : 'Pajak mati. Isi angka persen untuk menyalakan.'
                  }
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
                <FeatureToggle
                  label="Harga sudah termasuk pajak"
                  hint="Harga tayang (mis. 150rb) sudah termasuk pajak. Pajak dihitung mundur, total tidak bertambah."
                  checked={!!form.features.taxInclusive}
                  onChange={(v) => setFeature('taxInclusive', v)}
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
            {canManageStore && (
              <div className="mt-4 border-t border-ink-100 pt-4 dark:border-ink-800">
                <div className="text-sm font-semibold">Tanda tangan faktur A4</div>
                <p className="mt-0.5 text-xs text-ink-500">
                  Tercetak di bagian bawah faktur A4. Pakai file PNG berlatar transparan agar rapi.
                </p>
                <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start">
                  <div className="flex flex-col items-start gap-2">
                    <div className="grid h-24 w-48 place-items-center overflow-hidden rounded-xl border border-dashed border-ink-200 bg-white dark:border-ink-700">
                      {form.signatureUrl ? (
                        <img
                          src={form.signatureUrl}
                          alt="Tanda tangan"
                          className="max-h-full max-w-full object-contain"
                        />
                      ) : (
                        <span className="text-xs text-ink-400">Belum ada tanda tangan</span>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => signatureInputRef.current?.click()}
                        className="rounded-lg border border-ink-200 px-2.5 py-1 text-xs font-medium hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800"
                      >
                        <Upload size={12} className="inline mr-1" />
                        {form.signatureUrl ? 'Ganti' : 'Upload PNG'}
                      </button>
                      {form.signatureUrl && (
                        <button
                          type="button"
                          aria-label="Hapus tanda tangan"
                          onClick={() => patch('signatureUrl', null)}
                          className="rounded-lg border border-ink-200 px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:border-ink-700 dark:hover:bg-rose-500/10"
                        >
                          <X size={12} className="inline" />
                        </button>
                      )}
                    </div>
                    <input
                      ref={signatureInputRef}
                      type="file"
                      accept="image/png,image/*"
                      className="hidden"
                      onChange={(e) => {
                        handleSignatureChange(e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />
                  </div>
                  <div className="flex-1">
                    <Input
                      label="Nama penanda tangan"
                      placeholder="Kosongkan untuk memakai nama kasir"
                      value={form.signerName}
                      onChange={(e) => patch('signerName', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}
          </Section>

          <Section
            id="online"
            icon={Globe}
            title="Toko Online"
            description="Tampil di halaman produk toko online: tombol Chat, pengembalian, dan garansi."
          >
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                name="shop_phone"
                label="Nomor WhatsApp toko"
                placeholder="08xxxxxxxxxx"
                value={form.shopPhone}
                onChange={(e) => patch('shopPhone', e.target.value)}
                hint="Dipakai tombol Chat penjual. Kosongkan untuk menyembunyikan tombolnya."
              />
              <Input
                name="shop_city"
                label="Lokasi toko (kota)"
                placeholder="cth. Kota Jakarta Barat"
                value={form.shopCity}
                onChange={(e) => patch('shopCity', e.target.value)}
                hint="Tampil di kartu produk toko online. Selama kosong, kartu memakai lokasi contoh."
              />
              <TextArea
                name="return_policy"
                label="Pengembalian & jaminan (satu per baris)"
                placeholder={'100% Ori\nPengembalian Gratis 7 Hari'}
                value={form.returnPolicy}
                onChange={(e) => patch('returnPolicy', e.target.value)}
              />
              <TextArea
                name="warranty_info"
                label="Garansi toko"
                placeholder="cth. Garansi toko 30 hari"
                value={form.warrantyInfo}
                onChange={(e) => patch('warrantyInfo', e.target.value)}
              />
              <div className="md:col-span-2 mt-1 border-t border-ink-100 pt-3 text-sm font-semibold dark:border-ink-800">
                Tujuan pembayaran checkout
                <p className="mt-0.5 text-xs font-normal text-ink-500">
                  Tampil di halaman checkout saat pembeli memilih Transfer Bank atau QRIS. Kosongkan bila pembayaran
                  selalu dikabari admin lewat WhatsApp.
                </p>
              </div>
              <Input
                name="bank_name"
                label="Nama bank"
                placeholder="cth. BCA"
                value={form.bankName}
                onChange={(e) => patch('bankName', e.target.value)}
              />
              <Input
                name="bank_account_number"
                label="Nomor rekening"
                placeholder="cth. 7712345678"
                value={form.bankAccountNumber}
                onChange={(e) => patch('bankAccountNumber', e.target.value)}
              />
              <Input
                name="bank_account_name"
                label="Rekening atas nama"
                placeholder="cth. GNNK Racing"
                value={form.bankAccountName}
                onChange={(e) => patch('bankAccountName', e.target.value)}
              />
              <div>
                <div className="mb-1.5 text-sm font-medium">Gambar QRIS toko</div>
                <div className="flex flex-wrap items-center gap-3">
                  {form.qrisImage ? (
                    <img src={form.qrisImage} alt="QRIS" className="max-h-20 rounded-lg ring-1 ring-ink-100 dark:ring-ink-800" />
                  ) : (
                    <span className="text-xs text-ink-400">Belum ada QRIS.</span>
                  )}
                  <label className="cursor-pointer rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-medium hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800">
                    <Upload size={12} className="mr-1 inline" /> {form.qrisImage ? 'Ganti' : 'Upload'}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file) return;
                        try {
                          const hasil = await resizeImageToDataUrl(file, { maxDim: 900, quality: 0.9 });
                          patch('qrisImage', hasil.dataUrl);
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : 'Gagal memproses gambar.');
                        }
                      }}
                    />
                  </label>
                  {form.qrisImage && (
                    <button
                      type="button"
                      onClick={() => patch('qrisImage', null)}
                      className="rounded-lg border border-ink-200 px-2.5 py-1.5 text-xs text-rose-600 hover:bg-rose-50 dark:border-ink-700"
                      aria-label="Hapus QRIS"
                    >
                      <X size={12} className="inline" />
                    </button>
                  )}
                </div>
              </div>
              <div className="md:col-span-2">
                <div className="mb-1.5 text-sm font-medium">Banner promo halaman produk</div>
                <p className="mb-2 text-xs text-ink-500">
                  Tampil di bawah merek pada halaman produk, seperti banner "Gratis Ongkir" di marketplace.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  {form.pdpBanner ? (
                    <img src={form.pdpBanner} alt="Banner" className="max-h-20 rounded-lg ring-1 ring-ink-100 dark:ring-ink-800" />
                  ) : (
                    <span className="text-xs text-ink-400">Belum ada banner.</span>
                  )}
                  <label className="cursor-pointer rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-medium hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800">
                    <Upload size={12} className="mr-1 inline" /> {form.pdpBanner ? 'Ganti' : 'Upload'}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file) return;
                        try {
                          const hasil = await resizeImageToDataUrl(file, { maxDim: 1200, quality: 0.85 });
                          patch('pdpBanner', hasil.dataUrl);
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : 'Gagal memproses gambar.');
                        }
                      }}
                    />
                  </label>
                  {form.pdpBanner && (
                    <button
                      type="button"
                      onClick={() => patch('pdpBanner', null)}
                      className="rounded-lg border border-ink-200 px-2.5 py-1.5 text-xs text-rose-600 hover:bg-rose-50 dark:border-ink-700"
                      aria-label="Hapus banner"
                    >
                      <X size={12} className="inline" />
                    </button>
                  )}
                </div>
              </div>

              <div className="md:col-span-2 mt-1 border-t border-ink-100 pt-3 text-sm font-semibold dark:border-ink-800">
                Media sosial
                <p className="mt-0.5 text-xs font-normal text-ink-500">
                  Tampil sebagai ikon di footer toko online. Kosongkan untuk menyembunyikan ikonnya.
                </p>
              </div>
              <Input
                name="social_facebook"
                label="Facebook"
                placeholder="https://facebook.com/namatoko"
                value={form.socialFacebook}
                onChange={(e) => patch('socialFacebook', e.target.value)}
              />
              <Input
                name="social_instagram"
                label="Instagram"
                placeholder="https://instagram.com/namatoko"
                value={form.socialInstagram}
                onChange={(e) => patch('socialInstagram', e.target.value)}
              />
              <Input
                name="social_tiktok"
                label="TikTok"
                placeholder="https://tiktok.com/@namatoko"
                value={form.socialTiktok}
                onChange={(e) => patch('socialTiktok', e.target.value)}
              />
              <Input
                name="social_youtube"
                label="YouTube"
                placeholder="https://youtube.com/@namatoko"
                value={form.socialYoutube}
                onChange={(e) => patch('socialYoutube', e.target.value)}
              />

              <div className="md:col-span-2 mt-1 border-t border-ink-100 pt-3 text-sm font-semibold dark:border-ink-800">
                Jelajahi GNNK Racing
                <p className="mt-0.5 text-xs font-normal text-ink-500">
                  Tautan artikel yang tampil di footer toko online, maksimal {MAX_FOOTER_LINKS} baris. Urutan baris
                  menentukan urutan tampil.
                </p>
              </div>
              <div className="md:col-span-2 space-y-2">
                {form.footerLinks.map((row, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-ink-100 p-2.5 dark:border-ink-800"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-medium text-ink-500">Tautan {i + 1}</span>
                      <button
                        type="button"
                        onClick={() => patch('footerLinks', form.footerLinks.filter((_, idx) => idx !== i))}
                        className="flex h-[44px] w-[44px] items-center justify-center rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                        aria-label={`Hapus tautan ${i + 1}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Input
                        placeholder="Judul artikel"
                        value={row.label}
                        onChange={(e) => {
                          const next = form.footerLinks.map((r, idx) =>
                            idx === i ? { ...r, label: e.target.value } : r,
                          );
                          patch('footerLinks', next);
                        }}
                      />
                      <Input
                        placeholder="https://..."
                        value={row.url}
                        onChange={(e) => {
                          const next = form.footerLinks.map((r, idx) =>
                            idx === i ? { ...r, url: e.target.value } : r,
                          );
                          patch('footerLinks', next);
                        }}
                      />
                    </div>
                  </div>
                ))}
                {form.footerLinks.length < MAX_FOOTER_LINKS && (
                  <button
                    type="button"
                    onClick={() => patch('footerLinks', [...form.footerLinks, { label: '', url: '' }])}
                    className="flex min-h-[44px] w-full items-center justify-center gap-1 rounded-lg border border-dashed border-ink-300 px-3 text-xs font-medium text-ink-600 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800 sm:w-auto"
                  >
                    <Plus size={12} /> Tambah tautan artikel
                  </button>
                )}
              </div>

              <div className="md:col-span-2 mt-1 border-t border-ink-100 pt-3 dark:border-ink-800">
                <FeatureToggle
                  label="Tampilkan tombol chat di toko online"
                  hint="Matikan sementara bila admin sedang tidak bisa membalas chat pembeli."
                  checked={form.chatEnabled}
                  onChange={(v) => patch('chatEnabled', v)}
                />
              </div>
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
    a.features.defaultTrackStock === b.features.defaultTrackStock &&
    !!a.features.taxInclusive === !!b.features.taxInclusive &&
    a.signatureUrl === b.signatureUrl &&
    a.signerName === b.signerName &&
    a.shopPhone === b.shopPhone &&
    a.returnPolicy === b.returnPolicy &&
    a.warrantyInfo === b.warrantyInfo &&
    a.pdpBanner === b.pdpBanner &&
    a.bankName === b.bankName &&
    a.bankAccountNumber === b.bankAccountNumber &&
    a.bankAccountName === b.bankAccountName &&
    a.qrisImage === b.qrisImage &&
    a.socialFacebook === b.socialFacebook &&
    a.socialInstagram === b.socialInstagram &&
    a.socialTiktok === b.socialTiktok &&
    a.socialYoutube === b.socialYoutube &&
    a.chatEnabled === b.chatEnabled &&
    sameFooterLinks(a.footerLinks, b.footerLinks)
  );
}

function sameFooterLinks(
  a: { label: string; url: string }[],
  b: { label: string; url: string }[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every((row, i) => row.label === b[i].label && row.url === b[i].url);
}

function displayEditableProfileName(value: string | null | undefined): string {
  const name = value?.trim() ?? '';
  return name.includes('@') ? '' : name;
}
