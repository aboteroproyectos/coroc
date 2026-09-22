import holidaysData from './holidays.json' with { type: 'json' };

/** Fechas civiles en formato ISO `YYYY-MM-DD`, sin zona horaria (se interpretan en la zona de la empresa). */
export type IsoDate = string;
export type CountryCode = 'CO' | 'BR' | 'US';

const HOLIDAYS = (holidaysData as { version: string; countries: Record<string, Record<string, string>> });
export const HOLIDAY_DATA_VERSION = HOLIDAYS.version;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toUtc(d: IsoDate): Date {
  if (!DATE_RE.test(d)) throw new RangeError(`Fecha inválida: ${d}`);
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, day));
  if (dt.getUTCMonth() !== m - 1) throw new RangeError(`Fecha inexistente: ${d}`);
  return dt;
}

function fromUtc(dt: Date): IsoDate {
  return dt.toISOString().slice(0, 10);
}

export function addDays(d: IsoDate, n: number): IsoDate {
  const dt = toUtc(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fromUtc(dt);
}

/** 1 = lunes … 7 = domingo (ISO 8601). */
export function isoWeekday(d: IsoDate): number {
  const w = toUtc(d).getUTCDay();
  return w === 0 ? 7 : w;
}

export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

export function lastDayOfMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** Suma meses conservando el día deseado; si el mes no lo tiene, usa el último día del mes. */
export function addMonthsClamped(d: IsoDate, months: number, preferredDay?: number): IsoDate {
  const dt = toUtc(d);
  const targetDay = preferredDay ?? dt.getUTCDate();
  const total = dt.getUTCFullYear() * 12 + dt.getUTCMonth() + months;
  const y = Math.floor(total / 12);
  const m0 = total % 12;
  const day = Math.min(targetDay, lastDayOfMonth(y, m0 + 1));
  return fromUtc(new Date(Date.UTC(y, m0, day)));
}

export function holidayName(country: CountryCode, d: IsoDate): string | undefined {
  return HOLIDAYS.countries[country]?.[d];
}

export function isHoliday(country: CountryCode, d: IsoDate): boolean {
  return holidayName(country, d) !== undefined;
}

export function holidayYearsCovered(country: CountryCode): [number, number] {
  const years = Object.keys(HOLIDAYS.countries[country] ?? {}).map((k) => Number(k.slice(0, 4)));
  return [Math.min(...years), Math.max(...years)];
}

export interface CollectionCalendar {
  country: CountryCode;
  /** Días ISO en los que se cobra (1 = lunes … 7 = domingo). */
  collectionDays: number[];
  excludeHolidays: boolean;
}

export function isCollectionDay(cal: CollectionCalendar, d: IsoDate): boolean {
  if (!cal.collectionDays.includes(isoWeekday(d))) return false;
  if (cal.excludeHolidays) {
    const [from, to] = holidayYearsCovered(cal.country);
    const y = Number(d.slice(0, 4));
    if (y < from || y > to) {
      throw new RangeError(`Calendario de festivos ${cal.country} sin datos para ${y}; actualice los datos (${HOLIDAY_DATA_VERSION}).`);
    }
    if (isHoliday(cal.country, d)) return false;
  }
  return true;
}

/** Primer día de cobro igual o posterior a `d`. */
export function nextCollectionDay(cal: CollectionCalendar, d: IsoDate): IsoDate {
  if (cal.collectionDays.length === 0) throw new RangeError('Debe existir al menos un día de cobro');
  let cur = d;
  for (let i = 0; i < 370; i++) {
    if (isCollectionDay(cal, cur)) return cur;
    cur = addDays(cur, 1);
  }
  throw new RangeError('No se encontró un día de cobro en el próximo año');
}
