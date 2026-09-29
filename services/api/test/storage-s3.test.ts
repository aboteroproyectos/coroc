// Almacén compatible con S3 contra un servicio real (s3rver en la CI; Cloudflare R2 en producción, ADR-060).
// Se ejecuta solo con COROC_TEST_S3_ENDPOINT, por ejemplo:
//   COROC_TEST_S3_ENDPOINT=http://127.0.0.1:9000 COROC_TEST_S3_BUCKET=coroc-test AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… npx vitest run test/storage-s3.test.ts
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { S3Backend } from '../src/storage/backends.js';
import { ObjectStore } from '../src/storage/object-store.js';
import { CHUNK } from '../src/storage/sealed.js';

const endpoint = process.env.COROC_TEST_S3_ENDPOINT;
const bucket = process.env.COROC_TEST_S3_BUCKET ?? 'coroc-test';
const prefix = `ci/${crypto.randomUUID()}/`;

describe.skipIf(!endpoint)('Archivos en un almacén compatible con S3 (R2, MinIO)', () => {
  const store = new ObjectStore({ ...loadConfig(), storage: { driver: 's3', bucket, region: 'auto', endpoint, forcePathStyle: true, prefix } });
  const tenant = crypto.randomUUID();

  beforeAll(async () => {
    const s3 = await import('@aws-sdk/client-s3');
    const client = new s3.S3Client({ region: 'auto', endpoint, forcePathStyle: true });
    await client.send(new s3.CreateBucketCommand({ Bucket: bucket })).catch((e: { name?: string }) => {
      if (e.name !== 'BucketAlreadyOwnedByYou' && e.name !== 'BucketAlreadyExists') throw e;
    });
  });

  it('guarda cifrado, lee completo y por rangos, y borra', async () => {
    // Más de 8 MB: la subida va en partes (multipart), como un respaldo grande.
    const size = 9 * 1024 * 1024 + 321;
    const body = crypto.randomBytes(size);
    const key = store.newKey(tenant, 'backups');
    const r = await store.put(tenant, key, Readable.from([body.subarray(0, 4_000_000), body.subarray(4_000_000)]));
    expect(r.sha256).toBe(crypto.createHash('sha256').update(body).digest('hex'));
    expect(await store.backend.exists(key)).toBe(true);

    expect((await store.getBuffer(tenant, key, size)).equals(body)).toBe(true);
    for (const [s, e] of [[0, 0], [CHUNK - 3, CHUNK + 3], [size - 10, size - 1]] as const) {
      const got = Buffer.concat(await (await store.get(tenant, key, size, { start: s, end: e })).toArray());
      expect(got.equals(body.subarray(s, e + 1))).toBe(true);
    }

    // Lo que guarda el proveedor está cifrado: no contiene el contenido original.
    const raw = Buffer.concat(await (await store.backend.read(key, { from: 0, to: 200_000 })).toArray());
    expect(raw.includes(body.subarray(100_000, 100_032))).toBe(false);

    await store.backend.remove(key);
    expect(await store.backend.exists(key)).toBe(false);
  });

  it('un objeto que no existe no confunde con un error del proveedor', async () => {
    const backend = new S3Backend({ bucket, region: 'auto', endpoint, forcePathStyle: true, prefix });
    expect(await backend.exists('t/no-existe/documents/nada')).toBe(false);
    await expect(backend.read('t/no-existe/documents/nada')).rejects.toThrow();
  });
});
