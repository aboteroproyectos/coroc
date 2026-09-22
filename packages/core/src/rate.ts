import { Decimal } from './money';
import { daysBetween, type IsoDate } from './calendar';
import { buildSchedule, type LoanTerms, type Schedule } from './schedule';

export interface CashFlow {
  date: IsoDate;
  /** Negativo = salida (desembolso); positivo = entrada (cuota). Unidades mínimas. */
  amount: number;
}

/**
 * Tasa efectiva anual (TIR sobre fechas reales, base 365 días) de flujos convencionales:
 * un desembolso seguido de cobros. Se resuelve la tasa diaria por bisección y se anualiza.
 * Las tasas no son dinero: aquí se usa aritmética de punto flotante con tolerancia 1e-12.
 */
export function effectiveAnnualRate(flows: CashFlow[]): number {
  if (flows.length < 2) throw new RangeError('Se necesitan al menos dos flujos');
  const t0 = flows[0]!.date;
  const pts = flows.map((f) => ({ t: daysBetween(t0, f.date), a: f.amount }));
  const npv = (d: number) => pts.reduce((s, p) => s + p.a / Math.pow(1 + d, p.t), 0);
  let lo = -0.999;
  let hi = 1;
  while (npv(hi) > 0 && hi < 1e6) hi *= 2;
  if (npv(lo) < 0 || npv(hi) > 0) throw new RangeError('Los flujos no tienen una tasa interna única');
  for (let k = 0; k < 400; k++) {
    const mid = (lo + hi) / 2;
    if (npv(mid) > 0) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-15) break;
  }
  const daily = (lo + hi) / 2;
  const annual = Math.pow(1 + daily, 365) - 1;
  return Number.isFinite(annual) ? annual : Number.MAX_VALUE;
}

export function scheduleFlows(s: Schedule): CashFlow[] {
  return [
    { date: s.terms.disbursementDate, amount: -s.terms.principal },
    ...s.installments.map((i) => ({ date: i.dueDate, amount: i.amount })),
  ];
}

export function loanEffectiveAnnualRate(terms: LoanTerms): number {
  return effectiveAnnualRate(scheduleFlows(buildSchedule(terms)));
}

export interface RateCapCheck {
  ok: boolean;
  effectiveAnnual: number;
  cap: number;
  /** Tasa máxima (en la misma convención de `terms.rate`) que cumple el tope, redondeada hacia abajo a 0,01 %. */
  maxRate?: string;
}

/** Verifica el tope legal (§9.6). `cap` = tasa efectiva anual máxima, p. ej. la tasa de usura vigente. */
export function checkRateCap(terms: LoanTerms, cap: number): RateCapCheck {
  const ea = loanEffectiveAnnualRate(terms);
  if (ea <= cap + 1e-12) return { ok: true, effectiveAnnual: ea, cap };
  return { ok: false, effectiveAnnual: ea, cap, maxRate: maxCompliantRate(terms, cap) };
}

export function maxCompliantRate(terms: LoanTerms, cap: number): string {
  let lo = new Decimal(0);
  let hi = new Decimal(terms.rate);
  const step = new Decimal('0.0001');
  const eaAt = (r: Decimal) => loanEffectiveAnnualRate({ ...terms, rate: r.toFixed(10) });
  for (let k = 0; k < 80 && hi.minus(lo).gt(new Decimal('1e-9')); k++) {
    const mid = lo.plus(hi).div(2);
    if (eaAt(mid) <= cap) lo = mid;
    else hi = mid;
  }
  let r = lo.div(step).floor().mul(step);
  while (r.gt(0) && eaAt(r) > cap) r = r.minus(step);
  return r.toFixed(4);
}

/** Mora porcentual diaria: su equivalente efectivo anual no puede superar el tope. */
export function dailyLateFeeWithinCap(dailyFraction: string, cap: number): boolean {
  const ea = Math.pow(1 + Number(dailyFraction), 365) - 1;
  return ea <= cap + 1e-12;
}
