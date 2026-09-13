import { useEffect, useMemo, useState } from 'react';
import { Printer, Search } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { cn, formatMoney, formatNumber } from '@/lib/format';
import { urutNamaSku } from '@/lib/sortProducts';
import { UKURAN_LABEL, kodeLabel, printLabels, svgBarcode, type UkuranLabel } from '@/lib/labels';
import type { Product } from '@/types';

/**
 * Pilih produk lalu cetak label barcodenya untuk ditempel di barang.
 * Produk tanpa barcode dan tanpa SKU tidak bisa dilabeli (tidak ada kode
 * yang bisa dipindai), jadi ditampilkan tapi tidak bisa dicentang.
 */
export function BarcodeLabelModal({
  open,
  onClose,
  products,
  initialIds,
  currency,
}: {
  open: boolean;
  onClose: () => void;
  products: Product[];
  initialIds: string[];
  currency?: string;
}) {
  const [q, setQ] = useState('');
  const [pilih, setPilih] = useState<Record<string, number>>({});
  const [ukuran, setUkuran] = useState<UkuranLabel>('50x30');
  const [tampilHarga, setTampilHarga] = useState(true);

  useEffect(() => {
    if (!open) return;
    setQ('');
    setPilih(Object.fromEntries(initialIds.map((id) => [id, 1])));
  }, [open, initialIds]);

  const daftar = useMemo(() => {
    const t = q.trim().toLowerCase();
    return products
      .filter(
        (p) =>
          !t ||
          p.name.toLowerCase().includes(t) ||
          (p.sku ?? '').toLowerCase().includes(t) ||
          (p.barcode ?? '').toLowerCase().includes(t),
      )
      .sort(urutNamaSku)
      .slice(0, 200);
  }, [products, q]);

  const terpilih = useMemo(
    () => products.filter((p) => pilih[p.id]).sort(urutNamaSku),
    [products, pilih],
  );
  const jumlahLabel = terpilih.reduce((s, p) => s + (pilih[p.id] ?? 0), 0);
  const contoh = terpilih[0] ?? null;
  const svgContoh = contoh ? svgBarcode(kodeLabel(contoh)) : null;

  function ubah(id: string, copies: number | null) {
    setPilih((prev) => {
      const next = { ...prev };
      if (copies == null) delete next[id];
      else next[id] = copies;
      return next;
    });
  }

  function pilihSemuaHasil() {
    setPilih((prev) => {
      const next = { ...prev };
      for (const p of daftar) if (kodeLabel(p) && !next[p.id]) next[p.id] = 1;
      return next;
    });
  }

  function cetak() {
    printLabels(
      terpilih.map((p) => ({
        name: p.name,
        code: kodeLabel(p),
        price: tampilHarga ? Number(p.base_price) : null,
        copies: pilih[p.id] ?? 1,
      })),
      ukuran,
      currency,
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="Cetak Label Barcode" size="lg">
      <div className="space-y-4 text-sm">
        <p className="text-xs text-ink-500">
          Kode di label adalah barcode produk, atau SKU bila barcode kosong. Label bisa langsung
          dipindai di kasir.
        </p>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
          <div className="space-y-2">
            <div className="flex gap-2">
              <div className="input flex flex-1 items-center gap-2">
                <Search size={14} className="shrink-0 text-ink-400" />
                <input
                  className="w-full min-w-0 bg-transparent focus:outline-none"
                  placeholder="Cari nama, SKU, atau barcode..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
              <Button variant="secondary" size="sm" onClick={pilihSemuaHasil}>
                Pilih semua
              </Button>
            </div>
            <div className="max-h-80 overflow-y-auto rounded-xl border border-ink-100 dark:border-ink-800">
              {daftar.length === 0 ? (
                <p className="p-4 text-center text-xs text-ink-500">Tidak ada produk yang cocok.</p>
              ) : (
                daftar.map((p) => {
                  const kode = kodeLabel(p);
                  const copies = pilih[p.id];
                  return (
                    <label
                      key={p.id}
                      className={cn(
                        'flex items-center gap-3 border-b border-ink-100 px-3 py-2 last:border-0 dark:border-ink-800',
                        kode ? 'cursor-pointer hover:bg-ink-50 dark:hover:bg-ink-900' : 'opacity-50',
                      )}
                    >
                      <input
                        type="checkbox"
                        aria-label={`Label ${p.name}`}
                        disabled={!kode}
                        checked={!!copies}
                        onChange={(e) => ubah(p.id, e.target.checked ? 1 : null)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{p.name}</span>
                        <span className="block truncate font-mono text-[11px] text-ink-500">
                          {kode || 'Isi SKU atau barcode dulu'}
                        </span>
                      </span>
                      {copies ? (
                        <input
                          type="number"
                          min={1}
                          aria-label={`Jumlah label ${p.name}`}
                          className="input !w-16 !py-1 text-right"
                          value={copies}
                          onClick={(e) => e.preventDefault()}
                          onChange={(e) => ubah(p.id, Math.max(1, Number(e.target.value) || 1))}
                        />
                      ) : null}
                    </label>
                  );
                })
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <div className="mb-1 text-xs font-semibold text-ink-500">Ukuran</div>
              <div className="space-y-1.5">
                {UKURAN_LABEL.map((u) => (
                  <label
                    key={u.value}
                    className={cn(
                      'flex cursor-pointer items-start gap-2 rounded-xl border p-2',
                      ukuran === u.value
                        ? 'border-brand-300 bg-brand-50 dark:border-brand-700 dark:bg-brand-950/30'
                        : 'border-ink-100 dark:border-ink-800',
                    )}
                  >
                    <input
                      type="radio"
                      name="ukuran-label"
                      className="mt-0.5"
                      checked={ukuran === u.value}
                      onChange={() => setUkuran(u.value)}
                    />
                    <span>
                      <span className="block text-xs font-medium">{u.label}</span>
                      <span className="block text-[11px] text-ink-500">{u.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={tampilHarga} onChange={(e) => setTampilHarga(e.target.checked)} />
              Tampilkan harga
            </label>
            <div>
              <div className="mb-1 text-xs font-semibold text-ink-500">Pratinjau</div>
              <div className="rounded-xl border border-dashed border-ink-200 bg-white p-2 text-black dark:border-ink-700">
                {contoh && svgContoh ? (
                  <div className="space-y-1">
                    <div className="line-clamp-2 text-[11px] font-bold leading-tight">{contoh.name}</div>
                    <div className="h-14 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svgContoh }} />
                    {tampilHarga && (
                      <div className="text-right text-[11px] font-bold">
                        {formatMoney(Number(contoh.base_price), currency)}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="py-6 text-center text-[11px] text-ink-500">Centang produk untuk melihat contoh.</p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-ink-100 pt-3 dark:border-ink-800">
          <span className="text-xs text-ink-500">
            {formatNumber(terpilih.length)} produk · {formatNumber(jumlahLabel)} label
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Batal
            </Button>
            <Button onClick={cetak} disabled={!terpilih.length}>
              <Printer size={14} /> Cetak Label
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
