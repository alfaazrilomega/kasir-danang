// Rantai pembayaran cadangan (spec 0002, AC-1 sampai AC-4): layanan utama
// pilihan admin dicoba dulu, lalu layanan aktif lain dengan urutan Tripay,
// Mayar, DOKU. Hanya layanan yang aktif dan berkunci lengkap yang ikut.
import { loadIntegration } from './settings.js';
import { selectedGateway } from './payments.js';
import * as tripay from './tripay.js';
import { channelAllowed, paymentInvoice } from './tripayInvoice.js';
import * as mayar from './mayar.js';
import * as doku from './doku.js';

export const URUTAN_GATEWAY = ['tripay', 'mayar', 'doku'];
export const NAMA_GATEWAY = { tripay: 'Tripay', mayar: 'Mayar', doku: 'DOKU' };
const AKTIF = { tripay: tripay.tripayAktif, mayar: mayar.mayarAktif, doku: doku.dokuAktif };

/** [{ provider, config }] layanan aktif, layanan utama pertama. Kosong bila toko memilih manual. */
export async function rantaiGateway(db, storeId) {
  const utama = await selectedGateway(db, storeId);
  if (utama === 'manual') return [];
  const rantai = [];
  for (const provider of [utama, ...URUTAN_GATEWAY.filter((p) => p !== utama)]) {
    if (!AKTIF[provider]) continue;
    const config = await loadIntegration(db, storeId, provider);
    if (AKTIF[provider](config)) rantai.push({ provider, config });
  }
  return rantai;
}

// DOKU Checkout menampilkan metode yang aktif di akun DOKU toko, jadi checkout
// cukup menampilkan satu pilihan (spec 0002, AS-1).
export const KANAL_DOKU = {
  code: 'DOKU', name: 'Bayar lewat DOKU', group: 'Pembayaran online', active: true,
  description: 'Pilih virtual account, QRIS, dompet digital, atau minimarket di halaman DOKU.',
  fee_flat: 0, fee_percent: 0, fee_customer: 0, minimum_amount: 1, icon_url: null,
};

/** Kanal checkout satu layanan. Melempar galat bila layanan tidak dapat dihubungi. */
export async function kanalCheckout(provider, config, amount) {
  if (provider === 'doku') return [KANAL_DOKU];
  if (provider === 'mayar') {
    const channels = await mayar.daftarKanal(config);
    const inline = mayar.checkoutChannels(channels);
    const other = channels.filter((c) => c.active && !mayar.inlineMethod(c));
    return [
      ...inline,
      ...(other.length ? [{ code: 'MAYAR', name: 'Metode lainnya melalui Mayar', group: 'Pembayaran lainnya', active: true,
        description: `Memerlukan halaman Mayar: ${other.map((c) => c.name).join(', ')}.`,
        fee_flat: 0, fee_percent: 0, fee_customer: 0, minimum_amount: 1 }] : []),
    ];
  }
  const kanal = await tripay.daftarKanal(config);
  let fees = [];
  if (amount !== null && kanal.some(tripay.kanalAktif)) fees = await tripay.hitungBiaya(amount, config);
  return kanal.filter((k) => tripay.kanalAktif(k) && channelAllowed(k, config)).map((k) => {
    const fee = fees.find((item) => item.code === k.code)?.total_fee?.customer;
    return { ...tripay.kanalPublik(k), fee_customer: fee != null && Number.isSafeInteger(Number(fee)) && Number(fee) >= 0 ? Number(fee) : null };
  });
}

/** Kanal pertama dari rantai yang bisa dihubungi dan punya kanal aktif. */
export async function kanalDariRantai(rantai, amount) {
  const gagal = [];
  for (const { provider, config } of rantai) {
    try {
      const channels = await kanalCheckout(provider, config, amount);
      if (channels.length) return { provider, config, channels, gagal };
      gagal.push(`${provider}: tidak ada kanal aktif`);
    } catch (error) {
      gagal.push(`${provider}: ${error?.message || error}`);
    }
  }
  return { provider: null, config: null, channels: [], gagal };
}

// Kode bank dari kanal Tripay (BRIVA, BCAVA, ...) atau Mayar (VA/BNI).
function bankDari(kode) {
  const k = String(kode || '').toUpperCase();
  if (k.startsWith('VA/')) return k.slice(3);
  if (k === 'BRIVA') return 'BRI';
  const m = /^([A-Z]+)VA$/.exec(k);
  return m && m[1] !== 'OTHERBANK' ? m[1] : null;
}

