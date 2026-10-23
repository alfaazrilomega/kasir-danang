import { useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, RefreshCw } from 'lucide-react';
import { getBackendClient } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/format';
import { groupMailketingLists, type MailketingList } from '@/lib/mailketingGroups';

type Lists = { configured: boolean; lists: MailketingList[] };

// Daftar baca saja untuk memastikan token toko terhubung. List dipilih per produk.
export function MailketingListsCard({ reloadKey }: { reloadKey: string }) {
  const [data, setData] = useState<Lists | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError('');
    getBackendClient().request<Lists>('/api/admin/mailketing/lists').then(result => {
      if (!alive) return;
      if (result.error || !result.data) setError(result.error?.message || 'List Mailketing gagal dimuat.');
      else setData(result.data);
    }).catch(() => { if (alive) setError('List Mailketing gagal dimuat.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [attempt, reloadKey]);

  const lists = [...(data?.lists ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'id', { sensitivity: 'base', numeric: true }) || a.id - b.id);
  const groups = groupMailketingLists(lists);

  return <Card className="space-y-4 p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="font-semibold">List subscriber Mailketing</h2>
        <p className="text-sm text-ink-500">Diambil langsung dari akun Mailketing. Pilih list per produk di menu Produk, bagian Mailketing.</p>
      </div>
      <Button type="button" size="sm" variant="secondary" disabled={loading} onClick={() => setAttempt(n => n + 1)}>
        <RefreshCw size={14} className={cn(loading && 'animate-spin')} aria-hidden="true" />
        {loading ? 'Memuat…' : 'Muat ulang'}
      </Button>
    </div>
    <div aria-live="polite" className="text-sm">
      {loading && !data ? <p className="text-ink-500">Memuat list Mailketing…</p>
        : error ? <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"><CircleAlert size={16} className="shrink-0" aria-hidden="true" />{error}</p>
        : data?.configured === false ? <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"><CircleAlert size={16} className="shrink-0" aria-hidden="true" />Mailketing belum terhubung. Simpan API Token Mailketing di atas.</p>
        : lists.length === 0 ? <p className="text-ink-500">Belum ada list di akun Mailketing. Buat list di dashboard Mailketing, lalu klik Muat ulang.</p>
        : <p className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400"><CheckCircle2 size={14} aria-hidden="true" />Terhubung · {lists.length} list{groups.some(g => g.name) && ` dalam ${groups.filter(g => g.name).length} grup`}</p>}
    </div>
    {!error && lists.length > 0 && <div className="space-y-3">
      {groups.map(group => <div key={group.name ?? ''}>
        {(group.name || groups.length > 1) && <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">{group.name ?? 'Tanpa grup'}</h3>}
        <ul className="divide-y divide-ink-100 rounded-xl border border-ink-100 dark:divide-ink-800 dark:border-ink-800">
          {group.lists.map(list => <li key={list.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm"><span className="min-w-0 break-words">{list.label}</span><span className="shrink-0 text-xs text-ink-500">#{list.id}</span></li>)}
        </ul>
      </div>)}
      <p className="text-xs text-ink-500">Grup dibaca dari awalan nama list, misalnya GNNK - Gear.</p>
    </div>}
  </Card>;
}
