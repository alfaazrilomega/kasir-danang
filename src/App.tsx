import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from '@/lib/router';
import { Toaster } from 'sonner';
import { AppShell } from '@/components/layout/AppShell';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { PinLockGate } from '@/components/pin/PinLockGate';
import { Dashboard } from '@/pages/Dashboard';
import { MenuPage } from '@/pages/Menu';
import { Orders } from '@/pages/Orders';
import OrderReturns from '@/pages/OrderReturns';
import { Customers } from '@/pages/Customers';
import { Products } from '@/pages/Products';
import { Suppliers } from '@/pages/Suppliers';
import { Purchases } from '@/pages/Purchases';
import { Promos } from '@/pages/Promos';
import { Settings } from '@/pages/Settings';
import { Login } from '@/pages/Login';
import { Shifts } from '@/pages/Shifts';
import { Reports } from '@/pages/Reports';
import { Expenses } from '@/pages/Expenses';
import { StockOpnamePage } from '@/pages/StockOpname';
import { StockMutation } from '@/pages/StockMutation';
import { ProductFeedback } from '@/pages/ProductFeedback';
import { UsersPage } from '@/pages/Users';
import { CustomerPortal } from '@/pages/CustomerPortal';
import { PublicCatalog } from '@/pages/public/PublicCatalog';
import { PublicProductDetail } from '@/pages/public/PublicProductDetail';
import { PublicCart } from '@/pages/public/PublicCart';
import { PublicCheckout } from '@/pages/public/PublicCheckout';
import { PublicOrderDone } from '@/pages/public/PublicOrderDone';
import { PublicLogin } from '@/pages/public/PublicLogin';
import { PublicResetPassword } from '@/pages/public/PublicResetPassword';
import { PublicKebijakanPrivasi, PublicSyaratKetentuan } from '@/pages/public/PublicKebijakan';
import { PublicAccount } from '@/pages/public/PublicAccount';
import { useAuth } from '@/stores/auth';
import { applyTheme, useUI } from '@/stores/ui';
import { applyAccent } from '@/lib/accents';
import { bindOnlineSync, flushPending } from '@/lib/sync';

export default function App() {
  const init = useAuth((s) => s.init);
  const theme = useUI((s) => s.theme);
  const accent = useUI((s) => s.accent);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    applyAccent(accent);
  }, [accent]);

  useEffect(() => {
    init();
    bindOnlineSync();
    void flushPending();
  }, [init]);

  // Pengaturan toko yang diubah dari perangkat lain (pajak, struk) terbaca
  // saat jendela kembali dipakai, dan berkala selama jendela terlihat untuk
  // tablet kasir yang tidak pernah berpindah jendela.
  const refreshStore = useAuth((s) => s.refreshStore);
  useEffect(() => {
    let terakhir = 0;
    const segarkan = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - terakhir < 10_000) return;
      terakhir = Date.now();
      void refreshStore();
    };
    window.addEventListener('focus', segarkan);
    document.addEventListener('visibilitychange', segarkan);
    const jeda = window.setInterval(segarkan, 60_000);
    return () => {
      window.removeEventListener('focus', segarkan);
      document.removeEventListener('visibilitychange', segarkan);
      window.clearInterval(jeda);
    };
  }, [refreshStore]);

  return (
    <BrowserRouter>
      <Toaster position="top-right" richColors closeButton />
      <PinLockGate>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<ProtectedRoute><AdminLayout><Dashboard /></AdminLayout></ProtectedRoute>} />
        <Route path="/menu" element={<ProtectedRoute><AdminLayout><MenuPage /></AdminLayout></ProtectedRoute>} />
        <Route path="/orders" element={<ProtectedRoute><AdminLayout><Orders /></AdminLayout></ProtectedRoute>} />
        <Route path="/returns" element={<ProtectedRoute><AdminLayout><OrderReturns /></AdminLayout></ProtectedRoute>} />
        <Route path="/customers" element={<ProtectedRoute><AdminLayout><Customers /></AdminLayout></ProtectedRoute>} />
        <Route path="/products" element={<ProtectedRoute><AdminLayout><Products /></AdminLayout></ProtectedRoute>} />
        <Route path="/suppliers" element={<ProtectedRoute><AdminLayout><Suppliers /></AdminLayout></ProtectedRoute>} />
        <Route path="/purchases" element={<ProtectedRoute><AdminLayout><Purchases /></AdminLayout></ProtectedRoute>} />
        <Route path="/promos" element={<ProtectedRoute><AdminLayout><Promos /></AdminLayout></ProtectedRoute>} />
        <Route path="/shifts" element={<ProtectedRoute><AdminLayout><Shifts /></AdminLayout></ProtectedRoute>} />
        <Route path="/stock-mutation" element={<ProtectedRoute><AdminLayout><StockMutation /></AdminLayout></ProtectedRoute>} />
        <Route path="/stock-opname" element={<ProtectedRoute><AdminLayout><StockOpnamePage /></AdminLayout></ProtectedRoute>} />
        <Route path="/feedback" element={<ProtectedRoute><AdminLayout><ProductFeedback /></AdminLayout></ProtectedRoute>} />
        <Route path="/expenses" element={<ProtectedRoute><AdminLayout><Expenses /></AdminLayout></ProtectedRoute>} />
        <Route path="/reports" element={<ProtectedRoute><AdminLayout><Reports /></AdminLayout></ProtectedRoute>} />
        <Route path="/users" element={<ProtectedRoute><AdminLayout><UsersPage /></AdminLayout></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><AdminLayout><Settings /></AdminLayout></ProtectedRoute>} />
        <Route path="/customer" element={<ProtectedRoute><AppShell><CustomerPortal /></AppShell></ProtectedRoute>} />
        <Route path="/toko" element={<PublicCatalog />} />
        <Route path="/toko/produk" element={<PublicProductDetail />} />
        <Route path="/toko/keranjang" element={<PublicCart />} />
        <Route path="/toko/checkout" element={<PublicCheckout />} />
        <Route path="/toko/selesai" element={<PublicOrderDone />} />
        <Route path="/toko/masuk" element={<PublicLogin />} />
        <Route path="/toko/lupa-sandi" element={<PublicResetPassword />} />
        <Route path="/toko/kebijakan-privasi" element={<PublicKebijakanPrivasi />} />
        <Route path="/toko/syarat-ketentuan" element={<PublicSyaratKetentuan />} />
        <Route path="/toko/akun" element={<PublicAccount />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </PinLockGate>
    </BrowserRouter>
  );
}
