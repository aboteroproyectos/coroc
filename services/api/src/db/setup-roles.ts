// Entorno local y de pruebas: crea el usuario de la API y le da los permisos correctos.
// En producción los roles los crea el administrador de la base con db/roles.sql.
import pg from 'pg';

const admin = process.env.DATABASE_ADMIN_URL;
const password = process.env.COROC_API_DB_PASSWORD;
if (!admin || !password) {
  console.error('Defina DATABASE_ADMIN_URL y COROC_API_DB_PASSWORD.');
  process.exit(1);
}
const c = new pg.Client({ connectionString: admin });
await c.connect();
await c.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'coroc_api') THEN CREATE ROLE coroc_api LOGIN NOBYPASSRLS; END IF; END $$`);
await c.query(`ALTER ROLE coroc_api WITH LOGIN NOBYPASSRLS PASSWORD ${c.escapeLiteral(password)}`);
await c.query('GRANT coroc_app TO coroc_api');
// Sin herencia: las políticas del Cobrador solo se aplican cuando la API asume ese rol (ADR-022).
await c.query('GRANT coroc_collector TO coroc_api WITH INHERIT FALSE, SET TRUE');
await c.end();
console.log('Usuario coroc_api listo');
