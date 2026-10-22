import { useState, type FormEvent, type MouseEvent } from 'react';
import { Loader2, TicketPercent, X } from 'lucide-react';
import { cn, formatMoney } from '@/lib/format';
import { cekVoucher, diskonVoucher, type VoucherToko } from '@/lib/voucherToko';

/**
 * Kolom voucher di blok Metode Pembayaran checkout. Client menanyakan cara
 * pembeli memakai voucher yang dibuat di menu Promo; sebelumnya tidak ada
 * tempat untuk mengetik kodenya.
 */
export function KolomVoucher({
  storeId,
  voucher,
  diskon,
  subtotal,
  onPakai,
  onHapus,
  dikunci,
}: {
  storeId: string;
  voucher: VoucherToko | null;
  diskon: number;
  /** Subtotal barang; voucher yang menghabiskan seluruh subtotal ditolak di sini. */
  subtotal: number;
  onPakai: (v: VoucherToko) => void;
  onHapus: () => void;
  dikunci: boolean;
}) {
  const [kode, setKode] = useState('');
  const [galat, setGalat] = useState<string | null>(null);
  const [memeriksa, setMemeriksa] = useState(false);

  async function pakai(e: FormEvent) {
    e.preventDefault();
    const bersih = kode.trim();
    if (!bersih || memeriksa) return;
    setMemeriksa(true);
    const { data, error } = await cekVoucher(storeId, bersih);
    setMemeriksa(false);
    if (!data) {
      setGalat(error);
      return;
    }
    // Pembayaran Rp0 tidak bisa ditagihkan; server juga menolaknya. Ditolak di
    // sini supaya pembeli tidak melihat total Rp0 lalu kehilangan vouchernya.
    if (subtotal > 0 && diskonVoucher(data, subtotal) >= subtotal) {
      setGalat('Voucher ini membuat total pesanan Rp0. Hubungi toko untuk memakai voucher ini.');
      return;
    }
    setGalat(null);
    setKode('');
    onPakai(data);
    // Fokus pindah ke tombol hapus voucher supaya pengguna keyboard tidak jatuh ke awal halaman.
    requestAnimationFrame(() => document.getElementById('hapus-voucher')?.focus());
  }

  function hapus(e: MouseEvent<HTMLButtonElement>) {
    onHapus();
    // Hanya saat dipicu keyboard (detail 0): di HP memfokuskan kolom akan memunculkan papan ketik.
    if (e.detail === 0) requestAnimationFrame(() => document.getElementById('kode-voucher')?.focus());
  }

  if (voucher) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-900 dark:bg-emerald-950/40" data-voucher-terpakai>
        <TicketPercent size={18} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
        {/* Kode dan nama promo bisa panjang tanpa spasi; dipatah per huruf supaya
            tidak melebarkan halaman di HP. Nama dibatasi dua baris. */}
        <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          <div className="line-clamp-2 text-sm">
            <span className="font-mono font-semibold">{voucher.code}</span>
            <span className="text-ink-600 dark:text-ink-300"> · {voucher.name}</span>
          </div>
          <div className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Hemat {formatMoney(diskon)}</div>
        </div>
        <button
          id="hapus-voucher"
          type="button"
          onClick={hapus}
          disabled={dikunci}
          aria-label={`Hapus voucher ${voucher.code}`}
          className="grid h-[44px] w-[44px] shrink-0 place-items-center rounded-full text-ink-500 transition-colors duration-150 hover:bg-white hover:text-rose-600 disabled:opacity-50 dark:hover:bg-ink-900"
        >
          <X size={16} />
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void pakai(e)} noValidate data-kolom-voucher>
      <label htmlFor="kode-voucher" className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-ink-700 dark:text-ink-200">
        <TicketPercent size={15} className="text-brand-600" /> Punya voucher?
      </label>
      <div className="flex gap-2">
        <input
          id="kode-voucher"
          value={kode}
          onChange={(e) => {
            setKode(e.target.value.toUpperCase());
            setGalat(null);
          }}
          placeholder="Masukkan kode voucher"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={60}
          aria-invalid={galat ? true : undefined}
          aria-describedby={galat ? 'galat-voucher' : undefined}
          className={cn(
            'h-[44px] min-w-0 flex-1 rounded-lg border bg-white px-3 font-mono text-sm uppercase tracking-wide outline-none transition-colors duration-150 placeholder:font-sans placeholder:normal-case placeholder:tracking-normal focus:border-brand-500 dark:bg-ink-900',
            galat ? 'border-rose-400' : 'border-ink-200 dark:border-ink-700',
          )}
        />
        <button
          type="submit"
          disabled={!kode.trim() || memeriksa || dikunci}
          className="inline-flex h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-lg border border-brand-500 px-4 text-sm font-semibold text-brand-600 transition-colors duration-150 hover:bg-brand-50 active:bg-brand-100 disabled:cursor-not-allowed disabled:border-ink-200 disabled:text-ink-400 dark:hover:bg-brand-950/40"
        >
          {memeriksa ? <Loader2 size={15} className="animate-spin" /> : null}
          Pakai
        </button>
      </div>
      {galat && (
        <p id="galat-voucher" role="alert" className="mt-1.5 text-xs text-rose-600">
          {galat}
        </p>
      )}
    </form>
  );
}
