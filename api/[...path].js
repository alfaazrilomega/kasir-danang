// Titik masuk API di Vercel.
//
// Seluruh backend adalah satu aplikasi Express. Vercel tidak menjalankan proses
// yang hidup terus, jadi aplikasi itu dibungkus sebagai satu serverless function
// yang menangani semua rute di bawah /api — persis seperti saat dijalankan
// lokal, hanya cara memanggilnya yang berbeda.
//
// Nama berkas memakai catch-all ([...path]) supaya /api/auth/signin,
// /api/query, /api/rpc/... dan sisanya sampai ke Express dengan path utuh.
import app from '../server/index.js';

export default app;

export const config = {
  // Impor produk bisa mengirim ribuan baris sekaligus; batas bawaan Vercel
  // terlalu kecil untuk itu.
  api: { bodyParser: false },
  maxDuration: 60,
};
