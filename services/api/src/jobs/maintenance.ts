import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { Clock } from '../common/clock.js';
import { TenantCache } from '../company/tenant-cache.js';
import { CONFIG, type AppConfig } from '../config.js';
import { DbService } from '../db/db.service.js';
import { LoanStateService } from '../loans/loan-state.service.js';

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
    return total;
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
