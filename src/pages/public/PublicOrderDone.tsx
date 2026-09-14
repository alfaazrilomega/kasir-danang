import { CheckCircle2, Copy, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { PublicShell, tautanWhatsApp } from '@/components/layout/PublicShell';
import { useTokoPublik } from '@/components/public/KerangkaAuth';
import { useLocation, useNavigate } from '@/lib/router';

const LANGKAH: Record<string, string> = {
  cash: 'Siapkan uang pas. Kurir menagih saat barang tiba, termasuk ongkirnya.',
  transfer: 'Transfer ke rekening toko setelah admin mengabari total akhir berikut ongkir, lalu kirim bukti bayarnya.',
  qris: 'Admin mengirim kode QRIS berikut total akhir termasuk ongkir lewat WhatsApp.',
};

/** Halaman setelah pesanan dibuat: nomor pesanan, status, dan cara melanjutkan. */
export function PublicOrderDone() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const orderNumber = params.get('order');
  const bayar = params.get('bayar') ?? '';
  const toko = useTokoPublik();
  const wa = tautanWhatsApp(
    toko?.shop_phone,
    orderNumber ? `Halo, saya mau konfirmasi pesanan ${orderNumber}.` : 'Halo, saya mau konfirmasi pesanan saya.',
  );

  return (
    <PublicShell>
      <div className="mx-auto max-w-lg rounded-lg bg-white p-6 shadow-card sm:p-8 dark:bg-ink-900">
        <div className="flex items-center gap-3">
          <CheckCircle2 size={28} className="shrink-0 text-emerald-500" />
          <div>
            <h1 className="text-lg font-bold leading-tight">Pesanan terkirim</h1>
            <span className="mt-1 inline-flex items-center gap-1.5 rounded bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
              <span className="h-1.5 w-1.5 rounded-full bg-current" /> Menunggu Konfirmasi
            </span>
          </div>
        </div>

        {orderNumber && (
          <div className="mt-5 rounded-lg border border-ink-100 bg-ink-50 px-4 py-3 dark:border-ink-800 dark:bg-ink-800/50">
            <div className="text-xs text-ink-500">Nomor pesanan</div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold tabular-nums">{orderNumber}</span>
              <button
                type="button"
                aria-label="Salin nomor pesanan"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(orderNumber)
                    .then(() => toast.success('Nomor pesanan disalin.'))
                    .catch(() => toast.error('Nomor pesanan gagal disalin.'));
                }}
                className="text-ink-400 transition-colors duration-150 hover:text-brand-600"
              >
                <Copy size={15} />
              </button>
            </div>
          </div>
        )}

        <ol className="mt-5 space-y-3 text-sm">
          <Langkah nomor={1} judul="Toko menghitung ongkir">
            Ongkir menyesuaikan alamat dan berat paket, lalu dikabari lewat WhatsApp berikut total akhirnya.
          </Langkah>
          <Langkah nomor={2} judul="Pembayaran">
            {LANGKAH[bayar] ?? 'Admin menghubungi Anda untuk menyelesaikan pembayaran.'}
          </Langkah>
          <Langkah nomor={3} judul="Pesanan dikirim">
            Status pesanan bisa dipantau kapan saja di menu Pesanan Saya.
          </Langkah>
        </ol>

        <div className="mt-6 flex flex-wrap gap-2">
          {wa && (
            <Button onClick={() => window.open(wa, '_blank', 'noopener')}>
              <MessageCircle size={15} /> Hubungi Admin di WhatsApp
            </Button>
          )}
          <Button variant="secondary" onClick={() => navigate('/toko/akun?tab=pesanan')}>
            Lihat Pesanan Saya
          </Button>
          <Button variant="ghost" onClick={() => navigate('/toko')}>
            Belanja Lagi
          </Button>
        </div>
      </div>
    </PublicShell>
  );
}

function Langkah({ nomor, judul, children }: { nomor: number; judul: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand-700 dark:bg-brand-950/40 dark:text-brand-200">
        {nomor}
      </span>
      <span>
        <span className="block font-medium">{judul}</span>
        <span className="block text-ink-500">{children}</span>
      </span>
    </li>
  );
}
