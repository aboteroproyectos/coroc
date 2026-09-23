import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import pg from 'pg';
import { CONFIG, type AppConfig } from '../config.js';

// Dinero en BIGINT → número entero seguro (ADR-001). Fechas civiles como texto YYYY-MM-DD, sin zona horaria.
pg.types.setTypeParser(20, (v: string) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new RangeError('Monto fuera del rango seguro');
  return n;
});
pg.types.setTypeParser(1082, (v: string) => v);

export interface TxContext {
  tenantId: string;
  userId?: string | null;
  role?: string | null;
}

/** Acceso a la base dentro de una transacción con el contexto de RLS ya fijado. */
export class Tx {
  constructor(private readonly client: pg.PoolClient, readonly ctx: TxContext | null) {}
  async many<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.client.query(sql, params)).rows as T[];
  }
  async one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
    return ((await this.client.query(sql, params)).rows[0] as T | undefined) ?? null;
  }
  async exec(sql: string, params: unknown[] = []): Promise<number> {
    return (await this.client.query(sql, params)).rowCount ?? 0;
  }
}

@Injectable()
export class DbService implements OnModuleDestroy {
  readonly pool: pg.Pool;

  constructor(@Inject(CONFIG) config: AppConfig) {
    this.pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20, idleTimeoutMillis: 30_000, application_name: 'coroc-api' });
    this.pool.on('connect', (c) => void c.query("SET search_path = coroc, public; SET TIME ZONE 'UTC'"));
  }

  /**
   * Ejecuta `fn` en una transacción con `app.tenant_id`, `app.user_id` y `app.role` fijados con SET LOCAL:
   * PostgreSQL aplica el aislamiento por empresa y el alcance del Cobrador (RLS), no solo la API.
   */
  async tx<T>(ctx: TxContext | null, fn: (tx: Tx) => Promise<T>, opts: { lookupSlug?: string; snapshot?: boolean } = {}): Promise<T> {
    const client = await this.pool.connect();
    try {
      // `snapshot`: lectura consistente de toda la empresa en un instante (respaldo, §19).
      await client.query(opts.snapshot ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
      await client.query(
        "SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true), set_config('app.role', $3, true), set_config('app.lookup_slug', $4, true)",
        [ctx?.tenantId ?? '', ctx?.userId ?? '', ctx?.role ?? '', opts.lookupSlug ?? ''],
      );
      // El Cobrador trabaja con un rol de base de datos cuyas políticas solo le muestran sus clientes (ADR-022).
      if (ctx?.role === 'collector') await client.query('SET LOCAL ROLE coroc_collector');
      const out = await fn(new Tx(client, ctx));
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
