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
  /** Presets distintos de Colombia: plantillas que el propietario revisa con su asesor legal antes de activarlas. */
  requiresCounselReview?: boolean;
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

/**
 * Brasil: no hay una ley federal de franjas; el preset toma el Código de Defensa del Consumidor (art. 42, sin exponer ni
 * constreñir al deudor) y franjas comerciales habituales. Es una plantilla que exige revisión legal (§11.4).
 */
export const RULESET_BR_TEMPLATE: ContactRuleSet = {
  id: 'BR_CDC_TEMPLATE',
  country: 'BR',
  windows: [...weekdays('08:00', '20:00'), { day: 6, start: '08:00', end: '14:00' }],
  noHolidays: true,
  maxCollectionPerDay: 1,
  singleChannelPerWeek: false,
  windowsApplyToTransactional: true,
  legalReference: 'Código de Defesa do Consumidor (Lei 8.078/1990), art. 42',
  requiresCounselReview: true,
};

/**
 * EE. UU.: FDCPA y Regulation F (12 CFR 1006.6) consideran inconveniente contactar antes de las 8:00 o después de las
 * 21:00, hora local del deudor. Plantilla que exige revisión legal (§11.4).
 */
export const RULESET_US_TEMPLATE: ContactRuleSet = {
  id: 'US_FDCPA_REG_F_TEMPLATE',
  country: 'US',
  windows: [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, start: '08:00', end: '21:00' })),
  noHolidays: false,
  maxCollectionPerDay: 1,
  singleChannelPerWeek: false,
  windowsApplyToTransactional: false,
  legalReference: 'FDCPA 15 U.S.C. 1692c; Regulation F, 12 CFR 1006.6',
  requiresCounselReview: true,
};

export const CONTACT_PRESETS: Record<string, ContactRuleSet> = {
  [RULESET_CO_LEY_2300.id]: RULESET_CO_LEY_2300,
  [RULESET_BR_TEMPLATE.id]: RULESET_BR_TEMPLATE,
  [RULESET_US_TEMPLATE.id]: RULESET_US_TEMPLATE,
};

/** Preset sugerido para el país de la empresa. */
export function presetForCountry(country: CountryCode): ContactRuleSet {
  return country === 'BR' ? RULESET_BR_TEMPLATE : country === 'US' ? RULESET_US_TEMPLATE : RULESET_CO_LEY_2300;
}

/**
 * Reglas que se aplican de verdad. Un preset que exige revisión legal no rige hasta que se registre esa revisión; mientras
 * tanto se aplica el de Colombia, el más restrictivo, con los festivos del país de la empresa (§11.4).
 */
export function effectiveRuleSet(presetId: string | null | undefined, country: CountryCode, counselReviewed: boolean): ContactRuleSet {
  const chosen = (presetId && CONTACT_PRESETS[presetId]) || presetForCountry(country);
  if (!chosen.requiresCounselReview || counselReviewed) return chosen;
  return { ...RULESET_CO_LEY_2300, country };
}

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
  | 'DEBTOR_EXCEPTION'
  // Motivos de la mensajería, antes del motor: sin consentimiento, exclusión, sin dirección, dirección inválida,
  // contenido bloqueado por el validador o préstamo cerrado.
  | 'NO_CONSENT'
  | 'OPTED_OUT'
  | 'NO_ADDRESS'
  | 'ADDRESS_INVALID'
  | 'CONTENT_BLOCKED'
  | 'LOAN_CLOSED';

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

/** Partes de una fecha y hora en una zona IANA. */
function zoned(instant: Date, timeZone: string): { date: IsoDate; hh: number; mm: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hh: Number(parts.hour), mm: Number(parts.minute) };
}

/** Instante UTC → fecha y hora local "YYYY-MM-DDTHH:mm" en la zona del deudor. */
export function toLocalDateTime(instant: Date, timeZone: string): LocalDateTime {
  const z = zoned(instant, timeZone);
  return fmt(z.date, z.hh * 60 + z.mm);
}

/**
 * Fecha y hora local → instante UTC. En el salto de horario de verano, una hora local inexistente pasa a la primera
 * hora válida siguiente; una repetida toma la primera ocurrencia.
 */
export function fromLocalDateTime(local: LocalDateTime, timeZone: string): Date {
  const { date, minutes } = split(local);
  const naive = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), 0, minutes);
  let guess = naive;
  for (let i = 0; i < 3; i++) {
    const z = zoned(new Date(guess), timeZone);
    const seen = Date.UTC(Number(z.date.slice(0, 4)), Number(z.date.slice(5, 7)) - 1, Number(z.date.slice(8, 10)), z.hh, z.mm);
    const diff = naive - seen;
    if (diff === 0) return new Date(guess);
    guess += diff;
  }
  return new Date(guess);
}
