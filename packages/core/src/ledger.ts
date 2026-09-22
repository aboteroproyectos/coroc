import { accrueLateFees, allocateInPlace, summarize, statusOf, type AllocationResult, type InstallmentState, type InstallmentStatus, type LateFeePolicy, type LoanSummary } from './allocation.js';
import type { IsoDate } from './calendar.js';
import { stripAccents } from './text.js';

/** Cuota pactada tal como quedó en el plan de pagos. */
export interface PlannedInstallment {
  number: number;
  dueDate: IsoDate;
  amount: number;
}

/** Pago vigente del libro (los reversados ya se excluyeron). `order` desempata pagos del mismo día (instante de registro). */
export interface LedgerPayment {
  id: string;
  date: IsoDate;
  order: string;
  amount: number;
}

export interface LoanReplay {
  states: (InstallmentState & { status: InstallmentStatus; lastPaymentDate: IsoDate | null })[];
  summary: LoanSummary;
  allocations: Map<string, AllocationResult>;
  /** Saldo a favor acumulado (§9.5-3). */
  surplus: number;
}

/**
 * Reconstruye el estado de un préstamo aplicando, en orden cronológico, los pagos vigentes del libro (§9.7, ADR-003).
 * La mora se causa hasta la fecha de cada pago y luego hasta `asOf`.
 */
export function replayLoan(plan: PlannedInstallment[], payments: LedgerPayment[], asOf: IsoDate, lateFee?: LateFeePolicy | null): LoanReplay {
  let states: InstallmentState[] = plan
    .map((i) => ({ number: i.number, dueDate: i.dueDate, amount: i.amount, paid: 0, lateFeeAccrued: 0, lateFeePaid: 0 }))
    .sort((a, b) => a.number - b.number);
  const lastPay = new Map<number, IsoDate>();
  const allocations = new Map<string, AllocationResult>();
  let surplus = 0;
  const ordered = [...payments].sort((a, b) => (a.date === b.date ? (a.order < b.order ? -1 : a.order > b.order ? 1 : 0) : a.date < b.date ? -1 : 1));
  let from = 0;
  for (const p of ordered) {
    if (lateFee) states = accrueLateFees(states, p.date, lateFee);
    const r = allocateInPlace(states, p.amount, lateFee ? 0 : from);
    from = r.nextFrom;
    allocations.set(p.id, { lines: r.lines, applied: r.applied, surplus: r.surplus, after: states });
    for (const l of r.lines) lastPay.set(l.number, p.date);
    surplus += r.surplus;
  }
  if (lateFee) states = accrueLateFees(states, asOf, lateFee);
  return {
    states: states.map((s) => ({ ...s, status: statusOf(s, asOf), lastPaymentDate: lastPay.get(s.number) ?? null })),
    summary: summarize(states, asOf),
    allocations,
    surplus,
  };
}

/**
 * Nombre de carpeta portable entre Windows, macOS, Android, iOS, ZIP y nubes (ADR-013):
 * sin tildes ni caracteres no ASCII, sin `< > : " / \ | ? *`, sin puntos ni espacios finales.
 */
export function sanitizeFolderName(s: string): string {
  return stripAccents(String(s))
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
}

/** «Nombre Apellidos - Código» (§16.3). */
export function clientFolderName(firstName: string, lastName: string, code: string): string {
  return sanitizeFolderName(`${firstName} ${lastName} - ${code}`);
}
