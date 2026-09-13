import { CheckCircle2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { PublicShell } from '@/components/layout/PublicShell';
import { useLocation, useNavigate } from '@/lib/router';

export function PublicOrderDone() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const orderNumber = new URLSearchParams(search).get('order');

  return (
    <PublicShell>
      <Card className="flex flex-col items-center gap-3 p-10 text-center">
        <CheckCircle2 size={48} className="text-emerald-500" />
        <h1 className="text-xl font-bold">Pesanan Terkirim</h1>
        {orderNumber && (
          <p className="text-sm text-ink-500">
            Nomor pesanan: <span className="font-semibold text-ink-800 dark:text-ink-100">{orderNumber}</span>
          </p>
        )}
        <p className="max-w-sm text-sm text-ink-500">
          Pesanan kamu sedang menunggu konfirmasi dari toko. Statusnya bisa dipantau di menu
          Pesanan Saya. Toko akan menghubungi lewat nomor HP yang kamu isi untuk pembayaran dan pengiriman.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="secondary" onClick={() => navigate('/toko')}>
            Kembali ke Katalog
          </Button>
          <Button onClick={() => navigate('/toko/akun')}>Lihat Pesanan Saya</Button>
        </div>
      </Card>
    </PublicShell>
  );
}
