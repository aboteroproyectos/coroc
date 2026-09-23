import { addDays, isHoliday, isoWeekday, type CountryCode, type IsoDate } from './calendar.js';

/**
 * Motor de reglas de contacto (§11.4).
 * Trabaja con fecha y hora LOCAL del deudor ("YYYY-MM-DDTHH:mm"); la conversión desde UTC
 * la hace el llamador con la zona horaria del deudor.
 */
export type LocalDateTime = string;
export type MessageKind = 'collection' | 'transactional';
export type Channel = 'whatsapp' | 'email';

export interface ContactWindow {
  /** 1 = lunes … 7 = domingo. */
  day: number;
  start: string; // "HH:mm"
  end: string; // "HH:mm", exclusivo
}

export interface ContactRuleSet {
  id: string;
  country: CountryCode;
  windows: ContactWindow[];
  noHolidays: boolean;
  maxCollectionPerDay: number;
  singleChannelPerWeek: boolean;
  /** Si true, los mensajes transaccionales también respetan las franjas. */
  windowsApplyToTransactional: boolean;
  legalReference: string;
}

const weekdays = (start: string, end: string) => [1, 2, 3, 4, 5].map((day) => ({ day, start, end }));

/** Colombia — Ley 2300 de 2023 ("Dejen de fregar"). */
export const RULESET_CO_LEY_2300: ContactRuleSet = {
  id: 'CO_LEY_2300_2023',
  country: 'CO',
  windows: [...weekdays('07:00', '19:00'), { day: 6, start: '08:00', end: '15:00' }],
  noHolidays: true,
  maxCollectionPerDay: 1,
  singleChannelPerWeek: true,
  windowsApplyToTransactional: true,
  legalReference: 'Ley 2300 de 2023, arts. 3 y 4',
};

export interface ContactRecord {
  at: LocalDateTime;
  kind: MessageKind;
  channel: Channel;
}

export interface ContactRequest {
  kind: MessageKind;
  channel: Channel;
  requestedAt: LocalDateTime;
}

export type ReasonCode =
  | 'OUT_OF_WINDOW'
  | 'HOLIDAY_SKIPPED'
  | 'MAX_PER_DAY'
  | 'CHANNEL_WEEK'
  | 'TRANSACTIONAL_IMMEDIATE'
  | 'DEBTOR_EXCEPTION';

export interface ContactDecision {
  decision: 'send' | 'reschedule' | 'block';
  at?: LocalDateTime;
  reasons: { code: ReasonCode; detail?: string }[];
  ruleSet: string;
}

export interface ContactOptions {
  /** El propietario habilitó el envío inmediato de transaccionales (queda documentado en Ayuda). */
  transactionalImmediate?: boolean;
  /** Franjas autorizadas por escrito por el deudor (documento distinto y posterior al contrato). */
  debtorAuthorizedWindows?: ContactWindow[];
}

const DT_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

function split(at: LocalDateTime): { date: IsoDate; minutes: number } {
  const m = DT_RE.exec(at);
  if (!m) throw new RangeError(`Fecha y hora local inválida: ${at}`);
  return { date: m[1]!, minutes: Number(m[2]) * 60 + Number(m[3]) };
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const fmt = (date: IsoDate, minutes: number) =>
  `${date}T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** ISO: la semana va de lunes a domingo; se identifica por su lunes. */
export function weekKey(date: IsoDate): IsoDate {
  return addDays(date, 1 - isoWeekday(date));
}

/** Primer instante permitido igual o posterior a `at`. */
export function nextAllowedInstant(
  at: LocalDateTime,
  rules: ContactRuleSet,
  windowsOverride?: ContactWindow[],
): { at: LocalDateTime; skippedHolidays: IsoDate[] } {
  const windows = windowsOverride ?? rules.windows;
  const { date, minutes } = split(at);
  const skipped: IsoDate[] = [];
  for (let k = 0; k < 21; k++) {
    const d = addDays(date, k);
    if (rules.noHolidays && !windowsOverride && isHoliday(rules.country, d)) {
      skipped.push(d);
      continue;
    }
    const todays = windows.filter((w) => w.day === isoWeekday(d)).sort((a, b) => toMin(a.start) - toMin(b.start));
    for (const w of todays) {
      const s = toMin(w.start);
      const e = toMin(w.end);
      if (k === 0) {
        if (minutes < s) return { at: fmt(d, s), skippedHolidays: skipped };
        if (minutes < e) return { at, skippedHolidays: skipped };
      } else {
        return { at: fmt(d, s), skippedHolidays: skipped };
      }
    }
  }
  throw new RangeError('No hay franjas de contacto en las próximas tres semanas');
}

/** Decide si un mensaje se envía, se reprograma o se bloquea, y por qué. */
export function evaluateContact(
  req: ContactRequest,
  history: ContactRecord[],
  rules: ContactRuleSet,
  opts: ContactOptions = {},
): ContactDecision {
  const reasons: ContactDecision['reasons'] = [];
  const base = { ruleSet: rules.id };

  if (req.kind === 'transactional' && (opts.transactionalImmediate || !rules.windowsApplyToTransactional)) {
    return { ...base, decision: 'send', at: req.requestedAt, reasons: [{ code: 'TRANSACTIONAL_IMMEDIATE' }] };
  }

  const override = opts.debtorAuthorizedWindows?.length ? opts.debtorAuthorizedWindows : undefined;
  if (override) reasons.push({ code: 'DEBTOR_EXCEPTION' });
  const next = nextAllowedInstant(req.requestedAt, rules, override);
  if (next.at !== req.requestedAt) reasons.push({ code: 'OUT_OF_WINDOW' });
  for (const h of next.skippedHolidays) reasons.push({ code: 'HOLIDAY_SKIPPED', detail: h });

  if (req.kind === 'collection') {
    const day = split(next.at).date;
    const sameDay = history.filter((h) => h.kind === 'collection' && split(h.at).date === day);
    if (sameDay.length >= rules.maxCollectionPerDay) {
      return { ...base, decision: 'block', reasons: [...reasons, { code: 'MAX_PER_DAY', detail: day }] };
    }
    if (rules.singleChannelPerWeek) {
      const wk = weekKey(day);
      const established = history.find((h) => h.kind === 'collection' && weekKey(split(h.at).date) === wk);
      if (established && established.channel !== req.channel) {
        return { ...base, decision: 'block', reasons: [...reasons, { code: 'CHANNEL_WEEK', detail: established.channel }] };
      }
    }
  }

  if (next.at === req.requestedAt) return { ...base, decision: 'send', at: next.at, reasons };
  return { ...base, decision: 'reschedule', at: next.at, reasons };
}
