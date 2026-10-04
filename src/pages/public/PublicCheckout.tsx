import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Banknote, Check, ChevronLeft, ChevronDown, Copy, Landmark, MapPin, QrCode, ShoppingBag, Truck, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { PublicShell } from '@/components/layout/PublicShell';
import { formatMoney, cn } from '@/lib/format';
import { Link, useLocation, useNavigate } from '@/lib/router';
import { usePublicCart, type PublicCartLine } from '@/stores/publicCart';
import { submitPublicOrder } from '@/lib/publicOrders';
import { lacakPixel, pixelAktif } from '@/lib/pixelToko';
import { PUBLIC_STORE_ID } from '@/lib/config';
import {
  fetchPublicCatalog,
  fetchPublicFlashSale,
  hargaBerlaku,
  petaFlashAktif,
  type PublicCatalogProduct,
  type PublicFlashSaleItem,
} from '@/lib/publicCatalog';
import { updateCustomerMe, useCustomer } from '@/lib/customerAccount';
import { useBukaMasuk, useTokoPublik } from '@/components/public/KerangkaAuth';
import { biayaKanal, fetchKanalBayar, type KanalBayar } from '@/lib/publicPayments';
import { KolomAlamat, type NilaiAlamat } from '@/components/public/KolomAlamat';
import { alamatLengkap as alamatSatuBaris, provinsiDariKota } from '@/lib/wilayah';

type PayOption = 'cash' | 'transfer' | 'qris';
type Galat = Partial<Record<'name' | 'phone' | 'address' | 'provinsi' | 'kota', string>>;

const KOLOM =
  'h-[44px] w-full rounded-lg border border-ink-200 bg-white px-3 text-sm text-ink-900 outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100';
const KOLOM_GALAT = 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/15';

/**
 * Checkout toko online. Satu halaman tiga blok bernomor (alamat, pengiriman,
 * pembayaran) dengan ringkasan menempel di kanan; di HP ringkasan dilipat di
 * atas dan total + tombol menempel di dasar layar.
 *
 * Metode bayar sengaja berbentuk daftar bergrup, bukan dua kotak besar:
 * saat Tripay aktif nanti, kanal virtual account/e-wallet/retail tinggal
 * ditambahkan sebagai grup baru tanpa mengubah susunan halaman.
 */
