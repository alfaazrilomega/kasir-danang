export function checkoutMode(config) { return config?.checkoutMode === 'direct' ? 'direct' : 'redirect'; }
export function channelAllowed(channel, config) {
  return channel.active !== false && (checkoutMode(config) !== 'direct' || String(channel.type).toLowerCase() === 'direct');
}
function httpsUrl(value) {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
function plain(value) {
  return String(value ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').slice(0, 3000);
}
export function paymentInvoice(trx, channel, config, amount) {
  const mode = checkoutMode(config);
  const charged = Number(trx.amount ?? (amount + Number(trx.fee_customer || 0)));
  if (!Number.isFinite(charged) || charged <= 0) throw new Error('Nominal tagihan Tripay tidak valid.');
  return {
    checkout_mode: mode, channel: channel.code, channel_name: channel.name,
    reference: trx.reference ?? null,
    checkout_url: mode === 'redirect' ? httpsUrl(trx.checkout_url) : null,
    pay_code: trx.pay_code == null ? null : String(trx.pay_code).slice(0, 200),
    qr_url: httpsUrl(trx.qr_url),
    // Simpan payload utuh dari provider agar QR dapat diunduh tanpa ketergantungan CORS.
    qr_string: typeof trx.qr_string === 'string' && trx.qr_string.length > 0 && trx.qr_string.length <= 4096 ? trx.qr_string : null,
    amount: charged, base_amount: amount,
    expired_time: Number(trx.expired_time) > 0 ? Number(trx.expired_time) : null,
    instructions: (Array.isArray(trx.instructions) ? trx.instructions : []).slice(0, 12).map(item => ({
      title: plain(item?.title), steps: (Array.isArray(item?.steps) ? item.steps : []).slice(0, 30).map(plain),
    })),
  };
}
