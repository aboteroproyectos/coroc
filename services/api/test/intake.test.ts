// Fase 3 · Recepción y lectura (§12–§14, CA-07, CA-08, CA-09): canales, lectura con OCR real, identificación del
// remitente, validaciones, decisión automática y Bandeja de validación.
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DocumentTasks } from '../src/documents/tasks.js';
import { auth, bootApp, expectContract, newTenant, ownerSession, PASSWORD } from './helpers.js';
import { receiptHtml, renderOne, type Truth } from './receipts/dataset.js';

type T = Awaited<ReturnType<typeof bootApp>>;
const hasTesseract = (() => {
  try {
    execFileSync(process.env.COROC_TESSERACT_PATH || 'tesseract', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const run = hasTesseract || process.env.COROC_REQUIRE_OCR ? describe : describe.skip;

const CA01_TERMS = { principal: 1_000_000, currency: 'COP', method: 'simple', rate: '0.20', installments: 20, frequency: 'daily', disbursementDate: '2026-10-08' };
const MARIA_PHONE = '+573157778899';
const maria = { firstName: 'María José', lastName: 'Pérez Gómez', phone: MARIA_PHONE, email: 'maria.perez@example.com', lang: 'es', idDocType: 'CC', idDocNumber: '1020304050' };
const pedro = { firstName: 'Pedro Luis', lastName: 'Ramírez Ortiz', phone: '+573009998877', lang: 'es', idDocType: 'CC', idDocNumber: '9080706050' };
const APP_SECRET = 'app-secret-de-prueba-whatsapp';
const EMAIL_SECRET = 'secreto-del-buzon-de-pagos';
const chromium = process.env.COROC_CHROMIUM_PATH;

const truth = (x: Partial<Truth>): Truth => ({ amount: 60_000, currency: 'COP', date: '2026-10-09', payer: 'María José Pérez Gómez', receiver: 'Inversiones Coroc SAS', reference: '0048213377', ...x });

run('Recepción y lectura de comprobantes (§12–§14, CA-07 a CA-09)', () => {
  let t: T;
  let token: string;
  let slug: string;
  let loanId: string;
  let clientId: string;
  let pedroLoan: string;
  let graph: http.Server;
  const media = new Map<string, Buffer>();
  const idle = () => t.app.get(DocumentTasks).idle();
  const intake = async (id: string) => (await t.http().get(`/v1/intake/${id}`).set(auth(token)).expect(200)).body;
  const payments = async (loan: string) => (await t.http().get(`/v1/loans/${loan}/ledger`).set(auth(token)).expect(200)).body.filter((e: { type: string }) => e.type === 'payment');

  /** Webhook de WhatsApp firmado como lo firma Meta, con un medio en el Graph API de prueba. */
  const whatsapp = async (from: string, file: Buffer, mime: string, msgId = `wamid.${crypto.randomBytes(6).toString('hex')}`) => {
    const mediaId = crypto.randomBytes(5).toString('hex');
    media.set(mediaId, file);
    const payload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: `5730${slug.length}0001` }, messages: [{ from, id: msgId, type: mime === 'application/pdf' ? 'document' : 'image', [mime === 'application/pdf' ? 'document' : 'image']: { id: mediaId, mime_type: mime, caption: 'Pago cuota' } }] } }] }],
    });
    const sig = `sha256=${crypto.createHmac('sha256', APP_SECRET).update(payload).digest('hex')}`;
    const r = await t.http().post('/v1/webhooks/whatsapp').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sig).send(payload).expect(200);
    await idle();
    const row = (await t.http().get('/v1/intake').set(auth(token)).query({ channel: 'whatsapp' }).expect(200)).body.items[0];
    return { res: r.body, item: row };
  };
  const email = async (from: string, name: string, file: Buffer, mime: string) => {
    const r = await t.http()
      .post('/v1/webhooks/email/inbound')
      .query({ token: EMAIL_SECRET })
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ FromFull: { Email: from }, ToFull: [{ Email: `pagos-${slug}@in.coroc.test` }], MessageID: crypto.randomUUID(), Subject: 'Comprobante', Attachments: [{ Name: name, Content: file.toString('base64'), ContentType: mime }, { Name: 'firma.txt', Content: Buffer.from('saludos').toString('base64'), ContentType: 'text/plain' }] }))
      .expect(200);
    await idle();
    return r.body;
  };

  beforeAll(async () => {
    graph = http.createServer((req, res) => {
      if (req.headers.authorization !== 'Bearer token-de-acceso-de-prueba-0000') return void res.writeHead(401).end();
      const m = /^\/v23\.0\/(\w+)$/.exec(req.url ?? '');
      if (m) return void res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ url: `http://127.0.0.1:${(graph.address() as AddressInfo).port}/media/${m[1]}` }));
      const f = /^\/media\/(\w+)$/.exec(req.url ?? '');
      if (f && media.has(f[1]!)) return void res.writeHead(200, { 'Content-Type': 'application/octet-stream' }).end(media.get(f[1]!));
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => graph.listen(0, '127.0.0.1', r));
    Object.assign(process.env, {
      COROC_WHATSAPP_APP_SECRET: APP_SECRET,
      COROC_WHATSAPP_VERIFY_TOKEN: 'verificar-coroc',
      COROC_WHATSAPP_GRAPH_URL: `http://127.0.0.1:${(graph.address() as AddressInfo).port}`,
      COROC_INBOUND_EMAIL_SECRET: EMAIL_SECRET,
      COROC_INBOUND_EMAIL_DOMAIN: 'in.coroc.test',
    });
    t = await bootApp('2026-10-09T15:00:00Z');
    // Empresa sin tope de tasa (ADR-027), en español.
    const tenant = await newTenant({ country: 'US', lang: 'es' });
    slug = tenant.slug;
    token = (await ownerSession(t, slug)).token;
    await t.http().post('/v1/receiving-accounts').set(auth(token)).send({ holderName: 'INVERSIONES COROC S.A.S.', institution: 'Bancolombia', last4: '4455' }).expect(201);
    const r = await t.http().post('/v1/clients').set(auth(token)).send({ client: maria, loan: CA01_TERMS }).expect(201);
    loanId = r.body.loan.id;
    clientId = r.body.client.id;
    pedroLoan = (await t.http().post('/v1/clients').set(auth(token)).send({ client: pedro, loan: { ...CA01_TERMS, principal: 500_000 } }).expect(201)).body.loan.id;
    const wa = await t.http().put('/v1/company/whatsapp').set(auth(token)).send({ phoneNumberId: `5730${slug.length}0001`, accessToken: 'token-de-acceso-de-prueba-0000', displayNumber: '+57 300 000 0001' }).expect(200);
    expectContract('saveWhatsAppAccount', 200, wa.body);
    expect(wa.body).toMatchObject({ configured: true, serverReady: true, webhookUrl: 'https://api.coroc.test/v1/webhooks/whatsapp' });
    expect(JSON.stringify(wa.body)).not.toContain('token-de-acceso');
    await idle();
  }, 120_000);
  afterAll(async () => {
    await t.app.close();
    graph.close();
  });

  it('webhook de WhatsApp: verificación de Meta y firma obligatoria', async () => {
    const v = await t.http().get('/v1/webhooks/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verificar-coroc', 'hub.challenge': '98765' }).expect(200);
    expect(v.text).toBe('98765');
    await t.http().get('/v1/webhooks/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'otro', 'hub.challenge': '1' }).expect(403);
    await t.http().post('/v1/webhooks/whatsapp').set('Content-Type', 'application/json').set('X-Hub-Signature-256', 'sha256=00').send('{"entry":[]}').expect(401);
  });

  it('CA-07: el comprobante llega por WhatsApp, se lee con OCR y se registra solo; al llegar otra vez por correo queda DUPLICADO', async () => {
    const png = await renderOne(receiptHtml('Bancolombia', truth({})), 'png', chromium);
    const { item } = await whatsapp('573157778899', png, 'image/png');
    expectContract('listIntake', 200, { items: [item], nextCursor: null });
    expect(item).toMatchObject({ channel: 'whatsapp', senderPhone: MARIA_PHONE, status: 'applied_auto', clientId, loanId, identification: { status: 'identified', via: 'phone' } });
    expect(item.extraction.amount).toMatchObject({ value: 60_000 });
    expect(item.extraction.amount.confidence).toBeGreaterThanOrEqual(0.95);
    expect(item.extraction.amount.region).toMatchObject({ page: 0 });
    expect(item.extraction.date.value).toBe('2026-10-09');
    expect(item.extraction.reference.value).toBe('0048213377');
    expect(item.flags.filter((f: { severity: string }) => f.severity === 'blocking')).toEqual([]);
    expect(item.receiptNumber).toBe('RC-000001');
    expect(item.stage).toBe('RECIBO_EMITIDO');
    expect(item.revertibleUntil).toBe('2026-10-12T15:00:00.000Z');
    const pays = await payments(loanId);
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({ amount: 60_000, source: 'whatsapp', auto: true, reference: '0048213377' });
    // Reintento del mismo webhook (mismo id de mensaje): no se recibe dos veces.
    const again = await whatsapp('573157778899', png, 'image/png', 'wamid.repetido');
    await whatsapp('573157778899', png, 'image/png', 'wamid.repetido');
    expect((await t.http().get('/v1/intake').set(auth(token)).query({ channel: 'whatsapp' }).expect(200)).body.items.filter((x: { id: string }) => x.id === again.item.id)).toHaveLength(1);
    expect(again.item.status).toBe('duplicate');

    // Mismo comprobante reenviado por correo, ahora en PDF: otro archivo, misma huella lógica.
    const pdf = await renderOne(receiptHtml('Bancolombia', truth({})), 'pdf', chromium);
    const mail = await email('maria.perez@example.com', 'comprobante.pdf', pdf, 'application/pdf');
    expect(mail).toEqual({ received: 1 });
    const viaMail = (await t.http().get('/v1/intake').set(auth(token)).query({ channel: 'email' }).expect(200)).body.items[0];
    expect(viaMail).toMatchObject({ status: 'duplicate', stage: 'DUPLICADO', senderEmail: 'maria.perez@example.com', identification: { via: 'email', duplicateOf: item.id } });
    expect(await payments(loanId)).toHaveLength(1);
  }, 120_000);

  it('CA-08: desde un número no registrado va a «Sin asignar» con sugerencias; al asignarlo se guarda el número', async () => {
    const png = await renderOne(receiptHtml('Nequi', truth({ amount: 60_000, reference: 'M44001122' })), 'png', chromium);
    const { item } = await whatsapp('573201234567', png, 'image/png');
    expect(item.status).toBe('unassigned');
    expect(item.clientId).toBeNull();
    const full = await intake(item.id);
    expectContract('getIntake', 200, full);
    expect(full.identification.status).toBe('unknown');
    expect(full.identification.candidates[0]).toMatchObject({ clientId, name: 'María José Pérez Gómez' });
    expect(full.flags.map((f: { code: string }) => f.code)).toContain('SENDER_UNKNOWN');
    const summary = (await t.http().get('/v1/intake/summary').set(auth(token)).expect(200)).body;
    expectContract('intakeSummary', 200, summary);
    expect(summary.unassigned).toBeGreaterThanOrEqual(1);

    const ok = await t.http().post(`/v1/intake/${item.id}/approve`).set(auth(token)).set('Idempotency-Key', crypto.randomUUID())
      .send({ clientId, loanId, amount: 60_000, date: '2026-10-09', saveSenderAsSecondaryNumber: true }).expect(201);
    expectContract('approveIntake', 201, ok.body);
    expect(ok.body).toMatchObject({ senderSaved: true, intakeId: item.id, receipt: { number: 'RC-000002' } });
    const c = (await t.http().get(`/v1/clients/${clientId}`).set(auth(token)).expect(200)).body;
    expect(c.client?.phone2 ?? c.phone2).toBe('+573201234567');
    expect((await intake(item.id)).status).toBe('approved');
    // El siguiente comprobante desde ese número ya se identifica solo.
    const next = await whatsapp('573201234567', await renderOne(receiptHtml('Daviplata', truth({ amount: 150_000, reference: '845213' })), 'png', chromium), 'image/png');
    expect(next.item).toMatchObject({ clientId, identification: { status: 'identified', via: 'phone' } });
    // Aprobar dos veces no registra dos pagos.
    await t.http().post(`/v1/intake/${item.id}/approve`).set(auth(token)).set('Idempotency-Key', crypto.randomUUID()).send({ clientId, loanId, amount: 60_000, date: '2026-10-09' }).expect(409);
  }, 120_000);

  it('CA-09: si el beneficiario no es una cuenta de la empresa no se aplica y va a revisión con alerta', async () => {
    const before = (await payments(loanId)).length;
    const png = await renderOne(receiptHtml('Bancolombia', truth({ receiver: 'Distribuidora La Esperanza Ltda', reference: '0099887766', amount: 60_000 })), 'png', chromium);
    const { item } = await whatsapp('573157778899', png, 'image/png');
    expect(item.status).toBe('review');
    expect(item.clientId).toBe(clientId);
    expect(item.flags).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'RECEIVER_MISMATCH', severity: 'blocking' })]));
    expect(await payments(loanId)).toHaveLength(before);
    // Rechazo con motivo: el archivo queda en el repositorio etiquetado.
    const rej = await t.http().post(`/v1/intake/${item.id}/reject`).set(auth(token)).send({ reason: 'Pago a otra cuenta' }).expect(200);
    expectContract('rejectIntake', 200, rej.body);
    expect(rej.body).toMatchObject({ status: 'rejected', reason: 'Pago a otra cuenta' });
    const doc = (await t.http().get(`/v1/documents/${item.documentId}`).set(auth(token)).expect(200)).body;
    expect(doc.tags).toContain('rechazado');
  }, 120_000);

  it('portal del deudor: el enlace identifica al remitente, el pago se registra solo y se revierte con un toque', async () => {
    const link = await t.http().post(`/v1/loans/${pedroLoan}/upload-link`).set(auth(token)).expect(201);
    expectContract('rotateUploadLink', 201, link.body);
    expect(link.body.url).toMatch(/^https:\/\/api\.coroc\.test\/v1\/public\/upload\/[A-Za-z0-9_-]{32}$/);
    expect((await t.http().get(`/v1/loans/${pedroLoan}/upload-link`).set(auth(token)).expect(200)).body.url).toBe(link.body.url);
    const path = new URL(link.body.url).pathname;

    const page = await t.http().get(path).set('Accept', 'text/html').expect(200);
    expect(page.headers['content-security-policy']).toContain("default-src 'none'");
    expect(page.text).toContain('Hola, Pedro Luis');
    expect(page.text).toContain('Enviar comprobante de pago');
    expect(page.text).not.toContain('<script');
    const json = (await t.http().get(path).set('Accept', 'application/json').expect(200)).body;
    expectContract('debtorPortal', 200, json);
    expect(json).toMatchObject({ clientFirstName: 'Pedro Luis', contract: 'CT-000002', closed: false });
    expect(JSON.stringify(json)).not.toContain('Ramírez');
    expect((await t.http().get(path).query({ lang: 'en' }).set('Accept', 'text/html').expect(200)).text).toContain('Send proof of payment');

    const png = await renderOne(receiptHtml('PSE', truth({ amount: 30_000, payer: 'Pedro Luis Ramírez Ortiz', reference: 'CUS7788123' })), 'png', chromium);
    const up = await t.http().post(path).set('Accept', 'text/html').attach('file', png, 'pse.png').field('note', 'Cuota de hoy').expect(303);
    expect(up.headers.location).toBe(`${path}?lang=es&sent=1`);
    await idle();
    const item = (await t.http().get('/v1/intake').set(auth(token)).query({ channel: 'upload_link' }).expect(200)).body.items[0];
    expect(item).toMatchObject({ status: 'applied_auto', loanId: pedroLoan, identification: { via: 'upload_link' }, messageText: 'Cuota de hoy' });
    expect((await payments(pedroLoan)).map((p: { amount: number }) => p.amount)).toEqual([30_000]);
    expect((await t.http().get(`${path}?sent=1`).set('Accept', 'text/html').expect(200)).text).toContain('¡Recibimos tu comprobante!');

    // Revertir con un toque (dentro de 72 h): contramovimiento, recibo ANULADO y el comprobante vuelve a revisión.
    const rev = await t.http().post(`/v1/intake/${item.id}/revert`).set(auth(token)).send({}).expect(200);
    expectContract('revertAutoIntake', 200, rev.body);
    expect(rev.body).toMatchObject({ status: 'review', entryId: null });
    expect((await payments(pedroLoan))[0].reversedBy).toBeTruthy();
    await t.http().post(`/v1/intake/${item.id}/revert`).set(auth(token)).send({}).expect(409);

    // Un archivo que no es imagen ni PDF se rechaza en la misma página.
    const bad = await t.http().post(path).set('Accept', 'text/html').attach('file', Buffer.from('hola'), 'nota.txt').expect(415);
    expect(bad.text).toContain('Solo se aceptan fotos');
    // Rotar invalida el enlace anterior; revocar lo apaga.
    await t.http().post(`/v1/loans/${pedroLoan}/upload-link`).set(auth(token)).expect(201);
    expect((await t.http().get(path).set('Accept', 'text/html').expect(410)).text).toContain('Enlace no disponible');
    await t.http().delete(`/v1/loans/${pedroLoan}/upload-link`).set(auth(token)).expect(204);
    await t.http().get(`/v1/loans/${pedroLoan}/upload-link`).set(auth(token)).expect(404);
    await t.http().get('/v1/public/upload/no-existe-este-enlace-0000').set('Accept', 'application/json').expect(404);
  }, 120_000);

  it('«Aprobación previa»: todo pasa por la Bandeja y se aprueba en lote; las correcciones quedan como ejemplos', async () => {
    await t.http().patch('/v1/company').set(auth(token)).send({ settings: { supervisionMode: 'prior_approval' } }).expect(200);
    try {
      const png = await renderOne(receiptHtml('Davivienda', truth({ amount: 90_000, reference: '77120045', payer: 'María José Pérez Gómez' })), 'png', chromium);
      const up = await t.http().post('/v1/intake').set(auth(token)).query({ channel: 'share', fileName: 'davivienda.png' }).set('Content-Type', 'application/octet-stream').send(png).expect(202);
      expectContract('uploadIntake', 202, up.body);
      expect(up.body.status).toBe('processing');
      await idle();
      const it1 = await intake(up.body.id);
      // «Compartir» no trae el número: se identifica por el nombre del pagador y queda a revisión.
      expect(it1.status).toBe('unassigned');
      expect(it1.identification.candidates[0].clientId).toBe(clientId);

      const folder = await t.http().post('/v1/intake').set(auth(token)).query({ channel: 'folder', clientId }).set('Content-Type', 'application/octet-stream')
        .send(await renderOne(receiptHtml('BBVA', truth({ amount: 45_000, reference: 'BB0099001' })), 'pdf', chromium)).expect(202);
      await idle();
      const it2 = await intake(folder.body.id);
      expect(it2).toMatchObject({ status: 'review', clientId, loanId, identification: { via: 'folder' } });
      expect(it2.flags.filter((f: { severity: string }) => f.severity === 'blocking')).toEqual([]);

      const batch = await t.http().post('/v1/intake/approve-batch').set(auth(token)).send({ ids: [it1.id, it2.id] }).expect(200);
      expectContract('approveIntakeBatch', 200, batch.body);
      expect(batch.body.approved).toEqual([it2.id]);
      expect(batch.body.skipped).toEqual([{ id: it1.id, reason: expect.any(String) }]);

      // Corregir el valor y aprobar: la corrección queda como ejemplo de la empresa (§13.6).
      await t.http().post(`/v1/intake/${it1.id}/approve`).set(auth(token)).set('Idempotency-Key', crypto.randomUUID())
        .send({ clientId, loanId, amount: 95_000, date: '2026-10-09' }).expect(201);
      expect((await payments(loanId)).map((p: { amount: number }) => p.amount)).toEqual(expect.arrayContaining([45_000, 95_000]));
      expect((await intake(it1.id)).status).toBe('approved');
    } finally {
      await t.http().patch('/v1/company').set(auth(token)).send({ settings: { supervisionMode: 'auto_with_audit' } }).expect(200);
    }
  }, 120_000);

  it('«No es comprobante» se archiva en Otros documentos; el texto leído queda para la búsqueda', async () => {
    const html = '<html><body style="font:20px Arial;padding:30px;width:420px"><h1>Cédula de ciudadanía</h1><p>República de Colombia</p><p>Nombre María José Pérez Gómez</p></body></html>';
    const up = await t.http().post('/v1/intake').set(auth(token)).query({ channel: 'upload', clientId }).set('Content-Type', 'application/octet-stream').send(await renderOne(html, 'png', chromium)).expect(202);
    await idle();
    const it1 = await intake(up.body.id);
    expect(it1).toMatchObject({ status: 'archived', stage: 'NO_ES_COMPROBANTE' });
    const doc = (await t.http().get(`/v1/documents/${it1.documentId}`).set(auth(token)).expect(200)).body;
    expect(doc.kind).toBe('other');
    const found = (await t.http().get('/v1/documents').set(auth(token)).query({ q: 'cedula de ciudadania' }).expect(200)).body;
    expect(found.items.map((d: { id: string }) => d.id)).toContain(it1.documentId);
  }, 120_000);

  it('correo entrante: secreto obligatorio y destinatario desconocido ignorado', async () => {
    await t.http().post('/v1/webhooks/email/inbound').query({ token: 'otro' }).set('Content-Type', 'application/json').send('{}').expect(401);
    const r = await t.http().post('/v1/webhooks/email/inbound').query({ token: EMAIL_SECRET }).set('Content-Type', 'application/json')
      .send(JSON.stringify({ FromFull: { Email: 'x@example.com' }, ToFull: [{ Email: 'pagos-no-existe@in.coroc.test' }], Attachments: [] })).expect(200);
    expect(r.body).toEqual({ received: 0, ignored: 'unknown_recipient' });
  });

  it('el Cobrador solo ve en la Bandeja los comprobantes de sus clientes', async () => {
    const u = await t.http().post('/v1/users').set(auth(token)).send({ username: 'cobrador1', name: 'Cobrador Uno', role: 'collector', password: PASSWORD }).expect(201);
    const own = await t.http().post('/v1/clients').set(auth(token))
      .send({ client: { firstName: 'Rosa Elena', lastName: 'Vargas Díaz', phone: '+573104445566', lang: 'es', idDocType: 'CC', idDocNumber: '5566778899', collectorId: u.body.id }, loan: { ...CA01_TERMS, principal: 300_000 } }).expect(201);
    await t.http().post('/v1/intake').set(auth(token)).query({ channel: 'folder', clientId: own.body.client.id }).set('Content-Type', 'application/octet-stream')
      .send(await renderOne(receiptHtml('BBVA', truth({ amount: 18_000, payer: 'Rosa Elena Vargas Díaz', reference: 'BB0033221' })), 'pdf', chromium)).expect(202);
    await idle();
    const login = (await t.http().post('/v1/auth/login').send({ tenant: slug, username: 'cobrador1', password: PASSWORD, deviceId: 'cel-cobrador-1' }).expect(200)).body;
    const list = (await t.http().get('/v1/intake').set(auth(login.accessToken)).expect(200)).body.items;
    expect(list.length).toBe(1);
    expect(list[0].clientId).toBe(own.body.client.id);
    const pedroItem = (await t.http().get('/v1/intake').set(auth(token)).query({ channel: 'upload_link' }).expect(200)).body.items[0];
    await t.http().get(`/v1/intake/${pedroItem.id}`).set(auth(login.accessToken)).expect(403);
  }, 120_000);

  it('§21: 20 comprobantes a la vez por el portal quedan registrados como pago con p95 < 60 s', async () => {
    const N = 20;
    const names = ['Ana', 'Beatriz', 'Carlos', 'Diana', 'Eduardo', 'Fabiola', 'Gustavo', 'Helena', 'Iván', 'Julia'];
    const people = await Promise.all(Array.from({ length: N }, async (_, i) => {
      const client = { firstName: `${names[i % names.length]} Sofía`, lastName: `Carga ${String.fromCharCode(65 + i)} Muñoz`, phone: `+57315000${String(i).padStart(4, '0')}`, lang: 'es', idDocType: 'CC', idDocNumber: `7000${String(i).padStart(6, '0')}` };
      const loan = (await t.http().post('/v1/clients').set(auth(token)).send({ client, loan: { ...CA01_TERMS, principal: 400_000 } }).expect(201)).body.loan.id as string;
      const link = (await t.http().post(`/v1/loans/${loan}/upload-link`).set(auth(token)).expect(201)).body.url as string;
      return { loan, path: new URL(link).pathname, payer: `${client.firstName} ${client.lastName}` };
    }));
    // Las imágenes se generan antes de medir: el reloj corre desde que el deudor envía el archivo.
    const files: Buffer[] = [];
    for (const [i, p] of people.entries()) files.push(await renderOne(receiptHtml(i % 2 ? 'Nequi' : 'PSE', truth({ amount: 20_000 + i * 100, payer: p.payer, reference: `CARGA${String(i).padStart(5, '0')}` })), 'png', chromium));
    const started = new Map<string, number>();
    const done = new Map<string, number>();
    await Promise.all(people.map(async (p, i) => {
      started.set(p.loan, performance.now());
      await t.http().post(p.path).set('Accept', 'text/html').attach('file', files[i]!, `comprobante-${i}.png`).expect(303);
    }));
    const deadline = performance.now() + 120_000;
    while (done.size < N && performance.now() < deadline) {
      const items = (await t.http().get('/v1/intake').set(auth(token)).query({ channel: 'upload_link', limit: 100 }).expect(200)).body.items as { loanId: string; status: string }[];
      for (const it of items) if (started.has(it.loanId) && !done.has(it.loanId) && it.status !== 'processing') done.set(it.loanId, performance.now() - started.get(it.loanId)!);
      await new Promise((r) => setTimeout(r, 200));
    }
    await idle();
    const ms = [...done.values()].sort((a, b) => a - b);
    const p95 = ms[Math.ceil(0.95 * ms.length) - 1]!;
    process.stdout.write(`\n[perf] comprobante→pago con ${N} a la vez: p50 ${Math.round(ms[Math.floor(ms.length / 2)]!)} ms · p95 ${Math.round(p95)} ms\n`);
    expect(done.size).toBe(N);
    for (const p of people) expect((await payments(p.loan)).length).toBe(1);
    expect(p95).toBeLessThan(60_000);
  }, 300_000);
});
