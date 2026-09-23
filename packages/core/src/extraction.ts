import { CURRENCIES, Decimal, type Currency } from './money.js';
import { addDays, type IsoDate } from './calendar.js';
import type { Extraction, ExtractedField } from './intake.js';

/**
 * Lector de comprobantes por reglas (es / pt-BR / en) sobre el texto de OCR o de la capa de texto del PDF.
 * En producción el extractor principal es un modelo de IA con salida JSON (§4.5); este lector:
 *  - es el motor del prototipo sin servidor, y
 *  - sirve de verificación cruzada del resultado de la IA (si discrepan en valor o fecha, va a revisión).
 */

const MONTHS: Record<string, number> = {
  // es
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, sept: 9, set: 9, oct: 10, nov: 11, dic: 12,
  // pt
  janeiro: 1, fevereiro: 2, 'março': 3, marco: 3, maio: 5, junho: 6, julho: 7, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
  jan: 1, fev: 2, out: 10, dez: 12,
  // en
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  apr: 4, aug: 8, dec: 12,
};

const ENTITIES: [RegExp, string, Currency][] = [
  [/\bnequi\b/i, 'Nequi', 'COP'],
  [/daviplata/i, 'Daviplata', 'COP'],
  [/bancolombia/i, 'Bancolombia', 'COP'],
  [/\bbre[\s-]?b\b/i, 'Bre-B', 'COP'],
  [/davivienda/i, 'Davivienda', 'COP'],
  [/banco de bogot[aá]/i, 'Banco de Bogotá', 'COP'],
  [/\bbbva\b/i, 'BBVA', 'COP'],
  [/\bpse\b/i, 'PSE', 'COP'],
  [/efecty/i, 'Efecty', 'COP'],
  [/\bpix\b/i, 'PIX', 'BRL'],
  [/nubank|\bnu pagamentos/i, 'Nubank', 'BRL'],
  [/ita[uú]/i, 'Itaú', 'BRL'],
  [/bradesco/i, 'Bradesco', 'BRL'],
  [/caixa/i, 'Caixa', 'BRL'],
  [/banco do brasil/i, 'Banco do Brasil', 'BRL'],
  [/zelle/i, 'Zelle', 'USD'],
  [/venmo/i, 'Venmo', 'USD'],
  [/cash\s?app/i, 'Cash App', 'USD'],
];

