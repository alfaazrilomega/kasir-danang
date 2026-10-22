import { useEffect, useState } from 'react';
import { formatMoney } from '@/lib/format';
import { LABEL_STATUS_KOMISI, affiliateAdminApi, statusKomisi, type AdminOrderAffiliate } from '@/lib/affiliate';

const LABEL_SUMBER: Record<string, string> = {
  kaitan: 'Kaitkan affiliasi',
  link: 'Link affiliate',
  undangan: 'Undangan',
};

/**
 * Affiliate pesanan dan ringkasan komisinya di detail pesanan admin (FR-20).
 * Kolom affiliate tidak ikut tersinkron ke perangkat, jadi diambil langsung
 * dari server; pesanan tanpa affiliate tidak menampilkan apa pun.
 */
export function InfoAffiliatePesanan({ orderId, currency }: { orderId: string; currency?: string }) {
  const [data, setData] = useState<AdminOrderAffiliate | null>(null);

  useEffect(() => {
    let hidup = true;
    setData(null);
    void affiliateAdminApi.order(orderId).then(({ data: d }) => {
      if (hidup) setData(d);
    });
    return () => {
      hidup = false;
    };
  }, [orderId]);

  if (!data?.affiliate) return null;
  const total = data.commissions.filter((k) => k.status !== 'cancelled').reduce((s, k) => s + k.commission, 0);

  return (
    <div className="rounded-xl border border-brand-100 bg-brand-50/60 p-3 text-xs dark:border-brand-500/20 dark:bg-brand-950/25" data-info-affiliate>
      <div className="font-semibold text-brand-700 dark:text-brand-200">Affiliate</div>
      <div className="mt-1.5 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-ink-500 dark:text-ink-400">Affiliate</span>
          <span className="min-w-0 truncate text-right">
            {data.affiliate.name}
            {data.affiliate.code && <span className="ml-1 font-mono text-ink-500">({data.affiliate.code})</span>}
          </span>
        </div>
        {data.source && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-ink-500 dark:text-ink-400">Sumber</span>
            <span>{LABEL_SUMBER[data.source] ?? data.source}</span>
          </div>
        )}
        {data.acquisition && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-ink-500 dark:text-ink-400">Akuisisi</span>
            <span className="min-w-0 truncate text-right">
              {data.acquisition.source}
              {data.acquisition.media ? ` / ${data.acquisition.media}` : ''}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="text-ink-500 dark:text-ink-400">Total komisi</span>
          <span className="font-bold">{formatMoney(total, currency)}</span>
        </div>
      </div>
      {data.commissions.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-brand-200 pt-2 dark:border-brand-500/30">
          {data.commissions.map((k) => (
            <li key={k.id} className="flex items-center justify-between gap-2 text-ink-600 dark:text-ink-300">
              <span className="min-w-0 truncate">
                Tier {k.tier} · {k.affiliate_name} · {LABEL_STATUS_KOMISI[statusKomisi(k)]}
              </span>
              <span className="shrink-0 tabular-nums">{formatMoney(k.commission, currency)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
