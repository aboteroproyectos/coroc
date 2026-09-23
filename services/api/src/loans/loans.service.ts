import { Injectable } from '@nestjs/common';
import {
  buildSchedule,
  checkRateCap,
  dailyLateFeeWithinCap,
  loanEffectiveAnnualRate,
  TermsError,
  validateTerms,
  type LateFeePolicy,
  type LoanReplay,
  type LoanTerms,
  type Schedule,
} from '@coroc/core';
import { AuditService } from '../audit/audit.service.js';
import { Clock } from '../common/clock.js';
import type { AuthContext } from '../common/context.js';
import { pct, t, type Lang } from '../common/i18n.js';
import { Problem } from '../common/problem.js';
import { RateCapService } from '../compliance/rate-caps.js';
import type { TenantInfo } from '../company/tenant-cache.js';
import { EventBus } from '../dashboard/event-bus.js';
import type { Tx } from '../db/db.service.js';
import { LoanStateService, termsOf, type LoadedLoan } from './loan-state.service.js';

export interface LoanTermsInput {
  principal: number;
  currency: 'COP' | 'BRL' | 'USD';
  method: 'simple' | 'french';
  rate: string;
  installments: number;
  frequency: 'daily' | 'weekly' | 'monthly';
  disbursementDate: string;
  firstDueDate?: string;
  collectionDays?: number[];
  excludeHolidays?: boolean;
  monthlyDay?: number;
  roundingUnit?: number;
}

export interface LoanInput extends LoanTermsInput {
  contract?: string;
  lateFee?: LateFeePolicy;
  expectedMethod?: string;
}

const termsJson = (x: LoanTerms, s?: Schedule) => ({
  principal: x.principal,
  currency: x.currency,
  method: x.method,
  rate: x.rate,
  installments: x.installments,
  frequency: x.frequency,
  disbursementDate: x.disbursementDate,
  firstDueDate: s?.terms.firstDueDate ?? x.firstDueDate,
  collectionDays: x.collectionDays ?? [1, 2, 3, 4, 5, 6],
  excludeHolidays: x.excludeHolidays ?? true,
  ...(x.monthlyDay ? { monthlyDay: x.monthlyDay } : {}),
  roundingUnit: x.roundingUnit ?? 1,
});

/** Motor financiero en el servidor (§9): plan, tasa efectiva anual real y tope legal, siempre con @coroc/core. */
@Injectable()
export class LoansService {
  constructor(
    private readonly state: LoanStateService,
    private readonly caps: RateCapService,
    private readonly audit: AuditService,
    private readonly bus: EventBus,
    private readonly clock: Clock,
  ) {}

  toTerms(input: LoanTermsInput, tenant: TenantInfo): LoanTerms {
    return {
      principal: input.principal,
      currency: input.currency ?? tenant.currency,
      method: input.method,
      rate: String(input.rate),
      installments: input.installments,
      frequency: input.frequency,
      disbursementDate: input.disbursementDate,
      firstDueDate: input.firstDueDate,
      country: tenant.country,
      collectionDays: input.collectionDays ?? [1, 2, 3, 4, 5, 6],
      excludeHolidays: input.excludeHolidays ?? true,
      monthlyDay: input.monthlyDay,
      roundingUnit: input.roundingUnit ?? tenant.settings.roundingUnit ?? 1,
    };
  }

  private schedule(terms: LoanTerms, lang: Lang): Schedule {
    try {
      validateTerms(terms);
      return buildSchedule(terms);
    } catch (e) {
      if (e instanceof TermsError) throw new Problem(422, 'INVALID_TERMS', { reason: t(lang, `terms.${e.code}`) }, [{ field: e.code.toLowerCase(), message: 'other' }]);
      throw e;
    }
  }

  /** Vista previa en vivo (§8.3): plan, total, utilidad, tasa efectiva anual y control del tope. No guarda nada. */
  async preview(tx: Tx, tenant: TenantInfo, input: LoanTermsInput, lang: Lang) {
    const terms = this.toTerms(input, tenant);
    const s = this.schedule(terms, lang);
    const ea = loanEffectiveAnnualRate(terms);
    const cap = await this.caps.current(tx, tenant.country, terms.disbursementDate);
    const check = cap ? checkRateCap(terms, cap.effectiveAnnual) : null;
    return {
      terms: termsJson(terms, s),
      installments: s.installments,
      regularInstallment: s.regularInstallment,
      totalPayable: s.totalPayable,
      totalInterest: s.totalInterest,
      effectiveAnnualRate: ea,
      rateCap: check ? { ok: check.ok, effectiveAnnual: check.effectiveAnnual, cap: check.cap, ...(check.maxRate ? { maxRate: check.maxRate } : {}), missing: false } : { ok: tenant.country !== 'CO', effectiveAnnual: ea, cap: null, missing: true },
    };
  }

