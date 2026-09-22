import { parsePhoneNumberFromString, type CountryCode as PhoneCountry } from 'libphonenumber-js/min';
import { nameSimilarity, stripAccents } from './text';
import { daysBetween, type IsoDate } from './calendar';
import type { Currency } from './money';

/* ───────────────────────── Teléfonos ───────────────────────── */

/** Normaliza un número a E.164. Acepta formatos locales, internacionales y el `wa_id` de WhatsApp (sin "+"). */
export function normalizePhone(raw: string, defaultCountry: PhoneCountry = 'CO'): string | null {
  const cleaned = raw.trim();
  if (!cleaned) return null;
  const direct = parsePhoneNumberFromString(cleaned, defaultCountry);
  if (direct?.isValid()) return direct.number;
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length >= 10) {
    const intl = parsePhoneNumberFromString('+' + digits);
    if (intl?.isValid()) return intl.number;
  }
  return null;
}

/* ─────────────────── Identificación del remitente (§12.7) ─────────────────── */

export interface LoanRef {
  id: string;
  currency: Currency;
  /** Saldos pendientes de las cuotas no pagadas, en orden cronológico. */
  pendingAmounts: number[];
  oldestOverdueDate?: IsoDate;
}

export interface ClientRef {
  id: string;
  fullName: string;
  phones: string[]; // E.164, principal y secundario
  emails: string[];
  coDebtorPhones?: string[];
  coDebtorName?: string;
  active: boolean;
  loans: LoanRef[];
}

export interface SenderEvidence {
  phone?: string; // E.164
  email?: string;
  /** Cliente resuelto por el enlace personal de carga (§12.3). */
  uploadLinkClientId?: string;
  /** Cliente de la carpeta donde se dejó el archivo (§12.5). */
  folderClientId?: string;
  payerName?: string;
  amount?: number;
}

export interface Candidate {
  clientId: string;
  score: number;
  reasons: string[];
}

export interface Identification {
  status: 'identified' | 'ambiguous' | 'unknown';
  clientId?: string;
  via?: 'upload_link' | 'folder' | 'phone' | 'email' | 'codebtor_phone';
  candidates: Candidate[];
}

const matchesAmount = (c: ClientRef, amount?: number) =>
  amount !== undefined && c.loans.some((l) => l.pendingAmounts.includes(amount));

