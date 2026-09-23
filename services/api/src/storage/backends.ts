import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Almacén de bytes ya cifrados. La aplicación nunca le entrega contenido en claro (ADR-031). */
export interface BlobBackend {
  readonly name: string;
  write(key: string, body: Readable): Promise<void>;
  /** Rango inclusivo [from, to] de bytes cifrados, o todo el objeto. */
  read(key: string, range?: { from: number; to: number }): Promise<Readable>;
  remove(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

const SAFE_KEY = /^[a-z0-9][a-z0-9/_.-]{2,300}$/i;
export function assertKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.includes('..') || key.includes('//')) throw new Error('Clave de objeto no válida');
}

/** Disco local o volumen de Docker. Escribe en un temporal y renombra: nunca queda un archivo a medias. */
export class FsBackend implements BlobBackend {
  readonly name = 'fs';
  constructor(private readonly root: string) {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  }

  private file(key: string): string {
    assertKey(key);
    return path.join(this.root, ...key.split('/'));
  }

  async write(key: string, body: Readable): Promise<void> {
    const target = this.file(key);
    await fs.promises.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const tmp = `${target}.${crypto.randomBytes(6).toString('hex')}.part`;
    try {
      await pipeline(body, fs.createWriteStream(tmp, { mode: 0o600 }));
      await fs.promises.rename(tmp, target);
    } catch (e) {
      await fs.promises.rm(tmp, { force: true });
      throw e;
    }
  }

  async read(key: string, range?: { from: number; to: number }): Promise<Readable> {
    const f = this.file(key);
    await fs.promises.access(f);
    return fs.createReadStream(f, range ? { start: range.from, end: range.to } : {});
  }

  async remove(key: string): Promise<void> {
    await fs.promises.rm(this.file(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    return fs.promises.access(this.file(key)).then(() => true, () => false);
  }
}

export interface S3Options {
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  serverSideEncryption?: 'AES256' | 'aws:kms';
  prefix?: string;
}

/**
 * AWS S3 o compatibles (Cloudflare R2, MinIO). Las credenciales salen de la cadena estándar del SDK (variables
 * AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, perfil o rol de la instancia); nunca de la base de datos.
 */
export class S3Backend implements BlobBackend {
  readonly name = 's3';
  private sdk: Promise<{ client: any; s3: typeof import('@aws-sdk/client-s3'); Upload: typeof import('@aws-sdk/lib-storage').Upload }>;

  constructor(private readonly o: S3Options) {
    this.sdk = (async () => {
      const s3 = await import('@aws-sdk/client-s3');
      const { Upload } = await import('@aws-sdk/lib-storage');
      const client = new s3.S3Client({ region: o.region, endpoint: o.endpoint, forcePathStyle: o.forcePathStyle });
      return { client, s3, Upload };
    })();
  }

  private key(key: string): string {
    assertKey(key);
    return `${this.o.prefix ?? ''}${key}`;
  }

  async write(key: string, body: Readable): Promise<void> {
    const { client, Upload } = await this.sdk;
    const pass = new PassThrough();
    body.on('error', (e) => pass.destroy(e));
    body.pipe(pass);
    const up = new Upload({
      client,
      params: { Bucket: this.o.bucket, Key: this.key(key), Body: pass, ContentType: 'application/octet-stream', ...(this.o.serverSideEncryption ? { ServerSideEncryption: this.o.serverSideEncryption } : {}) },
      queueSize: 4,
      partSize: 8 * 1024 * 1024,
    });
    await up.done();
  }

  async read(key: string, range?: { from: number; to: number }): Promise<Readable> {
    const { client, s3 } = await this.sdk;
    const r = await client.send(new s3.GetObjectCommand({ Bucket: this.o.bucket, Key: this.key(key), ...(range ? { Range: `bytes=${range.from}-${range.to}` } : {}) }));
    return r.Body as Readable;
  }

  async remove(key: string): Promise<void> {
    const { client, s3 } = await this.sdk;
    await client.send(new s3.DeleteObjectCommand({ Bucket: this.o.bucket, Key: this.key(key) }));
  }

  async exists(key: string): Promise<boolean> {
    const { client, s3 } = await this.sdk;
    try {
      await client.send(new s3.HeadObjectCommand({ Bucket: this.o.bucket, Key: this.key(key) }));
      return true;
    } catch (e: any) {
      if (e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound') return false;
      throw e;
    }
  }
}
