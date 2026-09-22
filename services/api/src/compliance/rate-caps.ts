import { Body, Controller, Get, Injectable, Post } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../common/context.js';
import { Auth, Op, Requires } from '../common/decorators.js';
import { Problem } from '../common/problem.js';
import { DbService, type Tx } from '../db/db.service.js';

export interface RateCapRow {
  id: string;
  country: string;
  effectiveAnnual: number;
  validFrom: string;
  validTo: string;
  source: string;
}

const capJson = (r: Record<string, any>): RateCapRow => ({ id: r.id, country: r.country, effectiveAnnual: Number(r.effective_annual), validFrom: r.valid_from, validTo: r.valid_to, source: r.source });

/** Tope legal de tasa (§9.6): tasa de usura certificada por la Superintendencia Financiera y su vigencia. */
@Injectable()
export class RateCapService {
  async current(tx: Tx, country: string, day: string): Promise<RateCapRow | null> {
    const r = await tx.one('SELECT * FROM rate_caps WHERE country = $1 AND $2::date BETWEEN valid_from AND valid_to ORDER BY valid_from DESC LIMIT 1', [country, day]);
    return r ? capJson(r) : null;
  }
}

@Controller('compliance/rate-caps')
export class RateCapsController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  @Get()
  @Requires('compliance.view')
  @Op('listRateCaps')
  list(@Auth() a: AuthContext) {
    return this.db.tx({ tenantId: a.tenantId, userId: a.userId, role: a.role }, async (tx) => (await tx.many('SELECT * FROM rate_caps ORDER BY valid_from DESC')).map(capJson));
  }

  @Post()
  @Requires('compliance.manage')
  @Op('addRateCap')
  add(@Auth() a: AuthContext, @Body() b: { country: string; effectiveAnnual: number; validFrom: string; validTo: string; source: string }) {
    if (b.validTo < b.validFrom) throw new Problem(422, 'VALIDATION_FAILED', {}, [{ field: 'validTo', message: 'minimum' }]);
    return this.db.tx({ tenantId: a.tenantId, userId: a.userId, role: a.role }, async (tx) => {
      const r = await tx.one<Record<string, any>>(
        `INSERT INTO rate_caps (tenant_id, country, effective_annual, valid_from, valid_to, source, created_by)
         VALUES (current_tenant(), $1, $2, $3, $4, $5, $6) RETURNING *`,
        [b.country, b.effectiveAnnual, b.validFrom, b.validTo, b.source.trim(), a.userId],
      );
      await this.audit.log(tx, 'rate_cap.added', 'rate_cap', r!.id, { after: b });
      return capJson(r!);
    });
  }
}
