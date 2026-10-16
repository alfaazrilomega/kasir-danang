import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from '@/lib/router';
import { useModalMasuk } from '@/stores/modalMasuk';
import { DialogMasuk } from '@/components/public/KerangkaAuth';
import { FormMasuk } from '@/components/public/FormMasuk';
import { FormLupaSandi } from '@/components/public/FormLupaSandi';

/**
 * Pop-up masuk/daftar/lupa sandi yang dibuka dari tautan di toko (layar lebar).
 * Halaman yang sedang dibuka tetap di belakang; pop-up ditutup otomatis bila
 * pembeli berpindah halaman (mis. membuka Syarat & Ketentuan).
 */
export function ModalMasuk() {
  const { buka, mode, next, idAwal, setMode, tutup } = useModalMasuk();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const halamanAwal = useRef(pathname);

  useEffect(() => {
    if (pathname === halamanAwal.current) return;
    halamanAwal.current = pathname;
    tutup();
  }, [pathname, tutup]);

  if (!buka) return null;

  const selesai = () => {
    tutup();
    if (next) navigate(next);
  };

  return (
    <DialogMasuk onTutup={tutup}>
      {mode === 'lupa' ? (
        <FormLupaSandi idAwal={idAwal} onKembaliMasuk={() => setMode('masuk')} onSelesai={selesai} />
      ) : (
        <FormMasuk
          mode={mode}
          onMode={(m) => setMode(m)}
          next={next}
          idAwal={idAwal}
          onLupa={(id) => setMode('lupa', id)}
          onBerhasil={selesai}
        />
      )}
    </DialogMasuk>
  );
}
