import { Injectable, Logger } from '@nestjs/common';
import { replayLoan, type LateFeePolicy, type LoanReplay, type LoanTerms } from '@coroc/core';
import { DbService, type Tx, type TxContext } from '../db/db.service.js';

export interface LoanRow {
  id: string;
  rate_cap_override?: boolean;
  client_id: string;
  contract: string;
  currency: 'COP' | 'BRL' | 'USD';
  principal: number;
  method: 'simple' | 'french';
  rate: string;
  installments_count: number;
  frequency: 'daily' | 'weekly' | 'monthly';
  disbursement_date: string;
  first_due_date: string;
  collection_days: number[];
  exclude_holidays: boolean;
  monthly_day: number | null;
  rounding_unit: number;
  late_fee: LateFeePolicy | null;
  total_payable: number;
  effective_annual_rate: string;
  status: 'active' | 'closed' | 'written_off';
  expected_method: string | null;
  created_at: Date;
  version: number;
}

export interface InstallmentRow {
  number: number;
  due_date: string;
  amount: number;
  principal: number;
  interest: number;
  balance_after: number;
}

export interface LedgerRow {
  id: string;
  type: string;
  entry_date: string;
  recorded_at: Date;
  amount: number;
  method: string | null;
  reference: string | null;
  institution: string | null;
  source: string;
  document_id: string | null;
  reverses_id: string | null;
  reason: string | null;
  note: string | null;
  auto: boolean;
  created_by: string | null;
  reversed_by: string | null;
}

export interface LoadedLoan {
  loan: LoanRow;
  plan: InstallmentRow[];
  ledger: LedgerRow[];
}

export const termsOf = (l: LoanRow, country: LoanTerms['country']): LoanTerms => ({
  principal: l.principal,
  currency: l.currency,
  method: l.method,
  rate: String(l.rate),
  installments: l.installments_count,
  frequency: l.frequency,
  disbursementDate: l.disbursement_date,
  firstDueDate: l.first_due_date,
  country,
  collectionDays: l.collection_days,
  excludeHolidays: l.exclude_holidays,
  monthlyDay: l.monthly_day ?? undefined,
  roundingUnit: l.rounding_unit,
});

/** Pagos vigentes: los que no tienen reverso. El orden de registro desempata los del mismo día. */
export const livePayments = (ledger: LedgerRow[]) =>
  ledger
    .filter((e) => e.type === 'payment' && !e.reversed_by)
    .map((e) => ({ id: e.id, date: e.entry_date, order: new Date(e.recorded_at).toISOString() + e.id, amount: e.amount }));

export function bucketOf(balance: number, daysPastDue: number): 'current' | 'd1_7' | 'd8_30' | 'd30p' | 'closed' {
  if (balance === 0) return 'closed';
  if (daysPastDue === 0) return 'current';
  if (daysPastDue <= 7) return 'd1_7';
  if (daysPastDue <= 30) return 'd8_30';
  return 'd30p';
}

/**
 * Estado del préstamo derivado del libro con @coroc/core (ADR-003) y su caché de lectura `loan_state` (ADR-021).
 * Se recalcula dentro de la misma transacción que registra cada movimiento.
 */
@Injectable()
export class LoanStateService {
  private readonly log = new Logger('EstadoPrestamos');
  private readonly running = new Map<string, Promise<number>>();

  constructor(private readonly db: DbService) {}

  async load(tx: Tx, loanId: string, forUpdate = false): Promise<LoadedLoan | null> {
    const loan = await tx.one<LoanRow>(`SELECT * FROM loans WHERE id = $1${forUpdate ? ' FOR UPDATE' : ''}`, [loanId]);
    if (!loan) return null;
    const plan = await tx.many<InstallmentRow>('SELECT number, due_date, amount, principal, interest, balance_after FROM installments WHERE loan_id = $1 ORDER BY number', [loanId]);
    const ledger = await tx.many<LedgerRow>(
      `SELECT e.*, r.id AS reversed_by FROM ledger_entries e
         LEFT JOIN ledger_entries r ON r.reverses_id = e.id
        WHERE e.loan_id = $1 ORDER BY e.entry_date, e.recorded_at, e.id`,
      [loanId],
    );
    return { loan, plan, ledger };
  }

  replay(l: LoadedLoan, asOf: string): LoanReplay {
    return replayLoan(
      l.plan.map((i) => ({ number: i.number, dueDate: i.due_date, amount: i.amount })),
      livePayments(l.ledger),
      asOf,
      l.loan.late_fee,
    );
  }

