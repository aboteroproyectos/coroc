// Fixtures de la app a partir de la API real (pruebas de pantallas de apps/coroc_app).
// Requiere una API en marcha sobre una base preparada con `node scripts/dast.mjs prepare` (empresa «dast» recién
// creada). Crea datos de demostración, recorre todas las operaciones GET del contrato y guarda las respuestas tal cual
// en apps/coroc_app/test/fixtures/api.json: así las pruebas de la app leen exactamente lo que devuelve el servidor.
//   node scripts/app-fixtures.mjs
import fs from 'node:fs';
import YAML from 'yaml';
import { base32Decode, counterAt, hotp } from '../dist/auth/totp.js';

const API = process.env.DAST_API ?? 'http://localhost:3000/v1';
const OUT = new URL('../../../apps/coroc_app/test/fixtures/api.json', import.meta.url);
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

let token = null;
async function call(method, path, body, { raw = false, headers = {}, ok = [200, 201, 202, 204] } = {}) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { ...(raw ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Accept-Language': 'es', Accept: 'application/json', ...headers },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const text = await r.text();
  if (!ok.includes(r.status)) throw new Error(`${method} ${path} → ${r.status} ${text.slice(0, 300)}`);
  return { status: r.status, body: text ? JSON.parse(text) : null };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Propietario con segundo factor.
const login = (await call('POST', '/auth/login', { tenant: 'dast', username: 'propietario', password: 'Escaneo-Dinamico-2026', deviceId: 'fixtures-1' })).body;
token = login.accessToken;
const enroll = (await call('POST', '/me/mfa/enroll')).body;
const session = (await call('POST', '/me/mfa/confirm', { code: hotp(base32Decode(enroll.secret), counterAt(new Date())) })).body;
token = session.accessToken;

const out = { _: { generatedAt: new Date().toISOString(), note: 'Generado por services/api/scripts/app-fixtures.mjs; no editar a mano.' }, session, ids: {}, get: {}, post: {} };
const ids = out.ids;

// Datos de demostración.
ids.account = (await call('POST', '/receiving-accounts', { holderName: 'INVERSIONES COROC SAS', institution: 'Bancolombia', last4: '4455' })).body.id;
ids.collector = (await call('POST', '/users', { username: 'cobrador1', name: 'Carlos Cobrador', role: 'collector', password: 'Cobranza-Segura-2026', email: 'cobrador@example.com' })).body.id;
const consents = [{ channel: 'whatsapp', method: 'app' }, { channel: 'email', method: 'app' }, { channel: 'personal_data', method: 'app' }];
const loanTerms = { principal: 1_000_000, currency: 'USD', method: 'simple', rate: '0.20', installments: 10, frequency: 'weekly', disbursementDate: daysAgo(30) };
const a = (await call('POST', '/clients', { client: { firstName: 'María José', lastName: 'Pérez Gómez', phone: '+573157778899', email: 'maria.perez@example.com', lang: 'es', idDocType: 'CC', idDocNumber: '1020304050', address: 'Calle 10 # 20-30', city: 'Medellín', consents }, loan: loanTerms }, { headers: { 'Idempotency-Key': crypto.randomUUID() } })).body;
ids.client = a.client.id;
ids.loan = a.loan.id;
const b = (await call('POST', '/clients', { client: { firstName: 'Pedro Luis', lastName: 'Ramírez Ortiz', phone: '+573009998877', lang: 'es', idDocType: 'CC', idDocNumber: '9080706050', collectorId: ids.collector }, loan: { ...loanTerms, principal: 500_000, frequency: 'daily', installments: 20, disbursementDate: daysAgo(10) } }, { headers: { 'Idempotency-Key': crypto.randomUUID() } })).body;
ids.client2 = b.client.id;
ids.loan2 = b.loan.id;
out.post.createClient = a;

out.post.previewLoan = (await call('POST', '/loans/preview', loanTerms)).body;
out.post.previewPayment = (await call('POST', `/loans/${ids.loan}/payments/preview`, { amount: 150_000, date: daysAgo(1) })).body;
const pay = (await call('POST', `/loans/${ids.loan}/payments`, { amount: 150_000, date: daysAgo(2), method: 'Efectivo', cash: true }, { headers: { 'Idempotency-Key': crypto.randomUUID() } })).body;
out.post.pay = pay;
ids.entry = pay.entry.id;
const pay2 = (await call('POST', `/loans/${ids.loan}/payments`, { amount: 50_000, date: daysAgo(1), method: 'Transferencia', reference: 'ABC123' }, { headers: { 'Idempotency-Key': crypto.randomUUID() } })).body;
ids.entry2 = pay2.entry.id;
out.post.reversal = (await call('POST', `/loans/${ids.loan}/payments/${ids.entry2}/reversal`, { reason: 'Consignación rechazada por el banco' })).body;
ids.task = (await call('POST', `/loans/${ids.loan}/statements`)).body.id;
out.post.uploadLink = (await call('POST', `/loans/${ids.loan}/upload-link`)).body;
out.post.report = (await call('POST', '/reports', { type: 'portfolio', format: 'pdf', lang: 'es' })).body;
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
out.post.uploadIntake = (await call('POST', `/intake?channel=upload&clientId=${ids.client}&fileName=comprobante.pdf`, pdf, { raw: true, headers: { 'Content-Type': 'application/octet-stream' } })).body;
ids.intake = out.post.uploadIntake.id;
out.post.composeMessage = (await call('POST', '/messages', { loanId: ids.loan, event: 'manual', channel: 'email', body: 'Hola María José, le escribimos por su préstamo.' })).body;
ids.message = out.post.composeMessage.id;
out.post.previewTemplate = (await call('POST', '/message-templates/preview', { event: 'reminder', lang: 'es', loanId: ids.loan })).body;
out.post.createBackup = (await call('POST', '/backups', { password: 'Respaldo-Seguro-2026' })).body;
ids.backup = out.post.createBackup.id;

// Las tareas de documentos (plan, recibos, estado de cuenta, informe, respaldo) terminan en segundo plano.
for (let i = 0; i < 60; i++) {
  const t = (await call('GET', `/tasks/${ids.task}`)).body;
  const bk = (await call('GET', `/backups/${ids.backup}`)).body;
  if (t.status !== 'pending' && t.status !== 'running' && bk.status !== 'pending' && bk.status !== 'running') break;
  await sleep(1000);
}
await sleep(2000);
const docs = (await call('GET', `/documents?clientId=${ids.client}`)).body;
ids.document = docs.items[0]?.id;

// Todas las lecturas del contrato, con los identificadores de los datos de demostración.
const doc = YAML.parse(fs.readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8'));
const byArea = { clients: ids.client, loans: ids.loan, documents: ids.document, tasks: ids.task, intake: ids.intake, messages: ids.message, users: ids.collector, backups: ids.backup, 'receiving-accounts': ids.account };
for (const [path, item] of Object.entries(doc.paths)) {
  if (!item.get || item.get.security?.length === 0 && path.startsWith('/public/upload')) continue;
  if (path === '/events' || path.startsWith('/webhooks') || path.startsWith('/files/')) continue;
  const url = path
    .replace('{event}', 'reminder')
    .replace('{lang}', 'es')
    .replace('{code}', '0000000000000000')
    .replace(/\{\w+\}/g, () => byArea[path.split('/')[1]] ?? crypto.randomUUID());
  const r = await call('GET', url, undefined, { ok: [200, 404] });
  if (r.status === 200) out.get[url] = r.body;
}
out.get[`/documents?clientId=${ids.client}`] = docs;
// Los tokens de la sesión de prueba no se guardan: la app no los interpreta y un JWT en el repositorio confunde a los escáneres.
const scrub = (_, v) => (typeof v === 'string' && /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(v) ? 'token-de-prueba' : v);
const clean = JSON.parse(JSON.stringify(out, scrub));
for (const s of [clean.session, clean.post.session].filter(Boolean)) s.refreshToken &&= 'rt1.refresco-de-prueba';
fs.writeFileSync(OUT, `${JSON.stringify(clean, null, 1)}\n`);
process.stdout.write(`Fixtures: ${Object.keys(out.get).length} lecturas, ${Object.keys(out.post).length} escrituras → ${OUT.pathname}\n`);
