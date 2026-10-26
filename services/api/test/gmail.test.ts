// Fase 10 · Gmail de la empresa con contraseña de aplicación (ADR-065, E-4): un servidor IMAP con las extensiones de
// Gmail (imapkit, X-GM-EXT-1) y un servidor SMTP local hacen de Gmail. El comprobante que la clienta envía por correo
// se registra solo, el recibo sale por correo en el mismo hilo, el correo queda con la etiqueta «COROC/Procesado» y no
// hay duplicados (CA-07). Los correos de otros remitentes no se leen.
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { ImapFlow } from 'imapflow';
import imapkit from 'imapkit';
import { simpleParser, type ParsedMail } from 'mailparser';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import pg from 'pg';
import { SMTPServer } from 'smtp-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DocumentTasks } from '../src/documents/tasks.js';
import { GmailInbox } from '../src/gmail/gmail-inbox.js';
import { MessagingService } from '../src/messaging/messaging.service.js';
import { auth, bootApp, expectContract, newTenant, PASSWORD } from './helpers.js';
import { receiptHtml, renderOne, type Truth } from './receipts/dataset.js';

type T = Awaited<ReturnType<typeof bootApp>>;
const TOKEN = crypto.randomBytes(32).toString('base64url');
const ADDRESS = 'cobros.inversiones@gmail.com';
const APP_PASSWORD = 'qwertzuiopasdfgh';
const MARIA = 'maria.perez@example.com';
const chromium = process.env.COROC_CHROMIUM_PATH;
const truth = (x: Partial<Truth>): Truth => ({ amount: 60_000, currency: 'COP', date: '2026-10-09', payer: 'María José Pérez Gómez', receiver: 'Inversiones Coroc SAS', reference: '0048213377', ...x });
const GMAIL_STORAGE = {
  INBOX: {},
  '': { separator: '/', folders: { '[Gmail]': { flags: ['\\Noselect'], folders: { 'All Mail': { 'special-use': '\\All' }, 'Sent Mail': { 'special-use': '\\Sent' }, Trash: { 'special-use': '\\Trash' } } } } },
};

const raw = async (m: { from: string; subject: string; text: string; messageId: string; attachments?: { filename: string; content: Buffer }[] }) =>
  new MailComposer({ from: m.from, to: ADDRESS, subject: m.subject, text: m.text, messageId: m.messageId, date: new Date('2026-10-09T14:58:00Z'), attachments: m.attachments }).compile().build();

