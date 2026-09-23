import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Mailer, MemoryMailer } from '../src/common/mailer.js';
import { auth, bootApp, expectContract, newTenant, ownerSession, PASSWORD, totpNow } from './helpers.js';

describe('Ingreso, segundo factor y sesiones (§7.1)', () => {
  let t: Awaited<ReturnType<typeof bootApp>>;
  let slug: string;
  beforeAll(async () => {
    t = await bootApp('2026-10-09T14:00:00Z');
    slug = (await newTenant()).slug;
  });
  afterAll(async () => t.app.close());

  it('rechaza una empresa o contraseña incorrecta con un error RFC 9457 traducido', async () => {
    const es = await t.http().post('/v1/auth/login').send({ tenant: 'no-existe', username: 'x', password: 'y', deviceId: 'dispositivo-1' }).expect(401);
    expect(es.headers['content-type']).toContain('application/problem+json');
    expect(es.body).toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS', title: 'Datos de ingreso incorrectos' });
    const en = await t.http().post('/v1/auth/login').set('Accept-Language', 'en-US').send({ tenant: slug, username: 'propietario', password: 'incorrecta-123', deviceId: 'dispositivo-1' }).expect(401);
    expect(en.body.title).toBe('Incorrect sign-in details');
    const pt = await t.http().post('/v1/auth/login').set('Accept-Language', 'pt-BR,pt;q=0.9').send({ tenant: slug, username: 'propietario', password: 'incorrecta-123', deviceId: 'dispositivo-1' }).expect(401);
    expect(pt.body.title).toBe('Dados de acesso incorretos');
  });

  it('valida la petición contra el contrato OpenAPI', async () => {
    const r = await t.http().post('/v1/auth/login').send({ tenant: slug }).expect(422);
    expect(r.body.code).toBe('VALIDATION_FAILED');
    expect(r.body.errors.map((e: { field: string }) => e.field).sort()).toEqual(['deviceId', 'password', 'username']);
  });

  it('obliga al Propietario a activar el segundo factor antes de usar la app', async () => {
    const r = await t.http().post('/v1/auth/login').send({ tenant: slug, username: 'propietario', password: PASSWORD, deviceId: 'equipo-oficina' }).expect(200);
    expectContract('login', 200, r.body);
    expect(r.body.mfaEnrollmentRequired).toBe(true);
    const blocked = await t.http().get('/v1/clients').set(auth(r.body.accessToken)).expect(403);
    expect(blocked.body.code).toBe('MFA_ENROLLMENT_REQUIRED');
    await t.http().get('/v1/me').set(auth(r.body.accessToken)).expect(200);
    const enroll = await t.http().post('/v1/me/mfa/enroll').set(auth(r.body.accessToken)).expect(200);
    expectContract('enrollMfa', 200, enroll.body);
    expect(enroll.body.otpauthUri).toMatch(/^otpauth:\/\/totp\/COROC:propietario%40/);
    await t.http().post('/v1/me/mfa/confirm').set(auth(r.body.accessToken)).send({ code: '000000' }).expect(401);
    const ok = await t.http().post('/v1/me/mfa/confirm').set(auth(r.body.accessToken)).send({ code: totpNow(enroll.body.secret, t.clock.now()) }).expect(200);
    expect(ok.body.mfaEnrollmentRequired).toBe(false);
    expect(ok.body.user.mfaEnabled).toBe(true);
    await t.http().get('/v1/clients').set(auth(ok.body.accessToken)).expect(200);

    // Siguiente ingreso: desafío TOTP; un código ya usado no sirve de nuevo.
    t.clock.set('2026-10-09T14:05:00Z');
    const again = await t.http().post('/v1/auth/login').send({ tenant: slug, username: 'propietario', password: PASSWORD, deviceId: 'celular-ana' }).expect(200);
    expect(again.body).toMatchObject({ mfa_required: true });
    expectContract('login', 200, again.body);
    await t.http().post('/v1/auth/mfa').send({ challengeId: again.body.challengeId, code: '123456' }).expect(401);
    const s = await t.http().post('/v1/auth/mfa').send({ challengeId: again.body.challengeId, code: totpNow(enroll.body.secret, t.clock.now()) }).expect(200);
    expectContract('verifyMfa', 200, s.body);
    const sessions = await t.http().get('/v1/me/sessions').set(auth(s.body.accessToken)).expect(200);
    expect(sessions.body.map((x: { deviceId: string }) => x.deviceId).sort()).toEqual(['celular-ana', 'equipo-oficina']);
  });

  it('bloquea 15 minutos tras 5 intentos fallidos y avisa en la bitácora', async () => {
    const { slug: s2 } = await newTenant();
    const bad = { tenant: s2, username: 'propietario', password: 'no-es-la-clave', deviceId: 'dispositivo-x' };
    for (let i = 0; i < 4; i++) await t.http().post('/v1/auth/login').send(bad).expect(401);
    const locked = await t.http().post('/v1/auth/login').send(bad).expect(423);
    expect(locked.body).toMatchObject({ code: 'ACCOUNT_LOCKED', detail: 'Por seguridad, intente de nuevo en 15 minutos.' });
    await t.http().post('/v1/auth/login').send({ ...bad, password: PASSWORD }).expect(423);
    t.clock.set('2026-10-09T14:21:00Z');
    await t.http().post('/v1/auth/login').send({ ...bad, password: PASSWORD }).expect(200);
    t.clock.set('2026-10-09T14:05:00Z');
  });

  it('rota el token de renovación; reutilizar uno viejo revoca la sesión', async () => {
    const { slug: s3 } = await newTenant();
    const o = await ownerSession(t, s3, 'tableta-sala');
    const r1 = await t.http().post('/v1/auth/refresh').send({ refreshToken: o.refresh, deviceId: 'tableta-sala' }).expect(200);
    expectContract('refresh', 200, r1.body);
    expect(r1.body.refreshToken).not.toBe(o.refresh);
    await t.http().post('/v1/auth/refresh').send({ refreshToken: r1.body.refreshToken, deviceId: 'otro-equipo' }).expect(401);
    await t.http().post('/v1/auth/refresh').send({ refreshToken: o.refresh, deviceId: 'tableta-sala' }).expect(401);
    // La reutilización cerró la sesión: ni el token nuevo ni el de acceso siguen sirviendo.
    await t.http().post('/v1/auth/refresh').send({ refreshToken: r1.body.refreshToken, deviceId: 'tableta-sala' }).expect(401);
    await t.http().get('/v1/me').set(auth(r1.body.accessToken)).expect(401);
  });

  it('cierra la sesión y rechaza el token de acceso', async () => {
    const { slug: s4 } = await newTenant();
    const o = await ownerSession(t, s4);
    await t.http().post('/v1/auth/logout').set(auth(o.token)).expect(204);
    const r = await t.http().get('/v1/me').set(auth(o.token)).expect(401);
    expect(r.body.code).toBe('SESSION_EXPIRED');
  });

  it('exige contraseñas de 12 caracteres, no filtradas y sin el usuario', async () => {
    const { slug: s5 } = await newTenant();
    const o = await ownerSession(t, s5);
    const weak = await t.http().post('/v1/users').set(auth(o.token)).send({ username: 'cobrador1', name: 'Cobrador', role: 'collector', password: 'cobrador1-2026' }).expect(422);
    expect(weak.body.code).toBe('WEAK_PASSWORD');
    const breached = await t.http().post('/v1/users').set(auth(o.token)).send({ username: 'cobrador1', name: 'Cobrador', role: 'collector', password: 'passwordpassword' }).expect(422);
    expect(breached.body.code).toBe('BREACHED_PASSWORD');
    const ok = await t.http().post('/v1/users').set(auth(o.token)).send({ username: 'cobrador1', name: 'Cobrador Uno', role: 'collector', password: 'Rutas-del-Norte-77' }).expect(201);
    expectContract('createUser', 201, ok.body);
    expect(ok.body.permissions).toEqual(['company.view', 'clients.view', 'payments.register', 'documents.upload', 'intake.view', 'messages.view', 'messages.send', 'dashboard.view']);
    await t.http().post('/v1/users').set(auth(o.token)).send({ username: 'cobrador1', name: 'Otro', role: 'collector', password: 'Rutas-del-Norte-77' }).expect(409);
  });

  it('recupera la contraseña con un enlace de un solo uso que vence en 30 minutos', async () => {
    const { slug: s6 } = await newTenant();
    const mailer = t.app.get(Mailer) as MemoryMailer;
    await t.http().post('/v1/auth/password/forgot').send({ tenant: s6, username: 'propietario' }).expect(202);
    await t.http().post('/v1/auth/password/forgot').send({ tenant: s6, username: 'nadie' }).expect(202);
    const mail = mailer.outbox.at(-1)!;
    expect(mail.to).toBe('ana@example.com');
    const token = decodeURIComponent(/token=([^\s]+)/.exec(mail.text)![1]!);
    await t.http().post('/v1/auth/password/reset').send({ token, password: 'corta' }).expect(422);
    await t.http().post('/v1/auth/password/reset').send({ token, password: 'Nueva-Clave-Segura-9' }).expect(204);
    await t.http().post('/v1/auth/password/reset').send({ token, password: 'Otra-Clave-Segura-10' }).expect(400);
    await t.http().post('/v1/auth/login').send({ tenant: s6, username: 'propietario', password: PASSWORD, deviceId: 'd-1234567' }).expect(401);
    await t.http().post('/v1/auth/login').send({ tenant: s6, username: 'propietario', password: 'Nueva-Clave-Segura-9', deviceId: 'd-1234567' }).expect(200);
  });
});
