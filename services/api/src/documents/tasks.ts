import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config.js';
import { DbService, type Tx } from '../db/db.service.js';

export type TaskKind = 'schedule' | 'receipt' | 'receipt_void' | 'statement' | 'payoff' | 'report' | 'backup';

export interface TaskRow {
  id: string;
  tenant_id: string;
  kind: TaskKind;
  loan_id: string | null;
  entry_id: string | null;
  params: Record<string, any>;
  status: string;
  attempts: number;
  created_by: string | null;
}

/** Ejecuta una tarea y devuelve el documento generado (si hay uno). `progress` informa el avance (0–100). */
export type TaskHandler = (task: TaskRow, progress: (p: number) => Promise<void>, cancelled: () => Promise<boolean>) => Promise<string | null>;

export class TaskCancelled extends Error {}

const MAX_ATTEMPTS = 6;

/**
 * Tareas de documentos con bandeja de salida transaccional (ADR-032). Se registran en la misma transacción del hecho que
 * las origina (pago, reverso, préstamo nuevo) y un trabajador las ejecuta después del commit, con reintentos
 * exponenciales. Varias instancias de la API pueden trabajar a la vez: cada una toma tareas distintas con
 * `FOR UPDATE SKIP LOCKED`, y las de un mismo préstamo se ejecutan en orden.
 */
@Injectable()
export class DocumentTasks implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Documentos');
  private readonly handlers = new Map<TaskKind, TaskHandler>();
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private stopped = false;

  constructor(private readonly db: DbService, @Inject(CONFIG) private readonly config: AppConfig) {}

  register(kind: TaskKind, handler: TaskHandler): void {
    this.handlers.set(kind, handler);
  }

  /** Registra la tarea dentro de la transacción del llamador. Con `dedupeKey`, se funde con otra igual que aún espera. */
  async enqueue(tx: Tx, t: { kind: TaskKind; loanId?: string | null; entryId?: string | null; params?: Record<string, unknown>; dedupeKey?: string | null; createdBy?: string | null; delaySeconds?: number }): Promise<string> {
    const row = await tx.one<{ id: string }>(
      `INSERT INTO document_tasks (tenant_id, kind, loan_id, entry_id, params, dedupe_key, created_by, run_after)
       VALUES (current_tenant(), $1, $2, $3, $4, $5, $6, now() + make_interval(secs => $7))
       ON CONFLICT (tenant_id, dedupe_key) WHERE status = 'pending' AND dedupe_key IS NOT NULL DO NOTHING RETURNING id`,
      [t.kind, t.loanId ?? null, t.entryId ?? null, JSON.stringify(t.params ?? {}), t.dedupeKey ?? null, t.createdBy ?? null, t.delaySeconds ?? 0],
    );
    if (row) return row.id;
    return (await tx.one<{ id: string }>("SELECT id FROM document_tasks WHERE dedupe_key = $1 AND status = 'pending'", [t.dedupeKey]))!.id;
  }

  /** Pide procesar pronto (después del commit que registró tareas). */
  kick(): void {
    if (this.config.documentWorker === 'off' || this.stopped) return;
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = this.drain().finally(() => {
      this.running = null;
      if (this.again && !this.stopped) {
        this.again = false;
        this.kick();
      }
    });
  }

  /** Espera a que no quede nada por hacer (pruebas y cierre ordenado). */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  private async drain(): Promise<void> {
    for (;;) {
      const claimed = await this.db.tx(null, (tx) => tx.many<{ id: string; tenant_id: string }>('SELECT * FROM claim_document_tasks($1, $2)', [8, 600]));
      if (!claimed.length) return;
      // Las tareas de un mismo préstamo se ejecutan en el orden en que se registraron (el recibo antes que su anulación).
      const groups = new Map<string, { id: string; tenant_id: string }[]>();
      for (const c of claimed) {
        const t = await this.db.tx({ tenantId: c.tenant_id }, (tx) => tx.one<{ loan_id: string | null }>('SELECT loan_id FROM document_tasks WHERE id = $1', [c.id]));
        const key = t?.loan_id ?? c.id;
        (groups.get(key) ?? groups.set(key, []).get(key)!).push(c);
      }
      await Promise.all([...groups.values()].map(async (g) => {
        for (const c of g) await this.runOne(c.id, c.tenant_id);
      }));
    }
  }

  private async runOne(id: string, tenantId: string): Promise<void> {
    const ctx = { tenantId };
    const task = await this.db.tx(ctx, (tx) => tx.one<TaskRow>('SELECT * FROM document_tasks WHERE id = $1', [id]));
    if (!task || task.status !== 'running') return;
    const handler = this.handlers.get(task.kind);
    try {
      if (!handler) throw new Error(`Sin manejador para ${task.kind}`);
      const progress = async (p: number) => {
        await this.db.tx(ctx, (tx) => tx.exec('UPDATE document_tasks SET progress = $2, locked_until = now() + interval \'10 minutes\' WHERE id = $1', [id, Math.max(0, Math.min(99, Math.round(p)))]));
      };
      const cancelled = async () => (await this.db.tx(ctx, (tx) => tx.one<{ status: string }>('SELECT status FROM document_tasks WHERE id = $1', [id])))?.status === 'cancelled';
      const documentId = await handler(task, progress, cancelled);
      await this.db.tx(ctx, (tx) => tx.exec("UPDATE document_tasks SET status = 'done', progress = 100, document_id = $2, finished_at = now(), error = NULL WHERE id = $1 AND status = 'running'", [id, documentId]));
    } catch (e) {
      if (e instanceof TaskCancelled) {
        await this.db.tx(ctx, (tx) => tx.exec("UPDATE document_tasks SET status = 'cancelled', finished_at = now() WHERE id = $1", [id]));
        return;
      }
      // El mensaje de error es técnico y no lleva datos personales (§2 regla 9).
      const message = (e as Error).message?.slice(0, 500) ?? 'Error';
      const final = task.attempts >= MAX_ATTEMPTS;
      this.log.warn(`Tarea ${task.kind} ${id} falló (intento ${task.attempts}): ${message}`);
      await this.db.tx(ctx, (tx) =>
        tx.exec(
          `UPDATE document_tasks SET status = $2, error = $3, locked_until = NULL, finished_at = CASE WHEN $2 = 'failed' THEN now() END,
                  run_after = now() + make_interval(secs => $4) WHERE id = $1`,
          [id, final ? 'failed' : 'pending', message, Math.min(3600, 5 * 2 ** task.attempts)],
        ),
      );
    }
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.documentWorker !== 'on') return;
    // Sondeo de respaldo: toma las tareas de otras instancias que cayeron y los reintentos programados.
    this.timer = setInterval(() => this.kick(), 5_000);
    this.timer.unref();
    this.kick();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.idle().catch(() => undefined);
  }
}
