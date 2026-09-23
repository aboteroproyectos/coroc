import { Injectable } from '@nestjs/common';
import { clientFolderName, normalizePhone } from '@coroc/core';
import { AuditService } from '../audit/audit.service.js';
import { AccessService } from '../common/access.js';
import { Clock } from '../common/clock.js';
import type { AuthContext } from '../common/context.js';
import type { Lang } from '../common/i18n.js';
import { Problem } from '../common/problem.js';
import { TenantCache, type TenantInfo } from '../company/tenant-cache.js';
import { DbService, type Tx } from '../db/db.service.js';
import { LoanStateService } from '../loans/loan-state.service.js';
import { LoansService, type LoanInput } from '../loans/loans.service.js';

export interface ClientInput {
  firstName: string;
  lastName: string;
  phone: string;
  phone2?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  idDocType?: string | null;
  idDocNumber?: string | null;
  lang?: Lang;
  /** Zona horaria del deudor para las reglas de contacto (§11.4); vacía: la de la empresa. */
  timezone?: string | null;
  collectorId?: string | null;
  coDebtor?: { name: string; phone?: string; email?: string } | null;
  notes?: string | null;
  consents?: { channel: 'whatsapp' | 'email' | 'personal_data'; method: string; evidenceDocumentId?: string }[];
}

export interface ListQuery {
  q?: string;
  status?: 'current' | 'overdue' | 'closed';
  frequency?: 'daily' | 'weekly' | 'monthly';
  collectorId?: string;
  cursor?: string;
  limit?: number;
}

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

@Injectable()
export class ClientsService {
  constructor(
    private readonly db: DbService,
    private readonly tenants: TenantCache,
    private readonly loans: LoansService,
    private readonly state: LoanStateService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly clock: Clock,
  ) {}

  ctx(a: AuthContext) {
    return { tenantId: a.tenantId, userId: a.userId, role: a.role };
  }

  private phone(raw: string | null | undefined, tenant: TenantInfo, field: string): string | null {
    if (raw === null || raw === undefined || !String(raw).trim()) return null;
    const p = normalizePhone(String(raw), tenant.country);
    if (!p) throw new Problem(422, 'INVALID_PHONE', { phone: String(raw) }, [{ field, message: 'format' }]);
    return p;
  }

  private async assertCollector(tx: Tx, id: string | null | undefined): Promise<void> {
    if (!id) return;
    const u = await tx.one<{ role: string; active: boolean }>('SELECT role, active FROM users WHERE id = $1', [id]);
    if (!u || !u.active) throw new Problem(422, 'VALIDATION_FAILED', {}, [{ field: 'collectorId', message: 'enum' }]);
  }

  /** §8.3: mismo número o mismo documento → aviso antes de guardar. */
  private async duplicateOf(tx: Tx, phones: (string | null)[], idDoc: string | null | undefined, exceptId?: string): Promise<string | null> {
    const list = phones.filter(Boolean);
    const digits = idDoc ? idDoc.replace(/\D/g, '') : '';
    const r = await tx.one<{ code: string }>(
      `SELECT code FROM clients WHERE ($3::uuid IS NULL OR id <> $3)
         AND (phone_e164 = ANY($1::text[]) OR phone2_e164 = ANY($1::text[]) OR ($2 <> '' AND regexp_replace(coalesce(id_doc_number, ''), '\\D', '', 'g') = $2))
       LIMIT 1`,
      [list, digits, exceptId ?? null],
    );
    return r?.code ?? null;
  }

