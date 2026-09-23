import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { ObjectStore } from '../src/storage/object-store.js';
import { CHUNK } from '../src/storage/sealed.js';
import { parseRange } from '../src/documents/documents.controller.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coroc-store-'));
const store = new ObjectStore({ ...loadConfig(), storage: { driver: 'fs', dir } });
const tenant = crypto.randomUUID();

describe('Archivos cifrados en reposo (ADR-031)', () => {
  for (const size of [0, 1, CHUNK - 1, CHUNK, CHUNK + 1, 3 * CHUNK + 777]) {
    it(`guarda y lee ${size} bytes; el disco no contiene el texto original`, async () => {
      const body = crypto.randomBytes(size);
      const key = store.newKey(tenant, 'documents');
      const r = await store.put(tenant, key, body);
      expect(r.size).toBe(size);
      expect(r.sha256).toBe(crypto.createHash('sha256').update(body).digest('hex'));
      expect(await store.getBuffer(tenant, key, size)).toEqual(body);
      const raw = fs.readFileSync(path.join(dir, ...key.split('/')));
      if (size >= 32) expect(raw.includes(body.subarray(0, 32))).toBe(false);
    });
  }

  it('lee rangos arbitrarios (descargas reanudables)', async () => {
    const size = 5 * CHUNK + 123;
    const body = crypto.randomBytes(size);
    const key = store.newKey(tenant, 'documents');
    await store.put(tenant, key, body);
    for (const [s, e] of [[0, 0], [0, 99], [CHUNK - 5, CHUNK + 5], [2 * CHUNK, 3 * CHUNK - 1], [size - 10, size - 1], [123, size - 1]] as const) {
      const got = Buffer.concat(await (await store.get(tenant, key, size, { start: s, end: e })).toArray());
      expect(got).toEqual(body.subarray(s, e + 1));
    }
  });

  it('rechaza un byte alterado y la lectura con otra empresa', async () => {
    const body = Buffer.from('comprobante de pago '.repeat(5000));
    const key = store.newKey(tenant, 'documents');
    await store.put(tenant, key, body);
    await expect(store.getBuffer(crypto.randomUUID(), key, body.length)).rejects.toThrow();
    const file = path.join(dir, ...key.split('/'));
    const raw = fs.readFileSync(file);
    raw[40 + 70_000]! ^= 1;
    fs.writeFileSync(file, raw);
    await expect(store.getBuffer(tenant, key, body.length)).rejects.toThrow();
  });

  it('interpreta encabezados Range', () => {
    expect(parseRange(undefined, 10)).toBeNull();
    expect(parseRange('bytes=2-5', 10)).toEqual({ start: 2, end: 5 });
    expect(parseRange('bytes=7-', 10)).toEqual({ start: 7, end: 9 });
    expect(parseRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
    expect(parseRange('bytes=12-', 10)).toBe('invalid');
    expect(parseRange('elementos=1-2', 10)).toBeNull();
  });
});
