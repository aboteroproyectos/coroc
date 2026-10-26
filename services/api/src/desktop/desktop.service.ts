import crypto from 'node:crypto';
import type { Readable } from 'node:stream';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { AuthService, type SessionJson } from '../auth/auth.service.js';
import { assertStrongPassword, hashPassword } from '../auth/password.js';
import { BackupService } from '../backup/backup.service.js';
import { Clock } from '../common/clock.js';
import type { AuthContext } from '../common/context.js';
import { Problem } from '../common/problem.js';
import { TenantCache } from '../company/tenant-cache.js';
import { COUNTRY_DEFAULTS, insertOwner, insertTenantRows, slugFor } from '../company/tenant-setup.js';
import { CONFIG, type AppConfig } from '../config.js';
import { DbService, type Tx } from '../db/db.service.js';

export interface DesktopSetupInput {
  company: { name: string; country: 'CO' | 'BR' | 'US'; lang?: 'es' | 'pt-BR' | 'en' };
  owner: { name: string; username: string; password: string; email?: string | null };
  deviceId: string;
  deviceName?: string | null;
}

/** Bloqueo de la instalación: el asistente y la restauración nunca corren a la vez. */
const LOCK = "SELECT pg_advisory_xact_lock(hashtext('coroc.escritorio.instalacion'))";

/**
 * COROC Escritorio (ADR-062): una sola empresa por PC. El asistente de primer uso la crea con su Propietario, o la trae
 * de una copia `.coroc` de otro PC (E-7). Mientras una copia se está restaurando, la empresa existe pero inactiva
 * («provisional»): nadie puede ingresar y los trabajos programados no la tocan.
 */
@Injectable()
export class DesktopService {
  private readonly log = new Logger('Escritorio');
  /** Una restauración tarda minutos: mientras corre, no empieza otra ni el asistente (hay un solo proceso de la API). */
  private busy = false;

