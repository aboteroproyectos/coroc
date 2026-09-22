import { Decimal, roundToUnit } from './money.js';
import { daysBetween, type IsoDate } from './calendar.js';

export type InstallmentStatus = 'pending' | 'partial' | 'paid' | 'overdue' | 'waived';

/** Estado vivo de una cuota, derivado del libro de movimientos. Montos en unidades mínimas. */
export interface InstallmentState {
  number: number;
  dueDate: IsoDate;
  amount: number;
  paid: number;
  lateFeeAccrued?: number;
  lateFeePaid?: number;
  waived?: boolean;
}

export interface AllocationLine {
  number: number;
  toLateFee: number;
  toInstallment: number;
  /** La cuota quedó totalmente pagada con este pago (y no lo estaba antes). */
  completed: boolean;
  /** La cuota recibió abono pero sigue con saldo. */
  partial: boolean;
}

export interface AllocationResult {
  lines: AllocationLine[];
  applied: number;
  /** Excedente sobre el saldo total: queda como saldo a favor (§9.5). */
  surplus: number;
  after: InstallmentState[];
}

const outstanding = (i: InstallmentState) => (i.waived ? 0 : Math.max(0, i.amount - i.paid));
const feeOutstanding = (i: InstallmentState) => (i.waived ? 0 : Math.max(0, (i.lateFeeAccrued ?? 0) - (i.lateFeePaid ?? 0)));

export function statusOf(i: InstallmentState, today: IsoDate): InstallmentStatus {
  if (i.waived) return 'waived';
  if (i.paid >= i.amount) return 'paid';
  if (i.dueDate < today) return 'overdue';
  return i.paid > 0 ? 'partial' : 'pending';
}

/**
 * Aplica un pago en orden estricto (§9.5):
 * 1) mora causada, de la cuota más antigua a la más reciente;
 * 2) cuotas pendientes en orden cronológico;
 * 3) excedente = saldo a favor.
 */
export function allocatePayment(installments: InstallmentState[], amount: number): AllocationResult {
  const after = installments.map((i) => ({ ...i })).sort((a, b) => a.number - b.number);
  const r = allocateInPlace(after, amount);
  return { ...r, after };
}

/**
 * Misma regla que `allocatePayment`, pero modifica `sorted` (ordenado por número) sin copiarlo. La usa la
 * reconstrucción del libro, que aplica miles de pagos seguidos (§21: 50.000 préstamos en segundos).
 * `from` es la primera cuota que puede tener saldo; se devuelve la siguiente para el próximo pago.
 */
export function allocateInPlace(sorted: InstallmentState[], amount: number, from = 0): Omit<AllocationResult, 'after'> & { nextFrom: number } {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new RangeError('El pago debe ser un entero positivo en unidades mínimas.');
  const lines: AllocationLine[] = [];
  const touched = new Map<number, { line: AllocationLine; paidBefore: number }>();
  const line = (i: InstallmentState) => {
    let t = touched.get(i.number);
    if (!t) {
      t = { line: { number: i.number, toLateFee: 0, toInstallment: 0, completed: false, partial: false }, paidBefore: i.paid };
      touched.set(i.number, t);
      lines.push(t.line);
    }
    return t.line;
  };
  let remaining = amount;
  // 1) Mora causada, de la cuota más antigua a la más reciente (solo existe en cuotas vencidas).
  for (let k = 0; k < sorted.length && remaining > 0; k++) {
    const i = sorted[k]!;
    const due = feeOutstanding(i);
    if (due <= 0) continue;
    const take = Math.min(due, remaining);
    const l = line(i);
    i.lateFeePaid = (i.lateFeePaid ?? 0) + take;
    l.toLateFee += take;
    remaining -= take;
  }
  // 2) Cuotas en orden cronológico; las anteriores a `from` ya están pagadas o condonadas.
  let k = from;
  while (k < sorted.length && outstanding(sorted[k]!) === 0) k++;
  for (; k < sorted.length && remaining > 0; k++) {
    const i = sorted[k]!;
    const due = outstanding(i);
    if (due <= 0) continue;
    const take = Math.min(due, remaining);
    const l = line(i); // antes de sumar: conserva lo pagado previamente para marcar «completa»
    i.paid += take;
    l.toInstallment += take;
    remaining -= take;
  }
  let nextFrom = from;
  while (nextFrom < sorted.length && outstanding(sorted[nextFrom]!) === 0) nextFrom++;
  for (const [n, t] of touched) {
    const i = sorted.find((x) => x.number === n)!;
    t.line.completed = i.paid >= i.amount && t.paidBefore < i.amount;
    t.line.partial = t.line.toInstallment > 0 && i.paid < i.amount;
  }
  lines.sort((a, b) => a.number - b.number);
  return { lines, applied: amount - remaining, surplus: remaining, nextFrom };
}

