// Prepara una base de datos PostgreSQL 16 nueva para cada ejecución de las pruebas:
// aplica las migraciones con el rol dueño y crea el rol de la API (sin BYPASSRLS), igual que en producción.
// Requiere TEST_DATABASE_URL con un usuario que pueda crear bases y roles (en CI, el servicio postgres:16).
import crypto from 'node:crypto';
import pg from 'pg';
import { migrate } from '../src/db/migrate.js';

export default async function setup() {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) throw new Error('Defina TEST_DATABASE_URL, p. ej. postgres://postgres@127.0.0.1:5432/postgres');
  const dbName = `coroc_test_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  const password = crypto.randomBytes(18).toString('base64url');
  await admin.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'coroc_api') THEN CREATE ROLE coroc_api LOGIN NOBYPASSRLS; END IF;
    END $$`);
  await admin.query(`ALTER ROLE coroc_api WITH LOGIN NOBYPASSRLS PASSWORD '${password}'`);
  await admin.end();

  const u = new URL(base);
  u.pathname = `/${dbName}`;
  const adminUrl = u.toString();
  await migrate(adminUrl);
  const c = new pg.Client({ connectionString: adminUrl });
  await c.connect();
  await c.query('GRANT coroc_app TO coroc_api');
  // Sin herencia: las políticas del Cobrador solo aplican tras SET ROLE, no a las demás sesiones de la API.
  await c.query('GRANT coroc_collector TO coroc_api WITH INHERIT FALSE, SET TRUE');
  await c.query(`GRANT CONNECT ON DATABASE ${dbName} TO coroc_api`);
  await c.end();

  const app = new URL(adminUrl);
  app.username = 'coroc_api';
  app.password = password;
  Object.assign(process.env, {
    DATABASE_URL: app.toString(),
    DATABASE_ADMIN_URL: adminUrl,
    COROC_JWT_SECRET: crypto.randomBytes(48).toString('base64url'),
    COROC_DATA_KEY: crypto.randomBytes(32).toString('base64'),
    COROC_BREACHED_CHECK: 'local',
    COROC_JOBS: 'off',
    COROC_PUBLIC_URL: 'https://app.coroc.test',
  });

  return async () => {
    const a = new pg.Client({ connectionString: base });
    await a.connect();
    await a.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`, [dbName]);
    await a.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await a.end();
  };
}
