import crypto from 'node:crypto';

export const sha256 = (x: string | Buffer): Buffer => crypto.createHash('sha256').update(x).digest();
export const sha256hex = (x: string | Buffer): string => crypto.createHash('sha256').update(x).digest('hex');
export const randomToken = (bytes = 32): string => crypto.randomBytes(bytes).toString('base64url');

/** Comparación en tiempo constante de dos hashes. */
export const sameHash = (a: Buffer | null | undefined, b: Buffer): boolean => !!a && a.length === b.length && crypto.timingSafeEqual(a, b);

/**
 * Cifrado AES-256-GCM de secretos en reposo (p. ej. el secreto TOTP). Formato: iv(12) | tag(16) | texto cifrado.
 * La clave viene de COROC_DATA_KEY; en producción se reemplaza por un proveedor KMS sin cambiar este contrato.
 */
export class SecretBox {
  constructor(private readonly key: Buffer) {}
  seal(plain: Buffer, aad: string): Buffer {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    c.setAAD(Buffer.from(aad));
    const ct = Buffer.concat([c.update(plain), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), ct]);
  }
  open(sealed: Buffer, aad: string): Buffer {
    const d = crypto.createDecipheriv('aes-256-gcm', this.key, sealed.subarray(0, 12));
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(sealed.subarray(12, 28));
    return Buffer.concat([d.update(sealed.subarray(28)), d.final()]);
  }
}
