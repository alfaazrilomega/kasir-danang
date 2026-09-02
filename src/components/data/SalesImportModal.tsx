// Modal impor penjualan massal.
//
// Alurnya sengaja dua langkah: unggah berkas dulu, lihat rencananya, baru
// dijalankan. Impor buta ke data penjualan terlalu mahal untuk dibatalkan.

import { useState } from 'react';
import { AlertTriangle, FileSpreadsheet, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { formatMoney, formatNumber, errorMessage } from '@/lib/format';
import {
  planSalesImport,
  runSalesImport,
  SALES_COLUMNS,
  type SalesImportPlan,
} from '@/lib/salesImport';

interface Props {
  open: boolean;
  storeId: string;
  currency?: string;
  onClose: () => void;
  onDone: () => void;
}

export function SalesImportModal({ open, storeId, currency, onClose, onDone }: Props) {
  const [plan, setPlan] = useState<SalesImportPlan | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);

  function reset() {
    setPlan(null);
    setFileName('');
  }

  async function pickFile(file: File) {
    setBusy(true);
    try {
      const text = await file.text();
      const hasil = await planSalesImport(text, storeId);
      setPlan(hasil);
      setFileName(file.name);
      if (!hasil.orders.length) {
        toast.error('Tidak ada pesanan yang bisa diimpor dari berkas ini.');
      }
    } catch (e) {
      toast.error(errorMessage(e, 'Gagal membaca berkas.'));
    } finally {
      setBusy(false);
    }
  }

  async function jalankan() {
    if (!plan?.orders.length) return;
    setBusy(true);
    try {
      const hasil = await runSalesImport(plan, storeId);
      if (hasil.serverErrors.length) {
        toast.error(`Gagal menyimpan: ${hasil.serverErrors[0]}`);
        return;
      }
      toast.success(
        `${formatNumber(hasil.orders)} pesanan (${formatNumber(hasil.items)} baris barang) diimpor.`,
      );
      reset();
      onDone();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e, 'Gagal menjalankan impor.'));
    } finally {
      setBusy(false);
    }
  }

  const totalNilai = plan?.orders.reduce((s, o) => s + o.total, 0) ?? 0;

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Impor Penjualan Massal"
      size="lg"
    >
      <div className="space-y-3">
        <p className="text-xs text-ink-500 dark:text-ink-400">
          Untuk memasukkan penjualan yang sudah lewat. Kolomnya sama persis dengan hasil
          <strong> Export CSV</strong> di halaman ini — ekspor sekali untuk melihat contohnya,
          isi, lalu unggah kembali. Satu pesanan boleh punya banyak baris: tulis nomor
          pesanan yang sama di tiap barisnya.
        </p>

        <div className="rounded-xl border border-ink-200 px-3 py-2 text-[11px] dark:border-ink-700">
          <div className="mb-1 font-semibold text-ink-600 dark:text-ink-300">Kolom yang dibaca</div>
          <div className="font-mono text-ink-500 dark:text-ink-400">{SALES_COLUMNS.join(' · ')}</div>
          <div className="mt-1 text-ink-500 dark:text-ink-400">
            Wajib diisi: No. Pesanan, Tanggal, Qty, Harga Satuan. Sisanya boleh kosong.
          </div>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          <AlertTriangle size={13} className="mr-1 inline" />
          Impor ini <strong>tidak mengubah stok</strong>. Datanya penjualan lama, sedangkan stok
          di aplikasi adalah angka hari ini.
        </div>

        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-ink-300 px-3 py-6 text-sm hover:border-brand-500 dark:border-ink-600">
          <Upload size={16} />
          <span>{fileName || 'Pilih berkas CSV penjualan'}</span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void pickFile(f);
              e.target.value = '';
            }}
          />
        </label>

        {plan && (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Pesanan" value={formatNumber(plan.orders.length)} />
              <Stat label="Baris barang" value={formatNumber(plan.totalRows)} />
              <Stat label="Nilai" value={formatMoney(totalNilai, currency)} />
            </div>

            {plan.duplicates.length > 0 && (
              <div className="rounded-xl border border-ink-200 px-3 py-2 text-xs dark:border-ink-700">
                <strong>{formatNumber(plan.duplicates.length)} pesanan dilewati</strong> karena
                nomornya sudah ada di aplikasi:{' '}
                <span className="font-mono">{plan.duplicates.slice(0, 5).join(', ')}</span>
                {plan.duplicates.length > 5 && ` dan ${plan.duplicates.length - 5} lainnya`}.
              </div>
            )}

            {plan.issues.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-500/30 dark:bg-amber-500/10">
                <div className="mb-1 text-xs font-semibold text-amber-900 dark:text-amber-100">
                  {formatNumber(plan.issues.length)} catatan
                </div>
                <ul className="space-y-0.5 text-[11px] text-amber-900 dark:text-amber-100">
                  {plan.issues.slice(0, 40).map((i) => (
                    <li key={`${i.row}-${i.message}`}>Baris {i.row}: {i.message}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-ink-100 pt-3 dark:border-ink-800">
          <Button
            variant="secondary"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Batal
          </Button>
          <Button onClick={() => void jalankan()} disabled={busy || !plan?.orders.length}>
            <FileSpreadsheet size={15} />
            {busy ? 'Memproses…' : `Impor ${formatNumber(plan?.orders.length ?? 0)} Pesanan`}
          </Button>
        </div>
      </div>
    </Modal>
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
