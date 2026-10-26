// Fase 10 · COROC Escritorio (ADR-062, ADR-063): una instalación nueva en el PC, sin nube. Se prueba con una base vacía
// propia (como la de un PC recién instalado): la clave de la ejecución, el asistente de primer uso, el ingreso sin
// segundo factor obligatorio, los mensajes sin enlaces y la restauración en otro PC de una copia hecha en la nube (E-7).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrate.js';
import { AutoBackups } from '../src/desktop/auto-backup.js';
import { DocumentTasks } from '../src/documents/tasks.js';
import { MessagingService } from '../src/messaging/messaging.service.js';
import { receiptHtml } from '../src/pdf/templates.js';
import { auth, bootApp, expectContract, newTenant, ownerSession } from './helpers.js';

type T = Awaited<ReturnType<typeof bootApp>>;
const TOKEN = crypto.randomBytes(32).toString('base64url');
const KEY = { 'X-Coroc-Desktop': TOKEN };
const OWNER_PASSWORD = 'Escritorio-Seguro-2026';
const BACKUP_PASSWORD = 'Copia-Del-Otro-PC-2026';
const binary = (res: any, cb: (e: Error | null, b: Buffer) => void) => {
  const parts: Buffer[] = [];
  res.on('data', (c: Buffer) => parts.push(c));
  res.on('end', () => cb(null, Buffer.concat(parts)));
};

