// Alta de una empresa suscriptora y su Propietario (§20.4: la suscripción se vende fuera de las apps).
// Uso: DATABASE_ADMIN_URL=... node dist/cli/tenant-create.js --slug inversiones-coroc --name "Inversiones Coroc S.A.S." \
//        --country CO --owner andres --owner-name "Andrés Botero" --email andres@example.com
// La contraseña inicial se pide por la entrada estándar y nunca se escribe en la terminal ni en los logs.
import { parseArgs } from 'node:util';
import readline from 'node:readline';
import pg from 'pg';
import { assertStrongPassword, hashPassword } from '../auth/password.js';

const CURRENCY: Record<string, string> = { CO: 'COP', BR: 'BRL', US: 'USD' };
const TZ: Record<string, string> = { CO: 'America/Bogota', BR: 'America/Sao_Paulo', US: 'America/New_York' };
const LANG: Record<string, string> = { CO: 'es', BR: 'pt-BR', US: 'en' };

export async function createTenant(adminUrl: string, a: { slug: string; name: string; country: 'CO' | 'BR' | 'US'; owner: string; ownerName: string; email?: string; password: string; timezone?: string; lang?: string }) {
  await assertStrongPassword(a.password, { username: a.owner, tenantSlug: a.slug, mode: process.env.COROC_BREACHED_CHECK === 'local' ? 'local' : 'hibp' });
  const c = new pg.Client({ connectionString: adminUrl });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET search_path = coroc, public');
    const t = await c.query(
      'INSERT INTO tenants (slug, name, country, currency, timezone, lang) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [a.slug, a.name, a.country, CURRENCY[a.country], a.timezone ?? TZ[a.country], a.lang ?? LANG[a.country]],
    );
    const id = t.rows[0].id as string;
    await c.query("SELECT set_config('app.tenant_id', $1, true)", [id]);
    await c.query("INSERT INTO number_sequences (tenant_id, name, prefix) VALUES ($1, 'client', 'C'), ($1, 'contract', 'CT-'), ($1, 'receipt', 'RC-')", [id]);
    const u = await c.query("INSERT INTO users (tenant_id, username, name, role, password_hash, email) VALUES ($1, $2, $3, 'owner', $4, $5) RETURNING id", [id, a.owner, a.ownerName, await hashPassword(a.password), a.email ?? null]);
    await c.query("INSERT INTO audit_log (tenant_id, user_id, action, entity, entity_id, after) VALUES ($1::uuid, $2, 'tenant.created', 'tenant', $1::text, $3)", [id, u.rows[0].id, JSON.stringify({ slug: a.slug, country: a.country })]);
    await c.query('COMMIT');
    return { tenantId: id, ownerId: u.rows[0].id as string };
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
  const password = await new Promise<string>((ok) => rl.question('', (x) => { rl.close(); ok(x); }));
  process.stderr.write('\n');
  const r = await createTenant(url, { slug: values.slug, name: values.name, country: values.country as 'CO', owner: values.owner, ownerName: values['owner-name'], email: values.email, password });
  console.log(`Empresa creada: ${values.slug} (${r.tenantId}). El Propietario activará la verificación en dos pasos en su primer ingreso.`);
}
