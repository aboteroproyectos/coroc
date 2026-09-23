import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatMoney, LOCALE_OF, RECEIPT_TEXT, type Currency, type ReceiptData } from '@coroc/core';
import QRCode from 'qrcode';
import { t, type Lang } from '../common/i18n.js';

/**
 * Plantillas HTML/CSS de los documentos (§4.2, §15, §16.4, §18). Todo el contenido se inserta escapado y las fuentes y
 * el logo van incrustados: Chromium no descarga nada al renderizar (ADR-033).
 */
const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets');
const b64 = (f: string) => fs.readFileSync(path.join(ASSETS, f)).toString('base64');
let cachedCss: string | null = null;
let cachedLogo: string | null = null;

export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function logo(): string {
  if (!cachedLogo) {
    const svg = fs.readFileSync(path.join(ASSETS, 'brand/coroc-logo-horizontal.svg'), 'utf8');
    cachedLogo = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  }
  return cachedLogo;
}

/** Paleta y tipografía de marca (§5.2, §5.3). */
function baseCss(): string {
  if (cachedCss) return cachedCss;
  const face = (family: string, weight: number, file: string) =>
    `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;src:url(data:font/ttf;base64,${b64(`fonts/${file}`)}) format('truetype');}`;
  cachedCss = `
${face('Inter', 400, 'Inter-Regular.ttf')}${face('Inter', 600, 'Inter-SemiBold.ttf')}
${face('Montserrat', 500, 'Montserrat-Medium.ttf')}${face('Montserrat', 600, 'Montserrat-SemiBold.ttf')}
:root{--navy:#130E42;--navy9:#0B0826;--gold8:#8A6A2B;--gold7:#A57E33;--gold5:#CAA555;--gold3:#E9C879;--ivory:#FFFDE7;--paper:#F6F6F6;
--muted:#5B5878;--line:#E8E4D8;--ok:#2E7D5B;--warn:#B7791F;--err:#B3261E;--info:#2B5CAB;
--gold:linear-gradient(135deg,#A57E33 0%,#CAA555 45%,#E9C879 70%,#A57E33 100%);}
*{box-sizing:border-box;margin:0;padding:0}
html,body{font-family:'Inter',sans-serif;font-weight:400;color:var(--navy);font-size:9.5pt;line-height:1.38;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.num{font-variant-numeric:tabular-nums;font-feature-settings:'tnum' 1}
.label{font-family:'Montserrat',sans-serif;font-weight:500;font-size:6.4pt;letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}
h1{font-family:'Montserrat',sans-serif;font-weight:600;font-size:17pt;line-height:1.15;letter-spacing:.005em}
h2{font-family:'Montserrat',sans-serif;font-weight:600;font-size:10.5pt;margin:16px 0 6px}
.muted{color:var(--muted)}
.rule{height:2.4mm;background:var(--gold)}
.head{display:flex;justify-content:space-between;align-items:flex-start;gap:12mm;padding-top:6mm}
.head img{height:11mm}
.company{text-align:right;font-size:7.4pt;color:var(--muted);line-height:1.45}
.title{margin:8mm 0 1.5mm}
.sub{color:var(--muted);font-size:8.6pt}
hr{border:0;border-top:1px solid var(--line);margin:4mm 0}
.grid{display:grid;gap:3.2mm 6mm}
.g3{grid-template-columns:repeat(3,1fr)}.g4{grid-template-columns:repeat(4,1fr)}
.kv .value{font-weight:600;font-size:10pt;margin-top:1mm}
table{width:100%;border-collapse:collapse;font-size:7.8pt}
thead{display:table-header-group}
th{background:var(--navy);color:var(--ivory);font-family:'Montserrat',sans-serif;font-weight:600;font-size:6.2pt;letter-spacing:.1em;text-transform:uppercase;text-align:left;padding:2mm 1.8mm}
td{padding:1.6mm 1.8mm;border-bottom:1px solid var(--line);vertical-align:top}
tr{break-inside:avoid}
tbody tr:nth-child(even) td{background:#FAF8F2}
.r{text-align:right}
.dot{display:inline-block;width:5px;height:5px;border-radius:50%;margin-right:4px;vertical-align:1px;background:var(--muted)}
.s-paid .dot{background:var(--ok)}.s-overdue .dot{background:var(--err)}.s-partial .dot{background:var(--warn)}.s-pending .dot{background:var(--info)}
.s-overdue{color:var(--err)}
.sign{display:flex;justify-content:space-between;margin-top:18mm;gap:20mm;break-inside:avoid}
.sign div{flex:1;border-top:1px solid var(--navy);padding-top:2mm;font-size:8pt;color:var(--muted)}
.clause{font-size:8.4pt;margin-top:5mm;text-align:justify}
.void{position:fixed;left:0;right:0;top:40%;text-align:center;transform:rotate(-28deg);font-family:'Montserrat',sans-serif;font-weight:600;
font-size:64pt;letter-spacing:.08em;color:rgba(179,38,30,.24);border:6px solid rgba(179,38,30,.24);padding:2mm 8mm;width:max-content;margin:0 auto}
`;
  return cachedCss;
}

