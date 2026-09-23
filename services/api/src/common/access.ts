import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { DbService, type Tx } from '../db/db.service.js';
import type { AuthContext } from './context.js';
import { Problem } from './problem.js';

/**
 * Cuando RLS oculta una fila, distingue «no existe» (404) de «pertenece a otro cobrador» (403 + bitácora, CA-16).
 * El registro del intento se hace en su propia transacción para que quede aunque la petición falle.
 */
@Injectable()
export class AccessService {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  async deny(tx: Tx, auth: AuthContext, entity: 'client' | 'loan', id: string): Promise<never> {
    const fn = entity === 'client' ? 'client_collector' : 'loan_collector';
    const r = await tx.one<{ found: boolean; collector_id: string | null }>(`SELECT * FROM ${fn}($1)`, [id]);
    if (r?.found && auth.role === 'collector') {
      await this.db.tx({ tenantId: auth.tenantId, userId: auth.userId, role: auth.role }, (t2) =>
        this.audit.log(t2, 'access.denied', entity, id, { after: { role: auth.role, reason: 'not_assigned' } }),
      );
      throw new Problem(403, 'ACCESS_DENIED');
    }
    throw Problem.notFound();
  }
}