/** Base vacía nueva, con las migraciones aplicadas, como la que crea el supervisor en un PC recién instalado. */
async function emptyInstallation(): Promise<string> {
  const base = new URL(process.env.TEST_DATABASE_URL!);
  const name = `coroc_escritorio_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const admin = new pg.Client({ connectionString: base.toString() });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const adminUrl = new URL(base.toString());
  adminUrl.pathname = `/${name}`;
  await migrate(adminUrl.toString());
  const app = new URL(process.env.DATABASE_URL!);
  app.pathname = `/${name}`;
  return app.toString();
}

async function bootDesktop(databaseUrl: string, clock = '2026-10-21T15:00:00Z'): Promise<T> {
  Object.assign(process.env, { COROC_MODE: 'desktop', COROC_DESKTOP_TOKEN: TOKEN, DATABASE_URL: databaseUrl });
  try {
    return await bootApp(clock);
  } finally {
    // Las pruebas en la nube del mismo archivo vuelven a la configuración normal.
    process.env.COROC_MODE = 'cloud';
  }
}

describe('COROC Escritorio (Fase 10)', () => {
  const cloudUrl = process.env.DATABASE_URL!;
  let cloud: T;
  let desktop: T;
  let copy: Buffer;
  let copyCompany: string;

  beforeAll(async () => {
    // Una empresa en la nube con un cliente, un préstamo y un pago, y su copia `.coroc` (la que se lleva al PC nuevo).
    cloud = await bootApp('2026-10-20T15:00:00Z');
    const tn = await newTenant({ country: 'BR', lang: 'pt-BR' });
    copyCompany = `Empresa ${tn.slug}`;
    const s = await ownerSession(cloud, tn.slug);
    const c = (await cloud.http().post('/v1/clients').set(auth(s.token)).send({
      client: { firstName: 'Joana', lastName: 'Silva', phone: '+55 11 98888 7777', lang: 'pt-BR' },
      loan: { principal: 100_000, currency: 'BRL', method: 'simple', rate: '0.05', installments: 4, frequency: 'monthly', disbursementDate: '2026-10-01' },
    }).expect(201)).body;
    await cloud.http().post(`/v1/loans/${c.loan.id}/payments`).set(auth(s.token)).send({ amount: 26_250, date: '2026-10-15' }).expect(201);
    await cloud.app.get(DocumentTasks).idle();
    const b = (await cloud.http().post('/v1/backups').set(auth(s.token)).send({ password: BACKUP_PASSWORD }).expect(202)).body;
    await cloud.app.get(DocumentTasks).idle();
    const link = (await cloud.http().post(`/v1/backups/${b.id}/link`).set(auth(s.token)).expect(200)).body;
    copy = (await cloud.http().get(`/v1${link.path}`).buffer(true).parse(binary).expect(200)).body;
  });

  afterAll(async () => {
    await desktop?.app.close();
    await cloud?.app.close();
    process.env.DATABASE_URL = cloudUrl;
    delete process.env.COROC_MODE;
    delete process.env.COROC_DESKTOP_TOKEN;
  });

  it('en la nube las rutas de Escritorio no existen', async () => {
    const r = await cloud.http().get('/v1/desktop/status').expect(404);
    expect(r.body.code).toBe('NOT_FOUND');
  });

  it('sin la clave de la ejecución no responde nada (otra cuenta de Windows o una página web), salvo la salud', async () => {
    desktop = await bootDesktop(await emptyInstallation());
    expect((await desktop.http().get('/v1/desktop/status').expect(403)).body.code).toBe('DESKTOP_ONLY');
    await desktop.http().get('/v1/desktop/status').set('X-Coroc-Desktop', 'otra-clave-cualquiera-de-32-caracteres-o-mas').expect(403);
    await desktop.http().post('/v1/auth/login').send({ tenant: 'x', username: 'x', password: 'x', deviceId: 'dispositivo' }).expect(403);
    await desktop.http().options('/v1/desktop/setup').set('Origin', 'https://pagina-maliciosa.example').expect(403);
    await desktop.http().get('/health').expect(200);
    const st = (await desktop.http().get('/v1/desktop/status').set(KEY).expect(200)).body;
    expectContract('desktopStatus', 200, st);
    expect(st).toEqual({ configured: false, company: null, restore: null });
  });

  it('E-7: restaura en el PC nuevo la copia de otra empresa; se ingresa con el usuario y la contraseña de siempre', async () => {
    const up = (await desktop.http().post('/v1/desktop/restore').set(KEY).set('Content-Type', 'application/octet-stream').send(copy).expect(201)).body;
    expectContract('desktopRestoreUpload', 201, up);
    expect(up).toMatchObject({ status: 'uploaded', company: copyCompany });
    const pending = (await desktop.http().get('/v1/desktop/status').set(KEY).expect(200)).body;
    expect(pending).toMatchObject({ configured: false, restore: { id: up.id, company: copyCompany } });
    // Mientras tanto nadie puede ingresar a la empresa provisional.
    const wrong = await desktop.http().post(`/v1/desktop/restore/${up.id}/apply`).set(KEY).send({ password: 'no-es-la-clave' }).expect(422);
    expect(wrong.body.code).toBe('BACKUP_PASSWORD_OR_DAMAGED');
    const done = (await desktop.http().post(`/v1/desktop/restore/${up.id}/apply`).set(KEY).send({ password: BACKUP_PASSWORD }).expect(200)).body;
    expectContract('desktopRestoreApply', 200, done);
    expect(done.company).toMatchObject({ name: copyCompany, country: 'BR', lang: 'pt-BR' });
    expect(done.owners).toEqual(['propietario']);
    const st = (await desktop.http().get('/v1/desktop/status').set(KEY).expect(200)).body;
    expect(st).toMatchObject({ configured: true, company: { slug: done.company.slug, name: copyCompany } });
    // La copia no trae el segundo factor: en Escritorio es opcional (ADR-063) y se ingresa directo.
    const login = (await desktop.http().post('/v1/auth/login').set(KEY).send({ tenant: done.company.slug, username: 'propietario', password: 'Cobranza-Segura-2026', deviceId: 'pc-escritorio-1' }).expect(200)).body;
    expect(login.mfaEnrollmentRequired).toBe(false);
    expect(login.company).toMatchObject({ currency: 'BRL', country: 'BR' });
    const clients = (await desktop.http().get('/v1/clients').set(KEY).set(auth(login.accessToken)).expect(200)).body;
    expect(clients.items.map((x: any) => x.fullName)).toEqual(['Joana Silva']);
    // Ya hay empresa: ni otra restauración ni el asistente.
    await desktop.http().post('/v1/desktop/restore').set(KEY).set('Content-Type', 'application/octet-stream').send(copy).expect(409);
    const again = await desktop.http().post('/v1/desktop/setup').set(KEY).send({ company: { name: 'Otra', country: 'CO' }, owner: { name: 'Ana', username: 'ana', password: OWNER_PASSWORD }, deviceId: 'pc-escritorio-1' }).expect(409);
    expect(again.body.code).toBe('DESKTOP_ALREADY_SET_UP');
  });

  it('«¿Olvidó su contraseña?»: tras Windows Hello se crea una nueva y se cierran las sesiones', async () => {
    const st = (await desktop.http().get('/v1/desktop/status').set(KEY).expect(200)).body;
    const old = (await desktop.http().post('/v1/auth/login').set(KEY).send({ tenant: st.company.slug, username: 'propietario', password: 'Cobranza-Segura-2026', deviceId: 'pc-escritorio-2' }).expect(200)).body;
    await desktop.http().post('/v1/desktop/password').set(KEY).send({ username: 'propietario', password: 'corta' }).expect(422);
    expect((await desktop.http().post('/v1/desktop/password').set(KEY).send({ username: 'nadie', password: OWNER_PASSWORD }).expect(404)).body.code).toBe('DESKTOP_USER_NOT_FOUND');
    await desktop.http().post('/v1/desktop/password').set(KEY).send({ username: 'propietario', password: OWNER_PASSWORD }).expect(204);
    await desktop.http().get('/v1/me').set(KEY).set(auth(old.accessToken)).expect(401);
    await desktop.http().post('/v1/auth/login').set(KEY).send({ tenant: st.company.slug, username: 'propietario', password: 'Cobranza-Segura-2026', deviceId: 'pc-escritorio-2' }).expect(401);
    await desktop.http().post('/v1/auth/login').set(KEY).send({ tenant: st.company.slug, username: 'propietario', password: OWNER_PASSWORD, deviceId: 'pc-escritorio-2' }).expect(200);
  });

  it('asistente de primer uso: crea la empresa y su Propietario con sesión, sin segundo factor obligatorio', async () => {
    await desktop.app.close();
    desktop = await bootDesktop(await emptyInstallation());
    const weak = await desktop.http().post('/v1/desktop/setup').set(KEY).send({ company: { name: 'Inversiones Andrés', country: 'CO' }, owner: { name: 'Andrés', username: 'andres', password: 'andres123456' }, deviceId: 'pc-escritorio-1' }).expect(422);
    expect(weak.body.code).toBe('WEAK_PASSWORD');
    const s = (await desktop.http().post('/v1/desktop/setup').set(KEY).send({
      company: { name: 'Inversiones Andrés S.A.S.', country: 'CO' }, owner: { name: 'Andrés Botero', username: 'andres', password: OWNER_PASSWORD, email: 'andres@example.com' }, deviceId: 'pc-escritorio-1', deviceName: 'PC de la oficina',
    }).expect(201)).body;
    expectContract('desktopSetup', 201, s);
    expect(s.mfaEnrollmentRequired).toBe(false);
    expect(s.user).toMatchObject({ username: 'andres', role: 'owner' });
    expect(s.company).toMatchObject({ slug: 'inversiones-andres-s-a-s', name: 'Inversiones Andrés S.A.S.', currency: 'COP', timezone: 'America/Bogota', lang: 'es' });
    // La sesión sirve de inmediato para el resto del asistente (tasas, Gmail, WhatsApp).
    await desktop.http().put('/v1/compliance/rate-cap-policy').set(KEY).set(auth(s.accessToken)).send({ policy: 'warn', acceptResponsibility: true }).expect(200);
    const st = (await desktop.http().get('/v1/desktop/status').set(KEY).expect(200)).body;
    expect(st).toEqual({ configured: true, company: { slug: 'inversiones-andres-s-a-s', name: 'Inversiones Andrés S.A.S.', country: 'CO', lang: 'es' }, restore: null });
  });

  it('los mensajes no llevan enlaces (el PC no está en internet) y WhatsApp para Windows abre el chat con el texto listo', async () => {
    const st = (await desktop.http().get('/v1/desktop/status').set(KEY).expect(200)).body;
    const s = (await desktop.http().post('/v1/auth/login').set(KEY).send({ tenant: st.company.slug, username: 'andres', password: OWNER_PASSWORD, deviceId: 'pc-escritorio-1' }).expect(200)).body;
    const c = (await desktop.http().post('/v1/clients').set(KEY).set(auth(s.accessToken)).send({
      client: { firstName: 'Lucía', lastName: 'Ríos', phone: '+57 300 123 4567', lang: 'es', consents: [{ channel: 'whatsapp', method: 'Firma en el contrato' }] },
      // Sin tope de usura registrado: la política «solo advertir» del asistente (ADR-061) permite crearlo confirmándolo.
      loan: { principal: 500_000, currency: 'COP', method: 'simple', rate: '0.10', installments: 5, frequency: 'weekly', disbursementDate: '2026-10-21', acknowledgeRateCap: true },
    }).expect(201)).body;
    // La bienvenida espera el PDF del plan de pagos; después queda lista para «Mensajes de hoy».
    await desktop.app.get(DocumentTasks).idle();
    await desktop.app.get(MessagingService).dispatchDue();
    const list = (await desktop.http().get('/v1/messages').set(KEY).set(auth(s.accessToken)).query({ clientId: c.client.id }).expect(200)).body;
    const welcome = list.items.find((m: any) => m.event === 'welcome' && m.channel === 'whatsapp');
    expect(welcome).toBeTruthy();
    expect(welcome.body).toContain('envíanos el comprobante por este mismo chat o correo');
    expect(welcome.body).not.toMatch(/https?:\/\//);
    expect(welcome.status).toBe('ready');
    expect(welcome.assisted.whatsappAppUrl).toMatch(/^whatsapp:\/\/send\?phone=573001234567&text=Hola%20Luc/);
    expect(welcome.assisted.whatsappUrl).toMatch(/^https:\/\/wa\.me\/573001234567\?text=/);
    const tpl = (await desktop.http().get('/v1/message-templates').set(KEY).set(auth(s.accessToken)).expect(200)).body;
    expect(tpl.templates.find((x: any) => x.event === 'receipt' && x.lang === 'es').body).toContain('Te enviamos el recibo junto con este mensaje');
  });


  it('E-7: la copia automática diaria queda cifrada en la carpeta elegida (solo las últimas) y se restaura en otro PC', async () => {
    const st = (await desktop.http().get('/v1/desktop/status').set(KEY).expect(200)).body;
    const s = (await desktop.http().post('/v1/auth/login').set(KEY).send({ tenant: st.company.slug, username: 'andres', password: OWNER_PASSWORD, deviceId: 'pc-escritorio-1' }).expect(200)).body;
    const tenantId = s.company.id as string;
    const before = (await desktop.http().get('/v1/company/auto-backup').set(KEY).set(auth(s.accessToken)).expect(200)).body;
    expectContract('getAutoBackup', 200, before);
    // Nunca se ha hecho una copia: la app avisa.
    expect(before).toMatchObject({ configured: false, overdue: true, lastBackupAt: null });
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'coroc-onedrive-'));
    fs.writeFileSync(path.join(folder, 'notas-personales.txt'), 'no se toca');
    const bad = await desktop.http().put('/v1/company/auto-backup').set(KEY).set(auth(s.accessToken)).send({ folder: path.join(folder, 'no-existe'), password: BACKUP_PASSWORD }).expect(422);
    expect(bad.body.code).toBe('AUTO_BACKUP_FOLDER_INVALID');
    await desktop.http().put('/v1/company/auto-backup').set(KEY).set(auth(s.accessToken)).send({ folder }).expect(422);
    const saved = (await desktop.http().put('/v1/company/auto-backup').set(KEY).set(auth(s.accessToken)).send({ folder, password: BACKUP_PASSWORD, keep: 2 }).expect(200)).body;
    expectContract('saveAutoBackup', 200, saved);
    expect(saved).toMatchObject({ configured: true, enabled: true, folder, keep: 2 });
    const auto = desktop.app.get(AutoBackups);
    for (const at of ['2026-10-21T15:00:00Z', '2026-10-22T15:00:00Z', '2026-10-23T15:00:00Z']) {
      desktop.clock.set(at);
      await auto.start(tenantId);
    }
    const files = fs.readdirSync(folder).sort();
    expect(files).toEqual(['COROC_Respaldo_Inversiones_Andres_S_A_S_2026-10-22_1000.coroc', 'COROC_Respaldo_Inversiones_Andres_S_A_S_2026-10-23_1000.coroc', 'notas-personales.txt']);
    // Pasaron días: se vuelve a ingresar.
    s.accessToken = (await desktop.http().post('/v1/auth/login').set(KEY).send({ tenant: st.company.slug, username: 'andres', password: OWNER_PASSWORD, deviceId: 'pc-escritorio-1' }).expect(200)).body.accessToken;
    const now = (await desktop.http().get('/v1/company/auto-backup').set(KEY).set(auth(s.accessToken)).expect(200)).body;
    expect(now).toMatchObject({ overdue: false, lastError: null, lastFile: files[1], lastSuccessAt: '2026-10-23T15:00:00.000Z' });
    // En el PC queda solo la última copia automática; las anteriores están en la carpeta.
    const list = (await desktop.http().get('/v1/backups').set(KEY).set(auth(s.accessToken)).expect(200)).body;
    expect(list.map((b: any) => [b.auto, b.downloadable])).toEqual([[true, true], [true, false], [true, false]]);
    expect((await desktop.http().post(`/v1/backups/${list[1].id}/link`).set(KEY).set(auth(s.accessToken)).expect(410)).body.code).toBe('BACKUP_IN_FOLDER');
    const fromFolder = fs.readFileSync(path.join(folder, files[1]!));
    // La USB se desconectó: la copia del día no se pierde de vista, la app muestra qué pasó.
    fs.rmSync(folder, { recursive: true, force: true });
    desktop.clock.set('2026-10-24T15:00:00Z');
    await auto.start(tenantId);
    s.accessToken = (await desktop.http().post('/v1/auth/login').set(KEY).send({ tenant: st.company.slug, username: 'andres', password: OWNER_PASSWORD, deviceId: 'pc-escritorio-1' }).expect(200)).body.accessToken;
    expect((await desktop.http().get('/v1/company/auto-backup').set(KEY).set(auth(s.accessToken)).expect(200)).body.lastError).toBe('AUTO_BACKUP_FOLDER_UNAVAILABLE');
    expect((await desktop.http().post('/v1/company/auto-backup/run').set(KEY).set(auth(s.accessToken)).expect(202)).body.configured).toBe(true);
    await auto.start(tenantId);

    // Otro PC: instalación nueva; la copia de la carpeta se restaura desde el asistente de primer uso.
    await desktop.app.close();
    desktop = await bootDesktop(await emptyInstallation(), '2026-10-24T16:00:00Z');
    const up = (await desktop.http().post('/v1/desktop/restore').set(KEY).set('Content-Type', 'application/octet-stream').send(fromFolder).expect(201)).body;
    expect(up.company).toBe('Inversiones Andrés S.A.S.');
    const done = (await desktop.http().post(`/v1/desktop/restore/${up.id}/apply`).set(KEY).send({ password: BACKUP_PASSWORD }).expect(200)).body;
    expect(done).toMatchObject({ company: { name: 'Inversiones Andrés S.A.S.', country: 'CO' }, owners: ['andres'] });
    const again = (await desktop.http().post('/v1/auth/login').set(KEY).send({ tenant: done.company.slug, username: 'andres', password: OWNER_PASSWORD, deviceId: 'pc-nuevo-1' }).expect(200)).body;
    const clients = (await desktop.http().get('/v1/clients').set(KEY).set(auth(again.accessToken)).expect(200)).body;
    expect(clients.items.map((x: any) => x.fullName)).toEqual(['Lucía Ríos']);
  });

  it('el recibo del PC lleva el código de verificación sin QR (no hay dirección pública)', async () => {
    const html = await receiptHtml(
      {
        lang: 'es', number: 'RC-000001', issuedAt: '2026-10-21T10:00', company: { name: 'Inversiones Andrés S.A.S.' }, client: { fullName: 'Lucía Ríos', code: 'C-000001' }, contract: 'CT-000001',
        currency: 'COP', payment: { date: '2026-10-21', amount: 110_000 }, totalInstallments: 5, coverage: 'Cuota 1', remainingInstallments: 4, accumulatedPaid: 110_000, previousBalance: 550_000, newBalance: 440_000,
        verificationCode: 'ABCDEF0123456789',
      } as any,
      { name: 'Inversiones Andrés S.A.S.' } as any,
    );
    expect(html).toContain('Código de verificación');
    expect(html).toContain('ABCDEF0123456789');
    expect(html).not.toContain('<svg');
  });
});
