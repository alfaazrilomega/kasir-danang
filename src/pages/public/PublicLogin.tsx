import { useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from '@/lib/router';
import { useCustomer } from '@/lib/customerAccount';
import { DialogMasuk, KerangkaAuth, tujuanAman, useLayarLebar } from '@/components/public/KerangkaAuth';
import { FormMasuk } from '@/components/public/FormMasuk';
import { PublicCatalog } from '@/pages/public/PublicCatalog';

/**
 * Alamat /toko/masuk (dibuka langsung, dari tautan yang disalin, atau hasil
 * alihan halaman yang butuh akun). Di layar lebar tampil sebagai pop-up di
 * atas beranda toko; di HP sebagai halaman penuh yang ringkas. Tautan di
 * dalam toko sendiri membuka pop-up tanpa lewat alamat ini (lihat ModalMasuk).
 */
export function PublicLogin() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const next = tujuanAman(params.get('next'));
  const mode = params.get('tab') === 'daftar' ? 'daftar' : 'masuk';
  const lebar = useLayarLebar();

  useEffect(() => {
    // Sudah masuk: langsung ke tujuan.
    if (useCustomer.getState().token) navigate(next, { replace: true });
    // Hanya saat halaman dibuka.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function gantiMode(m: 'masuk' | 'daftar') {
    const p = new URLSearchParams(search);
    if (m === 'daftar') p.set('tab', 'daftar');
    else p.delete('tab');
    const q = p.toString();
    navigate(`/toko/masuk${q ? `?${q}` : ''}`, { replace: true });
  }

  const form = <FormMasuk mode={mode} onMode={gantiMode} next={next} onBerhasil={() => navigate(next)} />;

  if (lebar) {
    return (
      <>
        <PublicCatalog />
        <DialogMasuk onTutup={() => navigate('/toko', { replace: true })}>{form}</DialogMasuk>
      </>
    );
  }
  return <KerangkaAuth>{form}</KerangkaAuth>;
}
