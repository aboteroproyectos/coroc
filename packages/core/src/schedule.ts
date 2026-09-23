import { Decimal, roundToUnit, type Currency } from './money.js';
import {
  addDays,
  addMonthsClamped,
  nextCollectionDay,
  type CollectionCalendar,
  type CountryCode,
  type IsoDate,
} from './calendar.js';

export type Frequency = 'daily' | 'weekly' | 'monthly';
/** simple = interés fijo sobre el capital (estilo prestamista); french = cuota fija con amortización. */
export type Method = 'simple' | 'french';

export interface LoanTerms {
  /** Capital en unidades mínimas de la moneda. */
  principal: number;
  currency: Currency;
  method: Method;
  /** Fracción decimal como texto. simple: tasa sobre el total del préstamo ("0.20"); french: tasa por período ("0.02"). */
  rate: string;
  installments: number;
  frequency: Frequency;
  disbursementDate: IsoDate;
  firstDueDate?: IsoDate;
  country: CountryCode;
  /** Días de cobro ISO (1 = lunes … 7 = domingo). Por defecto lunes a sábado. */
  collectionDays?: number[];
  /** Excluir festivos del país. Por defecto true. */
  excludeHolidays?: boolean;
  /** Día del mes para la frecuencia mensual (1–31). */
  monthlyDay?: number;
  /** Unidad de redondeo de la cuota, en unidades mínimas (COP: 1, 50, 100, 1000; BRL/USD: 1 = 0,01). */
  roundingUnit?: number;
}

export interface ScheduledInstallment {
  number: number;
  dueDate: IsoDate;
  /** Valor de la cuota en unidades mínimas. */
  amount: number;
  principal: number;
  interest: number;
  /** Saldo pactado (capital + intereses) después de pagar esta cuota. */
  balanceAfter: number;
}

export interface Schedule {
  terms: Required<Omit<LoanTerms, 'firstDueDate' | 'monthlyDay'>> & { firstDueDate: IsoDate; monthlyDay?: number };
  installments: ScheduledInstallment[];
  regularInstallment: number;
  totalPayable: number;
  totalInterest: number;
}

export class TermsError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'TermsError';
  }
}

export function validateTerms(t: LoanTerms): void {
  if (!Number.isSafeInteger(t.principal) || t.principal <= 0) throw new TermsError('PRINCIPAL', 'El capital debe ser un entero positivo en unidades mínimas.');
  if (!Number.isInteger(t.installments) || t.installments < 1 || t.installments > 3660) throw new TermsError('INSTALLMENTS', 'El total de cuotas debe ser un entero entre 1 y 3660.');
  let r: Decimal;
  try {
    r = new Decimal(t.rate);
  } catch {
    throw new TermsError('RATE', 'La tasa no es un número válido.');
  }
  if (r.isNeg() || r.gt(100)) throw new TermsError('RATE', 'La tasa debe estar entre 0 y 10.000 %.');
  if (t.collectionDays && (t.collectionDays.length === 0 || t.collectionDays.some((d) => !Number.isInteger(d) || d < 1 || d > 7))) {
    throw new TermsError('COLLECTION_DAYS', 'Los días de cobro deben ser valores entre 1 (lunes) y 7 (domingo).');
  }
  if (t.monthlyDay !== undefined && (!Number.isInteger(t.monthlyDay) || t.monthlyDay < 1 || t.monthlyDay > 31)) {
    throw new TermsError('MONTHLY_DAY', 'El día de cobro mensual debe estar entre 1 y 31.');
  }
  if (t.firstDueDate && t.firstDueDate <= t.disbursementDate) {
    throw new TermsError('FIRST_DUE', 'La primera cuota debe ser posterior a la fecha de desembolso.');
  }
}

export function calendarFor(t: LoanTerms): CollectionCalendar {
  return {
    country: t.country,
    collectionDays: t.collectionDays ?? [1, 2, 3, 4, 5, 6],
    excludeHolidays: t.excludeHolidays ?? true,
  };
}

