import { useEffect, useMemo, useState } from 'react';
import { Heart, ImagePlus, LogOut, MapPin, MessageSquareText, Package, Star, UserRound, X } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, TextArea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { PublicShell } from '@/components/layout/PublicShell';
import { KartuProduk } from '@/components/public/KartuProduk';
import { Link, useLocation, useNavigate } from '@/lib/router';
import { cn, formatDateTime, formatMoney } from '@/lib/format';
import { resizeImageToDataUrl } from '@/lib/imageUpload';
import { PUBLIC_STORE_ID } from '@/lib/config';
import { fetchPublicCatalog, kelompokkanVarian, type PublicCatalogData } from '@/lib/publicCatalog';
import { useWishlist } from '@/stores/wishlist';
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

const LABEL_BINTANG = ['', 'Sangat buruk', 'Buruk', 'Cukup', 'Baik', 'Sangat baik'];

function statusPesanan(o: CustomerOrder): { label: string; tone: 'info' | 'success' | 'warning' | 'neutral' } {
  if (o.order_status === 'awaiting_confirmation') return { label: 'Menunggu konfirmasi', tone: 'info' };
  if (o.order_status === 'canceled') return { label: 'Dibatalkan', tone: 'neutral' };
  if (o.order_status === 'done') {
    return o.payment_status === 'paid'
      ? { label: 'Dikonfirmasi', tone: 'success' }
      : { label: 'Diproses', tone: 'warning' };
  }
  return { label: 'Diproses', tone: 'warning' };
}

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

  const tabAwal = new URLSearchParams(search).get('tab') as Tab | null;
  const [tab, setTab] = useState<Tab>(tabAwal ?? 'pesanan');
  const [orders, setOrders] = useState<CustomerOrder[] | null>(null);
  const [reviewable, setReviewable] = useState<ReviewableItem[] | null>(null);
  const [catalog, setCatalog] = useState<PublicCatalogData | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', address: '' });
  const [busy, setBusy] = useState(false);
  const [menilai, setMenilai] = useState<ReviewableItem | null>(null);

  useEffect(() => {
    if (ready && !token) navigate('/toko/masuk?next=/toko/akun');
  }, [ready, token, navigate]);

  useEffect(() => {
    if (token && !me) void muat();
  }, [token, me, muat]);

  useEffect(() => {
    if (me) setForm({ name: me.name, phone: me.phone ?? '', address: me.address ?? '' });
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

  useEffect(() => {
    if (tab === 'favorit' && !catalog) fetchPublicCatalog(PUBLIC_STORE_ID).then(setCatalog).catch(() => {});
  }, [tab, catalog]);

  const favorit = useMemo(() => {
    if (!catalog) return [];
    return kelompokkanVarian(catalog.products.filter((p) => favoritIds.includes(p.id)));
  }, [catalog, favoritIds]);

  const belumDiulas = (reviewable ?? []).filter((r) => !r.reviewed).length;

  async function simpan() {
    if (!token) return;
    if (!form.name.trim()) return void toast.error('Nama wajib diisi.');
    setBusy(true);
    const { data, error } = await updateCustomerMe(token, {
      name: form.name.trim(),
      phone: form.phone.trim(),
      address: form.address.trim(),
    });
    setBusy(false);
    if (error || !data) {
      toast.error(error || 'Gagal menyimpan profil.');
      return;
    }
    setMe(data);
    toast.success('Profil tersimpan.');
  }

  if (!token || !me) {
    return (
      <PublicShell>
        <div className="h-40 animate-pulse rounded-2xl bg-ink-100 dark:bg-ink-800" />
      </PublicShell>
    );
  }

  const TABS: [Tab, string, typeof Package][] = [
    ['pesanan', 'Pesanan Saya', Package],
    ['ulasan', belumDiulas ? `Ulasan (${belumDiulas})` : 'Ulasan', MessageSquareText],
    ['favorit', 'Favorit', Heart],
    ['profil', 'Profil & Alamat', UserRound],
  ];

  return (
    <PublicShell>
      <div className="space-y-4">
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-100 text-lg font-bold text-brand-700 dark:bg-brand-950/50 dark:text-brand-300">
              {me.name.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <div className="font-semibold">{me.name}</div>
              <div className="text-xs text-ink-500">{me.email}</div>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              keluar();
              navigate('/toko');
            }}
          >
            <LogOut size={14} /> Keluar
          </Button>
        </Card>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {TABS.map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition',
                tab === value
                  ? 'bg-brand-600 text-white'
                  : 'bg-white text-ink-600 hover:bg-ink-100 dark:bg-ink-900 dark:text-ink-300',
              )}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>

        {tab === 'pesanan' &&
          (orders === null ? (
            <div className="h-32 animate-pulse rounded-2xl bg-ink-100 dark:bg-ink-800" />
          ) : orders.length === 0 ? (
            <Card className="p-8">
              <EmptyState
                icon={<Package size={24} />}
                title="Belum ada pesanan"
                description="Pesanan yang kamu buat akan muncul di sini beserta statusnya."
                action={<Button onClick={() => navigate('/toko')}>Mulai Belanja</Button>}
              />
            </Card>
          ) : (
            <div className="space-y-3">
              {orders.map((o) => {
                const st = statusPesanan(o);
                return (
                  <Card key={o.id} className="space-y-3 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold">{o.order_number}</div>
                        <div className="text-xs text-ink-500">{formatDateTime(o.created_at)}</div>
                      </div>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </div>
                    <div className="divide-y divide-ink-100 text-sm dark:divide-ink-800">
                      {o.items.map((it, i) => (
                        <div key={i} className="flex justify-between gap-3 py-1.5">
                          <span className="min-w-0">
                            {it.name} <span className="text-ink-500">× {it.qty}</span>
                          </span>
                          <span className="shrink-0 tabular-nums">{formatMoney(it.price * it.qty)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-1 border-t border-ink-100 pt-2 text-sm dark:border-ink-800">
                      {o.shipping_cost > 0 && (
                        <div className="flex justify-between text-ink-500">
                          <span>Ongkir</span>
                          <span className="tabular-nums">{formatMoney(o.shipping_cost)}</span>
                        </div>
                      )}
                      <div className="flex justify-between font-semibold">
                        <span>Total</span>
                        <span className="tabular-nums text-brand-600">{formatMoney(o.total)}</span>
                      </div>
                    </div>
                    {o.delivery_address && (
                      <div className="flex items-start gap-1.5 text-xs text-ink-500">
                        <MapPin size={13} className="mt-0.5 shrink-0" /> {o.delivery_address}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          ))}

        {tab === 'ulasan' &&
          (reviewable === null ? (
            <div className="h-32 animate-pulse rounded-2xl bg-ink-100 dark:bg-ink-800" />
          ) : reviewable.length === 0 ? (
            <Card className="p-8">
              <EmptyState
                icon={<Star size={24} />}
                title="Belum ada barang untuk diulas"
                description="Setelah pesananmu dikonfirmasi toko, barangnya bisa kamu beri penilaian di sini."
              />
            </Card>
          ) : (
            <div className="space-y-2">
              {reviewable.map((r) => (
                <Card key={`${r.order_id}-${r.product_id}`} className="flex items-center gap-3 p-3">
                  <span className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-white ring-1 ring-ink-100 dark:bg-ink-900 dark:ring-ink-800">
                    {r.image_url ? <img src={r.image_url} alt="" className="h-full w-full object-contain" /> : null}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link to={`/toko/produk?id=${r.product_id}`} className="line-clamp-2 text-sm hover:text-brand-600">
                      {r.name}
                    </Link>
                    <div className="text-[11px] text-ink-500">
                      {r.variant_name ? `Variasi: ${r.variant_name} · ` : ''}
                      {r.order_number}
                    </div>
                  </div>
                  {r.reviewed ? (
                    <Badge tone="success">Sudah diulas</Badge>
                  ) : (
                    <Button size="sm" onClick={() => setMenilai(r)}>
                      Beri Ulasan
                    </Button>
                  )}
                </Card>
              ))}
            </div>
          ))}

        {tab === 'favorit' &&
          (favoritIds.length === 0 ? (
            <Card className="p-8">
              <EmptyState
                icon={<Heart size={24} />}
                title="Belum ada produk favorit"
                description="Tekan ikon hati di halaman produk untuk menyimpannya di sini."
                action={<Button onClick={() => navigate('/toko')}>Lihat Produk</Button>}
              />
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {favorit.map((k) => (
                <KartuProduk key={k.key} kelompok={k} currency={catalog?.store?.currency} />
              ))}
            </div>
          ))}

        {tab === 'profil' && (
          <Card className="space-y-3 p-4">
            <Input name="name" label="Nama" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input
              name="phone"
              label="Nomor HP / WhatsApp"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
            <TextArea
              name="address"
              label="Alamat pengiriman utama"
              placeholder="Jalan, nomor rumah, kelurahan, kecamatan, kota, kode pos"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
            <p className="text-[11px] text-ink-500">Alamat ini otomatis terisi saat checkout.</p>
            <div className="flex justify-end">
              <Button onClick={simpan} disabled={busy}>
                {busy ? 'Menyimpan…' : 'Simpan'}
              </Button>
            </div>
          </Card>
        )}
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
    toast.success('Terima kasih, ulasanmu sudah tampil di halaman produk.');
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