describe('Gmail de la empresa (Fase 10, E-4)', () => {
  let t: T;
  let imap: ReturnType<typeof imapkit>;
  let imapPort: number;
  let smtp: SMTPServer;
  const outbox: ParsedMail[] = [];
  let token: string;
  let tenantId: string;
  let clientId: string;
  let loanId: string;
  const h = () => request.agent(t.app.getHttpServer()).set('X-Coroc-Desktop', TOKEN);
  const idle = () => t.app.get(DocumentTasks).idle();
  const inbox = () => t.app.get(GmailInbox);
  const payments = async () => (await h().get(`/v1/loans/${loanId}/ledger`).set(auth(token)).expect(200)).body.filter((e: { type: string }) => e.type === 'payment');
  /** Labels de Gmail de un correo, leídos con un cliente IMAP aparte, como los vería el usuario en Gmail. */
  const labelsOf = async (uid: number) => {
    const c = new ImapFlow({ host: '127.0.0.1', port: imapPort, secure: false, auth: { user: ADDRESS, pass: APP_PASSWORD }, logger: false });
    await c.connect();
    await c.mailboxOpen('INBOX');
    const m = await c.fetchOne(String(uid), { uid: true, labels: true }, { uid: true });
    await c.logout();
    return [...((m && m.labels) || [])];
  };

  beforeAll(async () => {
    imap = imapkit({ plugins: ['IDLE', 'X-GM-EXT-1', 'UIDPLUS', 'SPECIAL-USE'], storage: GMAIL_STORAGE, users: { [ADDRESS]: { password: APP_PASSWORD } } });
    imapPort = await imap.start(0, '127.0.0.1');
    smtp = new SMTPServer({
      secure: false, allowInsecureAuth: true, disabledCommands: ['STARTTLS'], logger: false, authMethods: ['PLAIN', 'LOGIN'],
      onAuth(a, _s, cb) {
        if (a.username === ADDRESS && a.password === APP_PASSWORD) return cb(null, { user: ADDRESS });
        cb(Object.assign(new Error('5.7.8 Username and Password not accepted'), { responseCode: 535 }));
      },
      onData(stream, _s, cb) {
        simpleParser(stream).then((m) => {
          outbox.push(m);
          cb();
        }, cb);
      },
    });
    await new Promise<void>((r) => smtp.listen(0, '127.0.0.1', () => r()));
    Object.assign(process.env, {
      COROC_MODE: 'desktop', COROC_DESKTOP_TOKEN: TOKEN, COROC_GMAIL_WORKER: 'inline', COROC_GMAIL_TLS: 'off', COROC_GMAIL_POLL_SECONDS: '5',
      COROC_GMAIL_IMAP: `127.0.0.1:${imapPort}`, COROC_GMAIL_SMTP: `127.0.0.1:${(smtp.server.address() as AddressInfo).port}`,
    });
    t = await bootApp('2026-10-09T15:00:00Z');
    const tn = await newTenant({ country: 'US', lang: 'es' });
    tenantId = tn.tenantId;
    token = (await h().post('/v1/auth/login').send({ tenant: tn.slug, username: 'propietario', password: PASSWORD, deviceId: 'pc-escritorio-1' }).expect(200)).body.accessToken;
    await h().post('/v1/receiving-accounts').set(auth(token)).send({ holderName: 'INVERSIONES COROC S.A.S.', institution: 'Bancolombia', last4: '4455' }).expect(201);
    const r = (await h().post('/v1/clients').set(auth(token)).send({
      client: {
        firstName: 'María José', lastName: 'Pérez Gómez', phone: '+573157778899', email: MARIA, lang: 'es', idDocType: 'CC', idDocNumber: '1020304050',
        consents: [{ channel: 'email', method: 'Firma en el contrato' }, { channel: 'personal_data', method: 'Autorización Ley 1581' }],
      },
      loan: { principal: 1_000_000, currency: 'COP', method: 'simple', rate: '0.20', installments: 20, frequency: 'daily', disbursementDate: '2026-10-08' },
    }).expect(201)).body;
    clientId = r.client.id;
    loanId = r.loan.id;
    await idle();
    await t.app.get(MessagingService).dispatchDue();
    outbox.length = 0;
  }, 120_000);

  afterAll(async () => {
    await t?.app.close();
    await imap?.stop();
    await new Promise<void>((r) => smtp.close(() => r()));
    for (const k of ['COROC_MODE', 'COROC_DESKTOP_TOKEN', 'COROC_GMAIL_WORKER', 'COROC_GMAIL_TLS', 'COROC_GMAIL_IMAP', 'COROC_GMAIL_SMTP', 'COROC_GMAIL_POLL_SECONDS']) delete process.env[k];
  });

  it('conecta con una contraseña de aplicación y dice con claridad qué falta cuando no sirve', async () => {
    const empty = (await h().get('/v1/company/gmail').set(auth(token)).expect(200)).body;
    expectContract('getGmail', 200, empty);
    expect(empty).toMatchObject({ connected: false, label: 'COROC/Procesado' });
    // Un correo viejo de la clienta, de antes de conectar: no se lee (los pagos anteriores ya se anotaron a mano).
    imap.control.addMessage('INBOX', { raw: await raw({ from: `María <${MARIA}>`, subject: 'Hola', text: 'Pago anterior', messageId: '<viejo@example.com>' }) });
    expect((await h().put('/v1/company/gmail').set(auth(token)).send({ address: ADDRESS, appPassword: 'mi-clave-de-gmail' }).expect(422)).body.code).toBe('GMAIL_APP_PASSWORD_FORMAT');
    expect((await h().put('/v1/company/gmail').set(auth(token)).send({ address: ADDRESS, appPassword: 'abcd efgh ijkl mnop' }).expect(422)).body.code).toBe('GMAIL_AUTH_FAILED');
    const ok = (await h().put('/v1/company/gmail').set(auth(token)).send({ address: ADDRESS.toUpperCase(), appPassword: 'qwer tzui opas dfgh' }).expect(200)).body;
    expectContract('saveGmail', 200, ok);
    expect(ok).toMatchObject({ connected: true, address: ADDRESS, status: 'active', lastError: null, sentToday: 0, dailyLimit: 400 });
    expect(imap.control.getMailbox('COROC/Procesado')).toBeTruthy();
    expect(JSON.stringify(ok)).not.toContain(APP_PASSWORD);
    const test = (await h().post('/v1/company/gmail/test').set(auth(token)).expect(200)).body;
    expectContract('testGmail', 200, test);
    expect(test).toMatchObject({ connected: true, status: 'active' });
    expect(await inbox().syncTenant(tenantId)).toBe(0);
  });

  it('E-4: el comprobante que llega a Gmail se registra solo y el recibo sale por correo en el mismo hilo, con la etiqueta COROC/Procesado', async () => {
    const pdf = await renderOne(receiptHtml('Bancolombia', truth({})), 'pdf', chromium);
    const { uid } = imap.control.addMessage('INBOX', {
      raw: await raw({ from: `María José Pérez <${MARIA}>`, subject: 'Pago de la cuota', text: 'Buenos días, adjunto el comprobante.', messageId: '<pago-1@example.com>', attachments: [{ filename: 'comprobante.pdf', content: pdf }] }),
    });
    // Otro remitente con un adjunto: COROC no abre correos que no son de un cliente.
    const other = imap.control.addMessage('INBOX', { raw: await raw({ from: 'promo@tienda.example', subject: 'Oferta', text: 'Compre ya', messageId: '<promo@tienda.example>', attachments: [{ filename: 'oferta.pdf', content: pdf }] }) });
    expect(await inbox().syncTenant(tenantId)).toBe(1);
    await idle();
    const items = (await h().get('/v1/intake').set(auth(token)).query({ channel: 'email' }).expect(200)).body.items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ status: 'applied_auto', clientId, loanId, senderEmail: MARIA, identification: { via: 'email' } });
    expect(await payments()).toHaveLength(1);
    await t.app.get(MessagingService).dispatchDue();
    await idle();
    await t.app.get(MessagingService).dispatchDue();
    expect(outbox).toHaveLength(1);
    const sent = outbox[0]!;
    expect(sent.to && 'value' in sent.to ? sent.to.value[0]!.address : null).toBe(MARIA);
    expect(sent.from?.value[0]!.address).toBe(ADDRESS);
    expect(sent.subject).toBe('Re: Pago de la cuota');
    expect(sent.inReplyTo).toBe('<pago-1@example.com>');
    expect(sent.text).toContain('Si no quieres recibir más correos, responde SALIR.');
    expect(sent.text).not.toMatch(/https?:\/\//);
    expect(sent.attachments.map((a) => a.contentType)).toContain('application/pdf');
    expect(await labelsOf(uid)).toContain('COROC/Procesado');
    expect(await labelsOf(other.uid)).not.toContain('COROC/Procesado');
    const thread = (await h().get(`/v1/clients/${clientId}/emails`).set(auth(token)).expect(200)).body;
    expectContract('clientEmails', 200, thread);
    expect(thread.items.map((x: any) => [x.direction, x.subject])).toEqual([['out', 'Re: Pago de la cuota'], ['in', 'Pago de la cuota']]);
    expect(thread.items[1].attachments[0]).toMatchObject({ name: 'comprobante.pdf', intakeId: items[0].id });
    const st = (await h().get('/v1/company/gmail').set(auth(token)).expect(200)).body;
    expect(st.sentToday).toBe(1);
  }, 120_000);

  it('CA-07: revisar otra vez no repite nada y el mismo comprobante en otro correo queda como duplicado', async () => {
    expect(await inbox().syncTenant(tenantId)).toBe(0);
    const pdf = await renderOne(receiptHtml('Bancolombia', truth({})), 'pdf', chromium);
    imap.control.addMessage('INBOX', { raw: await raw({ from: MARIA, subject: 'Otra vez', text: 'Lo envío de nuevo', messageId: '<pago-1-bis@example.com>', attachments: [{ filename: 'comprobante.pdf', content: pdf }] }) });
    expect(await inbox().syncTenant(tenantId)).toBe(1);
    await idle();
    const items = (await h().get('/v1/intake').set(auth(token)).query({ channel: 'email' }).expect(200)).body.items;
    expect(items[0]).toMatchObject({ status: 'duplicate' });
    expect(await payments()).toHaveLength(1);
  }, 120_000);

  it('con la conexión abierta (IDLE) el correo nuevo se procesa al llegar, sin esperar la revisión', async () => {
    await inbox().refresh();
    const pdf = await renderOne(receiptHtml('Bancolombia', truth({ date: '2026-10-09', reference: '0048213388', amount: 60_000 })), 'pdf', chromium);
    const before = (await payments()).length;
    await new Promise((r) => setTimeout(r, 500));
    imap.control.addMessage('INBOX', { raw: await raw({ from: MARIA, subject: 'Cuota 2', text: 'Pago de la segunda cuota', messageId: '<pago-2@example.com>', attachments: [{ filename: 'pago2.pdf', content: pdf }] }) });
    for (let i = 0; i < 60; i++) {
      await idle();
      if ((await payments()).length > before) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect((await payments()).length).toBe(before + 1);
    await inbox().onModuleDestroy();
  }, 120_000);

  it('respeta el límite diario de Gmail: lo que pasa del cupo espera al día siguiente', async () => {
    const admin = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
    await admin.connect();
    await admin.query('UPDATE coroc.gmail_accounts SET daily_limit = sent_count WHERE tenant_id = $1', [tenantId]);
    await admin.end();
    const m = (await h().post('/v1/messages').set(auth(token)).send({ loanId, event: 'manual', channel: 'email', body: 'Hola María, le escribimos sobre su préstamo.' }).expect(201)).body;
    const before = outbox.length;
    await t.app.get(MessagingService).dispatchDue();
    const after = (await h().get('/v1/messages').set(auth(token)).query({ clientId }).expect(200)).body.items.find((x: any) => x.id === m.id);
    expect(outbox.length).toBe(before);
    expect(after).toMatchObject({ status: 'scheduled', error: 'GMAIL_DAILY_LIMIT' });
    expect(after.scheduledAt >= '2026-10-10').toBe(true);
  });

  it('«SALIR» respondido por correo excluye a la clienta del correo (§20.1)', async () => {
    imap.control.addMessage('INBOX', { raw: await raw({ from: MARIA, subject: 'Re: Pago de la cuota', text: 'SALIR\n\nEl mar., escribió…', messageId: '<salir@example.com>' }) });
    expect(await inbox().syncTenant(tenantId)).toBe(1);
    const c = (await h().get(`/v1/clients/${clientId}`).set(auth(token)).expect(200)).body;
    // La ficha muestra los consentimientos vigentes: el del correo ya no está.
    expect(c.consents.map((x: any) => x.channel)).toEqual(['personal_data']);
    const pending = (await h().get('/v1/messages').set(auth(token)).query({ clientId, channel: 'email', status: 'blocked' }).expect(200)).body.items;
    expect(pending.length).toBeGreaterThan(0);
  });
});