  /** Recalcula un préstamo ya cargado (dentro de la transacción de su movimiento). */
  async recompute(tx: Tx, l: LoadedLoan, asOf: string): Promise<LoanReplay> {
    const r = this.replay(l, asOf);
    await this.upsert(tx, [{ l, r }], asOf, 'force');
    return r;
  }

  private stateRow(l: LoadedLoan, r: LoanReplay, asOf: string) {
    const s = r.summary;
    let dueToday = 0;
    let overdueAmount = 0;
    for (const st of r.states) {
      const out = Math.max(0, st.amount - st.paid) + Math.max(0, (st.lateFeeAccrued ?? 0) - (st.lateFeePaid ?? 0));
      if (st.dueDate === asOf) dueToday += Math.max(0, st.amount - st.paid);
      if (st.dueDate < asOf) overdueAmount += out;
    }
    return [
      l.loan.id, l.loan.client_id, l.loan.currency, asOf, s.totalPayable, s.paidTotal, s.balance, s.lateFeesOutstanding, r.surplus,
      s.paidInstallments, s.remainingInstallments, s.overdueCount, overdueAmount, s.daysPastDue, dueToday,
      s.next?.number ?? null, s.next?.dueDate ?? null, s.next?.outstanding ?? null, bucketOf(s.balance, s.daysPastDue), l.loan.principal,
    ] as const;
  }

  /** Escribe el estado de varios préstamos con una sola sentencia (unnest), y cierra o reabre según el saldo. */
  /**
   * `force`: después de un movimiento (siempre gana). `ifOlder`: mantenimiento diario; no pisa un estado que un pago
   * más reciente ya dejó con la fecha de hoy (evita la carrera entre el trabajo nocturno y un pago simultáneo).
   */
  private async upsert(tx: Tx, items: { l: LoadedLoan; r: LoanReplay }[], asOf: string, mode: 'force' | 'ifOlder'): Promise<void> {
    if (!items.length) return;
    const rows = items.map(({ l, r }) => this.stateRow(l, r, asOf));
    const col = (k: number) => rows.map((x) => x[k]);
    await tx.exec(
      `INSERT INTO loan_state (loan_id, tenant_id, client_id, currency, as_of, total_payable, paid_total, balance, late_fees_outstanding, surplus,
                               paid_installments, remaining_installments, overdue_count, overdue_amount, days_past_due, due_today_amount,
                               next_number, next_due_date, next_outstanding, bucket, principal, updated_at)
       SELECT u.loan_id, current_tenant(), u.client_id, u.currency, u.as_of, u.total_payable, u.paid_total, u.balance, u.late_fees, u.surplus,
              u.paid_i, u.remaining_i, u.overdue_c, u.overdue_a, u.dpd, u.due_today, u.next_n, u.next_d, u.next_o, u.bucket, u.principal, now()
         FROM unnest($1::uuid[], $2::uuid[], $3::char(3)[], $4::date[], $5::bigint[], $6::bigint[], $7::bigint[], $8::bigint[], $9::bigint[],
                     $10::int[], $11::int[], $12::int[], $13::bigint[], $14::int[], $15::bigint[], $16::int[], $17::date[], $18::bigint[], $19::text[], $20::bigint[])
           AS u(loan_id, client_id, currency, as_of, total_payable, paid_total, balance, late_fees, surplus, paid_i, remaining_i, overdue_c,
                overdue_a, dpd, due_today, next_n, next_d, next_o, bucket, principal)
       ON CONFLICT (loan_id) DO UPDATE SET principal = EXCLUDED.principal, as_of = EXCLUDED.as_of, total_payable = EXCLUDED.total_payable, paid_total = EXCLUDED.paid_total,
         balance = EXCLUDED.balance, late_fees_outstanding = EXCLUDED.late_fees_outstanding, surplus = EXCLUDED.surplus,
         paid_installments = EXCLUDED.paid_installments, remaining_installments = EXCLUDED.remaining_installments,
         overdue_count = EXCLUDED.overdue_count, overdue_amount = EXCLUDED.overdue_amount, days_past_due = EXCLUDED.days_past_due,
         due_today_amount = EXCLUDED.due_today_amount, next_number = EXCLUDED.next_number, next_due_date = EXCLUDED.next_due_date,
         next_outstanding = EXCLUDED.next_outstanding, bucket = EXCLUDED.bucket, updated_at = now()
       ${mode === 'ifOlder' ? 'WHERE loan_state.as_of < EXCLUDED.as_of' : ''}`,
      Array.from({ length: 20 }, (_, k) => col(k)),
    );
    // El cierre o la reapertura solo cambian con un movimiento (el paso del tiempo no salda ni reabre un préstamo).
    const toggle = mode === 'force' ? items.filter(({ l, r }) => l.loan.status !== 'written_off' && (r.summary.balance === 0) !== (l.loan.status === 'closed')) : [];
    for (const { l, r } of toggle) {
      const closed = r.summary.balance === 0;
      await tx.exec(`UPDATE loans SET status = $2, closed_at = ${closed ? 'now()' : 'NULL'}, version = version + 1 WHERE id = $1`, [l.loan.id, closed ? 'closed' : 'active']);
      l.loan.status = closed ? 'closed' : 'active';
    }
  }

