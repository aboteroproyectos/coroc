import { Inject, Injectable } from '@nestjs/common';
import { buildReceiptData, type AllocationLine } from '@coroc/core';
import { AuditService } from '../audit/audit.service.js';
import { sha256hex } from '../auth/crypto.js';
import { AccessService } from '../common/access.js';
import { Clock } from '../common/clock.js';
import type { AuthContext } from '../common/context.js';
import { Problem } from '../common/problem.js';
import { TenantCache } from '../company/tenant-cache.js';
import { CONFIG, type AppConfig } from '../config.js';
import { EventBus } from '../dashboard/event-bus.js';
import { DbService, type Tx } from '../db/db.service.js';
import { LoanStateService, type LedgerRow } from './loan-state.service.js';

export interface PaymentInput {
  amount: number;
  date: string;
  method?: string;
  reference?: string;
  institution?: string;
  note?: string;
  cash?: boolean;
}

export const entryJson = (e: LedgerRow, extra: { allocation?: AllocationLine[]; receiptNumber?: string | null } = {}) => ({
  id: e.id,
  type: e.type,
  entryDate: e.entry_date,
  recordedAt: new Date(e.recorded_at).toISOString(),
  amount: e.amount,
  method: e.method ?? '',
  reference: e.reference ?? '',
  institution: e.institution ?? '',
  source: e.source,
  documentId: e.document_id,
  reversesId: e.reverses_id,
  reversedBy: e.reversed_by ?? null,
  reason: e.reason ?? '',
  note: e.note ?? '',
  auto: e.auto,
  allocation: extra.allocation ?? [],
  receiptNumber: extra.receiptNumber ?? '',
  createdBy: e.created_by ?? '',
});