  constructor(
    private readonly db: DbService,
    private readonly auth: AuthService,
    private readonly backups: BackupService,
    private readonly tenants: TenantCache,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** Solo en Escritorio: en la nube estas rutas no existen. */
  assertDesktop(): void {
    if (this.config.mode !== 'desktop') throw Problem.notFound();
  }

  private async installation(tx: Tx): Promise<{ tenants: number; tenantId: string | null; active: boolean | null }> {
    const r = (await tx.one<{ tenants: number; tenant_id: string | null; active: boolean | null }>('SELECT * FROM installation_tenant()'))!;
    if (r.tenants > 1) throw new Problem(409, 'DESKTOP_SEVERAL_COMPANIES');
    return { tenants: r.tenants, tenantId: r.tenant_id, active: r.active };
  }

  /** Lo que la app necesita al abrir: si ya hay empresa (y su identificador de ingreso) o una restauración a medias. */
  async status() {
    this.assertDesktop();
    return this.db.tx(null, async (tx) => {
      const inst = await this.installation(tx);
      if (!inst.tenantId) return { configured: false, company: null, restore: null };
      await tx.exec("SELECT set_config('app.tenant_id', $1, true)", [inst.tenantId]);
      const t = (await tx.one<Record<string, any>>('SELECT slug, name, country, lang FROM tenants WHERE id = current_tenant()'))!;
      if (inst.active) return { configured: true, company: { slug: t.slug, name: t.name, country: t.country, lang: t.lang }, restore: null };
      const r = await tx.one<Record<string, any>>("SELECT id, status, header, created_at FROM restores WHERE status IN ('uploaded', 'verified') ORDER BY created_at DESC LIMIT 1");
      return {
        configured: false,
        company: null,
        restore: r ? { id: r.id, status: r.status, company: String(r.header?.company ?? ''), backupCreatedAt: r.header?.createdAt ? String(r.header.createdAt) : null } : null,
      };
    });
  }

  /**
   * Pantallas 1 y 2 del asistente: crea la empresa y su Propietario y devuelve su sesión, para que el asistente siga con
   * las tasas, Gmail y WhatsApp. Si quedó una restauración a medias, la empresa provisional se convierte en esta.
   */
  async setup(input: DesktopSetupInput): Promise<SessionJson> {
    this.assertDesktop();
    if (this.busy) throw new Problem(409, 'DESKTOP_BUSY');
    const name = input.company.name.trim().replace(/\s+/g, ' ');
    const username = input.owner.username.trim().toLowerCase();
    const slug = slugFor(name);
    await assertStrongPassword(input.owner.password, { username, tenantSlug: slug, mode: this.config.breachedPasswordCheck });
    const country = input.company.country;
    const d = COUNTRY_DEFAULTS[country];
    const owner = { username, name: input.owner.name.trim(), email: input.owner.email?.trim() || null, password: input.owner.password };
    const { session, tenantId } = await this.db.tx(null, async (tx) => {
      await tx.exec(LOCK);
      const inst = await this.installation(tx);
      if (inst.active) throw new Problem(409, 'DESKTOP_ALREADY_SET_UP');
      const id = inst.tenantId ?? crypto.randomUUID();
      await tx.exec("SELECT set_config('app.tenant_id', $1, true)", [id]);
      const q = (sql: string, params: unknown[]) => tx.many(sql, params);
      let ownerId: string;
      if (inst.tenantId) {
        // Empresa provisional de una restauración que no terminó: queda limpia y pasa a ser la empresa nueva.
        await tx.exec('SELECT purge_tenant_data(current_tenant())');
        await tx.exec(
          `UPDATE tenants SET slug = $1, name = $2, country = $3, currency = $4, timezone = $5, lang = $6::lang_code, settings = '{}'::jsonb, active = true, version = version + 1
            WHERE id = current_tenant()`,
          [slug, name, country, d.currency, d.timezone, input.company.lang ?? d.lang],
        );
        ownerId = await insertOwner(q, id, owner);
        await this.audit.log(tx, 'tenant.created', 'tenant', id, { after: { slug, country, desktop: true } }, ownerId);
      } else {
        ownerId = (await insertTenantRows(q, id, { slug, name, country, lang: input.company.lang }, owner)).ownerId!;
      }
      const tenant = (await tx.one<Record<string, any>>('SELECT * FROM tenants WHERE id = current_tenant()'))!;
      const user = (await tx.one<Record<string, any>>('SELECT * FROM users WHERE id = $1', [ownerId]))!;
      return { tenantId: id, session: await this.auth.firstSession(tx, tenant, user, { deviceId: input.deviceId, deviceName: input.deviceName ?? null }) };
    });
    this.tenants.invalidate(tenantId);
    this.log.log('Empresa creada desde el asistente de primer uso');
    return session;
  }

  /** Contexto de la empresa provisional: no hay usuario todavía, actúa la instalación con el rol de Propietario. */
  private installer(tenantId: string): AuthContext {
    return { tenantId, userId: null as unknown as string, sessionId: '', role: 'owner', lang: 'es', deviceId: 'escritorio', mfa: 'ok' };
  }

  /** E-7, paso 1: recibe el `.coroc` de otro PC en una empresa provisional. Aún no se descifra nada. */
  async restoreUpload(body: Readable, declared: number) {
    this.assertDesktop();
    const tenantId = await this.db.tx(null, async (tx) => {
      await tx.exec(LOCK);
      const inst = await this.installation(tx);
      if (inst.active) throw new Problem(409, 'DESKTOP_ALREADY_SET_UP');
      if (inst.tenantId) return inst.tenantId;
      const id = crypto.randomUUID();
      await tx.exec("SELECT set_config('app.tenant_id', $1, true)", [id]);
      await insertTenantRows((sql, params) => tx.many(sql, params), id, { slug: 'restauracion', name: 'COROC', country: 'CO' }, null);
      await tx.exec('UPDATE tenants SET active = false WHERE id = current_tenant()');
      return id;
    });
    const r = await this.backups.upload(this.installer(tenantId), body, declared);
    const header = await this.db.tx({ tenantId }, (tx) => tx.one<{ header: Record<string, any> | null }>('SELECT header FROM restores WHERE id = $1', [r.id]));
    return { id: r.id, status: r.status, company: String(header?.header?.company ?? ''), backupCreatedAt: header?.header?.createdAt ? String(header.header.createdAt) : null };
  }

  /**
   * E-7, paso 2: con la contraseña de la copia se verifica, se restaura todo (empresa, usuarios, clientes, préstamos,
   * pagos y documentos) y la empresa queda activa. Se ingresa después con el usuario y la contraseña de siempre.
   */
  async restoreApply(id: string, password: string) {
    this.assertDesktop();
    const tenantId = await this.db.tx(null, async (tx) => {
      await tx.exec(LOCK);
      const inst = await this.installation(tx);
      if (inst.active || !inst.tenantId) throw new Problem(409, 'DESKTOP_ALREADY_SET_UP');
      return inst.tenantId;
    });
    if (this.busy) throw new Problem(409, 'DESKTOP_BUSY');
    this.busy = true;
    try {
      return await this.applyCopy(tenantId, id, password);
    } finally {
      this.busy = false;
    }
  }

  private async applyCopy(tenantId: string, id: string, password: string) {
    const who = this.installer(tenantId);
    const verified = await this.backups.verify(who, id, password);
    const summary = (verified.summary ?? {}) as { company?: string; country?: string; currency?: string };
    const country = (['CO', 'BR', 'US'] as const).find((c) => c === summary.country) ?? 'CO';
    // La moneda y el país no cambian al restaurar en la nube; aquí la empresa provisional toma los de la copia.
    await this.db.tx({ tenantId }, (tx) => tx.exec('UPDATE tenants SET country = $1, currency = $2 WHERE id = current_tenant()', [country, summary.currency ?? COUNTRY_DEFAULTS[country].currency]));
    this.tenants.invalidate(tenantId);
    const tenant = await this.tenants.get(tenantId);
    await this.backups.apply(who, id, password, tenant.name);
    const out = await this.db.tx({ tenantId }, async (tx) => {
      const t = (await tx.one<Record<string, any>>('SELECT name, country, lang FROM tenants WHERE id = current_tenant()'))!;
      const slug = slugFor(t.name);
      await tx.exec('UPDATE tenants SET slug = $1, active = true, version = version + 1 WHERE id = current_tenant()', [slug]);
      const users = await tx.many<{ username: string; role: string }>("SELECT username, role FROM users WHERE active ORDER BY (role = 'owner') DESC, username");
      await this.audit.log(tx, 'desktop.restored', 'restore', id, { after: { users: users.length } });
      return { company: { slug, name: t.name, country: t.country, lang: t.lang }, owners: users.filter((u) => u.role === 'owner').map((u) => u.username) };
    });
    this.tenants.invalidate(tenantId);
    this.log.log('Empresa restaurada desde una copia de otro PC');
    return out;
  }

  /**
   * «¿Olvidó su contraseña?» en Escritorio (ADR-063): no hay correo de recuperación; la app pide antes Windows Hello (la
   * cuenta de Windows de este PC, que ya protege la base con DPAPI) y solo entonces llama aquí con la clave de la
   * ejecución. Se cierran las demás sesiones y queda en la bitácora.
   */
  async resetPassword(username: string, password: string): Promise<void> {
    this.assertDesktop();
    const tenantId = await this.db.tx(null, async (tx) => {
      const inst = await this.installation(tx);
      if (!inst.active || !inst.tenantId) throw new Problem(409, 'DESKTOP_NOT_SET_UP');
      return inst.tenantId;
    });
    const now = this.clock.now();
    const ok = await this.db.tx({ tenantId }, async (tx) => {
      const u = await tx.one<Record<string, any>>('SELECT u.id, u.username, t.slug FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.username = $1 AND u.active', [username.trim().toLowerCase()]);
      if (!u) return false;
      await assertStrongPassword(password, { username: u.username, tenantSlug: u.slug, mode: this.config.breachedPasswordCheck });
      await tx.exec('UPDATE users SET password_hash = $2, password_changed_at = $3, failed_attempts = 0, lockouts = 0, locked_until = NULL, version = version + 1 WHERE id = $1', [u.id, await hashPassword(password), now]);
      await tx.exec('UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL', [u.id, now]);
      await this.audit.log(tx, 'auth.password_reset', 'user', u.id, { after: { via: 'windows_hello' } }, u.id);
      return true;
    });
    if (!ok) throw new Problem(404, 'DESKTOP_USER_NOT_FOUND');
  }
}
