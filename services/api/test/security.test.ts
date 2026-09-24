// Fase 5 · Seguridad (§20, OWASP ASVS nivel 2): pruebas de penetración automatizadas sobre el contrato completo.
// Recorre las 103 operaciones del contrato OpenAPI y verifica, para cada una, que exige sesión, que respeta la matriz de
// roles (§7.2) y que un usuario de otra empresa no alcanza los recursos ajenos aunque conozca sus identificadores.
// Además: tokens manipulados, encabezados de seguridad, inyección, cuerpos enormes, CORS y límites de intentos.
import crypto from 'node:crypto';
import { ModulesContainer } from '@nestjs/core';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_PERMISSIONS, type Permission, type Role } from '../src/auth/permissions.js';
import { OPERATION, PERMISSION, PUBLIC } from '../src/common/decorators.js';
import { contract } from '../src/common/openapi.js';
import { DocumentTasks } from '../src/documents/tasks.js';
import { auth, bootApp, newTenant, ownerSession, PASSWORD } from './helpers.js';

type T = Awaited<ReturnType<typeof bootApp>>;
type Route = { op: string; method: string; path: string; permission: Permission | null; public: boolean };

const ORIGIN = 'https://app.coroc.test';
const LOAN = { principal: 1_000_000, currency: 'COP', method: 'simple', rate: '0.20', installments: 20, frequency: 'daily', disbursementDate: '2026-10-08' };
const client = (i: number) => ({ firstName: `Cliente ${i}`, lastName: 'Seguridad Prueba', phone: `+57310555${String(i).padStart(4, '0')}`, lang: 'es', idDocType: 'CC', idDocNumber: `55500${String(i).padStart(5, '0')}` });

/** Operaciones de autoservicio: cualquier usuario con sesión las usa sobre sí mismo, sin permiso de la matriz. */
const SELF_SERVICE = new Set(['logout', 'me', 'updateMe', 'changePassword', 'enrollMfa', 'confirmMfa', 'disableMfa', 'mySessions', 'revokeMySession', 'deleteMyAccount']);

/** Rutas de la aplicación con su operación del contrato, su permiso y si son públicas (metadatos de los controladores). */
function routes(t: T): Route[] {
  const meta = new Map<string, { permission: Permission | null; public: boolean }>();
  for (const mod of t.app.get(ModulesContainer).values()) {
    for (const ctrl of mod.controllers.values()) {
      const type = ctrl.metatype;
      const proto = type?.prototype;
      if (!type || !proto) continue;
      const classPublic = Reflect.getMetadata(PUBLIC, type) === true;
      const classPerm = Reflect.getMetadata(PERMISSION, type) ?? null;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const fn = proto[name];
        const op = typeof fn === 'function' ? Reflect.getMetadata(OPERATION, fn) : undefined;
        if (op) meta.set(op, { permission: Reflect.getMetadata(PERMISSION, fn) ?? classPerm, public: Reflect.getMetadata(PUBLIC, fn) === true || classPublic });
      }
    }
  }
  return [...contract().ops.entries()].map(([op, v]) => {
    const m = meta.get(op);
    if (!m) throw new Error(`La operación ${op} del contrato no tiene controlador`);
    return { op, method: v.method, path: v.path, ...m };
  });
}

