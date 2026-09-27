import { useEffect, useMemo, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Heart,
  MapPin,
  MessageCircle,
  Minus,
  Play,
  Plus,
  Share2,
  ShieldCheck,
  ShoppingBag,
  Store,
  ThumbsUp,
  Truck,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { PublicShell } from '@/components/layout/PublicShell';
import { Bintang } from '@/components/public/Bintang';
import { KartuProduk } from '@/components/public/KartuProduk';
import { Link, useLocation, useNavigate } from '@/lib/router';
import { cn, formatMoney, formatNumber } from '@/lib/format';
import {
  fetchPublicCatalog,
  fetchPublicFlashSale,
  fetchPublicProduct,
  flashUntukKelompok,
  kelompokkanVarian,
  petaFlashAktif,
  tandaiHelpful,
  type PublicCatalogData,
  type PublicFlashSaleData,
  type PublicProductDetailData,
  type PublicReview,
} from '@/lib/publicCatalog';
import { PUBLIC_STORE_ID } from '@/lib/config';
import { usePublicCart } from '@/stores/publicCart';
import { useWishlist } from '@/stores/wishlist';
import { useCustomer } from '@/lib/customerAccount';
import { useKlikMasuk } from '@/components/public/KerangkaAuth';

const FLASH_KOSONG: PublicFlashSaleData = { flash_sale: null, items: [] };
const PER_HALAMAN = 5;
const KUNCI_HELPFUL = 'tokoku.helpful.v1';
// Deskripsi dipotong enam baris sebelum tombol "Lihat lebih banyak", sesuai
// permintaan client di PERMINTAAN-CLIENT.md butir 10. Satu baris text-sm
// leading-relaxed di huruf dasar 14px kira-kira 20px, jadi enam baris 120px.
// Angka ini dipakai dua kali - di CSS klem dan saat mengukur - jadi ditulis
// sekali di sini supaya tidak bisa berbeda.
const BATAS_KLEM_PX = 120;
const TOMBOL_BELI =
  'rounded-[4px] border border-brand-600 bg-white text-brand-600 transition-colors duration-150 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-ink-900';
const TOMBOL_TROLI =
  'rounded-[4px] bg-brand-600 text-white transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';
type TabId = 'ulasan' | 'detail-produk' | 'rekomendasi';
const TAB: [TabId, string][] = [
  ['ulasan', 'Ulasan'],
  ['detail-produk', 'Detail Produk'],
  ['rekomendasi', 'Rekomendasi'],
];

function tinggiHeader(): number {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tinggi-header')) || 118;
}

type FilterBintang = 'semua' | 1 | 2 | 3 | 4 | 5;
type Urutan = 'bawaan' | 'terbaru' | 'tertinggi' | 'terendah';
type Chip = 'semua' | 'foto' | 'berulang' | `tag:${string}`;
type Lembar = null | 'variasi' | 'spesifikasi' | 'layanan';

function beratTeks(gram: number): string {
  return gram >= 1000 ? `${formatNumber(+(gram / 1000).toFixed(2))} kg` : `${formatNumber(gram)} gram`;
}

/** Tanggal ulasan ala Lazada: relatif untuk yang baru, tanggal untuk yang lama. */
function waktuUlasan(iso: string): string {
  const hari = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (hari < 1) return 'Hari ini';
  if (hari < 7) return `${Math.floor(hari)} hari lalu`;
  if (hari < 30) return `${Math.floor(hari / 7)} minggu lalu`;
  return iso.slice(0, 10);
}

/** Tautan video YouTube jadi alamat embed; selain itu dianggap file video langsung. */
function embedYoutube(url: string): string | null {
  const m = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([\w-]{6,})/i.exec(url);
  return m ? `https://www.youtube.com/embed/${m[1]}` : null;
}

function bacaHelpful(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KUNCI_HELPFUL) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * Halaman produk toko online, disusun mengikuti halaman produk Lazada (hanya
 * warna yang memakai tema toko):
 *   galeri (foto + video) | judul, rating, merek, banner, harga, pilihan
 *   pengiriman, pengembalian & garansi, variasi, kuantitas, beli, bagikan, suka
 *   kartu penjual, tab Ulasan / Detail Produk / Rekomendasi
 *   ulasan (filter bintang, urutan, chip, Helpful, halaman)
 *   detail produk (spesifikasi, isi kotak, kualifikasi, sorotan, deskripsi)
 *   dari toko yang sama, kamu mungkin suka juga
 * Di HP: galeri dengan penghitung, baris ketuk (pilihan produk, spesifikasi,
 * pengiriman, layanan), ringkasan ulasan, kartu toko, dan bar bawah.
 *
 * Semua angka dari data asli toko. Yang datanya belum ada (mis. estimasi tiba,
 * yang menunggu integrasi ongkir) ditulis apa adanya, bukan angka karangan.
 */
export function PublicProductDetail() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const productId = new URLSearchParams(search).get('id') ?? '';

  const [data, setData] = useState<PublicProductDetailData | null>(null);
  const [catalog, setCatalog] = useState<PublicCatalogData | null>(null);
  const [flash, setFlash] = useState<PublicFlashSaleData>(FLASH_KOSONG);
  const [loading, setLoading] = useState(true);
  const [galeri, setGaleri] = useState(0);
  const [qty, setQty] = useState(1);
  const [qtyText, setQtyText] = useState('1');
  const [bintang, setBintang] = useState<FilterBintang>('semua');
  const [urutan, setUrutan] = useState<Urutan>('bawaan');
  const [chip, setChip] = useState<Chip>('semua');
  const [halaman, setHalaman] = useState(1);
  const [lembar, setLembar] = useState<Lembar>(null);
  const [ulasanHpPenuh, setUlasanHpPenuh] = useState(false);
  const [fotoBesar, setFotoBesar] = useState<string | null>(null);
  const [helpful, setHelpful] = useState<string[]>(bacaHelpful);
  const [tambahanHelpful, setTambahanHelpful] = useState<Record<string, number>>({});
  const thumbRef = useRef<HTMLDivElement>(null);
  const tombolRef = useRef<HTMLDivElement>(null);
  const tabRef = useRef<HTMLDivElement>(null);
  const tabItemRef = useRef<Partial<Record<TabId, HTMLAnchorElement | null>>>({});
  const [tabAktif, setTabAktif] = useState<TabId>('ulasan');
  const [tabMenempel, setTabMenempel] = useState(false);
  const [miniTampil, setMiniTampil] = useState(false);
  const [garis, setGaris] = useState({ kiri: 0, lebar: 0 });
  const deskripsiRef = useRef<HTMLDivElement>(null);
  const [deskripsiTerbentang, setDeskripsiTerbentang] = useState(false);
  const [deskripsiTerpotong, setDeskripsiTerpotong] = useState(false);

  const add = usePublicCart((s) => s.add);
  const setBuyNow = usePublicCart((s) => s.setBuyNow);
  const token = useCustomer((s) => s.token);
  const klikMasuk = useKlikMasuk();
  const me = useCustomer((s) => s.me);
  const favorit = useWishlist((s) => s.ids.includes(productId));
  const toggleFavorit = useWishlist((s) => s.toggle);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setGaleri(0);
    setQty(1);
    setQtyText('1');
    setHalaman(1);
    setLembar(null);
    setDeskripsiTerbentang(false);
    window.scrollTo({ top: 0 });
    fetchPublicProduct(PUBLIC_STORE_ID, productId)
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [productId]);

  useEffect(() => {
    fetchPublicCatalog(PUBLIC_STORE_ID).then(setCatalog).catch(() => {});
  }, []);

  // Sesi flash sale toko, tanpa cache supaya harganya segar tiap halaman dibuka.
  useEffect(() => {
    fetchPublicFlashSale(PUBLIC_STORE_ID).then(setFlash).catch(() => {});
  }, []);

  useEffect(() => setHalaman(1), [bintang, urutan, chip]);

  // Halaman ini juga punya bilah aksi menempel di bawah layar HP, jadi kaki
  // halaman perlu ruang yang sama seperti di checkout.
  useEffect(() => {
    document.body.classList.add('ada-bilah-bawah');
    return () => document.body.classList.remove('ada-bilah-bawah');
  }, []);

  // Seperti Lazada: tab menempel di bawah header dan menandai bagian yang sedang
  // dibaca; panel beli ringkas di kanan muncul setelah tombol beli utama lewat.
  useEffect(() => {
    if (!data) return;
    const onScroll = () => {
      const atas = tinggiHeader();
      const tab = tabRef.current;
      if (tab) setTabMenempel(tab.getBoundingClientRect().top <= atas + 1);
      const batas = atas + (tab?.offsetHeight ?? 44) + 16;
      let aktif: TabId = 'ulasan';
      for (const [id] of TAB) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= batas) aktif = id;
      }
      setTabAktif(aktif);
      const tombol = tombolRef.current;
      if (tombol) setMiniTampil(tombol.getBoundingClientRect().bottom < atas);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [data]);

  useEffect(() => {
    const el = tabItemRef.current[tabAktif];
    if (el) setGaris({ kiri: el.offsetLeft, lebar: el.offsetWidth });
  }, [tabAktif, data]);

  // Tombol "Lihat lebih banyak" hanya pantas muncul kalau yang disembunyikan
  // MEMANG BANYAK. Versi pertama memunculkannya begitu isi melebihi klem satu
  // piksel pun, hasilnya tombol yang membuka dua kata — tidak ada gunanya bagi
  // pembeli. Sekarang batasnya SISA_MINIMAL: kalau sisanya lebih pendek dari
  // itu, deskripsi ditampilkan utuh tanpa tombol sama sekali.
  useEffect(() => {
    const el = deskripsiRef.current;
    if (!el) {
      setDeskripsiTerpotong(false);
      return;
    }
    // Saat sudah terbentang, klemnya dilepas sehingga scrollHeight == clientHeight.
    // Mengukur dalam keadaan itu akan menyimpulkan "tidak terpotong" dan
    // menghilangkan tombol "Lihat lebih sedikit", jadi nilainya dipertahankan.
    if (deskripsiTerbentang) return;
    // Client: "ga di show semua langsung bagian deskripsi", leader: "nanti ada
    // tombol lihat lebih banyak trus nanti baru menampilkan penuh". Jadi
    // deskripsi yang lebih panjang dari enam baris WAJIB terpotong dan punya
    // tombol. Sisa 40px kira-kira dua baris: di bawah itu tombolnya cuma
    // membuka satu baris dan tidak ada gunanya, jadi deskripsi pendek tampil
    // utuh tanpa tombol.
    const SISA_MINIMAL = 40;
    const ukur = () => {
      // scrollHeight selalu melaporkan tinggi isi SEBENARNYA, terklem maupun
      // tidak, jadi perbandingannya memakai batas klem yang kita pasang sendiri
      // di CSS. Memakai clientHeight tidak bisa: saat klem belum terpasang,
      // nilainya sama dengan scrollHeight sehingga isi sepanjang apa pun
      // dinilai pendek.
      setDeskripsiTerpotong(el.scrollHeight > BATAS_KLEM_PX + SISA_MINIMAL);
    };
    ukur();
    // Isinya sekarang teks saja, jadi tidak ada lagi gambar yang tingginya
    // baru diketahui setelah dimuat; penantian muat gambar dihapus.
    // Lebar layar berubah (putar HP, jendela diperkecil) mengubah jumlah baris,
    // jadi hasil ukur tadi bisa basi: teks jadi terpotong tanpa tombol, dan
    // sisanya tidak bisa dijangkau sama sekali.
    const pengamat = new ResizeObserver(ukur);
    pengamat.observe(el);
    return () => {
      pengamat.disconnect();
    };
  }, [data?.product.id, data?.product.description, deskripsiTerbentang]);

  const lainnya = useMemo(() => {
    if (!catalog || !data) return { sama: [], suka: [] };
    const namaIni = data.product.name.trim().toLowerCase();
    const semua = kelompokkanVarian(catalog.products).filter((k) => k.key !== namaIni);
    const sekategori = (k: (typeof semua)[number]) => !!k.wakil.category_id && k.wakil.category_id === data.product.category_id;
    const sama = [...semua.filter(sekategori), ...semua.filter((k) => !sekategori(k))].slice(0, 6);
    const idSama = new Set(sama.map((k) => k.key));
    const suka = semua.filter((k) => !idSama.has(k.key)).sort((a, b) => b.terjual - a.terjual).slice(0, 12);
    return { sama, suka };
  }, [catalog, data]);

  const petaFlash = useMemo(() => petaFlashAktif(flash.items), [flash.items]);

  if (loading) {
    return (
      <PublicShell wide>
        <div className="grid gap-5 lg:grid-cols-[450px_1fr]">
          <div className="aspect-square animate-pulse rounded-2xl bg-ink-100 dark:bg-ink-800" />
          <div className="space-y-3">
            <div className="h-6 w-2/3 animate-pulse rounded bg-ink-100 dark:bg-ink-800" />
            <div className="h-10 w-1/3 animate-pulse rounded bg-ink-100 dark:bg-ink-800" />
          </div>
        </div>
      </PublicShell>
    );
  }

  if (!data) {
    return (
      <PublicShell wide>
        <Blok className="p-10 text-center">
          <p className="text-sm text-ink-500">Produk tidak ditemukan atau sudah tidak dijual.</p>
          <Button className="mt-4" onClick={() => navigate('/toko')}>
            Kembali ke Katalog
          </Button>
        </Blok>
      </PublicShell>
    );
  }

  const { store, product, variants, components, reviews } = data;
  const kategori = catalog?.categories.find((c) => c.id === product.category_id)?.name;
  const media: { jenis: 'foto' | 'video'; src: string }[] = [
    ...(product.image_url ? [{ jenis: 'foto' as const, src: product.image_url }] : []),
    ...(product.video_url ? [{ jenis: 'video' as const, src: product.video_url }] : []),
    ...(product.images ?? []).map((src) => ({ jenis: 'foto' as const, src })),
  ];
  const aktifMedia = media[galeri] ?? media[0];
  const stok = Number(product.stock_qty ?? 0);
  const habis = product.track_stock && stok <= 0;
  const maxQty = product.track_stock ? Math.max(1, stok) : 999;
  // Item flash aktif untuk produk ini (kalau ada) menggantikan harga normal di
  // seluruh halaman: hero, panel beli ringkas, dan harga yang dibawa ke keranjang
  // — server tetap menghitung ulang harga sebenarnya saat checkout.
  const itemFlash = petaFlash.get(product.id) ?? null;
  const harga = itemFlash ? Number(itemFlash.flash_price) : Number(product.base_price);
  const coret = itemFlash ? Number(itemFlash.base_price) : Number(product.compare_at_price ?? 0);
  const diskon = coret > harga && harga > 0 ? Math.round((1 - harga / coret) * 100) : 0;
  const namaAtribut = product.variant_label?.trim() || 'Variasi';
  const labelVarian = (v: { variant_name: string | null; sku: string | null }) => v.variant_name || v.sku || 'Standar';
  const variasi = [...variants].sort((a, b) =>
    labelVarian(a).localeCompare(labelVarian(b), 'id', { numeric: true, sensitivity: 'base' }),
  );
  // Saklar chat di Pengaturan mematikan SEMUA pintu chat, termasuk dua tombol
  // di halaman ini (kartu penjual dan bilah bawah HP) — kalau hanya tombol
  // mengambang yang ikut saklar, pembeli tetap punya jalan masuk dan saklarnya
  // jadi bohong. Saklar yang belum pernah diisi dianggap menyala.
  const chatDiizinkan = store.chat_enabled ?? true;
  const chatUrl =
    chatDiizinkan && store.shop_phone
      ? `https://wa.me/${store.shop_phone.replace(/\D/g, '').replace(/^0/, '62')}?text=${encodeURIComponent(
          `Halo, saya mau tanya tentang ${product.name}${product.variant_name ? ` (${product.variant_name})` : ''}.`,
        )}`
      : null;

  // Pengembalian & garansi: jaminan toko (satu per baris di Pengaturan) + garansi produk.
  const garansiProduk = [product.warranty_period, product.warranty_type].filter(Boolean).join(' ');
  const layanan = [
    ...(store.return_policy ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
    ...(store.warranty_info ? [store.warranty_info] : []),
    ...(garansiProduk ? [garansiProduk] : []),
  ];

  // Spesifikasi seperti di Lazada: merek & SKU dulu, lalu atribut produk, garansi, ukuran.
  const spesifikasi: [string, string][] = [
    ['Merek', product.brand || 'Tanpa Merek'],
    ['SKU', product.sku || '-'],
    ...(product.spec ?? []).filter((s) => s.label && s.value).map((s) => [s.label, s.value] as [string, string]),
    ...(product.variant_name ? [[namaAtribut, product.variant_name] as [string, string]] : []),
    ...(Number(product.weight_gram) > 0 ? [['Berat', beratTeks(Number(product.weight_gram))] as [string, string]] : []),
    ...(Number(product.length_cm) || Number(product.width_cm) || Number(product.height_cm)
      ? [
          [
            'Ukuran (P × L × T)',
            `${formatNumber(Number(product.length_cm ?? 0))} × ${formatNumber(Number(product.width_cm ?? 0))} × ${formatNumber(Number(product.height_cm ?? 0))} cm`,
          ] as [string, string],
        ]
      : []),
    ...(product.warranty_type ? [['Jenis Garansi', product.warranty_type] as [string, string]] : []),
    ...(product.warranty_period ? [['Periode Garansi', product.warranty_period] as [string, string]] : []),
  ];
  const isiKotak =
    product.box_contents?.trim() ||
    (components.length ? components.map((c) => `${formatNumber(c.qty)} ${c.name}`).join(', ') : '');
  const sorotan = (product.highlights ?? '').split(/\r?\n/).map((s) => s.replace(/^[-•*]\s*/, '').trim()).filter(Boolean);

  // ---- Ulasan ----
  const jumlahUlasan = reviews.length;
  const rataRata = jumlahUlasan ? reviews.reduce((s, r) => s + r.rating, 0) / jumlahUlasan : 0;
  const jumlahTag = new Map<string, number>();
  for (const r of reviews) for (const t of r.tags ?? []) jumlahTag.set(t, (jumlahTag.get(t) ?? 0) + 1);
  const jumlahFoto = reviews.filter((r) => r.images?.length).length;
  const jumlahBerulang = reviews.filter((r) => r.pelanggan_berulang).length;
  const cocok = (r: PublicReview) =>
    (bintang === 'semua' || r.rating === bintang) &&
    (chip === 'semua' ||
      (chip === 'foto' && r.images?.length > 0) ||
      (chip === 'berulang' && r.pelanggan_berulang) ||
      (chip.startsWith('tag:') && (r.tags ?? []).includes(chip.slice(4))));
  const ulasanUrut = reviews.filter(cocok).sort((a, b) => {
    if (urutan === 'terbaru') return b.created_at.localeCompare(a.created_at);
    if (urutan === 'tertinggi') return b.rating - a.rating || b.created_at.localeCompare(a.created_at);
    if (urutan === 'terendah') return a.rating - b.rating || b.created_at.localeCompare(a.created_at);
    // Bawaan: yang paling membantu dan berfoto dulu, lalu terbaru.
    const skor = (r: PublicReview) => r.helpful_count * 2 + (r.images?.length ? 1 : 0);
    return skor(b) - skor(a) || b.created_at.localeCompare(a.created_at);
  });
  const totalHalaman = Math.max(1, Math.ceil(ulasanUrut.length / PER_HALAMAN));
  const ulasanHalaman = ulasanUrut.slice((halaman - 1) * PER_HALAMAN, halaman * PER_HALAMAN);

  // ---- Penjual ----
  const nilaiToko = store.rating_count ? Math.round((store.positive_count / store.rating_count) * 100) : null;
  const umurTahun = Math.floor((Date.now() - new Date(store.created_at).getTime()) / (365.25 * 86400000));

  function aturQty(n: number) {
    const bersih = Math.min(maxQty, Math.max(1, Math.floor(n) || 1));
    setQty(bersih);
    setQtyText(String(bersih));
  }

  function tambahKeranjang() {
    add({ product_id: product.id, name: product.name, price: harga, image_url: product.image_url }, qty);
    toast.success(`${product.name} ×${qty} masuk keranjang.`);
  }

  function beliSekarang() {
    setBuyNow({ product_id: product.id, name: product.name, price: harga, image_url: product.image_url, qty });
    navigate('/toko/checkout?mode=direct');
  }

  async function bagikan() {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: product.name, url });
      else {
        await navigator.clipboard.writeText(url);
        toast.success('Tautan produk disalin.');
      }
    } catch {
      // Dibatalkan pengguna.
    }
  }

  async function klikHelpful(r: PublicReview) {
    if (helpful.includes(r.id)) return;
    const baru = [...helpful, r.id];
    setHelpful(baru);
    try {
      localStorage.setItem(KUNCI_HELPFUL, JSON.stringify(baru));
    } catch {
      // Mode privat: tanda hanya bertahan selama halaman terbuka.
    }
    setTambahanHelpful((m) => ({ ...m, [r.id]: (m[r.id] ?? 0) + 1 }));
    await tandaiHelpful(r.id).catch(() => {});
  }

  const tautanMasuk = `/toko/masuk?next=${encodeURIComponent(`/toko/produk?id=${product.id}`)}`;

  // ---------- potongan yang dipakai desktop & HP ----------
  const pilihVariasi = variasi.length > 1 && (
    <div className="flex flex-wrap gap-2">
      {variasi.map((v) => {
        const vHabis = v.track_stock && Number(v.stock_qty) <= 0;
        const aktif = v.id === product.id;
        return (
          <button
            key={v.id}
            type="button"
            onClick={() => !aktif && navigate(`/toko/produk?id=${v.id}`)}
            className={cn(
              'rounded-md border px-3 py-1.5 text-sm transition',
              aktif
                ? 'border-brand-500 text-brand-700 dark:text-brand-200'
                : 'border-ink-200 hover:border-brand-400 dark:border-ink-700',
              vHabis && !aktif && 'text-ink-400 line-through decoration-ink-300',
            )}
            aria-pressed={aktif}
          >
            {labelVarian(v)}
          </button>
        );
      })}
    </div>
  );

  const pengatur = (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center rounded-md border border-ink-200 dark:border-ink-700">
        <button
          type="button"
          className="grid h-9 w-9 place-items-center hover:bg-ink-50 disabled:opacity-40 dark:hover:bg-ink-800"
          onClick={() => aturQty(qty - 1)}
          disabled={qty <= 1}
          aria-label="Kurangi"
        >
          <Minus size={14} />
        </button>
        <input
          aria-label="Jumlah"
          inputMode="numeric"
          className="h-9 w-14 border-x border-ink-200 bg-transparent text-center text-sm focus:outline-none dark:border-ink-700"
          value={qtyText}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setQtyText(e.target.value.replace(/\D/g, ''))}
          onBlur={() => aturQty(Number(qtyText))}
        />
        <button
          type="button"
          className="grid h-9 w-9 place-items-center hover:bg-ink-50 disabled:opacity-40 dark:hover:bg-ink-800"
          onClick={() => aturQty(qty + 1)}
          disabled={qty >= maxQty}
          aria-label="Tambah"
        >
          <Plus size={14} />
        </button>
      </div>
      <span className={cn('text-xs', habis ? 'font-medium text-rose-600' : 'text-ink-500')}>
        {habis ? 'Stok habis' : product.track_stock ? `Tersisa ${formatNumber(stok)} buah` : 'Stok tersedia'}
      </span>
    </div>
  );

  const barisPengiriman = (
    <div className="space-y-1.5 text-sm">
      <div className="flex items-start gap-2">
        <MapPin size={16} className="mt-0.5 shrink-0 text-ink-400" />
        <span className="min-w-0 flex-1">
          {me?.address || (token ? 'Alamat belum diisi di akun.' : 'Masuk untuk memakai alamat pengirimanmu.')}
        </span>
        <Link to={token ? '/toko/akun?tab=profil' : tautanMasuk} onClick={token ? undefined : klikMasuk('masuk', `/toko/produk?id=${product.id}`)} className="shrink-0 -my-[11px] py-[11px] text-xs font-semibold text-brand-600">
          UBAH
        </Link>
      </div>
      <div className="flex items-start gap-2">
        <Truck size={16} className="mt-0.5 shrink-0 text-ink-400" />
        <span>
          Reguler
          <span className="block text-xs text-ink-500">Ongkir dan estimasi tiba dikonfirmasi toko sebelum pembayaran.</span>
        </span>
      </div>
    </div>
  );

  const barisLayanan = (
    <div className="flex items-start gap-2 text-sm">
      <ShieldCheck size={16} className="mt-0.5 shrink-0 text-ink-400" />
      <span>{layanan.length ? layanan.join(' · ') : 'Garansi tidak tersedia'}</span>
    </div>
  );

  const bagianUlasan = (
    <Blok id="ulasan" className="scroll-mt-32 space-y-4 p-4 lg:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Ulasan({formatNumber(jumlahUlasan)})</h2>
        <div className="flex flex-wrap items-center gap-3 text-xs text-ink-500">
          <label className="flex items-center gap-1.5">
            Filter oleh
            <select
              className="input h-8 w-auto py-0 text-xs"
              value={String(bintang)}
              onChange={(e) => setBintang(e.target.value === 'semua' ? 'semua' : (Number(e.target.value) as FilterBintang))}
              aria-label="Filter bintang"
            >
              <option value="semua">Semua bintang</option>
              {[5, 4, 3, 2, 1].map((b) => (
                <option key={b} value={b}>
                  {b} bintang
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            Urutkan oleh
            <select
              className="input h-8 w-auto py-0 text-xs"
              value={urutan}
              onChange={(e) => setUrutan(e.target.value as Urutan)}
              aria-label="Urutkan ulasan"
            >
              <option value="bawaan">Bawaan</option>
              <option value="terbaru">Terbaru</option>
              <option value="tertinggi">Rating tertinggi</option>
              <option value="terendah">Rating terendah</option>
            </select>
          </label>
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-md bg-brand-50/60 p-4 sm:flex-row sm:items-start dark:bg-brand-950/20">
        <div className="shrink-0 text-center sm:w-32">
          <div>
            <span className="text-4xl font-bold">{rataRata.toFixed(1)}</span>
            <span className="text-lg text-ink-400">/5</span>
          </div>
          <div className="mt-1 flex justify-center">
            <Bintang nilai={rataRata} ukuran={20} />
          </div>
        </div>

      <div className="flex flex-wrap content-start gap-2">
        {(
          [
            ['semua', 'Semua'],
            ['foto', `Dengan gambar/video(${formatNumber(jumlahFoto)})`],
            ['berulang', `Pelanggan berulang(${formatNumber(jumlahBerulang)})`],
            ...[...jumlahTag.entries()].map(([t, n]) => [`tag:${t}`, `${t}(${formatNumber(n)})`] as [Chip, string]),
          ] as [Chip, string][]
        ).map(([nilai, label]) => (
          <button
            key={nilai}
            type="button"
            onClick={() => setChip(nilai)}
            className={cn(
              'rounded border bg-white px-3 py-1 text-xs transition-colors duration-150 dark:bg-ink-900',
              chip === nilai
                ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-200'
                : 'border-ink-200 hover:border-brand-300 dark:border-ink-700',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      </div>

      {ulasanHalaman.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-500">
          {jumlahUlasan === 0
            ? 'Belum ada ulasan. Ulasan bisa ditulis pembeli setelah pesanannya selesai.'
            : 'Tidak ada ulasan untuk filter ini.'}
        </p>
      ) : (
        <div className="divide-y divide-ink-100 dark:divide-ink-800">
          {ulasanHalaman.map((r) => (
            <div key={r.id} className="flex gap-4 py-4">
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-ink-100 text-xs font-semibold text-ink-600 dark:bg-ink-800 dark:text-ink-300">
                    {r.reviewer_name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="text-sm">{r.reviewer_name}</span>
                  <span className="text-xs text-ink-400">{waktuUlasan(r.created_at)}</span>
                </div>
                <Bintang nilai={r.rating} ukuran={13} />
                {r.variant_label && (
                  <div className="text-xs text-ink-500">
                    {namaAtribut}: {r.variant_label}
                  </div>
                )}
                {(r.tags ?? []).length > 0 && <div className="text-sm">{r.tags.join(', ')},</div>}
                {r.body && <p className="whitespace-pre-line text-sm">{r.body}</p>}
                {r.seller_reply && (
                  <div className="rounded-md bg-ink-50 p-2.5 text-xs dark:bg-ink-900">
                    <span className="font-semibold">Balasan Penjual:</span> {r.seller_reply}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => klikHelpful(r)}
                  className={cn(
                    'inline-flex items-center gap-1 text-xs',
                    helpful.includes(r.id) ? 'text-brand-600' : 'text-ink-500 hover:text-brand-600',
                  )}
                >
                  <ThumbsUp size={13} /> Helpful({formatNumber(r.helpful_count + (tambahanHelpful[r.id] ?? 0))})
                </button>
              </div>
              {r.images?.length > 0 && (
                <div className="flex shrink-0 gap-1.5">
                  {r.images.slice(0, 3).map((src, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setFotoBesar(src)}
                      className="h-20 w-20 overflow-hidden rounded-md ring-1 ring-ink-100 dark:ring-ink-800"
                      aria-label="Lihat foto ulasan"
                    >
                      <img src={src} alt="" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {totalHalaman > 1 && (
        <div className="flex flex-wrap items-center justify-end gap-1.5 text-xs">
          <span className="mr-2 text-ink-500">
            Halaman {halaman} dari {totalHalaman}
          </span>
          <button
            type="button"
            className="grid h-7 w-7 place-items-center rounded border border-ink-200 disabled:opacity-40 dark:border-ink-700"
            onClick={() => setHalaman(halaman - 1)}
            disabled={halaman <= 1}
            aria-label="Halaman sebelumnya"
          >
            <ChevronLeft size={13} />
          </button>
          {Array.from({ length: totalHalaman }, (_, i) => i + 1)
            .filter((n) => n === 1 || n === totalHalaman || Math.abs(n - halaman) <= 2)
            .map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setHalaman(n)}
                className={cn(
                  'h-7 min-w-7 rounded border px-1.5',
                  n === halaman ? 'border-brand-500 text-brand-600' : 'border-ink-200 dark:border-ink-700',
                )}
              >
                {n}
              </button>
            ))}
          <button
            type="button"
            className="grid h-7 w-7 place-items-center rounded border border-ink-200 disabled:opacity-40 dark:border-ink-700"
            onClick={() => setHalaman(halaman + 1)}
            disabled={halaman >= totalHalaman}
            aria-label="Halaman berikutnya"
          >
            <ChevronRight size={13} />
          </button>
        </div>
      )}
    </Blok>
  );

  const daftarSpesifikasi = (
    <dl className="grid gap-x-10 gap-y-3 text-sm sm:grid-cols-2">
      {spesifikasi.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-ink-500">{k}</dt>
          <dd className="mt-0.5 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );

  function lompatKe(id: TabId) {
    const el = document.getElementById(id);
    if (!el) return;
    const jarak = tinggiHeader() + (tabRef.current?.offsetHeight ?? 44) + 8;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - jarak, behavior: 'smooth' });
  }

  const miniSku = (
    <aside
      aria-hidden={!miniTampil}
      className={cn(
        'sticky top-[calc(var(--tinggi-header,118px)+60px)] hidden rounded-lg bg-white p-4 transition-[opacity,visibility] duration-[400ms] ease-out lg:block dark:bg-ink-900',
        miniTampil ? 'visible opacity-100' : 'invisible opacity-0',
      )}
    >
      <div className="flex items-center gap-3">
        <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded bg-white text-ink-300 ring-1 ring-ink-100 dark:bg-ink-900 dark:ring-ink-800">
          {product.image_url ? <img src={product.image_url} alt="" className="h-full w-full object-contain" /> : <ShoppingBag size={22} />}
        </span>
        <span>
          {itemFlash && (
            <span className="mb-1 inline-flex w-fit items-center rounded-sm bg-rose-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
              Flash Sale
            </span>
          )}
          <span className="block text-2xl text-brand-600">{formatMoney(harga, store.currency)}</span>
        </span>
      </div>
      {variasi.length > 1 && (
        <div className="mt-4 grid grid-cols-[80px_minmax(0,1fr)] gap-2 text-sm">
          <span className="pt-1.5 text-ink-500">{namaAtribut}:</span>
          <div className="space-y-2">
            <div>{labelVarian(product)}</div>
            {pilihVariasi}
          </div>
        </div>
      )}
      <div className="mt-4 grid grid-cols-[80px_minmax(0,1fr)] items-center gap-2 text-sm">
        <span className="text-ink-500">Kuantitas:</span>
        <div className="flex w-fit items-center rounded-md border border-ink-200 dark:border-ink-700">
          <button
            type="button"
            aria-label="Kurangi kuantitas"
            onClick={() => aturQty(qty - 1)}
            disabled={qty <= 1}
            className="grid h-8 w-8 place-items-center hover:bg-ink-50 disabled:opacity-40 dark:hover:bg-ink-800"
          >
            <Minus size={13} />
          </button>
          <span className="w-10 text-center tabular-nums">{qty}</span>
          <button
            type="button"
            aria-label="Tambah kuantitas"
            onClick={() => aturQty(qty + 1)}
            disabled={qty >= maxQty}
            className="grid h-8 w-8 place-items-center hover:bg-ink-50 disabled:opacity-40 dark:hover:bg-ink-800"
          >
            <Plus size={13} />
          </button>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" className={cn(TOMBOL_BELI, 'h-10 text-sm')} disabled={habis} onClick={beliSekarang}>
          Beli sekarang
        </button>
        <button type="button" className={cn(TOMBOL_TROLI, 'h-10 text-sm')} disabled={habis} onClick={tambahKeranjang}>
          Tambah ke keranjang
        </button>
      </div>
    </aside>
  );

  return (
    <PublicShell wide>
      <div className="space-y-4 pb-24 lg:pb-0">
        {/* ---------- Jalur halaman ---------- */}
        <nav className="hidden flex-wrap items-center gap-1 text-sm text-ink-500 lg:flex" aria-label="Jalur halaman">
          <Link to="/toko" className="text-brand-600 hover:underline">
            Beranda
          </Link>
          {kategori && (
            <>
              <ChevronRight size={14} />
              <span className="text-brand-600">{kategori}</span>
            </>
          )}
          <ChevronRight size={14} />
          <span className="line-clamp-1 max-w-[36rem]">{product.name}</span>
        </nav>

        {/* ---------- Blok utama: galeri | info ---------- */}
        <Blok className="grid gap-6 p-0 lg:grid-cols-[450px_minmax(0,1fr)] lg:p-5">
          <div className="space-y-2">
            <div className="relative overflow-hidden bg-white lg:rounded-md lg:ring-1 lg:ring-ink-100 dark:bg-ink-900 dark:lg:ring-ink-800">
              <div className="aspect-square">
                {!aktifMedia ? (
                  <div className="grid h-full place-items-center text-ink-300 dark:text-ink-600">
                    <ShoppingBag size={56} />
                  </div>
                ) : aktifMedia.jenis === 'video' ? (
                  embedYoutube(aktifMedia.src) ? (
                    <iframe
                      src={embedYoutube(aktifMedia.src)!}
                      title="Video produk"
                      className="h-full w-full"
                      allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  ) : (
                    <video src={aktifMedia.src} controls className="h-full w-full bg-black object-contain" />
                  )
                ) : (
                  <img src={aktifMedia.src} alt={product.name} className="h-full w-full object-contain" />
                )}
              </div>
              {media.length > 1 && (
                <span className="absolute bottom-3 right-3 rounded-full bg-black/50 px-2 py-0.5 text-xs text-white lg:hidden">
                  {galeri + 1}/{media.length}
                </span>
              )}
              {media.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => setGaleri((galeri - 1 + media.length) % media.length)}
                    className="absolute left-2 top-1/2 grid h-[44px] w-[44px] -translate-y-1/2 place-items-center rounded-full bg-white/80 text-ink-700 shadow lg:hidden"
                    aria-label="Media sebelumnya"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setGaleri((galeri + 1) % media.length)}
                    className="absolute right-2 top-1/2 grid h-[44px] w-[44px] -translate-y-1/2 place-items-center rounded-full bg-white/80 text-ink-700 shadow lg:hidden"
                    aria-label="Media berikutnya"
                  >
                    <ChevronRight size={16} />
                  </button>
                </>
              )}
            </div>
            {media.length > 1 && (
              <div className="relative hidden items-center gap-1 lg:flex">
                <button
                  type="button"
                  onClick={() => thumbRef.current?.scrollBy({ left: -240, behavior: 'smooth' })}
                  className="grid h-8 w-6 shrink-0 place-items-center text-ink-400 hover:text-ink-700"
                  aria-label="Geser kiri"
                >
                  <ChevronLeft size={18} />
                </button>
                <div ref={thumbRef} className="flex flex-1 gap-2 overflow-x-hidden">
                  {media.map((m, i) => (
                    <button
                      key={i}
                      type="button"
                      onMouseEnter={() => setGaleri(i)}
                      onClick={() => setGaleri(i)}
                      className={cn(
                        'relative h-16 w-16 shrink-0 overflow-hidden rounded border-2 bg-white dark:bg-ink-900',
                        i === galeri ? 'border-brand-500' : 'border-transparent',
                      )}
                      aria-label={m.jenis === 'video' ? 'Video produk' : `Foto ${i + 1}`}
                    >
                      {m.jenis === 'video' ? (
                        <span className="grid h-full w-full place-items-center bg-ink-800 text-white">
                          <Play size={20} className="fill-white" />
                        </span>
                      ) : (
                        <img src={m.src} alt="" className="h-full w-full object-contain" />
                      )}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => thumbRef.current?.scrollBy({ left: 240, behavior: 'smooth' })}
                  className="grid h-8 w-6 shrink-0 place-items-center text-ink-400 hover:text-ink-700"
                  aria-label="Geser kanan"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            )}
          </div>

          {/* ----- Info (desktop) ----- */}
          <div className="hidden min-w-0 space-y-3 lg:block">
            <h1 className="text-xl leading-snug">{product.name}</h1>
            <a href="#ulasan" className="flex items-center gap-2 text-sm hover:text-brand-600">
              <Bintang nilai={rataRata} ukuran={16} />
              <span>
                {rataRata.toFixed(1)}({formatNumber(jumlahUlasan)})
              </span>
            </a>
            <div className="text-sm text-ink-600 dark:text-ink-300">
              Merek:{' '}
              {product.brand ? (
                <>
                  <Link to={`/toko?merek=${encodeURIComponent(product.brand)}`} className="text-brand-600 hover:underline">
                    {product.brand}
                  </Link>
                  <span className="mx-1.5 text-ink-300">|</span>
                  <Link to={`/toko?merek=${encodeURIComponent(product.brand)}`} className="text-brand-600 hover:underline">
                    Lebih banyak {kategori ?? 'produk'} dari {product.brand}
                  </Link>
                </>
              ) : (
                <span>Tanpa Merek</span>
              )}
            </div>
            {store.pdp_banner_url && (
              <img src={store.pdp_banner_url} alt="Promo toko" className="max-h-24 rounded-md object-contain" />
            )}
            <div>
              {itemFlash && (
                <span className="mb-1 inline-flex w-fit items-center rounded-sm bg-rose-600 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-white">
                  Flash Sale
                </span>
              )}
              <div className="text-3xl font-semibold text-brand-600">{formatMoney(harga, store.currency)}</div>
              {diskon > 0 && (
                <div className="mt-1 flex items-center gap-2 text-sm">
                  <span className="text-ink-400 line-through">{formatMoney(coret, store.currency)}</span>
                  <span className="text-ink-700 dark:text-ink-200">-{diskon}%</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-y-5 border-t border-ink-100 pt-4 dark:border-ink-800">
              <span className="text-sm text-ink-500">Pilihan pengiriman :</span>
              {barisPengiriman}
              <span className="text-sm text-ink-500">Pengembalian &amp; Garansi :</span>
              {barisLayanan}
              {variasi.length > 1 && (
                <>
                  <span className="pt-1.5 text-sm text-ink-500">{namaAtribut}:</span>
                  <div className="space-y-2">
                    <div className="text-sm">{labelVarian(product)}</div>
                    {pilihVariasi}
                  </div>
                </>
              )}
              <span className="self-center text-sm text-ink-500">Kuantitas:</span>
              {pengatur}
            </div>

            <div ref={tombolRef} className="flex items-center gap-3 pt-2">
              <button type="button" className={cn(TOMBOL_BELI, 'h-12 flex-1 text-base')} disabled={habis} onClick={beliSekarang}>
                Beli sekarang
              </button>
              <button type="button" className={cn(TOMBOL_TROLI, 'h-12 flex-1 text-base')} disabled={habis} onClick={tambahKeranjang}>
                Tambah ke keranjang
              </button>
              <button type="button" onClick={bagikan} className="flex flex-col items-center text-[11px] text-ink-500 hover:text-brand-600">
                <Share2 size={20} /> Bagikan
              </button>
              <button
                type="button"
                onClick={() => toast.success(toggleFavorit(product.id) ? 'Masuk ke Favorit.' : 'Dihapus dari Favorit.')}
                className={cn('flex flex-col items-center text-[11px]', favorit ? 'text-rose-500' : 'text-ink-500 hover:text-rose-500')}
                aria-label="Favorit"
              >
                <Heart size={20} className={favorit ? 'fill-rose-500' : ''} /> Suka
              </button>
            </div>
          </div>

          {/* ----- Info (HP) ----- */}
          <div className="space-y-2 px-4 pb-4 lg:hidden">
            <div className="flex items-start justify-between gap-3">
              <div>
                {itemFlash && (
                  <span className="mb-1 inline-flex w-fit items-center rounded-sm bg-rose-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                    Flash Sale
                  </span>
                )}
                <div className="text-2xl font-semibold text-brand-600">{formatMoney(harga, store.currency)}</div>
                {diskon > 0 && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-ink-400 line-through">{formatMoney(coret, store.currency)}</span>
                    <span>-{diskon}%</span>
                  </div>
                )}
              </div>
              <div className="flex gap-3 pt-1 text-ink-500">
                <button
                  type="button"
                  onClick={() => toast.success(toggleFavorit(product.id) ? 'Masuk ke Favorit.' : 'Dihapus dari Favorit.')}
                  aria-label="Favorit"
                  className={cn('-m-[10px] p-[10px]', favorit && 'text-rose-500')}
                >
                  <Heart size={20} className={favorit ? 'fill-rose-500' : ''} />
                </button>
                <button type="button" onClick={bagikan} aria-label="Bagikan" className="-m-[10px] p-[10px]">
                  <Share2 size={20} />
                </button>
              </div>
            </div>
            {store.pdp_banner_url && <img src={store.pdp_banner_url} alt="Promo toko" className="max-h-28 w-full rounded-md object-contain" />}
            <h1 className="text-base leading-snug">{product.name}</h1>
            <a href="#ulasan-hp" className="flex items-center gap-1.5 text-xs">
              <Bintang nilai={rataRata} ukuran={12} /> {rataRata.toFixed(1)} ({formatNumber(jumlahUlasan)})
            </a>
          </div>
        </Blok>

        {/* ----- Baris ketuk (HP) ----- */}
        <Blok className="divide-y divide-ink-100 text-sm lg:hidden dark:divide-ink-800">
          {variasi.length > 1 && (
            <BarisKetuk label="Pilihan Produk" onClick={() => setLembar('variasi')}>
              {labelVarian(product)}
            </BarisKetuk>
          )}
          <BarisKetuk label="Spesifikasi" onClick={() => setLembar('spesifikasi')}>
            {spesifikasi.slice(0, 3).map(([k]) => k).join(', ')}
          </BarisKetuk>
          <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-2 p-4">
            <span className="text-ink-500">Pengiriman</span>
            {barisPengiriman}
          </div>
          <BarisKetuk label="Layanan" onClick={() => setLembar('layanan')}>
            <span className="block space-y-0.5">
              {(layanan.length ? layanan : ['Garansi tidak tersedia']).map((l) => (
                <span key={l} className="flex items-center gap-1.5">
                  <ShieldCheck size={12} className="text-brand-600" /> {l}
                </span>
              ))}
            </span>
          </BarisKetuk>
        </Blok>

        {/* ----- Ringkasan ulasan (HP) ----- */}
        <Blok id="ulasan-hp" className="space-y-3 p-4 lg:hidden">
          <div className="flex items-center justify-between">
            <span className="font-semibold">Penilaian &amp; Ulasan ({formatNumber(jumlahUlasan)})</span>
            {jumlahUlasan > 0 && (
              <button type="button" className="text-xs font-semibold text-brand-600" onClick={() => setUlasanHpPenuh(true)}>
                Lihat Semua
              </button>
            )}
          </div>
          {reviews[0] ? (
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2 text-xs text-ink-500">
                <Bintang nilai={reviews[0].rating} ukuran={11} /> {reviews[0].reviewer_name}
              </div>
              <p className="line-clamp-3">{[...(reviews[0].tags ?? []), reviews[0].body].filter(Boolean).join(', ')}</p>
            </div>
          ) : (
            <p className="text-sm text-ink-500">Belum ada ulasan.</p>
          )}
        </Blok>

        {/* ---------- Kartu penjual ---------- */}
        {/* Di layar HP kartu ini ditumpuk. Sebelumnya nama toko dan angka
            statistik berebut satu baris: blok kirinya menyusut sampai hampir
            nol dan tulisan "Toko Baru" meluber menimpa "Nilai Toko". */}
        <Blok className="flex flex-col items-start gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4 lg:p-5">
          <div className="flex w-full min-w-0 items-center gap-3 sm:w-auto sm:flex-1">
            {store.logo_url ? (
              <span className="flex h-12 w-24 shrink-0 items-center justify-center rounded-md bg-white p-1 ring-1 ring-ink-100 dark:ring-ink-800">
                <img src={store.logo_url} alt={store.name} className="max-h-full max-w-full object-contain" />
              </span>
            ) : (
              <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-600 text-white">
              <Store size={20} />
            </span>
            )}
            <div className="min-w-0">
              <div className="truncate font-semibold">{store.name}</div>
              <div className="truncate text-xs text-ink-500">{umurTahun >= 1 ? `Toko ${umurTahun}-Tahun` : 'Toko Baru'}</div>
            </div>
          </div>
          <div className="grid w-full grid-cols-3 gap-4 text-center text-xs sm:w-auto lg:flex lg:gap-6 lg:text-left">
            <div>
              <div className="font-semibold text-ink-800 dark:text-ink-100">{nilaiToko === null ? '-' : `${nilaiToko}%`}</div>
              <div className="text-ink-500">Nilai Toko</div>
            </div>
            <div>
              <div className="font-semibold text-ink-800 dark:text-ink-100">{formatNumber(store.total_sold)}</div>
              <div className="text-ink-500">Terjual oleh Toko</div>
            </div>
            <div>
              <div className="font-semibold text-ink-800 dark:text-ink-100">{formatNumber(store.repeat_customers)}</div>
              <div className="text-ink-500">Pelanggan Tetap</div>
            </div>
          </div>
          <div className="flex w-full gap-2 lg:w-auto">
            {chatUrl && (
              <a
                href={chatUrl}
                target="_blank"
                rel="noreferrer"
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-ink-200 px-4 py-2 text-sm hover:bg-ink-50 lg:flex-none dark:border-ink-700 dark:hover:bg-ink-800"
              >
                <MessageCircle size={15} /> Chat
              </a>
            )}
            <Link
              to="/toko"
              className="flex flex-1 items-center justify-center rounded-md border border-ink-200 px-4 py-2 text-sm font-semibold text-brand-600 hover:bg-ink-50 lg:flex-none dark:border-ink-700 dark:hover:bg-ink-800"
            >
              KUNJUNGI TOKO
            </Link>
          </div>
        </Blok>

        {/* ---------- Tab halaman: menempel di bawah header, garis aktif bergeser 0,3 dtk ----------
             Dulu hanya tampil di desktop. Di HP pembeli jadi tidak punya cara
             melompat ke Ulasan atau Detail Produk selain menggulir panjang,
             padahal referensi client menampilkan tab ini justru di HP. */}
        <div
          ref={tabRef}
          className={cn(
            'sticky top-[var(--tinggi-header,118px)] z-20 block overflow-x-auto rounded-lg bg-white dark:bg-ink-900',
            tabMenempel && 'rounded-none shadow-[0_0_0_100vmax_#fff] [clip-path:inset(0_-100vmax)] dark:shadow-none',
          )}
        >
          <div className="relative flex gap-8 px-4 text-sm">
            {TAB.map(([id, label]) => (
              <a
                key={id}
                href={`#${id}`}
                ref={(el) => {
                  tabItemRef.current[id] = el;
                }}
                onClick={(e) => {
                  e.preventDefault();
                  lompatKe(id);
                }}
                className={cn(
                  'py-3 transition-colors duration-300',
                  tabAktif === id ? 'text-brand-600' : 'text-ink-700 hover:text-brand-600 dark:text-ink-200',
                )}
              >
                {label}
              </a>
            ))}
            <span
              aria-hidden
              className="absolute bottom-0 left-0 h-0.5 bg-brand-600 transition-[transform,width] duration-300"
              style={{ width: garis.lebar, transform: `translateX(${garis.kiri}px)` }}
            />
          </div>
        </div>

        <div className="space-y-4 lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-4 lg:space-y-0">
          <div className="min-w-0 space-y-4">
        <div className={cn('lg:block', ulasanHpPenuh ? 'block' : 'hidden')}>{bagianUlasan}</div>

        {/* ---------- Detail produk ---------- */}
        <Blok id="detail-produk" className="scroll-mt-32 space-y-5 p-4 lg:p-5">
          <h2 className="text-lg font-semibold">Detail Produk</h2>
          <BagianLipat judul="Spesifikasi">{daftarSpesifikasi}</BagianLipat>
          {isiKotak && (
            <BagianLipat judul="Apa yang ada di dalam kotak">
              <span className="text-sm">{isiKotak}</span>
            </BagianLipat>
          )}
          {(product.license_type || product.license_code) && (
            <BagianLipat judul="Kualifikasi">
              <dl className="grid gap-x-10 gap-y-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-ink-500">Tipe Lisensi</dt>
                  <dd className="mt-0.5">{product.license_type || '-'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-500">Kode Lisensi</dt>
                  <dd className="mt-0.5">{product.license_code || '-'}</dd>
                </div>
              </dl>
            </BagianLipat>
          )}
          {sorotan.length > 0 && (
            <section className="space-y-2">
              <h3 className="font-semibold">Sorotan</h3>
              <ul className="list-inside list-disc space-y-1 text-sm">
                {sorotan.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </section>
          )}
          <section className="space-y-2">
            <h3 className="font-semibold">Deskripsi</h3>
            {product.description ? (
              <>
                {/* Yang dipotong adalah SELURUH isi deskripsi: teksnya DAN
                    gambar-gambar panjangnya. Memotong teksnya saja tidak ada
                    gunanya — gambar banner setinggi 640px tetap memenuhi layar,
                    dan tombolnya cuma menyembunyikan satu dua baris. */}
                <div
                  ref={deskripsiRef}
                  className={cn('relative space-y-3 overflow-hidden')}
                  style={
                    !deskripsiTerbentang && deskripsiTerpotong
                      ? { maxHeight: BATAS_KLEM_PX }
                      : undefined
                  }
                >
                  {/* Tanpa gambar di sini. Blok ini dulu me-render ulang
                      product.images, yaitu foto galeri yang sama persis dengan
                      yang sudah dilihat pembeli di atas halaman: empat foto
                      640x640, 2751px, sementara teks deskripsinya sendiri cuma
                      54 karakter. Akibatnya tombol "Lihat lebih banyak"
                      menyembunyikan 87% foto duplikat, bukan deskripsi.
                      Diperiksa di lapak client sendiri: di Tokopedia dan di
                      gnnkracing.id deskripsi produk berisi teks saja, fotonya
                      ada di galeri. */}
                  <p className="whitespace-pre-line text-sm leading-relaxed text-ink-700 dark:text-ink-200">
                    {product.description}
                  </p>
                  {!deskripsiTerbentang && deskripsiTerpotong && (
                    // Gradasi di tepi bawah memberi tahu bahwa isinya masih
                    // berlanjut, bukan berhenti mendadak di tengah kalimat.
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-white dark:to-ink-900" />
                  )}
                </div>
                {deskripsiTerpotong && (
                  <button
                    type="button"
                    onClick={() => setDeskripsiTerbentang((v) => !v)}
                    className="inline-flex min-h-[44px] items-center text-sm font-semibold text-brand-600"
                  >
                    {deskripsiTerbentang ? 'Lihat lebih sedikit' : 'Lihat lebih banyak'}
                  </button>
                )}
              </>
            ) : (
              <>
                <p className="whitespace-pre-line text-sm leading-relaxed text-ink-700 dark:text-ink-200">
                  Belum ada deskripsi untuk produk ini.
                </p>
              </>
            )}
          </section>
          {chatUrl && (
            <p className="text-xs text-ink-500">
              Jika ingin melaporkan masalah pada produk ini,{' '}
              <a href={chatUrl} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
                klik di sini
              </a>
              .
            </p>
          )}
        </Blok>
          </div>
          {miniSku}
        </div>

        {/* ---------- Dari toko yang sama ---------- */}
        {lainnya.sama.length > 0 && (
          <section className="space-y-3 rounded-lg bg-white p-4 dark:bg-ink-900">
            <h2 className="text-base text-ink-800 dark:text-ink-100">Dari Toko yang Sama</h2>
            <div className="grid auto-cols-[46%] grid-flow-col gap-2.5 overflow-x-auto pb-1 sm:auto-cols-[30%] lg:grid-flow-row lg:grid-cols-6 lg:overflow-visible">
              {lainnya.sama.map((k) => (
                <KartuProduk key={k.key} kelompok={k} currency={store.currency} flash={flashUntukKelompok(k, petaFlash)} />
              ))}
            </div>
          </section>
        )}

        {/* ---------- Kamu mungkin suka juga ---------- */}
        {lainnya.suka.length > 0 && (
          <section id="rekomendasi" className="scroll-mt-32 space-y-2.5">
            <h2 className="text-lg text-ink-700 dark:text-ink-200">
              <span className="hidden lg:inline">Kamu mungkin suka juga</span>
              <span className="lg:hidden">Rekomendasi untukmu</span>
            </h2>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
              {lainnya.suka.map((k) => (
                <KartuProduk key={k.key} kelompok={k} currency={store.currency} flash={flashUntukKelompok(k, petaFlash)} />
              ))}
            </div>
          </section>
        )}
      </div>

      {/* ---------- Bar bawah (HP) ---------- */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-ink-100 bg-white p-2 dark:border-ink-800 dark:bg-ink-900 lg:hidden">
        <Link to="/toko" className="flex w-12 flex-col items-center text-[10px] text-ink-600 dark:text-ink-300" aria-label="Toko">
          <Store size={18} /> Toko
        </Link>
        {chatUrl && (
          <a
            href={chatUrl}
            target="_blank"
            rel="noreferrer"
            className="flex w-12 flex-col items-center text-[10px] text-ink-600 dark:text-ink-300"
            aria-label="Chat penjual"
          >
            <MessageCircle size={18} /> Chat
          </a>
        )}
        <Button variant="secondary" className="h-11 flex-1 border border-brand-500 text-brand-600" disabled={habis} onClick={beliSekarang}>
          {habis ? 'Stok habis' : 'Beli Sekarang'}
        </Button>
        <Button className="h-11 flex-1" disabled={habis} onClick={() => (variasi.length > 1 ? setLembar('variasi') : tambahKeranjang())}>
          + Keranjang
        </Button>
      </div>

      {/* ---------- Lembar bawah (HP) ---------- */}
      {lembar && (
        <div className="fixed inset-0 z-40 flex items-end bg-black/40 lg:hidden" onClick={() => setLembar(null)}>
          <div
            className="max-h-[80vh] w-full space-y-4 overflow-y-auto rounded-t-2xl bg-white p-4 dark:bg-ink-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold">
                {lembar === 'variasi' ? 'Pilihan Produk' : lembar === 'spesifikasi' ? 'Spesifikasi' : 'Layanan'}
              </span>
              <button type="button" onClick={() => setLembar(null)} aria-label="Tutup">
                <X size={18} />
              </button>
            </div>
            {lembar === 'variasi' && (
              <>
                <div className="flex items-center gap-3">
                  <span className="h-16 w-16 overflow-hidden rounded-md bg-white ring-1 ring-ink-100 dark:ring-ink-800">
                    {product.image_url && <img src={product.image_url} alt="" className="h-full w-full object-contain" />}
                  </span>
                  <div>
                    <div className="text-lg font-semibold text-brand-600">{formatMoney(harga, store.currency)}</div>
                    <div className="text-xs text-ink-500">
                      {namaAtribut}: {labelVarian(product)}
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-sm text-ink-500">{namaAtribut}</div>
                  {pilihVariasi}
                </div>
                <div className="space-y-2">
                  <div className="text-sm text-ink-500">Kuantitas</div>
                  {pengatur}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" className="border border-brand-500 text-brand-600" disabled={habis} onClick={beliSekarang}>
                    Beli Sekarang
                  </Button>
                  <Button
                    disabled={habis}
                    onClick={() => {
                      tambahKeranjang();
                      setLembar(null);
                    }}
                  >
                    + Keranjang
                  </Button>
                </div>
              </>
            )}
            {lembar === 'spesifikasi' && daftarSpesifikasi}
            {lembar === 'layanan' && barisLayanan}
          </div>
        </div>
      )}

      <Modal open={!!fotoBesar} onClose={() => setFotoBesar(null)} title="Foto ulasan">
        {fotoBesar && <img src={fotoBesar} alt="" className="mx-auto max-h-[70vh] rounded-lg object-contain" />}
      </Modal>
    </PublicShell>
  );
}

/**
 * Satu bagian di blok "Detail Produk" yang di LAYAR HP tertutup dan dibuka
 * dengan diketuk, lalu di layar lebar selalu terbuka.
 *
 * Client: "bagian bawah bisa klik muncul sesuai kebutuhan, tp memanjang ke
 * bawah full tampilan stak" — di HP semua bagian ditumpuk utuh sehingga
 * pembeli harus menggulir jauh melewati isi yang belum tentu dia cari.
 * Di layar lebar ruangnya cukup, jadi isinya tidak disembunyikan.
 */
function BagianLipat({ judul, children }: { judul: string; children: ReactNode }) {
  const [terbuka, setTerbuka] = useState(false);
  return (
    <section className="border-t border-ink-100 pt-3 first:border-t-0 first:pt-0 dark:border-ink-800 lg:border-0 lg:pt-0">
      <button
        type="button"
        onClick={() => setTerbuka((v) => !v)}
        aria-expanded={terbuka}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 text-left lg:min-h-0 lg:cursor-default"
      >
        <h3 className="font-semibold">{judul}</h3>
        <ChevronRight
          size={16}
          className={cn('shrink-0 text-ink-400 transition-transform lg:hidden', terbuka && 'rotate-90')}
        />
      </button>
      <div className={cn('space-y-2 pt-2 lg:block lg:pt-2', !terbuka && 'hidden')}>{children}</div>
    </section>
  );
}

function BarisKetuk({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="grid w-full grid-cols-[92px_minmax(0,1fr)_16px] items-start gap-2 p-4 text-left">
      <span className="text-ink-500">{label}</span>
      <span className="min-w-0 truncate">{children}</span>
      <ChevronRight size={16} className="mt-0.5 text-ink-400" />
    </button>
  );
}

/** Blok putih rata bersudut kecil seperti blok halaman produk Lazada. */
function Blok({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg bg-white dark:bg-ink-900', className)} {...rest} />;
}
