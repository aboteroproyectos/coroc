// Uso: npm install && node rls-test.mjs ../schema.sql   (PostgreSQL no se ejecuta como root)
// Valida schema.sql en PostgreSQL 16 real: RLS entre empresas (CA-17), inmutabilidad del libro,
// antiduplicado a nivel de base (CA-07), consecutivos y exclusión de vigencias del tope de tasa.
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const pgDir = process.env.PGDATA_DIR || path.join(os.tmpdir(), 'coroc-pg16-test');
fs.rmSync(pgDir, { recursive: true, force: true });
const db = new EmbeddedPostgres({ databaseDir: pgDir, user: 'postgres', password: 'postgres', port: 5439, persistent: false });
await db.initialise();
await db.start();
await db.createDatabase('coroc');
const results = [];
const ok = (name, pass, detail = '') => results.push({ name, pass, detail: String(detail).slice(0, 140) });
const admin = new pg.Client({ host: 'localhost', port: 5439, user: 'postgres', password: 'postgres', database: 'coroc' });
await admin.connect();
try {
  await admin.query(fs.readFileSync(process.argv[2], 'utf8'));
  ok('schema.sql se aplica sin errores', true);
  await admin.query(`SET search_path = coroc, public; CREATE ROLE app_login LOGIN PASSWORD 'app' IN ROLE coroc_app;`);
  const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222';
  await admin.query(`SET search_path = coroc, public;
    INSERT INTO tenants (id, name, country, currency) VALUES ('${A}', 'Empresa A', 'CO', 'COP'), ('${B}', 'Empresa B', 'BR', 'BRL');
    INSERT INTO number_sequences VALUES ('${A}', 'contract', 'CT-', 0), ('${A}', 'client', 'C', 0), ('${B}', 'contract', 'CT-', 0);`);
  const app = new pg.Client({ host: 'localhost', port: 5439, user: 'app_login', password: 'app', database: 'coroc' });
  await app.connect();
  const q = (sql, params) => app.query(sql, params);
  const asTenant = async (t, fn) => { await q('BEGIN'); await q(`SELECT set_config('app.tenant_id', $1, true)`, [t]); try { const r = await fn(); await q('COMMIT'); return r; } catch (e) { await q('ROLLBACK'); throw e; } };
  await q('SET search_path = coroc, public');
  // Datos por empresa
  const ids = {};
  for (const [t, name] of [[A, 'María'], [B, 'João']]) {
    await asTenant(t, async () => {
      const c = await q(`INSERT INTO clients (tenant_id, code, first_name, last_name, phone_e164, folder_name) VALUES ($1, next_number($1, $2), $3, 'Prueba', '+573001234567', 'x') RETURNING id, code`, [t, t === A ? 'client' : 'contract', name]);
      const contract = (await q(`SELECT next_number($1, 'contract') AS n`, [t])).rows[0].n;
      const l = await q(`INSERT INTO loans (tenant_id, client_id, contract, currency, principal, method, rate, installments_count, frequency, disbursement_date, first_due_date, total_payable, effective_annual_rate)
                         VALUES ($1, $2, $3, 'COP', 1000000, 'simple', 0.02, 20, 'daily', '2026-10-08', '2026-10-09', 1020000, 0.24) RETURNING id`, [t, c.rows[0].id, contract]);
      ids[t] = { client: c.rows[0].id, code: c.rows[0].code, contract, loan: l.rows[0].id };
    });
  }
  ok('Consecutivos por empresa (next_number)', ids[A].contract === 'CT-000001' && ids[A].code === 'C000001', `${ids[A].code} ${ids[A].contract}`);
  // CA-17: aislamiento
  const seenA = await asTenant(A, () => q('SELECT first_name FROM clients'));
  ok('CA-17 Empresa A solo ve sus clientes', seenA.rows.length === 1 && seenA.rows[0].first_name === 'María', JSON.stringify(seenA.rows));
  const seenB = await asTenant(B, () => q('SELECT first_name FROM clients'));
  ok('CA-17 Empresa B solo ve sus clientes', seenB.rows.length === 1 && seenB.rows[0].first_name === 'João', JSON.stringify(seenB.rows));
  const none = await q('SELECT count(*)::int AS n FROM clients');
  ok('Sin empresa en la sesión no se ve nada', none.rows[0].n === 0, none.rows[0].n);
  try { await asTenant(A, () => q(`INSERT INTO clients (tenant_id, code, first_name, last_name, phone_e164, folder_name) VALUES ($1, 'X1', 'Intruso', 'X', '+573001234567', 'x')`, [B])); ok('CA-17 A no puede escribir en B', false); }
  catch (e) { ok('CA-17 A no puede escribir en B', /row-level security/.test(e.message), e.message); }
  const upd = await asTenant(A, () => q(`UPDATE clients SET notes = 'hack' WHERE id = $1`, [ids[B].client]));
  ok('CA-17 A no puede modificar filas de B', upd.rowCount === 0, `rowCount=${upd.rowCount}`);
  // Libro inmutable
  const pay = await asTenant(A, () => q(`INSERT INTO ledger_entries (tenant_id, loan_id, type, entry_date, amount, source) VALUES ($1, $2, 'payment', '2026-10-09', 60000, 'manual') RETURNING id`, [A, ids[A].loan]));
  try { await asTenant(A, () => q(`UPDATE ledger_entries SET amount = 1 WHERE id = $1`, [pay.rows[0].id])); ok('Libro inmutable (UPDATE)', false); }
  catch (e) { ok('Libro inmutable (UPDATE)', /inmutable/.test(e.message), e.message); }
  try { await asTenant(A, () => q(`DELETE FROM ledger_entries WHERE id = $1`, [pay.rows[0].id])); ok('Libro inmutable (DELETE)', false); }
  catch (e) { ok('Libro inmutable (DELETE)', /permission denied|inmutable/.test(e.message), e.message); }
  try { await asTenant(A, () => q(`INSERT INTO ledger_entries (tenant_id, loan_id, type, entry_date, amount, source, reverses_id) VALUES ($1, $2, 'reversal', '2026-10-09', 60000, 'manual', $3)`, [A, ids[A].loan, pay.rows[0].id])); ok('Reverso exige motivo', false); }
  catch (e) { ok('Reverso exige motivo', /check constraint/.test(e.message), e.message); }
  await asTenant(A, () => q(`INSERT INTO ledger_entries (tenant_id, loan_id, type, entry_date, amount, source, reverses_id, reason) VALUES ($1, $2, 'reversal', '2026-10-09', 60000, 'manual', $3, 'Error de digitación')`, [A, ids[A].loan, pay.rows[0].id]));
  try { await asTenant(A, () => q(`INSERT INTO ledger_entries (tenant_id, loan_id, type, entry_date, amount, source, reverses_id, reason) VALUES ($1, $2, 'reversal', '2026-10-09', 60000, 'manual', $3, 'Otra vez')`, [A, ids[A].loan, pay.rows[0].id])); ok('Un pago solo se reversa una vez', false); }
  catch (e) { ok('Un pago solo se reversa una vez', /duplicate key/.test(e.message), e.message); }
  await asTenant(A, () => q(`INSERT INTO ledger_entries (tenant_id, loan_id, type, entry_date, amount, source) VALUES ($1, $2, 'payment', '2026-10-10', 150000, 'inbox')`, [A, ids[A].loan]));
  const bal = await asTenant(A, () => q(`SELECT paid_total::bigint AS p, balance::bigint AS b FROM loan_balances WHERE loan_id = $1`, [ids[A].loan]));
  ok('Saldo derivado del libro (vista con RLS)', Number(bal.rows[0].p) === 150000 && Number(bal.rows[0].b) === 870000, JSON.stringify(bal.rows[0]));
  const balB = await asTenant(B, () => q(`SELECT count(*)::int AS n FROM loan_balances WHERE loan_id = $1`, [ids[A].loan]));
  ok('La vista de saldos respeta RLS', balB.rows[0].n === 0, balB.rows[0].n);
  // CA-07 antiduplicado en base
  const ins = (st) => asTenant(A, () => q(`INSERT INTO intake_events (tenant_id, channel, file_sha256, status, logical_key) VALUES ($1, 'whatsapp', $2, $3, 'ref|m1234567|60000|2026-10-09|nequi')`, [A, 'a'.repeat(63) + Math.floor(Math.random() * 9), st]));
  await ins('applied_auto');
  try { await ins('approved'); ok('CA-07 comprobante no se aplica dos veces (índice único)', false); }
  catch (e) { ok('CA-07 comprobante no se aplica dos veces (índice único)', /duplicate key/.test(e.message), e.message); }
  await ins('duplicate');
  ok('Un duplicado puede registrarse como evento no aplicado', true);
  // Tope de tasa sin vigencias solapadas
  await asTenant(A, () => q(`INSERT INTO rate_caps (tenant_id, country, effective_annual, valid_from, valid_to, source) VALUES ($1, 'CO', 0.25, '2026-10-01', '2026-10-31', 'Resolución de prueba')`, [A]));
  try { await asTenant(A, () => q(`INSERT INTO rate_caps (tenant_id, country, effective_annual, valid_from, valid_to, source) VALUES ($1, 'CO', 0.26, '2026-10-15', '2026-11-15', 'Solapada')`, [A])); ok('Topes de tasa sin vigencias solapadas', false); }
  catch (e) { ok('Topes de tasa sin vigencias solapadas', /conflicting key|exclusion/.test(e.message), e.message); }
  // Integridad de cuotas
  try { await asTenant(A, () => q(`INSERT INTO installments (tenant_id, loan_id, number, due_date, amount, principal, interest, balance_after) VALUES ($1, $2, 1, '2026-10-09', 60000, 50000, 5000, 1140000)`, [A, ids[A].loan])); ok('Capital + interés = cuota', false); }
  catch (e) { ok('Capital + interés = cuota', /check constraint/.test(e.message), e.message); }
  // Bitácora inmutable
  await asTenant(A, () => q(`INSERT INTO audit_log (tenant_id, action, entity, entity_id) VALUES ($1, 'test', 'loan', 'x')`, [A]));
  try { await asTenant(A, () => q(`UPDATE audit_log SET action = 'x'`)); ok('Bitácora inmutable', false); }
  catch (e) { ok('Bitácora inmutable', /inmutable/.test(e.message), e.message); }
  await app.end();
} catch (e) {
  ok('ERROR INESPERADO', false, e.stack);
} finally {
  await admin.end();
  await db.stop();
}
const version = 'PostgreSQL 16';
console.log(JSON.stringify({ version, passed: results.filter((r) => r.pass).length, total: results.length, results }, null, 1));
fs.writeFileSync(new URL('./resultado-postgres16.json', import.meta.url), JSON.stringify(results, null, 1));
process.exit(results.every((r) => r.pass) ? 0 : 1);