  /**
   * Crea el préstamo con su plan y el desembolso en el libro. Rechaza la tasa por encima del tope vigente (§9.6, CA-12)
   * y, en Colombia, exige que el tope esté registrado.
   */
  async create(tx: Tx, auth: AuthContext, tenant: TenantInfo, clientId: string, input: LoanInput, lang: Lang) {
    const terms = this.toTerms(input, tenant);
    const s = this.schedule(terms, lang);
    const cap = await this.caps.current(tx, tenant.country, terms.disbursementDate);
    if (!cap && tenant.country === 'CO') throw new Problem(422, 'RATE_CAP_MISSING');
    let ea = loanEffectiveAnnualRate(terms);
    if (cap) {
      const check = checkRateCap(terms, cap.effectiveAnnual);
      ea = check.effectiveAnnual;
      if (!check.ok) {
        throw new Problem(422, 'RATE_CAP_EXCEEDED', { effectiveAnnual: pct(lang, check.effectiveAnnual), cap: pct(lang, check.cap), maxRate: pct(lang, Number(check.maxRate)) }, [], {
          rateCap: { ok: false, effectiveAnnual: check.effectiveAnnual, cap: check.cap, maxRate: check.maxRate },
        });
      }
      if (input.lateFee) {
        const daily = input.lateFee.type === 'percent_daily' ? input.lateFee.value : String(Number(input.lateFee.value) / Math.max(1, s.regularInstallment));
        if (!dailyLateFeeWithinCap(daily, cap.effectiveAnnual)) throw new Problem(422, 'LATE_FEE_EXCEEDS_CAP');
      }
    }
    const contract = input.contract?.trim() || (await tx.one<{ n: string }>("SELECT next_number(current_tenant(), 'contract') AS n"))!.n;
    if (await tx.one('SELECT 1 FROM loans WHERE contract = $1', [contract])) throw new Problem(409, 'CONTRACT_TAKEN', { contract });
    const loan = await tx.one<{ id: string }>(
      `INSERT INTO loans (tenant_id, client_id, contract, currency, principal, method, rate, installments_count, frequency, disbursement_date,
                          first_due_date, collection_days, exclude_holidays, monthly_day, rounding_unit, late_fee, total_payable,
                          effective_annual_rate, rate_cap_id, expected_method, created_by)
       VALUES (current_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20) RETURNING id`,
      [
        clientId, contract, terms.currency, terms.principal, terms.method, terms.rate, terms.installments, terms.frequency, terms.disbursementDate,
        s.terms.firstDueDate, terms.collectionDays, terms.excludeHolidays, terms.monthlyDay ?? null, terms.roundingUnit, input.lateFee ? JSON.stringify(input.lateFee) : null,
        s.totalPayable, ea.toFixed(8), cap?.id ?? null, input.expectedMethod ?? null, auth.userId,
      ],
    );
    const col = <K extends keyof (typeof s.installments)[number]>(k: K) => s.installments.map((i) => i[k]);
    await tx.exec(
      `INSERT INTO installments (tenant_id, loan_id, number, due_date, amount, principal, interest, balance_after)
       SELECT current_tenant(), $1, * FROM unnest($2::int[], $3::date[], $4::bigint[], $5::bigint[], $6::bigint[], $7::bigint[])`,
      [loan!.id, col('number'), col('dueDate'), col('amount'), col('principal'), col('interest'), col('balanceAfter')],
    );
    await tx.exec(
      "INSERT INTO ledger_entries (tenant_id, loan_id, type, entry_date, amount, source, created_by) VALUES (current_tenant(), $1, 'disbursement', $2, $3, 'manual', $4)",
      [loan!.id, terms.disbursementDate, terms.principal, auth.userId],
    );
    const loaded = (await this.state.load(tx, loan!.id))!;
    const r = await this.state.recompute(tx, loaded, this.clock.today(tenant.timezone));
    await this.audit.log(tx, 'loan.created', 'loan', loan!.id, { after: { contract, ...termsJson(terms), totalPayable: s.totalPayable, effectiveAnnualRate: ea } });
    return { loaded, replay: r };
  }

  /** Préstamo con resumen derivado del libro a la fecha de la empresa (§10). */
  loanJson(l: LoadedLoan, r: LoanReplay, tenant: TenantInfo) {
    const terms = termsOf(l.loan, tenant.country);
    const totalInterest = l.plan.reduce((acc, i) => acc + i.interest, 0);
    // Utilidad realizada: la parte de interés de lo efectivamente pagado en cada cuota, más la mora pagada.
    let realized = 0;
    for (const st of r.states) {
      const inst = l.plan.find((i) => i.number === st.number)!;
      realized += Math.floor((Math.min(st.paid, inst.amount) * inst.interest) / inst.amount) + (st.lateFeePaid ?? 0);
    }
    const s = r.summary;
    return {
      id: l.loan.id,
      clientId: l.loan.client_id,
      contract: l.loan.contract,
      terms: termsJson(terms),
      ...(l.loan.late_fee ? { lateFee: l.loan.late_fee } : {}),
      totalPayable: l.loan.total_payable,
      totalInterest,
      effectiveAnnualRate: Number(l.loan.effective_annual_rate),
      status: l.loan.status,
      summary: {
        totalInstallments: s.totalInstallments,
        paidInstallments: s.paidInstallments,
        remainingInstallments: s.remainingInstallments,
        totalPayable: s.totalPayable,
        paidTotal: s.paidTotal,
        lateFeesOutstanding: s.lateFeesOutstanding,
        balance: s.balance,
        next: s.next ? { number: s.next.number, dueDate: s.next.dueDate, outstanding: s.next.outstanding } : null,
        overdueCount: s.overdueCount,
        daysPastDue: s.daysPastDue,
        surplus: r.surplus,
        progress: s.totalPayable ? Math.min(1, s.paidTotal / s.totalPayable) : 0,
      },
      realizedProfit: realized,
      expectedMethod: l.loan.expected_method,
      createdAt: new Date(l.loan.created_at).toISOString(),
      version: l.loan.version,
    };
  }

  publishCreated(auth: AuthContext, clientId: string, collectorId: string | null, loanId: string): void {
    this.bus.publish({ type: 'loan.created', tenantId: auth.tenantId, clientId, collectorId, data: { loanId, clientId } });
    this.bus.publish({ type: 'dashboard.changed', tenantId: auth.tenantId, clientId, collectorId, data: {} });
  }
}
