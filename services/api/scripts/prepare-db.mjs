// Preparación única de una base PostgreSQL 16 gestionada para producción (Fly.io u otro proveedor; ADR-060).
// Se ejecuta una sola vez con el superusuario (o el administrador) que entrega el proveedor:
//
//   npm run build -w @coroc/api
//   DATABASE_SUPERUSER_URL=postgres://postgres:…@localhost:5432/coroc [COROC_DB_HOST=coroc-db.flycast:5432] node scripts/prepare-db.mjs [--check]
//
// 1. Verifica PostgreSQL ≥ 16, las extensiones y que se puedan crear roles con BYPASSRLS (la RLS es forzada incluso
//    para el dueño de las tablas, así que el dueño la necesita para las funciones SECURITY DEFINER).
// 2. Crea las extensiones y los roles: coroc_owner (dueño, aplica migraciones), coroc_app y coroc_collector (permisos,
//    sin BYPASSRLS) y coroc_api (con el que se conecta la API, sin BYPASSRLS). Las contraseñas son nuevas y aleatorias.
// 3. Aplica las migraciones como coroc_owner y da a coroc_api sus permisos (ADR-022).
// 4. Muestra DATABASE_ADMIN_URL y DATABASE_URL para guardarlas como secretos; no se escriben en ningún archivo.
//
// Con --check solo verifica. Si los roles ya existen no cambia sus contraseñas: vuelva a usar los secretos guardados.
import crypto from 'node:crypto';
import pg from 'pg';
import { migrate } from '../dist/db/migrate.js';

const url = process.env.DATABASE_SUPERUSER_URL;
const checkOnly = process.argv.includes('--check');
if (!url) {
  console.error('Defina DATABASE_SUPERUSER_URL con el superusuario o administrador de la base.');
  process.exit(1);
}

const EXTENSIONS = ['pgcrypto', 'pg_trgm', 'btree_gist', 'citext'];
const problems = [];
const admin = new pg.Client({ connectionString: url, application_name: 'coroc-prepare' });
await admin.connect();
const q = async (sql, params) => (await admin.query(sql, params)).rows;

const [{ server_version_num: version }] = await q('SHOW server_version_num');
if (Number(version) < 160000) problems.push(`PostgreSQL ${version}: se necesita 16 o superior`);
const available = new Set((await q('SELECT name FROM pg_available_extensions WHERE name = ANY($1)', [EXTENSIONS])).map((r) => r.name));
for (const e of EXTENSIONS) if (!available.has(e)) problems.push(`Falta la extensión ${e}`);
const [me] = await q('SELECT rolsuper, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname = current_user');
if (!me.rolsuper && !me.rolcreaterole) problems.push('El usuario no puede crear roles (CREATEROLE)');
if (!me.rolsuper && !me.rolbypassrls) problems.push('El usuario no puede dar BYPASSRLS: el proveedor no sirve para COROC tal como está (ADR-060)');
if (me.rolsuper || me.rolcreaterole) {
  // Prueba real, sin dejar rastro: crear un rol con BYPASSRLS dentro de una transacción que se deshace.
  try {
    await admin.query('BEGIN');
    await admin.query(`CREATE ROLE coroc_probe_${crypto.randomBytes(4).toString('hex')} NOLOGIN BYPASSRLS`);
  } catch (e) {
    problems.push(`No se pudo crear un rol con BYPASSRLS: ${e.message}`);
  } finally {
    await admin.query('ROLLBACK');
  }
}
const [{ db }] = await q('SELECT current_database() AS db');

if (problems.length) {
  console.error(`✗ La base «${db}» no cumple los requisitos:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  await admin.end();
  process.exit(1);
}
console.log(`✔ PostgreSQL ${version}, extensiones disponibles y roles con BYPASSRLS permitidos en «${db}»`);
if (checkOnly) {
  await admin.end();
  process.exit(0);
}

const password = () => crypto.randomBytes(24).toString('base64url');
const exists = async (role) => (await q('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])).length > 0;
const created = {};
for (const e of EXTENSIONS) await admin.query(`CREATE EXTENSION IF NOT EXISTS ${e}`);
if (!(await exists('coroc_owner'))) {
  created.owner = password();
  await admin.query(`CREATE ROLE coroc_owner LOGIN BYPASSRLS PASSWORD ${admin.escapeLiteral(created.owner)}`);
}
// Las migraciones crean estos roles si faltan; se crean aquí porque el dueño no tiene CREATEROLE.
for (const r of ['coroc_app', 'coroc_collector']) {
  if (!(await exists(r))) await admin.query(`CREATE ROLE ${r} NOLOGIN NOBYPASSRLS`);
  // El dueño los administra (las migraciones los relacionan entre sí) sin heredar sus permisos ni asumirlos.
  await admin.query(`GRANT ${r} TO coroc_owner WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`);
}
if (!(await exists('coroc_api'))) {
  created.api = password();
  await admin.query(`CREATE ROLE coroc_api LOGIN NOBYPASSRLS PASSWORD ${admin.escapeLiteral(created.api)}`);
}
await admin.query(`GRANT CREATE ON DATABASE ${admin.escapeIdentifier(db)} TO coroc_owner`);
// Desde PostgreSQL 15 el esquema public ya no admite objetos de cualquiera: ahí vive la tabla de migraciones.
await admin.query('GRANT USAGE, CREATE ON SCHEMA public TO coroc_owner');
if (!me.rolsuper) await admin.query('GRANT coroc_owner TO current_user'); // para poder aplicar los GRANT de abajo

// Con `fly proxy` la base se ve en localhost; COROC_DB_HOST pone en los secretos la dirección interna (p. ej.
// coroc-db.flycast:5432) con la que la API la alcanza.
const target = new URL(url);
if (process.env.COROC_DB_HOST) target.host = process.env.COROC_DB_HOST;
const withUser = (user, pass) => {
  const u = new URL(target);
  u.username = user;
  u.password = pass ?? '<la contraseña guardada>';
  return u.toString();
};

if (created.owner) {
  const applied = await migrate(withUser('coroc_owner', created.owner), (m) => console.log(`  ${m}`));
  console.log(applied.length ? `✔ ${applied.length} migraciones aplicadas como coroc_owner` : '✔ Base al día');
} else {
  console.log('· coroc_owner ya existía: las migraciones se aplican en cada despliegue (release_command)');
}
await admin.query('GRANT coroc_app TO coroc_api');
await admin.query('GRANT coroc_collector TO coroc_api WITH INHERIT FALSE, SET TRUE');
await admin.end();

console.log('\nGuarde estos valores como secretos (no se muestran de nuevo):');
if (created.owner) console.log(`  DATABASE_ADMIN_URL=${withUser('coroc_owner', created.owner)}`);
if (created.api) console.log(`  DATABASE_URL=${withUser('coroc_api', created.api)}`);
if (!created.owner && !created.api) console.log('  (los roles ya existían; use los secretos que guardó al prepararla)');
