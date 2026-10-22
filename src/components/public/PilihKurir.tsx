// Pilihan kurir di checkout (spec 0002, AC-10): daftar dari KiriminAja, urut
// termurah, satu wajib dipilih. Baris setinggi 44px supaya mudah disentuh di HP.
import { Check, Truck } from 'lucide-react';
import { cn, formatMoney } from '@/lib/format';
import { labelOpsi, type OpsiOngkir } from '@/lib/pengirimanToko';

export const kunciOpsi = (o: Pick<OpsiOngkir, 'courier' | 'service'>) => `${o.courier}:${o.service}`;

export function PilihKurir({
  siap,
  memuat,
  galat,
  opsi,
  terpilih,
  onPilih,
  onUlang,
  galatPilih,
}: {
  /** Kecamatan dan kelurahan tujuan sudah dipilih. */
  siap: boolean;
  memuat: boolean;
  galat: string | null;
  opsi: OpsiOngkir[];
  terpilih: string | null;
  onPilih: (o: OpsiOngkir) => void;
  onUlang: () => void;
  galatPilih?: string;
}) {
  return (
    <div>
      <IsiKurir siap={siap} memuat={memuat} galat={galat} opsi={opsi} terpilih={terpilih} onPilih={onPilih} onUlang={onUlang} />
      {galatPilih && <p data-galat className="mt-1.5 text-xs text-rose-600">{galatPilih}</p>}
    </div>
  );
}

function IsiKurir({ siap, memuat, galat, opsi, terpilih, onPilih, onUlang }: {
  siap: boolean; memuat: boolean; galat: string | null; opsi: OpsiOngkir[]; terpilih: string | null;
  onPilih: (o: OpsiOngkir) => void; onUlang: () => void;
}) {
  if (!siap) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-dashed border-ink-200 bg-ink-50 p-4 text-sm text-ink-600 dark:border-ink-700 dark:bg-ink-800/50 dark:text-ink-300">
        <Truck size={18} className="mt-0.5 shrink-0 text-ink-400" />
        Pilih kecamatan dan kelurahan tujuan dulu, lalu pilihan kurir dan ongkirnya muncul di sini.
      </div>
    );
  }
  if (memuat) return <p role="status" className="text-sm text-ink-500">Menghitung ongkir…</p>;
  if (galat) {
    return (
      <div role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
        {galat}{' '}
        <button type="button" onClick={onUlang} className="font-semibold underline">Coba lagi</button>
      </div>
    );
  }
  if (!opsi.length) {
    return (
      <div role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
        Belum ada kurir yang melayani alamat ini. Periksa kecamatan dan kelurahan, atau hubungi toko lewat WhatsApp.
      </div>
    );
  }
  return (
    <div data-pilih-kurir>
      <div role="radiogroup" aria-label="Pilihan kurir" className="divide-y divide-ink-100 overflow-hidden rounded-lg border border-ink-100 dark:divide-ink-800 dark:border-ink-800">
        {opsi.map((o) => {
          const aktif = terpilih === kunciOpsi(o);
          return (
            <button
              key={kunciOpsi(o)}
              type="button"
              role="radio"
              aria-checked={aktif}
              onClick={() => onPilih(o)}
              className={cn(
                'flex min-h-[44px] w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-ink-50 dark:hover:bg-ink-800/60',
                aktif && 'bg-brand-50/60 dark:bg-brand-950/20',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium [overflow-wrap:anywhere]">{labelOpsi(o)}</span>
              </span>
              <span className="shrink-0 text-sm font-semibold tabular-nums">{formatMoney(o.ongkir)}</span>
              <span
                className={cn(
                  'grid h-5 w-5 shrink-0 place-items-center rounded-full border-2',
                  aktif ? 'border-brand-500 bg-brand-500 text-white' : 'border-ink-300 dark:border-ink-600',
                )}
              >
                {aktif && <Check size={12} strokeWidth={3} />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
