// Impor & ekspor pengeluaran massal (butir 7.1 sheet client).
//
// Tampil sebagai bagian "Pengeluaran" di modal Impor / Ekspor Data dashboard.
// Client mencatat pengeluaran Juli–Agustus di luar sistem; ini jalan masuknya
// sekaligus, dengan berkas contoh supaya kolomnya tidak ditebak-tebak.
//
// Impor pengeluaran SELALU menambah baris baru: tidak ada kunci alami untuk
// mencocokkan, jadi mengunggah berkas yang sama dua kali berarti dobel.

import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { db } from '@/lib/db';
import { pullExpenses } from '@/lib/sync';
import { downloadFile } from '@/lib/dataTransfer';
import { formatMoney, formatNumber, errorMessage } from '@/lib/format';
import { useAuth } from '@/stores/auth';
import {
  EXPENSE_COLUMNS,
  buildExpenseTemplate,
  exportExpensesCsv,
  planExpenseImportFromFile,
  runExpenseImport,
  type ExpenseImportPlan,
} from '@/lib/expenseImport';

export function ImporPengeluaran({ storeId, onSelesai, onBatal }: { storeId: string; onSelesai: () => void; onBatal: () => void }) {
  const profile = useAuth((s) => s.profile);
  const daftar = useLiveQuery(() => db.expenses.where('store_id').equals(storeId).toArray(), [storeId]) ?? [];
  const [plan, setPlan] = useState<ExpenseImportPlan | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (storeId) void pullExpenses(storeId).catch(() => {});
  }, [storeId]);

  async function pickFile(file: File) {
    setBusy(true);
    try {
      const hasil = await planExpenseImportFromFile(file);
      setPlan(hasil);
      setFileName(file.name);
      if (!hasil.rows.length) toast.error('Tidak ada baris yang bisa diimpor dari berkas ini.');
    } catch (e) {
      toast.error(errorMessage(e, 'Gagal membaca berkas.'));
    } finally {
      setBusy(false);
    }
  }

  async function jalankan() {
    if (!plan?.rows.length) return;
    setBusy(true);
    try {
      const hasil = await runExpenseImport(plan, storeId, profile?.id ?? null);
      if (hasil.serverErrors.length) {
        toast.error(`Gagal menyimpan: ${hasil.serverErrors[0]}`);
        return;
      }
      toast.success(`${formatNumber(hasil.created)} pengeluaran ditambahkan.`);
      setPlan(null);
      setFileName('');
      onSelesai();
    } catch (e) {
      toast.error(errorMessage(e, 'Gagal menjalankan impor.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-500 dark:text-ink-400">
        Untuk memasukkan catatan pengeluaran lama sekaligus, misalnya rekap Juli–Agustus. Setiap baris dicatat sebagai
        pengeluaran baru dan langsung ikut memotong laba di Laporan Laba Rugi.
      </p>

      <div className="rounded-xl border border-ink-200 px-3 py-2 text-[11px] dark:border-ink-700">
        <div className="mb-1 font-semibold text-ink-600 dark:text-ink-300">Kolom yang dibaca</div>
        <div className="font-mono text-ink-500 dark:text-ink-400">{EXPENSE_COLUMNS.join(' · ')}</div>
        <div className="mt-1 text-ink-500 dark:text-ink-400">
          Wajib diisi: Tanggal dan Jumlah. Kategori di luar daftar dicatat sebagai Lainnya, metode bayar kosong dicatat
          sebagai Tunai.
        </div>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
        <AlertTriangle size={13} className="mr-1 inline" />
        Impor pengeluaran <strong>selalu menambah</strong>, tidak menimpa. Mengunggah berkas yang sama dua kali membuat
        catatannya dobel.
      </div>

      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-ink-300 px-3 py-6 text-sm hover:border-brand-500 dark:border-ink-600">
        <Upload size={16} />
        <span>{fileName || 'Pilih berkas pengeluaran (.xlsx atau .csv)'}</span>
        <input
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void pickFile(f);
            e.target.value = '';
          }}
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-brand-600 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-500/10"
          onClick={() => downloadFile('template-pengeluaran-kasir.csv', buildExpenseTemplate(), 'text/csv')}
        >
          <Download size={13} /> Unduh template .csv
        </button>
        <button
          type="button"
          disabled={daftar.length === 0}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-brand-600 hover:bg-brand-50 disabled:opacity-50 dark:text-brand-300 dark:hover:bg-brand-500/10"
          onClick={() => {
            const n = exportExpensesCsv(daftar);
            toast.success(`${formatNumber(n)} pengeluaran diekspor.`);
          }}
        >
          <Download size={13} /> Ekspor semua pengeluaran (.csv)
        </button>
      </div>

      {plan && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Baris terbaca" value={formatNumber(plan.totalRows)} />
            <Stat label="Akan ditambahkan" value={formatNumber(plan.rows.length)} />
            <Stat label="Total nilai" value={formatMoney(plan.total)} />
          </div>

          {plan.issues.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-500/30 dark:bg-amber-500/10">
              <div className="mb-1 text-xs font-semibold text-amber-900 dark:text-amber-100">
                {formatNumber(plan.issues.length)} catatan
              </div>
              <ul className="space-y-0.5 text-[11px] text-amber-900 dark:text-amber-100">
                {plan.issues.slice(0, 40).map((i) => (
                  <li key={`${i.row}-${i.message}`}>
                    Baris {i.row}: {i.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2 border-t border-ink-100 pt-3 dark:border-ink-800">
        <Button variant="secondary" onClick={onBatal} disabled={busy}>
          Batal
        </Button>
        <Button onClick={() => void jalankan()} disabled={busy || !plan?.rows.length}>
          <FileSpreadsheet size={15} />
          Impor {formatNumber(plan?.rows.length ?? 0)} Pengeluaran
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-ink-50 px-3 py-2 dark:bg-ink-800/50">
      <div className="text-[11px] text-ink-500 dark:text-ink-400">{label}</div>
      <div className="mt-0.5 text-sm font-bold">{value}</div>
    </div>
  );
}
