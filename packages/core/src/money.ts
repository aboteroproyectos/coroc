import Decimal from 'decimal.js';

/**
 * Dinero en COROC: siempre enteros en la unidad mínima de la moneda
 * (COP = peso, BRL = centavo, USD = centavo). Nunca float para montos.
 * Los cálculos intermedios con tasas usan Decimal de 40 dígitos.
 */
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type Currency = 'COP' | 'BRL' | 'USD';

export const CURRENCIES: Record<Currency, { minorDigits: number; defaultLocale: string }> = {
  COP: { minorDigits: 0, defaultLocale: 'es-CO' },
  BRL: { minorDigits: 2, defaultLocale: 'pt-BR' },
  USD: { minorDigits: 2, defaultLocale: 'en-US' },
};

export { Decimal };

/** Convierte un texto decimal ("1250000", "60,50" no: usar punto) a unidades mínimas. */
export function toMinor(amount: string | number, currency: Currency): number {
  const d = new Decimal(amount).mul(new Decimal(10).pow(CURRENCIES[currency].minorDigits));
  return assertSafe(d.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber());
}

/** Convierte unidades mínimas a Decimal en unidades mayores. */
export function fromMinor(minor: number, currency: Currency): Decimal {
  return new Decimal(minor).div(new Decimal(10).pow(CURRENCIES[currency].minorDigits));
}

/** Redondea un Decimal (en unidades mínimas) al múltiplo de `unit`, mitad hacia arriba. */
export function roundToUnit(value: Decimal, unit = 1): number {
  if (!Number.isInteger(unit) || unit < 1) throw new RangeError('La unidad de redondeo debe ser un entero ≥ 1');
  const q = value.div(unit).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return assertSafe(q.mul(unit).toNumber());
}

export function assertSafe(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`Monto fuera de rango seguro: ${n}`);
  return n;
}

/** Formatea unidades mínimas según idioma y moneda. */
export function formatMoney(minor: number, currency: Currency, locale?: string): string {
  const digits = CURRENCIES[currency].minorDigits;
  const loc = locale ?? CURRENCIES[currency].defaultLocale;
  const nf = new Intl.NumberFormat(loc, {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return nf.format(fromMinor(minor, currency).toNumber()).replace(/ /g, ' ');
}
