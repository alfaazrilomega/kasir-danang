import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDown, ArrowUp, ExternalLink, ImagePlus, Images, Link2, Monitor, Pencil, Plus, Smartphone, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { ProductPicker } from '@/components/data/ProductPicker';
import { db } from '@/lib/db';
import { useAuth } from '@/stores/auth';
import { getBackendClient } from '@/lib/api';
import { pullReference, writeThrough } from '@/lib/sync';
import { cn, formatDateTime, uuid } from '@/lib/format';
import { resizeImageToDataUrl } from '@/lib/imageUpload';
import type { StoreBanner } from '@/types';

/**
 * Banner beranda toko online (spec 0003, permintaan client 18 Okt 2026:
 * "tampilan banner yang bisa diganti dari menu di dashboard").
 *
 * Banner yang aktif dan jadwalnya berlaku menggantikan isi karosel beranda,
 * berurutan dari atas. Tanpa banner, beranda tetap memakai banner halaman
 * produk (Pengaturan) dan slide produk terlaris seperti sebelumnya.
 */

// Ukuran karosel beranda: desktop sekitar 990 x 344 px, HP sekitar 361 x 200 px.
const RASIO_DESKTOP = 990 / 344;
const RASIO_HP = 361 / 200;

type Status = 'tayang' | 'terjadwal' | 'selesai' | 'nonaktif';
const LABEL_STATUS: Record<Status, { teks: string; tone: 'success' | 'info' | 'neutral' | 'warning' }> = {
  tayang: { teks: 'Tayang', tone: 'success' },
  terjadwal: { teks: 'Terjadwal', tone: 'info' },
  selesai: { teks: 'Jadwal selesai', tone: 'neutral' },
  nonaktif: { teks: 'Nonaktif', tone: 'warning' },
};

function statusBanner(b: Pick<StoreBanner, 'is_active' | 'starts_at' | 'ends_at'>, kini = Date.now()): Status {
  if (!b.is_active) return 'nonaktif';
  if (b.starts_at && new Date(b.starts_at).getTime() > kini) return 'terjadwal';
  if (b.ends_at && new Date(b.ends_at).getTime() <= kini) return 'selesai';
  return 'tayang';
}

/**
 * Alamat di toko diawali satu "/" atau alamat https:// lengkap (sama dengan aturan database).
 * Spasi, karakter kontrol, dan "\" ditolak: browser membaca "/\situs.com" sebagai situs lain.
 */
export function tautanBannerSah(v: string): boolean {
  if (!v) return true;
  // eslint-disable-next-line no-control-regex
  if (/[\s\\\x00-\x1f\x7f]/.test(v)) return false;
  return /^\/([^/]|$)/.test(v) || /^https:\/\/[^/]/.test(v);
}

const TAUTAN_CEPAT = [
  { label: 'Semua produk', url: '/toko?semua=1' },
  { label: 'Terlaris', url: '/toko?urut=terlaris' },
  { label: 'Flash sale', url: '/toko?flash=1' },
];

function isoKeInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

interface Draf {
  id?: string;
  /** Id untuk banner baru, dibuat saat formulir dibuka. */
  idBaru?: string;
  title: string;
  image_data: string;
  image_mobile_data: string | null;
  link_url: string;
  is_active: boolean;
  mulai: string;
  selesai: string;
}

const DRAF_KOSONG: Draf = { title: '', image_data: '', image_mobile_data: null, link_url: '', is_active: true, mulai: '', selesai: '' };

