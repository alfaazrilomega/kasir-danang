// Runtime config for shared deployments/computers.
// Empty apiBaseUrl means the browser uses the same domain for frontend and API.
window.KASIR_CONFIG = {
  apiBaseUrl: '',
};

// Halaman masuk staf (/pintu-...) harus datang dari server, bukan dari cache
// service worker: hanya server yang memasang cookie gerbang dan penanda
// window.KASIR_PINTU_ADMIN (disisipkan sebelum berkas ini dimuat). Kalau
// penandanya tidak ada, service worker dilepas lalu halaman dimuat ulang sekali.
(function () {
  try {
    if (location.pathname.indexOf('/pintu-') !== 0 || window.KASIR_PINTU_ADMIN) return;
    if (!('serviceWorker' in navigator)) return;
    var KUNCI = 'kasir.pintu.dimuat-ulang';
    if (sessionStorage.getItem(KUNCI) === location.href) return;
    sessionStorage.setItem(KUNCI, location.href);
    navigator.serviceWorker.getRegistrations().then(function (daftar) {
      return Promise.all(daftar.map(function (r) { return r.unregister(); }));
    }).then(function () { location.reload(); }, function () { location.reload(); });
  } catch (e) {
    // biarkan
  }
})();

// Penyelamat cangkang lama.
//
// Service worker menyajikan index.html dari cache, jadi pengunjung yang pernah
// membuka toko sebelum sebuah rilis masih memuat aplikasi versi lama pada
// kunjungan pertama setelah deploy. Aplikasi lama tidak mengenal alamat yang
// baru ditambahkan dan melempar pengunjung ke /toko: klik affiliate hilang dan
// pengunjung tidak tiba di produk yang dibagikan.
//
// Berkas ini tidak pernah di-cache, jadi di sinilah cangkang lama bisa
// dikenali: index.html sejak rilis affiliate membawa data-cangkang="2" di
// <html>, yang lama tidak. Untuk alamat di bawah, service worker lama dilepas
// lalu alamat yang sama dimuat ulang dari server. Dicoba satu kali per alamat.
//
// Rilis berikutnya yang menambah alamat baru: naikkan angka data-cangkang di
// index.html, lalu tambahkan alamatnya di sini dengan angka itu.
(function () {
  try {
    var jalur = location.pathname;
    var sejak2 = jalur.indexOf('/aff/') === 0 || jalur === '/toko/affiliate' || jalur === '/affiliate';
    // Alamat produk dari nama (permintaan 20), sejak data-cangkang="3".
    var sejak3 = jalur.indexOf('/toko/produk/') === 0;
    var butuh = sejak3 ? 3 : sejak2 ? 2 : 0;
    if (!butuh) return;
    if (Number(document.documentElement.getAttribute('data-cangkang')) >= butuh) return;
    if (!('serviceWorker' in navigator)) return;
    var KUNCI = 'kasir.cangkang.dimuat-ulang';
    var tujuan = location.href;
    if (sessionStorage.getItem(KUNCI) === tujuan) return;
    sessionStorage.setItem(KUNCI, tujuan);
    var sudah = false;
    var muatUlang = function () {
      if (sudah) return;
      sudah = true;
      location.replace(tujuan);
    };
    navigator.serviceWorker
      .getRegistrations()
      .then(function (daftar) {
        return Promise.all(
          daftar.map(function (r) {
            return r.unregister();
          }),
        );
      })
      .then(muatUlang, muatUlang);
    setTimeout(muatUlang, 4000);
  } catch (_) {
    // Penyimpanan sesi diblokir atau browser tanpa service worker: biarkan aplikasi berjalan apa adanya.
  }
})();
