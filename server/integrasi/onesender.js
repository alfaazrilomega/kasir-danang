import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';

const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['224.0.0.0', 3],
]) blocked.addSubnet(address, prefix);
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
blocked.addSubnet('2001::', 32, 'ipv6');
blocked.addSubnet('2002::', 16, 'ipv6');

export function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  return family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}

export function validateApiUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('API URL OneSender tidak valid.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('API URL harus HTTP/HTTPS tanpa kredensial, query, atau fragmen.');
  }
  if (!url.pathname.endsWith('/api/v1/messages')) {
    throw new Error('Gunakan API URL lengkap yang berakhir dengan /api/v1/messages.');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || (isIP(host) && !isPublicAddress(host))) {
    throw new Error('API URL harus memakai alamat server OneSender publik.');
  }
  return url;
}

// GET sesuai dokumentasi OneSender 2.0. Tidak mengirim pesan atau meneruskan
// isi riwayat pesan ke browser admin. DNS dipin dan redirect tidak diikuti.
export async function tesKoneksi(config) {
  if (!config.apiKey || !config.apiUrl) throw new Error('Kredensial OneSender belum lengkap.');
  const url = validateApiUrl(config.apiUrl);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await lookup(host, { all: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error('Alamat server OneSender tidak diizinkan.');
  }
  const address = addresses[0];
  url.searchParams.set('page', '1');
  url.searchParams.set('per_page', '1');
  await new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).request(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
      lookup: (_hostname, options, callback) => options.all
        ? callback(null, [address]) : callback(null, address.address, address.family),
    }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(new Error('OneSender menolak koneksi.'));
        return;
      }
      let size = 0;
      const chunks = [];
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > 1024 * 1024) { res.destroy(new Error('Respons OneSender terlalu besar.')); return; }
        chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const messages = Array.isArray(data) ? data : data?.data?.data ?? data?.data?.messages ?? data?.data ?? data?.messages;
          if (!Array.isArray(messages) || data.error || data.errors || data.success === false || data.status === false || Number(data.code) >= 400 || Number(data.status) >= 400) {
            throw new Error('Respons OneSender tidak valid.');
          }
          resolve();
        } catch { reject(new Error('Respons OneSender tidak valid.')); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}