function rank(clients: ClientRef[], ev: SenderEvidence): Candidate[] {
  return clients
    .map((c) => {
      const reasons: string[] = [];
      let score = 0;
      if (ev.payerName) {
        const s = Math.max(nameSimilarity(ev.payerName, c.fullName), c.coDebtorName ? nameSimilarity(ev.payerName, c.coDebtorName) : 0);
        if (s >= 0.6) {
          score += s;
          reasons.push(`name:${s}`);
        }
      }
      if (matchesAmount(c, ev.amount)) {
        score += 0.5;
        reasons.push('amount');
      }
      return { clientId: c.id, score: Math.round(score * 1000) / 1000, reasons };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
}

export function identifySender(ev: SenderEvidence, clients: ClientRef[]): Identification {
  const active = clients.filter((c) => c.active);
  if (ev.uploadLinkClientId) return { status: 'identified', clientId: ev.uploadLinkClientId, via: 'upload_link', candidates: [] };
  if (ev.folderClientId) return { status: 'identified', clientId: ev.folderClientId, via: 'folder', candidates: [] };

  const pools: [Identification['via'], ClientRef[]][] = [];
  if (ev.phone) {
    pools.push(['phone', active.filter((c) => c.phones.includes(ev.phone!))]);
    pools.push(['codebtor_phone', active.filter((c) => (c.coDebtorPhones ?? []).includes(ev.phone!))]);
  }
  if (ev.email) {
    const e = ev.email.trim().toLowerCase();
    pools.push(['email', active.filter((c) => c.emails.some((x) => x.toLowerCase() === e))]);
  }
  for (const [via, pool] of pools) {
    if (pool.length === 1) return { status: 'identified', clientId: pool[0]!.id, via, candidates: [] };
    if (pool.length > 1) {
      const ranked = rank(pool, ev);
      const [top, second] = ranked;
      if (top && top.score >= 0.85 && (!second || top.score - second.score >= 0.25)) {
        return { status: 'identified', clientId: top.clientId, via, candidates: ranked };
      }
      const all = ranked.length ? ranked : pool.map((c) => ({ clientId: c.id, score: 0, reasons: ['same_number'] }));
      return { status: 'ambiguous', via, candidates: all };
    }
  }
  return { status: 'unknown', candidates: rank(active, ev).slice(0, 5) };
}

/** Elige el préstamo al que se aplica el pago (§12.7, regla 4). */
export function pickLoan(client: ClientRef, amount: number): { loanId?: string; rule: 'single' | 'amount_match' | 'oldest_overdue' | 'ambiguous' } {
  const open = client.loans.filter((l) => l.pendingAmounts.length > 0);
  if (open.length === 1) return { loanId: open[0]!.id, rule: 'single' };
  const byNext = open.filter((l) => l.pendingAmounts[0] === amount);
  if (byNext.length === 1) return { loanId: byNext[0]!.id, rule: 'amount_match' };
  const byAny = open.filter((l) => l.pendingAmounts.includes(amount));
  if (byAny.length === 1) return { loanId: byAny[0]!.id, rule: 'amount_match' };
  const overdue = open.filter((l) => l.oldestOverdueDate).sort((a, b) => a.oldestOverdueDate!.localeCompare(b.oldestOverdueDate!));
  if (overdue.length && (overdue.length === 1 || overdue[0]!.oldestOverdueDate !== overdue[1]!.oldestOverdueDate)) {
    return { loanId: overdue[0]!.id, rule: 'oldest_overdue' };
  }
  return { rule: 'ambiguous' };
}

/* ─────────────────── Anti-duplicado (§13.4) ─────────────────── */

export interface LogicalKeyInput {
  reference?: string;
  amount: number;
  date: IsoDate;
  time?: string;
  entity?: string;
  payerName?: string;
}

/**
 * Huella lógica del comprobante. Con referencia: referencia + valor + fecha + entidad.
 * Sin referencia: valor + fecha + hora + entidad + pagador (evita confundir dos pagos iguales del mismo día).
 */
export function logicalFingerprint(x: LogicalKeyInput): string {
  const norm = (s?: string) => stripAccents(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (x.reference && norm(x.reference).length >= 4) {
    return ['ref', norm(x.reference), x.amount, x.date, norm(x.entity)].join('|');
  }
  return ['noref', x.amount, x.date, x.time ?? '', norm(x.entity), norm(x.payerName)].join('|');
}

export function isDuplicate(fileHash: string, logicalKey: string | null, seenFileHashes: Set<string>, seenLogicalKeys: Set<string>): 'file' | 'logical' | false {
  if (seenFileHashes.has(fileHash)) return 'file';
  if (logicalKey && seenLogicalKeys.has(logicalKey)) return 'logical';
  return false;
}

/* ─────────────────── Validación de lo extraído (§13.4 y §13.5) ─────────────────── */

export interface ExtractedField<T> {
  value: T | null;
  confidence: number;
}

export interface Extraction {
  receiverName: ExtractedField<string>;
  payerName: ExtractedField<string>;
  amount: ExtractedField<number>; // unidades mínimas
  currency: ExtractedField<Currency>;
  date: ExtractedField<IsoDate>;
  time?: ExtractedField<string>;
  entity?: ExtractedField<string>;
  reference?: ExtractedField<string>;
  destinationLast4?: ExtractedField<string>;
  documentType: ExtractedField<'transfer_receipt' | 'deposit_slip' | 'screenshot' | 'other'>;
  tamperSignals?: string[];
}

export interface ReceivingAccount {
  holderName: string;
  entity?: string;
  last4?: string;
}

export type FlagCode =
  | 'MISSING_FIELD'
  | 'LOW_CONFIDENCE'
  | 'RECEIVER_MISMATCH'
  | 'PAYER_MISMATCH'
  | 'PAYER_INFERRED'
  | 'FUTURE_DATE'
  | 'BEFORE_DISBURSEMENT'
  | 'TOO_OLD'
  | 'NON_POSITIVE_AMOUNT'
  | 'CURRENCY_MISMATCH'
  | 'TAMPER_SIGNAL'
  | 'NOT_A_RECEIPT';

export interface Flag {
  code: FlagCode;
  field?: string;
  detail?: string;
  /** blocking = impide la aplicación automática; warning = se registra pero no la impide. */
  severity: 'blocking' | 'warning';
}

export interface ValidationContext {
  receivingAccounts: ReceivingAccount[];
  clientName: string;
  coDebtorName?: string;
  loanCurrency: Currency;
  disbursementDate: IsoDate;
  today: IsoDate;
  maxAgeDays?: number; // por defecto 30
  confidenceThreshold?: number; // por defecto 0.95
  receiverThreshold?: number; // por defecto 0.85
  /**
   * El remitente se identificó por un canal verificable (número de WhatsApp registrado, enlace personal o carpeta del cliente).
   * Si el comprobante no trae el nombre del pagador (p. ej. billeteras que no lo imprimen), se infiere el cliente
   * y queda una alerta no bloqueante (ADR-011).
   */
  senderVerified?: boolean;
}

export interface ValidationResult {
  flags: Flag[];
  receiverMatch?: { account: ReceivingAccount; score: number };
  autoEligible: boolean;
}

export function validateExtraction(x: Extraction, ctx: ValidationContext): ValidationResult {
  const flags: Flag[] = [];
  const th = ctx.confidenceThreshold ?? 0.95;
  const required: [string, ExtractedField<unknown>][] = [
    ['receiverName', x.receiverName],
    ['payerName', x.payerName],
    ['amount', x.amount],
    ['date', x.date],
  ];
  for (const [name, f] of required) {
    if ((f.value === null || f.value === '') && name === 'payerName' && ctx.senderVerified) {
      flags.push({ code: 'PAYER_INFERRED', field: name, severity: 'warning' });
      continue;
    }
    if (f.value === null || f.value === '') flags.push({ code: 'MISSING_FIELD', field: name, severity: 'blocking' });
    else if (f.confidence < th) flags.push({ code: 'LOW_CONFIDENCE', field: name, detail: String(f.confidence), severity: 'blocking' });
  }
  if (x.documentType.value === 'other') flags.push({ code: 'NOT_A_RECEIPT', severity: 'blocking' });

  let receiverMatch: ValidationResult['receiverMatch'];
  if (x.receiverName.value) {
    for (const acc of ctx.receivingAccounts) {
      let score = nameSimilarity(x.receiverName.value, acc.holderName);
      if (acc.last4 && x.destinationLast4?.value && acc.last4 === x.destinationLast4.value) score = Math.min(1, score + 0.05);
      if (!receiverMatch || score > receiverMatch.score) receiverMatch = { account: acc, score };
    }
    if (!receiverMatch || receiverMatch.score < (ctx.receiverThreshold ?? 0.85)) {
      flags.push({ code: 'RECEIVER_MISMATCH', detail: receiverMatch ? String(receiverMatch.score) : 'no_accounts', severity: 'blocking' });
    }
  }
  if (x.payerName.value) {
    const s = Math.max(nameSimilarity(x.payerName.value, ctx.clientName), ctx.coDebtorName ? nameSimilarity(x.payerName.value, ctx.coDebtorName) : 0);
    if (s < 0.85) flags.push({ code: 'PAYER_MISMATCH', detail: String(s), severity: 'warning' });
  }
  if (x.date.value) {
    if (x.date.value > ctx.today) flags.push({ code: 'FUTURE_DATE', severity: 'blocking' });
    if (x.date.value < ctx.disbursementDate) flags.push({ code: 'BEFORE_DISBURSEMENT', severity: 'blocking' });
    if (daysBetween(x.date.value, ctx.today) > (ctx.maxAgeDays ?? 30)) flags.push({ code: 'TOO_OLD', severity: 'blocking' });
  }
  if (x.amount.value !== null && x.amount.value <= 0) flags.push({ code: 'NON_POSITIVE_AMOUNT', severity: 'blocking' });
  if (x.currency.value && x.currency.value !== ctx.loanCurrency) flags.push({ code: 'CURRENCY_MISMATCH', severity: 'blocking' });
  for (const s of x.tamperSignals ?? []) flags.push({ code: 'TAMPER_SIGNAL', detail: s, severity: 'blocking' });

  return { flags, receiverMatch, autoEligible: !flags.some((f) => f.severity === 'blocking') };
}

/** Decisión final (§13.5): solo se aplica solo si el remitente es inequívoco y no hay alertas bloqueantes. */
export function decideAutoApply(identification: Identification, loanPick: ReturnType<typeof pickLoan>, validation: ValidationResult, duplicate: 'file' | 'logical' | false, mode: 'auto_with_audit' | 'prior_approval'): 'apply' | 'review' | 'duplicate' {
  if (duplicate) return 'duplicate';
  if (mode === 'prior_approval') return 'review';
  if (identification.status !== 'identified' || !loanPick.loanId) return 'review';
  return validation.autoEligible ? 'apply' : 'review';
}
