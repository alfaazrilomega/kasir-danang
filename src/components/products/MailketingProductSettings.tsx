import { useEffect, useId, useMemo, useState } from 'react';
import { CheckCircle2, CircleAlert, ListFilter, Mail, RefreshCw, Search, X } from 'lucide-react';
import { getBackendClient } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/format';
import { groupMailketingLists } from '@/lib/mailketingGroups';

type Lists = { configured: boolean; lists: { id: number; name: string }[] };
export function MailketingProductSettings({ orderList, completeList, onChange }: {
  orderList: number | null; completeList: number | null;
  onChange: (key: 'mailketing_order_list_id' | 'mailketing_complete_list_id', value: number | null) => void;
}) {
  const id = useId();
  const [data, setData] = useState<Lists | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const lists = useMemo(() => [...(data?.lists ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name, 'id', { sensitivity: 'base', numeric: true }) || a.id - b.id,
  ), [data]);
  const query = search.trim().toLocaleLowerCase('id');
  const filtered = useMemo(() => {
    const words = query.split(/\s+/).filter(Boolean);
    return lists.filter(list => words.every(word => `${list.name} #${list.id}`.toLocaleLowerCase('id').includes(word)));
  }, [lists, query]);
  const groups = useMemo(() => groupMailketingLists(filtered), [filtered]);
  const groupCount = useMemo(() => groupMailketingLists(lists).filter(group => group.name).length, [lists]);
  const connected = data?.configured === true && !error;

  useEffect(() => {
    let alive = true;
    setLoading(true); setError('');
    getBackendClient().request<Lists>('/api/admin/mailketing/lists').then(result => {
      if (!alive) return;
      if (result.error || !result.data) setError(result.error?.message || 'Daftar Mailketing gagal dimuat.');
      else { setData(result.data); setLoadedAt(new Date()); }
    }).catch(() => { if (alive) setError('Daftar Mailketing gagal dimuat.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [attempt]);

  return <section className="min-w-0 overflow-hidden rounded-2xl border border-ink-200 dark:border-ink-700" aria-label="Pengaturan Mailketing">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 bg-ink-50/70 p-4 dark:border-ink-800 dark:bg-ink-900/50">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950/50 dark:text-brand-300"><Mail size={18} aria-hidden="true" /></span>
        <div>
          <h3 className="text-sm font-semibold">Mailketing</h3>
          <p className="text-xs text-ink-500">List pelanggan untuk produk ini</p>
        </div>
      </div>
      <Button type="button" size="sm" variant="secondary" disabled={loading} className="min-h-[44px] shrink-0" onClick={() => setAttempt(n => n + 1)}>
        <RefreshCw size={14} className={cn(loading && 'animate-spin')} aria-hidden="true" />
        {loading ? 'Memuat list…' : 'Muat ulang list'}
      </Button>
    </div>

    <div className="space-y-4 p-4">
      <p className="text-xs leading-relaxed text-ink-500">Pilih list yang sudah dibuat di Mailketing. Nama, email, dan nomor HP pembeli dikirim otomatis jika pelanggan memiliki email.</p>
      <div aria-live="polite" aria-atomic="true" className="text-xs">
        {loading ? <span className="text-ink-500">Memuat list Mailketing…</span>
          : error ? <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"><CircleAlert size={16} className="shrink-0" aria-hidden="true" /><p>{error} Pilihan tersimpan tetap dipertahankan.{lists.length > 0 && ' Daftar terakhir masih ditampilkan.'}</p></div>
          : data?.configured === false ? <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"><CircleAlert size={16} className="shrink-0" aria-hidden="true" /><p>Mailketing belum terhubung. Pilih layanan Mailketing dan isi API Token di menu Email & Template, lalu klik Muat ulang list.</p></div>
          : connected ? <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400"><CheckCircle2 size={14} aria-hidden="true" />Terhubung · {lists.length} list tersedia{groupCount > 0 && ` dalam ${groupCount} grup`}</span> : null}
      </div>

      {loadedAt && <p className="text-xs text-ink-500">Daftar terakhir dimuat {loadedAt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}.{loading && ' Memperbarui daftar…'}</p>}
      {lists.length > 0 && <div>
        <label htmlFor={`${id}-search`} className="mb-1.5 block text-xs font-medium">Cari list Mailketing</label>
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" aria-hidden="true" />
          <input id={`${id}-search`} type="search" autoComplete="off" className="input min-h-[44px] w-full pl-9 pr-12 [&::-webkit-search-cancel-button]:appearance-none" placeholder="Cari nama atau ID list…" value={search} onChange={e => setSearch(e.target.value)} aria-describedby={`${id}-results`} />
          {search && <button type="button" aria-label="Hapus pencarian list" className="absolute right-0 top-0 grid h-full min-h-[44px] w-11 place-items-center rounded-r-xl text-ink-500 hover:text-ink-900 focus-visible:outline focus-visible:outline-brand-500 dark:hover:text-ink-100" onClick={() => { setSearch(''); document.getElementById(`${id}-search`)?.focus(); }}><X size={16} aria-hidden="true" /></button>}
        </div>
        <p id={`${id}-results`} role="status" className="mt-1.5 text-xs text-ink-500">{query ? `${filtered.length} dari ${lists.length} list cocok. Pilihan saat ini tetap tersedia.` : 'Urut A–Z per grup. Grup dibaca dari awalan nama list di Mailketing, misalnya GNNK - Gear. Bisa cari nama grup, list, atau ID.'}</p>
      </div>}
      {!loading && connected && lists.length === 0 && <div className="rounded-xl border border-dashed border-ink-200 p-4 text-center dark:border-ink-700">
        <ListFilter size={22} className="mx-auto mb-2 text-ink-400" aria-hidden="true" />
        <p className="text-sm font-medium">Belum ada list</p>
        <p className="mt-1 text-xs text-ink-500">Buat list di Mailketing, lalu klik Muat ulang list.</p>
      </div>}
      {lists.length > 0 && filtered.length === 0 && <p className="rounded-xl bg-ink-50 p-3 text-xs text-ink-600 dark:bg-ink-900 dark:text-ink-300">Tidak ada list yang cocok. Coba nama atau ID lain, atau hapus pencarian.</p>}

      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        {([
          ['mailketing_order_list_id', 'Order List', 'Saat pesanan dibuat', orderList],
          ['mailketing_complete_list_id', 'Complete Order List', 'Saat pesanan selesai', completeList],
        ] as const).map(([key, label, hint, value], index) => {
          const selected = lists.find(list => list.id === value);
          const outsideResults = value != null && !filtered.some(list => list.id === value);
          const unavailable = value != null && !selected && connected && !loading;
          return <div key={key} className="min-w-0 space-y-2.5 rounded-xl border border-ink-100 p-3 dark:border-ink-800">
            <div className="flex items-center gap-2">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700 dark:bg-brand-950/50 dark:text-brand-300" aria-hidden="true">{index + 1}</span>
              <div className="min-w-0">
                <label htmlFor={`${id}-${key}`} className="block text-sm font-semibold">{label}</label>
                <p id={`${id}-${key}-hint`} className="text-xs text-ink-500">{hint}</p>
              </div>
            </div>
            <select id={`${id}-${key}`} className="input min-h-[44px] w-full min-w-0" value={value ?? ''} disabled={loading && !data} aria-describedby={`${id}-${key}-hint ${id}-${key}-status`} onChange={e => onChange(key, e.target.value ? Number(e.target.value) : null)}>
              <option value="">Tidak disinkronkan</option>
              {outsideResults && <optgroup label="Pilihan saat ini"><option value={value}>{selected ? `${selected.name} (#${value})` : `List tersimpan #${value}`}</option></optgroup>}
              {groups.map(group => <optgroup key={group.name ?? ''} label={group.name ?? (groups.length > 1 ? 'Tanpa grup' : query ? 'Hasil pencarian' : 'List tersedia')}>
                {group.lists.map(list => <option value={list.id} key={list.id}>{list.label} (#{list.id})</option>)}
              </optgroup>)}
            </select>
            <div className="flex flex-wrap gap-2">
              {index === 1 && orderList != null && orderList !== completeList && <button type="button" className="min-h-[44px] text-xs font-semibold text-brand-600 dark:text-brand-400" onClick={() => onChange('mailketing_complete_list_id', orderList)}>Samakan dengan Order List</button>}
              {value != null && <button type="button" className="ml-auto min-h-[44px] text-xs text-ink-500 hover:text-rose-600" aria-label={`Kosongkan ${label}`} onClick={() => onChange(key, null)}>Kosongkan pilihan</button>}
            </div>
            <p id={`${id}-${key}-status`} className={cn('break-words text-xs leading-relaxed', unavailable ? 'text-amber-700 dark:text-amber-400' : 'text-ink-500')}>
              {value == null ? 'Pelanggan tidak ditambahkan ke list untuk tahap ini.'
                : unavailable ? `List #${value} tidak ditemukan di akun Mailketing. Pilih list lain atau nonaktifkan tahap ini.`
                : selected ? <>Tujuan: <span className="font-medium text-ink-700 dark:text-ink-200">{selected.name}</span> · #{value}</>
                : `Pilihan list #${value} tetap disimpan. Muat ulang untuk memeriksa ketersediaannya.`}
            </p>
          </div>;
        })}
      </div>
      {orderList != null && orderList === completeList && <p className="rounded-xl bg-brand-50 p-3 text-xs text-brand-800 dark:bg-brand-950/40 dark:text-brand-200">Kedua tahap memakai list yang sama. Pelanggan yang sudah ada di list tersebut tidak ditambahkan dua kali.</p>}
      <p className="border-t border-ink-100 pt-3 text-xs leading-relaxed text-ink-500 dark:border-ink-800">Klik Simpan produk untuk menerapkan. Berlaku per SKU. SKU baru dari formulir ini mengikuti pilihan di atas. Perubahan list tidak mengirim ulang pesanan yang sudah selesai.</p>
    </div>
  </section>;
}