export interface Company {
  name: string;
  taxId?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
}

export const money = (minor: number, currency: Currency, lang: Lang) => formatMoney(minor, currency, LOCALE_OF[lang]);
export const longDate = (d: string, lang: Lang) =>
  new Intl.DateTimeFormat(LOCALE_OF[lang], { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d.slice(0, 10)}T00:00:00Z`));
export const shortDate = (d: string | null | undefined, lang: Lang) =>
  d ? new Intl.DateTimeFormat(LOCALE_OF[lang], { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d.slice(0, 10)}T00:00:00Z`)) : '—';
export const dateTime = (stamp: string, lang: Lang) => {
  const [d, time] = stamp.split(/[ T]/);
  return `${longDate(d!, lang)} · ${(time ?? '').slice(0, 5)}`;
};
export const percent = (x: number, lang: Lang) =>
  new Intl.NumberFormat(LOCALE_OF[lang], { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);

function companyLines(c: Company, lang: Lang): string {
  return [c.name, c.taxId ? `${t(lang, 'doc.common.taxId')} ${c.taxId}` : '', [c.phone, c.email].filter(Boolean).join(' · '), [c.address, c.city].filter(Boolean).join(', ')]
    .filter(Boolean)
    .map((l, i) => (i === 0 ? `<strong style="color:var(--navy);font-weight:600">${esc(l)}</strong>` : esc(l)))
    .join('<br>');
}

function page(lang: Lang, body: string, extraCss = ''): string {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>${baseCss()}${extraCss}</style></head><body>${body}</body></html>`;
}

/** Encabezado de todos los PDF: filete dorado, logo y datos de la empresa (§5.1). */
function docHead(company: Company, lang: Lang, title: string, subtitle: string): string {
  return `<div class="head"><img src="${logo()}" alt="COROC"><div class="company">${companyLines(company, lang)}</div></div>
<div class="title"><h1>${esc(title)}</h1><div class="sub">${esc(subtitle)}</div></div><hr>`;
}

/** Pie de página (número de página y leyenda), para `page.pdf({ footerTemplate })`. */
export function footerTemplate(lang: Lang, stamp: string): string {
  const pageText = esc(t(lang, 'doc.common.page', { a: '§A§', b: '§B§' })).replace('§A§', '<span class="pageNumber"></span>').replace('§B§', '<span class="totalPages"></span>');
  return `<div style="width:100%;font-family:sans-serif;font-size:6.5pt;color:#5B5878;padding:0 14mm;display:flex;justify-content:space-between;-webkit-print-color-adjust:exact">
<span>${esc(t(lang, 'doc.common.generatedBy'))} · ${esc(dateTime(stamp, lang))}</span><span>${pageText}</span></div>`;
}

const kv = (label: string, value: string) => `<div class="kv"><div class="label">${esc(label)}</div><div class="value num">${esc(value)}</div></div>`;

// ─────────────────────────── Recibo «Gracias por tu pago» (§15), A5 ───────────────────────────
export async function receiptHtml(d: ReceiptData & { voided?: boolean; lastPaymentLine?: string }, company: Company): Promise<string> {
  const lang = d.lang;
  const R = RECEIPT_TEXT[lang]!;
  const m = (v: number) => money(v, d.currency, lang);
  const qr = d.verificationUrl
    ? await QRCode.toString(d.verificationUrl, { type: 'svg', errorCorrectionLevel: 'M', margin: 0, color: { dark: '#130E42', light: '#0000' } })
    : '';
  const rows: [string, string][] = [
    [R.installmentsAgreed!, String(d.totalInstallments)],
    [R.installmentPaid!, d.coverage || '—'],
    [R.installmentsRemaining!, String(d.remainingInstallments)],
    [R.accumulated!, m(d.accumulatedPaid)],
    [R.previousBalance!, m(d.previousBalance)],
    [R.newBalance!, m(d.newBalance)],
  ];
  if (d.next) rows.push([R.nextInstallment!, `${longDate(d.next.dueDate, lang)} · ${m(d.next.amount)}`]);
  const meta = [d.payment.method, d.payment.reference].filter(Boolean).join(' · ');
  const css = `@page{size:A5;margin:0}body{background:var(--ivory)}.sheet{padding:0 11mm 10mm;min-height:210mm;position:relative}
.head img{height:9.5mm}.hero{display:grid;grid-template-columns:1fr 1fr;background:#fff;border:1px solid var(--line);border-radius:4mm;margin:5mm 0 4mm}
.hero>div{padding:4mm 5mm}.hero>div+div{border-left:1px solid var(--line)}.big{font-size:18pt;font-weight:600;margin-top:1.5mm;line-height:1.1}
.paid{color:var(--gold8)}.okline{color:var(--ok);font-size:7pt;margin-top:1mm}
.lines div{display:flex;justify-content:space-between;gap:6mm;padding:1.7mm 0;border-bottom:1px solid var(--line);font-size:8.3pt}
.lines span:first-child{color:var(--muted)}.lines span:last-child{font-weight:600;text-align:right}
.verify{display:flex;gap:4mm;align-items:center;margin-top:5mm;font-size:6.8pt;color:var(--muted)}.verify svg{width:21mm;height:21mm;flex:none}
.foot{position:absolute;left:11mm;right:11mm;bottom:6mm;text-align:center;font-size:6.6pt;color:var(--muted)}`;
  const body = `<div class="rule"></div><div class="sheet">
<div class="head"><img src="${logo()}" alt="COROC"><div class="company">${companyLines(company, lang)}</div></div>
<div class="title"><h1>${esc(R.title)}</h1><div class="sub">${esc(R.thanks)}</div></div><hr>
<div class="grid" style="grid-template-columns:1fr 1.3fr">${kv(R.receiptNo!, d.number)}${kv(R.issuedAt!, dateTime(d.issuedAt, lang))}
${kv(R.client!, d.client.fullName)}${kv(R.contract!, d.contract)}${kv(R.paymentDate!, longDate(d.payment.date, lang))}${meta ? kv(`${R.method} · ${R.reference}`, meta) : ''}</div>
<div class="hero"><div><div class="label">${esc(R.amountPaid)}</div><div class="big num paid">${esc(m(d.payment.amount))}</div></div>
<div><div class="label">${esc(R.newBalance)}</div><div class="big num">${esc(m(d.newBalance))}</div>${d.newBalance === 0 ? `<div class="okline">${esc(R.paidOff)}</div>` : ''}</div></div>
<div class="lines num">${rows.map(([k, v]) => `<div><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}</div>
${qr ? `<div class="verify">${qr}<div>${esc(R.verify)}<br><span class="num">${esc(d.verificationCode)}</span></div></div>` : ''}
<div class="foot">${esc(R.generated)}</div>
${d.voided ? `<div class="void">${esc(R.void)}</div>` : ''}</div>`;
  return page(lang, body, css);
}

// ─────────────────────────── Contrato y plan de pagos (§8.3, §10), A4 ───────────────────────────
export interface PlanDoc {
  lang: Lang;
  company: Company;
  client: { fullName: string; code: string; idDoc?: string | null };
  contract: string;
  currency: Currency;
  method: 'simple' | 'french';
  rate: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  installmentsCount: number;
  principal: number;
  totalInterest: number;
  totalPayable: number;
  effectiveAnnualRate: number;
  disbursementDate: string;
  firstDueDate: string;
  lateFee: { type: 'percent_daily' | 'fixed_daily'; value: string; graceDays?: number } | null;
  paidTotal: number;
  balance: number;
  remaining: number;
  daysPastDue: number;
  version: number;
  stamp: string;
  rows: { number: number; dueDate: string; amount: number; principal: number; interest: number; paid: number; paidOn: string | null; status: string; balanceAfter: number }[];
}

export function planHtml(d: PlanDoc): string {
  const L = d.lang;
  const m = (v: number) => money(v, d.currency, L);
  const rate = percent(Number(d.rate), L);
  const late = !d.lateFee
    ? t(L, 'doc.plan.noLateFee')
    : d.lateFee.type === 'percent_daily'
      ? t(L, 'doc.plan.lateFeePercent', { value: percent(Number(d.lateFee.value), L), days: d.lateFee.graceDays ?? 0 })
      : t(L, 'doc.plan.lateFeeFixed', { value: m(Number(d.lateFee.value)), days: d.lateFee.graceDays ?? 0 });
  const cells: [string, string][] = [
    [t(L, 'doc.plan.principal'), m(d.principal)],
    [t(L, 'doc.plan.interest'), m(d.totalInterest)],
    [t(L, 'doc.plan.total'), m(d.totalPayable)],
    [t(L, 'doc.plan.installments'), t(L, 'doc.plan.installmentsValue', { n: d.installmentsCount, freq: t(L, `doc.freqPl.${d.frequency}`) })],
    [t(L, 'doc.plan.method'), t(L, d.method === 'simple' ? 'doc.plan.methodSimple' : 'doc.plan.methodFrench')],
    [t(L, 'doc.plan.rate'), d.method === 'simple' ? t(L, 'doc.plan.rateOnTotal', { rate }) : t(L, 'doc.plan.ratePerPeriod', { rate })],
    [t(L, 'doc.plan.ea'), percent(d.effectiveAnnualRate, L)],
    [t(L, 'doc.plan.disbursement'), longDate(d.disbursementDate, L)],
    [t(L, 'doc.plan.firstDue'), longDate(d.firstDueDate, L)],
    [t(L, 'doc.plan.paid'), m(d.paidTotal)],
    [t(L, 'doc.plan.balance'), m(d.balance)],
    [t(L, 'doc.plan.dpd'), String(d.daysPastDue)],
  ];
  const rows = d.rows
    .map(
      (r) => `<tr><td class="num">${r.number}</td><td class="num">${esc(shortDate(r.dueDate, L))}</td><td class="r num">${esc(m(r.amount))}</td><td class="r num">${esc(m(r.principal))}</td>
<td class="r num">${esc(m(r.interest))}</td><td class="r num">${esc(m(r.paid))}</td><td class="num">${esc(shortDate(r.paidOn, L))}</td>
<td class="s-${esc(r.status)}"><span class="dot"></span>${esc(t(L, `doc.status.${r.status}`))}</td><td class="r num">${esc(m(r.balanceAfter))}</td></tr>`,
    )
    .join('');
  const body = `<div class="rule"></div>${docHead(d.company, L, t(L, 'doc.plan.title'), `${t(L, 'doc.common.contract')} ${d.contract} · ${d.client.fullName} · ${d.client.code}`)}
<div class="grid g4">${cells.map(([k, v]) => kv(k, v)).join('')}</div>
<div class="clause muted" style="margin-top:3mm">${esc(t(L, 'doc.plan.lateFee'))}: ${esc(late)}</div>
<h2>${esc(t(L, 'doc.plan.schedule'))}</h2>
<table><thead><tr><th>${esc(t(L, 'doc.plan.colNumber'))}</th><th>${esc(t(L, 'doc.plan.colDue'))}</th><th class="r">${esc(t(L, 'doc.plan.colAmount'))}</th><th class="r">${esc(t(L, 'doc.plan.colPrincipal'))}</th>
<th class="r">${esc(t(L, 'doc.plan.colInterest'))}</th><th class="r">${esc(t(L, 'doc.plan.colPaid'))}</th><th>${esc(t(L, 'doc.plan.colPaidOn'))}</th><th>${esc(t(L, 'doc.plan.colStatus'))}</th><th class="r">${esc(t(L, 'doc.plan.colBalance'))}</th></tr></thead>
<tbody>${rows}</tbody></table>
<p class="clause">${esc(t(L, 'doc.plan.clause', { cliente: d.client.fullName, empresa: d.company.name, total: m(d.totalPayable), n: d.installmentsCount, freq: t(L, `doc.freqPl.${d.frequency}`) }))}</p>
<div class="sign"><div>${esc(t(L, 'doc.plan.debtor'))}<br><strong style="color:var(--navy)">${esc(d.client.fullName)}</strong>${d.client.idDoc ? ` · ${esc(d.client.idDoc)}` : ''}</div>
<div>${esc(t(L, 'doc.plan.creditor'))}<br><strong style="color:var(--navy)">${esc(d.company.name)}</strong>${d.company.taxId ? ` · ${esc(d.company.taxId)}` : ''}</div></div>
<p class="muted" style="font-size:7pt;margin-top:6mm">${esc(t(L, 'doc.plan.version', { n: d.version, fecha: dateTime(d.stamp, L) }))}</p>`;
  return page(L, body, '@page{size:A4;margin:12mm 14mm 16mm}.rule{margin:-12mm -14mm 0}');
}

// ─────────────────────────── Estado de cuenta (§16.4), A4 ───────────────────────────
export interface StatementDoc {
  lang: Lang;
  company: Company;
  client: { fullName: string; code: string };
  contract: string;
  currency: Currency;
  asOf: string;
  totalPayable: number;
  paidTotal: number;
  balance: number;
  remaining: number;
  totalInstallments: number;
  next: { dueDate: string; outstanding: number } | null;
  daysPastDue: number;
  lateFeesOutstanding: number;
  overdueAmount: number;
  surplus: number;
  payments: { date: string; receipt: string; method: string; reference: string; amount: number; reversed: boolean }[];
  pending: { number: number; dueDate: string; outstanding: number; status: string }[];
}

export function statementHtml(d: StatementDoc): string {
  const L = d.lang;
  const m = (v: number) => money(v, d.currency, L);
  const cells: [string, string][] = [
    [t(L, 'doc.statement.agreed'), m(d.totalPayable)],
    [t(L, 'doc.statement.paid'), m(d.paidTotal)],
    [t(L, 'doc.statement.balance'), m(d.balance)],
    [t(L, 'doc.statement.remaining'), `${d.remaining} / ${d.totalInstallments}`],
    [t(L, 'doc.statement.next'), d.next ? `${shortDate(d.next.dueDate, L)} · ${m(d.next.outstanding)}` : '—'],
    [t(L, 'doc.statement.dpd'), String(d.daysPastDue)],
    [t(L, 'doc.statement.overdue'), m(d.overdueAmount)],
    [t(L, 'doc.statement.lateFees'), m(d.lateFeesOutstanding)],
    [t(L, 'doc.statement.surplus'), m(d.surplus)],
  ];
  const pay = d.payments.length
    ? `<table><thead><tr><th>${esc(t(L, 'doc.statement.colDate'))}</th><th>${esc(t(L, 'doc.statement.colReceipt'))}</th><th>${esc(t(L, 'doc.statement.colMethod'))}</th>
<th>${esc(t(L, 'doc.statement.colReference'))}</th><th>${esc(t(L, 'doc.statement.colState'))}</th><th class="r">${esc(t(L, 'doc.statement.colAmount'))}</th></tr></thead><tbody>
${d.payments.map((p) => `<tr><td class="num">${esc(shortDate(p.date, L))}</td><td class="num">${esc(p.receipt)}</td><td>${esc(p.method)}</td><td>${esc(p.reference)}</td>
<td class="${p.reversed ? 's-overdue' : 's-paid'}"><span class="dot"></span>${esc(t(L, p.reversed ? 'doc.statement.reversed' : 'doc.statement.applied'))}</td><td class="r num">${esc(m(p.amount))}</td></tr>`).join('')}</tbody></table>`
    : `<p class="muted">${esc(t(L, 'doc.statement.noPayments'))}</p>`;
  const pend = d.pending.length
    ? `<table><thead><tr><th>${esc(t(L, 'doc.plan.colNumber'))}</th><th>${esc(t(L, 'doc.plan.colDue'))}</th><th>${esc(t(L, 'doc.plan.colStatus'))}</th><th class="r">${esc(t(L, 'doc.statement.colAmount'))}</th></tr></thead><tbody>
${d.pending.map((p) => `<tr><td class="num">${p.number}</td><td class="num">${esc(shortDate(p.dueDate, L))}</td><td class="s-${esc(p.status)}"><span class="dot"></span>${esc(t(L, `doc.status.${p.status}`))}</td><td class="r num">${esc(m(p.outstanding))}</td></tr>`).join('')}</tbody></table>`
    : `<p class="muted">${esc(t(L, 'doc.statement.allPaid'))}</p>`;
  const body = `<div class="rule"></div>${docHead(d.company, L, t(L, 'doc.statement.title'), `${t(L, 'doc.common.contract')} ${d.contract} · ${d.client.fullName} · ${t(L, 'doc.common.cutoff')} ${longDate(d.asOf, L)}`)}
<div class="grid g3">${cells.map(([k, v]) => kv(k, v)).join('')}</div>
<h2>${esc(t(L, 'doc.statement.payments'))}</h2>${pay}<h2>${esc(t(L, 'doc.statement.pendingInstallments'))}</h2>${pend}`;
  return page(L, body, '@page{size:A4;margin:12mm 14mm 16mm}.rule{margin:-12mm -14mm 0}');
}

// ─────────────────────────── Paz y salvo (§15), A4 ───────────────────────────
export interface PayoffDoc {
  lang: Lang;
  company: Company;
  client: { fullName: string; idDocType?: string | null; idDocNumber?: string | null };
  contract: string;
  currency: Currency;
  totalPaid: number;
  lastPaymentDate: string | null;
  issueDate: string;
  /** Un reverso reabrió el préstamo: el paz y salvo queda sellado ANULADO (nunca se borra). */
  voided?: boolean;
}

export function payoffHtml(d: PayoffDoc): string {
  const L = d.lang;
  const id = d.client.idDocNumber ? t(L, 'doc.payoff.idPart', { tipo: d.client.idDocType ?? '', numero: d.client.idDocNumber }) : '';
  const body = `<div class="rule"></div>${docHead(d.company, L, t(L, 'doc.payoff.title'), `${t(L, 'doc.common.contract')} ${d.contract}`)}
<p style="font-size:11.5pt;line-height:1.7;margin-top:14mm;text-align:justify">${esc(t(L, 'doc.payoff.body', { empresa: d.company.name, cliente: d.client.fullName, id, contrato: d.contract, total: money(d.totalPaid, d.currency, L) }))}</p>
${d.lastPaymentDate ? `<p style="font-size:10pt;margin-top:6mm">${esc(t(L, 'doc.payoff.lastPayment', { fecha: longDate(d.lastPaymentDate, L) }))}</p>` : ''}
<p style="font-size:10pt;margin-top:6mm">${esc(t(L, 'doc.payoff.issued', { ciudad: d.company.city || '—', fecha: longDate(d.issueDate, L) }))}</p>
<div class="sign" style="margin-top:34mm;justify-content:flex-start"><div style="max-width:80mm">${esc(t(L, 'doc.payoff.signature'))}<br><strong style="color:var(--navy)">${esc(d.company.name)}</strong>${d.company.taxId ? `<br>${esc(t(L, 'doc.common.taxId'))} ${esc(d.company.taxId)}` : ''}</div></div>
${d.voided ? `<div class="void">${esc(RECEIPT_TEXT[L]!.void)}</div>` : ''}`;
  return page(L, body, '@page{size:A4;margin:12mm 18mm 16mm}.rule{margin:-12mm -18mm 0}');
}

// ─────────────────────────── Informes (§18), A4 horizontal ───────────────────────────
export interface ReportColumn {
  header: string;
  align?: 'right';
  width?: number;
}

export function reportHtml(d: { lang: Lang; company: Company; title: string; subtitle: string; filters: string[]; columns: ReportColumn[]; rows: string[][]; totals?: string[] | null }): string {
  const L = d.lang;
  const cols = d.columns;
  const head = cols.map((c) => `<th class="${c.align === 'right' ? 'r' : ''}"${c.width ? ` style="width:${c.width}%"` : ''}>${esc(c.header)}</th>`).join('');
  const rows = d.rows.map((r) => `<tr>${r.map((v, i) => `<td class="${cols[i]?.align === 'right' ? 'r num' : 'num'}">${esc(v)}</td>`).join('')}</tr>`).join('');
  const totals = d.totals ? `<tfoot><tr>${d.totals.map((v, i) => `<td class="${cols[i]?.align === 'right' ? 'r num' : ''}" style="font-weight:600;border-top:1.5px solid var(--navy)">${esc(v)}</td>`).join('')}</tr></tfoot>` : '';
  const body = `<div class="rule"></div>${docHead(d.company, L, d.title, d.subtitle)}
${d.filters.length ? `<p class="muted" style="font-size:7.6pt;margin:-1mm 0 3mm"><span class="label">${esc(t(L, 'doc.common.filters'))}</span> ${esc(d.filters.join(' · '))}</p>` : ''}
${d.rows.length ? `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody>${totals}</table>` : `<p class="muted">${esc(t(L, 'doc.report.empty'))}</p>`}`;
  return page(L, body, '@page{size:A4 landscape;margin:12mm 12mm 15mm}.rule{margin:-12mm -12mm 0}');
}
