// Fase 5 · Eliminación de cuentas (App Store 5.1.1(v), Google Play; ADR-056).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, bootApp, expectContract, newTenant, ownerSession, PASSWORD } from './helpers.js';

type T = Awaited<ReturnType<typeof bootApp>>;

describe('Eliminación de cuentas desde la app (ADR-056)', () => {
  let t: T;
  let slug: string;
  let owner: string;
  const login = (username: string, password = PASSWORD) => t.http().post('/v1/auth/login').send({ tenant: slug, username, password, deviceId: `disp-${username}` });

  beforeAll(async () => {
    t = await bootApp('2026-10-09T15:00:00Z');
    slug = (await newTenant({ country: 'US', lang: 'es' })).slug;
    owner = (await ownerSession(t, slug)).token;
    for (const u of ['cobrador1', 'cobrador2']) await t.http().post('/v1/users').set(auth(owner)).send({ username: u, name: `Nombre ${u}`, role: 'collector', password: PASSWORD, email: `${u}@example.com` }).expect(201);
  }, 60_000);
  afterAll(async () => t.app.close());

  it('un usuario elimina su propia cuenta con su contraseña: queda anónimo y no vuelve a ingresar', async () => {
    const s = (await login('cobrador1').expect(200)).body;
    await t.http().delete('/v1/me').set(auth(s.accessToken)).send({ password: 'otra-cosa' }).expect(401);
    await t.http().delete('/v1/me').set(auth(s.accessToken)).send({ password: PASSWORD }).expect(204);
    await t.http().get('/v1/me').set(auth(s.accessToken)).expect(401);
    expect((await login('cobrador1')).status).toBe(401);
    const users = (await t.http().get('/v1/users').set(auth(owner)).expect(200)).body as { name: string; username: string }[];
    expect(users.some((u) => u.username === 'cobrador1' || u.name === 'Nombre cobrador1')).toBe(false);
  });

  it('el Administrador elimina a otro usuario; no al Propietario ni a sí mismo', async () => {
    const list = (await t.http().get('/v1/users').set(auth(owner)).expect(200)).body as { id: string; username: string; role: string }[];
    const c2 = list.find((u) => u.username === 'cobrador2')!;
    const me = list.find((u) => u.role === 'owner')!;
    await t.http().delete(`/v1/users/${c2.id}`).set(auth(owner)).expect(204);
    await t.http().delete(`/v1/users/${c2.id}`).set(auth(owner)).expect(404);
    await t.http().delete(`/v1/users/${me.id}`).set(auth(owner)).expect(409);
    expect((await login('cobrador2')).status).toBe(401);
  });

  it('el Propietario no elimina su usuario: cierra la empresa, se cierran todas las sesiones y nadie ingresa', async () => {
    const r = await t.http().delete('/v1/me').set(auth(owner)).send({ password: PASSWORD }).expect(409);
    expect(r.body.code).toBe('OWNER_MUST_CLOSE_COMPANY');
    await t.http().post('/v1/company/closure').set(auth(owner)).send({ password: PASSWORD, confirmSlug: 'otra-empresa' }).expect(422);
    await t.http().post('/v1/company/closure').set(auth(owner)).send({ password: 'no-es', confirmSlug: slug }).expect(401);
    const ok = await t.http().post('/v1/company/closure').set(auth(owner)).send({ password: PASSWORD, confirmSlug: slug.toUpperCase() }).expect(202);
    expectContract('closeCompany', 202, ok.body);
    expect(new Date(ok.body.purgeAfter).getTime() - new Date(ok.body.closureRequestedAt).getTime()).toBe(30 * 86_400_000);
    await t.http().get('/v1/company').set(auth(owner)).expect(401);
    const again = await login('propietario').expect(403);
    expect(again.body.code).toBe('COMPANY_CLOSED');
  });
});
