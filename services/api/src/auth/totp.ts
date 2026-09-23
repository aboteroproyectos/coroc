import crypto from 'node:crypto';

// TOTP según RFC 6238 (HMAC-SHA1, 6 dígitos, 30 s), compatible con Google Authenticator, Microsoft Authenticator y 1Password.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('Base32 no válido');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', secret).update(msg).digest();
  const off = h[h.length - 1]! & 0xf;
  const code = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(code % 10 ** digits).padStart(digits, '0');
}

export const counterAt = (time: Date, step = 30): number => Math.floor(time.getTime() / 1000 / step);

/** Devuelve el contador aceptado (ventana de ±1 paso) o null. El llamador rechaza contadores ya usados. */
export function verifyTotp(secret: Buffer, code: string, time: Date, window = 1): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const c = counterAt(time);
  for (let k = -window; k <= window; k++) {
    const candidate = hotp(secret, c + k);
    if (crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(code))) return c + k;
  }
  return null;
}

export const newTotpSecret = (): Buffer => crypto.randomBytes(20);

export function otpauthUri(secret: Buffer, account: string, issuer = 'COROC'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${base32Encode(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
