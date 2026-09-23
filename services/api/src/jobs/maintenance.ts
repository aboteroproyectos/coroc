import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { Clock } from '../common/clock.js';
import { TenantCache } from '../company/tenant-cache.js';
import { CONFIG, type AppConfig } from '../config.js';
import { DbService } from '../db/db.service.js';
import { DocumentTasks } from '../documents/tasks.js';
import { LoanStateService } from '../loans/loan-state.service.js';
import { MessagingService } from '../messaging/messaging.service.js';

/**
 * Trabajo de cada hora: pone al día el estado de los préstamos cuando cambia la fecha en la zona de cada empresa
 * (vencidos, días de mora y mora causada). Con Redis corre en BullMQ, una sola vez aunque haya varias instancias.
 */
@Injectable()
export class MaintenanceJobs implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Mantenimiento');
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: DbService,
    private readonly state: LoanStateService,
    private readonly tenants: TenantCache,
    private readonly clock: Clock,
    private readonly tasks: DocumentTasks,
    private readonly messaging: MessagingService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async runOnce(): Promise<number> {
    const ids = await this.db.tx(null, (tx) => tx.many<{ id: string }>('SELECT active_tenant_ids() AS id'));
    let total = 0;
    for (const { id } of ids) {
      const t = await this.tenants.get(id);
      total += await this.state.refreshStale({ tenantId: id }, this.clock.today(t.timezone));
    }
    if (total) this.log.log(`${total} préstamos puestos al día`);
    await this.monthlyStatements();
    // Recordatorios y avisos de vencimiento del día (§11.3), después de poner al día el estado de los préstamos.
    const queued = await this.messaging.scheduleCollections();
    if (queued) this.log.log(`${queued} mensajes de cobranza en cola`);
    await this.messaging.dispatchDue();
    return total;
  }

  /**
   * Estado de cuenta mensual de cada préstamo activo (§16.4), el primer día del mes en la zona de la empresa. La tarea
   * guarda el período, así que correr este trabajo varias veces el mismo día no duplica documentos.
   */
  async monthlyStatements(): Promise<number> {
    const ids = await this.db.tx(null, (tx) => tx.many<{ id: string }>('SELECT tenants_with_active_loans() AS id'));
    let n = 0;
    for (const { id } of ids) {
      const t = await this.tenants.get(id);
      const today = this.clock.today(t.timezone);
      if (!today.endsWith('-01')) continue;
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() - 1);
      const period = d.toISOString().slice(0, 7);
      const rows = await this.db.tx({ tenantId: id }, async (tx) => {
        const tasks = await tx.many<{ id: string; loan_id: string }>(
          `INSERT INTO document_tasks (tenant_id, kind, loan_id, params)
           SELECT current_tenant(), 'statement', l.id, jsonb_build_object('reason', 'monthly', 'period', $1::text)
             FROM loans l
            WHERE l.status = 'active'
              AND NOT EXISTS (SELECT 1 FROM document_tasks x WHERE x.loan_id = l.id AND x.kind = 'statement' AND x.params->>'period' = $1)
           RETURNING id, loan_id`,
          [period],
        );
        // «Estado de cuenta» mensual por correo (§11.3), con el PDF adjunto cuando termine de generarse.
        const messages: Record<string, any>[] = [];
        for (const task of tasks) messages.push(...(await this.messaging.enqueueTx(tx, id, { event: 'statement', loanId: task.loan_id, documentTaskId: task.id, dedupeKey: `statement:${task.loan_id}:${period}` })));
        return { count: tasks.length, messages };
      });
      n += rows.count;
      this.messaging.published(id, rows.messages);
    }
    if (n) {
      this.log.log(`${n} estados de cuenta mensuales en cola`);
      this.tasks.kick();
    }
    return n;
  }

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.COROC_JOBS === 'off') return;
    if (this.config.redisUrl) {
      const connection = { url: this.config.redisUrl };
      this.queue = new Queue('coroc-maintenance', { connection });
      await this.queue.upsertJobScheduler('loan-state-hourly', { pattern: '7 * * * *' }, { name: 'loan-state' });
      this.worker = new Worker('coroc-maintenance', async () => this.runOnce(), { connection, concurrency: 1 });
    } else {
      this.timer = setInterval(() => void this.runOnce().catch((e) => this.log.error(e.message)), 3600_000);
      this.timer.unref();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.worker?.close();
    await this.queue?.close();
  }
}
