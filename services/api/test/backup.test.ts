// Fase 2 · Respaldo y restauración (§19, CA-13): el respaldo de una empresa se restaura en una empresa vacía con los
// mismos conteos y las mismas huellas SHA-256, y todos los documentos abren.
import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DocumentTasks } from '../src/documents/tasks.js';
import { auth, bootApp, expectContract, newTenant, ownerSession, PASSWORD } from './helpers.js';
import { pdfText } from './pdf-text.js';
import { receiptHtml, renderOne } from './receipts/dataset.js';

type T = Awaited<ReturnType<typeof bootApp>>;
const terms = (over: Record<string, unknown> = {}) => ({ principal: 1_000_000, currency: 'COP', method: 'simple', rate: '0.20', installments: 20, frequency: 'daily', disbursementDate: '2026-10-08', ...over });
const binary = (res: any, cb: (e: Error | null, b: Buffer) => void) => {
  const parts: Buffer[] = [];
  res.on('data', (c: Buffer) => parts.push(c));
  res.on('end', () => cb(null, Buffer.concat(parts)));
};
const BACKUP_PASSWORD = 'Respaldo-Seguro-2026';

describe('Respaldo y restauración (§19, CA-13)', () => {
  let t: T;
  let a: { token: string; slug: string; name: string };
  let b: { token: string; slug: string; name: string };
  let coroc: Buffer;
  const idle = () => t.app.get(DocumentTasks).idle();
  const docs = async (token: string) => {
    const out: any[] = [];
    let cursor: string | null = null;
    do {
      const r: any = (await t.http().get('/v1/documents').set(auth(token)).query({ includeSuperseded: true, limit: 200, ...(cursor ? { cursor } : {}) }).expect(200)).body;
      out.push(...r.items);
      cursor = r.nextCursor;
    } while (cursor);
    return out;
  };
  const download = async (token: string, id: string) => {
    const link = (await t.http().post(`/v1/documents/${id}/link`).set(auth(token)).expect(200)).body;
    return (await t.http().get(`/v1${link.path}`).buffer(true).parse(binary).expect(200)).body as Buffer;
  };
  const upload = (token: string, body: Buffer) => t.http().post('/v1/restores').set(auth(token)).set('Content-Type', 'application/octet-stream').send(body);

  beforeAll(async () => {
    t = await bootApp('2026-10-20T15:00:00Z');
    const ta = await newTenant({ country: 'US', lang: 'es' });
    const tb = await newTenant({ country: 'US', lang: 'es' });
    a = { token: (await ownerSession(t, ta.slug)).token, slug: ta.slug, name: `Empresa ${ta.slug}` };
    b = { token: (await ownerSession(t, tb.slug, 'dispositivo-prueba-2')).token, slug: tb.slug, name: `Empresa ${tb.slug}` };
    // Empresa A con clientes, préstamos, pagos, un reverso, un préstamo pagado y un documento cargado a mano.
    const c1 = (await t.http().post('/v1/clients').set(auth(a.token)).send({ client: { firstName: 'María José', lastName: 'Pérez Gómez', phone: '+57 315 777 8899', lang: 'es' }, loan: terms() }).expect(201)).body;
    const c2 = (await t.http().post('/v1/clients').set(auth(a.token)).send({ client: { firstName: 'John', lastName: 'Smith', phone: '+57 315 111 2233', lang: 'en' }, loan: terms({ principal: 500_000, installments: 5 }) }).expect(201)).body;
    await t.http().post(`/v1/clients/${c1.client.id}/loans`).set(auth(a.token)).send(terms({ principal: 300_000, installments: 3, frequency: 'weekly' })).expect(201);
    const p1 = (await t.http().post(`/v1/loans/${c1.loan.id}/payments`).set(auth(a.token)).send({ amount: 60_000, date: '2026-10-09' }).expect(201)).body;
    await t.http().post(`/v1/loans/${c1.loan.id}/payments`).set(auth(a.token)).send({ amount: 150_000, date: '2026-10-10', method: 'Nequi' }).expect(201);
    await t.http().post(`/v1/loans/${c1.loan.id}/payments/${p1.entry.id}/reversal`).set(auth(a.token)).send({ reason: 'Cheque devuelto' }).expect(201);
    await t.http().post(`/v1/loans/${c2.loan.id}/payments`).set(auth(a.token)).send({ amount: 600_000, date: '2026-10-15' }).expect(201);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(200_000)]);
    await t.http().post(`/v1/clients/${c1.client.id}/documents`).query({ name: 'Cédula' }).set(auth(a.token)).set('Content-Type', 'application/octet-stream').send(png).expect(201);
    await t.http().post('/v1/reports').set(auth(a.token)).send({ type: 'portfolio', format: 'xlsx', currency: 'COP' }).expect(202);
    // Un comprobante recibido en la Bandeja (PDF con capa de texto, desde la carpeta del cliente).
    const receipt = await renderOne(receiptHtml('BBVA', { amount: 60_000, currency: 'COP', date: '2026-10-19', payer: 'María José Pérez Gómez', receiver: 'Inversiones Coroc SAS', reference: 'BB7700112' }), 'pdf', process.env.COROC_CHROMIUM_PATH);
    await t.http().post('/v1/intake').set(auth(a.token)).query({ channel: 'folder', clientId: c1.client.id }).set('Content-Type', 'application/octet-stream').send(receipt).expect(202);
    await idle();
  });
  afterAll(async () => t.app.close());

  it('genera el .coroc por flujo y lo descarga en partes (reanudable)', async () => {
    await t.http().post('/v1/backups').set(auth(a.token)).send({ password: 'corta' }).expect(422);
    const created = (await t.http().post('/v1/backups').set(auth(a.token)).send({ password: BACKUP_PASSWORD }).expect(202)).body;
    expectContract('createBackup', 202, created);
    await idle();
    const done = (await t.http().get(`/v1/backups/${created.id}`).set(auth(a.token)).expect(200)).body;
    expectContract('getBackup', 200, done);
    expect(done).toMatchObject({ status: 'done', progress: 100 });
    expect(done.fileName).toMatch(/^COROC_Respaldo_Empresa_.+_2026-10-20_\d{4}\.coroc$/);
    expect(done.counts).toMatchObject({ clients: 2, loans: 3 });
    const list = (await t.http().get('/v1/backups').set(auth(a.token)).expect(200)).body;
    expectContract('listBackups', 200, list);
    const link = (await t.http().post(`/v1/backups/${created.id}/link`).set(auth(a.token)).expect(200)).body;
    expectContract('createBackupLink', 200, link);
    const half = Math.floor(done.size / 2);
    const p1 = await t.http().get(`/v1${link.path}`).set('Range', `bytes=0-${half - 1}`).buffer(true).parse(binary).expect(206);
    const p2 = await t.http().get(`/v1${link.path}`).set('Range', `bytes=${half}-`).buffer(true).parse(binary).expect(206);
    expect(p2.headers['content-disposition']).toContain('attachment');
    coroc = Buffer.concat([p1.body, p2.body]);
    expect(coroc.length).toBe(done.size);
    expect(crypto.createHash('sha256').update(coroc).digest('hex')).toBe(done.sha256);
    const header = JSON.parse(coroc.subarray(0, coroc.indexOf(10)).toString());
    expect(header).toMatchObject({ format: 'COROC-BACKUP-2', kdf: 'PBKDF2-SHA256', iterations: 310000, cipher: 'AES-256-GCM-CHUNKED', company: a.name });
    // El contenido va cifrado: ni nombres ni el manifiesto aparecen en claro.
    expect(coroc.includes(Buffer.from('María'))).toBe(false);
    expect(coroc.includes(Buffer.from('manifest.json'))).toBe(false);
  });

  it('rechaza la contraseña errada, un byte alterado y la confirmación con otro nombre, sin cambiar nada', async () => {
    const up = (await upload(b.token, coroc).expect(201)).body;
    expectContract('uploadRestore', 201, up);
    const wrong = await t.http().post(`/v1/restores/${up.id}/verify`).set(auth(b.token)).send({ password: 'otra-contraseña' }).expect(422);
    expect(wrong.body.code).toBe('BACKUP_PASSWORD_OR_DAMAGED');
    const tampered = Buffer.from(coroc);
    tampered[Math.floor(tampered.length * 0.6)]! ^= 0x01;
    const upT = (await upload(b.token, tampered).expect(201)).body;
    expect((await t.http().post(`/v1/restores/${upT.id}/verify`).set(auth(b.token)).send({ password: BACKUP_PASSWORD }).expect(422)).body.code).toBe('BACKUP_PASSWORD_OR_DAMAGED');
    expect((await upload(b.token, Buffer.from('no es un respaldo\n')).expect(422)).body.code).toBe('BACKUP_NOT_COROC');
    const legacy = Buffer.from(`${JSON.stringify({ format: 'COROC-BACKUP-1' })}\nxxxx`);
    expect((await upload(b.token, legacy).expect(422)).body.code).toBe('BACKUP_FORMAT_UNSUPPORTED');
    await t.http().post(`/v1/restores/${up.id}/apply`).set(auth(b.token)).send({ password: BACKUP_PASSWORD, confirmName: 'Otra empresa' }).expect(422);
    expect((await t.http().get('/v1/clients').set(auth(b.token)).expect(200)).body.items).toEqual([]);
  });

  it('CA-13: simula, restaura en la empresa vacía y quedan los mismos conteos, huellas y saldos; todos los documentos abren', async () => {
    const up = (await upload(b.token, coroc).expect(201)).body;
    const sim = (await t.http().post(`/v1/restores/${up.id}/verify`).set(auth(b.token)).send({ password: BACKUP_PASSWORD }).expect(200)).body;
    expectContract('verifyRestore', 200, sim);
    const aDocs = await docs(a.token);
    expect(sim.status).toBe('verified');
    expect(sim.summary).toMatchObject({ company: a.name, format: 'COROC-BACKUP-2', counts: { clients: 2, loans: 3, documents: aDocs.length, files: aDocs.length } });

    const applied = (await t.http().post(`/v1/restores/${up.id}/apply`).set(auth(b.token)).send({ password: BACKUP_PASSWORD, confirmName: `  ${b.name.toUpperCase()} ` }).expect(200)).body;
    expectContract('applyRestore', 200, applied);
    expect(applied.status).toBe('applied');
    await t.http().post(`/v1/restores/${up.id}/apply`).set(auth(b.token)).send({ password: BACKUP_PASSWORD, confirmName: a.name }).expect(409);

    // Mismos documentos con las mismas huellas; cada PDF abre y cada archivo se descarga idéntico.
    const bDocs = await docs(b.token);
    const key = (d: any) => `${d.kind}|${d.fileName}|${d.sha256}|${d.version}|${d.superseded}`;
    expect(bDocs.map(key).sort()).toEqual(aDocs.map(key).sort());
    for (const d of bDocs) {
      const file = await download(b.token, d.id);
      expect(crypto.createHash('sha256').update(file).digest('hex')).toBe(d.sha256);
      if (d.mime === 'application/pdf') expect((await pdfText(file)).pages).toBeGreaterThan(0);
    }
    // Mismos clientes, préstamos y saldos derivados del libro.
    const summary = async (token: string) => {
      const clients = (await t.http().get('/v1/clients').set(auth(token)).expect(200)).body.items;
      const out = [];
      for (const c of clients) {
        const full = (await t.http().get(`/v1/clients/${c.id}`).set(auth(token)).expect(200)).body;
        for (const l of full.loans) out.push([c.code, full.fullName, l.contract, l.summary.balance, l.summary.paidTotal, l.summary.remainingInstallments, l.status]);
      }
      return out.sort();
    };
    expect(await summary(b.token)).toEqual(await summary(a.token));
    // La Bandeja también viaja: mismos comprobantes, con la identificación apuntando al cliente restaurado.
    const inbox = async (token: string) => (await t.http().get('/v1/intake').set(auth(token)).expect(200)).body.items;
    const [ia, ib] = [await inbox(a.token), await inbox(b.token)];
    expect(ib.map((i: any) => `${i.status}|${i.extraction.amount?.value}|${i.clientName}|${i.channel}`)).toEqual(ia.map((i: any) => `${i.status}|${i.extraction.amount?.value}|${i.clientName}|${i.channel}`));
    expect(ib).toHaveLength(1);
    expect(ib[0].identification.clientId).toBe(ib[0].clientId);
    expect(ib[0].clientId).not.toBe(ia[0].clientId);
    const ledgerA = (await t.http().get('/v1/clients').set(auth(a.token)).expect(200)).body.items.length;
    expect(ledgerA).toBe(2);
    // La empresa restaurada sigue operando: el siguiente recibo continúa la numeración del respaldo.
    const clientB = (await t.http().get('/v1/clients').set(auth(b.token)).query({ q: 'maria' }).expect(200)).body.items[0];
    const loanB = (await t.http().get(`/v1/clients/${clientB.id}`).set(auth(b.token)).expect(200)).body.loans.find((l: any) => l.contract === 'CT-000001');
    const pay = (await t.http().post(`/v1/loans/${loanB.id}/payments`).set(auth(b.token)).send({ amount: 60_000, date: '2026-10-20' }).expect(201)).body;
    expect(pay.receipt.number).toBe('RC-000004');
    // La empresa A no cambió.
    expect((await docs(a.token)).length).toBe(aDocs.length);
  });

  it('solo el Propietario restaura; el Administrador respalda', async () => {
    await t.http().post('/v1/users').set(auth(a.token)).send({ username: 'admin1', name: 'Admin Uno', role: 'admin', password: PASSWORD }).expect(201);
    const admin = (await t.http().post('/v1/auth/login').send({ tenant: a.slug, username: 'admin1', password: PASSWORD, deviceId: 'dispositivo-admin' }).expect(200)).body.accessToken;
    await t.http().get('/v1/backups').set(auth(admin)).expect(200);
    await upload(admin, coroc).expect(403);
  });
});