  /** Asistente «Nuevo cliente» (§8.3): cliente + primer préstamo en una sola transacción. */
  async createWithLoan(auth: AuthContext, input: { client: ClientInput; loan: LoanInput; acknowledgeDuplicate?: boolean }, lang: Lang) {
    const tenant = await this.tenants.get(auth.tenantId);
    const out = await this.db.tx(this.ctx(auth), async (tx) => {
      const c = input.client;
      const phone = this.phone(c.phone, tenant, 'client.phone')!;
      const phone2 = this.phone(c.phone2, tenant, 'client.phone2');
      await this.assertCollector(tx, c.collectorId);
      if (!input.acknowledgeDuplicate) {
        const dup = await this.duplicateOf(tx, [phone, phone2], c.idDocNumber);
        if (dup) throw new Problem(409, 'DUPLICATE_CLIENT', { code: dup }, [], { duplicateCode: dup });
      }
      const code = (await tx.one<{ n: string }>("SELECT next_number(current_tenant(), 'client') AS n"))!.n;
      const row = await tx.one<Record<string, any>>(
        `INSERT INTO clients (tenant_id, code, first_name, last_name, phone_e164, phone2_e164, email, address, city, country, id_doc_type, id_doc_number,
                              lang, collector_id, notes, folder_name, created_by)
         VALUES (current_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
        [
          code, c.firstName.trim(), c.lastName.trim(), phone, phone2, c.email?.trim() || null, c.address?.trim() || null, c.city?.trim() || null, tenant.country,
          c.idDocType?.trim() || null, c.idDocNumber?.trim() || null, c.lang ?? tenant.lang, c.collectorId ?? null, c.notes?.trim() || null,
          clientFolderName(c.firstName.trim(), c.lastName.trim(), code), auth.userId,
        ],
      );
      await this.saveCoDebtor(tx, row!.id, c.coDebtor, tenant);
      for (const k of c.consents ?? []) await this.grant(tx, auth, row!.id, k);
      await this.audit.log(tx, 'client.created', 'client', row!.id, { after: { code, firstName: c.firstName, lastName: c.lastName, collectorId: c.collectorId ?? null } });
      const { loaded, replay } = await this.loans.create(tx, auth, tenant, row!.id, input.loan, lang);
      return { client: await this.clientJson(tx, row!, tenant), loan: this.loans.loanJson(loaded, replay, tenant), collectorId: row!.collector_id as string | null };
    });
    this.loans.publishCreated(auth, out.client.id, out.collectorId, out.loan.id);
    return { client: out.client, loan: out.loan };
  }

  /** Renovación: un préstamo nuevo con su propio contrato para un cliente existente (§8). */
  async addLoan(auth: AuthContext, clientId: string, loan: LoanInput, lang: Lang) {
    const tenant = await this.tenants.get(auth.tenantId);
    const out = await this.db.tx(this.ctx(auth), async (tx) => {
      const c = await tx.one<Record<string, any>>('SELECT id, collector_id FROM clients WHERE id = $1', [clientId]);
      if (!c) return this.access.deny(tx, auth, 'client', clientId);
      const { loaded, replay } = await this.loans.create(tx, auth, tenant, clientId, loan, lang);
      return { loan: this.loans.loanJson(loaded, replay, tenant), collectorId: c.collector_id as string | null };
    });
    this.loans.publishCreated(auth, clientId, out.collectorId, out.loan.id);
    return out.loan;
  }

  private async saveCoDebtor(tx: Tx, clientId: string, cd: ClientInput['coDebtor'], tenant: TenantInfo): Promise<void> {
    const existing = await tx.one<{ id: string }>('SELECT id FROM co_debtors WHERE client_id = $1', [clientId]);
    if (!cd || !cd.name?.trim()) {
      if (existing && cd === null) await tx.exec("UPDATE co_debtors SET name = '(retirado)', phone_e164 = NULL, email = NULL WHERE id = $1", [existing.id]);
      return;
    }
    const phone = this.phone(cd.phone, tenant, 'client.coDebtor.phone');
    if (existing) await tx.exec('UPDATE co_debtors SET name = $2, phone_e164 = $3, email = $4 WHERE id = $1', [existing.id, cd.name.trim(), phone, cd.email?.trim() || null]);
    else await tx.exec('INSERT INTO co_debtors (tenant_id, client_id, name, phone_e164, email) VALUES (current_tenant(), $1, $2, $3, $4)', [clientId, cd.name.trim(), phone, cd.email?.trim() || null]);
  }

  async grant(tx: Tx, auth: AuthContext, clientId: string, k: { channel: string; method: string; evidenceDocumentId?: string }) {
    const existing = await tx.one<Record<string, any>>('SELECT * FROM consents WHERE client_id = $1 AND channel = $2 AND revoked_at IS NULL', [clientId, k.channel]);
    if (existing) return existing;
    const row = await tx.one<Record<string, any>>(
      'INSERT INTO consents (tenant_id, client_id, channel, method, evidence_document_id, recorded_by) VALUES (current_tenant(), $1, $2, $3, $4, $5) RETURNING *',
      [clientId, k.channel, k.method.trim(), k.evidenceDocumentId ?? null, auth.userId],
    );
    await this.audit.log(tx, 'consent.granted', 'client', clientId, { after: { channel: k.channel, method: k.method } });
    return row!;
  }

  consentJson = (r: Record<string, any>) => ({
    channel: r.channel, method: r.method, evidenceDocumentId: r.evidence_document_id ?? undefined,
    grantedAt: new Date(r.granted_at).toISOString(), revokedAt: r.revoked_at ? new Date(r.revoked_at).toISOString() : null, recordedBy: r.recorded_by ?? '',
  });

  async clientJson(tx: Tx, r: Record<string, any>, tenant: TenantInfo) {
    const cd = await tx.one<Record<string, any>>('SELECT * FROM co_debtors WHERE client_id = $1', [r.id]);
    const consents = await tx.many('SELECT * FROM consents WHERE client_id = $1 AND revoked_at IS NULL ORDER BY channel', [r.id]);
    const loanIds = await tx.many<{ id: string }>('SELECT id FROM loans WHERE client_id = $1 ORDER BY created_at DESC', [r.id]);
    const today = this.clock.today(tenant.timezone);
    const loans = [];
    for (const { id } of loanIds) {
      const l = await this.state.load(tx, id);
      if (l) loans.push(this.loans.loanJson(l, this.state.replay(l, today), tenant));
    }
    return {
      id: r.id, code: r.code, firstName: r.first_name, lastName: r.last_name, fullName: `${r.first_name} ${r.last_name}`,
      phone: r.phone_e164, phoneE164: r.phone_e164, phone2: r.phone2_e164 ?? null, email: r.email ?? null, address: r.address ?? null, city: r.city ?? null,
      idDocType: r.id_doc_type ?? null, idDocNumber: r.id_doc_number ?? null, lang: r.lang, collectorId: r.collector_id ?? null,
      coDebtor: cd && cd.name !== '(retirado)' ? { name: cd.name, phone: cd.phone_e164 ?? undefined, email: cd.email ?? undefined } : null,
      notes: r.notes ?? null, folderName: r.folder_name, consents: consents.map(this.consentJson), loans,
      timezone: r.timezone ?? null, emailStatus: r.email_status ?? null,
      contactException: r.authorized_windows ? { windows: r.authorized_windows, documentId: r.authorized_windows_document_id ?? null, grantedAt: r.authorized_windows_at ? new Date(r.authorized_windows_at).toISOString() : null } : null,
      createdAt: new Date(r.created_at).toISOString(), version: r.version,
    };
  }

  async get(auth: AuthContext, id: string) {
    const tenant = await this.tenants.get(auth.tenantId);
    return this.db.tx(this.ctx(auth), async (tx) => {
      const r = await tx.one<Record<string, any>>('SELECT * FROM clients WHERE id = $1', [id]);
      if (!r) return this.access.deny(tx, auth, 'client', id);
      return this.clientJson(tx, r, tenant);
    });
  }

  async update(auth: AuthContext, id: string, c: ClientInput, ifMatch?: string) {
    const tenant = await this.tenants.get(auth.tenantId);
    return this.db.tx(this.ctx(auth), async (tx) => {
      const before = await tx.one<Record<string, any>>('SELECT * FROM clients WHERE id = $1 FOR UPDATE', [id]);
      if (!before) return this.access.deny(tx, auth, 'client', id);
      if (ifMatch && String(before.version) !== ifMatch.replace(/"/g, '')) throw new Problem(409, 'VERSION_CONFLICT');
      const phone = this.phone(c.phone, tenant, 'phone')!;
      const phone2 = this.phone(c.phone2, tenant, 'phone2');
      await this.assertCollector(tx, c.collectorId);
      if (c.timezone) {
        try {
          new Intl.DateTimeFormat('en', { timeZone: c.timezone });
        } catch {
          throw new Problem(422, 'VALIDATION_FAILED', {}, [{ field: 'timezone', message: 'enum' }]);
        }
      }
      const r = await tx.one<Record<string, any>>(
        `UPDATE clients SET first_name = $2, last_name = $3, phone_e164 = $4, phone2_e164 = $5, email = $6, address = $7, city = $8,
                id_doc_type = $9, id_doc_number = $10, lang = $11, collector_id = $12, notes = $13, folder_name = $14, version = version + 1,
                timezone = CASE WHEN $15::boolean THEN $16 ELSE timezone END,
                -- Una dirección nueva se vuelve a intentar: el rebote era de la anterior (§11.2).
                email_status = CASE WHEN email IS DISTINCT FROM $6::citext THEN NULL ELSE email_status END,
                email_status_at = CASE WHEN email IS DISTINCT FROM $6::citext THEN NULL ELSE email_status_at END
          WHERE id = $1 RETURNING *`,
        [
          id, c.firstName.trim(), c.lastName.trim(), phone, phone2, c.email?.trim() || null, c.address?.trim() || null, c.city?.trim() || null,
          c.idDocType?.trim() || null, c.idDocNumber?.trim() || null, c.lang ?? before.lang, c.collectorId === undefined ? before.collector_id : c.collectorId, c.notes?.trim() || null,
          clientFolderName(c.firstName.trim(), c.lastName.trim(), before.code), c.timezone !== undefined, c.timezone?.trim() || null,
        ],
      );
      if (c.coDebtor !== undefined) await this.saveCoDebtor(tx, id, c.coDebtor, tenant);
      const pick = (x: Record<string, any>) => ({ firstName: x.first_name, lastName: x.last_name, phone: x.phone_e164, phone2: x.phone2_e164, email: x.email, address: x.address, city: x.city, lang: x.lang, collectorId: x.collector_id, folderName: x.folder_name });
      await this.audit.log(tx, 'client.updated', 'client', id, { before: pick(before), after: pick(r!) });
      return this.clientJson(tx, r!, tenant);
    });
  }

  async revoke(auth: AuthContext, id: string, channel: string) {
    await this.db.tx(this.ctx(auth), async (tx) => {
      if (!(await tx.one('SELECT 1 FROM clients WHERE id = $1', [id]))) return this.access.deny(tx, auth, 'client', id);
      const n = await tx.exec('UPDATE consents SET revoked_at = now() WHERE client_id = $1 AND channel = $2 AND revoked_at IS NULL', [id, channel]);
      if (!n) throw Problem.notFound();
      await this.audit.log(tx, 'consent.revoked', 'client', id, { after: { channel } });
    });
  }

  /**
   * Búsqueda instantánea y filtros (§5.7-5), paginada por cursor. Primero se elige la página de clientes (índices de
   * trigramas y de orden alfabético) y después se agregan sus préstamos: así responde en milisegundos con 100.000 clientes.
   * El Cobrador solo ve lo suyo (RLS).
   */
  async list(auth: AuthContext, q: ListQuery) {
    const tenant = await this.tenants.get(auth.tenantId);
    const today = this.clock.today(tenant.timezone);
    const limit = Math.min(200, Math.max(1, q.limit ?? 50));
    await this.state.ensureFresh(this.ctx(auth), today);
    return this.db.tx(this.ctx(auth), async (tx) => {
      const where: string[] = [];
      const params: unknown[] = [];
      const p = (v: unknown) => {
        params.push(v);
        return `$${params.length}`;
      };
      if (q.q?.trim()) {
        const term = fold(q.q.trim());
        const digits = q.q.replace(/\D/g, '');
        const like = p(`%${term.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
        const d = p(digits.length >= 4 ? `%${digits}%` : null);
        // Candidatos por nombre, código, contrato, teléfonos o documento con los índices de trigramas (migración 0006).
        where.push(`c.id IN (SELECT id FROM search_client_ids(${like}, ${d}::text))`);
      }
      if (q.collectorId) where.push(`c.collector_id = ${p(q.collectorId)}`);
      if (q.frequency) where.push(`EXISTS (SELECT 1 FROM loans lf WHERE lf.client_id = c.id AND lf.frequency = ${p(q.frequency)} AND lf.status = 'active')`);
      const overdue = "EXISTS (SELECT 1 FROM loan_state so WHERE so.client_id = c.id AND so.bucket NOT IN ('current', 'closed'))";
      const active = "EXISTS (SELECT 1 FROM loan_state sa WHERE sa.client_id = c.id AND sa.bucket <> 'closed')";
      if (q.status === 'overdue') where.push(overdue);
      if (q.status === 'current') where.push(`${active} AND NOT ${overdue}`);
      if (q.status === 'closed') where.push(`NOT ${active}`);
      if (q.cursor) {
        try {
          const [name, id] = JSON.parse(Buffer.from(q.cursor, 'base64url').toString()) as [string, string];
          where.push(`(c.sort_name, c.id) > (${p(name)}, ${p(id)}::uuid)`);
        } catch {
          throw new Problem(422, 'VALIDATION_FAILED', {}, [{ field: 'cursor', message: 'format' }]);
        }
      }
      const rows = await tx.many<Record<string, any>>(
        `WITH page AS (
           SELECT c.id, c.code, c.first_name, c.last_name, c.phone_e164, c.collector_id, c.sort_name
             FROM clients c
            ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
            ORDER BY c.sort_name, c.id
            LIMIT ${limit + 1})
         SELECT page.*, agg.* FROM page
         LEFT JOIN LATERAL (
           SELECT coalesce(array_agg(l.contract ORDER BY l.created_at), '{}') AS contracts,
                  (array_agg(l.frequency ORDER BY l.created_at DESC) FILTER (WHERE s.bucket <> 'closed'))[1] AS frequency,
                  (array_agg(l.currency ORDER BY l.created_at DESC))[1] AS currency,
                  coalesce(sum(s.balance) FILTER (WHERE s.bucket <> 'closed'), 0)::bigint AS balance,
                  coalesce(max(s.days_past_due), 0) AS dpd,
                  coalesce(bool_or(s.bucket <> 'closed'), false) AS has_active,
                  coalesce(bool_or(s.bucket NOT IN ('current', 'closed')), false) AS overdue,
                  (array_agg(json_build_object('number', s.next_number, 'dueDate', s.next_due_date, 'outstanding', s.next_outstanding)
                     ORDER BY s.next_due_date NULLS LAST) FILTER (WHERE s.bucket <> 'closed' AND s.next_number IS NOT NULL))[1] AS next
             FROM loans l LEFT JOIN loan_state s ON s.loan_id = l.id
            WHERE l.client_id = page.id) agg ON true
         ORDER BY page.sort_name, page.id`,
        params,
      );
      const pageRows = rows.slice(0, limit);
      const last = pageRows[pageRows.length - 1];
      return {
        items: pageRows.map((r) => ({
          id: r.id, code: r.code, fullName: `${r.first_name} ${r.last_name}`, phone: r.phone_e164, contracts: r.contracts,
          frequency: r.frequency ?? null, next: r.next ?? null, balance: Number(r.balance), currency: r.currency ?? tenant.currency,
          status: !r.has_active ? 'closed' : r.overdue ? 'overdue' : 'current', daysPastDue: r.dpd, collectorId: r.collector_id ?? null,
        })),
        nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify([last.sort_name, last.id])).toString('base64url') : null,
      };
    });
  }
}
