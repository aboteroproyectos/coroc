import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { PassThrough, Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import yauzl from 'yauzl';
import yazl from 'yazl';
import { AuditService } from '../audit/audit.service.js';
import { Clock } from '../common/clock.js';
import type { AuthContext } from '../common/context.js';
import { Problem } from '../common/problem.js';
import { TenantCache } from '../company/tenant-cache.js';
import { CONFIG, type AppConfig } from '../config.js';
import { DbService, type Tx } from '../db/db.service.js';
import { MIGRATIONS_DIR } from '../db/migrate.js';
import { LinkSigner } from '../documents/links.js';
import { DocumentTasks, TaskCancelled, type TaskRow } from '../documents/tasks.js';
import { LoanStateService } from '../loans/loan-state.service.js';
import { ObjectStore } from '../storage/object-store.js';
import { IntegrityError, SealStream, UnsealStream } from '../storage/sealed.js';

const pbkdf2 = promisify(crypto.pbkdf2);
export const FORMAT = 'COROC-BACKUP-2';
const LEGACY_FORMAT = 'COROC-BACKUP-1';
const ITERATIONS = 310_000;
const MAX_HEADER = 64 * 1024;

/**
 * Tablas del respaldo en orden de inserción (las referenciadas primero). Lo derivado no se guarda: `loan_state` y
 * `daily_collections` se reconstruyen desde el libro al restaurar (ADR-003, ADR-021). Tampoco se guardan secretos de
 * sesión, enlaces de carga ni tareas.
 */
const TABLES: { name: string; order: string; exclude?: string[] }[] = [
  { name: 'users', order: 'created_at, id', exclude: ['totp_secret_enc', 'totp_pending_enc', 'totp_last_counter', 'failed_attempts', 'locked_until', 'lockouts'] },
  { name: 'number_sequences', order: 'name' },
  { name: 'rate_caps', order: 'valid_from, id' },
  { name: 'contact_rule_sets', order: 'id' },
  { name: 'receiving_accounts', order: 'id' },
  { name: 'message_templates', order: 'id' },
  { name: 'clients', order: 'created_at, id' },
  { name: 'co_debtors', order: 'id' },
  { name: 'loans', order: 'created_at, id' },
  { name: 'installments', order: 'loan_id, number' },
  { name: 'ledger_entries', order: '(reverses_id IS NOT NULL), recorded_at, id' },
  { name: 'payment_allocations', order: 'entry_id, installment_number' },
  { name: 'documents', order: 'created_at, id', exclude: ['storage_key'] },
  { name: 'consents', order: 'granted_at, id' },
  { name: 'receipts', order: 'created_at, id' },
  { name: 'intake_events', order: 'created_at, id', exclude: ['upload_link_id'] },
  { name: 'extraction_corrections', order: 'created_at, id' },
  { name: 'messages', order: 'created_at, id' },
  { name: 'audit_log', order: 'at, id', exclude: ['id'] },
];

interface Manifest {
  format: string;
  app: 'COROC';
  schema: string;
  createdAt: string;
  company: Record<string, unknown>;
  counts: Record<string, number>;
  files: Record<string, { sha256: string; size: number }>;
}

export interface BackupHeader {
  format: string;
  app: string;
  schema: string;
  kdf: string;
  iterations: number;
  salt: string;
  noncePrefix: string;
  cipher: string;
  chunk: number;
  createdAt: string;
  company: string;
}

const latestSchema = () => fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort().at(-1)!.slice(0, 4);
const aadOf = (headerLine: Buffer) => crypto.createHash('sha256').update(headerLine).digest();

/** Calcula SHA-256 y tamaño de lo que pasa por el flujo (manifiesto del respaldo). */
class HashTap extends Transform {
  private readonly h = crypto.createHash('sha256');
  size = 0;
  constructor(private readonly done: (r: { sha256: string; size: number }) => void) {
    super();
  }
  override _transform(c: Buffer, _e: BufferEncoding, cb: () => void) {
    this.h.update(c);
    this.size += c.length;
    this.push(c);
    cb();
  }
  override _flush(cb: () => void) {
    this.done({ sha256: this.h.digest('hex'), size: this.size });
    cb();
  }
}

const readAll = async (s: Readable) => Buffer.concat(await s.toArray());

/**
 * Respaldo y restauración (§19, ADR-034).
 *
 * Archivo `.coroc` = línea de encabezado JSON (formato, KDF, sal, empresa y fecha) + ZIP cifrado por bloques con
 * AES-256-GCM y una clave derivada de la contraseña del usuario con PBKDF2-SHA256 (310.000 iteraciones). El SHA-256 del
 * encabezado va autenticado en cada bloque. El ZIP lleva `manifest.json` con conteos y huella SHA-256 de cada archivo,
 * un JSONL por tabla y todos los documentos. Se genera por flujo, sin cargarlo en memoria.
 */
@Injectable()
export class BackupService implements OnModuleInit {
  private readonly log = new Logger('Respaldo');

  constructor(
    private readonly db: DbService,
    private readonly store: ObjectStore,
    private readonly tasks: DocumentTasks,
    private readonly links: LinkSigner,
    private readonly tenants: TenantCache,
    private readonly state: LoanStateService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.tasks.register('backup', (task, progress, cancelled) => this.generate(task, progress, cancelled));
  }

  private ctx(a: AuthContext) {
    return { tenantId: a.tenantId, userId: a.userId, role: a.role };
  }

  // ─────────────────────────── Respaldo ───────────────────────────
  backupJson(r: Record<string, any>) {
    const status = r.status === 'done' || r.status === 'cancelled' ? r.status : r.task_status ?? r.status;
    return {
      id: r.id,
      status,
      progress: status === 'done' ? 100 : Number(r.task_progress ?? r.progress ?? 0),
      fileName: r.file_name ?? null,
      size: r.size_bytes === null || r.size_bytes === undefined ? null : Number(r.size_bytes),
      sha256: r.sha256 ?? null,
      counts: (r.manifest?.counts as Record<string, number>) ?? {},
      createdAt: new Date(r.created_at).toISOString(),
      finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
    };
  }

  private readonly selectBackup = `SELECT b.*, t.status AS task_status, t.progress AS task_progress FROM backups b LEFT JOIN document_tasks t ON t.id = b.task_id`;

  async create(auth: AuthContext, password: string) {
    if (password.length < 10) throw new Problem(422, 'VALIDATION_FAILED', {}, [{ field: 'password', message: 'minLength' }]);
    // La contraseña nunca se guarda: se deriva aquí la clave y viaja a la tarea cifrada con la clave del servidor.
    const salt = crypto.randomBytes(16);
    const key = await pbkdf2(password, salt, ITERATIONS, 32, 'sha256');
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.config.dataKey, iv);
    const sealed = Buffer.concat([iv, c.update(key), c.final(), c.getAuthTag()]).toString('base64');
    const row = await this.db.tx(this.ctx(auth), async (tx) => {
      const running = await tx.one("SELECT 1 FROM backups b JOIN document_tasks t ON t.id = b.task_id WHERE t.status IN ('pending', 'running')");
      if (running) throw new Problem(409, 'BACKUP_IN_PROGRESS');
      const b = (await tx.one<{ id: string }>("INSERT INTO backups (tenant_id, status, created_by) VALUES (current_tenant(), 'pending', $1) RETURNING id", [auth.userId]))!;
      const taskId = await this.tasks.enqueue(tx, { kind: 'backup', params: { backupId: b.id, salt: salt.toString('base64'), secret: sealed }, createdBy: auth.userId });
      await tx.exec('UPDATE backups SET task_id = $2 WHERE id = $1', [b.id, taskId]);
      await this.audit.log(tx, 'backup.requested', 'backup', b.id);
      return tx.one<Record<string, any>>(`${this.selectBackup} WHERE b.id = $1`, [b.id]);
    });
    this.tasks.kick();
    return this.backupJson(row!);
  }

  async list(auth: AuthContext) {
    return this.db.tx(this.ctx(auth), async (tx) => (await tx.many<Record<string, any>>(`${this.selectBackup} ORDER BY b.created_at DESC LIMIT 100`)).map((r) => this.backupJson(r)));
  }

  async get(auth: AuthContext, id: string) {
    const r = await this.db.tx(this.ctx(auth), (tx) => tx.one<Record<string, any>>(`${this.selectBackup} WHERE b.id = $1`, [id]));
    if (!r) throw Problem.notFound();
    return this.backupJson(r);
  }

  async cancel(auth: AuthContext, id: string) {
    return this.db.tx(this.ctx(auth), async (tx) => {
      const r = await tx.one<Record<string, any>>(`${this.selectBackup} WHERE b.id = $1`, [id]);
      if (!r) throw Problem.notFound();
      if (r.task_status === 'pending' || r.task_status === 'running') {
        await tx.exec("UPDATE document_tasks SET status = 'cancelled', finished_at = now(), params = params - 'secret' WHERE id = $1 AND status = 'pending'", [r.task_id]);
        // Si ya está corriendo, el trabajador ve la marca y se detiene en el siguiente punto de control.
        await tx.exec("UPDATE document_tasks SET params = params || '{\"cancel\": true}'::jsonb WHERE id = $1 AND status = 'running'", [r.task_id]);
        await this.audit.log(tx, 'backup.cancelled', 'backup', id);
      }
      return this.backupJson((await tx.one<Record<string, any>>(`${this.selectBackup} WHERE b.id = $1`, [id]))!);
    });
  }

  async link(auth: AuthContext, id: string) {
    const r = await this.db.tx(this.ctx(auth), (tx) => tx.one<{ status: string }>('SELECT status FROM backups WHERE id = $1', [id]));
    if (!r) throw Problem.notFound();
    if (r.status !== 'done') throw new Problem(409, 'BACKUP_NOT_READY');
    // Un respaldo puede pesar varios GB: el enlace dura más y la descarga se reanuda con Range.
    const { token, expiresAt } = this.links.sign({ t: auth.tenantId, k: 'backup', i: id }, 3600);
    return { url: this.links.url(token), path: `/files/${token}`, expiresAt };
  }

  private async generate(task: TaskRow, progress: (p: number) => Promise<void>, cancelledFn: () => Promise<boolean>): Promise<null> {
    const tenantId = task.tenant_id;
    const { backupId, salt } = task.params as { backupId: string; salt: string };
    const blob = Buffer.from(task.params.secret as string, 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', this.config.dataKey, blob.subarray(0, 12));
    d.setAuthTag(blob.subarray(blob.length - 16));
    const key = Buffer.concat([d.update(blob.subarray(12, blob.length - 16)), d.final()]);
    const tenant = await this.tenants.get(tenantId);
    const stamp = this.clock.localStamp(tenant.timezone);
    const cancelled = async () => (await cancelledFn()) || !!(await this.db.tx({ tenantId }, (tx) => tx.one<{ c: boolean }>("SELECT (params->>'cancel')::boolean AS c FROM document_tasks WHERE id = $1", [task.id])))?.c;
    await this.db.tx({ tenantId }, (tx) => tx.exec("UPDATE backups SET status = 'running', progress = 0, error = NULL WHERE id = $1", [backupId]));

    const safeCo = tenant.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'Empresa';
    const fileName = `COROC_Respaldo_${safeCo}_${stamp.slice(0, 10)}_${stamp.slice(11, 13)}${stamp.slice(14, 16)}.coroc`;
    const prefix = crypto.randomBytes(8);
    const header: BackupHeader = {
      format: FORMAT, app: 'COROC', schema: latestSchema(), kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt, noncePrefix: prefix.toString('base64'),
      cipher: 'AES-256-GCM-CHUNKED', chunk: 64 * 1024, createdAt: stamp, company: tenant.name,
    };
    const headerLine = Buffer.from(`${JSON.stringify(header)}\n`);

    const result = await this.db.tx({ tenantId }, async (tx) => {
      const counts: Record<string, number> = {};
      for (const t of TABLES) counts[t.name] = Number((await tx.one<{ n: string }>(`SELECT count(*) AS n FROM ${t.name}`))!.n);
      const docs = await tx.many<{ id: string; storage_key: string; size_bytes: number; sha256: string }>('SELECT id, storage_key, size_bytes, sha256 FROM documents ORDER BY created_at, id');
      const totalUnits = Object.values(counts).reduce((a, b) => a + b, 0) + docs.length + 1;
      let units = 0;
      let lastReport = 0;
      let lastCheck = 0;
      const tick = async (n = 1) => {
        units += n;
        const now = Date.now();
        if (now - lastCheck > 1000) {
          lastCheck = now;
          if (await cancelled()) throw new TaskCancelled();
        }
        if (now - lastReport > 1000) {
          lastReport = now;
          const p = Math.floor((units / totalUnits) * 95);
          await progress(p);
          await this.db.tx({ tenantId }, (t2) => t2.exec('UPDATE backups SET progress = $2 WHERE id = $1', [backupId, p]));
        }
      };
      const files: Manifest['files'] = {};
      const zip = new yazl.ZipFile();
      const tableStream = (t: (typeof TABLES)[number]) => {
        const self = this;
        return Readable.from((async function* () {
          const cur = `c_${t.name}`;
          await tx.exec(`DECLARE ${cur} NO SCROLL CURSOR FOR SELECT to_jsonb(x) - 'tenant_id' ${(t.exclude ?? []).map((c) => `- '${c}'`).join(' ')} AS j FROM ${t.name} x ORDER BY ${t.order}`);
          for (;;) {
            const rows = await tx.many<{ j: unknown }>(`FETCH 500 FROM ${cur}`);
            if (!rows.length) break;
            yield Buffer.from(rows.map((r) => `${JSON.stringify(r.j)}\n`).join(''));
            await tick(rows.length);
          }
          await tx.exec(`CLOSE ${cur}`);
          void self;
        })());
      };
      for (const t of TABLES) {
        const p = `data/${t.name}.jsonl`;
        zip.addReadStreamLazy(p, { compress: true }, (cb: (e: any, s: NodeJS.ReadableStream) => void) => {
          cb(null, tableStream(t).pipe(new HashTap((r) => (files[p] = r))));
        });
      }
      for (const doc of docs) {
        const p = `files/${doc.id}`;
        zip.addReadStreamLazy(p, { compress: false }, (cb: (e: any, s: NodeJS.ReadableStream) => void) => {
          this.store.get(tenantId, doc.storage_key, Number(doc.size_bytes)).then(
            (s) => {
              const tap = new HashTap((r) => {
                files[p] = r;
                if (r.sha256 !== doc.sha256) tap.destroy(new IntegrityError(`El documento ${doc.id} no coincide con su huella`));
                void tick();
              });
              s.on('error', (e) => tap.destroy(e));
              cb(null, s.pipe(tap));
            },
            (e) => cb(e, undefined as unknown as NodeJS.ReadableStream),
          );
        });
      }
      const company = { name: tenant.name, taxId: tenant.taxId, phone: tenant.phone, email: tenant.email, address: tenant.address, city: tenant.city, country: tenant.country, currency: tenant.currency, timezone: tenant.timezone, lang: tenant.lang, settings: tenant.settings };
      // El manifiesto va al final: cuando yazl llega a él, todas las huellas ya están calculadas.
      zip.addReadStreamLazy('manifest.json', { compress: true }, (cb: (e: any, s: NodeJS.ReadableStream) => void) => {
        const m: Manifest = { format: FORMAT, app: 'COROC', schema: header.schema, createdAt: stamp, company, counts: { ...counts, files: docs.length }, files };
        cb(null, Readable.from([Buffer.from(JSON.stringify(m, null, 1))]));
      });
      zip.end();
      const seal = new SealStream(key, prefix, aadOf(headerLine), headerLine);
      const out = new PassThrough();
      zip.outputStream.on('error', (e: Error) => out.destroy(e));
      const objectKey = this.store.newKey(tenantId, 'backups');
      const [stored] = await Promise.all([this.store.put(tenantId, objectKey, out), pipeline(zip.outputStream, seal, out)]);
      return { stored, objectKey, counts: { ...counts, files: docs.length } };
    }, { snapshot: true });

    await this.db.tx({ tenantId }, async (tx) => {
      await tx.exec(
        "UPDATE backups SET status = 'done', progress = 100, storage_key = $2, size_bytes = $3, sha256 = $4, file_name = $5, manifest = $6, finished_at = now() WHERE id = $1",
        [backupId, result.objectKey, result.stored.size, result.stored.sha256, fileName, JSON.stringify({ format: FORMAT, schema: header.schema, counts: result.counts })],
      );
      await this.audit.log(tx, 'backup.created', 'backup', backupId, { after: { counts: result.counts, size: result.stored.size, sha256: result.stored.sha256 } }, task.created_by);
    });
    this.log.log(`Respaldo ${backupId} listo (${result.stored.size} bytes)`);
    return null;
  }

  // ─────────────────────────── Restauración ───────────────────────────
  restoreJson(r: Record<string, any>) {
    return {
      id: r.id, status: r.status, size: r.size_bytes === null ? null : Number(r.size_bytes), summary: r.summary ?? null,
      createdAt: new Date(r.created_at).toISOString(), appliedAt: r.applied_at ? new Date(r.applied_at).toISOString() : null,
    };
  }

  /** Recibe el `.coroc` por flujo y lo guarda cifrado (§19). Solo lee el encabezado; nada se descifra todavía. */
  async upload(auth: AuthContext, body: Readable, declared: number) {
    const max = this.config.restoreMaxBytes;
    if (declared > max) throw new Problem(413, 'FILE_TOO_LARGE', { mb: Math.round(max / 1024 / 1024) });
    const key = this.store.newKey(auth.tenantId, 'restores');
    let size = 0;
    const limit = new Transform({
      transform(c: Buffer, _e, cb) {
        size += c.length;
        if (size > max) cb(new Problem(413, 'FILE_TOO_LARGE', { mb: Math.round(max / 1024 / 1024) }));
        else cb(null, c);
      },
    });
    body.on('error', (e) => limit.destroy(e));
    const stored = await this.store.put(auth.tenantId, key, body.pipe(limit));
    const header = await this.readHeader(auth.tenantId, key, stored.size).catch(() => null);
    const row = await this.db.tx(this.ctx(auth), async (tx) => {
      const r = await tx.one<Record<string, any>>(
        `INSERT INTO restores (tenant_id, status, storage_key, size_bytes, header, error, created_by) VALUES (current_tenant(), $1, $2, $3, $4, $5, $6) RETURNING *`,
        [header?.format === FORMAT ? 'uploaded' : 'failed', key, stored.size, header ? JSON.stringify(header) : null, header?.format === FORMAT ? null : 'format', auth.userId],
      );
      await this.audit.log(tx, 'restore.uploaded', 'restore', r!.id, { after: { size: stored.size, format: header?.format ?? null } });
      return r!;
    });
    if (!header || (header.format !== FORMAT && header.format !== LEGACY_FORMAT)) throw new Problem(422, 'BACKUP_NOT_COROC');
    // Los respaldos de la app local de la Fase 0 guardan otro modelo de datos: no se restauran en el servidor (ADR-034).
    if (header.format === LEGACY_FORMAT) throw new Problem(422, 'BACKUP_FORMAT_UNSUPPORTED');
    return this.restoreJson(row);
  }

  private async readHeader(tenantId: string, key: string, size: number): Promise<{ header: BackupHeader; line: Buffer } & BackupHeader> {
    const head = await readAll(await this.store.get(tenantId, key, size, { start: 0, end: Math.min(size, MAX_HEADER) - 1 }));
    const nl = head.indexOf(10);
    if (nl < 0) throw new Problem(422, 'BACKUP_NOT_COROC');
    const line = head.subarray(0, nl + 1);
    const header = JSON.parse(line.toString('utf8')) as BackupHeader;
    return { ...header, header, line };
  }

  /** Descifra el `.coroc` a un ZIP temporal (0600) y verifica cada archivo contra el manifiesto. */
  private async open(tenantId: string, restore: Record<string, any>, password: string): Promise<{ dir: string; zipPath: string; manifest: Manifest; header: BackupHeader }> {
    const size = Number(restore.size_bytes);
    const { header, line } = await this.readHeader(tenantId, restore.storage_key, size);
    if (header.format === LEGACY_FORMAT) throw new Problem(422, 'BACKUP_FORMAT_UNSUPPORTED');
    if (header.format !== FORMAT || header.kdf !== 'PBKDF2-SHA256' || header.cipher !== 'AES-256-GCM-CHUNKED') throw new Problem(422, 'BACKUP_NOT_COROC');
    if (header.schema > latestSchema()) throw new Problem(422, 'BACKUP_TOO_NEW', { version: header.schema });
    const key = await pbkdf2(password, Buffer.from(header.salt, 'base64'), header.iterations, 32, 'sha256');
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'coroc-restore-'));
    await fs.promises.chmod(dir, 0o700);
    const zipPath = path.join(dir, 'backup.zip');
    try {
      const body = await this.store.get(tenantId, restore.storage_key, size, { start: line.length, end: size - 1 });
      await pipeline(body, new UnsealStream(key, Buffer.from(header.noncePrefix, 'base64'), 0, null, undefined, aadOf(line)), fs.createWriteStream(zipPath, { mode: 0o600 }));
    } catch (e) {
      await fs.promises.rm(dir, { recursive: true, force: true });
      if (e instanceof IntegrityError) throw new Problem(422, 'BACKUP_PASSWORD_OR_DAMAGED');
      throw e;
    }
    try {
      const { zip, entries } = await this.openZip(zipPath);
      const me = entries.get('manifest.json');
      if (!me) throw new Problem(422, 'BACKUP_INTEGRITY', { n: 1 });
      const manifest = JSON.parse((await readAll(await zip.openReadStreamPromise(me))).toString('utf8')) as Manifest;
      const bad: string[] = [];
      for (const [p, meta] of Object.entries(manifest.files)) {
        const e = entries.get(p);
        if (!e) {
          bad.push(p);
          continue;
        }
        const h = crypto.createHash('sha256');
        let n = 0;
        for await (const c of await zip.openReadStreamPromise(e)) {
          h.update(c as Buffer);
          n += (c as Buffer).length;
        }
        if (h.digest('hex') !== meta.sha256 || n !== meta.size) bad.push(p);
      }
      for (const p of entries.keys()) if (p !== 'manifest.json' && !manifest.files[p]) bad.push(p);
      zip.close();
      if (bad.length) throw new Problem(422, 'BACKUP_INTEGRITY', { n: bad.length });
      return { dir, zipPath, manifest, header };
    } catch (e) {
      await fs.promises.rm(dir, { recursive: true, force: true });
      throw e;
    }
  }

  private summary(manifest: Manifest, header: BackupHeader, size: number) {
    return { company: String(manifest.company.name ?? header.company), createdAt: manifest.createdAt, format: manifest.format, schema: manifest.schema, counts: manifest.counts, documents: manifest.counts.documents ?? 0, bytes: size };
  }

  private async restoreRow(auth: AuthContext, id: string) {
    const r = await this.db.tx(this.ctx(auth), (tx) => tx.one<Record<string, any>>('SELECT * FROM restores WHERE id = $1', [id]));
    if (!r) throw Problem.notFound();
    if (r.status === 'applied') throw new Problem(409, 'RESTORE_ALREADY_APPLIED');
    if (r.status === 'failed' || r.status === 'uploading') throw new Problem(422, 'BACKUP_NOT_COROC');
    return r;
  }

  /** Verificación de integridad y versión + simulación (§19): «se restaurarán N clientes, M préstamos y D documentos». */
  async verify(auth: AuthContext, id: string, password: string) {
    const r = await this.restoreRow(auth, id);
    const { dir, manifest, header } = await this.open(auth.tenantId, r, password);
    await fs.promises.rm(dir, { recursive: true, force: true });
    const summary = this.summary(manifest, header, Number(r.size_bytes));
    return this.db.tx(this.ctx(auth), async (tx) => {
      const row = await tx.one<Record<string, any>>("UPDATE restores SET status = 'verified', summary = $2 WHERE id = $1 RETURNING *", [id, JSON.stringify(summary)]);
      await this.audit.log(tx, 'restore.verified', 'restore', id, { after: { counts: manifest.counts } });
      return this.restoreJson(row!);
    });
  }

  /**
   * Restauración atómica (§19, solo Propietario): primero sube los documentos a la empresa destino y verifica su huella;
   * después, en una sola transacción, retira los datos actuales, inserta los del respaldo con identificadores nuevos,
   * reconstruye el estado derivado y compara los conteos con el manifiesto. Si algo falla, no cambia nada.
   */
  async apply(auth: AuthContext, id: string, password: string, confirmName: string) {
    const tenant = await this.tenants.get(auth.tenantId);
    const norm = (s: string) => s.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
    if (norm(confirmName) !== norm(tenant.name)) throw new Problem(422, 'RESTORE_CONFIRM_NAME', {}, [{ field: 'confirmName', message: 'other' }]);
    const r = await this.restoreRow(auth, id);
    const { dir, zipPath, manifest } = await this.open(auth.tenantId, r, password);
    const uploaded: string[] = [];
    // Identificadores nuevos deterministas: el mismo identificador del respaldo da siempre el mismo identificador nuevo en
    // esta restauración, así que las referencias entre tablas se conservan sin guardar un mapa de millones de filas, y el
    // respaldo se puede restaurar en otra empresa del mismo servidor sin chocar con los datos originales.
    const merged = new Map<string, string>();
    const remap = (v: string) => {
      const m = merged.get(v);
      if (m) return m;
      const h = crypto.createHash('sha256').update(`${auth.tenantId}:${id}:${v}`).digest();
      h[6] = (h[6]! & 0x0f) | 0x40;
      h[8] = (h[8]! & 0x3f) | 0x80;
      const x = h.subarray(0, 16).toString('hex');
      return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
    };
    const { zip, entries } = await this.openZip(zipPath);
    try {
      // 1) Documentos a la empresa destino, cifrados con su clave, verificando la huella de cada uno.
      const storageOf = new Map<string, string>();
      for await (const batch of this.batches(zip, entries, 'documents')) {
        for (const doc of batch) {
          const e = entries.get(`files/${doc.id}`);
          if (!e) throw new Problem(422, 'BACKUP_INTEGRITY', { n: 1 });
          const key = this.store.newKey(auth.tenantId, 'documents');
          uploaded.push(key);
          const stored = await this.store.put(auth.tenantId, key, await zip.openReadStreamPromise(e));
          if (stored.sha256 !== doc.sha256) throw new Problem(422, 'BACKUP_INTEGRITY', { n: 1 });
          storageOf.set(doc.id, key);
        }
      }

      // 2) Todo lo demás en una sola transacción.
      const counts = await this.db.tx(this.ctx(auth), async (tx) => {
        await tx.exec('SELECT purge_tenant_data(current_tenant())');
        // Los usuarios que ya existen con el mismo nombre de usuario se conservan (incluido quien restaura).
        const existing = new Map((await tx.many<{ id: string; username: string }>('SELECT id, username FROM users')).map((u) => [u.username.toLowerCase(), u.id]));
        let mergedUsers = 0;
        const uuidCols = await this.uuidColumns(tx);
        const insertable = await this.insertableColumns(tx);
        for (const t of TABLES) {
          for await (const batch of this.batches(zip, entries, t.name)) {
            let rows = batch;
            if (t.name === 'users') {
              rows = batch.filter((u) => {
                const same = existing.get(String(u.username).toLowerCase());
                if (same) {
                  merged.set(u.id, same);
                  mergedUsers++;
                }
                return !same;
              });
            }
            const out = rows.map((row) => {
              const o: Record<string, unknown> = { ...row, tenant_id: auth.tenantId };
              for (const c of uuidCols.get(t.name) ?? []) {
                if (c === 'tenant_id' || o[c] === null || o[c] === undefined) continue;
                o[c] = remap(String(o[c]));
              }
              if (t.name === 'documents') o.storage_key = storageOf.get(row.id);
              if (t.name === 'intake_events') {
                o.upload_link_id = null; // los enlaces de carga no viajan en el respaldo
                // Los clientes sugeridos y el comprobante duplicado van dentro del JSON de la identificación.
                if (o.identification) o.identification = JSON.parse(JSON.stringify(o.identification).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (u) => remap(u)));
              }
              if (t.name === 'users') Object.assign(o, { failed_attempts: 0, lockouts: 0, locked_until: null });
              return o;
            });
            if (!out.length) continue;
            if (t.name === 'number_sequences') {
              for (const s of out) await tx.exec('INSERT INTO number_sequences (tenant_id, name, prefix, last_value) VALUES (current_tenant(), $1, $2, $3) ON CONFLICT (tenant_id, name) DO UPDATE SET prefix = EXCLUDED.prefix, last_value = EXCLUDED.last_value', [s.name, s.prefix, s.last_value]);
              continue;
            }
            const list = (insertable.get(t.name) ?? []).filter((c) => c in out[0]!).map((c) => `"${c}"`).join(', ');
            await tx.exec(`INSERT INTO ${t.name} (${list}) SELECT ${list} FROM json_populate_recordset(NULL::coroc.${t.name}, $1::json)`, [JSON.stringify(out)]);
          }
        }
        // Empresa: datos y configuración del respaldo; el identificador corto de ingreso no cambia.
        const c = manifest.company as Record<string, any>;
        await tx.exec(
          `UPDATE tenants SET name = $1, tax_id = $2, phone = $3, email = $4, address = $5, city = $6, timezone = $7, lang = $8::lang_code, settings = $9, version = version + 1 WHERE id = current_tenant()`,
          [c.name ?? tenant.name, c.taxId ?? null, c.phone ?? null, c.email ?? null, c.address ?? null, c.city ?? null, c.timezone ?? tenant.timezone, c.lang ?? tenant.lang, JSON.stringify(c.settings ?? {})],
        );
        // Derivados: estado de cada préstamo y recaudo diario, desde el libro restaurado.
        const today = this.clock.today(String(c.timezone ?? tenant.timezone));
        const loanIds = (await tx.many<{ id: string }>('SELECT id FROM loans ORDER BY id')).map((x) => x.id);
        for (let i = 0; i < loanIds.length; i += 500) {
          for (const l of await this.state.loadMany(tx, loanIds.slice(i, i + 500))) await this.state.recompute(tx, l, today);
        }
        await tx.exec(
          `SELECT bump_daily_collection(x.currency, x.day, x.amount, x.n) FROM (
             SELECT l.currency, e.entry_date AS day, sum(e.amount)::bigint AS amount, count(*)::int AS n
               FROM ledger_entries e JOIN loans l ON l.id = e.loan_id
              WHERE e.type = 'payment' AND NOT EXISTS (SELECT 1 FROM ledger_entries r WHERE r.reverses_id = e.id)
              GROUP BY l.currency, e.entry_date) x`,
        );
        const got: Record<string, number> = {};
        for (const t of TABLES) got[t.name] = Number((await tx.one<{ n: string }>(`SELECT count(*) AS n FROM ${t.name}`))!.n);
        const expected = (name: string) => (manifest.counts[name] ?? 0) + (name === 'users' ? existing.size - mergedUsers : 0);
        // El registro de esta restauración se agrega a la bitácora después de comparar.
        const mismatch = TABLES.filter((t) => got[t.name] !== expected(t.name));
        if (mismatch.length) {
          this.log.warn(`Conteos distintos al restaurar: ${mismatch.map((t) => `${t.name} ${got[t.name]}/${expected(t.name)}`).join(', ')}`);
          throw new Problem(422, 'BACKUP_INTEGRITY', { n: mismatch.length });
        }
        await tx.exec("UPDATE restores SET status = 'applied', applied_at = now() WHERE id = $1", [id]);
        await this.audit.log(tx, 'backup.restored', 'restore', id, { after: { counts: manifest.counts, createdAt: manifest.createdAt } });
        return got;
      });
      this.tenants.invalidate(auth.tenantId);
      this.log.log(`Restauración ${id} aplicada: ${JSON.stringify(counts)}`);
    } catch (e) {
      for (const k of uploaded) await this.store.remove(k).catch(() => undefined);
      throw e;
    } finally {
      zip.close();
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
    return this.restoreJson((await this.db.tx(this.ctx(auth), (tx) => tx.one<Record<string, any>>('SELECT * FROM restores WHERE id = $1', [id])))!);
  }

  private async openZip(zipPath: string) {
    const zip = await yauzl.openPromise(zipPath, { autoClose: false, strictFileNames: true });
    const entries = new Map<string, yauzl.Entry>();
    for await (const e of zip.eachEntry()) entries.set(e.fileName, e);
    return { zip, entries };
  }

  /** Filas de una tabla del respaldo, de 500 en 500, leídas por flujo (sin cargar el archivo completo). */
  private async *batches(zip: yauzl.ZipFile, entries: Map<string, yauzl.Entry>, table: string): AsyncGenerator<Record<string, any>[]> {
    const e = entries.get(`data/${table}.jsonl`);
    if (!e) return;
    const rl = readline.createInterface({ input: await zip.openReadStreamPromise(e), crlfDelay: Infinity });
    let batch: Record<string, any>[] = [];
    for await (const line of rl) {
      if (!line) continue;
      batch.push(JSON.parse(line));
      if (batch.length === 500) {
        yield batch;
        batch = [];
      }
    }
    if (batch.length) yield batch;
  }

  private async uuidColumns(tx: Tx): Promise<Map<string, string[]>> {
    const rows = await tx.many<{ t: string; c: string }>("SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = 'coroc' AND data_type = 'uuid'");
    const m = new Map<string, string[]>();
    for (const r of rows) (m.get(r.t) ?? m.set(r.t, []).get(r.t)!).push(r.c);
    return m;
  }

  /** Columnas que se pueden insertar: sin las generadas ni las de identidad (compatibles con respaldos anteriores). */
  private async insertableColumns(tx: Tx): Promise<Map<string, string[]>> {
    const rows = await tx.many<{ t: string; c: string }>(
      `SELECT table_name AS t, column_name AS c FROM information_schema.columns
        WHERE table_schema = 'coroc' AND is_generated = 'NEVER' AND NOT (is_identity = 'YES' AND identity_generation = 'ALWAYS')
        ORDER BY ordinal_position`,
    );
    const m = new Map<string, string[]>();
    for (const r of rows) (m.get(r.t) ?? m.set(r.t, []).get(r.t)!).push(r.c);
    return m;
  }
}
