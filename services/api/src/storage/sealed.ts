import crypto from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';

/**
 * Cifrado por bloques con AES-256-GCM (ADR-031). Lo usan los archivos en reposo y el respaldo `.coroc` (ADR-034).
 *
 *   bloque i = texto cifrado (≤ 64 KiB) · etiqueta GCM (16 B)
 *   nonce    = prefijo aleatorio (8 B) · número de bloque (4 B)
 *   AAD      = datos asociados del formato · marca de último bloque (1 B)
 *
 * El número de bloque y la marca de último bloque están autenticados: no se pueden reordenar, quitar ni truncar bloques
 * sin que el descifrado falle. Al ser por bloques, un rango de bytes se descifra sin leer todo (descargas reanudables).
 *
 * Archivos en reposo: encabezado (32 B) = "CRX1" · versión (1) · log2 del bloque (1) · reservado (2) · prefijo (8) ·
 * sal (16). La clave de cada archivo sale de HKDF-SHA256(clave de datos del servidor, sal, empresa): un archivo copiado
 * a otra empresa no se descifra.
 */
export const MAGIC = Buffer.from('CRX1');
export const HEADER_BYTES = 32;
export const CHUNK = 64 * 1024;
export const TAG = 16;
export const SEALED_CHUNK = CHUNK + TAG;

export function sealedSize(plainSize: number): number {
  const chunks = Math.max(1, Math.ceil(plainSize / CHUNK));
  return plainSize + chunks * TAG;
}

function nonce(prefix: Buffer, index: number): Buffer {
  const n = Buffer.alloc(12);
  prefix.copy(n, 0, 0, 8);
  n.writeUInt32BE(index, 8);
  return n;
}

const aadFor = (extra: Buffer, last: boolean) => Buffer.concat([extra, Buffer.from([last ? 1 : 0])]);

export class IntegrityError extends Error {
  constructor(message = 'El archivo cifrado está dañado o la clave no corresponde') {
    super(message);
  }
}

/** Cifra un flujo por bloques. Calcula al paso el SHA-256 y el tamaño del contenido original. */
export class SealStream extends Transform {
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private index = 0;
  private readonly hash = crypto.createHash('sha256');
  plainSize = 0;
  sha256 = '';

  constructor(private readonly key: Buffer, private readonly prefix: Buffer, private readonly aad: Buffer = Buffer.alloc(0), prelude?: Buffer) {
    super();
    if (prelude) this.push(prelude);
  }

  private seal(plain: Buffer, last: boolean): void {
    const c = crypto.createCipheriv('aes-256-gcm', this.key, nonce(this.prefix, this.index++));
    c.setAAD(aadFor(this.aad, last));
    this.push(Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]));
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    this.hash.update(chunk);
    this.plainSize += chunk.length;
    this.pending.push(chunk);
    this.pendingBytes += chunk.length;
    // Siempre queda algo pendiente: el último bloque solo se conoce al terminar.
    if (this.pendingBytes > CHUNK) {
      let buf = Buffer.concat(this.pending);
      while (buf.length > CHUNK) {
        this.seal(buf.subarray(0, CHUNK), false);
        buf = buf.subarray(CHUNK);
      }
      this.pending = [buf];
      this.pendingBytes = buf.length;
    }
    cb();
  }

  override _flush(cb: TransformCallback): void {
    this.seal(Buffer.concat(this.pending), true);
    this.sha256 = this.hash.digest('hex');
    cb();
  }
}

/**
 * Descifra bloques a partir del bloque `firstIndex`. Si `lastIndex` es conocido (lectura por rango) lo usa para verificar
 * la marca de último bloque; si no, el último es el que queda al terminar el flujo.
 */
export class UnsealStream extends Transform {
  private pending: Buffer = Buffer.alloc(0);
  private index: number;
  private emitted = 0;
  private skipped = false;

  constructor(
    private readonly key: Buffer,
    private readonly prefix: Buffer,
    firstIndex = 0,
    private readonly lastIndex: number | null = null,
    private readonly trim: { skipFirst: number; totalOut: number | null } = { skipFirst: 0, totalOut: null },
    private readonly aad: Buffer = Buffer.alloc(0),
  ) {
    super();
    this.index = firstIndex;
  }

  private open(sealed: Buffer, last: boolean): void {
    if (sealed.length < TAG) throw new IntegrityError();
    const d = crypto.createDecipheriv('aes-256-gcm', this.key, nonce(this.prefix, this.index++));
    d.setAAD(aadFor(this.aad, last));
    d.setAuthTag(sealed.subarray(sealed.length - TAG));
    let out: Buffer;
    try {
      out = Buffer.concat([d.update(sealed.subarray(0, sealed.length - TAG)), d.final()]);
    } catch {
      throw new IntegrityError();
    }
    if (!this.skipped) {
      out = out.subarray(this.trim.skipFirst);
      this.skipped = true;
    }
    if (this.trim.totalOut !== null) out = out.subarray(0, Math.max(0, this.trim.totalOut - this.emitted));
    this.emitted += out.length;
    if (out.length) this.push(out);
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    try {
      this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
      while (this.pending.length > SEALED_CHUNK) {
        this.open(this.pending.subarray(0, SEALED_CHUNK), this.lastIndex !== null && this.index === this.lastIndex);
        this.pending = this.pending.subarray(SEALED_CHUNK);
      }
      cb();
    } catch (e) {
      cb(e as Error);
    }
  }

  override _flush(cb: TransformCallback): void {
    try {
      if (!this.pending.length) throw new IntegrityError();
      this.open(this.pending, this.lastIndex === null || this.index === this.lastIndex);
      cb();
    } catch (e) {
      cb(e as Error);
    }
  }
}

// ─────────── Archivos en reposo ───────────
function objectKey(master: Buffer, salt: Buffer, tenantId: string): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', master, salt, `coroc:object:v1:${tenantId}`, 32));
}

export function newObjectHeader(master: Buffer, tenantId: string): { head: Buffer; key: Buffer; prefix: Buffer } {
  const prefix = crypto.randomBytes(8);
  const salt = crypto.randomBytes(16);
  const head = Buffer.alloc(HEADER_BYTES);
  MAGIC.copy(head, 0);
  head[4] = 1;
  head[5] = 16;
  prefix.copy(head, 8);
  salt.copy(head, 16);
  return { head, key: objectKey(master, salt, tenantId), prefix };
}

export function openObjectHeader(master: Buffer, tenantId: string, head: Buffer): { key: Buffer; prefix: Buffer } {
  if (head.length < HEADER_BYTES || !head.subarray(0, 4).equals(MAGIC) || head[4] !== 1 || head[5] !== 16) throw new IntegrityError();
  return { key: objectKey(master, head.subarray(16, 32), tenantId), prefix: Buffer.from(head.subarray(8, 16)) };
}

/** Bloques y bytes cifrados (después del encabezado de `headerBytes`) que hay que leer para entregar [start, end]. */
export function rangePlan(plainSize: number, start: number, end: number, headerBytes = HEADER_BYTES) {
  const lastChunk = Math.max(0, Math.ceil(plainSize / CHUNK) - 1);
  const first = Math.floor(start / CHUNK);
  const last = Math.min(lastChunk, Math.floor(end / CHUNK));
  const from = headerBytes + first * SEALED_CHUNK;
  const to = Math.min(headerBytes + sealedSize(plainSize) - 1, headerBytes + (last + 1) * SEALED_CHUNK - 1);
  return { first, last, lastChunk, from, to, skipFirst: start - first * CHUNK, length: end - start + 1 };
}
