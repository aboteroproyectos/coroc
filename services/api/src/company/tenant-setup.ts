import { hashPassword } from '../auth/password.js';

/** Moneda, zona horaria e idioma de cada país (§3): los valores con los que nace una empresa. */
export const COUNTRY_DEFAULTS: Record<'CO' | 'BR' | 'US', { currency: string; timezone: string; lang: string }> = {
  CO: { currency: 'COP', timezone: 'America/Bogota', lang: 'es' },
  BR: { currency: 'BRL', timezone: 'America/Sao_Paulo', lang: 'pt-BR' },
  US: { currency: 'USD', timezone: 'America/New_York', lang: 'en' },
};

export interface NewTenant {
  slug: string;
  name: string;
  country: 'CO' | 'BR' | 'US';
  timezone?: string;
  lang?: string;
}

export interface NewOwner {
  username: string;
  name: string;
  email?: string | null;
  password: string;
}

/** Ejecuta una consulta y devuelve sus filas (cliente de pg o transacción de la API). */
export type Query = (sql: string, params: unknown[]) => Promise<Record<string, any>[]>;

/**
 * Identificador corto de ingreso a partir del nombre (§7.1): sin tildes, en minúsculas y con guiones. En Escritorio
 * nadie lo escribe: la app lo toma del estado de la instalación.
 */
export function slugFor(name: string): string {
  const s = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
  return /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(s) ? s : 'empresa';
}

/**
 * Filas con las que nace una empresa: la empresa, sus consecutivos y, si se indica, su Propietario. La transacción ya
 * debe tener `app.tenant_id` fijado en `id`: la base aplica RLS también al crearla.
 */
export async function insertTenantRows(q: Query, id: string, t: NewTenant, owner: NewOwner | null): Promise<{ ownerId: string | null }> {
  const d = COUNTRY_DEFAULTS[t.country];
  await q('INSERT INTO tenants (id, slug, name, country, currency, timezone, lang) VALUES ($1, $2, $3, $4, $5, $6, $7)', [id, t.slug, t.name, t.country, d.currency, t.timezone ?? d.timezone, t.lang ?? d.lang]);
  await q("INSERT INTO number_sequences (tenant_id, name, prefix) VALUES ($1, 'client', 'C'), ($1, 'contract', 'CT-'), ($1, 'receipt', 'RC-')", [id]);
  const ownerId = owner ? await insertOwner(q, id, owner) : null;
  await q("INSERT INTO audit_log (tenant_id, user_id, action, entity, entity_id, after) VALUES ($1::uuid, $2, 'tenant.created', 'tenant', $1::text, $3)", [id, ownerId, JSON.stringify({ slug: t.slug, country: t.country })]);
  return { ownerId };
}

/** Propietario de una empresa, con su contraseña ya validada por quien llama. */
export async function insertOwner(q: Query, tenantId: string, o: NewOwner): Promise<string> {
  const rows = await q("INSERT INTO users (tenant_id, username, name, role, password_hash, email) VALUES ($1, $2, $3, 'owner', $4, $5) RETURNING id", [tenantId, o.username, o.name, await hashPassword(o.password), o.email ?? null]);
  return rows[0]!.id as string;
}