/** Fechas de vencimiento según frecuencia, días de cobro y festivos (§9.3). */
export function dueDates(t: LoanTerms): IsoDate[] {
  const cal = calendarFor(t);
  const n = t.installments;
  const out: IsoDate[] = [];
  if (t.frequency === 'daily') {
    let cur = nextCollectionDay(cal, t.firstDueDate ?? addDays(t.disbursementDate, 1));
    for (let k = 0; k < n; k++) {
      out.push(cur);
      cur = nextCollectionDay(cal, addDays(cur, 1));
    }
    return out;
  }
  if (t.frequency === 'weekly') {
    const base = t.firstDueDate ?? addDays(t.disbursementDate, 7);
    for (let k = 0; k < n; k++) {
      let d = nextCollectionDay(cal, addDays(base, 7 * k));
      const prev = out[out.length - 1];
      if (prev && d <= prev) d = nextCollectionDay(cal, addDays(prev, 1));
      out.push(d);
    }
    return out;
  }
  const base = t.firstDueDate ?? addMonthsClamped(t.disbursementDate, 1, t.monthlyDay);
  const day = t.monthlyDay ?? Number(base.slice(8, 10));
  for (let k = 0; k < n; k++) {
    let d = nextCollectionDay(cal, addMonthsClamped(base, k, day));
    const prev = out[out.length - 1];
    if (prev && d <= prev) d = nextCollectionDay(cal, addDays(prev, 1));
    out.push(d);
  }
  return out;
}

/** Genera el plan de pagos completo (§9.1–§9.4). */
export function buildSchedule(t: LoanTerms): Schedule {
  validateTerms(t);
  const unit = t.roundingUnit ?? 1;
  const n = t.installments;
  const P = new Decimal(t.principal);
  const rate = new Decimal(t.rate);
  const dates = dueDates(t);
  const rows: ScheduledInstallment[] = [];

  if (t.method === 'simple' || rate.isZero()) {
    const total = roundToUnit(t.method === 'simple' ? P.mul(rate.plus(1)) : P, 1);
    const regular = roundToUnit(new Decimal(total).div(n), unit);
    const last = total - regular * (n - 1);
    if (last <= 0) throw new TermsError('ROUNDING', 'La unidad de redondeo es demasiado grande para este préstamo.');
    let principalAcc = 0;
    let balance = total;
    for (let k = 0; k < n; k++) {
      const amount = k === n - 1 ? last : regular;
      const principal = k === n - 1
        ? t.principal - principalAcc
        : roundToUnit(new Decimal(amount).mul(t.principal).div(total), 1);
      principalAcc += principal;
      balance -= amount;
      rows.push({ number: k + 1, dueDate: dates[k]!, amount, principal, interest: amount - principal, balanceAfter: balance });
    }
    return finalize(t, rows, regular, dates[0]!);
  }

  // Sistema francés: cuota fija, intereses sobre saldo de capital.
  const factor = rate.mul(P).div(new Decimal(1).minus(rate.plus(1).pow(-n)));
  const regular = roundToUnit(factor, unit);
  let capitalBalance = t.principal;
  const provisional: Omit<ScheduledInstallment, 'balanceAfter'>[] = [];
  for (let k = 0; k < n; k++) {
    const interest = roundToUnit(new Decimal(capitalBalance).mul(rate), 1);
    let principal = regular - interest;
    if (k === n - 1) principal = capitalBalance;
    if (principal <= 0) throw new TermsError('ROUNDING', 'La cuota no alcanza a cubrir los intereses del período.');
    capitalBalance -= principal;
    provisional.push({ number: k + 1, dueDate: dates[k]!, amount: principal + interest, principal, interest });
  }
  const totalPayable = provisional.reduce((s, r) => s + r.amount, 0);
  let bal = totalPayable;
  for (const r of provisional) {
    bal -= r.amount;
    rows.push({ ...r, balanceAfter: bal });
  }
  return finalize(t, rows, regular, dates[0]!);
}

function finalize(t: LoanTerms, rows: ScheduledInstallment[], regular: number, firstDue: IsoDate): Schedule {
  const totalPayable = rows.reduce((s, r) => s + r.amount, 0);
  return {
    terms: {
      ...t,
      firstDueDate: t.firstDueDate ?? firstDue,
      collectionDays: t.collectionDays ?? [1, 2, 3, 4, 5, 6],
      excludeHolidays: t.excludeHolidays ?? true,
      roundingUnit: t.roundingUnit ?? 1,
    },
    installments: rows,
    regularInstallment: regular,
    totalPayable,
    totalInterest: totalPayable - t.principal,
  };
}
