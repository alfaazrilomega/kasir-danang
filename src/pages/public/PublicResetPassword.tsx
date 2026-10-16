import { useLocation, useNavigate } from '@/lib/router';
import { DialogMasuk, KerangkaAuth, tujuanAman, useLayarLebar } from '@/components/public/KerangkaAuth';
import { FormLupaSandi } from '@/components/public/FormLupaSandi';
import { PublicCatalog } from '@/pages/public/PublicCatalog';

/**
 * Alamat /toko/lupa-sandi. Sama seperti /toko/masuk: pop-up di atas beranda
 * di layar lebar, halaman penuh ringkas di HP.
 */
export function PublicResetPassword() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const nextParam = params.get('next');
  const next = tujuanAman(nextParam);
  const lebar = useLayarLebar();
  const alamatMasuk = `/toko/masuk${nextParam ? `?next=${encodeURIComponent(next)}` : ''}`;

  const form = (
    <FormLupaSandi idAwal={params.get('id') ?? ''} onKembaliMasuk={() => navigate(alamatMasuk)} onSelesai={() => navigate(next)} />
  );

  if (lebar) {
    return (
      <>
        <PublicCatalog />
        <DialogMasuk onTutup={() => navigate('/toko', { replace: true })}>{form}</DialogMasuk>
      </>
    );
  }
  return <KerangkaAuth kembali={alamatMasuk}>{form}</KerangkaAuth>;
}
