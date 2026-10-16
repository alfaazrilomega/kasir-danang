import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/format';
import { urutNamaSku } from '@/lib/sortProducts';
import type { Product } from '@/types';

/**
 * Pemilih produk yang bisa diketik: cari lewat nama atau SKU, misalnya "gear"
 * langsung menampilkan semua produk gear. Menggantikan <select> biasa yang
 * tidak bisa dicari — dengan ratusan SKU, menggulir dropdown untuk mencari
 * satu produk tidak masuk akal.
 *
 * `excludeIds` menyembunyikan produk yang sudah dipilih di baris lain, supaya
 * produk yang sama tidak masuk dua kali (butir 1.6).
 */
export function ProductPicker({
  products,
  value,
  onChange,
  excludeIds,
  placeholder = 'Cari nama atau SKU...',
  emptyLabel,
  showStock = false,
  className,
}: {
  products: Product[];
  /** id produk terpilih; string kosong berarti belum/tidak memilih produk. */
  value: string;
  onChange: (id: string) => void;
  excludeIds?: Iterable<string>;
  placeholder?: string;
  /** Label pilihan "tanpa produk" (mis. item manual). Tanpa ini pilihan itu tidak ditawarkan. */
  emptyLabel?: string;
  showStock?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  const selected = products.find((p) => p.id === value) ?? null;
  const selectedLabel = selected ? `${selected.name}${selected.sku ? ` (${selected.sku})` : ''}` : '';

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const exclude = useMemo(() => new Set(excludeIds ?? []), [excludeIds]);

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    return products
      .filter((p) => p.id === value || !exclude.has(p.id))
      .filter(
        (p) =>
          !t ||
          p.name.toLowerCase().includes(t) ||
          (p.sku ?? '').toLowerCase().includes(t) ||
          (p.barcode ?? '').toLowerCase().includes(t),
      )
      .sort(urutNamaSku)
      .slice(0, 60);
  }, [products, q, exclude, value]);

  function pick(id: string) {
    onChange(id);
    setOpen(false);
    setQ('');
  }

  return (
    <div ref={boxRef} className={cn('relative', className)}>
      <div className="input flex items-center gap-2">
        <Search size={14} className="shrink-0 text-ink-400" />
        <input
          className="w-full min-w-0 bg-transparent focus:outline-none"
          placeholder={selectedLabel || placeholder}
          value={open ? q : selectedLabel}
          onFocus={() => {
            setOpen(true);
            setQ('');
          }}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
            if (e.key === 'Enter' && results[0]) {
              e.preventDefault();
              pick(results[0].id);
            }
          }}
        />
      </div>

      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-ink-200 bg-white shadow-lg dark:border-ink-700 dark:bg-ink-900">
          {emptyLabel && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick('')}
              className="block w-full border-b border-ink-100 px-3 py-2 text-left text-xs text-ink-500 hover:bg-ink-50 dark:border-ink-800 dark:hover:bg-ink-800"
            >
              {emptyLabel}
            </button>
          )}
          {results.length === 0 ? (
            <div className="px-3 py-3 text-xs text-ink-500">Tidak ada produk yang cocok.</div>
          ) : (
            results.map((p) => (
              <button
                type="button"
                key={p.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(p.id)}
                className={cn(
                  'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-brand-50 dark:hover:bg-brand-950/30',
                  p.id === value && 'bg-brand-50 dark:bg-brand-950/30',
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="block truncate text-[11px] text-ink-500">{p.sku || 'Tanpa SKU'}</span>
                </span>
                {showStock && p.track_stock && (
                  <span className="shrink-0 text-[11px] text-ink-500">stok {Number(p.stock_qty ?? 0)}</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
