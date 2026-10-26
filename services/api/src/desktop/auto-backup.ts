import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { SecretBox } from '../auth/crypto.js';
import { BackupService } from '../backup/backup.service.js';
import { Clock } from '../common/clock.js';
import type { AuthContext } from '../common/context.js';
import { Problem } from '../common/problem.js';
import { TenantCache } from '../company/tenant-cache.js';
import { CONFIG, type AppConfig } from '../config.js';
import { DbService } from '../db/db.service.js';
import { ObjectStore } from '../storage/object-store.js';

const DAY = 86_400_000;
/** Sin copia en 7 días, la app avisa (ADR-066). */
const OVERDUE_DAYS = 7;

type Row = Record<string, any>;

/**
 * Copias automáticas diarias de COROC Escritorio (ADR-066): una vez al día (al primer momento en que el PC está encendido),
 * COROC hace la copia `.coroc` cifrada de siempre y la guarda en la carpeta que el usuario eligió: OneDrive, Google Drive
 * para escritorio o una USB. Allí quedan las últimas N; en el PC, solo la última. Con esa carpeta, la empresa se restaura
 * en otro PC desde el asistente de primer uso (E-7).
 */
@Injectable()
export class AutoBackups implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Copias');
  private readonly box: SecretBox;
  private readonly running = new Map<string, Promise<void>>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: DbService,
    private readonly backups: BackupService,
    private readonly store: ObjectStore,
    private readonly tenants: TenantCache,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {
    this.box = new SecretBox(config.dataKey);
  }

  /** Solo en Escritorio: en la nube la carpeta sería del servidor, no del usuario. */
  private assertDesktop(): void {
    if (this.config.mode !== 'desktop') throw Problem.notFound();
  }

  private async row(tenantId: string): Promise<Row | null> {
    return this.db.tx({ tenantId }, (tx) => tx.one<Row>('SELECT * FROM auto_backups WHERE tenant_id = current_tenant()'));
  }

  async status(tenantId: string) {
    const r = await this.row(tenantId);
    const last = await this.db.tx({ tenantId }, (tx) => tx.one<{ at: Date | null }>("SELECT max(coalesce(finished_at, created_at)) AS at FROM backups WHERE status = 'done'"));
    const lastBackupAt = last?.at ? new Date(last.at) : null;
    const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
    return {
      configured: !!r, enabled: !!r?.enabled, folder: r?.folder ?? null, keep: Number(r?.keep ?? 14),
      lastRunAt: iso(r?.last_run_at), lastSuccessAt: iso(r?.last_success_at), lastFile: r?.last_file ?? null,
      lastSize: r?.last_size === null || r?.last_size === undefined ? null : Number(r.last_size), lastError: r?.last_error ?? null,
      lastBackupAt: lastBackupAt?.toISOString() ?? null,
      overdue: !lastBackupAt || this.clock.now().getTime() - lastBackupAt.getTime() > OVERDUE_DAYS * DAY,
      running: this.running.has(tenantId),
    };
  }

  async get(auth: AuthContext) {
    this.assertDesktop();
    return this.status(auth.tenantId);
  }

  /** La carpeta debe existir en este PC y dejar escribir; se prueba con un archivo que se borra enseguida. */
  private async checkFolder(folder: string): Promise<string> {
    const dir = path.resolve(folder.trim());
    if (!path.isAbsolute(folder.trim())) throw new Problem(422, 'AUTO_BACKUP_FOLDER_INVALID', {}, [{ field: 'folder', message: 'format' }]);
    const probe = path.join(dir, `.coroc-prueba-${crypto.randomBytes(4).toString('hex')}`);
    try {
      if (!(await fs.promises.stat(dir)).isDirectory()) throw new Error('no es carpeta');
      await fs.promises.writeFile(probe, 'COROC');
      await fs.promises.rm(probe, { force: true });
    } catch {
      throw new Problem(422, 'AUTO_BACKUP_FOLDER_INVALID', {}, [{ field: 'folder', message: 'other' }]);
    }
    return dir;
  }

  async save(auth: AuthContext, b: { enabled?: boolean; folder: string; password?: string; keep?: number }) {
    this.assertDesktop();
    const folder = await this.checkFolder(b.folder);
    const before = await this.row(auth.tenantId);
    if (!before && !b.password) throw new Problem(422, 'VALIDATION_FAILED', {}, [{ field: 'password', message: 'required' }]);
    if (b.password !== undefined && b.password.length < 10) throw new Problem(422, 'VALIDATION_FAILED', {}, [{ field: 'password', message: 'minLength' }]);
    const sealed = b.password ? this.box.seal(Buffer.from(b.password), `auto-backup:${auth.tenantId}`) : null;
    await this.db.tx({ tenantId: auth.tenantId, userId: auth.userId, role: auth.role }, async (tx) => {
      await tx.exec(
        `INSERT INTO auto_backups (tenant_id, enabled, folder, password_enc, keep, updated_by) VALUES (current_tenant(), $1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id) DO UPDATE SET enabled = EXCLUDED.enabled, folder = EXCLUDED.folder, password_enc = coalesce($3, auto_backups.password_enc),
                keep = EXCLUDED.keep, last_error = NULL, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [b.enabled !== false, folder, sealed ?? before?.password_enc, b.keep ?? Number(before?.keep ?? 14), auth.userId],
      );
      await this.audit.log(tx, 'backup.auto_configured', 'company', auth.tenantId, { after: { enabled: b.enabled !== false, folder, keep: b.keep ?? null, passwordChanged: !!b.password } });
    });
    return this.status(auth.tenantId);
  }

  /** «Hacer la copia ahora»: corre en segundo plano; la app consulta el estado. */
  async runNow(auth: AuthContext) {
    this.assertDesktop();
    const r = await this.row(auth.tenantId);
    if (!r) throw new Problem(409, 'AUTO_BACKUP_NOT_CONFIGURED');
    this.start(auth.tenantId);
    return this.status(auth.tenantId);
  }

  /** Hace la copia de una empresa si no hay otra en curso. Devuelve la promesa de esa copia (pruebas). */
  start(tenantId: string): Promise<void> {
    const current = this.running.get(tenantId);
    if (current) return current;
    const p = this.run(tenantId).finally(() => this.running.delete(tenantId));
    this.running.set(tenantId, p);
    return p;
  }

  private async run(tenantId: string): Promise<void> {
    const r = await this.row(tenantId);
    if (!r) return;
    await this.db.tx({ tenantId }, (tx) => tx.exec('UPDATE auto_backups SET last_run_at = $1 WHERE tenant_id = current_tenant()', [this.clock.now()]));
    try {
      const folder = path.resolve(String(r.folder));
      // La USB desconectada o la carpeta de OneDrive borrada: se avisa en la app y se reintenta más tarde.
      if (!(await fs.promises.stat(folder).catch(() => null))?.isDirectory()) throw new Problem(409, 'AUTO_BACKUP_FOLDER_UNAVAILABLE');
      const password = this.box.open(r.password_enc, `auto-backup:${tenantId}`).toString();
      const who: AuthContext = { tenantId, userId: null as unknown as string, sessionId: '', role: 'owner', lang: 'es', deviceId: 'copia-automatica', mfa: 'ok' };
      const created = await this.backups.create(who, password, { auto: true });
      const done = await this.waitFor(tenantId, created.id);
      if (!done || done.status !== 'done') throw new Problem(500, 'BACKUP_FAILED');
      const target = path.join(folder, String(done.file_name));
      const partial = `${target}.parcial`;
      const hash = crypto.createHash('sha256');
      await pipeline(
        await this.store.get(tenantId, done.storage_key, Number(done.size_bytes)),
        new Transform({ transform(c: Buffer, _e, cb) { hash.update(c); cb(null, c); } }),
        fs.createWriteStream(partial),
      );
      if (hash.digest('hex') !== done.sha256) {
        await fs.promises.rm(partial, { force: true });
        throw new Problem(500, 'BACKUP_FAILED');
      }
      await fs.promises.rename(partial, target);
      await this.prune(folder, String(done.file_name), Number(r.keep));
      await this.dropOldStored(tenantId, created.id);
      await this.db.tx({ tenantId }, async (tx) => {
        await tx.exec('UPDATE auto_backups SET last_success_at = $1, last_file = $2, last_size = $3, last_error = NULL WHERE tenant_id = current_tenant()', [this.clock.now(), done.file_name, done.size_bytes]);
        await this.audit.log(tx, 'backup.auto_saved', 'backup', created.id, { after: { file: done.file_name, size: Number(done.size_bytes) } });
      });
      this.log.log('Copia automática guardada en la carpeta elegida');
    } catch (e) {
      const code = e instanceof Problem ? e.code : 'AUTO_BACKUP_FOLDER_UNAVAILABLE';
      this.log.warn(`Copia automática no guardada: ${code}`);
      await this.db.tx({ tenantId }, (tx) => tx.exec('UPDATE auto_backups SET last_error = $1 WHERE tenant_id = current_tenant()', [code]));
    }
  }

  /** Espera a que termine la tarea de la copia (corre en este mismo proceso). */
  private async waitFor(tenantId: string, id: string): Promise<Row | null> {
    const until = Date.now() + 3 * 3600_000;
    while (Date.now() < until) {
      const b = await this.db.tx({ tenantId }, (tx) => tx.one<Row>('SELECT status, storage_key, size_bytes, sha256, file_name FROM backups WHERE id = $1', [id]));
      if (!b || ['done', 'failed', 'cancelled'].includes(String(b.status))) return b;
      await new Promise((ok) => setTimeout(ok, 1000));
    }
    return null;
  }

  /** En la carpeta quedan las últimas `keep` copias de esta empresa; nunca se tocan otros archivos. */
  private async prune(folder: string, fileName: string, keep: number): Promise<void> {
    const prefix = fileName.replace(/_\d{4}-\d{2}-\d{2}_\d{4}\.coroc$/, '_');
    if (!prefix.startsWith('COROC_Respaldo_') || prefix === fileName) return;
    const mine = (await fs.promises.readdir(folder)).filter((f) => f.startsWith(prefix) && /_\d{4}-\d{2}-\d{2}_\d{4}\.coroc$/.test(f)).sort();
    for (const f of mine.slice(0, Math.max(0, mine.length - keep))) await fs.promises.rm(path.join(folder, f), { force: true });
  }

  /** En el PC queda solo la última copia automática: las anteriores ya están en la carpeta. */
  private async dropOldStored(tenantId: string, keepId: string): Promise<void> {
    const old = await this.db.tx({ tenantId }, (tx) => tx.many<{ id: string; storage_key: string }>("SELECT id, storage_key FROM backups WHERE auto AND status = 'done' AND storage_key IS NOT NULL AND id <> $1", [keepId]));
    for (const b of old) {
      await this.store.remove(b.storage_key).catch(() => undefined);
      await this.db.tx({ tenantId }, (tx) => tx.exec('UPDATE backups SET storage_key = NULL WHERE id = $1', [b.id]));
    }
  }

  /** Revisión periódica: la copia del día se hace la primera vez que COROC está encendido ese día. */
  async tick(): Promise<void> {
    const ids = await this.db.tx(null, (tx) => tx.many<{ id: string }>('SELECT active_tenant_ids() AS id'));
    for (const { id } of ids) {
      const r = await this.row(id);
      if (!r?.enabled) continue;
      const tenant = await this.tenants.get(id);
      const today = this.clock.today(tenant.timezone);
      const lastDay = r.last_success_at ? new Intl.DateTimeFormat('en-CA', { timeZone: tenant.timezone }).format(new Date(r.last_success_at)) : null;
      const recentTry = r.last_run_at && this.clock.now().getTime() - new Date(r.last_run_at).getTime() < 3600_000;
      if (lastDay !== today && !recentTry) await this.start(id);
    }
  }

  onApplicationBootstrap(): void {
    if (this.config.mode !== 'desktop' || this.config.documentWorker !== 'on') return;
    // A los dos minutos de encender (para no competir con el arranque) y después cada 15 minutos.
    const first = setTimeout(() => void this.tick().catch((e: Error) => this.log.warn(e.message)), 120_000);
    first.unref();
    this.timer = setInterval(() => void this.tick().catch((e: Error) => this.log.warn(e.message)), 15 * 60_000);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    // Al cerrar COROC no se espera una copia larga: la de hoy se repite al encender (queda sin «éxito» registrado).
    const pending = Promise.all([...this.running.values()].map((p) => p.catch(() => undefined)));
    await Promise.race([pending, new Promise((ok) => setTimeout(ok, 5000).unref())]);
  }
}
