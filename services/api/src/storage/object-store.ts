import crypto from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Inject, Injectable } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config.js';
import { FsBackend, S3Backend, type BlobBackend } from './backends.js';
import { CHUNK, HEADER_BYTES, newObjectHeader, openObjectHeader, rangePlan, SealStream, sealedSize, UnsealStream } from './sealed.js';

export interface StoredObject {
  key: string;
  size: number;
  sha256: string;
}

async function readAll(s: Readable): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of s) parts.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(parts);
}

/**
 * Archivos de COROC (§4.2): comprobantes, recibos, planes, estados de cuenta, informes y respaldos. Siempre cifrados
 * por la aplicación antes de salir del proceso (ADR-031), en disco o en un almacén compatible con S3.
 */
@Injectable()
export class ObjectStore {
  readonly backend: BlobBackend;

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {
    const s = config.storage;
    this.backend = s.driver === 's3'
      ? new S3Backend({ bucket: s.bucket!, region: s.region ?? 'us-east-1', endpoint: s.endpoint, forcePathStyle: s.forcePathStyle, serverSideEncryption: s.sse, prefix: s.prefix })
      : new FsBackend(path.resolve(s.dir ?? './data/objects'));
  }

  newKey(tenantId: string, area: 'documents' | 'backups' | 'restores'): string {
    return `t/${tenantId}/${area}/${crypto.randomUUID()}`;
  }

  /** Cifra y guarda. Devuelve el tamaño y el SHA-256 del contenido original. */
  async put(tenantId: string, key: string, body: Buffer | Readable): Promise<StoredObject> {
    const h = newObjectHeader(this.config.dataKey, tenantId);
    const seal = new SealStream(h.key, h.prefix, Buffer.alloc(0), h.head);
    const source = Buffer.isBuffer(body) ? Readable.from([body]) : body;
    source.on('error', (e) => seal.destroy(e));
    const written = this.backend.write(key, source.pipe(seal));
    await written;
    return { key, size: seal.plainSize, sha256: seal.sha256 };
  }

  private async header(tenantId: string, key: string) {
    return openObjectHeader(this.config.dataKey, tenantId, await readAll(await this.backend.read(key, { from: 0, to: HEADER_BYTES - 1 })));
  }

  /** Contenido original completo o un rango [start, end] (inclusivo). `size` es el tamaño original guardado en la base. */
  async get(tenantId: string, key: string, size: number, range?: { start: number; end: number }): Promise<Readable> {
    const { key: k, prefix } = await this.header(tenantId, key);
    if (!range) {
      const body = await this.backend.read(key, { from: HEADER_BYTES, to: HEADER_BYTES + sealedSize(size) - 1 });
      const out = new UnsealStream(k, prefix, 0, Math.max(0, Math.ceil(size / CHUNK) - 1));
      body.on('error', (e) => out.destroy(e));
      return body.pipe(out);
    }
    const p = rangePlan(size, range.start, range.end);
    const body = await this.backend.read(key, { from: p.from, to: p.to });
    const out = new UnsealStream(k, prefix, p.first, p.lastChunk, { skipFirst: p.skipFirst, totalOut: p.length });
    body.on('error', (e) => out.destroy(e));
    return body.pipe(out);
  }

  async getBuffer(tenantId: string, key: string, size: number): Promise<Buffer> {
    return readAll(await this.get(tenantId, key, size));
  }

  /** Copia el contenido original a un archivo local (restauración, lectura de ZIP con acceso aleatorio). */
  async toFile(tenantId: string, key: string, size: number, file: string): Promise<void> {
    const { createWriteStream } = await import('node:fs');
    await pipeline(await this.get(tenantId, key, size), createWriteStream(file, { mode: 0o600 }));
  }

  async remove(key: string): Promise<void> {
    await this.backend.remove(key);
  }
}