  /** Carga varios préstamos con tres consultas (préstamos, cuotas, libro) para recalcularlos en bloque. */
  async loadMany(tx: Tx, ids: string[]): Promise<LoadedLoan[]> {
    if (!ids.length) return [];
    const loans = await tx.many<LoanRow>('SELECT * FROM loans WHERE id = ANY($1::uuid[])', [ids]);
    const plans = await tx.many<InstallmentRow & { loan_id: string }>('SELECT loan_id, number, due_date, amount, principal, interest, balance_after FROM installments WHERE loan_id = ANY($1::uuid[]) ORDER BY loan_id, number', [ids]);
    const ledgers = await tx.many<LedgerRow & { loan_id: string }>(
      `SELECT e.*, r.id AS reversed_by FROM ledger_entries e LEFT JOIN ledger_entries r ON r.reverses_id = e.id
        WHERE e.loan_id = ANY($1::uuid[]) ORDER BY e.loan_id, e.entry_date, e.recorded_at, e.id`,
      [ids],
    );
    const group = <T extends { loan_id: string }>(rows: T[]) => {
      const m = new Map<string, T[]>();
      for (const r of rows) (m.get(r.loan_id) ?? m.set(r.loan_id, []).get(r.loan_id)!).push(r);
      return m;
    };
    const p = group(plans);
    const g = group(ledgers);
    return loans.map((loan) => ({ loan, plan: p.get(loan.id) ?? [], ledger: g.get(loan.id) ?? [] }));
  }

  /**
   * Pone al día los préstamos cuyo estado es de un día anterior: vencidos, días de mora y mora causada cambian con la
   * fecha. Lo hace el trabajo de cada hora, en bloques de 2.000 préstamos, cada bloque en su propia transacción.
   */
  refreshStale(ctx: TxContext, asOf: string): Promise<number> {
    const key = `${ctx.tenantId}|${asOf}`;
    const running = this.running.get(key);
    if (running) return running;
    const job = (async () => {
      let total = 0;
      for (;;) {
        const done = await this.db.tx({ tenantId: ctx.tenantId }, async (tx) => {
          const ids = (await tx.many<{ loan_id: string }>("SELECT loan_id FROM loan_state WHERE as_of < $1 AND bucket <> 'closed' LIMIT 2000", [asOf])).map((r) => r.loan_id);
          const batch = await this.loadMany(tx, ids);
          await this.upsert(tx, batch.map((l) => ({ l, r: this.replay(l, asOf) })), asOf, 'ifOlder');
          return ids.length;
        });
        total += done;
        if (done < 2000) break;
      }
      if (total) this.log.log(`${total} préstamos puestos al día (${asOf})`);
      return total;
    })().finally(() => this.running.delete(key));
    this.running.set(key, job);
    return job;
  }

  /**
   * Antes de responder una consulta: si quedan pocos préstamos sin actualizar se ponen al día de inmediato; si son
   * muchos (el trabajo de la hora aún no pasó) se actualizan en segundo plano y la respuesta lo indica.
   */
  async ensureFresh(ctx: TxContext, asOf: string): Promise<boolean> {
    const stale = await this.db.tx({ tenantId: ctx.tenantId }, (tx) =>
      tx.one<{ n: number }>("SELECT count(*)::int AS n FROM (SELECT 1 FROM loan_state WHERE as_of < $1 AND bucket <> 'closed' LIMIT 3001) x", [asOf]),
    );
    if (!stale?.n) return false;
    if (stale.n <= 3000) {
      await this.refreshStale(ctx, asOf);
      return false;
    }
    void this.refreshStale(ctx, asOf).catch((e: Error) => this.log.error(e.message));
    return true;
  }
}
