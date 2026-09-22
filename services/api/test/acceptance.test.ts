// Criterios de aceptación de la Fase 1 (§22, §23) verificados de punta a punta por HTTP contra PostgreSQL 16 real.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventBus, type CorocEvent } from '../src/dashboard/event-bus.js';
import { auth, bootApp, expectContract, newTenant, ownerSession, registerRateCap } from './helpers.js';

type T = Awaited<ReturnType<typeof bootApp>>;
const CA01_TERMS = { principal: 1_000_000, currency: 'COP', method: 'simple', rate: '0.20', installments: 20, frequency: 'daily', disbursementDate: '2026-10-08' };

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

const client = (over: Record<string, unknown> = {}) => ({
  firstName: 'María José', lastName: 'Pérez Gómez', phone: '315 777 8899', email: 'maria@example.com', lang: 'es',
  consents: [{ channel: 'whatsapp', method: 'Firma en el contrato' }, { channel: 'personal_data', method: 'Autorización Ley 1581' }],
  ...over,
});

describe('Motor financiero por la API (CA-01 a CA-04)', () => {
  let t: T;
  let token: string;
  beforeAll(async () => {
    t = await bootApp('2026-10-08T15:00:00Z');
    token = (await ownerSession(t, (await newTenant()).slug)).token;
  });
  afterAll(async () => t.app.close());

  it('CA-01 interés simple: total $ 1.200.000 y cuota $ 60.000', async () => {
    const r = await t.http().post('/v1/loans/preview').set(auth(token)).send(CA01_TERMS).expect(200);
    expectContract('previewLoan', 200, r.body);
    expect(r.body.totalPayable).toBe(1_200_000);
    expect(r.body.regularInstallment).toBe(60_000);
    expect(r.body.installments).toHaveLength(20);
    // Sin tope registrado la vista previa avisa: en Colombia no se podrá guardar (§9.6).
    expect(r.body.rateCap).toMatchObject({ missing: true, ok: false });
  });

  it('CA-02 redondeo a 1 peso: seis cuotas de $ 164.286 y la séptima de $ 164.284', async () => {
    const r = await t.http().post('/v1/loans/preview').set(auth(token)).send({ ...CA01_TERMS, rate: '0.15', installments: 7 }).expect(200);
    expect(r.body.installments.map((i: { amount: number }) => i.amount)).toEqual([164286, 164286, 164286, 164286, 164286, 164286, 164284]);
    expect(r.body.totalPayable).toBe(1_150_000);
  });

  it('CA-03 francés: $ 5.000.000 al 2 % mensual en 12 cuotas', async () => {
    const r = await t.http().post('/v1/loans/preview').set(auth(token)).send({ ...CA01_TERMS, principal: 5_000_000, method: 'french', rate: '0.02', installments: 12, frequency: 'monthly' }).expect(200);
    const [first] = r.body.installments;
    expect(r.body.regularInstallment).toBe(472_798);
    expect(first).toMatchObject({ amount: 472_798, interest: 100_000, principal: 372_798, balanceAfter: 5_673_576 - 472_798 });
    expect(r.body.installments.at(-1).balanceAfter).toBe(0);
    expect(r.body.totalPayable).toBe(5_673_576);
  });

  it('CA-04 diaria lunes a sábado sin festivos de Colombia desde el jueves 8-oct-2026', async () => {
    const r = await t.http().post('/v1/loans/preview').set(auth(token)).send(CA01_TERMS).expect(200);
    expect(r.body.installments.slice(0, 4).map((i: { dueDate: string }) => i.dueDate)).toEqual(['2026-10-09', '2026-10-10', '2026-10-13', '2026-10-14']);
  });

  it('rechaza condiciones no válidas con el motivo traducido', async () => {
    const r = await t.http().post('/v1/loans/preview').set(auth(token)).set('Accept-Language', 'en').send({ ...CA01_TERMS, firstDueDate: '2026-10-01' }).expect(422);
    expect(r.body).toMatchObject({ code: 'INVALID_TERMS', detail: 'The first installment must be after the disbursement.' });
    const bad = await t.http().post('/v1/loans/preview').set(auth(token)).send({ ...CA01_TERMS, rate: 'veinte' }).expect(422);
    expect(bad.body.errors[0].field).toBe('rate');
  });
});

