import { Injectable } from '@nestjs/common';
import { currentMeta } from '../common/context.js';
import type { Tx } from '../db/db.service.js';

/** Bitácora inmutable (§7.3): quién, qué, cuándo, desde qué dispositivo, valor anterior y nuevo. */
@Injectable()
export class AuditService {
  async log(tx: Tx, action: string, entity: string, entityId: string | null, change: { before?: unknown; after?: unknown } = {}, userId?: string | null): Promise<void> {
    const meta = currentMeta();
    await tx.exec(
      `INSERT INTO audit_log (tenant_id, user_id, device_id, ip, action, entity, entity_id, before, after)
       VALUES (current_tenant(), $1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId ?? tx.ctx?.userId ?? null, meta?.deviceId ?? null, meta?.ip ?? null, action, entity, entityId, change.before === undefined ? null : JSON.stringify(change.before), change.after === undefined ? null : JSON.stringify(change.after)],
    );
  }
}