describe('Seguridad (§20, ASVS L2): pruebas de penetración automatizadas', () => {
  let t: T;
  let all: Route[];
  let ownerA: { token: string; user: { id: string } };
  let ownerB: string;
  const tokens = {} as Record<Exclude<Role, 'owner'>, string>;
  const ids: Record<string, string> = {};
  const idle = () => t.app.get(DocumentTasks).idle();
  const call = (r: { method: string; path: string }, token?: string, fill: (name: string, path: string) => string = () => crypto.randomUUID()) => {
    const url = `/v1${r.path.replace(/\{(\w+)\}/g, (_, name: string) => encodeURIComponent(fill(name, r.path)))}`;
    const req = (t.http() as any)[r.method](url);
    if (token) req.set(auth(token));
    return ['post', 'put', 'patch'].includes(r.method) ? req.send({}) : req;
  };

  beforeAll(async () => {
    process.env.COROC_CORS_ORIGINS = ORIGIN;
    t = await bootApp('2026-10-09T15:00:00Z');
    all = routes(t);
    const a = await newTenant({ country: 'US', lang: 'es' });
    const b = await newTenant({ country: 'US', lang: 'es' });
    ownerA = await ownerSession(t, a.slug);
    ownerB = (await ownerSession(t, b.slug)).token;
    for (const role of ['admin', 'collector', 'auditor'] as const) {
      const u = await t.http().post('/v1/users').set(auth(ownerA.token)).send({ username: role, name: `Usuario ${role}`, role, password: PASSWORD }).expect(201);
      ids[`user_${role}`] = u.body.id;
      tokens[role] = (await t.http().post('/v1/auth/login').send({ tenant: a.slug, username: role, password: PASSWORD, deviceId: `dispositivo-${role}` }).expect(200)).body.accessToken;
    }
    // Recursos de la empresa A cuyos identificadores intentará usar la empresa B.
    const c = await t.http().post('/v1/clients').set(auth(ownerA.token)).send({ client: client(1), loan: LOAN }).expect(201);
    ids.client = c.body.client.id;
    ids.loan = c.body.loan.id;
    const pay = await t.http().post(`/v1/loans/${ids.loan}/payments`).set(auth(ownerA.token)).set('Idempotency-Key', crypto.randomUUID()).send({ amount: 60_000, date: '2026-10-09', method: 'cash' }).expect(201);
    ids.entry = pay.body.entry?.id ?? pay.body.id;
    ids.task = (await t.http().post(`/v1/loans/${ids.loan}/statements`).set(auth(ownerA.token)).expect(202)).body.id;
    ids.account = (await t.http().post('/v1/receiving-accounts').set(auth(ownerA.token)).send({ holderName: 'EMPRESA A SAS', institution: 'Bancolombia', last4: '1234' }).expect(201)).body.id;
    await idle();
    ids.document = (await t.http().get('/v1/documents').set(auth(ownerA.token)).query({ clientId: ids.client }).expect(200)).body.items[0].id;
    const sessions = (await t.http().get('/v1/me/sessions').set(auth(ownerA.token)).expect(200)).body;
    ids.session = (Array.isArray(sessions) ? sessions : sessions.items)[0].id;
    const intake = await t.http().post('/v1/intake').set(auth(ownerA.token)).query({ channel: 'folder', clientId: ids.client }).set('Content-Type', 'application/octet-stream').send(Buffer.from('%PDF-1.4\n%%EOF')).expect(202);
    ids.intake = intake.body.id;
    const msgs = (await t.http().get('/v1/messages').set(auth(ownerA.token)).expect(200)).body.items;
    ids.message = msgs[0]?.id ?? crypto.randomUUID();
    await idle();
  }, 180_000);
  afterAll(async () => {
    delete process.env.COROC_CORS_ORIGINS;
    await t.app.close();
  });

  it('el contrato completo tiene controlador, y cada operación con sesión declara su permiso o es de autoservicio', () => {
    expect(all.length).toBe(contract().ops.size);
    const unguarded = all.filter((r) => !r.public && !r.permission && !SELF_SERVICE.has(r.op)).map((r) => r.op);
    expect(unguarded).toEqual([]);
    for (const r of all) if (r.permission) expect(PERMISSIONS).toContain(r.permission);
  });

  it('ASVS V4: toda operación no pública rechaza peticiones sin sesión o con un token inválido', async () => {
    const failures: string[] = [];
    for (const r of all.filter((x) => !x.public)) {
      for (const token of [undefined, 'no-es-un-jwt', `${ownerA.token.slice(0, -4)}AAAA`]) {
        const res = await call(r, token);
        if (res.status !== 401) failures.push(`${r.op} (${token ? 'token inválido' : 'sin token'}) → ${res.status}`);
      }
    }
    expect(failures).toEqual([]);
  }, 120_000);

  it('ASVS V3: tokens con alg=none, firmados con otra clave, de otra audiencia o vencidos no abren sesión', async () => {
    const payload = JSON.parse(Buffer.from(ownerA.token.split('.')[1]!, 'base64url').toString());
    const none = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ ...payload, role: 'owner' })).toString('base64url')}.`;
    const forged = await new SignJWT({ ...payload }).setProtectedHeader({ alg: 'HS256' }).sign(crypto.randomBytes(32));
    // Un Cobrador que cambia su rol en el token: la firma deja de valer.
    const [h, p, s] = tokens.collector.split('.');
    const escalated = `${h}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p!, 'base64url').toString()), role: 'owner' })).toString('base64url')}.${s}`;
    for (const tk of [none, forged, escalated]) await t.http().get('/v1/company').set(auth(tk)).expect(401);
    await t.http().get('/v1/company').set({ Authorization: `Basic ${Buffer.from('propietario:x').toString('base64')}` }).expect(401);
    const now = t.clock.now().toISOString();
    t.clock.set(new Date(new Date(now).getTime() + 24 * 3600_000).toISOString());
    try {
      await t.http().get('/v1/company').set(auth(ownerA.token)).expect(401);
    } finally {
      t.clock.set(now);
    }
    await t.http().get('/v1/company').set(auth(ownerA.token)).expect(200);
  });

  it('ASVS V4.1: matriz de roles (§7.2) — cada operación niega 403 a los roles sin su permiso', async () => {
    const failures: string[] = [];
    for (const role of ['admin', 'collector', 'auditor'] as const) {
      for (const r of all.filter((x) => x.permission && !ROLE_PERMISSIONS[role].has(x.permission))) {
        const res = await call(r, tokens[role]);
        if (res.status !== 403) failures.push(`${role} · ${r.op} (${r.permission}) → ${res.status}`);
      }
    }
    expect(failures).toEqual([]);
  }, 120_000);

  it('ASVS V4.2 (IDOR): la empresa B no alcanza ningún recurso de la empresa A aunque conozca sus identificadores', async () => {
    const byPath = (name: string, path: string): string => {
      if (name === 'entryId') return ids.entry!;
      if (name === 'channel') return 'whatsapp';
      if (name === 'event') return 'reminder';
      if (name === 'lang') return 'es';
      const kind = path.split('/')[1]!;
      return ({ clients: ids.client, loans: ids.loan, documents: ids.document, tasks: ids.task, intake: ids.intake, messages: ids.message, users: ids.user_collector, 'receiving-accounts': ids.account, me: ids.session } as Record<string, string | undefined>)[kind] ?? crypto.randomUUID();
    };
    const failures: string[] = [];
    const targets = all.filter((r) => !r.public && /\{(id|entryId)\}/.test(r.path));
    expect(targets.length).toBeGreaterThan(30);
    for (const r of targets) {
      const res = await call(r, ownerB, byPath);
      if (res.status < 400 || res.status >= 500) failures.push(`${r.op} → ${res.status}`);
    }
    expect(failures).toEqual([]);
    // Y nada cambió en A: el pago sigue vigente, el cliente y su préstamo intactos, las sesiones abiertas.
    const ledger = (await t.http().get(`/v1/loans/${ids.loan}/ledger`).set(auth(ownerA.token)).expect(200)).body;
    expect(ledger.find((e: { id: string }) => e.id === ids.entry).reversedBy ?? null).toBeNull();
    expect((await t.http().get(`/v1/clients/${ids.client}`).set(auth(ownerA.token)).expect(200)).body.client?.firstName ?? 'Cliente 1').toBe('Cliente 1');
    await t.http().get('/v1/company').set(auth(tokens.collector)).expect(200);
  }, 120_000);

  it('ASVS V4.2: el Cobrador no alcanza clientes que no tiene asignados (RLS)', async () => {
    await t.http().get(`/v1/clients/${ids.client}`).set(auth(tokens.collector)).expect((r) => expect([403, 404]).toContain(r.status));
    await t.http().get(`/v1/loans/${ids.loan}/ledger`).set(auth(tokens.collector)).expect((r) => expect([403, 404]).toContain(r.status));
    await t.http().get(`/v1/documents/${ids.document}`).set(auth(tokens.collector)).expect((r) => expect([403, 404]).toContain(r.status));
    expect((await t.http().get('/v1/clients').set(auth(tokens.collector)).expect(200)).body.items).toEqual([]);
  });

  it('ASVS V14.4: encabezados de seguridad en la API, la salud y el portal del deudor', async () => {
    for (const path of ['/v1/company', '/health', '/v1/public/upload/no-existe-este-enlace-0000']) {
      const r = await t.http().get(path).set(auth(ownerA.token));
      expect(r.headers['x-powered-by']).toBeUndefined();
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect(r.headers['strict-transport-security']).toMatch(/max-age=\d{7,}/);
      expect(r.headers['x-frame-options']).toMatch(/^(SAMEORIGIN|DENY)$/);
      expect(r.headers['content-security-policy']).toMatch(/frame-ancestors '(self|none)'/);
      expect(r.headers['referrer-policy']).toBe('no-referrer');
    }
    const api = await t.http().get('/v1/company').set(auth(ownerA.token)).expect(200);
    expect(api.headers['cache-control']).toBe('no-store');
    expect(api.headers['content-type']).toMatch(/^application\/json/);
    // Id de petición para seguir un caso de soporte en los registros: se respeta el del balanceador si es seguro.
    expect(api.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect((await t.http().get('/health').set('X-Request-Id', 'lb-abc12345').expect(200)).headers['x-request-id']).toBe('lb-abc12345');
    expect((await t.http().get('/health').set('X-Request-Id', '<script>a=b</script>').expect(200)).headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('ASVS V5: inyección SQL y de rutas en búsquedas, parámetros y nombres de archivo no causa errores ni fugas', async () => {
    const attacks = ["' OR '1'='1", "'; DROP TABLE coroc.clients; --", '%', '_', '\\', '%%%_\\', '1 UNION SELECT id FROM coroc.users', '../../etc/passwd', '<script>alert(1)</script>', '\u0000'];
    for (const q of attacks) {
      const r = await t.http().get('/v1/clients').set(auth(ownerB)).query({ q });
      expect([200, 422]).toContain(r.status);
      if (r.status === 200) expect(r.body.items).toEqual([]);
    }
    for (const id of ["1' OR '1'='1", '../../../etc/passwd', '00000000-0000-0000-0000-000000000000']) {
      const r = await t.http().get(`/v1/clients/${encodeURIComponent(id)}`).set(auth(ownerB));
      expect([404, 422]).toContain(r.status);
    }
    await t.http().get('/v1/files/..%2F..%2Fetc%2Fpasswd').expect((r) => expect([400, 404, 410, 422]).toContain(r.status));
    // La base sigue ahí y la empresa A conserva su cliente.
    await t.http().get(`/v1/clients/${ids.client}`).set(auth(ownerA.token)).expect(200);
  });

  it('ASVS V13: cuerpos enormes, JSON malformado y tipos inesperados se rechazan sin error interno', async () => {
    await t.http().post('/v1/clients').set(auth(ownerA.token)).set('Content-Type', 'application/json').send(`{"client":{"firstName":"${'x'.repeat(1_100_000)}"}}`).expect(413);
    await t.http().post('/v1/clients').set(auth(ownerA.token)).set('Content-Type', 'application/json').send('{"client": {').expect(400);
    await t.http().post('/v1/clients').set(auth(ownerA.token)).send({ client: { ...client(9), firstName: { $gt: '' } }, loan: LOAN }).expect(422);
    await t.http().post('/v1/clients').set(auth(ownerA.token)).send({ client: client(9), loan: LOAN, __proto__: { role: 'owner' }, tenantId: crypto.randomUUID() }).expect((r) => expect([201, 422]).toContain(r.status));
    const r = await t.http().post('/v1/auth/login').send({ tenant: ['a'], username: { a: 1 }, password: 1 });
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.body)).not.toMatch(/at \w+ \(|node_modules|stack/);
  });

  it('ASVS V14.5: CORS solo para los orígenes configurados', async () => {
    const ok = await t.http().options('/v1/company').set('Origin', ORIGIN).set('Access-Control-Request-Method', 'GET');
    expect(ok.headers['access-control-allow-origin']).toBe(ORIGIN);
    const bad = await t.http().options('/v1/company').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'GET');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
    const get = await t.http().get('/v1/company').set(auth(ownerA.token)).set('Origin', 'https://evil.example');
    expect(get.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('ASVS V2.2: el ingreso limita los intentos por dirección y no revela si el usuario existe', async () => {
    const wrongUser = await t.http().post('/v1/auth/login').send({ tenant: 'no-existe', username: 'nadie', password: 'Clave-Equivocada-1', deviceId: 'atacante-1' });
    const wrongPass = await t.http().post('/v1/auth/login').send({ tenant: 'no-existe', username: 'propietario', password: 'Clave-Equivocada-1', deviceId: 'atacante-1' });
    expect(wrongUser.status).toBe(401);
    expect(wrongPass.body.code).toBe(wrongUser.body.code);
    let limited = 0;
    for (let i = 0; i < 40; i++) {
      const r = await t.http().post('/v1/auth/login').send({ tenant: 'no-existe', username: 'nadie', password: `Clave-Equivocada-${i}`, deviceId: 'atacante-1' });
      if (r.status === 429) limited++;
      else expect(r.status).toBe(401);
    }
    expect(limited).toBeGreaterThan(0);
  });
});