describe('Pagos, recibo, reverso y dashboard (CA-05, CA-06, CA-18)', () => {
  let t: T;
  let token: string;
  let refresh: string;
  // Al mover el reloj de prueba el token de acceso (15 min) vence: se renueva como lo haría la app.
  const at = async (iso: string) => {
    t.clock.set(iso);
    const r = await t.http().post('/v1/auth/refresh').send({ refreshToken: refresh, deviceId: 'dispositivo-prueba-1' }).expect(200);
    token = r.body.accessToken;
    refresh = r.body.refreshToken;
  };
  let loanId: string;
  let clientId: string;
  const events: CorocEvent[] = [];
  beforeAll(async () => {
    t = await bootApp('2026-10-09T15:00:00Z');
    // Las condiciones de CA-01 superan la tasa de usura colombiana, así que COROC no las guarda en una empresa de Colombia
    // (CA-12). La aritmética de CA-05 y CA-06 se verifica con esas mismas condiciones en una empresa sin tope registrado.
    const tenant = await newTenant({ country: 'US' });
    const o = await ownerSession(t, tenant.slug);
    token = o.token;
    refresh = o.refresh;
    t.app.get(EventBus).subscribe(tenant.tenantId, (e) => events.push(e));
    const r = await t.http().post('/v1/clients').set(auth(token)).send({ client: client({ phone: '+57 315 777 8899' }), loan: CA01_TERMS }).expect(201);
    expectContract('createClientWithLoan', 201, r.body);
    loanId = r.body.loan.id;
    clientId = r.body.client.id;
    expect(r.body.client.folderName).toMatch(/^Maria Jose Perez Gomez - C\d{6}$/);
    expect(r.body.loan.contract).toBe('CT-000001');
  });
  afterAll(async () => t.app.close());

  it('CA-05 pago de $ 60.000: cuota 1 pagada, 19 restantes, acumulado $ 60.000, nuevo saldo $ 1.140.000', async () => {
    const r = await t.http().post(`/v1/loans/${loanId}/payments`).set(auth(token)).send({ amount: 60_000, date: '2026-10-09', method: 'Nequi', reference: 'M1001' }).expect(201);
    expectContract('postPayment', 201, r.body);
    expect(r.body.receipt).toMatchObject({
      number: 'RC-000001', totalInstallments: 20, coverage: 'Cuota 1 (completa)', remainingInstallments: 19,
      accumulatedPaid: 60_000, previousBalance: 1_200_000, newBalance: 1_140_000, lang: 'es',
      payment: { date: '2026-10-09', amount: 60_000, method: 'Nequi', reference: 'M1001' },
      client: { fullName: 'María José Pérez Gómez' },
    });
    expect(r.body.receipt.verificationCode).toMatch(/^[0-9A-F]{16}$/);
  });

  it('vista previa del pago: la misma cobertura que tendrá el recibo, sin registrar nada', async () => {
    const r = await t.http().post(`/v1/loans/${loanId}/payments/preview`).set(auth(token)).set('Accept-Language', 'en').send({ amount: 150_000, date: '2026-10-09' }).expect(200);
    expectContract('previewPayment', 200, r.body);
    expect(r.body).toMatchObject({ coverage: 'Installments 2 and 3 (paid in full) · Installment 4 (partial payment COP 30,000)', newBalance: 990_000, remainingInstallments: 17 });
    const ledger = await t.http().get(`/v1/loans/${loanId}/ledger`).set(auth(token)).expect(200);
    expect(ledger.body.filter((e: { type: string }) => e.type === 'payment')).toHaveLength(1);
  });

  it('CA-06 pago de $ 150.000: cuotas 2 y 3 y abono de $ 30.000 a la 4; 17 restantes; saldo $ 990.000', async () => {
    const r = await t.http().post(`/v1/loans/${loanId}/payments`).set(auth(token)).set('Idempotency-Key', 'pago-ca06-0001').send({ amount: 150_000, date: '2026-10-09', method: 'Efectivo', cash: true }).expect(201);
    expect(r.body.receipt).toMatchObject({
      coverage: 'Cuotas 2 y 3 (completas) · Cuota 4 (abono parcial $ 30.000)', remainingInstallments: 17,
      accumulatedPaid: 210_000, newBalance: 990_000, next: { number: 4, dueDate: '2026-10-14', amount: 30_000 },
    });
    expect(r.body.entry.allocation).toEqual([
      { number: 2, toLateFee: 0, toInstallment: 60_000, completed: true, partial: false },
      { number: 3, toLateFee: 0, toInstallment: 60_000, completed: true, partial: false },
      { number: 4, toLateFee: 0, toInstallment: 30_000, completed: false, partial: true },
    ]);
    // Reintento con la misma clave (mala señal): misma respuesta, un solo pago en el libro.
    const again = await t.http().post(`/v1/loans/${loanId}/payments`).set(auth(token)).set('Idempotency-Key', 'pago-ca06-0001').send({ amount: 150_000, date: '2026-10-09', method: 'Efectivo', cash: true }).expect(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body.receipt.number).toBe(r.body.receipt.number);
    await t.http().post(`/v1/loans/${loanId}/payments`).set(auth(token)).set('Idempotency-Key', 'pago-ca06-0001').send({ amount: 1, date: '2026-10-09' }).expect(422);
    const ledger = await t.http().get(`/v1/loans/${loanId}/ledger`).set(auth(token)).expect(200);
    expectContract('getLedger', 200, ledger.body);
    expect(ledger.body.filter((e: { type: string }) => e.type === 'payment')).toHaveLength(2);
  });

  it('cuadro de inversión y pagos (§10) con estado, pagos y recibos por cuota', async () => {
    const r = await t.http().get(`/v1/loans/${loanId}/schedule`).set(auth(token)).expect(200);
    expectContract('getSchedule', 200, r.body);
    expect(r.body.slice(0, 5).map((i: { status: string; paid: number }) => [i.status, i.paid])).toEqual([['paid', 60000], ['paid', 60000], ['paid', 60000], ['partial', 30000], ['pending', 0]]);
    expect(r.body[3].receiptNumbers).toEqual(['RC-000002']);
    const loan = await t.http().get(`/v1/loans/${loanId}`).set(auth(token)).expect(200);
    expectContract('getLoan', 200, loan.body);
    expect(loan.body.summary).toMatchObject({ paidTotal: 210_000, balance: 990_000, remainingInstallments: 17, paidInstallments: 3 });
    expect(loan.body.realizedProfit).toBe(35_000); // 210.000 × 200.000 / 1.200.000
  });

  it('dashboard (§17) con definiciones exactas y aviso en tiempo real', async () => {
    const d = await t.http().get('/v1/dashboard').set(auth(token)).query({ currency: 'COP' }).expect(200);
    expectContract('getDashboard', 200, d.body);
    expect(d.body).toMatchObject({
      currency: 'COP', clientsActive: 1, clientsTotal: 1, totalLent: 1_000_000, totalLentHistoric: 1_000_000,
      expectedToday: 0, collectedToday: 210_000, totalReceivable: 990_000, overdueTotal: 0,
    });
    expect(d.body.trend.at(-1)).toEqual({ date: '2026-10-09', amount: 210_000 });
    expect(events.filter((e) => e.type === 'payment.posted').map((e) => e.data.amount)).toEqual([60_000, 150_000]);
    await at('2026-10-13T15:00:00Z');
    const later = await t.http().get('/v1/dashboard').set(auth(token)).query({ currency: 'COP' }).expect(200);
    // 13-oct vence la cuota 4 (saldo $ 30.000); aún no hay vencidos.
    expect(later.body).toMatchObject({ expectedToday: 0, overdueTotal: 0 });
    await at('2026-10-14T15:00:00Z');
    const due = await t.http().get('/v1/collections/today').set(auth(token)).expect(200);
    expectContract('todayCollections', 200, due.body);
    expect(due.body.items[0]).toMatchObject({ installmentNumber: 4, dueToday: 30_000, status: 'due_today' });
    await at('2026-10-09T15:00:00Z');
  });

  it('CA-18 reverso: contramovimiento, recibo ANULADO, saldos y dashboard recalculados', async () => {
    const ledger = (await t.http().get(`/v1/loans/${loanId}/ledger`).set(auth(token)).expect(200)).body;
    const first = ledger.find((e: { type: string; receiptNumber: string }) => e.type === 'payment' && e.receiptNumber === 'RC-000001');
    await t.http().post(`/v1/loans/${loanId}/payments/${first.id}/reversal`).set(auth(token)).send({ reason: 'x' }).expect(422);
    const r = await t.http().post(`/v1/loans/${loanId}/payments/${first.id}/reversal`).set(auth(token)).send({ reason: 'Consignación rechazada por el banco' }).expect(201);
    expectContract('reversePayment', 201, r.body);
    expect(r.body).toMatchObject({ voidedReceipt: 'RC-000001', balance: 1_050_000, entry: { type: 'reversal', reversesId: first.id, amount: 60_000 } });
    await t.http().post(`/v1/loans/${loanId}/payments/${first.id}/reversal`).set(auth(token)).send({ reason: 'Otra vez' }).expect(409);
    const receipts = (await t.http().get(`/v1/loans/${loanId}/receipts`).set(auth(token)).expect(200)).body;
    expectContract('listReceipts', 200, receipts);
    expect(receipts.map((x: { number: string; voided: boolean }) => [x.number, x.voided])).toEqual([['RC-000001', true], ['RC-000002', false]]);
    // El pago que sigue vigente se reaplica desde la cuota 1 (ADR-003).
    const sched = (await t.http().get(`/v1/loans/${loanId}/schedule`).set(auth(token)).expect(200)).body;
    expect(sched.slice(0, 4).map((i: { paid: number }) => i.paid)).toEqual([60000, 60000, 30000, 0]);
    const d = (await t.http().get('/v1/dashboard').set(auth(token)).query({ currency: 'COP' }).expect(200)).body;
    expect(d).toMatchObject({ collectedToday: 150_000, totalReceivable: 1_050_000 });
    // El libro no se puede editar ni borrar ni siquiera por SQL directo.
    await expect(adminQuery('UPDATE ledger_entries SET amount = 1 WHERE id = $1', [first.id])).rejects.toThrow(/inmutable/);
    expect(events.some((e) => e.type === 'payment.reversed')).toBe(true);
  });

  it('bloquea pagos inválidos y préstamos ya pagados', async () => {
    await t.http().post(`/v1/loans/${loanId}/payments`).set(auth(token)).send({ amount: 0, date: '2026-10-09' }).expect(422);
    const future = await t.http().post(`/v1/loans/${loanId}/payments`).set(auth(token)).send({ amount: 1000, date: '2026-10-10' }).expect(422);
    expect(future.body.code).toBe('PAYMENT_DATE_INVALID');
    const all = await t.http().post(`/v1/loans/${loanId}/payments`).set(auth(token)).send({ amount: 1_100_000, date: '2026-10-09' }).expect(201);
    expect(all.body).toMatchObject({ loanClosed: true, surplus: 50_000 });
    expect(all.body.receipt.newBalance).toBe(0);
    const paid = await t.http().post(`/v1/loans/${loanId}/payments`).set(auth(token)).send({ amount: 1000, date: '2026-10-09' }).expect(409);
    expect(paid.body.code).toBe('LOAN_ALREADY_PAID');
    const list = await t.http().get('/v1/clients').set(auth(token)).query({ status: 'closed' }).expect(200);
    expect(list.body.items.map((c: { id: string }) => c.id)).toEqual([clientId]);
  });
});

