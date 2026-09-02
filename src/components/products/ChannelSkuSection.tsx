// Editor SKU platform di dalam form produk.
//
// Satu produk = satu SKU internal, plus SKU khusus untuk tiap marketplace.
// Baris di sini disimpan ke product_channel_mappings setelah produknya
// tersimpan, dan dipakai POS untuk mencari produk dari kode marketplace.

import { useMemo } from 'react';
import { Link2, Plus, Sparkles, Trash2, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { channelLabel, isMarketplace, resolveChannels } from '@/lib/channels';
import { findExternalSkuConflict, normalizeSku } from '@/lib/skuLookup';
import { cn, uuid } from '@/lib/format';
import type { SalesChannel } from '@/types';

export interface ChannelMappingDraft {
  id: string;
  channel_code: string;
  external_sku: string;
  external_url: string;
  /** Dipertahankan apa adanya saat edit; jangan di-reset. */
  is_synced: boolean;
  last_synced_at: string | null;
}

/** Prefix tebakan per channel, seragam dengan data demo. */
const CHANNEL_PREFIX: Record<string, string> = {
  shopee: 'SHP',
  tiktok: 'TT',
  tokopedia: 'TKPD',
  website: 'WEB',
  whatsapp: 'WA',
};

export function emptyChannelDraft(channelCode = ''): ChannelMappingDraft {
  return {
    id: uuid(),
    channel_code: channelCode,
    external_sku: '',
    external_url: '',
    is_synced: false,
    last_synced_at: null,
  };
}

interface Props {
  internalSku: string;
  value: ChannelMappingDraft[];
  onChange: (next: ChannelMappingDraft[]) => void;
  channelRows: SalesChannel[];
  /** Mapping milik produk LAIN, untuk deteksi bentrok antar-produk. */
  otherMappings: { id: string; channel_code: string; external_sku: string }[];
  disabled?: boolean;
}

export function ChannelSkuSection({
  internalSku,
  value,
  onChange,
  channelRows,
  otherMappings,
  disabled,
}: Props) {
  const online = typeof navigator === 'undefined' ? true : navigator.onLine;
  const readOnly = disabled || !online;

  // offline bukan marketplace, jadi tidak pernah ditawarkan di sini.
  const channels = useMemo(
    () => resolveChannels(channelRows).filter((c) => isMarketplace(c.code)),
    [channelRows],
  );

  function patch(id: string, next: Partial<ChannelMappingDraft>) {
    onChange(value.map((row) => (row.id === id ? { ...row, ...next } : row)));
  }

  function addRow() {
    const used = new Set(value.map((r) => r.channel_code));
    const nextChannel = channels.find((c) => !used.has(c.code))?.code ?? channels[0]?.code ?? '';
    onChange([...value, emptyChannelDraft(nextChannel)]);
  }

  function guess(row: ChannelMappingDraft) {
    const base = normalizeSku(internalSku);
    if (!base) return;
    const prefix = CHANNEL_PREFIX[row.channel_code] ?? row.channel_code.toUpperCase().slice(0, 3);
    patch(row.id, { external_sku: `${prefix}-${base}` });
  }

  /** Pesan error per baris, atau null kalau baris valid. */
  function errorFor(row: ChannelMappingDraft): string | null {
    if (!row.channel_code) return 'Pilih channel dulu.';
    if (!row.external_sku.trim()) return 'SKU platform wajib diisi.';
    const withinForm = value.filter((r) => r.id !== row.id);
    if (findExternalSkuConflict(row.channel_code, row.external_sku, withinForm, undefined)) {
      return 'SKU ini sudah dipakai di baris lain untuk channel yang sama.';
    }
    if (findExternalSkuConflict(row.channel_code, row.external_sku, otherMappings)) {
      return 'SKU ini sudah dipakai produk lain di channel yang sama.';
    }
    return null;
  }

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-800 dark:text-ink-100">
            <Link2 size={15} /> SKU Platform / Marketplace
          </h3>
          <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
            Satu produk = satu SKU internal, plus SKU khusus untuk tiap platform. Dipakai untuk
            mencocokkan pesanan Shopee/TikTok ke produk ini.
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={addRow} disabled={readOnly}>
          <Plus size={14} /> Tambah
        </Button>
      </div>

      {!online && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          <WifiOff size={14} className="mt-0.5 shrink-0" />
          <span>
            Perlu koneksi internet untuk mengubah mapping SKU platform. Data lama tetap bisa dilihat.
          </span>
        </div>
      )}

      {value.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ink-200 px-3 py-4 text-center text-xs text-ink-500 dark:border-ink-700 dark:text-ink-400">
          Belum ada SKU platform. Produk ini dianggap hanya dijual di toko fisik.
        </p>
      ) : (
        <div className="space-y-2">
          {value.map((row) => {
            const error = errorFor(row);
            const known = channels.some((c) => c.code === row.channel_code);
            return (
              <div
                key={row.id}
                className={cn(
                  'rounded-xl border px-3 py-2.5',
                  error
                    ? 'border-rose-300 bg-rose-50/60 dark:border-rose-500/40 dark:bg-rose-500/5'
                    : 'border-ink-200 dark:border-ink-700',
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className="h-9 rounded-lg border border-ink-200 bg-white px-2 text-sm dark:border-ink-700 dark:bg-ink-900"
                    value={row.channel_code}
                    disabled={readOnly}
                    onChange={(e) => patch(row.id, { channel_code: e.target.value })}
                  >
                    <option value="">Pilih channel…</option>
                    {channels.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                    {/* Channel yang sudah dinonaktifkan tetap tampil supaya barisnya bisa dihapus. */}
                    {!known && row.channel_code && (
                      <option value={row.channel_code}>
                        {channelLabel(row.channel_code, channelRows)} (nonaktif)
                      </option>
                    )}
                  </select>

                  <Input
                    className="min-w-[10rem] flex-1"
                    placeholder="SKU platform, cth. GD-WR520-13T"
                    value={row.external_sku}
                    disabled={readOnly}
                    onChange={(e) => patch(row.id, { external_sku: e.target.value })}
                  />

                  <Button
                    type="button"
                    variant="secondary"
                    title="Tebak dari SKU internal"
                    disabled={readOnly || !internalSku.trim()}
                    onClick={() => guess(row)}
                  >
                    <Sparkles size={14} />
                  </Button>

                  <Button
                    type="button"
                    variant="secondary"
                    title="Hapus baris"
                    disabled={readOnly}
                    onClick={() => onChange(value.filter((r) => r.id !== row.id))}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>

                <Input
                  className="mt-2"
                  placeholder="URL listing (opsional)"
                  value={row.external_url}
                  disabled={readOnly}
                  onChange={(e) => patch(row.id, { external_url: e.target.value })}
                />

                {error && <p className="mt-1.5 text-xs text-rose-600 dark:text-rose-300">{error}</p>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Validasi seluruh draft; mengembalikan pesan error pertama, atau null. */
export function validateChannelDrafts(
  drafts: ChannelMappingDraft[],
  otherMappings: { id: string; channel_code: string; external_sku: string }[],
): string | null {
  for (const row of drafts) {
    if (!row.channel_code) return 'Ada baris SKU platform yang belum dipilih channel-nya.';
    if (!row.external_sku.trim()) return 'Ada baris SKU platform yang masih kosong.';
    const withinForm = drafts.filter((r) => r.id !== row.id);
    if (findExternalSkuConflict(row.channel_code, row.external_sku, withinForm)) {
      return `SKU "${row.external_sku}" dipakai dua kali untuk channel yang sama.`;
    }
    if (findExternalSkuConflict(row.channel_code, row.external_sku, otherMappings)) {
      return `SKU "${row.external_sku}" sudah dipakai produk lain di channel yang sama.`;
    }
  }
  return null;
}
