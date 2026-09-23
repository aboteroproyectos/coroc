// Fase 2 · Documentos (§15, §16, CA-15, CA-18): repositorio, PDF reales, carpeta COROC, enlaces firmados y verificación.
import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DocumentTasks } from '../src/documents/tasks.js';
import { auth, bootApp, expectContract, newTenant, ownerSession, PASSWORD } from './helpers.js';
import { pdfText } from './pdf-text.js';

type T = Awaited<ReturnType<typeof bootApp>>;
const CA01_TERMS = { principal: 1_000_000, currency: 'COP', method: 'simple', rate: '0.20', installments: 20, frequency: 'daily', disbursementDate: '2026-10-08' };
const maria = { firstName: 'María José', lastName: 'Pérez Gómez', phone: '315 777 8899', lang: 'es', idDocType: 'CC', idDocNumber: '1020304050' };

const binary = (res: any, cb: (e: Error | null, b: Buffer) => void) => {
  const parts: Buffer[] = [];
  res.on('data', (c: Buffer) => parts.push(c));
  res.on('end', () => cb(null, Buffer.concat(parts)));
};

describe('Documentos del préstamo, carpeta COROC y verificación (CA-15, CA-18)', () => {
  let t: T;
  let token: string;
  let slug: string;
  let loanId: string;
  let clientId: string;
  const idle = () => t.app.get(DocumentTasks).idle();
  const file = async (documentId: string, status: number, range?: string) => {
    const link = (await t.http().post(`/v1/documents/${documentId}/link`).set(auth(token)).expect(200)).body;
    expectContract('createDocumentLink', 200, link);
    expect(link.url).toBe(`https://api.coroc.test/v1${link.path}`);
    const req = t.http().get(`/v1${link.path}`).buffer(true).parse(binary);
    if (range) req.set('Range', range);
    return req.expect(status);
  };
  const pdf = async (documentId: string) => {
    const r = await file(documentId, 200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect((r.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    return pdfText(r.body);
  };

  beforeAll(async () => {
    t = await bootApp('2026-10-09T15:00:00Z');
    // Empresa sin tope de tasa (ADR-027) que trabaja en español: la carpeta COROC sigue el idioma de la empresa.
    const tenant = await newTenant({ country: 'US', lang: 'es' });
    slug = tenant.slug;
    token = (await ownerSession(t, slug)).token;
    const r = await t.http().post('/v1/clients').set(auth(token)).send({ client: maria, loan: CA01_TERMS }).expect(201);
    loanId = r.body.loan.id;
    clientId = r.body.client.id;
    await idle();
  });
  afterAll(async () => t.app.close());

  it('CA-15: al crear el cliente queda su carpeta con las 5 subcarpetas, el .coroc-id y el PDF del contrato y plan de pagos', async () => {
    const m = (await t.http().get('/v1/folder/manifest').set(auth(token)).expect(200)).body;
    expectContract('getFolderManifest', 200, m);
    expect(m.full).toBe(true);
    expect(m.rootFolders).toEqual(['_Sin asignar', '_Entrada', '_Informes', '_Respaldos']);
    expect(m.subfolders).toEqual(['01 Contrato y plan de pagos', '02 Comprobantes recibidos', '03 Recibos emitidos', '04 Estados de cuenta', '05 Otros documentos']);
    expect(m.clients).toEqual([{ id: clientId, code: 'C000001', folderName: 'Maria Jose Perez Gomez - C000001', marker: 'Maria Jose Perez Gomez - C000001/.coroc-id', contracts: ['CT-000001'] }]);
    expect(m.files).toHaveLength(1);
    expect(m.files[0].path).toMatch(/^Maria Jose Perez Gomez - C000001\/CT-000001\/01 Contrato y plan de pagos\/2026-10-09_\d{4}_PLAN_DE_PAGOS_CT-000001\.pdf$/);
    const { text } = await pdf(m.files[0].documentId);
    for (const s of ['Contrato y plan de pagos', 'María José Pérez Gómez', 'CT-000001', '$ 1.000.000', '$ 1.200.000', '20 cuotas diarias', 'Deudor', 'Acreedor']) expect(text).toContain(s);
  });

  it('CA-05 con PDF: el recibo dice exactamente lo que registró el pago y el plan pasa a la versión 2', async () => {
    const pay = await t.http().post(`/v1/loans/${loanId}/payments`).set(auth(token)).send({ amount: 60_000, date: '2026-10-09', method: 'Nequi', reference: 'M-1' }).expect(201);
    await idle();
    const receipts = (await t.http().get(`/v1/loans/${loanId}/receipts`).set(auth(token)).expect(200)).body;
    expectContract('listReceipts', 200, receipts);
    expect(receipts[0]).toMatchObject({ number: 'RC-000001', voided: false, voidDocumentId: null });
    const { text } = await pdf(receipts[0].documentId);
    for (const s of ['Gracias por tu pago', 'RC-000001', 'CT-000001', 'María José Pérez Gómez', 'Cuota 1 (completa)', '$ 60.000', '$ 1.140.000', 'Documento generado por COROC', pay.body.receipt.verificationCode]) {
      expect(text).toContain(s);
    }
    expect(text).toMatch(/Cuotas restantes\s+19/);
    const docs = (await t.http().get('/v1/documents').set(auth(token)).query({ clientId, kind: 'schedule', includeSuperseded: true }).expect(200)).body;
    expectContract('listDocuments', 200, docs);
    expect(docs.items.map((d: { version: number; superseded: boolean }) => [d.version, d.superseded])).toEqual([[2, false], [1, true]]);
    const one = (await t.http().get(`/v1/documents/${docs.items[0].id}`).set(auth(token)).expect(200)).body;
    expectContract('getDocument', 200, one);
    expect(one.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
  });

  it('descarga por rangos para reanudar y rechaza enlaces alterados o vencidos', async () => {
    const receipts = (await t.http().get(`/v1/loans/${loanId}/receipts`).set(auth(token)).expect(200)).body;
    const full: Buffer = (await file(receipts[0].documentId, 200)).body;
    const part = await file(receipts[0].documentId, 206, 'bytes=100-4099');
    expect(part.headers['content-range']).toBe(`bytes 100-4099/${full.length}`);
    expect(part.body).toEqual(full.subarray(100, 4100));
    await file(receipts[0].documentId, 416, `bytes=${full.length + 5}-`);
    const link = (await t.http().post(`/v1/documents/${receipts[0].documentId}/link`).set(auth(token)).expect(200)).body;
    await t.http().get(`/v1${link.path.slice(0, -2)}xx`).expect(410);
    t.clock.set('2026-10-09T15:30:00Z');
    await t.http().get(`/v1${link.path}`).expect(410);
    t.clock.set('2026-10-09T15:00:00Z');
  });

  it('CA-18 con PDF: el reverso emite la versión ANULADO del recibo y la carpeta reemplaza el archivo', async () => {
    const since = (await t.http().get('/v1/folder/manifest').set(auth(token)).expect(200)).body.nextSince;
    const ledger = (await t.http().get(`/v1/loans/${loanId}/ledger`).set(auth(token)).expect(200)).body;
    const pay = ledger.find((e: { type: string }) => e.type === 'payment');
    await t.http().post(`/v1/loans/${loanId}/payments/${pay.id}/reversal`).set(auth(token)).send({ reason: 'Consignación rechazada por el banco' }).expect(201);
    await idle();
    const [rc] = (await t.http().get(`/v1/loans/${loanId}/receipts`).set(auth(token)).expect(200)).body;
    expect(rc.voided).toBe(true);
    expect(rc.voidDocumentId).toBeTruthy();
    const { text } = await pdf(rc.voidDocumentId);
    expect(text).toContain('ANULADO');
    expect(text).toContain('RC-000001');
    const m = (await t.http().get('/v1/folder/manifest').set(auth(token)).query({ since }).expect(200)).body;
    expectContract('getFolderManifest', 200, m);
    expect(m.full).toBe(false);
    expect(m.removed).toContain(rc.documentId);
    expect(m.files.map((f: { path: string }) => f.path)).toEqual(
      expect.arrayContaining([expect.stringMatching(/03 Recibos emitidos\/2026-10-09_\d{4}_RECIBO_RC-000001_CT-000001_ANULADO\.pdf$/)]),
    );
    // El recibo original sigue en el repositorio como versión anterior: nunca se borra.
    const orig = (await t.http().get(`/v1/documents/${rc.documentId}`).set(auth(token)).expect(200)).body;
    expect(orig.superseded).toBe(true);
  });

  it('el código QR verifica el recibo sin revelar datos del deudor', async () => {
    const [rc] = (await t.http().get(`/v1/loans/${loanId}/receipts`).set(auth(token)).expect(200)).body;
    expect(rc.data.verificationUrl).toBe(`https://api.coroc.test/v1/public/receipts/${rc.data.verificationCode}`);
    const json = await t.http().get(`/v1/public/receipts/${rc.data.verificationCode}`).expect(200);
    expectContract('verifyReceipt', 200, json.body);
    expect(json.body).toMatchObject({ valid: true, voided: true, number: 'RC-000001', amount: 60_000, currency: 'COP' });
    expect(JSON.stringify(json.body)).not.toContain('Pérez');
    const html = await t.http().get(`/v1/public/receipts/${rc.data.verificationCode.toLowerCase()}`).set('Accept', 'text/html').set('Accept-Language', 'en').expect(200);
    expect(html.text).toContain('Receipt verification');
    expect(html.text).toContain('VOIDED');
    const miss = await t.http().get('/v1/public/receipts/0000000000000000').expect(404);
    expect(miss.body).toEqual({ valid: false, voided: false });
  });

  it('estado de cuenta bajo demanda y, al pagar todo, paz y salvo con estado de cuenta de cierre', async () => {
    const task = (await t.http().post(`/v1/loans/${loanId}/statements`).set(auth(token)).expect(202)).body;
    expectContract('requestStatement', 202, task);
    await idle();
    const done = (await t.http().get(`/v1/tasks/${task.id}`).set(auth(token)).expect(200)).body;
    expectContract('getTask', 200, done);
    expect(done).toMatchObject({ status: 'done', progress: 100 });
    const st = await pdf(done.documentId);
    for (const s of ['Estado de cuenta', 'Pagos recibidos', 'Reversado', 'Cuotas por pagar']) expect(st.text).toContain(s);

    await t.http().post(`/v1/loans/${loanId}/payments`).set(auth(token)).send({ amount: 1_200_000, date: '2026-10-09', cash: true }).expect(201);
    await idle();
    const payoff = (await t.http().get('/v1/documents').set(auth(token)).query({ loanId, kind: 'payoff' }).expect(200)).body.items;
    expect(payoff).toHaveLength(1);
    const p = await pdf(payoff[0].id);
    for (const s of ['Paz y salvo', 'María José Pérez Gómez', 'CC 1020304050', 'CT-000001', '$ 1.200.000']) expect(p.text).toContain(s);
    const statements = (await t.http().get('/v1/documents').set(auth(token)).query({ loanId, kind: 'statement' }).expect(200)).body.items;
    expect(statements.map((d: { meta: { reason: string } }) => d.meta.reason).sort()).toEqual(['closed', 'on_demand']);
  });

  it('carga manual: acepta PDF e imágenes por su contenido, rechaza lo demás, busca sin tildes y etiqueta', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(64)]);
    const up = await t.http().post(`/v1/clients/${clientId}/documents`).query({ loanId, name: 'Cédula de ciudadanía', tags: 'Identidad, KYC' }).set(auth(token)).set('Content-Type', 'application/octet-stream').send(png).expect(201);
    expectContract('uploadDocument', 201, up.body);
    expect(up.body).toMatchObject({ kind: 'other', mime: 'image/png', name: 'Cédula de ciudadanía', tags: ['identidad', 'kyc'], folderPath: 'Maria Jose Perez Gomez - C000001/CT-000001/05 Otros documentos' });
    expect(up.body.fileName).toMatch(/^2026-10-09_\d{4}_DOCUMENTO_Cedula_de_ciudadania_CT-000001\.png$/);
    const e = await t.http().post(`/v1/clients/${clientId}/documents`).set(auth(token)).set('Content-Type', 'application/octet-stream').send(Buffer.from('<script>alert(1)</script>')).expect(415);
    expect(e.body.code).toBe('FILE_TYPE_NOT_ALLOWED');
    const found = (await t.http().get('/v1/documents').set(auth(token)).query({ q: 'cedula' }).expect(200)).body.items;
    expect(found.map((d: { id: string }) => d.id)).toEqual([up.body.id]);
    const tagged = (await t.http().patch(`/v1/documents/${up.body.id}`).set(auth(token)).send({ tags: ['Vigente'] }).expect(200)).body;
    expectContract('updateDocument', 200, tagged);
    expect((await t.http().get('/v1/documents').set(auth(token)).query({ tag: 'vigente' }).expect(200)).body.items).toHaveLength(1);
  });

  it('el Cobrador no ve documentos de clientes ajenos y el intento queda registrado', async () => {
    await t.http().post('/v1/users').set(auth(token)).send({ username: 'cobra1', name: 'Cobra Uno', role: 'collector', password: PASSWORD }).expect(201);
    const login = await t.http().post('/v1/auth/login').send({ tenant: slug, username: 'cobra1', password: PASSWORD, deviceId: 'dev-cobrador' }).expect(200);
    const ct = login.body.accessToken;
    const docs = (await t.http().get('/v1/documents').set(auth(token)).query({ clientId }).expect(200)).body.items;
    await t.http().get('/v1/documents').set(auth(ct)).query({ clientId }).expect(403);
    await t.http().get(`/v1/documents/${docs[0].id}`).set(auth(ct)).expect(403);
    expect((await t.http().get('/v1/documents').set(auth(ct)).expect(200)).body.items).toEqual([]);
    const m = (await t.http().get('/v1/folder/manifest').set(auth(ct)).expect(200)).body;
    expect(m.clients).toEqual([]);
    expect(m.files).toEqual([]);
  });
});