describe('Tope legal, clientes y duplicados (CA-12, §8)', () => {
  let t: T;
  let token: string;
  beforeAll(async () => {
    t = await bootApp('2026-10-08T15:00:00Z');
    token = (await ownerSession(t, (await newTenant()).slug)).token;
  });
  afterAll(async () => t.app.close());

  it('sin tasa de usura registrada no se crean préstamos en Colombia', async () => {
    const r = await t.http().post('/v1/clients').set(auth(token)).send({ client: client(), loan: { ...CA01_TERMS, rate: '0.01', installments: 12, frequency: 'monthly' } }).expect(422);
    expect(r.body.code).toBe('RATE_CAP_MISSING');
  });

  it('CA-12 una tasa por encima del tope no se guarda y se informa la tasa máxima', async () => {
    const cap = await registerRateCap(t.http, token, 0.2493);
    expectContract('addRateCap', 201, cap.body);
    await t.http().post('/v1/compliance/rate-caps').set(auth(token)).send({ country: 'CO', effectiveAnnual: 0.25, validFrom: '2026-11-01', validTo: '2027-01-31', source: 'Solapada' }).expect(409);
    const terms = { ...CA01_TERMS, method: 'french', rate: '0.025', installments: 12, frequency: 'monthly' };
    const pre = await t.http().post('/v1/loans/preview').set(auth(token)).send(terms).expect(200);
    expect(pre.body.rateCap).toMatchObject({ ok: false, cap: 0.2493, maxRate: '0.0187' });
    const r = await t.http().post('/v1/clients').set(auth(token)).send({ client: client(), loan: terms }).expect(422);
    expect(r.body).toMatchObject({ code: 'RATE_CAP_EXCEEDED', rateCap: { ok: false, maxRate: '0.0187' } });
    expect(r.body.detail).toContain('Tasa máxima permitida: 1,87');
    expect((await adminQuery('SELECT count(*)::int AS n FROM loans'))[0]).toBeDefined();
    const ok = await t.http().post('/v1/clients').set(auth(token)).send({ client: client(), loan: { ...terms, rate: '0.0187' } }).expect(201);
    expect(ok.body.loan.effectiveAnnualRate).toBeLessThanOrEqual(0.2493);
  });

  it('avisa de un cliente duplicado por número o documento antes de guardar', async () => {
    const terms = { ...CA01_TERMS, method: 'french', rate: '0.015', installments: 6, frequency: 'monthly' };
    const dup = await t.http().post('/v1/clients').set(auth(token)).send({ client: client({ firstName: 'Otra', lastName: 'Persona', phone: '3157778899' }), loan: terms }).expect(409);
    expect(dup.body).toMatchObject({ code: 'DUPLICATE_CLIENT', duplicateCode: 'C000001' });
    await t.http().post('/v1/clients').set(auth(token)).send({ client: client({ firstName: 'Otra', lastName: 'Persona', phone: '3157778899' }), loan: terms, acknowledgeDuplicate: true }).expect(201);
    const bad = await t.http().post('/v1/clients').set(auth(token)).send({ client: client({ phone: '123' }), loan: terms }).expect(422);
    expect(bad.body.errors[0].field).toBe('client.phone');
  });

  it('busca sin tildes por nombre, código, contrato o teléfono', async () => {
    for (const q of ['maria jose', 'PÉREZ', 'C000001', 'ct-000001', '7778899']) {
      const r = await t.http().get('/v1/clients').set(auth(token)).query({ q }).expect(200);
      expectContract('listClients', 200, r.body);
      expect(r.body.items.length, q).toBeGreaterThan(0);
    }
    const none = await t.http().get('/v1/clients').set(auth(token)).query({ q: 'zzzz' }).expect(200);
    expect(none.body.items).toEqual([]);
  });

  it('edita el cliente con concurrencia optimista y conserva el vínculo de su carpeta', async () => {
    const list = await t.http().get('/v1/clients').set(auth(token)).query({ q: 'maria' }).expect(200);
    const c = (await t.http().get(`/v1/clients/${list.body.items[0].id}`).set(auth(token)).expect(200)).body;
    expectContract('getClient', 200, c);
    const body = { firstName: 'María José', lastName: 'Pérez de Ríos', phone: c.phone, lang: 'pt-BR' };
    await t.http().patch(`/v1/clients/${c.id}`).set(auth(token)).set('If-Match', String(c.version + 5)).send(body).expect(409);
    const u = await t.http().patch(`/v1/clients/${c.id}`).set(auth(token)).set('If-Match', String(c.version)).send(body).expect(200);
    expect(u.body).toMatchObject({ folderName: `Maria Jose Perez de Rios - ${c.code}`, lang: 'pt-BR', version: c.version + 1 });
  });
});

