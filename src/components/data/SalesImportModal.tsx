// Modal impor penjualan massal.
//
// Alurnya sengaja dua langkah: unggah berkas dulu, lihat rencananya, baru
// dijalankan. Impor buta ke data penjualan terlalu mahal untuk dibatalkan.
//
// Berkas mentah Shopee dan TikTok (.xlsx) diterima apa adanya. Susunan kolom
// yang terdeteksi ditampilkan sebelum tombol impor ditekan, supaya tebakan
// sistem bisa diperiksa mata dulu.
//
// Dua jenis berkas diurus di sini karena keduanya datang dari tempat yang sama
// di kepala client ("data penjualan dari marketplace"): ekspor PESANAN berisi
// harga tayang, dan laporan PENCAIRAN berisi uang yang benar-benar masuk.
// Memisahnya ke dua menu membuat yang kedua tidak pernah ketemu.

import { useEffect, useState } from 'react';
import { AlertTriangle, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { db } from '@/lib/db';
import { resolveChannels } from '@/lib/channels';
import { downloadFile } from '@/lib/dataTransfer';
import { formatMoney, formatNumber, errorMessage, cn } from '@/lib/format';
import { buildXlsx, downloadBlob, readSpreadsheet } from '@/lib/spreadsheet';
import {
  buildSalesTemplate,
  buildSalesTemplateRows,
  planSalesImport,
  runSalesImport,
  SALES_COLUMNS,
  type SalesImportPlan,
} from '@/lib/salesImport';
import {
  planPencairan,
  runPencairan,
  type RencanaPencairan,
} from '@/lib/settlementImport';

interface Props {
  open: boolean;
  storeId: string;
  currency?: string;
  onClose: () => void;
  onDone: () => void;
}

export function SalesImportModal({ open, storeId, currency, onClose, onDone }: Props) {
  const [jenis, setJenis] = useState<'pesanan' | 'pencairan'>('pesanan');
  const [plan, setPlan] = useState<SalesImportPlan | null>(null);
  const [cair, setCair] = useState<RencanaPencairan | null>(null);
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
    setCair(null);
    setFileName('');
    setRows(null);
    setChannelCode('');
  }

  // Berpindah jenis selalu membuang rencana sebelumnya. Rencana pesanan dan
  // rencana pencairan menulis hal yang sangat berbeda; menyisakan salah satunya
  // di layar berarti satu klik salah bisa menerapkan yang keliru.
  function gantiJenis(nilai: 'pesanan' | 'pencairan') {
    reset();
    setJenis(nilai);
  }

  async function pilihBerkasPencairan(file: File) {
    setBusy(true);
    try {
      const hasil = await planPencairan(file, storeId);
      setFileName(file.name);
      setCair(hasil);
      if (!hasil.layout) toast.error(hasil.galat[0] ?? 'Susunan berkas tidak dikenali.');
      else if (!hasil.baris.length) {
        toast.info('Tidak ada pesanan di berkas ini yang cocok dengan data aplikasi.');
      }
    } catch (e) {
      toast.error(errorMessage(e, 'Gagal membaca berkas.'));
    } finally {
      setBusy(false);
    }
  }

  async function jalankanPencairan() {
    if (!cair?.baris.length) return;
    setBusy(true);
    try {
      const jumlah = await runPencairan(cair, storeId);
      toast.success(`${formatNumber(jumlah)} pesanan diperbarui dengan data pencairan.`);
      reset();
      onDone();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e, 'Gagal menyimpan pencairan.'));
    } finally {
      setBusy(false);
    }
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
      title={jenis === 'pesanan' ? 'Impor Penjualan Massal' : 'Impor Pencairan Dana'}
      size="lg"
    >
      <div className="space-y-3">
        <div className="flex gap-1 rounded-full bg-ink-100 p-1 text-xs font-semibold dark:bg-ink-800">
          {([
            ['pesanan', 'Pesanan'],
            ['pencairan', 'Pencairan'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={jenis === value}
              disabled={busy}
              onClick={() => gantiJenis(value)}
              className={cn(
                'flex-1 rounded-full px-3 py-1.5 transition',
                jenis === value ? 'bg-brand-600 text-white' : 'text-ink-600 dark:text-ink-300',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {jenis === 'pesanan' ? (
        <>
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
        </>
        ) : (
        <>
        <p className="text-xs text-ink-500 dark:text-ink-400">
          Untuk mencatat uang yang <strong>benar-benar cair</strong> ke saldo penjual. Unggah{' '}
          <strong>laporan saldo Shopee</strong> (my_balance_transaction_report) atau{' '}
          <strong>laporan pendapatan TikTok</strong> (income). Selisih antara harga tayang dan
          dana cair dicatat sebagai potongan marketplace.
        </p>

        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          <AlertTriangle size={13} className="mr-1 inline" />
          Impor ini <strong>hanya memperbarui pesanan yang sudah ada</strong>. Tidak membuat
          pesanan baru, tidak mengubah stok, dan tidak mengubah total pesanan.
        </div>

        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-ink-300 px-3 py-6 text-sm hover:border-brand-500 dark:border-ink-600">
          <Upload size={16} />
          <span>{fileName || 'Pilih laporan pencairan (.xlsx atau .csv)'}</span>
          <input
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void pilihBerkasPencairan(f);
              e.target.value = '';
            }}
          />
        </label>

        {cair && (
          <div className="space-y-2">
            <div className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-900 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-100">
              Terbaca sebagai <strong>{cair.layoutLabel}</strong>.
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Stat label="Pesanan cocok" value={formatNumber(cair.baris.length)} />
              <Stat label="Dana cair" value={formatMoney(cair.totalNet, currency)} />
              <Stat label="Potongan" value={formatMoney(cair.totalFee, currency)} />
            </div>

            {cair.diperbarui > 0 && (
              <div className="rounded-xl border border-ink-200 px-3 py-2 text-xs dark:border-ink-700">
                <strong>{formatNumber(cair.diperbarui)} pesanan</strong> sudah pernah dicairkan
                sebelumnya. Angkanya akan ditimpa dengan isi berkas ini.
              </div>
            )}

            {cair.dilewati > 0 && (
              <div className="rounded-xl border border-ink-200 px-3 py-2 text-xs dark:border-ink-700">
                <strong>{formatNumber(cair.dilewati)} baris dilewati</strong> karena bukan
                pendapatan per pesanan (penarikan saldo, penyesuaian, penggantian biaya).
              </div>
            )}

            {cair.tidakCocok.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                <strong>{formatNumber(cair.tidakCocok.length)} nomor pesanan</strong> ada di
                laporan tapi belum ada di aplikasi, jadi pesanannya belum pernah diimpor:{' '}
                <span className="font-mono">{cair.tidakCocok.slice(0, 10).join(', ')}</span>
                {cair.tidakCocok.length > 10 && ` dan ${cair.tidakCocok.length - 10} lainnya`}.
              </div>
            )}

            {cair.galat.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-500/30 dark:bg-amber-500/10">
                <div className="mb-1 text-xs font-semibold text-amber-900 dark:text-amber-100">
                  {formatNumber(cair.galat.length)} catatan
                </div>
                <ul className="space-y-0.5 text-[11px] text-amber-900 dark:text-amber-100">
                  {cair.galat.slice(0, 40).map((g) => (
                    <li key={g}>{g}</li>
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
          <Button onClick={() => void jalankanPencairan()} disabled={busy || !cair?.baris.length}>
            <FileSpreadsheet size={15} />
            {busy ? 'Memproses…' : `Terapkan ${formatNumber(cair?.baris.length ?? 0)} Pencairan`}
          </Button>
        </div>
        </>
        )}
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
