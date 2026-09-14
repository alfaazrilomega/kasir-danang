// Impor & ekspor pelanggan massal (butir 5.1 sheet client).
//
// Tampil sebagai bagian "Pelanggan" di modal Impor / Ekspor Data dashboard,
// berdampingan dengan impor produk. Sama seperti impor lain di aplikasi ini:
// unggah berkas dulu, lihat rencananya, baru diterapkan. Client punya
// database pembeli lama dari penjualan WhatsApp — mengetiknya satu per satu
// ke formulir Tambah Pelanggan untuk ratusan baris adalah pekerjaan yang
// ingin dihilangkan fitur ini.
//
// Impor pelanggan selalu MENAMBAH/MEMPERBARUI (dicocokkan lewat nomor HP),
// tidak pernah menghapus pelanggan yang tidak ada di berkas.

import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { db } from '@/lib/db';
import { pullReference } from '@/lib/sync';
import { downloadFile } from '@/lib/dataTransfer';
import { formatNumber, errorMessage } from '@/lib/format';
import {
  buildCustomerTemplate,
  exportCustomersCsv,
  planCustomerImportFromFile,
  runCustomerImport,
  CUSTOMER_COLUMNS,
  type CustomerImportPlan,
} from '@/lib/customerImport';

export function ImporPelanggan({ storeId, onSelesai, onBatal }: { storeId: string; onSelesai: () => void; onBatal: () => void }) {
  const existing = useLiveQuery(() => db.customers.where('store_id').equals(storeId).toArray(), [storeId]) ?? [];
  // Dashboard belum tentu pernah menarik daftar pelanggan; tanpa ini pencocokan
  // nomor HP menganggap semua baris pelanggan baru dan membuat duplikat.
  useEffect(() => {
    if (storeId) void pullReference(storeId).catch(() => {});
  }, [storeId]);

  const [plan, setPlan] = useState<CustomerImportPlan | null>(null);
  // Salinan daftar pelanggan saat berkas dibaca, dipakai mencocokkan nomor HP.
  const [terbaru, setTerbaru] = useState<typeof existing>([]);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);

  async function pickFile(file: File) {
    setBusy(true);
    try {
      // Daftar pelanggan ditarik ulang tepat sebelum dicocokkan: dashboard bisa
      // saja belum pernah memuatnya, dan data bisa berubah sejak modal dibuka.
      await pullReference(storeId).catch(() => {});
      const daftar = await db.customers.where('store_id').equals(storeId).toArray();
      setTerbaru(daftar);
      const hasil = await planCustomerImportFromFile(file, daftar);
      setPlan(hasil);
      setFileName(file.name);
      if (!hasil.rows.length) {
        toast.error('Tidak ada baris yang bisa diimpor dari berkas ini.');
      }
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
      const hasil = await runCustomerImport(plan, storeId, terbaru.length ? terbaru : existing);
      if (hasil.serverErrors.length) {
        toast.error(`Gagal menyimpan: ${hasil.serverErrors[0]}`);
        return;
      }
      toast.success(
        `${formatNumber(hasil.created)} pelanggan baru ditambahkan, ${formatNumber(hasil.updated)} diperbarui.`,
      );
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
        Untuk memasukkan database pelanggan lama sekaligus, misalnya dari catatan penjualan WhatsApp. Dicocokkan lewat
        nomor HP: nomor yang sudah terdaftar diperbarui, nomor baru ditambahkan. Pelanggan yang tidak ada di berkas
        dibiarkan, tidak dihapus.
      </p>

      <div className="rounded-xl border border-ink-200 px-3 py-2 text-[11px] dark:border-ink-700">
        <div className="mb-1 font-semibold text-ink-600 dark:text-ink-300">Kolom yang dibaca</div>
        <div className="font-mono text-ink-500 dark:text-ink-400">{CUSTOMER_COLUMNS.join(' · ')}</div>
        <div className="mt-1 text-ink-500 dark:text-ink-400">
          Wajib diisi: Nama. Tanpa nomor HP, baris selalu dianggap pelanggan baru — tidak ada yang bisa dipakai
          mencocokkan.
        </div>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
        <AlertTriangle size={13} className="mr-1 inline" />
        Poin loyalitas <strong>tidak ikut diimpor</strong> — pelanggan baru selalu mulai dari 0. Poin lama bisa
        ditambahkan manual lewat detail pelanggan setelah impor.
      </div>

      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-ink-300 px-3 py-6 text-sm hover:border-brand-500 dark:border-ink-600">
        <Upload size={16} />
        <span>{fileName || 'Pilih berkas pelanggan (.xlsx atau .csv)'}</span>
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
          onClick={() => downloadFile('template-pelanggan-kasir.csv', buildCustomerTemplate(), 'text/csv')}
        >
          <Download size={13} /> Unduh template .csv
        </button>
        <button
          type="button"
          disabled={existing.length === 0}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-brand-600 hover:bg-brand-50 disabled:opacity-50 dark:text-brand-300 dark:hover:bg-brand-500/10"
          onClick={() => {
            const n = exportCustomersCsv(existing);
            toast.success(`${formatNumber(n)} pelanggan diekspor.`);
          }}
        >
          <Download size={13} /> Ekspor semua pelanggan (.csv)
        </button>
      </div>

      {plan && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Baris terbaca" value={formatNumber(plan.totalRows)} />
            <Stat label="Pelanggan baru" value={formatNumber(plan.toCreate)} />
            <Stat label="Diperbarui" value={formatNumber(plan.toUpdate)} />
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
          Impor {formatNumber(plan?.rows.length ?? 0)} Pelanggan
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
