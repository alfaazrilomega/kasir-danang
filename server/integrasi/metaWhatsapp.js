export class MetaWhatsAppError extends Error {}

export function validateSettings(body, previous) {
  const config = {};
  for (const field of ['wabaId', 'phoneNumberId', 'apiVersion', 'accessToken']) {
    const value = body[field] ?? previous[field];
    if (typeof value !== 'string' || value.length > 4096 || /[\r\n]/.test(value)) {
      throw new MetaWhatsAppError(`Isian ${field} tidak valid.`);
    }
    config[field] = field === 'accessToken' && !value.trim() ? previous.accessToken : value.trim();
  }
  for (const field of ['wabaId', 'phoneNumberId']) {
    if (!/^[1-9]\d{0,29}$/.test(config[field])) {
      throw new MetaWhatsAppError('WABA ID dan Phone Number ID wajib berupa ID numerik dari Meta.');
    }
  }
  if (!/^v[1-9]\d{0,2}\.0$/.test(config.apiVersion)) {
    throw new MetaWhatsAppError('Versi Graph API harus berformat vNN.0 sesuai dashboard Meta.');
  }
  if (!config.accessToken || /\s/.test(config.accessToken)) {
    throw new MetaWhatsAppError('Access Token wajib diisi tanpa awalan Bearer atau spasi.');
  }
  return config;
}

/** Membaca nomor akun untuk memeriksa token, WABA, dan kepemilikan nomor. */
export async function tesKoneksi(settings) {
  const config = validateSettings(settings, settings);
  const signal = AbortSignal.timeout(15000);
  const seen = new Set();
  let after;
  for (let page = 0; page < 20; page++) {
    // Host tetap milik Meta. Jangan mengikuti paging.next atau redirect yang
    // dapat membawa Authorization ke host lain.
    const url = new URL(`https://graph.facebook.com/${config.apiVersion}/${config.wabaId}/phone_numbers`);
    url.searchParams.set('fields', 'id,display_phone_number,verified_name');
    url.searchParams.set('limit', '100');
    if (after) url.searchParams.set('after', after);
    let response;
    let data;
    try {
      response = await fetch(url.href, {
        method: 'GET', redirect: 'error', signal,
        headers: { Authorization: `Bearer ${config.accessToken}`, Accept: 'application/json' },
      });
      data = await response.json();
    } catch {
      throw new MetaWhatsAppError('Tidak dapat menghubungi API Meta. Periksa koneksi dan versi Graph API.');
    }
    if (data?.error?.code === 190) throw new MetaWhatsAppError('Access Token Meta tidak valid atau sudah kedaluwarsa.');
    if ([10, 200].includes(data?.error?.code)) throw new MetaWhatsAppError('Token tidak memiliki akses. Periksa izin whatsapp_business_management dan akses ke WABA.');
    if (!response.ok || data?.error || !Array.isArray(data?.data)) {
      throw new MetaWhatsAppError('Meta menolak koneksi. Periksa WABA ID, Access Token, dan versi Graph API.');
    }
    const phone = data.data.find((item) => item?.id === config.phoneNumberId);
    if (phone) {
      if (typeof phone.display_phone_number !== 'string' || !phone.display_phone_number.trim()) {
        throw new MetaWhatsAppError('Respons nomor WhatsApp dari Meta tidak valid.');
      }
      return { phoneNumber: phone.display_phone_number };
    }
    if (!data.paging?.next) throw new MetaWhatsAppError('Phone Number ID tidak terdaftar pada WABA yang diisi.');
    after = data.paging?.cursors?.after;
    if (typeof after !== 'string' || !after || after.length > 4096 || seen.has(after)) break;
    seen.add(after);
  }
  throw new MetaWhatsAppError('Daftar nomor belum dapat diperiksa seluruhnya. Periksa WABA ID dan coba lagi.');
}