export interface LoanSummary {
  totalInstallments: number;
  paidInstallments: number;
  /** Cuotas que no están totalmente pagadas (excluye condonadas). */
  remainingInstallments: number;
  totalPayable: number;
  paidTotal: number;
  lateFeesOutstanding: number;
  /** Saldo por pagar: cuotas pendientes + mora causada no pagada. */
  balance: number;
  next?: { number: number; dueDate: IsoDate; outstanding: number };
  overdueCount: number;
  daysPastDue: number;
}

export function summarize(installments: InstallmentState[], today: IsoDate): LoanSummary {
  const sorted = [...installments].sort((a, b) => a.number - b.number);
  let paidTotal = 0;
  let balance = 0;
  let feesOut = 0;
  let paidCount = 0;
  let remaining = 0;
  let overdue = 0;
  let oldestOverdue: IsoDate | undefined;
  let next: LoanSummary['next'];
  for (const i of sorted) {
    paidTotal += i.paid + (i.lateFeePaid ?? 0);
    const o = outstanding(i);
    const f = feeOutstanding(i);
    balance += o + f;
    feesOut += f;
    if (i.waived) continue;
    if (o === 0) paidCount++;
    else {
      remaining++;
      if (!next) next = { number: i.number, dueDate: i.dueDate, outstanding: o };
      if (i.dueDate < today) {
        overdue++;
        if (!oldestOverdue) oldestOverdue = i.dueDate;
      }
    }
  }
  return {
    totalInstallments: sorted.length,
    paidInstallments: paidCount,
    remainingInstallments: remaining,
    totalPayable: sorted.reduce((s, i) => s + i.amount, 0),
    paidTotal,
    lateFeesOutstanding: feesOut,
    balance,
    next,
    overdueCount: overdue,
    daysPastDue: oldestOverdue ? daysBetween(oldestOverdue, today) : 0,
  };
}

export interface LateFeePolicy {
  type: 'percent_daily' | 'fixed_daily';
  /** percent_daily: fracción diaria sobre el saldo vencido ("0.001"); fixed_daily: unidades mínimas por día. */
  value: string;
  graceDays: number;
}

/** Mora causada a la fecha por cuota (el trabajo diario del servidor registra la diferencia en el libro). */
export function accrueLateFees(installments: InstallmentState[], asOf: IsoDate, policy: LateFeePolicy): InstallmentState[] {
  return installments.map((i) => {
    const o = outstanding(i);
    if (o === 0 || i.dueDate >= asOf) return { ...i };
    const days = daysBetween(i.dueDate, asOf) - policy.graceDays;
    if (days <= 0) return { ...i };
    const fee = policy.type === 'percent_daily'
      ? roundToUnit(new Decimal(o).mul(policy.value).mul(days), 1)
      : roundToUnit(new Decimal(policy.value).mul(days), 1);
    return { ...i, lateFeeAccrued: Math.max(i.lateFeeAccrued ?? 0, fee) };
  });
}
