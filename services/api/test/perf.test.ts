// Rendimiento y carga (§21): 100.000 clientes y 2.000.000 de cuotas en una empresa; dashboard < 1,5 s, búsqueda de
// clientes < 300 ms (percentil 95, también con peticiones concurrentes) y una carga mixta sin errores.
// Se ejecuta con PERF=1 (en CI, en su propio trabajo): PERF=1 npx vitest run test/perf.test.ts. Con PERF_REPORT=<archivo>
// escribe los tiempos medidos en JSON.
import fs from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LoanStateService } from '../src/loans/loan-state.service.js';
import { auth, bootApp, newTenant, ownerSession } from './helpers.js';

const CLIENTS = Number(process.env.PERF_CLIENTS ?? 100_000);
const INSTALLMENTS = Math.round(2_000_000 / CLIENTS);

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!);
};

describe.runIf(process.env.PERF === '1')(`Rendimiento con ${CLIENTS.toLocaleString('es-CO')} clientes`, () => {
  let t: Awaited<ReturnType<typeof bootApp>>;
  let token: string;
  const timings: Record<string, number | string> = { clients: CLIENTS, installments: CLIENTS * INSTALLMENTS };

  beforeAll(async () => {
    t = await bootApp('2026-10-09T15:00:00Z');
    const ten = await newTenant();
    token = (await ownerSession(t, ten.slug)).token;
    const c = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
    await c.connect();
    const t0 = Date.now();
    await c.query('SET search_path = coroc, public');
    await c.query("SELECT set_config('app.tenant_id', $1, false)", [ten.tenantId]);
    await c.query(
      `INSERT INTO clients (tenant_id, code, first_name, last_name, phone_e164, lang, folder_name, country)
       SELECT $1, 'C' || lpad(g::text, 6, '0'),
              (ARRAY['María','José','Luis','Ana','Carlos','Paula','Juan','Diana','Andrés','Camila'])[1 + g % 10],
              (ARRAY['Pérez','Gómez','Rodríguez','López','Martínez','García','Ramírez','Torres','Díaz','Vargas'])[1 + (g / 10) % 10] || ' ' || g,
              '+57300' || lpad(g::text, 7, '0'), 'es', 'Cliente ' || g, 'CO'
         FROM generate_series(1, $2) g`,
      [ten.tenantId, CLIENTS],
    );
    await c.query(
      `INSERT INTO loans (tenant_id, client_id, contract, currency, principal, method, rate, installments_count, frequency, disbursement_date,
                          first_due_date, total_payable, effective_annual_rate)
       SELECT $1, c.id, 'CT-' || substr(c.code, 2), 'COP', 1000000, 'simple', 0.2, $2, 'daily',
              date '2026-10-09' - (row_number() OVER () % 45)::int, date '2026-10-10' - (row_number() OVER () % 45)::int, 1200000, 0.2
         FROM clients c WHERE c.tenant_id = $1`,
      [ten.tenantId, INSTALLMENTS],
    );
    await c.query(
      `INSERT INTO installments (tenant_id, loan_id, number, due_date, amount, principal, interest, balance_after)
       SELECT $1, l.id, n, l.first_due_date + (n - 1), 30000, 25000, 5000, 1200000 - 30000 * n
         FROM loans l, generate_series(1, $2) n WHERE l.tenant_id = $1`,
      [ten.tenantId, INSTALLMENTS],
    );
    await c.query(
      `INSERT INTO ledger_entries (tenant_id, loan_id, type, entry_date, amount, source)
       SELECT $1, l.id, 'payment', least(date '2026-10-09', l.first_due_date + k), 30000, 'manual'
         FROM loans l, generate_series(0, 25) k
        WHERE l.tenant_id = $1 AND l.first_due_date + k <= date '2026-10-09' AND (hashtext(l.id::text) + k) % 7 <> 0`,
      [ten.tenantId],
    );
    await c.query(
      `INSERT INTO daily_collections (tenant_id, currency, day, amount, payments)
       SELECT $1, 'COP', e.entry_date, sum(e.amount), count(*) FROM ledger_entries e WHERE e.tenant_id = $1 AND e.type = 'payment' GROUP BY e.entry_date`,
      [ten.tenantId],
    );
    // Estado de un día anterior para todos: el trabajo de la hora debe ponerlos al día.
    await c.query(
      `INSERT INTO loan_state (loan_id, tenant_id, client_id, currency, as_of, total_payable, paid_total, balance, late_fees_outstanding, surplus,
                               paid_installments, remaining_installments, overdue_count, overdue_amount, days_past_due, due_today_amount, bucket)
       SELECT l.id, $1, l.client_id, 'COP', date '2000-01-01', 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 'current' FROM loans l WHERE l.tenant_id = $1`,
      [ten.tenantId],
    );
    await c.query('ANALYZE');
    timings.seedMs = Date.now() - t0;
    await c.end();
    const t1 = Date.now();
    const n = await t.app.get(LoanStateService).refreshStale({ tenantId: ten.tenantId }, '2026-10-09');
    timings.nightlyRecomputeMs = Date.now() - t1;
    timings.loansRecomputed = n;
    // Como tras la carga nocturna en producción: sin autovacuum ni checkpoints compitiendo con las mediciones.
    const m = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
    await m.connect();
    await m.query('VACUUM (ANALYZE)');
    await m.query('CHECKPOINT');
    await m.end();
  }, 1_800_000);

  afterAll(async () => {
    const report = JSON.stringify(timings, null, 1);
    process.stdout.write(`\nRendimiento (§21):\n${report}\n`);
    if (process.env.PERF_REPORT) fs.writeFileSync(process.env.PERF_REPORT, report);
    await t.app.close();
  });

  /** `total` peticiones con `concurrency` a la vez; devuelve las duraciones en ms. Falla si alguna no responde 200. */
  const load = async (total: number, concurrency: number, make: (i: number) => Promise<unknown>) => {
    const out: number[] = [];
    let next = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (next < total) {
        const i = next++;
        const s = performance.now();
        await make(i);
        out.push(performance.now() - s);
      }
    }));
    return out;
  };

  const time = async (name: string, fn: () => Promise<unknown>, runs = 5) => {
    await fn();
    const samples: number[] = [];
    for (let i = 0; i < runs; i++) {
      const s = performance.now();
      await fn();
      samples.push(performance.now() - s);
    }
    samples.sort((a, b) => a - b);
    timings[name] = Math.round(samples[Math.floor(samples.length / 2)]!);
    return timings[name] as number;
  };

  it('dashboard en menos de 1,5 s', async () => {
    const ms = await time('dashboardMs', async () => {
      const r = await t.http().get('/v1/dashboard').set(auth(token)).expect(200);
      expect(r.body.clientsTotal).toBe(CLIENTS);
    });
    expect(ms).toBeLessThan(1500);
  });

  it('búsqueda de clientes en menos de 300 ms', async () => {
    for (const q of ['camila', 'vargas 4', '3000012345', 'CT-004321']) {
      const ms = await time(`search:${q}`, async () => {
        const r = await t.http().get('/v1/clients').set(auth(token)).query({ q, limit: 50 }).expect(200);
        expect(r.body.items.length).toBeGreaterThan(0);
      });
      expect(ms, q).toBeLessThan(300);
    }
  });

  it('lista paginada y cobros de hoy', async () => {
    await time('clientsFirstPageMs', () => t.http().get('/v1/clients').set(auth(token)).query({ limit: 50 }).expect(200));
    await time('todayCollectionsMs', () => t.http().get('/v1/collections/today').set(auth(token)).expect(200));
    expect(timings.clientsFirstPageMs).toBeLessThan(1500);
  });

  it('con 10 usuarios a la vez: búsqueda p95 < 300 ms y dashboard p95 < 1,5 s', async () => {
    const terms = ['camila', 'vargas 4', '3000012345', 'CT-004321', 'díaz', 'andrés 12', 'C000777', 'paula torres'];
    // Una pasada de calentamiento (planes y caché de la base), como en un servidor que ya está atendiendo.
    for (const q of terms) await t.http().get('/v1/clients').set(auth(token)).query({ q, limit: 50 }).expect(200);
    const search = await load(80, 10, (i) => t.http().get('/v1/clients').set(auth(token)).query({ q: terms[i % terms.length], limit: 50 }).expect(200));
    timings.searchP95Concurrent = pct(search, 95);
    const dash = await load(30, 10, () => t.http().get('/v1/dashboard').set(auth(token)).expect(200));
    timings.dashboardP95Concurrent = pct(dash, 95);
    expect(timings.searchP95Concurrent).toBeLessThan(300);
    expect(timings.dashboardP95Concurrent).toBeLessThan(1500);
  });

  // El servidor y el cliente de prueba comparten un solo proceso de Node; en producción el balanceador reparte entre
  // réplicas. Por eso el umbral de la carga mixta es holgado: lo que se exige aquí es que no haya errores ni colapsos.
  it('carga mixta de 300 peticiones con 25 a la vez: sin errores y p95 < 3 s', async () => {
    const first = (await t.http().get('/v1/clients').set(auth(token)).query({ limit: 50 }).expect(200)).body.items as { id: string }[];
    const mix = [
      () => t.http().get('/v1/dashboard').set(auth(token)).expect(200),
      () => t.http().get('/v1/clients').set(auth(token)).query({ q: 'maría', limit: 50 }).expect(200),
      () => t.http().get('/v1/clients').set(auth(token)).query({ status: 'overdue', limit: 50 }).expect(200),
      () => t.http().get(`/v1/clients/${first[Math.floor(Math.random() * first.length)]!.id}`).set(auth(token)).expect(200),
      () => t.http().get('/v1/collections/today').set(auth(token)).query({ limit: 200 }).expect(200),
      () => t.http().get('/v1/intake/summary').set(auth(token)).expect(200),
      () => t.http().get('/v1/messages/summary').set(auth(token)).expect(200),
    ];
    const started = performance.now();
    const all = await load(300, 25, (i) => mix[i % mix.length]!());
    timings.mixedRequests = all.length;
    timings.mixedP50 = pct(all, 50);
    timings.mixedP95 = pct(all, 95);
    timings.mixedThroughputRps = Math.round((all.length / (performance.now() - started)) * 1000);
    expect(all).toHaveLength(300);
    expect(timings.mixedP95).toBeLessThan(3000);
  });
});