/**
 * Registro atómico del pago (§14): libro → aplicación (§9.5) → saldo → recibo (§15) → estado del préstamo →
 * bitácora → evento en tiempo real. Todo o nada: si algo falla, la transacción entera se revierte.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly db: DbService,
    private readonly state: LoanStateService,
    private readonly tenants: TenantCache,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly bus: EventBus,
    private readonly clock: Clock,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  private ctx(a: AuthContext) {
    return { tenantId: a.tenantId, userId: a.userId, role: a.role };
  }

  async post(auth: AuthContext, loanId: string, input: PaymentInput) {
    const tenant = await this.tenants.get(auth.tenantId);
    const today = this.clock.today(tenant.timezone);
    const result = await this.db.tx(this.ctx(auth), async (tx) => {
      const l = await this.state.load(tx, loanId, true);
      if (!l) return this.access.deny(tx, auth, 'loan', loanId);
      if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Problem(422, 'PAYMENT_INVALID_AMOUNT', {}, [{ field: 'amount', message: 'minimum' }]);
      if (input.date > today || input.date < l.loan.disbursement_date) throw new Problem(422, 'PAYMENT_DATE_INVALID', {}, [{ field: 'date', message: 'other' }]);
      const before = this.state.replay(l, today);
      if (before.summary.balance === 0) throw new Problem(409, 'LOAN_ALREADY_PAID');

      const entry = await tx.one<LedgerRow>(
        `INSERT INTO ledger_entries (tenant_id, loan_id, type, entry_date, amount, method, reference, institution, source, note, created_by)
         VALUES (current_tenant(), $1, 'payment', $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *, NULL::uuid AS reversed_by`,
        [loanId, input.date, input.amount, input.method?.trim() || null, input.reference?.trim() || null, input.institution?.trim() || null, input.cash ? 'cash' : 'manual', input.note?.trim() || null, auth.userId],
      );
      l.ledger.push(entry!);
      const after = await this.state.recompute(tx, l, today);
      const alloc = after.allocations.get(entry!.id)!;
      if (alloc.lines.length) {
        await tx.exec(
          `INSERT INTO payment_allocations (tenant_id, entry_id, installment_number, to_late_fee, to_installment)
           SELECT current_tenant(), $1, * FROM unnest($2::int[], $3::bigint[], $4::bigint[])`,
          [entry!.id, alloc.lines.map((x) => x.number), alloc.lines.map((x) => x.toLateFee), alloc.lines.map((x) => x.toInstallment)],
        );
      }

      const client = await tx.one<Record<string, any>>('SELECT id, code, first_name, last_name, lang, collector_id FROM clients WHERE id = $1', [l.loan.client_id]);
      const number = (await tx.one<{ n: string }>("SELECT next_number(current_tenant(), 'receipt') AS n"))!.n;
      const verification = sha256hex(`${tenant.id}|${number}|${entry!.id}|${input.amount}|${input.date}`).slice(0, 16).toUpperCase();
      const receipt = buildReceiptData({
        lang: client!.lang,
        number,
        issuedAt: this.clock.localStamp(tenant.timezone),
        company: { name: tenant.name, taxId: tenant.taxId ?? undefined, phone: tenant.phone ?? undefined, email: tenant.email ?? undefined, address: tenant.address ?? undefined },
        client: { fullName: `${client!.first_name} ${client!.last_name}`, code: client!.code },
        contract: l.loan.contract,
        currency: l.loan.currency,
        payment: { date: input.date, amount: input.amount, method: input.method?.trim() || undefined, reference: input.reference?.trim() || undefined },
        lines: alloc.lines,
        before: before.summary,
        after: after.summary,
        verificationCode: verification,
        verificationUrl: `${this.config.publicAppUrl}/verificar/${verification}`,
      });
      await tx.exec(
        `INSERT INTO receipts (tenant_id, number, entry_id, loan_id, document_id, verification_hash, data, lang)
         VALUES (current_tenant(), $1, $2, $3, NULL, $4, $5, $6)`,
        [number, entry!.id, loanId, verification, JSON.stringify(receipt), client!.lang],
      );
      await tx.exec('SELECT bump_daily_collection($1, $2, $3, 1)', [l.loan.currency, input.date, input.amount]);
      await this.audit.log(tx, 'payment.posted', 'loan', loanId, { after: { entryId: entry!.id, amount: input.amount, date: input.date, receipt: number } });
      return {
        client: client!,
        body: {
          entry: entryJson(entry!, { allocation: alloc.lines, receiptNumber: number }),
          receipt,
          surplus: alloc.surplus,
          loanClosed: after.summary.balance === 0,
        },
      };
    });
    const c = result.client;
    this.bus.publish({
      type: 'payment.posted', tenantId: auth.tenantId, clientId: c.id, collectorId: c.collector_id,
      data: { loanId, clientId: c.id, clientName: `${c.first_name} ${c.last_name}`, amount: input.amount, contract: result.body.receipt.contract, receipt: result.body.receipt.number },
    });
    this.bus.publish({ type: 'dashboard.changed', tenantId: auth.tenantId, clientId: c.id, collectorId: c.collector_id, data: {} });
    return result.body;
  }

  /** Reverso con motivo (§9.7, CA-18): contramovimiento en el libro, recibo ANULADO, saldos recalculados. Nunca borra. */
  async reverse(auth: AuthContext, loanId: string, entryId: string, reason: string) {
    const tenant = await this.tenants.get(auth.tenantId);
    const today = this.clock.today(tenant.timezone);
    const out = await this.db.tx(this.ctx(auth), async (tx) => {
      const l = await this.state.load(tx, loanId, true);
      if (!l) return this.access.deny(tx, auth, 'loan', loanId);
      const target = l.ledger.find((e) => e.id === entryId);
      if (!target) throw Problem.notFound();
      if (target.type !== 'payment') throw new Problem(409, 'NOT_A_PAYMENT');
      if (target.reversed_by) throw new Problem(409, 'ALREADY_REVERSED');
      const rev = await tx.one<LedgerRow>(
        `INSERT INTO ledger_entries (tenant_id, loan_id, type, entry_date, amount, source, reverses_id, reason, created_by)
         VALUES (current_tenant(), $1, 'reversal', $2, $3, 'manual', $4, $5, $6) RETURNING *, NULL::uuid AS reversed_by`,
        [loanId, today, target.amount, entryId, reason.trim(), auth.userId],
      );
      target.reversed_by = rev!.id;
      l.ledger.push(rev!);
      const receipt = await tx.one<{ number: string }>('UPDATE receipts SET voided_at = now(), data = data || \'{"voided": true}\'::jsonb WHERE entry_id = $1 RETURNING number', [entryId]);
      const after = await this.state.recompute(tx, l, today);
      await tx.exec('SELECT bump_daily_collection($1, $2, $3, -1)', [l.loan.currency, target.entry_date, -target.amount]);
      await this.audit.log(tx, 'payment.reversed', 'loan', loanId, { before: { entryId, amount: target.amount }, after: { reversalId: rev!.id, reason: reason.trim(), receipt: receipt?.number } });
      const client = await tx.one<Record<string, any>>('SELECT id, collector_id FROM clients WHERE id = $1', [l.loan.client_id]);
      return { client: client!, body: { entry: entryJson(rev!), voidedReceipt: receipt?.number ?? null, balance: after.summary.balance } };
    });
    this.bus.publish({ type: 'payment.reversed', tenantId: auth.tenantId, clientId: out.client.id, collectorId: out.client.collector_id, data: { loanId, entryId } });
    this.bus.publish({ type: 'dashboard.changed', tenantId: auth.tenantId, clientId: out.client.id, collectorId: out.client.collector_id, data: {} });
    return out.body;
  }

  /** Recibos del préstamo (datos del recibo; el PDF se genera en la Fase 2). */
  async receipts(tx: Tx, loanId: string) {
    return (await tx.many<Record<string, any>>('SELECT number, entry_id, data, voided_at, created_at FROM receipts WHERE loan_id = $1 ORDER BY created_at', [loanId])).map((r) => ({
      number: r.number, entryId: r.entry_id, voided: !!r.voided_at, createdAt: new Date(r.created_at).toISOString(), data: r.data,
    }));
  }
}
