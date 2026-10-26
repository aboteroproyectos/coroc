// Alta de una empresa suscriptora y su Propietario (§20.4: la suscripción se vende fuera de las apps).
// Uso: DATABASE_ADMIN_URL=... node dist/cli/tenant-create.js --slug inversiones-coroc --name "Inversiones Coroc S.A.S." \
//        --country CO --owner andres --owner-name "Andrés Botero" --email andres@example.com
// La contraseña inicial se pide por la entrada estándar y nunca se escribe en la terminal ni en los logs.
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';
import readline from 'node:readline';
import pg from 'pg';
import { assertStrongPassword } from '../auth/password.js';
import { insertTenantRows } from '../company/tenant-setup.js';

export async function createTenant(adminUrl: string, a: { slug: string; name: string; country: 'CO' | 'BR' | 'US'; owner: string; ownerName: string; email?: string; password: string; timezone?: string; lang?: string }) {
  await assertStrongPassword(a.password, { username: a.owner, tenantSlug: a.slug, mode: process.env.COROC_BREACHED_CHECK === 'local' ? 'local' : 'hibp' });
  const c = new pg.Client({ connectionString: adminUrl });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET search_path = coroc, public');
    const id = crypto.randomUUID();
    await c.query("SELECT set_config('app.tenant_id', $1, true)", [id]);
    const r = await insertTenantRows((sql, params) => c.query(sql, params).then((x) => x.rows), id, { slug: a.slug, name: a.name, country: a.country, timezone: a.timezone, lang: a.lang }, { username: a.owner, name: a.ownerName, email: a.email ?? null, password: a.password });
    await c.query('COMMIT');
    return { tenantId: id, ownerId: r.ownerId! };
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    await c.end();
  }
}

const isMain = process.argv[1]?.endsWith('tenant-create.js');
if (isMain) {
  const { values } = parseArgs({ options: { slug: { type: 'string' }, name: { type: 'string' }, country: { type: 'string', default: 'CO' }, owner: { type: 'string' }, 'owner-name': { type: 'string' }, email: { type: 'string' } } });
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url || !values.slug || !values.name || !values.owner || !values['owner-name']) {
    console.error('Uso: DATABASE_ADMIN_URL=... tenant-create --slug x --name "Empresa" --country CO --owner usuario --owner-name "Nombre" [--email correo]');
    process.exit(1);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => undefined;
  process.stderr.write('Contraseña inicial del Propietario (mínimo 12 caracteres): ');
  // Desde Windows PowerShell la línea llega con «\r» al final (instalador del PC, infra/pc/instalar.ps1).
  const password = await new Promise<string>((ok) => rl.question('', (x) => { rl.close(); ok(x.replace(/\r$/, '')); }));
  process.stderr.write('\n');
  const r = await createTenant(url, { slug: values.slug, name: values.name, country: values.country as 'CO', owner: values.owner, ownerName: values['owner-name'], email: values.email, password });
  console.log(`Empresa creada: ${values.slug} (${r.tenantId}). El Propietario activará la verificación en dos pasos en su primer ingreso.`);
}
