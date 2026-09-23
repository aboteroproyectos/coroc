import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../common/context.js';
import { Auth, Op, Requires } from '../common/decorators.js';
import { Problem } from '../common/problem.js';
import { DbService } from '../db/db.service.js';
import { TenantCache, tenantRow, type TenantInfo } from './tenant-cache.js';

export const companyJson = (t: TenantInfo) => ({
  id: t.id, slug: t.slug, name: t.name, taxId: t.taxId, phone: t.phone, email: t.email, address: t.address, city: t.city,
  country: t.country, currency: t.currency, timezone: t.timezone, lang: t.lang, settings: t.settings, version: t.version,
});

const accountJson = (r: Record<string, any>) => ({ id: r.id, holderName: r.holder_name, institution: r.institution, last4: r.last4, active: r.active });

@Controller()
export class CompanyController {
  constructor(private readonly db: DbService, private readonly audit: AuditService, private readonly tenants: TenantCache) {}

  private ctx(a: AuthContext) {
    return { tenantId: a.tenantId, userId: a.userId, role: a.role };
  }

  @Get('company')
  @Requires('company.view')
  @Op('getCompany')
  async get(@Auth() a: AuthContext) {
    return companyJson(await this.tenants.get(a.tenantId));
  }

  @Patch('company')
  @Requires('company.edit')
  @Op('updateCompany')
  async update(@Auth() a: AuthContext, @Body() b: Record<string, any>, @Headers('if-match') ifMatch?: string) {
    const out = await this.db.tx(this.ctx(a), async (tx) => {
      const before = await tx.one<Record<string, any>>('SELECT * FROM tenants WHERE id = current_tenant() FOR UPDATE');
      if (ifMatch && String(before!.version) !== ifMatch.replace(/"/g, '')) throw new Problem(409, 'VERSION_CONFLICT');
      if (b.timezone) {
        try {
          new Intl.DateTimeFormat('en', { timeZone: b.timezone });
        } catch {
          throw new Problem(422, 'VALIDATION_FAILED', {}, [{ field: 'timezone', message: 'enum' }]);
        }
      }
      const settings = b.settings ? { ...(before!.settings ?? {}), ...b.settings, prefixes: { ...(before!.settings?.prefixes ?? {}), ...(b.settings.prefixes ?? {}) } } : before!.settings;
      const row = await tx.one<Record<string, any>>(
        `UPDATE tenants SET name = coalesce($1, name), tax_id = coalesce($2, tax_id), phone = coalesce($3, phone), email = coalesce($4::citext, email),
                address = coalesce($5, address), city = coalesce($6, city), timezone = coalesce($7, timezone), lang = coalesce($8::lang_code, lang),
                settings = $9, version = version + 1
          WHERE id = current_tenant() RETURNING *`,
        [b.name?.trim() || null, b.taxId ?? null, b.phone ?? null, b.email ?? null, b.address ?? null, b.city ?? null, b.timezone ?? null, b.lang ?? null, JSON.stringify(settings)],
      );
      if (b.settings?.prefixes) {
        for (const [name, prefix] of Object.entries<string>(b.settings.prefixes)) {
          await tx.exec('UPDATE number_sequences SET prefix = $2 WHERE name = $1', [name, prefix]);
        }
      }
      await this.audit.log(tx, 'company.updated', 'company', a.tenantId, { before: { ...before, settings: before!.settings }, after: b });
      return row!;
    });
    this.tenants.invalidate(a.tenantId);
    return companyJson(tenantRow(out));
  }

  @Get('receiving-accounts')
  @Requires('company.view')
  @Op('listReceivingAccounts')
  accounts(@Auth() a: AuthContext) {
    return this.db.tx(this.ctx(a), async (tx) => (await tx.many('SELECT * FROM receiving_accounts ORDER BY active DESC, holder_name')).map(accountJson));
  }

  @Post('receiving-accounts')
  @Requires('company.edit')
  @Op('addReceivingAccount')
  addAccount(@Auth() a: AuthContext, @Body() b: { holderName: string; institution?: string; last4?: string }) {
    return this.db.tx(this.ctx(a), async (tx) => {
      const r = await tx.one<Record<string, any>>(
        'INSERT INTO receiving_accounts (tenant_id, holder_name, institution, last4) VALUES (current_tenant(), $1, $2, $3) RETURNING *',
        [b.holderName.trim(), b.institution?.trim() || null, b.last4 ?? null],
      );
      await this.audit.log(tx, 'receiving_account.added', 'receiving_account', r!.id, { after: b });
      return accountJson(r!);
    });
  }

  @Delete('receiving-accounts/:id')
  @HttpCode(204)
  @Requires('company.edit')
  @Op('deactivateReceivingAccount')
  async removeAccount(@Auth() a: AuthContext, @Param('id') id: string): Promise<void> {
    await this.db.tx(this.ctx(a), async (tx) => {
      if (!(await tx.exec('UPDATE receiving_accounts SET active = false WHERE id = $1', [id]))) throw Problem.notFound();
      await this.audit.log(tx, 'receiving_account.deactivated', 'receiving_account', id);
    });
  }
}
