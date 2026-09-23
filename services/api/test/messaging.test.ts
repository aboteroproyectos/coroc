// Fase 4 · Mensajería y cumplimiento (§11, §20.1, CA-10, CA-11, CA-20): plantillas, correo saliente, modo asistido,
// Cloud API de WhatsApp, motor de reglas de contacto en la hora del deudor, exclusión, rebotes y suspensión de la cuenta.
import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DocumentTasks } from '../src/documents/tasks.js';
import { DnsResolver } from '../src/messaging/dns.js';
import { EmailProvider, MemoryEmailProvider } from '../src/messaging/email.js';
import { MessagingService } from '../src/messaging/messaging.service.js';
import { auth, bootApp, expectContract, newTenant, ownerSession, registerRateCap } from './helpers.js';

type T = Awaited<ReturnType<typeof bootApp>>;

const APP_SECRET = 'app-secret-de-prueba-mensajeria';
const EVENTS_SECRET = 'secreto-de-avisos-de-correo';
const WA_TOKEN = 'token-de-acceso-de-prueba-0001';
const TERMS = { principal: 1_000_000, currency: 'COP', method: 'french', rate: '0.015', installments: 6, frequency: 'monthly', disbursementDate: '2026-10-08' };
const CONSENTS = [
  { channel: 'whatsapp', method: 'Firma en el contrato' },
  { channel: 'email', method: 'Firma en el contrato' },
  { channel: 'personal_data', method: 'Autorización Ley 1581' },
];
const person = (i: number, extra: Record<string, unknown> = {}) => ({
  firstName: ['María José', 'Pedro Luis', 'Ana Lucía', 'Jorge Iván', 'Luz Marina'][i % 5], lastName: `Pérez ${i}`,
  phone: `+5731577788${String(10 + i).padStart(2, '0')}`, lang: 'es', idDocType: 'CC', idDocNumber: `10203040${i}`, consents: CONSENTS, ...extra,
});

