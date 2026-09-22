import { Injectable } from '@nestjs/common';
import type { CountryCode, Currency } from '@coroc/core';
import { DbService } from '../db/db.service.js';
import type { Lang } from '../common/i18n.js';

export interface TenantInfo {
  id: string;
  slug: string;
  name: string;
  taxId: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  country: CountryCode;
  currency: Currency;
  timezone: string;
  lang: Lang;
  settings: Record<string, any>;
  version: number;
}

export const DEFAULT_SETTINGS = {
  supervisionMode: 'auto_with_audit',
  confidenceThreshold: 0.95,
  maxReceiptAgeDays: 30,
  autoRevertHours: 72,
  contactRules: true,
  transactionalImmediate: false,
  whatsappMode: 'assisted',
  roundingUnit: 1,
  reminderTime: '08:00',
  dailyReminders: false,
  prefixes: { client: 'C', contract: 'CT-', receipt: 'RC-' },
};

export const tenantRow = (r: Record<string, any>): TenantInfo => ({
  id: r.id, slug: r.slug, name: r.name, taxId: r.tax_id, phone: r.phone, email: r.email, address: r.address, city: r.city,
  country: r.country, currency: r.currency, timezone: r.timezone, lang: r.lang,
  settings: { ...DEFAULT_SETTINGS, ...(r.settings ?? {}), prefixes: { ...DEFAULT_SETTINGS.prefixes, ...(r.settings?.prefixes ?? {}) } },
  version: r.version,
});

/** Datos de la empresa con caché breve: se leen en cada petición (zona horaria, moneda, país). */
@Injectable()
export class TenantCache {
  private readonly cache = new Map<string, { at: number; value: TenantInfo }>();
  constructor(private readonly db: DbService) {}

  async get(tenantId: string): Promise<TenantInfo> {
    const hit = this.cache.get(tenantId);
    if (hit && Date.now() - hit.at < 30_000) return hit.value;
    const row = await this.db.tx({ tenantId }, (tx) => tx.one('SELECT * FROM tenants WHERE id = current_tenant()'));
    if (!row) throw new Error('Empresa no encontrada');
    const value = tenantRow(row);
    this.cache.set(tenantId, { at: Date.now(), value });
    return value;
  }

  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
  }
}
