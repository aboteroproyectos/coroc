import { Body, Controller, Get, Injectable, Post, Put } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../common/context.js';
import { Auth, Op, Requires } from '../common/decorators.js';
import { Problem } from '../common/problem.js';
import { TenantCache } from '../company/tenant-cache.js';
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

/**
 * Política de la empresa ante el tope de tasa (P-6, ADR-061). «block» impide crear préstamos por encima del tope (y, en
 * Colombia, sin tope registrado). «warn» los permite con confirmación en cada préstamo: solo el Propietario la activa,
 * aceptando expresamente la responsabilidad legal (en Colombia la usura es delito, art. 305 del Código Penal).
 */
@Controller('compliance/rate-cap-policy')
export class RateCapPolicyController {
  constructor(private readonly db: DbService, private readonly audit: AuditService, private readonly tenants: TenantCache) {}

  @Put()
  @Requires('compliance.manage')
  @Op('setRateCapPolicy')
  async set(@Auth() a: AuthContext, @Body() b: { policy: 'block' | 'warn'; acceptResponsibility?: boolean }) {
    if (a.role !== 'owner') throw new Problem(403, 'OWNER_REQUIRED');
    if (b.policy === 'warn' && b.acceptResponsibility !== true) throw new Problem(422, 'VALIDATION_FAILED', {}, [{ field: 'acceptResponsibility', message: 'required' }]);
    const out = await this.db.tx({ tenantId: a.tenantId, userId: a.userId, role: a.role }, async (tx) => {
      const before = await tx.one<Record<string, any>>('SELECT settings FROM tenants WHERE id = current_tenant() FOR UPDATE');
      const previous = before?.settings?.rateCapPolicy ?? 'block';
      const acceptedAt = b.policy === 'warn' ? (previous === 'warn' ? before?.settings?.rateCapPolicyAcceptedAt ?? new Date().toISOString() : new Date().toISOString()) : null;
      const acceptedBy = b.policy === 'warn' ? (previous === 'warn' ? before?.settings?.rateCapPolicyAcceptedBy ?? a.userId : a.userId) : null;
      await tx.exec(
        `UPDATE tenants SET settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('rateCapPolicy', $1::text, 'rateCapPolicyAcceptedAt', $2::text, 'rateCapPolicyAcceptedBy', $3::text),
                version = version + 1 WHERE id = current_tenant()`,
        [b.policy, acceptedAt, acceptedBy],
      );
      if (previous !== b.policy) await this.audit.log(tx, 'compliance.rate_cap_policy', 'company', a.tenantId, { before: { rateCapPolicy: previous }, after: { rateCapPolicy: b.policy, acceptResponsibility: b.policy === 'warn' } });
      return { policy: b.policy, acceptedAt, acceptedBy };
    });
    this.tenants.invalidate(a.tenantId);
    return out;
  }
}