describe('Mensajería y cumplimiento (§11, CA-10, CA-11, CA-20)', () => {
  let t: T;
  let graph: http.Server;
  let graphMode: 'ok' | 'suspend' = 'ok';
  const graphCalls: { phoneId: string; body: Record<string, any> }[] = [];
  let seq = 0;
  let svc: MessagingService;
  let mail: MemoryEmailProvider;
  const idle = async () => {
    await t.app.get(DocumentTasks).idle();
  };
  const dispatch = async () => {
    await idle();
    return svc.dispatchDue();
  };
  const list = async (token: string, q: Record<string, string>) => {
    const r = await t.http().get('/v1/messages').set(auth(token)).query(q).expect(200);
    expectContract('listMessages', 200, r.body);
    return r.body.items as Record<string, any>[];
  };
  const signed = (payload: unknown) => {
    const raw = JSON.stringify(payload);
    return { raw, sig: `sha256=${crypto.createHmac('sha256', APP_SECRET).update(raw).digest('hex')}` };
  };
  const webhook = async (payload: unknown) => {
    const { raw, sig } = signed(payload);
    return t.http().post('/v1/webhooks/whatsapp').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sig).send(raw).expect(200);
  };

  beforeAll(async () => {
    graph = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const m = /^\/v23\.0\/(\d+)\/messages$/.exec(req.url ?? '');
        if (req.method !== 'POST' || !m || req.headers.authorization !== `Bearer ${WA_TOKEN}`) return void res.writeHead(404).end();
        graphCalls.push({ phoneId: m[1]!, body: JSON.parse(body) });
        if (graphMode === 'suspend') {
          return void res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: 'Account has been locked', type: 'OAuthException', code: 131031 } }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ messaging_product: 'whatsapp', messages: [{ id: `wamid.${++seq}` }] }));
      });
    });
    await new Promise<void>((r) => graph.listen(0, '127.0.0.1', r));
    Object.assign(process.env, {
      COROC_WHATSAPP_APP_SECRET: APP_SECRET,
      COROC_WHATSAPP_VERIFY_TOKEN: 'verificar-coroc',
      COROC_WHATSAPP_GRAPH_URL: `http://127.0.0.1:${(graph.address() as AddressInfo).port}`,
      COROC_EMAIL_EVENTS_SECRET: EVENTS_SECRET,
      // Las pruebas mueven el reloj días enteros (domingo, festivo, vencimientos): la sesión no debe vencer entre tanto.
      COROC_ACCESS_TTL: String(120 * 86_400),
      COROC_REFRESH_TTL_DAYS: '120',
    });
    // Viernes 9-oct-2026, 10:00 en Bogotá: dentro de la franja de la Ley 2300.
    t = await bootApp('2026-10-09T15:00:00Z');
    svc = t.app.get(MessagingService);
    mail = t.app.get(EmailProvider) as MemoryEmailProvider;
  }, 120_000);
  afterAll(async () => {
    await t.app.close();
    graph.close();
  });

  describe('Empresa en modo asistido (Colombia)', () => {
    let token: string;
    let tenantId: string;
    let loanId: string;
    let clientId: string;
    let dueDate: string;

    beforeAll(async () => {
      const tenant = await newTenant();
      tenantId = tenant.tenantId;
      token = (await ownerSession(t, tenant.slug)).token;
      await registerRateCap(t.http, token);
      const r = await t.http().post('/v1/clients').set(auth(token)).send({ client: person(0, { email: 'maria.perez@example.com' }), loan: TERMS }).expect(201);
      loanId = r.body.loan.id;
      clientId = r.body.client.id;
      dueDate = r.body.loan.summary.next.dueDate;
    }, 120_000);

    it('bienvenida + plan de pagos: el correo sale con el PDF adjunto y WhatsApp queda listo con el enlace de carga', async () => {
      const before = mail.sent.length;
      await dispatch();
      const msgs = await list(token, { clientId });
      expect(msgs.map((m) => `${m.event}:${m.channel}`).sort()).toEqual(['welcome:email', 'welcome:whatsapp']);
      const email = msgs.find((m) => m.channel === 'email')!;
      expect(email).toMatchObject({ status: 'sent', via: 'email', kind: 'transactional' });
      const sent = mail.sent.slice(before).find((m) => m.to === 'maria.perez@example.com')!;
      expect(sent.subject).toMatch(/^Bienvenida · préstamo CT-/);
      expect(sent.attachments!.map((a) => a.contentType)).toEqual(['image/png', 'application/pdf']);
      expect(sent.html).toContain('cid:coroc-logo');
      expect(sent.unsubscribeUrl).toMatch(/\/v1\/public\/upload\/[A-Za-z0-9_-]+\/opt-out\?channel=email$/);
      const wa = msgs.find((m) => m.channel === 'whatsapp')!;
      expect(wa).toMatchObject({ status: 'ready', via: 'assisted' });
      expect(wa.body).toContain('Hola María José');
      expect(wa.body).toMatch(/\/v1\/public\/upload\/[A-Za-z0-9_-]+/);
      expect(wa.body).toContain('responde SALIR');
      expect(wa.assisted.whatsappUrl).toMatch(/^https:\/\/wa\.me\/573157778810\?text=Hola%20Mar%C3%ADa/);
      const summary = await t.http().get('/v1/messages/summary').set(auth(token)).expect(200);
      expectContract('messagesSummary', 200, summary.body);
      expect(summary.body.ready).toBe(1);
    });

    it('CA-10: recordatorio de cobranza pedido el domingo 11-oct-2026 a las 10:00 → martes 13-oct 07:00 (el 12 es festivo)', async () => {
      t.clock.set('2026-10-11T15:00:00Z');
      const r = await t.http().post('/v1/messages').set(auth(token)).send({ loanId, event: 'reminder', channel: 'whatsapp' }).expect(201);
      expectContract('composeMessage', 201, r.body);
      expect(r.body).toMatchObject({ status: 'scheduled', kind: 'collection', scheduledAt: '2026-10-13T12:00:00.000Z' });
      expect(r.body.decision).toMatchObject({ decision: 'reschedule', localAt: '2026-10-13T07:00', timeZone: 'America/Bogota', ruleSet: 'CO_LEY_2300_2023' });
      expect(r.body.decision.reasons).toEqual([{ code: 'OUT_OF_WINDOW' }, { code: 'HOLIDAY_SKIPPED', detail: '2026-10-12' }]);
      // Simulación del motor para el mismo deudor y hora.
      const sim = await t.http().post('/v1/compliance/contact-evaluation').set(auth(token)).send({ clientId, kind: 'collection', channel: 'email', requestedAt: '2026-10-11T15:00:00Z' }).expect(200);
      expectContract('evaluateContact', 200, sim.body);
      // El martes ya tiene su contacto de cobranza: un segundo, aunque sea por correo, queda bloqueado.
      expect(sim.body).toMatchObject({ decision: 'block', reasons: [{ code: 'OUT_OF_WINDOW' }, { code: 'HOLIDAY_SKIPPED', detail: '2026-10-12' }, { code: 'MAX_PER_DAY', detail: '2026-10-13' }] });
      // Hasta el martes 07:00 el despachador no lo toca.
      t.clock.set('2026-10-12T20:00:00Z');
      await dispatch();
      expect((await list(token, { clientId, event: 'reminder' }))[0]!.status).toBe('scheduled');
    });

    it('CA-11: el segundo mensaje de cobranza del mismo día queda bloqueado con la regla aplicada', async () => {
      t.clock.set('2026-10-13T12:00:00Z');
      await dispatch();
      const [reminder] = await list(token, { clientId, event: 'reminder' });
      expect(reminder).toMatchObject({ status: 'ready', via: 'assisted' });
      t.clock.set('2026-10-13T14:00:00Z');
      const r = await t.http().post('/v1/messages').set(auth(token)).send({ loanId, event: 'overdue', channel: 'whatsapp' }).expect(201);
      expect(r.body.status).toBe('blocked');
      expect(r.body.decision.reasons.at(-1)).toEqual({ code: 'MAX_PER_DAY', detail: '2026-10-13' });
      const blocked = await list(token, { status: 'blocked' });
      expect(blocked.map((m) => m.id)).toContain(r.body.id);
    });

    it('modo asistido: «Enviar» vuelve a aplicar las reglas; fuera de franja no se envía', async () => {
      const [reminder] = await list(token, { clientId, event: 'reminder' });
      // Martes 13-oct 20:00 en Bogotá: fuera de la franja de 7:00 a 19:00.
      t.clock.set('2026-10-14T01:00:00Z');
      const late = await t.http().post(`/v1/messages/${reminder!.id}/send`).set(auth(token)).expect(409);
      expect(late.body).toMatchObject({ code: 'CONTACT_OUT_OF_WINDOW' });
      t.clock.set('2026-10-13T13:00:00Z');
      const ok = await t.http().post(`/v1/messages/${reminder!.id}/send`).set(auth(token)).expect(200);
      expectContract('sendMessage', 200, ok.body);
      expect(ok.body).toMatchObject({ status: 'sent', via: 'assisted', sentAt: '2026-10-13T13:00:00.000Z' });
      expect(ok.body.assisted.whatsappUrl).toMatch(/^https:\/\/wa\.me\/573157778810/);
      await t.http().post(`/v1/messages/${reminder!.id}/send`).set(auth(token)).expect(409);
    });

    it('pago recibido: el recibo sale con un enlace seguro de descarga que abre el PDF', async () => {
      t.clock.set('2026-10-13T16:00:00Z');
      await t.http().post(`/v1/loans/${loanId}/payments`).set(auth(token)).send({ amount: 50_000, date: '2026-10-13', method: 'Nequi' }).expect(201);
      await dispatch();
      const [receipt] = await list(token, { clientId, event: 'receipt' });
      expect(receipt).toMatchObject({ status: 'ready', channel: 'whatsapp', kind: 'transactional' });
      expect(receipt!.attachmentDocumentId).toBeTruthy();
      expect(receipt!.body).toContain('Recibimos $ 50.000');
      const link = /https:\/\/api\.coroc\.test(\/v1\/files\/[A-Za-z0-9_.-]+)/.exec(receipt!.body)![1]!;
      const pdf = await t.http().get(link).expect(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');
      expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('plantillas: el validador bloquea amenazas y la vista previa usa los datos reales del préstamo', async () => {
      const bad = await t.http().put('/v1/message-templates/reminder/es').set(auth(token)).send({ body: 'Hola {{nombre}}, si no paga iniciaremos el embargo de sus bienes.' }).expect(422);
      expect(bad.body.code).toBe('TEMPLATE_BLOCKED');
      const ok = await t.http().put('/v1/message-templates/reminder/es').set(auth(token)).send({ body: 'Hola {{nombre}}, tu cuota {{cuota_numero}} de {{valor_cuota}} vence el {{fecha_vencimiento}}. Comprobantes: {{enlace_carga}}' }).expect(200);
      expectContract('saveTemplate', 200, ok.body);
      expect(ok.body).toMatchObject({ custom: true, variables: ['nombre', 'cuota_numero', 'valor_cuota', 'fecha_vencimiento', 'enlace_carga'] });
      const all = await t.http().get('/v1/message-templates').set(auth(token)).expect(200);
      expectContract('listTemplates', 200, all.body);
      expect(all.body.templates).toHaveLength(21);
      const pv = await t.http().post('/v1/message-templates/preview').set(auth(token)).send({ event: 'reminder', loanId }).expect(200);
      expectContract('previewTemplate', 200, pv.body);
      expect(pv.body.body).toMatch(/^Hola María José, tu cuota 1 de \$ [\d.]+ vence el \d+ de noviembre de 2026\./);
      expect(pv.body.length).toBe(pv.body.body.length);
      await t.http().put('/v1/message-templates/reminder/es').set(auth(token)).send({ body: 'x', active: false }).expect(200);
    });

    it('programador: recordatorio el día antes del vencimiento a la hora configurada, sin duplicados, y aviso de cuota vencida', async () => {
      const [y, m, d] = dueDate.split('-').map(Number) as [number, number, number];
      const dayBefore = new Date(Date.UTC(y, m - 1, d - 1, 11, 0)).toISOString(); // 06:00 en Bogotá
      t.clock.set(dayBefore);
      const n = await svc.scheduleCollections(tenantId);
      expect(n).toBe(1);
      expect(await svc.scheduleCollections(tenantId)).toBe(0);
      const reminders = await list(token, { clientId, event: 'reminder', status: 'scheduled' });
      expect(reminders).toHaveLength(1);
      // Pedido a las 8:00 del día anterior en la hora del deudor; si ese día no tiene franja (domingo), el motor lo corre.
      expect(reminders[0]!.requestedAt).toBe(new Date(Date.UTC(y, m - 1, d - 1, 13, 0)).toISOString());
      expect(new Date(reminders[0]!.scheduledAt).getTime()).toBeGreaterThanOrEqual(new Date(reminders[0]!.requestedAt).getTime());
      await t.http().post(`/v1/messages/${reminders[0]!.id}/cancel`).set(auth(token)).expect(200);
      t.clock.set(new Date(Date.UTC(y, m - 1, d + 1, 11, 0)).toISOString());
      await svc.scheduleCollections(tenantId);
      const overdue = await list(token, { clientId, event: 'overdue' });
      expect(overdue.some((x) => x.status === 'scheduled')).toBe(true);
    });

    it('exclusión: «SALIR» por WhatsApp revoca el consentimiento y bloquea lo pendiente; el enlace del correo da de baja con un clic', async () => {
      t.clock.set('2026-10-15T15:00:00Z');
      await t.http().put('/v1/company/whatsapp').set(auth(token)).send({ phoneNumberId: '5730900001', accessToken: WA_TOKEN }).expect(200);
      const pending = await t.http().post('/v1/messages').set(auth(token)).send({ loanId, event: 'manual', channel: 'whatsapp', body: 'Hola {{nombre}}, te escribimos por tu préstamo {{contrato}}.' }).expect(201);
      expect(pending.body.status).toBe('scheduled');
      await webhook({ entry: [{ id: 'waba-a', changes: [{ field: 'messages', value: { metadata: { phone_number_id: '5730900001' }, messages: [{ from: '573157778810', id: 'wamid.in.1', type: 'text', text: { body: 'Salir' } }] } }] }] });
      const after = await list(token, { clientId, status: 'blocked' });
      expect(after.find((m) => m.id === pending.body.id)!.decision.reasons.at(-1)).toEqual({ code: 'OPTED_OUT', detail: 'whatsapp' });
      const again = await t.http().post('/v1/messages').set(auth(token)).send({ loanId, event: 'manual', channel: 'whatsapp' }).expect(201);
      expect(again.body.decision.reasons).toEqual([{ code: 'OPTED_OUT', detail: 'whatsapp' }]);
      const client = (await t.http().get(`/v1/clients/${clientId}`).set(auth(token)).expect(200)).body;
      expect(client.consents.map((c: { channel: string }) => c.channel).sort()).toEqual(['email', 'personal_data']);
      // Baja del correo con un clic (RFC 8058) desde el enlace del mensaje.
      const link = (await t.http().get(`/v1/loans/${loanId}/upload-link`).set(auth(token)).expect(200)).body.url as string;
      const portalToken = link.split('/').pop()!;
      const out = await t.http().post(`/v1/public/upload/${portalToken}/opt-out`).query({ channel: 'email' }).set('Content-Type', 'application/x-www-form-urlencoded').send('List-Unsubscribe=One-Click').expect(200);
      expectContract('debtorOptOut', 200, out.body);
      const c2 = (await t.http().get(`/v1/clients/${clientId}`).set(auth(token)).expect(200)).body;
      expect(c2.consents.map((c: { channel: string }) => c.channel)).toEqual(['personal_data']);
      // El portal ofrece la baja al deudor.
      const page = await t.http().get(`/v1/public/upload/${portalToken}`).set('Accept', 'text/html').expect(200);
      expect(page.text).toContain('No quiero recibir más mensajes');
    });

    it('rebote duro: la dirección se marca inválida en la ficha y el correo siguiente queda bloqueado', async () => {
      const r = await t.http().post('/v1/clients').set(auth(token)).send({ client: person(1, { email: 'no-existe@example.com' }), loan: TERMS }).expect(201);
      await dispatch();
      const [email] = await list(token, { clientId: r.body.client.id, channel: 'email' });
      expect(email!.status).toBe('sent');
      const providerId = mail.sent.find((m) => m.to === 'no-existe@example.com')!.providerId;
      await t.http().post('/v1/webhooks/email/events').query({ token: 'otro' }).set('Content-Type', 'application/json').send(JSON.stringify({ RecordType: 'Bounce', MessageID: providerId })).expect(401);
      const ev = await t.http().post('/v1/webhooks/email/events').query({ token: EVENTS_SECRET }).set('Content-Type', 'application/json')
        .send(JSON.stringify({ RecordType: 'Bounce', Type: 'HardBounce', TypeCode: 1, MessageID: providerId, Email: 'no-existe@example.com', Inactive: true })).expect(200);
      expect(ev.body).toEqual({ matched: 1 });
      const c = (await t.http().get(`/v1/clients/${r.body.client.id}`).set(auth(token)).expect(200)).body;
      expectContract('getClient', 200, c);
      expect(c.emailStatus).toBe('bounced');
      expect((await list(token, { clientId: r.body.client.id, channel: 'email' }))[0]!.status).toBe('failed');
      const next = await t.http().post('/v1/messages').set(auth(token)).send({ loanId: r.body.loan.id, event: 'statement', channel: 'email' }).expect(201);
      expect(next.body.decision.reasons).toEqual([{ code: 'ADDRESS_INVALID', detail: 'bounced' }]);
    });

    it('reglas por empresa: un preset sin revisión legal no rige, y la excepción del deudor exige evidencia posterior al contrato', async () => {
      const g = await t.http().get('/v1/compliance/contact-rules').set(auth(token)).expect(200);
      expectContract('getContactRules', 200, g.body);
      expect(g.body.effective.id).toBe('CO_LEY_2300_2023');
      const br = await t.http().put('/v1/compliance/contact-rules').set(auth(token)).send({ preset: 'BR_CDC_TEMPLATE', reminderTime: '09:30' }).expect(200);
      expect(br.body).toMatchObject({ preset: 'BR_CDC_TEMPLATE', effective: { id: 'CO_LEY_2300_2023' }, counselReviewedAt: null, reminderTime: '09:30' });
      const reviewed = await t.http().put('/v1/compliance/contact-rules').set(auth(token)).send({ counselReviewed: true }).expect(200);
      expect(reviewed.body.effective.id).toBe('BR_CDC_TEMPLATE');
      await t.http().put('/v1/compliance/contact-rules').set(auth(token)).send({ preset: 'CO_LEY_2300_2023' }).expect(200);
      // Sin evidencia válida (el plan de pagos es el contrato) se rechaza.
      const plan = (await t.http().get('/v1/documents').set(auth(token)).query({ clientId, kind: 'schedule' }).expect(200)).body.items[0];
      await t.http().put(`/v1/clients/${clientId}/contact-exception`).set(auth(token)).send({ windows: [{ day: 7, start: '10:00', end: '12:00' }], documentId: plan.id }).expect(422);
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
      const doc = await t.http().post(`/v1/clients/${clientId}/documents`).query({ name: 'Autorización de horario' }).set(auth(token)).set('Content-Type', 'application/octet-stream').send(png).expect(201);
      const ex = await t.http().put(`/v1/clients/${clientId}/contact-exception`).set(auth(token)).send({ windows: [{ day: 7, start: '10:00', end: '12:00' }], documentId: doc.body.id }).expect(200);
      expectContract('setContactException', 200, ex.body);
      const sim = await t.http().post('/v1/compliance/contact-evaluation').set(auth(token)).send({ clientId, kind: 'collection', channel: 'whatsapp', requestedAt: '2026-10-18T15:30:00Z' }).expect(200);
      expect(sim.body).toMatchObject({ decision: 'send', localAt: '2026-10-18T10:30', reasons: [{ code: 'DEBTOR_EXCEPTION' }] });
      await t.http().delete(`/v1/clients/${clientId}/contact-exception`).set(auth(token)).expect(204);
    });

    it('remitente propio: el asistente verifica SPF, DKIM y DMARC en el DNS del dominio', async () => {
      const dns = t.app.get(DnsResolver);
      const records: Record<string, string[]> = {
        'prestamos.example.co': ['v=spf1 include:_spf.google.com ~all'],
        'pm20260923._domainkey.prestamos.example.co': [`k=rsa; p=${'A'.repeat(80)}`],
      };
      dns.txt = async (host) => records[host] ?? [];
      const s = await t.http().put('/v1/company/email-sender').set(auth(token)).send({ fromEmail: 'cobros@prestamos.example.co', fromName: 'Cobros', dkimSelector: 'pm20260923' }).expect(200);
      expectContract('saveEmailSender', 200, s.body);
      const v1 = await t.http().post('/v1/company/email-sender/verify').set(auth(token)).expect(200);
      expectContract('verifyEmailSender', 200, v1.body);
      expect(v1.body).toMatchObject({ spf: true, dkim: true, dmarc: false, verifiedAt: null });
      records['_dmarc.prestamos.example.co'] = ['v=DMARC1; p=quarantine'];
      const v2 = await t.http().post('/v1/company/email-sender/verify').set(auth(token)).expect(200);
      expect(v2.body.verifiedAt).not.toBeNull();
      await t.http().delete('/v1/company/email-sender').set(auth(token)).expect(204);
    });
  });

  describe('CA-20: suspensión de la cuenta de WhatsApp Cloud API', () => {
    let token: string;
    const created: string[] = [];
    const newClient = async (i: number) => {
      const r = await t.http().post('/v1/clients').set(auth(token)).send({ client: person(10 + i), loan: TERMS }).expect(201);
      created.push(r.body.client.id);
      return r.body;
    };
    const ofClient = async (clientId: string) => (await list(token, { clientId, channel: 'whatsapp' }))[0]!;

    beforeAll(async () => {
      t.clock.set('2026-10-09T15:00:00Z');
      const tenant = await newTenant();
      token = (await ownerSession(t, tenant.slug)).token;
      await registerRateCap(t.http, token);
      await t.http().put('/v1/company/whatsapp').set(auth(token)).send({ phoneNumberId: '5730900002', accessToken: WA_TOKEN, wabaId: '1029384756' }).expect(200);
      // Plantilla aprobada por Meta para escribir fuera de la ventana de 24 horas.
      await t.http().put('/v1/message-templates/welcome/es').set(auth(token)).send({ body: 'Hola {{nombre}}, bienvenida a {{empresa}}. Tu préstamo {{contrato}}: primera cuota {{valor_cuota}} el {{fecha_vencimiento}}. {{enlace_carga}}', metaTemplateName: 'coroc_bienvenida', metaTemplateLang: 'es' }).expect(200);
    }, 120_000);

    it('activar la Cloud API exige la lista de verificación completa y al Propietario', async () => {
      const bad = await t.http().put('/v1/company/whatsapp/mode').set(auth(token)).send({ mode: 'cloud_api', checklist: { businessVerified: true, dedicatedNumber: true } }).expect(422);
      expect(bad.body.code).toBe('WHATSAPP_CHECKLIST_INCOMPLETE');
      const ok = await t.http().put('/v1/company/whatsapp/mode').set(auth(token))
        .send({ mode: 'cloud_api', checklist: { businessVerified: true, dedicatedNumber: true, templatesApproved: true, legalReview: true, policyAccepted: true } }).expect(200);
      expectContract('setWhatsAppMode', 200, ok.body);
      expect(ok.body).toMatchObject({ mode: 'cloud_api', status: 'active', checklist: { policyAccepted: true } });
    });

    it('con la cuenta activa, el mensaje sale por la Cloud API con la plantilla aprobada y registra entregado y leído', async () => {
      graphMode = 'ok';
      const c = await newClient(0);
      await dispatch();
      const m = await ofClient(c.client.id);
      expect(m).toMatchObject({ status: 'sent', via: 'cloud_api' });
      const call = graphCalls.at(-1)!;
      expect(call.phoneId).toBe('5730900002');
      expect(call.body).toMatchObject({ messaging_product: 'whatsapp', to: '573157778820', type: 'template', template: { name: 'coroc_bienvenida', language: { code: 'es' } } });
      expect(call.body.template.components[0].parameters).toHaveLength(6);
      expect(call.body.template.components[0].parameters[0]).toEqual({ type: 'text', text: 'María José' });
      const wamid = `wamid.${seq}`;
      const ts = Math.floor(new Date('2026-10-09T15:01:00Z').getTime() / 1000);
      await webhook({ entry: [{ id: '1029384756', changes: [{ field: 'messages', value: { metadata: { phone_number_id: '5730900002' }, statuses: [{ id: wamid, status: 'delivered', timestamp: String(ts) }, { id: wamid, status: 'read', timestamp: String(ts + 60) }] } }] }] });
      expect(await ofClient(c.client.id)).toMatchObject({ status: 'read', deliveredAt: '2026-10-09T15:01:00.000Z', readAt: '2026-10-09T15:02:00.000Z' });
    });

    it('Meta bloquea la cuenta al enviar (131031): paso automático al modo asistido sin perder mensajes y aviso al propietario', async () => {
      graphMode = 'suspend';
      const a = await newClient(1);
      const b = await newClient(2);
      const calls = graphCalls.length;
      const notices = mail.sent.length;
      await dispatch();
      // Solo el primer intento llega a Meta; el resto ya sale por el modo asistido.
      expect(graphCalls.length).toBe(calls + 1);
      for (const c of [a, b]) {
        const m = await ofClient(c.client.id);
        expect(m).toMatchObject({ status: 'ready', via: 'assisted' });
        expect(m.assisted.whatsappUrl).toMatch(/^https:\/\/wa\.me\/57315777882[12]\?text=/);
      }
      const acc = await t.http().get('/v1/company/whatsapp').set(auth(token)).expect(200);
      expectContract('getWhatsAppAccount', 200, acc.body);
      expect(acc.body).toMatchObject({ status: 'suspended', mode: 'assisted', suspensionReason: 'code 131031' });
      const company = await t.http().get('/v1/company').set(auth(token)).expect(200);
      expect(company.body.settings.whatsappMode).toBe('assisted');
      const notice = mail.sent.slice(notices).find((m) => m.to === 'ana@example.com')!;
      expect(notice.subject).toBe('COROC · WhatsApp pasó al modo asistido');
      expect(notice.text).toContain('ningún mensaje se perdió');
    });

    it('aviso de Meta por webhook (account_update): los mensajes en cola pasan al modo asistido', async () => {
      graphMode = 'ok';
      await t.http().put('/v1/company/whatsapp/mode').set(auth(token))
        .send({ mode: 'cloud_api', checklist: { businessVerified: true, dedicatedNumber: true, templatesApproved: true, legalReview: true, policyAccepted: true } }).expect(200);
      const c = await newClient(3);
      await idle();
      const calls = graphCalls.length;
      await webhook({ entry: [{ id: '1029384756', time: 1760022000, changes: [{ field: 'account_update', value: { phone_number: '573009000002', event: 'DISABLED_UPDATE', ban_info: { waba_ban_state: ['DISABLE'], waba_ban_date: '2026-10-09' } } }] }] });
      expect((await t.http().get('/v1/company/whatsapp').set(auth(token)).expect(200)).body).toMatchObject({ status: 'suspended', mode: 'assisted', suspensionReason: 'DISABLED_UPDATE' });
      await dispatch();
      expect(graphCalls.length).toBe(calls);
      expect(await ofClient(c.client.id)).toMatchObject({ status: 'ready', via: 'assisted' });
      const lost = (await list(token, { status: 'failed,cancelled' })).filter((m) => created.includes(m.clientId));
      expect(lost).toEqual([]);
    });
  });
});
