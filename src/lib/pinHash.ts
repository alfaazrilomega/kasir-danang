// SHA-256 of `${salt}:${pin}` — mainly to avoid storing the raw PIN in
// localStorage. A 4-digit PIN is short enough that a determined attacker with
// localStorage access can brute-force it, but at that point they already have
// the data. The hash exists to discourage casual snooping.

export async function hashPin(pin: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function generateSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