describe('Roles y aislamiento (CA-16, CA-17)', () => {
  let t: T;
  let owner: string;
  let collector: string;
  let mine: { client: string; loan: string };
  let other: { client: string; loan: string };
  let tenantA: string;
  beforeAll(async () => {
    t = await bootApp('2026-10-08T15:00:00Z');
    const ten = await newTenant();
    tenantA = ten.tenantId;
    owner = (await ownerSession(t, ten.slug)).token;
    await registerRateCap(t.http, owner);
    const u = await t.http().post('/v1/users').set(auth(owner)).send({ username: 'cobrador1', name: 'Cobrador Uno', role: 'collector', password: 'Rutas-del-Norte-77' }).expect(201);
    const terms = { ...CA01_TERMS, method: 'french', rate: '0.015', installments: 6, frequency: 'monthly' };
    const a = await t.http().post('/v1/clients').set(auth(owner)).send({ client: client({ collectorId: u.body.id }), loan: terms }).expect(201);
    const b = await t.http().post('/v1/clients').set(auth(owner)).send({ client: client({ firstName: 'Carlos', lastName: 'Ruiz', phone: '3001112233' }), loan: terms }).expect(201);
    mine = { client: a.body.client.id, loan: a.body.loan.id };
    other = { client: b.body.client.id, loan: b.body.loan.id };
    const login = await t.http().post('/v1/auth/login').send({ tenant: ten.slug, username: 'cobrador1', password: 'Rutas-del-Norte-77', deviceId: 'celular-cobrador' }).expect(200);
    expect(login.body.mfaEnrollmentRequired).toBe(false);
    collector = login.body.accessToken;
  });
  afterAll(async () => t.app.close());

  it('CA-16 el Cobrador solo ve y cobra a sus clientes; el intento sobre otro queda en la bitácora', async () => {
    const list = await t.http().get('/v1/clients').set(auth(collector)).expect(200);
    expect(list.body.items.map((c: { id: string }) => c.id)).toEqual([mine.client]);
    await t.http().get(`/v1/clients/${mine.client}`).set(auth(collector)).expect(200);
    const denied = await t.http().get(`/v1/clients/${other.client}`).set(auth(collector)).expect(403);
    expect(denied.body).toMatchObject({ code: 'ACCESS_DENIED', title: 'Acceso denegado' });
    await t.http().get(`/v1/loans/${other.loan}/schedule`).set(auth(collector)).expect(403);
    await t.http().post(`/v1/loans/${other.loan}/payments`).set(auth(collector)).send({ amount: 1000, date: '2026-10-08' }).expect(403);
    const logged = await adminQuery<{ entity: string; entity_id: string }>("SELECT entity, entity_id FROM audit_log WHERE tenant_id = $1 AND action = 'access.denied' ORDER BY id", [tenantA]);
    expect(logged).toEqual([{ entity: 'client', entity_id: other.client }, { entity: 'loan', entity_id: other.loan }, { entity: 'loan', entity_id: other.loan }]);
    // Puede registrar pagos de sus clientes, pero no reversar ni crear clientes ni ver usuarios.
    const pay = await t.http().post(`/v1/loans/${mine.loan}/payments`).set(auth(collector)).send({ amount: 10_000, date: '2026-10-08', cash: true }).expect(201);
    await t.http().post(`/v1/loans/${mine.loan}/payments/${pay.body.entry.id}/reversal`).set(auth(collector)).send({ reason: 'Intento' }).expect(403);
    await t.http().post('/v1/loans/preview').set(auth(collector)).send(CA01_TERMS).expect(403);
    await t.http().get('/v1/users').set(auth(collector)).expect(403);
    const dash = await t.http().get('/v1/dashboard').set(auth(collector)).expect(200);
    expect(dash.body.clientsTotal).toBe(1);
  });

  it('CA-16 en la base: aunque la API se equivocara, RLS oculta al Cobrador los clientes ajenos', async () => {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try {
      await c.query('BEGIN');
      const u = await adminQuery<{ id: string }>("SELECT id FROM users WHERE tenant_id = $1 AND username = 'cobrador1'", [tenantA]);
      await c.query("SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)", [tenantA, u[0]!.id]);
      // Sin el rol de Cobrador la conexión de la API ve toda la empresa; con él, solo lo asignado.
      expect((await c.query('SELECT count(*)::int AS n FROM coroc.clients')).rows[0].n).toBe(2);
      await c.query('SET LOCAL ROLE coroc_collector');
      const seen = await c.query('SELECT id FROM coroc.clients');
      const loans = await c.query('SELECT id FROM coroc.loans');
      const inst = await c.query('SELECT DISTINCT loan_id FROM coroc.installments');
      expect(seen.rows.map((r) => r.id)).toEqual([mine.client]);
      expect(loans.rows.map((r) => r.id)).toEqual([mine.loan]);
      expect(inst.rows.map((r) => r.loan_id)).toEqual([mine.loan]);
      await c.query('ROLLBACK');
    } finally {
      await c.end();
    }
  });

  it('CA-17 la empresa B no puede leer ni tocar datos de la empresa A por la API', async () => {
    const b = await newTenant();
    const tokenB = (await ownerSession(t, b.slug)).token;
    const list = await t.http().get('/v1/clients').set(auth(tokenB)).expect(200);
    expect(list.body.items).toEqual([]);
    await t.http().get(`/v1/clients/${mine.client}`).set(auth(tokenB)).expect(404);
    await t.http().get(`/v1/loans/${mine.loan}`).set(auth(tokenB)).expect(404);
    await t.http().post(`/v1/loans/${mine.loan}/payments`).set(auth(tokenB)).send({ amount: 1000, date: '2026-10-08' }).expect(404);
    const d = await t.http().get('/v1/dashboard').set(auth(tokenB)).expect(200);
    expect(d.body).toMatchObject({ clientsTotal: 0, totalReceivable: 0 });
    // Un token alterado para apuntar a otra empresa no pasa la verificación de firma.
    const [h, p, s] = tokenB.split('.');
    const forged = JSON.parse(Buffer.from(p!, 'base64url').toString());
    forged.tid = tenantA;
    await t.http().get('/v1/clients').set(auth(`${h}.${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${s}`)).expect(401);
  });

  it('CA-14 los mensajes del servidor siguen el idioma elegido sin reiniciar', async () => {
    for (const [lang, title] of [['es', 'Sin permiso'], ['pt-BR', 'Sem permissão'], ['en', 'Not allowed']]) {
      await t.http().patch('/v1/me').set(auth(collector)).send({ lang }).expect(200);
      const r = await t.http().get('/v1/users').set(auth(collector)).set('Accept-Language', lang!).expect(403);
      expect(r.body.title).toBe(title);
    }
    const me = await t.http().get('/v1/me').set(auth(collector)).expect(200);
    expectContract('me', 200, me.body);
    expect(me.body.lang).toBe('en');
  });

  it('el Propietario gestiona usuarios y no puede quedarse sin Propietario', async () => {
    const users = (await t.http().get('/v1/users').set(auth(owner)).expect(200)).body;
    expectContract('listUsers', 200, users);
    const me = users.find((u: { role: string }) => u.role === 'owner');
    const r = await t.http().patch(`/v1/users/${me.id}`).set(auth(owner)).send({ active: false }).expect(409);
    expect(r.body.code).toBe('LAST_OWNER');
    const col = users.find((u: { role: string }) => u.role === 'collector');
    await t.http().delete(`/v1/users/${col.id}/sessions`).set(auth(owner)).expect(204);
    await t.http().get('/v1/me').set(auth(collector)).expect(401);
  });
});