export function PublicCheckout() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const isDirect = new URLSearchParams(search).get('mode') === 'direct';

  const cartLines = usePublicCart((s) => s.lines);
  const clearCart = usePublicCart((s) => s.clear);
  const removeLine = usePublicCart((s) => s.remove);
  const buyNow = usePublicCart((s) => s.buyNow);
  const clearBuyNow = usePublicCart((s) => s.clearBuyNow);

  // "Beli Sekarang" checkout hanya satu item ini, TIDAK menyentuh keranjang.
  // Dari keranjang: ?pilih=id1,id2 berarti hanya barang yang dicentang yang dibayar.
  const pilihParam = new URLSearchParams(search).get('pilih');
  const pilihIds = pilihParam ? pilihParam.split(',') : null;
  const lines: PublicCartLine[] =
    isDirect && buyNow ? [buyNow] : pilihIds ? cartLines.filter((l) => pilihIds.includes(l.product_id)) : cartLines;

  const toko = useTokoPublik();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [wilayah, setWilayah] = useState<NilaiAlamat>({ provinsi: '', kota: '', alamat: '' });
  const [payment, setPayment] = useState<PayOption>('cash');
  const [notes, setNotes] = useState('');
  const [galat, setGalat] = useState<Galat>({});
  const [ubahAlamat, setUbahAlamat] = useState(false);
  // Kanal otomatis Tripay; kosong selama kunci Tripay belum dipasang toko.
  const [kanal, setKanal] = useState<{ active: boolean; channels: KanalBayar[] }>({ active: false, channels: [] });
  const [kanalKode, setKanalKode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Keputusan client: belanja memakai akun. Keranjang boleh diisi tanpa masuk,
  // checkout wajib masuk supaya pesanan tercatat di akun pembeli.
  const token = useCustomer((s) => s.token);
  const bukaMasuk = useBukaMasuk();
  const me = useCustomer((s) => s.me);
  const setMe = useCustomer((s) => s.setMe);
  useEffect(() => {
    if (!me) return;
    setName((v) => v || me.name);
    setPhone((v) => v || me.phone || '');
    setWilayah((v) => {
      if (v.alamat || v.provinsi) return v;
      const kota = me.city || '';
      return {
        provinsi: me.province || provinsiDariKota(kota),
        kota,
        alamat: me.address || '',
      };
    });
    // Alamat belum tersimpan di akun: formulirnya langsung terbuka.
    if (!me.address) setUbahAlamat(true);
  }, [me]);

  useEffect(() => {
    void fetchKanalBayar().then((r) => setKanal({ active: r.active, channels: r.channels }));
  }, []);

  // Bilah total menempel di bawah layar HP; kaki halaman di kerangka toko perlu
  // ruang tambahan supaya tidak tertimbun (lihat .ada-bilah-bawah di index.css).
  useEffect(() => {
    document.body.classList.add('ada-bilah-bawah');
    return () => document.body.classList.remove('ada-bilah-bawah');
  }, []);

  const grupKanal = useMemo(() => {
    const peta = new Map<string, KanalBayar[]>();
    for (const k of kanal.channels) {
      const nama = k.group || 'Pembayaran Otomatis';
      peta.set(nama, [...(peta.get(nama) ?? []), k]);
    }
    return [...peta.entries()];
  }, [kanal.channels]);

  // Harga flash sale bisa berakhir atau kehabisan kuota antara keranjang dan
  // checkout. Server menghitung ulang harga saat pesanan dibuat, jadi layar ini
  // harus memakai angka yang sama — kalau tidak, total yang dilihat pembeli
  // berbeda dari yang ditagih.
  const [katalogProduk, setKatalogProduk] = useState<PublicCatalogProduct[]>([]);
  const [petaFlashCheckout, setPetaFlashCheckout] = useState<Map<string, PublicFlashSaleItem>>(new Map());
  useEffect(() => {
    let alive = true;
    fetchPublicCatalog(PUBLIC_STORE_ID)
      .then((d) => alive && setKatalogProduk(d.products ?? []))
      .catch(() => {});
    fetchPublicFlashSale(PUBLIC_STORE_ID)
      .then((d) => alive && setPetaFlashCheckout(petaFlashAktif(d.items)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const hargaKini = (l: { product_id: string; price: number }) =>
    hargaBerlaku(l, katalogProduk, petaFlashCheckout);
  const subtotal = useMemo(
    () => lines.reduce((sum, l) => sum + hargaKini(l) * l.qty, 0),
    [lines, katalogProduk, petaFlashCheckout],
  );
  const totalQty = useMemo(() => lines.reduce((sum, l) => sum + l.qty, 0), [lines]);

  // Pixel iklan: "mulai checkout" sekali per kunjungan, begitu pembeli sudah
  // masuk dan formulirnya tampil. Sebelum masuk, halaman ini hanya ajakan login.
  const barangPixel = () =>
    lines.map((l) => ({ id: l.product_id, nama: l.name, qty: l.qty, harga: hargaKini(l) }));
  const checkoutTerlacak = useRef(false);
  useEffect(() => {
    if (!token || lines.length === 0 || checkoutTerlacak.current) return;
    checkoutTerlacak.current = true;
    lacakPixel({ jenis: 'InitiateCheckout', barang: barangPixel(), nilai: subtotal });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, lines.length]);

  if (lines.length === 0) {
    return (
      <PublicShell>
        <Card className="p-8">
          <EmptyState
            icon={<ShoppingBag size={24} />}
            title="Belum ada yang mau dibeli"
            description="Pilih produk dulu sebelum checkout."
            action={<Button onClick={() => navigate('/toko')}>Lihat Katalog</Button>}
          />
        </Card>
      </PublicShell>
    );
  }

  if (!token) {
    const kembali = `/toko/checkout${search}`;
    return (
      <PublicShell>
        <Card className="mx-auto max-w-md space-y-3 p-6 text-center">
          <h1 className="text-lg font-bold">Masuk untuk checkout</h1>
          <p className="text-sm text-ink-500">
            Pesanan dicatat di akun Anda, jadi statusnya bisa dipantau kapan saja. Isi keranjang tetap tersimpan.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => bukaMasuk('daftar', kembali)}>
              Daftar
            </Button>
            <Button onClick={() => bukaMasuk('masuk', kembali)}>Masuk</Button>
          </div>
        </Card>
      </PublicShell>
    );
  }

  const alamatTeks = alamatSatuBaris({ alamat: wilayah.alamat, kota: wilayah.kota, provinsi: wilayah.provinsi });
  const alamatLengkap = !!name.trim() && !!phone.trim() && !!wilayah.alamat.trim() && !!wilayah.provinsi && !!wilayah.kota;

  /** Memilih metode manual membatalkan kanal otomatis yang sedang dipilih. */
  function pilihManual(p: PayOption) {
    setPayment(p);
    setKanalKode(null);
  }

  function periksa(): boolean {
    const g: Galat = {};
    if (!name.trim()) g.name = 'Nama penerima wajib diisi.';
    if (!phone.trim()) g.phone = 'Nomor HP wajib diisi.';
    if (!wilayah.provinsi) g.provinsi = 'Pilih provinsi.';
    if (!wilayah.kota) g.kota = 'Pilih kota/kabupaten.';
    if (!wilayah.alamat.trim()) g.address = 'Alamat pengiriman wajib diisi.';
    setGalat(g);
    if (Object.keys(g).length) {
      setUbahAlamat(true);
      // Di HP pesan galat sering jatuh persis di balik bilah total yang menempel,
      // jadi galat pertama dibawa ke tengah layar setelah dirender.
      requestAnimationFrame(() => {
        document.querySelector('[data-galat]')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    }
    return Object.keys(g).length === 0;
  }

  async function submit() {
    if (!token) return;
    if (!periksa()) return;

    setBusy(true);
    const { data, error } = await submitPublicOrder(
      {
        store_id: PUBLIC_STORE_ID,
        customer_name: name.trim(),
        customer_phone: phone.trim(),
        delivery_address: alamatTeks,
        delivery_province: wilayah.provinsi,
        delivery_city: wilayah.kota,
        payment_method: payment,
        payment_channel: kanalKode ?? undefined,
        notes: notes.trim() || undefined,
        items: lines.map((l) => ({ product_id: l.product_id, qty: l.qty })),
      },
      token,
    );
    setBusy(false);

    if (error || !data) {
      toast.error(error || 'Gagal mengirim pesanan.');
      return;
    }

    // Pixel iklan: pembelian dicatat di sini, sebelum keranjang dikosongkan,
    // karena halaman "pesanan terkirim" hanya tahu nomor pesanannya. Nilainya
    // subtotal barang; ongkir baru dihitung toko sesudahnya.
    lacakPixel({
      jenis: 'Purchase',
      barang: barangPixel(),
      nilai: subtotal,
      idPesanan: data.order_id,
      nomorPesanan: data.order_number,
    });

    // Alamat pertama disimpan ke akun supaya checkout berikutnya terisi otomatis.
    if (me && !me.address) {
      void updateCustomerMe(token, {
        name: me.name,
        phone: me.phone || phone.trim(),
        address: wilayah.alamat.trim(),
        province: wilayah.provinsi,
        city: wilayah.kota,
      }).then(({ data: baru }) => baru && setMe(baru));
    }
    if (isDirect) clearBuyNow();
    else if (pilihIds) pilihIds.forEach(removeLine);
    else clearCart();
    // Kanal otomatis: pembeli dibawa ke halaman bayar Tripay.
    if (data.payment?.checkout_url) {
      // Beri waktu pixel mengirim pembelian sebelum browser pindah ke Tripay.
      if (pixelAktif()) await new Promise((selesai) => setTimeout(selesai, 600));
      window.location.href = data.payment.checkout_url;
      return;
    }
    if (data.payment?.error) toast.warning(data.payment.error);
    navigate(`/toko/selesai?order=${encodeURIComponent(data.order_number)}&bayar=${kanalKode ?? payment}`);
  }

  const ringkasanIsi = (
    <>
      <ul className="divide-y divide-ink-100 dark:divide-ink-800">
        {lines.map((line) => (
          <li key={line.product_id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-white ring-1 ring-ink-100 dark:bg-ink-800 dark:ring-ink-700">
              {line.image_url ? (
                <img src={line.image_url} alt="" className="h-full w-full object-contain" />
              ) : (
                <div className="grid h-full place-items-center text-ink-300 dark:text-ink-600">
                  <ShoppingBag size={16} />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="line-clamp-2 text-sm leading-5">{line.name}</div>
              <div className="mt-0.5 text-xs text-ink-500">
                {line.qty} × {formatMoney(hargaKini(line))}
              </div>
            </div>
            <div className="shrink-0 text-sm font-semibold tabular-nums">{formatMoney(hargaKini(line) * line.qty)}</div>
          </li>
        ))}
      </ul>

      <div className="mt-3 space-y-1.5 border-t border-ink-100 pt-3 text-sm dark:border-ink-800">
        <div className="flex justify-between text-ink-600 dark:text-ink-300">
          <span>Subtotal ({totalQty} barang)</span>
          <span className="tabular-nums">{formatMoney(subtotal)}</span>
        </div>
        <div className="flex justify-between text-ink-600 dark:text-ink-300">
          <span>Ongkir</span>
          <span className="text-xs">Dihitung toko</span>
        </div>
        <div className="flex items-baseline justify-between border-t border-ink-100 pt-2 dark:border-ink-800">
          <span className="text-sm font-semibold">Total Sementara</span>
          <span className="text-lg font-bold tabular-nums">{formatMoney(subtotal)}</span>
        </div>
        <p className="text-xs text-ink-500">Total belum termasuk ongkir. Angka final dikonfirmasi toko.</p>
      </div>
    </>
  );

  return (
    <PublicShell>
      <div className="space-y-4 pb-24 lg:pb-0">
        <Link
          to={isDirect ? '/toko' : '/toko/keranjang'}
          className="inline-flex items-center gap-1 text-sm font-medium text-ink-500 transition-colors duration-150 hover:text-brand-600"
        >
          <ChevronLeft size={16} /> {isDirect ? 'Kembali ke katalog' : 'Kembali ke keranjang'}
        </Link>

        <h1 className="text-xl font-bold">Checkout</h1>

        {/* HP: ringkasan dilipat di atas supaya isi pesanan bisa diperiksa tanpa menggulir jauh. */}
        <details className="group rounded-lg bg-white p-4 shadow-card lg:hidden dark:bg-ink-900">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
            <span className="text-sm font-semibold">
              Ringkasan Pesanan
              <span className="ml-2 font-normal text-ink-500">
                {totalQty} barang · {formatMoney(subtotal)}
              </span>
            </span>
            <ChevronDown size={18} className="shrink-0 text-ink-400 transition-transform duration-200 group-open:rotate-180" />
          </summary>
          <div className="mt-3">{ringkasanIsi}</div>
        </details>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
          <div className="space-y-4">
            {/* ---------- 1. Alamat pengiriman ---------- */}
            <Blok nomor={1} judul="Alamat Pengiriman">
              {!ubahAlamat && alamatLengkap ? (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm">
                      <span className="font-semibold">{name}</span>
                      <span className="mx-1.5 text-ink-300">·</span>
                      <span className="text-ink-600 dark:text-ink-300">{phone}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-ink-500">{alamatTeks}</p>
                    {notes.trim() && <p className="mt-1 text-xs text-ink-500">Catatan: {notes}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => setUbahAlamat(true)}
                    className="shrink-0 text-sm font-semibold text-brand-600 transition-colors duration-150 hover:text-brand-700"
                  >
                    Ubah
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {!alamatLengkap && !wilayah.alamat.trim() && (
                    <div className="flex items-start gap-2 rounded-lg border border-dashed border-ink-200 bg-ink-50 p-3 text-sm text-ink-600 dark:border-ink-700 dark:bg-ink-800/50 dark:text-ink-300">
                      <MapPin size={16} className="mt-0.5 shrink-0 text-ink-400" />
                      Anda belum menyimpan alamat. Isi sekali di sini, checkout berikutnya terisi otomatis.
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Kolom label="Nama Penerima" id="nama-penerima" galat={galat.name}>
                      <input
                        id="nama-penerima"
                        name="customer_name"
                        aria-label="Nama Penerima"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className={cn(KOLOM, galat.name && KOLOM_GALAT)}
                      />
                    </Kolom>
                    <Kolom label="Nomor HP / WhatsApp" id="hp-penerima" galat={galat.phone} bantuan="Dipakai toko untuk konfirmasi pesanan dan pengiriman.">
                      <input
                        id="hp-penerima"
                        name="customer_phone"
                        aria-label="Nomor HP / WhatsApp"
                        inputMode="tel"
                        placeholder="08xxxxxxxxxx"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className={cn(KOLOM, galat.phone && KOLOM_GALAT)}
                      />
                    </Kolom>
                  </div>
                  <KolomAlamat
                    nilai={wilayah}
                    onChange={setWilayah}
                    kelasKolom={KOLOM}
                    kelasGalat={KOLOM_GALAT}
                    galat={{ provinsi: galat.provinsi, kota: galat.kota, alamat: galat.address }}
                  />
                  <Kolom label="Catatan (opsional)" id="catatan">
                    <input
                      id="catatan"
                      name="notes"
                      aria-label="Catatan (opsional)"
                      placeholder="Contoh: warna, ukuran, titip pesan ke kurir"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className={KOLOM}
                    />
                  </Kolom>
                  {alamatLengkap && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => setUbahAlamat(false)}
                        className="inline-flex h-9 items-center rounded-lg bg-ink-100 px-4 text-sm font-semibold text-ink-700 transition-colors duration-150 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-200"
                      >
                        Simpan Alamat
                      </button>
                    </div>
                  )}
                </div>
              )}
            </Blok>

            {/* ---------- 2. Pengiriman ---------- */}
            <Blok nomor={2} judul="Pengiriman">
              <div className="flex items-start gap-3 rounded-lg border border-brand-100 bg-brand-50/60 p-4 dark:border-brand-500/20 dark:bg-brand-950/20">
                <Truck size={18} className="mt-0.5 shrink-0 text-brand-600" />
                <div className="text-sm">
                  <div className="font-semibold">Ongkir dihitung oleh toko</div>
                  <p className="mt-1 text-ink-600 dark:text-ink-300">
                    Biaya kirim menyesuaikan alamat dan berat paket. Tim kami menghitungnya lalu mengabari Anda lewat
                    WhatsApp sebelum pembayaran.
                  </p>
                </div>
              </div>
            </Blok>

            {/* ---------- 3. Pembayaran ---------- */}
            <Blok nomor={3} judul="Metode Pembayaran" padat>
              <div className="divide-y divide-ink-100 dark:divide-ink-800">
                <GrupBayar judul="Bayar di tempat">
                  <BarisBayar
                    aktif={payment === 'cash' && !kanalKode}
                    onClick={() => pilihManual('cash')}
                    ikon={<Banknote size={18} />}
                    nama="Bayar Tunai (COD)"
                    catatan="Bayar ke kurir saat barang diterima"
                    biaya="Tanpa biaya"
                  >
                    Siapkan uang pas saat kurir tiba. Nominal akhir termasuk ongkir dikabari toko lewat WhatsApp.
                  </BarisBayar>
                </GrupBayar>

                <GrupBayar judul="Transfer & QRIS">
                  <BarisBayar
                    aktif={payment === 'transfer' && !kanalKode}
                    onClick={() => pilihManual('transfer')}
                    ikon={<Landmark size={18} />}
                    nama="Transfer Bank"
                    catatan="Transfer manual, dicek admin"
                  >
                    {toko?.bank_account_number ? (
                      <Rekening
                        bank={toko.bank_name || 'Bank'}
                        nomor={toko.bank_account_number}
                        atasNama={toko.bank_account_name || toko.name}
                      />
                    ) : (
                      'Nomor rekening toko dikirim admin lewat WhatsApp setelah pesanan dibuat.'
                    )}
                  </BarisBayar>
                  <BarisBayar
                    aktif={payment === 'qris' && !kanalKode}
                    onClick={() => pilihManual('qris')}
                    ikon={<QrCode size={18} />}
                    nama="QRIS"
                    catatan="Scan dari aplikasi bank atau e-wallet"
                  >
                    {toko?.qris_image_url ? (
                      <div className="flex items-center gap-3">
                        <img
                          src={toko.qris_image_url}
                          alt="QRIS toko"
                          className="h-24 w-24 rounded-lg bg-white object-contain ring-1 ring-ink-100"
                        />
                        <span>Pindai kode ini setelah pesanan dibuat, lalu kirim bukti bayar ke admin.</span>
                      </div>
                    ) : (
                      'Kode QR dikirim admin lewat WhatsApp setelah pesanan dibuat.'
                    )}
                  </BarisBayar>
                </GrupBayar>

                {grupKanal.map(([judulGrup, daftar]) => (
                  <GrupBayar key={judulGrup} judul={judulGrup}>
                    {daftar.map((k) => {
                      const biaya = biayaKanal(k, subtotal);
                      return (
                        <BarisBayar
                          key={k.code}
                          aktif={kanalKode === k.code}
                          onClick={() => setKanalKode(k.code)}
                          ikon={
                            k.icon_url ? (
                              <img src={k.icon_url} alt="" className="h-5 w-9 object-contain" />
                            ) : (
                              <Wallet size={18} />
                            )
                          }
                          nama={k.name}
                          catatan="Bayar otomatis, langsung terverifikasi"
                          biaya={biaya ? `+ ${formatMoney(biaya)}` : 'Tanpa biaya'}
                        >
                          Setelah menekan Buat Pesanan, Anda dibawa ke halaman pembayaran {k.name}. Pesanan tetap
                          menunggu konfirmasi ongkir dari toko.
                        </BarisBayar>
                      );
                    })}
                  </GrupBayar>
                ))}
              </div>
            </Blok>
          </div>

          {/* ---------- Ringkasan (desktop) ---------- */}
          <div className="hidden lg:sticky lg:top-24 lg:block">
            <Card className="p-4">
              <div className="mb-3 text-sm font-semibold">Ringkasan Pesanan</div>
              {ringkasanIsi}
              <button
                type="button"
                onClick={submit}
                disabled={busy}
                className="mt-4 h-12 w-full rounded-lg bg-brand-500 text-base font-semibold text-white shadow-card transition-colors duration-150 hover:bg-brand-600 active:bg-brand-700 disabled:cursor-not-allowed disabled:bg-ink-200 disabled:text-ink-400"
              >
                {busy ? 'Mengirim…' : 'Buat Pesanan'}
              </button>
              {!alamatLengkap && (
                <p className="mt-2 text-center text-xs font-medium text-amber-600">Lengkapi alamat pengiriman dulu.</p>
              )}
              <p className="mt-2 text-center text-[11px] leading-relaxed text-ink-400">
                Pesanan belum otomatis lunas. Toko mengonfirmasi lewat WhatsApp sebelum pesanan diproses dan dikirim.
              </p>
            </Card>
          </div>
        </div>
      </div>

      {/* ---------- Total + tombol menempel (HP) ---------- */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-ink-100 bg-white px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 shadow-[0_-4px_16px_rgba(15,18,34,0.08)] lg:hidden dark:border-ink-800 dark:bg-ink-900">
        <div className="min-w-0">
          <div className="text-[11px] text-ink-500">Total sementara</div>
          <div className="text-lg font-bold leading-tight tabular-nums">{formatMoney(subtotal)}</div>
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="ml-auto h-12 min-w-[160px] rounded-lg bg-brand-500 px-5 text-base font-semibold text-white transition-colors duration-150 hover:bg-brand-600 active:bg-brand-700 disabled:cursor-not-allowed disabled:bg-ink-200 disabled:text-ink-400"
        >
          {busy ? 'Mengirim…' : 'Buat Pesanan'}
        </button>
      </div>
    </PublicShell>
  );
}

function Blok({ nomor, judul, padat = false, children }: { nomor: number; judul: string; padat?: boolean; children: ReactNode }) {
  return (
    <section className="rounded-lg bg-white shadow-card dark:bg-ink-900">
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand-700 dark:bg-brand-950/40 dark:text-brand-200">
          {nomor}
        </span>
        <h2 className="text-sm font-semibold">{judul}</h2>
      </div>
      <div className={cn(padat ? 'pb-1' : 'px-4 pb-4')}>{children}</div>
    </section>
  );
}

function Kolom({
  label,
  id,
  galat,
  bantuan,
  children,
}: {
  label: string;
  id: string;
  galat?: string;
  bantuan?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-ink-700 dark:text-ink-300">
        {label}
      </label>
      {children}
      {galat ? (
        <p data-galat className="mt-1 text-xs text-rose-600">{galat}</p>
      ) : (
        bantuan && <p className="mt-1 text-xs text-ink-500">{bantuan}</p>
      )}
    </div>
  );
}

function GrupBayar({ judul, children }: { judul: string; children: ReactNode }) {
  return (
    <div>
      <div className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-ink-400">{judul}</div>
      <div className="divide-y divide-ink-100 dark:divide-ink-800">{children}</div>
    </div>
  );
}

/**
 * Satu baris metode bayar: ikon, nama, catatan, biaya, lalu radio. Penjelasan
 * metode muncul tepat di bawah barisnya saat dipilih.
 */
function BarisBayar({
  aktif,
  onClick,
  ikon,
  nama,
  catatan,
  biaya,
  children,
}: {
  aktif: boolean;
  onClick: () => void;
  ikon: ReactNode;
  nama: string;
  catatan: string;
  biaya?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn(aktif && 'bg-brand-50/50 dark:bg-brand-950/20')}>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={aktif}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors duration-150 hover:bg-ink-50 dark:hover:bg-ink-800/60"
      >
        <span
          className={cn(
            'grid h-9 w-12 shrink-0 place-items-center rounded border bg-white',
            aktif ? 'border-brand-300 text-brand-600' : 'border-ink-100 text-ink-500 dark:border-ink-700 dark:bg-ink-800',
          )}
        >
          {ikon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{nama}</span>
          <span className="block text-xs text-ink-500">{catatan}</span>
        </span>
        {biaya && (
          <span className={cn('shrink-0 text-xs', biaya.startsWith('Tanpa') ? 'text-emerald-600' : 'text-ink-500')}>{biaya}</span>
        )}
        <span
          className={cn(
            'grid h-5 w-5 shrink-0 place-items-center rounded-full border-2',
            aktif ? 'border-brand-500 bg-brand-500 text-white' : 'border-ink-300 dark:border-ink-600',
          )}
        >
          {aktif && <Check size={12} strokeWidth={3} />}
        </span>
      </button>
      {aktif && (
        <div className="border-t border-brand-100 px-4 py-3 text-sm text-ink-600 dark:border-brand-500/20 dark:text-ink-300">
          {children}
        </div>
      )}
    </div>
  );
}

function Rekening({ bank, nomor, atasNama }: { bank: string; nomor: string; atasNama: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="font-semibold uppercase">{bank}</span>
      <span className="font-mono tracking-wide text-ink-800 dark:text-ink-100">{nomor}</span>
      <span className="text-ink-500">a.n. {atasNama}</span>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard
            .writeText(nomor)
            .then(() => toast.success('Nomor rekening disalin.'))
            .catch(() => toast.error('Nomor rekening gagal disalin.'));
        }}
        className="inline-flex items-center gap-1 rounded-md border border-ink-200 px-2 py-1 text-xs font-medium text-ink-700 transition-colors duration-150 hover:border-brand-400 hover:text-brand-600 dark:border-ink-700 dark:text-ink-200"
      >
        <Copy size={12} /> Salin
      </button>
    </div>
  );
}
