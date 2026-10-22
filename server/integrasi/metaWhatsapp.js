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

async function graph(config, path, payload) {
  validateSettings(config, config);
  let response;
  let data;
  try {
    response = await fetch(`https://graph.facebook.com/${config.apiVersion}/${path}`, {
      method: payload ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${config.accessToken}`, Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json' } : {}) },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    data = await response.json();
  } catch {
    throw Object.assign(new MetaWhatsAppError('Respons Meta belum dapat dipastikan. Periksa koneksi dan riwayat pesan sebelum mengirim ulang.'), { uncertain: !!payload });
  }
  const code = Number(data?.error?.code);
  if (!response.ok || data?.error) {
    const messages = {
      190: 'Access Token Meta tidak valid atau kedaluwarsa.',
      10: 'Token Meta memerlukan izin whatsapp_business_messaging dan akses nomor pengirim.',
      200: 'Token Meta tidak memiliki izin untuk operasi ini. Periksa akses WABA dan nomor pengirim.',
      132000: 'Jumlah parameter tidak sesuai template Meta.',
      132001: 'Template Meta atau bahasa belum tersedia/disetujui.',
      131026: 'Meta tidak dapat mengirim ke penerima. Periksa nomor WhatsApp dan batas nomor uji aplikasi.',
    };
    throw Object.assign(new MetaWhatsAppError(messages[code] || 'Meta menolak permintaan. Periksa template, nomor pengirim, dan izin token di dashboard Meta.'), { uncertain: response.status >= 500 });
  }
  return data;
}

/** Template teks approved, dengan parameter pada BODY. */
export async function siapkanTemplate(config, { name, language, parameters }) {
  if (!/^[a-z0-9_]{1,512}$/.test(name || '') || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(language || '')) {
    throw new MetaWhatsAppError('Isi nama template Meta dan kode bahasa yang sesuai WhatsApp Manager.');
  }
  const query = new URLSearchParams({ name, fields: 'name,status,language,components,parameter_format', limit: '100' });
  const data = await graph(config, `${config.wabaId}/message_templates?${query}`);
  const template = data?.data?.find((item) => item.name === name && item.language === language && item.status === 'APPROVED');
  if (!template) throw new MetaWhatsAppError('Template dan bahasa belum disetujui Meta atau tidak ditemukan pada WABA ini.');
  const components = template.components ?? [];
  const body = components.find((item) => item.type === 'BODY')?.text;
  if (typeof body !== 'string' || components.some((item) => !['BODY', 'HEADER', 'FOOTER'].includes(item.type)
    || (item.type === 'HEADER' && (item.format !== 'TEXT' || /{{/.test(item.text || ''))))) {
    throw new MetaWhatsAppError('Gunakan template Meta teks dengan parameter pada BODY, tanpa media atau tombol.');
  }
  const names = [...new Set([...body.matchAll(/{{\s*([a-zA-Z0-9_]+)\s*}}/g)].map((match) => match[1]))];
  const named = template.parameter_format === 'NAMED';
  if (!Array.isArray(parameters) || names.length !== parameters.length
    || (!named && names.some((name, index) => name !== String(index + 1)))) {
    throw new MetaWhatsAppError('Urutan/jumlah parameter BODY tidak sesuai template Meta.');
  }
  const values = parameters.map((text) => String(text).replace(/[\r\n\t]+/g, ' | ').replace(/ {2,}/g, ' ').trim());
  if (values.some((value) => !value || value.length > 1024)) throw new MetaWhatsAppError('Parameter Meta harus berisi 1–1024 karakter. Ringkas rincian barang pada template Meta.');
  const payload = { name, language: { code: language }, ...(values.length ? { components: [{ type: 'body', parameters: values.map((text, i) => ({ type: 'text', text, ...(named ? { parameter_name: names[i] } : {}) })) }] } : {}) };
  const bodyText = body.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, key) => values[names.indexOf(key)]);
  return { payload, text: [components.find((item) => item.type === 'HEADER')?.text, bodyText, components.find((item) => item.type === 'FOOTER')?.text].filter(Boolean).join('\n\n') };
}

export async function kirimTemplate(config, { to, template }) {
  if (!/^[1-9]\d{7,14}$/.test(to)) throw new MetaWhatsAppError('Nomor WhatsApp penerima tidak valid.');
  const data = await graph(config, `${config.phoneNumberId}/messages`, { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'template', template });
  const id = data?.messages?.[0]?.id;
  if (!id) throw Object.assign(new MetaWhatsAppError('Meta belum mengembalikan ID pesan. Periksa riwayat sebelum mengirim ulang.'), { uncertain: true });
  return { id };
}