const L_AMOUNT = /(valor|monto|importe|total|cantidad|cu[aá]nto|you sent|amount|pagaste|enviaste|transferiste|valor da transfer[eê]ncia|valor pago|valor enviado|quantia)/i;
const L_NOT_AMOUNT = /(saldo|balance|disponible|dispon[ií]vel|comisi[oó]n|costo|tarifa|fee|cuota de manejo|impuesto|gmf|4x1000|iva)/i;
const L_DATE = /(fecha|data|date|hora|when|realizad[ao]|efetuad[ao])/i;
const RECEIVER_LABELS = [
  'nombre del destinatario', 'nombre del beneficiario', 'destinatario', 'beneficiario', 'a nombre de', 'le enviaste a', 'enviaste a',
  'enviado a', 'transferiste a', 'para', 'destino', 'cuenta destino', 'titular destino', 'recebedor', 'favorecido', 'quem recebeu',
  'destinatário', 'recipient', 'paid to', 'sent to', 'payee', 'to',
];
const PAYER_LABELS = [
  'nombre del pagador', 'nombre del remitente', 'quien envía', 'quien envia', 'enviado por', 'pagado por', 'ordenante', 'remitente',
  'pagador', 'titular origen', 'titular de origen', 'origen', 'desde', 'de', 'quem pagou', 'nome do pagador', 'remetente', 'origem',
  'paid by', 'sender', 'from',
];
const INLINE_NO_COLON = ['le enviaste a', 'enviaste a', 'enviado a', 'transferiste a', 'enviado por', 'pagado por', 'paid to', 'sent to', 'paid by'];
const L_REFERENCE = /(reference(?: number)?|referencia|\bref\b\.?|n[uú]mero de (?:aprobaci[oó]n|comprobante|transacci[oó]n|referencia|operaci[oó]n|giro|autorizaci[oó]n)|comprobante(?: no\.?| n[oº°]\.?)?|aprobaci[oó]n|c[oó]digo(?: de autentica[cç]?[aãá]o| de transacci[oó]n)?|id da transa[cç]?[aãá]o|autentica[cç]?[aãá]o|confirmation(?: code| number| #)?|transaction id|\bcus\b|\bpin\b)/i;

function field<T>(value: T | null, confidence: number): ExtractedField<T> {
  return { value, confidence: value === null ? 0 : confidence };
}

/** Convierte "1.234.567", "60,000.00", "R$ 1.234,56", "60.000" a unidades mínimas. */
export function parseAmount(raw: string, currency: Currency): number | null {
  let s = raw.replace(/[^\d.,]/g, '');
  if (!/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let intPart = s;
  let decPart = '';
  if (lastDot >= 0 && lastComma >= 0) {
    const sep = lastDot > lastComma ? '.' : ',';
    const i = s.lastIndexOf(sep);
    intPart = s.slice(0, i);
    decPart = s.slice(i + 1);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const parts = s.split(sep);
    const tail = parts[parts.length - 1]!;
    if (parts.length === 2 && tail.length <= 2) {
      intPart = parts[0]!;
      decPart = tail;
    } else if (parts.slice(1).every((p) => p.length === 3)) {
      intPart = parts.join('');
    } else return null;
  }
  intPart = intPart.replace(/[.,]/g, '');
  if (!intPart) intPart = '0';
  const value = new Decimal(`${intPart}.${decPart || '0'}`);
  const minor = value.mul(new Decimal(10).pow(CURRENCIES[currency].minorDigits)).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  return Number.isSafeInteger(minor) ? minor : null;
}

const AMOUNT_RE = /(R\$|US\$|USD|COP|BRL|\$)\s*(\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/g;
const BARE_AMOUNT_RE = /(?<![\d/:-])(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?)(?![\d/:])/g;

function detectCurrency(text: string, fallback: Currency, entityCurrency?: Currency): { value: Currency; confidence: number } {
  if (/R\$|\bBRL\b|\breais\b/i.test(text)) return { value: 'BRL', confidence: 0.97 };
  if (/US\$|\bUSD\b|\bdollars?\b/i.test(text)) return { value: 'USD', confidence: 0.97 };
  if (/\bCOP\b|\bpesos\b/i.test(text)) return { value: 'COP', confidence: 0.97 };
  if (entityCurrency) return { value: entityCurrency, confidence: 0.93 };
  return { value: fallback, confidence: 0.9 };
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function validDate(y: number, m: number, d: number): IsoDate | null {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

function monthNum(word: string): number | undefined {
  const w = word.toLowerCase().replace(/\.$/, '');
  if (w === 'agosto') return 8;
  return MONTHS[w] ?? MONTHS[w.normalize('NFD').replace(/[̀-ͯ]/g, '')];
}

/** Encuentra fechas en una línea. `monthFirst` para formatos numéricos ambiguos (EE. UU.). */
export function findDates(line: string, receivedOn: IsoDate, monthFirst: boolean): IsoDate[] {
  const out: IsoDate[] = [];
  const l = line.toLowerCase();
  for (const m of l.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) {
    const d = validDate(+m[1]!, +m[2]!, +m[3]!);
    if (d) out.push(d);
  }
  for (const m of l.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/g)) {
    const a = +m[1]!, b = +m[2]!, y = +m[3]!;
    let d: IsoDate | null;
    if (a > 12) d = validDate(y, b, a);
    else if (b > 12) d = validDate(y, a, b);
    else d = monthFirst ? validDate(y, a, b) : validDate(y, b, a);
    if (d) out.push(d);
  }
  const W = '([a-záéíóúç]{3,10})\\.?';
  for (const m of l.matchAll(new RegExp(`\\b(\\d{1,2})\\s*(?:de\\s+)?${W}\\s*(?:de\\s+|,\\s*)?(\\d{4})\\b`, 'g'))) {
    const mo = monthNum(m[2]!);
    if (mo) {
      const d = validDate(+m[3]!, mo, +m[1]!);
      if (d) out.push(d);
    }
  }
  for (const m of l.matchAll(new RegExp(`\\b${W}\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, 'g'))) {
    const mo = monthNum(m[1]!);
    if (mo) {
      const d = validDate(+m[3]!, mo, +m[2]!);
      if (d) out.push(d);
    }
  }
  if (/\b(hoy|hoje|today)\b/.test(l)) out.push(receivedOn);
  if (/\b(ayer|ontem|yesterday)\b/.test(l)) out.push(addDays(receivedOn, -1));
  return out;
}

function findTime(line: string): string | null {
  const m = /\b(\d{1,2}):(\d{2})(?::\d{2})?\s*(a\.?\s?m\.?|p\.?\s?m\.?|am|pm)?/i.exec(line);
  if (!m) return null;
  let h = +m[1]!;
  const mi = +m[2]!;
  const ap = (m[3] ?? '').toLowerCase().replace(/[.\s]/g, '');
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || mi > 59) return null;
  return `${pad(h)}:${pad(mi)}`;
}

function cleanName(v: string): string | null {
  let s = v
    .replace(/(cuenta|cta\.?|ahorros|corriente|conta|savings|checking)\b.*$/i, '')
    .replace(/[\d#]{3,}.*$/, '')
    .replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñÇçÃÕãõÂÊÔâêô*.\s'-]/g, ' ')
    .replace(/(^|\s)[*.]+(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.replace(/^[.\-\s]+|[.\-\s]+$/g, '');
  const letters = s.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñÇçÃÕãõÂÊÔâêô]/g, '');
  if (letters.length < 3) return null;
  return s;
}

function labelValue(lines: string[], labels: string[]): { value: string; confidence: number } | null {
  const sorted = [...labels].sort((a, b) => b.length - a.length);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const low = raw.toLowerCase().trim();
    for (const lab of sorted) {
      const colon = new RegExp(`^${lab.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:\\-–]\\s*(.+)$`, 'i').exec(raw.trim());
      if (colon) {
        const n = cleanName(colon[1]!);
        if (n) return { value: n, confidence: 0.96 };
      }
      if (INLINE_NO_COLON.includes(lab) && low.startsWith(lab + ' ')) {
        const n = cleanName(raw.trim().slice(lab.length));
        if (n) return { value: n, confidence: 0.96 };
      }
      // Formularios en tabla (consignaciones en papel): «Beneficiario   Inversiones Coroc SAS» en el mismo renglón y sin
      // dos puntos. Solo con rótulos largos e inequívocos, y con confianza bajo el umbral: nunca se aplica solo.
      if (lab.length >= 8 && low.startsWith(lab + ' ') && /^\s+[A-ZÁÉÍÓÚÑÇ]/.test(raw.trim().slice(lab.length))) {
        const n = cleanName(raw.trim().slice(lab.length));
        if (n) return { value: n, confidence: 0.93 };
      }
      if (low === lab || low === lab + ':') {
        for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
          const n = cleanName(lines[j]!);
          if (n) return { value: n, confidence: 0.96 };
        }
      }
    }
  }
  return null;
}

export interface ExtractOptions {
  receivedOn: IsoDate;
  defaultCurrency: Currency;
}

export function extractFromText(text: string, opts: ExtractOptions): Extraction {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const joined = lines.join('\n');

  const ent = ENTITIES.find(([re]) => re.test(joined));
  const currency = detectCurrency(joined, opts.defaultCurrency, ent?.[2]);

  // Valor
  type Cand = { minor: number; score: number };
  const cands: Cand[] = [];
  lines.forEach((line, i) => {
    if (L_NOT_AMOUNT.test(line)) return;
    const labeled = L_AMOUNT.test(line) || (i > 0 && L_AMOUNT.test(lines[i - 1]!) && !L_NOT_AMOUNT.test(lines[i - 1]!));
    const found: string[] = [];
    for (const m of line.matchAll(AMOUNT_RE)) found.push(m[2]!);
    const symbol = found.length > 0;
    if (!symbol && labeled) for (const m of line.matchAll(BARE_AMOUNT_RE)) found.push(m[1]!);
    for (const f of found) {
      const minor = parseAmount(f, currency.value);
      if (minor && minor > 0) cands.push({ minor, score: labeled ? 0.96 : symbol ? 0.8 : 0.6 });
    }
  });
  let amount: ExtractedField<number> = field<number>(null, 0);
  if (cands.length) {
    const best = [...cands].sort((a, b) => b.score - a.score)[0]!;
    const distinct = new Set(cands.map((c) => c.minor));
    const labeledDistinct = new Set(cands.filter((c) => c.score >= 0.96).map((c) => c.minor));
    let conf = best.score;
    if (best.score < 0.96 && distinct.size === 1) conf = 0.9;
    if (best.score >= 0.96 && labeledDistinct.size > 1) conf = 0.8;
    amount = field(best.minor, conf);
  }

  // Fecha y hora
  const monthFirst = currency.value === 'USD';
  let date: ExtractedField<IsoDate> = field<IsoDate>(null, 0);
  let time: ExtractedField<string> = field<string>(null, 0);
  const allDates: { d: IsoDate; labeled: boolean; line: string }[] = [];
  lines.forEach((line, i) => {
    const labeled = L_DATE.test(line) || (i > 0 && L_DATE.test(lines[i - 1]!));
    for (const d of findDates(line, opts.receivedOn, monthFirst)) allDates.push({ d, labeled, line });
  });
  if (allDates.length) {
    const labeled = allDates.filter((x) => x.labeled);
    const pick = (labeled[0] ?? allDates[0])!;
    const distinct = new Set(allDates.map((x) => x.d));
    // Una sola fecha explícita (con año) en todo el documento es tan confiable como una etiquetada;
    // las fechas relativas ("hoy") o varias fechas distintas bajan la confianza.
    const explicitYear = /\d{4}/.test(pick.line);
    date = field(pick.d, labeled.length ? (new Set(labeled.map((x) => x.d)).size === 1 ? 0.96 : 0.8) : distinct.size === 1 ? (explicitYear ? 0.96 : 0.9) : 0.7);
    const t = findTime(pick.line) ?? lines.map(findTime).find(Boolean) ?? null;
    time = field(t, t ? 0.9 : 0);
  }

  // Nombres
  const recv = labelValue(lines, RECEIVER_LABELS);
  const payer = labelValue(lines, PAYER_LABELS);

  // Referencia
  let reference: ExtractedField<string> = field<string>(null, 0);
  for (let i = 0; i < lines.length && !reference.value; i++) {
    const line = lines[i]!;
    if (!L_REFERENCE.test(line)) continue;
    const after = line.replace(L_REFERENCE, ' ').replace(/[:#.]/g, ' ');
    const refToken = (s: string) => [...s.matchAll(/\b([A-Z0-9][A-Z0-9-]{5,})\b/gi)].map((m) => m[1]!).find((t) => /\d/.test(t));
    const tok = refToken(after);
    // Línea que solo contiene la etiqueta ("Referencia") → el valor está en la línea siguiente.
    // (o con palabras del rótulo que la expresión no cubre, como «Número de giro» o «CUS / Referencia», pero sin cifras).
    const labelOnly = !/[a-záéíóúç]{2,}/i.test(after.replace(/\b(no|n[oº°])\b/gi, '')) || (!tok && !/\d/.test(after) && after.trim().split(/\s+/).length <= 3);
    const nextLine = lines[i + 1];
    const next = labelOnly && nextLine && !L_DATE.test(nextLine) && !L_AMOUNT.test(nextLine) ? refToken(nextLine) : undefined;
    const v = tok ?? next;
    if (v) reference = field(v.toUpperCase(), 0.93);
  }

  // Últimos 4 dígitos de destino
  let last4: ExtractedField<string> = field<string>(null, 0);
  const l4 = /(?:\*{1,}|•{2,}|x{2,}|terminad[ao] en|final(?:izada)? em|ending in)\s*(\d{4})\b/i.exec(joined);
  if (l4) last4 = field(l4[1]!, 0.9);

  const isDeposit = /consignaci[oó]n|dep[oó]sito|comprovante de dep[oó]sito|deposit slip/i.test(joined);
  const hasReceiptShape = amount.value !== null && (recv || payer || ent);
  const documentType: Extraction['documentType'] = hasReceiptShape
    ? field(isDeposit ? 'deposit_slip' : 'transfer_receipt', 0.95)
    : field('other' as const, 0.7);

  return {
    receiverName: field(recv?.value ?? null, recv?.confidence ?? 0),
    payerName: field(payer?.value ?? null, payer?.confidence ?? 0),
    amount,
    currency: field(currency.value, currency.confidence),
    date,
    time,
    entity: field(ent?.[1] ?? null, ent ? 0.95 : 0),
    reference,
    destinationLast4: last4,
    documentType,
    tamperSignals: [],
  };
}
