import { CURRENCIES, fromMinor, type Currency } from './money.js';
import { sanitizeFolderName } from './ledger.js';
import type { Lang } from './receipt.js';

/**
 * Carpeta COROC (§16.3): una sola definición de la estructura y de los nombres de archivo, que usan el servidor
 * (repositorio y manifiesto de la carpeta) y, a través de la API, las apps. Los nombres siguen el idioma de la empresa
 * y van sin tildes (ADR-013).
 */
export type DocKind = 'plan' | 'schedule' | 'receipt_in' | 'receipt_out' | 'statement' | 'payoff' | 'other' | 'report';

export const SUBFOLDERS: Record<Lang, readonly [string, string, string, string, string]> = {
  es: ['01 Contrato y plan de pagos', '02 Comprobantes recibidos', '03 Recibos emitidos', '04 Estados de cuenta', '05 Otros documentos'],
  'pt-BR': ['01 Contrato e plano de pagamento', '02 Comprovantes recebidos', '03 Recibos emitidos', '04 Extratos', '05 Outros documentos'],
  en: ['01 Contract and payment plan', '02 Received receipts', '03 Issued receipts', '04 Statements', '05 Other documents'],
};

export const ROOTFOLDERS: Record<Lang, { unassigned: string; inbox: string; reports: string; backups: string }> = {
  es: { unassigned: '_Sin asignar', inbox: '_Entrada', reports: '_Informes', backups: '_Respaldos' },
  'pt-BR': { unassigned: '_Sem atribuicao', inbox: '_Entrada', reports: '_Relatorios', backups: '_Backups' },
  en: { unassigned: '_Unassigned', inbox: '_Inbox', reports: '_Reports', backups: '_Backups' },
};

/** Subcarpeta (0–4) de cada tipo de documento dentro de la carpeta del contrato. */
export const KIND_SUBFOLDER: Record<Exclude<DocKind, 'report'>, number> = { plan: 0, schedule: 0, receipt_in: 1, receipt_out: 2, statement: 3, payoff: 3, other: 4 };

/** Palabra TIPO del nombre de archivo, en el idioma de la empresa. */
export const FILE_TYPE: Record<Lang, Record<DocKind | 'void', string>> = {
  es: { plan: 'CONTRATO', schedule: 'PLAN_DE_PAGOS', receipt_in: 'COMPROBANTE', receipt_out: 'RECIBO', statement: 'ESTADO_DE_CUENTA', payoff: 'PAZ_Y_SALVO', other: 'DOCUMENTO', report: 'INFORME', void: 'ANULADO' },
  'pt-BR': { plan: 'CONTRATO', schedule: 'PLANO_DE_PAGAMENTO', receipt_in: 'COMPROVANTE', receipt_out: 'RECIBO', statement: 'EXTRATO', payoff: 'TERMO_DE_QUITACAO', other: 'DOCUMENTO', report: 'RELATORIO', void: 'CANCELADO' },
  en: { plan: 'CONTRACT', schedule: 'PAYMENT_PLAN', receipt_in: 'PROOF_OF_PAYMENT', receipt_out: 'RECEIPT', statement: 'STATEMENT', payoff: 'PAYOFF_LETTER', other: 'DOCUMENT', report: 'REPORT', void: 'VOID' },
};

/** Archivo oculto de cada carpeta de cliente con su identificador: si el cliente cambia de nombre, la carpeta se renombra sin perder el vínculo. */
export const CLIENT_MARKER = '.coroc-id';

export interface DocPlacement {
  kind: DocKind;
  clientFolder?: string | null;
  contract?: string | null;
}

/** Carpetas (relativas a COROC/) donde va un documento. */
export function documentFolder(lang: Lang, d: DocPlacement): string[] {
  const R = ROOTFOLDERS[lang];
  if (d.kind === 'report') return [R.reports];
  if (!d.clientFolder) return [R.unassigned];
  const parts = [sanitizeFolderName(d.clientFolder)];
  if (d.contract) parts.push(sanitizeFolderName(d.contract));
  parts.push(SUBFOLDERS[lang][KIND_SUBFOLDER[d.kind]]!);
  return parts;
}

/** Las cinco subcarpetas de un contrato (§16.3), que existen aunque todavía estén vacías. */
export function contractFolders(lang: Lang, clientFolder: string, contract: string): string[][] {
  return SUBFOLDERS[lang].map((s) => [sanitizeFolderName(clientFolder), sanitizeFolderName(contract), s]);
}

/** Carpetas de primer nivel de COROC/. */
export function rootFolders(lang: Lang): string[] {
  return Object.values(ROOTFOLDERS[lang]);
}

const token = (s: string) => sanitizeFolderName(s).replace(/\s+/g, '_').replace(/[^A-Za-z0-9._-]/g, '');

/**
 * `AAAA-MM-DD_HHMM_TIPO_CONTRATO_VALOR.ext` (§16.3), por ejemplo `2026-10-09_1432_COMPROBANTE_CT-000125_60000.jpg`
 * o `2026-10-09_1435_RECIBO_RC-000482_CT-000125.pdf`. `stamp` es la fecha y hora local «AAAA-MM-DD HH:mm».
 */
export function documentFileName(
  lang: Lang,
  a: { stamp: string; kind: DocKind; ext: string; number?: string | null; contract?: string | null; amount?: { minor: number; currency: Currency } | null; voided?: boolean; label?: string | null },
): string {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/.exec(a.stamp);
  if (!m) throw new RangeError(`Marca de tiempo no válida: ${a.stamp}`);
  const parts = [m[1]!, `${m[2]}${m[3]}`, FILE_TYPE[lang][a.kind]];
  if (a.label) parts.push(token(a.label));
  if (a.number) parts.push(token(a.number));
  if (a.contract) parts.push(token(a.contract));
  if (a.amount) parts.push(fromMinor(a.amount.minor, a.amount.currency).toFixed(CURRENCIES[a.amount.currency].minorDigits));
  if (a.voided) parts.push(FILE_TYPE[lang].void);
  const ext = a.ext.replace(/^\./, '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  return `${parts.filter(Boolean).join('_')}.${ext}`;
}

/** Ruta completa relativa a COROC/, con «/» como separador. */
export function documentPath(lang: Lang, d: DocPlacement, fileName: string): string {
  return [...documentFolder(lang, d), fileName].join('/');
}
