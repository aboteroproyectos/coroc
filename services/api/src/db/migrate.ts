// Aplica las migraciones SQL en orden, cada una en su propia transacción, y verifica que las ya
// aplicadas no hayan cambiado (suma SHA-256). Se ejecuta con el rol dueño del esquema (DATABASE_ADMIN_URL).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../db/migrations');

export async function migrate(adminUrl: string, log: (m: string) => void = () => undefined): Promise<string[]> {
  const client = new pg.Client({ connectionString: adminUrl, application_name: 'coroc-migrate' });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock(726617)');
    await client.query('CREATE TABLE IF NOT EXISTS public.coroc_schema_migrations (version text PRIMARY KEY, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Map((await client.query('SELECT version, checksum FROM public.coroc_schema_migrations')).rows.map((r) => [r.version as string, r.checksum as string]));
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
    for (const f of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
      const sum = crypto.createHash('sha256').update(sql).digest('hex');
      const version = f.replace(/\.sql$/, '');
      if (done.has(version)) {
        if (done.get(version) !== sum) throw new Error(`La migración ${version} cambió después de aplicarse`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('SET search_path = public');
        await client.query('INSERT INTO public.coroc_schema_migrations (version, checksum) VALUES ($1, $2)', [version, sum]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Migración ${version}: ${(e as Error).message}`);
      }
      applied.push(version);
      log(`✔ ${version}`);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(726617)').catch(() => undefined);
    await client.end();
  }
  return applied;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) {
    console.error('Defina DATABASE_ADMIN_URL (rol dueño del esquema).');
    process.exit(1);
  }
  migrate(url, console.log).then((a) => console.log(a.length ? `${a.length} migraciones aplicadas` : 'Base al día'), (e) => {
    console.error(e.message);
    process.exit(1);
  });
}
