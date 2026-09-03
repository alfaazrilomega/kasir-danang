// Modal impor penjualan massal.
//
// Alurnya sengaja dua langkah: unggah berkas dulu, lihat rencananya, baru
// dijalankan. Impor buta ke data penjualan terlalu mahal untuk dibatalkan.
//
// Berkas mentah Shopee dan TikTok (.xlsx) diterima apa adanya. Susunan kolom
// yang terdeteksi ditampilkan sebelum tombol impor ditekan, supaya tebakan
// sistem bisa diperiksa mata dulu.

import { useEffect, useState } from 'react';
import { AlertTriangle, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { db } from '@/lib/db';
import { resolveChannels } from '@/lib/channels';
import { downloadFile } from '@/lib/dataTransfer';
import { formatMoney, formatNumber, errorMessage } from '@/lib/format';
import { buildXlsx, downloadBlob, readSpreadsheet } from '@/lib/spreadsheet';
import {
  buildSalesTemplate,
  buildSalesTemplateRows,
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
  const [rows, setRows] = useState<string[][] | null>(null);
  const [channelCode, setChannelCode] = useState('');
  const [busy, setBusy] = useState(false);

  const channelRows = useLiveQuery(
    () => db.sales_channels.where('store_id').equals(storeId).toArray(),
    [storeId],
    [],
  );
  const channels = resolveChannels(channelRows ?? []);

  function reset() {
    setPlan(null);
    setFileName('');
    setRows(null);
    setChannelCode('');
  }

  async function susunRencana(isi: string[][], channel: string) {
    const hasil = await planSalesImport(isi, storeId, channel ? { channelCode: channel } : {});
    setPlan(hasil);
    return hasil;
  }

  async function pickFile(file: File) {
    setBusy(true);
    try {
      const isi = await readSpreadsheet(file);
      setRows(isi);
      setFileName(file.name);
      const hasil = await susunRencana(isi, channelCode);
      // "Tidak ada yang bisa diimpor" dan "semuanya sudah pernah diimpor" itu
      // dua keadaan yang sangat berbeda. Menyamakan keduanya membuat impor
      // ulang yang berhasil ditolak terlihat seperti berkasnya rusak.
      if (!hasil.orders.length && hasil.duplicates.length) {
        toast.info(
          `Semua ${hasil.duplicates.length} pesanan di berkas ini sudah pernah diimpor sebelumnya.`,
        );
      } else if (!hasil.orders.length) {
        toast.error('Tidak ada pesanan yang bisa diimpor dari berkas ini.');
      }
    } catch (e) {
      toast.error(errorMessage(e, 'Gagal membaca berkas.'));
    } finally {
      setBusy(false);
    }
  }

  // Mengganti channel tujuan harus menyusun ulang rencananya, bukan sekadar
  // mengubah label — channel ikut tersimpan di tiap pesanan.
  useEffect(() => {
    if (!rows) return;
    let batal = false;
    void (async () => {
      const hasil = await planSalesImport(rows, storeId, channelCode ? { channelCode } : {});
      if (!batal) setPlan(hasil);
    })();
    return () => {
      batal = true;
    };
  }, [channelCode, rows, storeId]);

  async function unduhTemplateXlsx() {
    try {
      const blob = await buildXlsx(buildSalesTemplateRows());
      downloadBlob('template-penjualan-kasir.xlsx', blob);
    } catch (e) {
      toast.error(errorMessage(e, 'Gagal menyiapkan template.'));
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
          Untuk memasukkan penjualan yang sudah lewat. Berkas ekspor <strong>Shopee</strong> dan{' '}
          <strong>TikTok Shop</strong> bisa diunggah apa adanya tanpa dirapikan dulu. Bisa juga
          memakai template sendiri di bawah. Satu pesanan boleh punya banyak baris: tulis nomor
          pesanan yang sama di tiap barisnya.
        </p>

        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          <AlertTriangle size={13} className="mr-1 inline" />
          Impor ini <strong>tidak mengubah stok</strong>. Datanya penjualan lama, sedangkan stok
          di aplikasi adalah angka hari ini.
        </div>

        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-ink-300 px-3 py-6 text-sm hover:border-brand-500 dark:border-ink-600">
          <Upload size={16} />
          <span>{fileName || 'Pilih berkas penjualan (.xlsx atau .csv)'}</span>
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

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-500 dark:text-ink-400">
          <span className="font-mono">{SALES_COLUMNS.join(' · ')}</span>
          {/* Template disediakan dalam .xlsx karena berkas yang diunggah client
              juga .xlsx — memberi contoh dalam bentuk lain memaksa mereka
              mengubah format dulu, dan di situlah pemisah kolom sering rusak. */}
          <span className="inline-flex items-center gap-1">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-brand-600 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-500/10"
              onClick={() => void unduhTemplateXlsx()}
            >
              <Download size={13} /> Unduh template .xlsx
            </button>
            <button
              type="button"
              className="rounded-lg px-2 py-1 text-ink-500 hover:bg-ink-100 dark:text-ink-400 dark:hover:bg-ink-800"
              onClick={() =>
                downloadFile('template-penjualan-kasir.csv', buildSalesTemplate(), 'text/csv')
              }
            >
              .csv
            </button>
          </span>
        </div>

        {plan && (
          <div className="space-y-2">
            <div className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-900 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-100">
              Terbaca sebagai <strong>{plan.layoutLabel}</strong>.
              {plan.layout !== 'kasir' && ' Kolomnya dipetakan otomatis.'}
            </div>

            <label className="block text-xs">
              <span className="mb-1 block text-ink-500 dark:text-ink-400">
                Channel tujuan{' '}
                <span className="text-ink-400">
                  (isi bila punya lebih dari satu toko di marketplace yang sama)
                </span>
              </span>
              <select
                className="input !py-1.5"
                value={channelCode}
                disabled={busy}
                onChange={(e) => setChannelCode(e.target.value)}
              >
                <option value="">Ikuti berkas</option>
                {channels.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-3 gap-2">
              <Stat label="Pesanan" value={formatNumber(plan.orders.length)} />
              <Stat label="Baris barang" value={formatNumber(plan.totalRows)} />
              <Stat label="Nilai" value={formatMoney(totalNilai, currency)} />
            </div>

            {plan.unmatched > 0 && (
              <div className="rounded-xl border border-ink-200 px-3 py-2 text-xs dark:border-ink-700">
                <strong>{formatNumber(plan.unmatched)} baris</strong> SKU-nya tidak ada di katalog.
                Barisnya tetap masuk, tapi tidak tertaut ke produk — laporan penjualan per produk
                tidak akan menghitungnya.
              </div>
            )}

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
