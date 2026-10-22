/** Format yang diterima pengirim WhatsApp, termasuk nomor lokal Indonesia. */
export function isValidWhatsAppPhone(value: string): boolean {
  const raw = value.trim();
  if (raw.length > 20 || !/^\+?[\d\s()-]+$/.test(raw)) return false;
  let number = raw.replace(/\D/g, '');
  if (number.startsWith('0')) number = `62${number.slice(1)}`;
  else if (number.startsWith('8')) number = `62${number}`;
  return /^[1-9]\d{7,14}$/.test(number);
}