export function Banners() {
  const { profile } = useAuth();
  const storeId = profile?.store_id ?? '';
  const [banners, setBanners] = useState<StoreBanner[]>([]);
  const [memuat, setMemuat] = useState(true);
  const [draf, setDraf] = useState<Draf | null>(null);
  const [sibuk, setSibuk] = useState(false);

  useEffect(() => {
    if (storeId) pullReference(storeId);
  }, [storeId]);
  const products = useLiveQuery(() => db.products.where('store_id').equals(storeId).toArray(), [storeId]) ?? [];

  async function muat() {
    if (!storeId) return;
    setMemuat(true);
    try {
      const { data, error } = await getBackendClient()
        .from('store_banners')
        .select('*')
        .eq('store_id', storeId)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      setBanners((data ?? []) as StoreBanner[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal memuat banner.');
    } finally {
      setMemuat(false);
    }
  }

  useEffect(() => {
    void muat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  const jumlahTayang = banners.filter((b) => statusBanner(b) === 'tayang').length;

  async function tulis(aksi: () => Promise<unknown>, pesan: string) {
    setSibuk(true);
    try {
      await aksi();
      toast.success(pesan);
      await muat();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Perubahan gagal disimpan.');
    } finally {
      setSibuk(false);
    }
  }

  /** Tukar urutan dengan banner di sebelahnya. Urutan disimpan ulang rapat 10, 20, 30. */
  function geser(i: number, arah: -1 | 1) {
    const j = i + arah;
    if (j < 0 || j >= banners.length) return;
    const baru = [...banners];
    [baru[i], baru[j]] = [baru[j], baru[i]];
    void tulis(async () => {
      for (const [k, b] of baru.entries()) {
        if (b.sort_order !== (k + 1) * 10) {
          await writeThrough('store_banners', 'update', { sort_order: (k + 1) * 10 }, { column: 'id', value: b.id });
        }
      }
    }, 'Urutan banner diperbarui.');
  }

  function bukaBaru() {
    setDraf({ ...DRAF_KOSONG, idBaru: uuid() });
  }

  function bukaEdit(b: StoreBanner) {
    setDraf({
      id: b.id,
      title: b.title ?? '',
      image_data: b.image_data,
      image_mobile_data: b.image_mobile_data,
      link_url: b.link_url ?? '',
      is_active: b.is_active,
      mulai: isoKeInput(b.starts_at),
      selesai: isoKeInput(b.ends_at),
    });
  }

  async function simpan(d: Draf) {
    if (!d.image_data) return toast.error('Unggah gambar desktop dulu.');
    const tautan = d.link_url.trim();
    if (!tautanBannerSah(tautan)) return toast.error('Tautan harus diawali "/" (halaman di toko) atau "https://".');
    const mulai = d.mulai ? new Date(d.mulai).toISOString() : null;
    const selesai = d.selesai ? new Date(d.selesai).toISOString() : null;
    if (mulai && selesai && selesai <= mulai) return toast.error('Waktu selesai harus setelah waktu mulai.');
    const baris = {
      id: d.id ?? d.idBaru ?? uuid(),
      store_id: storeId,
      title: d.title.trim() || null,
      image_data: d.image_data,
      image_mobile_data: d.image_mobile_data,
      link_url: tautan || null,
      is_active: d.is_active,
      starts_at: mulai,
      ends_at: selesai,
      // Versi baru membuat toko memakai alamat gambar baru, bukan salinan lama di cache.
      updated_at: new Date().toISOString(),
      ...(d.id ? {} : { sort_order: (Math.max(0, ...banners.map((b) => b.sort_order)) || 0) + 10 }),
    };
    await tulis(async () => {
      const hasil = await writeThrough('store_banners', 'upsert', baris);
      if (hasil.queued) throw new Error('Sedang offline. Banner akan dikirim saat koneksi kembali.');
      setDraf(null);
    }, d.id ? 'Banner diperbarui.' : 'Banner ditambahkan.');
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-brand-600 p-6 text-white md:p-8">
        <div>
          <h1 className="text-2xl font-bold">Banner Toko</h1>
          <p className="text-sm opacity-80">
            {banners.length} banner · {jumlahTayang} tayang di beranda toko online
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/toko"
            target="_blank"
            rel="noreferrer"
            className="btn-on-brand-soft inline-flex min-h-[44px] items-center gap-1.5 sm:min-h-0"
          >
            <ExternalLink size={16} /> Lihat toko
          </a>
          <Button variant="onBrand" onClick={bukaBaru} className="min-h-[44px] sm:min-h-0">
            <Plus size={16} /> Tambah banner
          </Button>
        </div>
      </div>

      <Card className="p-5">
        <p className="mb-4 text-sm text-ink-500">
          Banner yang tayang berganti otomatis di bagian atas beranda, berurutan dari atas. Tanpa banner, beranda memakai banner
          halaman produk dari Pengaturan dan slide produk terlaris.
        </p>
        {memuat ? (
          <p role="status" className="text-sm text-ink-500">Memuat banner…</p>
        ) : banners.length === 0 ? (
          <EmptyState
            icon={<Images size={24} />}
            title="Belum ada banner"
            description="Tambahkan banner promo untuk karosel beranda toko online."
            action={<Button onClick={bukaBaru}><Plus size={16} /> Tambah banner</Button>}
          />
        ) : (
          <ul className="divide-y divide-ink-100 dark:divide-ink-800" data-daftar-banner>
            {banners.map((b, i) => {
              const st = LABEL_STATUS[statusBanner(b)];
              return (
                <li key={b.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center" data-banner-id={b.id}>
                  <div className="flex shrink-0 items-start gap-2">
                    <img
                      src={b.image_data}
                      alt={b.title ?? 'Banner'}
                      className="aspect-[990/344] w-full max-w-[260px] rounded-lg bg-ink-100 object-cover ring-1 ring-ink-100 sm:w-[220px] dark:bg-ink-800 dark:ring-ink-800"
                    />
                    {b.image_mobile_data ? (
                      <img
                        src={b.image_mobile_data}
                        alt=""
                        title="Gambar HP"
                        className="aspect-[361/200] w-[72px] rounded-md bg-ink-100 object-cover ring-1 ring-ink-100 dark:bg-ink-800 dark:ring-ink-800"
                      />
                    ) : (
                      // Tempat gambar HP tetap disisakan supaya judul semua baris sejajar.
                      <span aria-hidden className="hidden w-[72px] sm:block" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium [overflow-wrap:anywhere]">{b.title || `Banner ${i + 1}`}</span>
                      <Badge tone={st.tone}>{st.teks}</Badge>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-ink-500 [overflow-wrap:anywhere]">
                      <Link2 size={12} className="shrink-0" /> {b.link_url || 'Tanpa tautan'}
                    </div>
                    {(b.starts_at || b.ends_at) && (
                      <div className="text-xs text-ink-500">
                        {b.starts_at ? `Mulai ${formatDateTime(b.starts_at)}` : 'Mulai sekarang'}
                        {b.ends_at ? ` · sampai ${formatDateTime(b.ends_at)}` : ''}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1">
                    <TombolIkon label="Naikkan urutan" disabled={sibuk || i === 0} onClick={() => geser(i, -1)}>
                      <ArrowUp size={16} />
                    </TombolIkon>
                    <TombolIkon label="Turunkan urutan" disabled={sibuk || i === banners.length - 1} onClick={() => geser(i, 1)}>
                      <ArrowDown size={16} />
                    </TombolIkon>
                    <label className="flex min-h-[44px] cursor-pointer items-center gap-2 px-2 text-sm sm:min-h-0">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-brand-600"
                        checked={b.is_active}
                        disabled={sibuk}
                        onChange={() =>
                          void tulis(
                            () => writeThrough('store_banners', 'update', { is_active: !b.is_active }, { column: 'id', value: b.id }),
                            b.is_active ? 'Banner dinonaktifkan.' : 'Banner diaktifkan.',
                          )
                        }
                      />
                      Aktif
                    </label>
                    <TombolIkon label="Ubah banner" disabled={sibuk} onClick={() => bukaEdit(b)}>
                      <Pencil size={16} />
                    </TombolIkon>
                    <TombolIkon
                      label="Hapus banner"
                      disabled={sibuk}
                      tone="bahaya"
                      onClick={() => {
                        if (!confirm(`Hapus banner "${b.title || `Banner ${i + 1}`}"?`)) return;
                        void tulis(() => writeThrough('store_banners', 'delete', null, { column: 'id', value: b.id }), 'Banner dihapus.');
                      }}
                    >
                      <Trash2 size={16} />
                    </TombolIkon>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {draf && (
        <FormBanner
          draf={draf}
          sibuk={sibuk}
          products={products}
          onTutup={() => setDraf(null)}
          onSimpan={(d) => void simpan(d)}
        />
      )}
    </div>
  );
}

function TombolIkon({
  label,
  onClick,
  disabled,
  tone,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'bahaya';
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'grid h-[44px] w-[44px] place-items-center rounded-lg text-ink-600 transition-[background-color,transform] duration-150 ease-out hover:bg-ink-100 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 sm:h-9 sm:w-9 dark:text-ink-300 dark:hover:bg-ink-800',
        tone === 'bahaya' && 'text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10',
      )}
    >
      {children}
    </button>
  );
}

function FormBanner({
  draf,
  sibuk,
  products,
  onTutup,
  onSimpan,
}: {
  draf: Draf;
  sibuk: boolean;
  products: Parameters<typeof ProductPicker>[0]['products'];
  onTutup: () => void;
  onSimpan: (d: Draf) => void;
}) {
  const [d, setD] = useState<Draf>(draf);
  const [info, setInfo] = useState<{ desktop?: string; hp?: string }>({});
  const [pilihProduk, setPilihProduk] = useState(false);
  const ubah = (patch: Partial<Draf>) => setD((v) => ({ ...v, ...patch }));
  const tautanSalah = !tautanBannerSah(d.link_url.trim());

  async function unggah(file: File | undefined, jenis: 'desktop' | 'hp') {
    if (!file) return;
    try {
      const hasil = await resizeImageToDataUrl(file, { maxDim: jenis === 'desktop' ? 1980 : 1080, quality: 0.82, jpeg: true });
      const rasio = hasil.width / hasil.height;
      const target = jenis === 'desktop' ? RASIO_DESKTOP : RASIO_HP;
      const melenceng = Math.abs(rasio - target) / target > 0.2;
      const ukuran = `${hasil.width} × ${hasil.height} px · ${Math.round(hasil.bytes / 1024)} KB`;
      setInfo((v) => ({
        ...v,
        [jenis]: melenceng
          ? `${ukuran}. Perbandingan gambar ${rasio.toFixed(1)}:1, sebagian akan terpotong (lihat pratinjau).`
          : ukuran,
      }));
      ubah(jenis === 'desktop' ? { image_data: hasil.dataUrl } : { image_mobile_data: hasil.dataUrl });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal memproses gambar.');
    }
  }

  return (
    <Modal open onClose={onTutup} title={d.id ? 'Ubah banner' : 'Tambah banner'} size="lg">
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          onSimpan(d);
        }}
      >
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_200px]">
          <BingkaiPratinjau
            label="Desktop"
            ikon={<Monitor size={14} />}
            rasio="aspect-[990/344]"
            src={d.image_data}
            kosong="Belum ada gambar desktop"
          />
          <BingkaiPratinjau
            label={d.image_mobile_data ? 'HP' : 'HP (memakai gambar desktop)'}
            ikon={<Smartphone size={14} />}
            rasio="aspect-[361/200]"
            src={d.image_mobile_data ?? d.image_data}
            kosong="Belum ada gambar"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <PilihGambar
            id="banner-desktop"
            label="Gambar desktop (wajib)"
            saran="Disarankan 1980 × 690 px, JPG atau PNG."
            info={info.desktop}
            ada={!!d.image_data}
            onPilih={(f) => void unggah(f, 'desktop')}
          />
          <PilihGambar
            id="banner-hp"
            label="Gambar HP (opsional)"
            saran="Disarankan 1080 × 600 px. Kosongkan untuk memakai gambar desktop."
            info={info.hp}
            ada={!!d.image_mobile_data}
            onPilih={(f) => void unggah(f, 'hp')}
            onHapus={d.image_mobile_data ? () => ubah({ image_mobile_data: null }) : undefined}
          />
        </div>

        <Input
          id="banner-judul"
          label="Judul (opsional)"
          value={d.title}
          maxLength={120}
          onChange={(e) => ubah({ title: e.target.value })}
          hint="Dibacakan pembaca layar dan membantu admin membedakan banner."
        />

        <div className="space-y-2">
          <Input
            id="banner-tautan"
            label="Tautan saat banner diklik (opsional)"
            value={d.link_url}
            placeholder="/toko/produk/... atau https://..."
            onChange={(e) => ubah({ link_url: e.target.value })}
            error={tautanSalah ? 'Tautan harus diawali "/" (halaman di toko) atau "https://".' : undefined}
          />
          <div className="flex flex-wrap gap-2">
            {TAUTAN_CEPAT.map((t) => (
              <button
                key={t.url}
                type="button"
                onClick={() => ubah({ link_url: t.url })}
                className="min-h-[44px] rounded-full border border-ink-200 px-3 text-xs font-medium transition-colors duration-150 hover:border-brand-400 hover:text-brand-600 sm:min-h-0 sm:py-1.5 dark:border-ink-700"
              >
                {t.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPilihProduk((v) => !v)}
              className="min-h-[44px] rounded-full border border-ink-200 px-3 text-xs font-medium transition-colors duration-150 hover:border-brand-400 hover:text-brand-600 sm:min-h-0 sm:py-1.5 dark:border-ink-700"
              aria-expanded={pilihProduk}
            >
              Produk…
            </button>
          </div>
          {pilihProduk && (
            <ProductPicker
              products={products}
              value=""
              onChange={(id) => {
                const p = products.find((x) => x.id === id);
                if (!p) return;
                ubah({ link_url: p.slug ? `/toko/produk/${encodeURIComponent(p.slug)}` : `/toko/produk?id=${encodeURIComponent(p.id)}` });
                setPilihProduk(false);
              }}
            />
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Input
            id="banner-mulai"
            type="datetime-local"
            label="Mulai tayang (opsional)"
            value={d.mulai}
            onChange={(e) => ubah({ mulai: e.target.value })}
            hint="Kosongkan untuk tayang sekarang."
          />
          <Input
            id="banner-selesai"
            type="datetime-local"
            label="Selesai tayang (opsional)"
            value={d.selesai}
            onChange={(e) => ubah({ selesai: e.target.value })}
            hint="Kosongkan untuk tayang terus."
          />
        </div>

        <label className="flex min-h-[44px] items-center gap-3 text-sm font-medium">
          <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={d.is_active} onChange={(e) => ubah({ is_active: e.target.checked })} />
          Aktifkan banner ini
        </label>

        <div className="flex justify-end gap-2 border-t border-ink-100 pt-4 dark:border-ink-800">
          <Button type="button" variant="secondary" onClick={onTutup} disabled={sibuk}>
            Batal
          </Button>
          <Button type="submit" disabled={sibuk || !d.image_data || tautanSalah}>
            {sibuk ? 'Menyimpan…' : 'Simpan banner'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function BingkaiPratinjau({ label, ikon, rasio, src, kosong }: { label: string; ikon: React.ReactNode; rasio: string; src: string; kosong: string }) {
  return (
    <figure className="min-w-0">
      <figcaption className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-ink-500">
        {ikon} {label}
      </figcaption>
      <div className={cn(rasio, 'w-full overflow-hidden rounded-lg bg-ink-100 ring-1 ring-ink-200 dark:bg-ink-800 dark:ring-ink-700')}>
        {src ? (
          <img src={src} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full place-items-center px-2 text-center text-xs text-ink-400">{kosong}</div>
        )}
      </div>
    </figure>
  );
}

function PilihGambar({
  id,
  label,
  saran,
  info,
  ada,
  onPilih,
  onHapus,
}: {
  id: string;
  label: string;
  saran: string;
  info?: string;
  ada: boolean;
  onPilih: (f: File | undefined) => void;
  onHapus?: () => void;
}) {
  return (
    <div>
      <div className="mb-1.5 text-sm font-medium text-ink-700 dark:text-ink-200">{label}</div>
      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor={id}
          className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-lg border border-ink-200 px-3 text-sm font-medium transition-colors duration-150 hover:bg-ink-50 sm:min-h-[36px] dark:border-ink-700 dark:hover:bg-ink-800"
        >
          <ImagePlus size={16} /> {ada ? 'Ganti gambar' : 'Pilih gambar'}
        </label>
        <input
          id={id}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            onPilih(f);
          }}
        />
        {onHapus && (
          <button
            type="button"
            onClick={onHapus}
            className="inline-flex min-h-[44px] items-center gap-1 rounded-lg px-2 text-sm text-ink-500 hover:text-rose-600 sm:min-h-[36px]"
          >
            <X size={14} /> Hapus
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-ink-500">{info ?? saran}</p>
    </div>
  );
}
