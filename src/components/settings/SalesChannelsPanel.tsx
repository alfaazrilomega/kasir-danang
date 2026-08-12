// Pengaturan channel penjualan: offline, Shopee, TikTok, dan marketplace lain.
// Potongan (%) dipakai POS untuk memperkirakan penerimaan bersih, dan termin
// menentukan saran jatuh tempo piutang.

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { db } from '@/lib/db';
import { getBackendClient } from '@/lib/api';
import { DEFAULT_CHANNELS, OFFLINE_CHANNEL } from '@/lib/channels';
import { cn, uuid } from '@/lib/format';
import type { SalesChannel } from '@/types';

export function SalesChannelsPanel({ storeId }: { storeId: string }) {
  const [busy, setBusy] = useState(false);
  const rows =
    useLiveQuery(() => db.sales_channels.where('store_id').equals(storeId).toArray(), [storeId]) ??
    [];
  const sorted = [...rows].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

  async function seedDefaults() {
    setBusy(true);
    try {
      const seeded: SalesChannel[] = DEFAULT_CHANNELS.map((channel, index) => ({
        id: uuid(),
        store_id: storeId,
        code: channel.code,
        name: channel.name,
        fee_percent: channel.fee_percent,
        default_term_days: channel.default_term_days,
        is_active: true,
        sort_order: index,
        created_at: new Date().toISOString(),
      }));
      const { error } = await getBackendClient().from('sales_channels').insert(seeded);
      if (error) throw error;
      await db.sales_channels.bulkPut(seeded);
      toast.success('Channel bawaan ditambahkan.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menambahkan channel.');
    } finally {
      setBusy(false);
    }
  }

  async function addBlank() {
    const name = prompt('Nama channel baru (mis. Lazada):')?.trim();
    if (!name) return;
    const code = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!code) {
      toast.error('Nama channel tidak valid.');
      return;
    }
    if (rows.some((row) => row.code === code)) {
      toast.error('Channel dengan kode itu sudah ada.');
      return;
    }
    const row: SalesChannel = {
      id: uuid(),
      store_id: storeId,
      code,
      name,
      fee_percent: 0,
      default_term_days: 14,
      is_active: true,
      sort_order: rows.length,
      created_at: new Date().toISOString(),
    };
    const { error } = await getBackendClient().from('sales_channels').insert(row);
    if (error) {
      toast.error(error.message);
      return;
    }
    await db.sales_channels.put(row);
    toast.success(`Channel "${name}" ditambahkan.`);
  }

  async function patch(row: SalesChannel, changes: Partial<SalesChannel>) {
    const next = { ...row, ...changes };
    const { error } = await getBackendClient().from('sales_channels').update(changes).eq('id', row.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await db.sales_channels.put(next);
  }

  async function remove(row: SalesChannel) {
    if (row.code === OFFLINE_CHANNEL) {
      toast.error('Channel offline tidak bisa dihapus.');
      return;
    }
    if (!confirm(`Hapus channel "${row.name}"? Transaksi lama tetap menyimpan kodenya.`)) return;
    const { error } = await getBackendClient().from('sales_channels').delete().eq('id', row.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await db.sales_channels.delete(row.id);
    toast.success('Channel dihapus.');
  }

  if (sorted.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-ink-200 p-5 text-center dark:border-ink-700">
        <p className="text-sm text-ink-500">
          Belum ada channel tersimpan. POS sementara memakai daftar bawaan (Offline, Shopee, TikTok,
          Tokopedia).
        </p>
        <Button className="mt-3" onClick={seedDefaults} disabled={busy}>
          <Plus size={14} /> Pakai daftar bawaan
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sorted.map((row) => (
        <div
          key={row.id}
          className={cn(
            'rounded-xl border p-3 transition',
            row.is_active
              ? 'border-ink-100 dark:border-ink-800'
              : 'border-ink-100 bg-ink-50 opacity-70 dark:border-ink-800 dark:bg-ink-800/40',
          )}
        >
          <div className="grid gap-2 sm:grid-cols-[1.4fr_0.8fr_0.8fr_auto] sm:items-end">
            <div className="space-y-1">
              <label className="block text-[11px] text-ink-500">Nama channel</label>
              <input
                className="input !py-1.5"
                value={row.name}
                onChange={(e) => patch(row, { name: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <label className="block text-[11px] text-ink-500">Potongan (%)</label>
              <input
                type="number"
                min={0}
                max={100}
                step="0.1"
                className="input !py-1.5"
                value={row.fee_percent}
                onChange={(e) => patch(row, { fee_percent: Number(e.target.value || 0) })}
              />
            </div>
            <div className="space-y-1">
              <label className="block text-[11px] text-ink-500">Termin (hari)</label>
              <input
                type="number"
                min={0}
                className="input !py-1.5"
                value={row.default_term_days}
                onChange={(e) => patch(row, { default_term_days: Number(e.target.value || 0) })}
              />
            </div>
            <div className="flex items-center gap-1.5 pb-1">
              <button
                onClick={() => patch(row, { is_active: !row.is_active })}
                className={cn(
                  'rounded-full px-3 py-1.5 text-xs font-semibold transition',
                  row.is_active
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                    : 'bg-ink-100 text-ink-500 dark:bg-ink-800',
                )}
              >
                {row.is_active ? 'Aktif' : 'Nonaktif'}
              </button>
              <button
                onClick={() => remove(row)}
                className="grid h-8 w-8 place-items-center rounded-full text-ink-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"
                title="Hapus channel"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-ink-500">
            <Badge tone="neutral">{row.code}</Badge>
            {row.code === OFFLINE_CHANNEL
              ? 'Penjualan langsung di kasir, dibayar saat itu juga.'
              : 'Default tempo — dicatat sebagai piutang sampai dana cair.'}
          </div>
        </div>
      ))}

      <Button variant="secondary" onClick={addBlank}>
        <Plus size={14} /> Tambah channel
      </Button>
    </div>
  );
}
