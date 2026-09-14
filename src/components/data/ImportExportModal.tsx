// Modal Impor / Ekspor data master.
//
// Menggantikan tombol "Seed 1000+ Data": untuk serah terima ke client yang
// dibutuhkan bukan data dummy, melainkan cara memasukkan katalog aslinya.
//
// Alur impor sengaja dua langkah — pilih berkas, lihat RENCANA, baru jalankan.
// Impor mode "ganti total" menghapus seluruh produk, jadi pengguna harus tahu
// persis apa yang akan terjadi sebelum menekan tombolnya.

import { useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  FileSpreadsheet,
  FileUp,
  Loader2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { cn, errorMessage, formatNumber } from '@/lib/format';
import {
  buildProductTemplate,
  downloadFile,
  exportProductsCsv,
  exportProductsSql,
  planProductImport,
  runProductImport,
  type ImportMode,
  type ImportPlan,
} from '@/lib/dataTransfer';
import { ImporPelanggan } from '@/components/data/CustomerImportModal';

type Tab = 'pilih' | 'impor' | 'ekspor';

interface Props {
  open: boolean;
  storeId: string;
  onClose: () => void;
  /** Dipanggil setelah impor sukses supaya halaman pemanggil menyegarkan data. */
  onImported?: () => void;
}

export function ImportExportModal({ open, storeId, onClose, onImported }: Props) {
  const [tab, setTab] = useState<Tab>('pilih');
  // Produk (katalog) atau pelanggan (butir 5.1 sheet client), dalam satu pintu di dashboard.
  const [jenis, setJenis] = useState<'produk' | 'pelanggan'>('produk');
  // Default GABUNG, bukan ganti total: mengunggah beberapa SKU baru saja
  // dengan mode ganti total akan mengarsipkan semua produk lain.
  const [mode, setMode] = useState<ImportMode>('merge');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setTab('pilih');
    setJenis('produk');
    setPlan(null);
    setFileName('');
    setBusy(false);
  }

  function close() {
    reset();
    onClose();
  }

  async function onPickFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      const next = await planProductImport(text, storeId, mode);
      setPlan(next);
      setFileName(file.name);
      if (!next.rows.length) {
        toast.error('Tidak ada baris yang bisa diimpor. Periksa daftar masalah di bawah.');
      }
    } catch (e) {
      toast.error(errorMessage(e, 'Gagal membaca berkas.'));
    } finally {
      setBusy(false);
    }
  }

  /** Rencana dihitung ulang saat mode berubah karena jumlah hapus ikut berubah. */
  async function changeMode(next: ImportMode) {
    setMode(next);
    if (!plan) return;
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      setPlan(await planProductImport(await file.text(), storeId, next));
    } finally {
      setBusy(false);
    }
  }

  async function execute() {
    if (!plan || !plan.rows.length) return;
    const warning =
      plan.mode === 'replace'
        ? `GANTI ${formatNumber(plan.willDelete)} produk yang ada sekarang dengan ${formatNumber(plan.rows.length)} produk dari berkas. Produk yang pernah dipakai transaksi akan dinonaktifkan, bukan dihapus.\n\nTindakan ini tidak bisa dibatalkan. Lanjutkan?`
        : `Perbarui ${formatNumber(plan.toUpdate)} produk dan tambah ${formatNumber(plan.toCreate)} produk baru. Lanjutkan?`;
    if (!confirm(warning)) return;

    setBusy(true);
    try {
      const res = await runProductImport(plan, storeId);
      if (res.serverErrors.length) {
        toast.warning(
          `Impor selesai untuk data lokal, tetapi ${res.serverErrors.length} operasi ditolak server. ` +
            `Contoh: ${res.serverErrors[0]}`,
          { duration: 12000 },
        );
      } else {
        toast.success(
          `${formatNumber(res.products)} produk, ${res.categories} kategori baru, ` +
            (res.sets ? `${formatNumber(res.sets)} produk set, ` : '') +
            `${formatNumber(res.channelSkus)} SKU platform diimpor.`,
        );
      }
      onImported?.();
      close();
    } catch (e) {
      toast.error(errorMessage(e, 'Impor gagal.'));
    } finally {
      setBusy(false);
    }
  }

  async function doExport(kind: 'csv' | 'sql') {
    setBusy(true);
    try {
      const n = kind === 'csv' ? await exportProductsCsv(storeId) : await exportProductsSql(storeId);
      if (!n) {
        toast.message('Belum ada produk untuk diekspor.');
        return;
      }
      toast.success(kind === 'csv' ? `${formatNumber(n)} produk diekspor ke CSV.` : `${formatNumber(n)} baris diekspor ke SQL.`);
    } catch (e) {
      toast.error(errorMessage(e, 'Ekspor gagal.'));
    } finally {
      setBusy(false);
    }
  }

  const blocking = plan?.issues.length ? plan.issues : [];

  return (
    <Modal open={open} onClose={close} title="Impor / Ekspor Data" size="lg">
      {(tab === 'pilih' || jenis === 'pelanggan') && (
        <div className="mb-4 flex gap-1 rounded-full bg-ink-100 p-1 text-xs font-semibold dark:bg-ink-800">
          {([
            ['produk', 'Produk'],
            ['pelanggan', 'Pelanggan'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={jenis === value}
              onClick={() => setJenis(value)}
              className={cn(
                'flex-1 rounded-full px-3 py-1.5 transition',
                jenis === value ? 'bg-brand-600 text-white' : 'text-ink-600 dark:text-ink-300',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {jenis === 'pelanggan' ? (
        <ImporPelanggan storeId={storeId} onSelesai={close} onBatal={close} />
      ) : (
      <>
      {tab === 'pilih' && (
        <div className="space-y-3">
          <p className="text-sm text-ink-500 dark:text-ink-400">
            Pilih tindakan. Impor dipakai untuk memasukkan katalog asli toko dari berkas CSV;
            ekspor dipakai untuk mengambil salinan data yang sekarang.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              onClick={() => setTab('impor')}
              className="rounded-2xl border border-ink-200 p-4 text-left transition hover:border-brand-400 hover:bg-brand-50/50 dark:border-ink-700 dark:hover:bg-brand-950/20"
            >
              <div className="flex items-center gap-2 font-semibold">
                <Upload size={18} className="text-brand-600" /> Impor dari berkas
              </div>
              <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
                Unggah CSV berisi produk. Bisa mengganti seluruh data yang ada, atau menggabung
                berdasarkan SKU.
              </p>
            </button>
            <button
              onClick={() => setTab('ekspor')}
              className="rounded-2xl border border-ink-200 p-4 text-left transition hover:border-brand-400 hover:bg-brand-50/50 dark:border-ink-700 dark:hover:bg-brand-950/20"
            >
              <div className="flex items-center gap-2 font-semibold">
                <Download size={18} className="text-brand-600" /> Ekspor data
              </div>
              <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
                Unduh data produk yang sekarang sebagai CSV (bisa diimpor ulang) atau SQL.
              </p>
            </button>
          </div>

          <div className="rounded-2xl border border-dashed border-ink-200 p-4 dark:border-ink-700">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <FileSpreadsheet size={16} className="text-emerald-600" /> Berkas template untuk client
            </div>
            <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
              Unduh dan serahkan berkas ini ke client. Isinya sudah sesuai format database, lengkap
              dengan tiga baris contoh yang bisa dihapus.
            </p>
            <Button
              variant="secondary"
              className="mt-3"
              onClick={() => {
                downloadFile('template-produk-kasir.csv', buildProductTemplate(), 'text/csv');
                toast.success('Template diunduh.');
              }}
            >
              <Download size={14} /> Unduh Template CSV
            </Button>
          </div>
        </div>
      )}

      {tab === 'impor' && (
        <div className="space-y-3">
          <div>
            <div className="mb-1.5 text-sm font-medium">Cara memasukkan data</div>
            <div className="flex gap-1 rounded-full bg-ink-100 p-1 text-xs font-semibold dark:bg-ink-800">
              {([
                ['replace', 'Ganti total'],
                ['merge', 'Gabung per SKU'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => changeMode(value)}
                  className={cn(
                    'flex-1 rounded-full px-3 py-1.5 transition',
                    mode === value ? 'bg-brand-600 text-white' : 'text-ink-600 dark:text-ink-300',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-ink-500 dark:text-ink-400">
              {mode === 'replace'
                ? 'Seluruh produk yang ada sekarang dihapus, lalu diganti isi berkas. Dipakai saat pertama kali menyerahkan sistem ke client.'
                : 'Produk dengan SKU yang sama diperbarui, SKU baru ditambahkan. Produk lain dibiarkan.'}
            </p>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => onPickFile(e.target.files?.[0])}
          />
          <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
            <FileUp size={14} /> {fileName || 'Pilih berkas CSV…'}
          </Button>

          {busy && !plan && (
            <p className="flex items-center gap-2 text-sm text-ink-500">
              <Loader2 size={14} className="animate-spin" /> Memeriksa berkas…
            </p>
          )}

          {plan && (
            <div className="space-y-2">
              <div className={`grid gap-2 ${plan.sets > 0 ? 'sm:grid-cols-5' : 'sm:grid-cols-4'}`}>
                <Stat label="Produk baru" value={plan.toCreate} tone="emerald" />
                <Stat label="Diperbarui" value={plan.toUpdate} tone="brand" />
                <Stat label="Kategori" value={plan.categories.length} />
                <Stat label="SKU platform" value={plan.channelSkus} />
                {plan.sets > 0 && <Stat label="Produk set" value={plan.sets} />}
              </div>
              <p className="text-[11px] text-ink-500">
                Kolom isi_set: SKU isi dipisah koma, tambah " x2" bila jumlahnya lebih dari satu.
                Kolom yang dikosongkan tidak mengubah data lama.
              </p>

              {plan.mode === 'replace' && plan.willDelete > 0 && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>
                    <strong>{formatNumber(plan.willDelete)} produk</strong> yang ada sekarang akan
                    diganti. Produk yang pernah terjual atau pernah dibeli tidak dihapus,
                    melainkan dinonaktifkan supaya riwayat transaksinya tetap utuh.
                  </span>
                </div>
              )}

              {blocking.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-500/30 dark:bg-amber-500/10">
                  <div className="flex items-center gap-2 text-xs font-semibold text-amber-900 dark:text-amber-100">
                    <AlertTriangle size={14} /> {blocking.length} baris dilewati
                  </div>
                  <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto text-[11px] text-amber-900 dark:text-amber-100">
                    {blocking.slice(0, 20).map((iss, i) => (
                      <li key={i}>Baris {iss.row}: {iss.message}</li>
                    ))}
                    {blocking.length > 20 && <li>…dan {blocking.length - 20} lainnya.</li>}
                  </ul>
                </div>
              )}

              {plan.rows.length > 0 && blocking.length === 0 && (
                <p className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 size={14} /> Semua baris valid.
                </p>
              )}
            </div>
          )}

          <div className="flex justify-between gap-2 border-t border-ink-100 pt-3 dark:border-ink-800">
            <Button variant="ghost" onClick={() => setTab('pilih')} disabled={busy}>
              Kembali
            </Button>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={close} disabled={busy}>
                Batal
              </Button>
              <Button onClick={execute} disabled={busy || !plan?.rows.length}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {plan?.mode === 'replace' ? 'Ganti Semua Produk' : 'Jalankan Impor'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {tab === 'ekspor' && (
        <div className="space-y-3">
          <p className="text-sm text-ink-500 dark:text-ink-400">
            Pilih format. CSV memakai kolom yang sama dengan template, jadi hasilnya bisa diedit lalu
            diimpor kembali.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              onClick={() => doExport('csv')}
              disabled={busy}
              className="rounded-2xl border border-ink-200 p-4 text-left transition hover:border-brand-400 disabled:opacity-50 dark:border-ink-700"
            >
              <div className="flex items-center gap-2 font-semibold">
                <FileSpreadsheet size={18} className="text-emerald-600" /> CSV
              </div>
              <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
                Untuk diedit di Excel dan diimpor ulang.
              </p>
            </button>
            <button
              onClick={() => doExport('sql')}
              disabled={busy}
              className="rounded-2xl border border-ink-200 p-4 text-left transition hover:border-brand-400 disabled:opacity-50 dark:border-ink-700"
            >
              <div className="flex items-center gap-2 font-semibold">
                <Database size={18} className="text-brand-600" /> SQL
              </div>
              <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
                Untuk pindah server. Aman dijalankan ulang.
              </p>
            </button>
          </div>
          <div className="flex justify-between border-t border-ink-100 pt-3 dark:border-ink-800">
            <Button variant="ghost" onClick={() => setTab('pilih')} disabled={busy}>
              Kembali
            </Button>
            <Button variant="secondary" onClick={close} disabled={busy}>
              Tutup
            </Button>
          </div>
        </div>
      )}
      </>
      )}
    </Modal>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'emerald' | 'brand' }) {
  return (
    <div className="rounded-xl border border-ink-200 px-3 py-2 dark:border-ink-700">
      <div className="text-[11px] uppercase tracking-wide text-ink-500">{label}</div>
      <div
        className={cn(
          'mt-0.5 text-lg font-bold',
          tone === 'emerald' && 'text-emerald-600',
          tone === 'brand' && 'text-brand-600',
        )}
      >
        {formatNumber(value)}
      </div>
    </div>
  );
}