/**
 * Kanal setara di layanan cadangan untuk kanal yang dipilih pembeli (QRIS ke
 * QRIS, VA bank ke VA bank yang sama, selain itu halaman umum layanan itu).
 * null = layanan ini tidak bisa menggantikan untuk nominal ini.
 */
export async function kanalSetara(kanalAsal, provider, config, total) {
  const kode = String(kanalAsal || '').toUpperCase();
  const qris = kode.startsWith('QRIS');
  const bank = bankDari(kode);
  if (provider === 'doku') return { code: 'DOKU', kanal: null };
  if (provider === 'mayar') {
    const channels = await mayar.daftarKanal(config);
    const inline = mayar.checkoutChannels(channels);
    if (qris && inline.some((c) => c.code === 'QRIS')) return { code: 'QRIS', kanal: null };
    if (bank && inline.some((c) => c.code === `VA/${bank}`)) return { code: `VA/${bank}`, kanal: null };
    return channels.some((c) => c.active) ? { code: 'MAYAR', kanal: null } : null;
  }
  const channels = (await tripay.daftarKanal(config, true)).filter((k) => tripay.kanalAktif(k) && channelAllowed(k, config) && tripay.nominalSah(k, total));
  const sama = qris ? channels.find((k) => String(k.code).startsWith('QRIS'))
    : bank ? channels.find((k) => k.code === (bank === 'BRI' ? 'BRIVA' : `${bank}VA`)) : null;
  const pilih = sama || channels.find((k) => String(k.code).startsWith('QRIS'));
  return pilih ? { code: pilih.code, kanal: pilih } : null;
}

/**
 * Buat pembayaran di satu layanan. Mengembalikan kolom pesanan yang perlu
 * disimpan dan bentuk respons untuk checkout.
 */
export async function buatPembayaran(provider, config, { kode, kanalTripay }, p) {
  if (provider === 'tripay') {
    const trx = await tripay.buatTransaksi({
      method: kanalTripay.code, merchantRef: p.orderNumber, amount: p.total, customerName: p.customerName,
      // Tripay menolak transaksi tanpa email pembeli.
      customerEmail: p.customerEmail || `${p.customerPhone.replace(/\D/g, '') || 'pembeli'}@pesanan.web`,
      customerPhone: p.customerPhone, items: p.barisTripay,
      callbackUrl: config.callbackUrl || `${p.asalToko}/api/tripay/callback`,
      returnUrl: config.returnUrl || `${p.asalToko}/toko/akun?tab=pesanan`,
    }, config);
    const invoice = paymentInvoice(trx, kanalTripay, config, p.total);
    return {
      kolom: { channel: kanalTripay.code, reference: invoice.reference, transactionId: null, url: invoice.checkout_url,
        expiresAt: invoice.expired_time ? new Date(invoice.expired_time * 1000).toISOString() : null,
        instructions: null, details: invoice },
      respons: { provider: 'tripay', ...invoice, fee_customer: trx.fee_customer ?? 0 },
    };
  }
  if (provider === 'mayar') {
    const trx = await mayar.buatTransaksi({ orderId: p.orderId, orderNumber: p.orderNumber, amount: p.total, customerName: p.customerName,
      customerEmail: p.customerEmail || undefined, customerPhone: p.customerPhone,
      paymentMethod: kode === 'MAYAR' ? undefined : kode.toLowerCase() }, config);
    return {
      kolom: { channel: kode, reference: trx.reference, transactionId: trx.transactionId, url: trx.checkout_url,
        expiresAt: trx.expiresAt, instructions: trx.instructions },
      respons: { provider: 'mayar', channel: kode, channel_name: 'Mayar', reference: trx.reference, checkout_url: trx.checkout_url,
        amount: p.total, fee_customer: 0, expired_time: Date.parse(trx.expiresAt) / 1000 },
    };
  }
  const trx = await doku.buatTransaksi({ orderNumber: p.orderNumber, amount: p.total, customerName: p.customerName,
    customerEmail: p.customerEmail, customerPhone: p.customerPhone, callbackUrl: `${p.asalToko}/toko/akun?tab=pesanan` }, config);
  return {
    kolom: { channel: 'DOKU', reference: trx.reference, transactionId: trx.transactionId, url: trx.checkout_url,
      expiresAt: trx.expiresAt, instructions: null },
    respons: { provider: 'doku', channel: 'DOKU', channel_name: 'DOKU', reference: trx.reference, checkout_url: trx.checkout_url,
      amount: p.total, fee_customer: 0, expired_time: Date.parse(trx.expiresAt) / 1000 },
  };
}
