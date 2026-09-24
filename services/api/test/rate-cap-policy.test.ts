// P-6 · Préstamos por encima del tope de tasa por decisión del Propietario (ADR-061).
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, bootApp, expectContract, newTenant, ownerSession, PASSWORD, registerRateCap } from './helpers.js';

type T = Awaited<ReturnType<typeof bootApp>>;

// Las condiciones de CA-01: 20 % sobre el capital en 20 cuotas diarias, muy por encima de la usura colombiana.
const CA01_TERMS = { principal: 1_000_000, currency: 'COP', method: 'simple', rate: '0.20', installments: 20, frequency: 'daily', disbursementDate: '2026-10-08' };
let phone = 3_150_000_000;
const client = () => ({
  firstName: 'Luis', lastName: 'Tasa Alta', phone: String(++phone), lang: 'es',
  consents: [{ channel: 'personal_data', method: 'Autorización Ley 1581' }],
});

async function adminQuery<R = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<R[]> {
  const c = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await c.connect();
  try {
    await c.query('SET search_path = coroc, public');
    return (await c.query(sql, params)).rows as R[];
  } finally {
    await c.end();
  }
}

describe('Tope de tasa: bloquear o solo advertir (P-6, ADR-061)', () => {
  let t: T;
  let token: string;
  let tenantId: string;
  let slug: string;
  beforeAll(async () => {
    t = await bootApp('2026-10-08T15:00:00Z');
    const tenant = await newTenant();
    slug = tenant.slug;
    tenantId = tenant.tenantId;
    token = (await ownerSession(t, slug)).token;
  });
  afterAll(async () => t.app.close());

  it('por defecto la empresa bloquea: sin tope en Colombia y por encima del tope no se crea, aunque se confirme', async () => {
    const company = await t.http().get('/v1/company').set(auth(token)).expect(200);
    expect(company.body.settings.rateCapPolicy).toBe('block');
    const missing = await t.http().post('/v1/clients').set(auth(token)).send({ client: client(), loan: { ...CA01_TERMS, acknowledgeRateCap: true } }).expect(422);
    expect(missing.body).toMatchObject({ code: 'RATE_CAP_MISSING', rateCap: { missing: true, overridable: false } });

    await registerRateCap(t.http, token, 0.2493);
    const pre = await t.http().post('/v1/loans/preview').set(auth(token)).send(CA01_TERMS).expect(200);
    expectContract('previewLoan', 200, pre.body);
    expect(pre.body.rateCap).toMatchObject({ ok: false, overridable: false });
    const over = await t.http().post('/v1/clients').set(auth(token)).send({ client: client(), loan: { ...CA01_TERMS, acknowledgeRateCap: true } }).expect(422);
    expect(over.body).toMatchObject({ code: 'RATE_CAP_EXCEEDED', rateCap: { ok: false, overridable: false } });
  });

  it('solo el Propietario cambia la política, aceptando la responsabilidad; no se cambia por la configuración general', async () => {
    const user = await t.http().post('/v1/users').set(auth(token)).send({ username: 'admin1', name: 'Ada Admin', role: 'admin', password: PASSWORD }).expect(201);
    expect(user.body.role).toBe('admin');
    const admin = await t.http().post('/v1/auth/login').send({ tenant: slug, username: 'admin1', password: PASSWORD, deviceId: 'dispositivo-admin-1' }).expect(200);
    const denied = await t.http().put('/v1/compliance/rate-cap-policy').set(auth(admin.body.accessToken)).send({ policy: 'warn', acceptResponsibility: true }).expect(403);
    expect(denied.body.code).toBe('OWNER_REQUIRED');

    const noAccept = await t.http().put('/v1/compliance/rate-cap-policy').set(auth(token)).send({ policy: 'warn' }).expect(422);
    expect(noAccept.body.errors[0].field).toBe('acceptResponsibility');
    const sneaky = await t.http().patch('/v1/company').set(auth(token)).send({ settings: { rateCapPolicy: 'warn' } }).expect(422);
    expect(sneaky.body.errors[0].field).toBe('settings.rateCapPolicy');

    const ok = await t.http().put('/v1/compliance/rate-cap-policy').set(auth(token)).send({ policy: 'warn', acceptResponsibility: true }).expect(200);
    expectContract('setRateCapPolicy', 200, ok.body);
    expect(ok.body).toMatchObject({ policy: 'warn' });
    expect(ok.body.acceptedAt).toBeTruthy();
    const company = await t.http().get('/v1/company').set(auth(token)).expect(200);
    expect(company.body.settings).toMatchObject({ rateCapPolicy: 'warn', rateCapPolicyAcceptedBy: ok.body.acceptedBy });
    const logged = await adminQuery<{ after: Record<string, unknown> }>("SELECT after FROM audit_log WHERE tenant_id = $1 AND action = 'compliance.rate_cap_policy'", [tenantId]);
    expect(logged).toHaveLength(1);
    expect(logged[0]!.after).toMatchObject({ rateCapPolicy: 'warn', acceptResponsibility: true });
  });

  it('con «solo advertir», cada préstamo por encima del tope exige confirmación y queda marcado y auditado', async () => {
    const pre = await t.http().post('/v1/loans/preview').set(auth(token)).send(CA01_TERMS).expect(200);
    expect(pre.body.rateCap).toMatchObject({ ok: false, overridable: true, maxRate: expect.any(String) });

    // Sin confirmar, sigue sin crearse: un préstamo por encima del tope nunca pasa por descuido.
    const unconfirmed = await t.http().post('/v1/clients').set(auth(token)).send({ client: client(), loan: CA01_TERMS }).expect(422);
    expect(unconfirmed.body).toMatchObject({ code: 'RATE_CAP_EXCEEDED', rateCap: { overridable: true } });

    const created = await t.http().post('/v1/clients').set(auth(token)).send({ client: client(), loan: { ...CA01_TERMS, acknowledgeRateCap: true } }).expect(201);
    expectContract('createClientWithLoan', 201, created.body);
    expect(created.body.loan).toMatchObject({ rateCapOverride: true, totalPayable: 1_200_000 });
    expect(created.body.loan.effectiveAnnualRate).toBeGreaterThan(0.2493);
    const loan = await t.http().get(`/v1/loans/${created.body.loan.id}`).set(auth(token)).expect(200);
    expect(loan.body.rateCapOverride).toBe(true);
    const logged = await adminQuery<{ entity_id: string; after: Record<string, unknown> }>("SELECT entity_id, after FROM audit_log WHERE tenant_id = $1 AND action = 'loan.rate_cap_override'", [tenantId]);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ entity_id: created.body.loan.id, after: { breaches: ['rate'], cap: 0.2493 } });

    // Un préstamo dentro del tope no se marca aunque la petición lo confirme.
    const fine = await t.http().post('/v1/clients').set(auth(token)).send({ client: client(), loan: { ...CA01_TERMS, method: 'french', rate: '0.015', installments: 6, frequency: 'monthly', acknowledgeRateCap: true } }).expect(201);
    expect(fine.body.loan.rateCapOverride).toBe(false);
  });

  it('volver a «bloquear» impide de nuevo los préstamos por encima del tope', async () => {
    const back = await t.http().put('/v1/compliance/rate-cap-policy').set(auth(token)).send({ policy: 'block' }).expect(200);
    expect(back.body).toEqual({ policy: 'block', acceptedAt: null, acceptedBy: null });
    const r = await t.http().post('/v1/clients').set(auth(token)).send({ client: client(), loan: { ...CA01_TERMS, acknowledgeRateCap: true } }).expect(422);
    expect(r.body).toMatchObject({ code: 'RATE_CAP_EXCEEDED', rateCap: { overridable: false } });
  });
});
