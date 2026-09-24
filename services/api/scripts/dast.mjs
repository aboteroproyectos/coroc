// Preparación del escaneo dinámico (DAST) con OWASP ZAP (Fase 5, §20).
//   node scripts/dast.mjs prepare  → base nueva con migraciones, rol de la API sin BYPASSRLS y una empresa de prueba;
//                                    imprime las variables de entorno para arrancar la API (formato KEY=valor).
//   node scripts/dast.mjs token    → ingresa como Propietario, activa el segundo factor y deja datos de ejemplo;
//                                    imprime DAST_TOKEN=<token de acceso> para que ZAP recorra la API con sesión.
//   node scripts/dast.mjs contract <salida> → copia del contrato para ZAP, con la API local y sin las operaciones que
//                                    cerrarían la sesión del escáner o la empresa (ZAP las llama al importar el contrato,
//                                    antes de aplicar sus exclusiones).
// Requiere `npm run build` (usa dist/) y, para prepare, DAST_DATABASE_URL con un usuario que cree bases y roles.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import YAML from 'yaml';
import { base32Decode, counterAt, hotp } from '../dist/auth/totp.js';
import { createTenant } from '../dist/cli/tenant-create.js';
import { migrate } from '../dist/db/migrate.js';

const SLUG = 'dast';
const PASSWORD = 'Escaneo-Dinamico-2026';
const cmd = process.argv[2];

if (cmd === 'prepare') {
  const base = process.env.DAST_DATABASE_URL;
  if (!base) throw new Error('Defina DAST_DATABASE_URL');
  const db = `coroc_dast_${crypto.randomBytes(3).toString('hex')}`;
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${db}`);
  const password = crypto.randomBytes(18).toString('base64url');
  await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'coroc_api') THEN CREATE ROLE coroc_api LOGIN NOBYPASSRLS; END IF; END $$`);
  await admin.query(`ALTER ROLE coroc_api WITH LOGIN NOBYPASSRLS PASSWORD '${password}'`);
  await admin.end();
  const adminUrl = new URL(base);
  adminUrl.pathname = `/${db}`;
  await migrate(adminUrl.toString());
  const c = new pg.Client({ connectionString: adminUrl.toString() });
  await c.connect();
  await c.query('GRANT coroc_app TO coroc_api');
  await c.query('GRANT coroc_collector TO coroc_api WITH INHERIT FALSE, SET TRUE');
  await c.query(`GRANT CONNECT ON DATABASE ${db} TO coroc_api`);
  await c.end();
  await createTenant(adminUrl.toString(), { slug: SLUG, name: 'Empresa DAST', country: 'US', lang: 'es', owner: 'propietario', ownerName: 'Propietario DAST', email: 'dast@example.com', password: PASSWORD });
  const app = new URL(adminUrl);
  app.username = 'coroc_api';
  app.password = password;
  const env = {
    DATABASE_URL: app.toString(),
    COROC_JWT_SECRET: crypto.randomBytes(48).toString('base64url'),
    COROC_DATA_KEY: crypto.randomBytes(32).toString('base64'),
    COROC_BREACHED_CHECK: 'local',
    COROC_ACCESS_TTL: '7200',
    COROC_STORAGE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'coroc-dast-')),
    COROC_EMAIL_PROVIDER: 'memory',
    COROC_API_PUBLIC_URL: 'http://localhost:3000',
    COROC_PUBLIC_URL: 'http://localhost:3000',
    COROC_CORS_ORIGINS: 'https://app.coroc.test',
  };
  for (const [k, v] of Object.entries(env)) process.stdout.write(`${k}=${v}\n`);
} else if (cmd === 'token') {
  const api = process.env.DAST_API ?? 'http://localhost:3000/v1';
  const call = async (method, p, body, token) => {
    const r = await fetch(`${api}${p}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${await r.text()}`);
    return r.status === 204 ? null : r.json();
  };
  const login = await call('POST', '/auth/login', { tenant: SLUG, username: 'propietario', password: PASSWORD, deviceId: 'zap-dast' });
  const enroll = await call('POST', '/me/mfa/enroll', undefined, login.accessToken);
  const ok = await call('POST', '/me/mfa/confirm', { code: hotp(base32Decode(enroll.secret), counterAt(new Date())) }, login.accessToken);
  const token = ok.accessToken;
  // Datos de ejemplo para que el escaneo alcance respuestas reales y no solo 404.
  await call('POST', '/receiving-accounts', { holderName: 'EMPRESA DAST', institution: 'Banco', last4: '9876' }, token);
  await call('POST', '/clients', { client: { firstName: 'Ana', lastName: 'Escaneo', phone: '+573001112233', lang: 'es', idDocType: 'CC', idDocNumber: '123456789' }, loan: { principal: 1_000_000, currency: 'USD', method: 'simple', rate: '0.20', installments: 10, frequency: 'weekly', disbursementDate: new Date().toISOString().slice(0, 10) } }, token);
  process.stdout.write(`DAST_TOKEN=${token}\n`);
} else if (cmd === 'contract') {
  const out = process.argv[3];
  if (!out) throw new Error('Uso: node scripts/dast.mjs contract <salida.yaml>');
  const doc = YAML.parse(fs.readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8'));
  doc.servers = [{ url: process.env.DAST_API ?? 'http://localhost:3000/v1' }];
  const skip = [
    ['/auth/logout', 'post'], ['/me', 'delete'], ['/me/password', 'post'], ['/me/mfa', 'delete'], ['/me/mfa/enroll', 'post'], ['/me/mfa/confirm', 'post'],
    ['/me/sessions/{id}', 'delete'], ['/users/{id}', 'delete'], ['/users/{id}/sessions', 'delete'], ['/company/closure', 'post'],
    ['/restores', 'post'], ['/restores/{id}/verify', 'post'], ['/restores/{id}/apply', 'post'],
  ];
  for (const [path, method] of skip) {
    if (doc.paths[path]) delete doc.paths[path][method];
    if (doc.paths[path] && !Object.keys(doc.paths[path]).some((k) => ['get', 'post', 'put', 'patch', 'delete'].includes(k))) delete doc.paths[path];
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, YAML.stringify(doc));
  process.stdout.write(`Contrato para ZAP: ${Object.keys(doc.paths).length} rutas\n`);
} else {
  process.stderr.write('Uso: node scripts/dast.mjs prepare|token|contract\n');
  process.exit(2);
}
