import type { Currency } from '@coroc/core';
import { t, type Lang } from '../common/i18n.js';
import { esc, logo, money, shortDate } from '../pdf/templates.js';
import { MAX_UPLOAD_BYTES } from '../documents/documents.service.js';
import type { UploadLinksService } from './upload-links.service.js';

type PortalData = Awaited<ReturnType<UploadLinksService['portal']>>;

const MB = MAX_UPLOAD_BYTES / 1024 / 1024;

/** Colores y tipografía de marca (§5.2), sin recursos externos: la página funciona en cualquier navegador y sin JavaScript. */
const CSS = `:root{--ink:#130E42;--gold:#CAA555;--ivory:#FFFDE7;--muted:#5B5878;--line:#E8E4D8;--ok:#2E7D5B;--bad:#B3261E}
*{box-sizing:border-box}body{margin:0;background:var(--ivory);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:560px;margin:0 auto;padding:16px}header{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:8px 0 16px}
header img{height:32px}nav a{color:var(--muted);text-decoration:none;font-size:13px;margin-left:10px}nav a[aria-current]{color:var(--ink);font-weight:700}
.card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:20px;margin-bottom:16px;border-top:4px solid var(--gold)}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:0 0 12px}.muted{color:var(--muted);font-size:14px;margin:0}
.big{font-size:28px;font-weight:700;font-variant-numeric:tabular-nums}.row{display:flex;gap:16px;flex-wrap:wrap;margin-top:12px}.row>div{flex:1 1 140px}
table{width:100%;border-collapse:collapse;font-size:14px;font-variant-numeric:tabular-nums}th,td{text-align:left;padding:8px 4px;border-bottom:1px solid var(--line)}
td.n{text-align:right}th.n{text-align:right}.s-paid{color:var(--ok)}.s-overdue{color:var(--bad);font-weight:600}.s-partial{color:#8A6D1F}
label{display:block;font-weight:600;margin:12px 0 6px}input[type=file],textarea{width:100%;font:inherit;padding:10px;border:1px solid var(--line);border-radius:10px;background:#fff}
textarea{min-height:64px}button{margin-top:16px;width:100%;padding:14px;border:0;border-radius:12px;background:var(--gold);color:var(--ink);font:inherit;font-weight:700;cursor:pointer}
.alert{padding:12px 14px;border-radius:12px;margin-bottom:16px;background:#FDECEA;color:var(--bad)}.ok{background:#E8F3EE;color:var(--ok)}
footer{font-size:12px;color:var(--muted);text-align:center;padding:8px 0 24px}a.btn{display:inline-block;margin-top:12px;color:var(--ink);font-weight:600}`;

export const PORTAL_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

const LANG_LINKS: [Lang, string][] = [['es', 'ES'], ['pt-BR', 'PT'], ['en', 'EN']];

function page(lang: Lang, title: string, body: string, self?: string): string {
  const nav = self ? `<nav>${LANG_LINKS.map(([l, label]) => `<a href="${esc(self)}?lang=${l}"${l === lang ? ' aria-current="true"' : ''}>${label}</a>`).join('')}</nav>` : '';
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>COROC · ${esc(title)}</title><style>${CSS}</style></head>
<body><main><header><img src="${logo()}" alt="COROC">${nav}</header>${body}<footer>${esc(t(lang, 'portal.privacy'))}<br>${esc(t(lang, 'doc.common.generatedBy'))}</footer></main></body></html>`;
}

/** Portal del deudor (§12.3): su plan de pagos, el saldo y el formulario para subir el comprobante. */
export function portalHtml(d: PortalData, lang: Lang, self: string, notice?: { kind: 'sent' | 'duplicate' | 'error' | 'optedOut'; message?: string }): string {
  const cur = d.currency as Currency;
  const m = (x: number) => esc(money(x, cur, lang));
  const s = d.summary;
  const alert = notice
    ? notice.kind === 'error'
      ? `<div class="alert" role="alert">${esc(notice.message ?? '')}</div>`
      : notice.kind === 'optedOut'
        ? `<div class="alert ok" role="status"><strong>${esc(t(lang, 'portal.optedOutTitle'))}</strong><br>${esc(t(lang, 'portal.optedOutBody'))}</div>`
        : `<div class="alert ok" role="status"><strong>${esc(t(lang, 'portal.thanksTitle'))}</strong><br>${esc(t(lang, notice.kind === 'sent' ? 'portal.thanksBody' : 'portal.duplicateBody'))}</div>`
    : '';
  const head = `<section class="card"><h1>${esc(t(lang, 'portal.hello', { name: d.clientFirstName }))}</h1>
<p class="muted">${esc(t(lang, 'portal.contract', { contract: d.contract }))} · ${esc(t(lang, 'portal.company', { company: d.company.name }))}</p>
${d.closed ? `<p class="big" style="font-size:20px;margin-top:12px">${esc(t(lang, 'portal.closed'))}</p>` : `<div class="row"><div><p class="muted">${esc(t(lang, 'portal.balance'))}</p><p class="big">${m(s.balance)}</p></div>
${s.next ? `<div><p class="muted">${esc(t(lang, 'portal.next'))}</p><p style="font-weight:600;margin:6px 0 0">${esc(t(lang, 'portal.nextValue', { amount: money(s.next.outstanding, cur, lang), date: shortDate(s.next.dueDate, lang) }))}</p></div>` : ''}</div>
<p class="muted" style="margin-top:8px">${esc(t(lang, 'portal.progress', { paid: s.paidInstallments, total: s.totalInstallments }))}</p>`}</section>`;
  const upload = d.closed
    ? ''
    : `<section class="card"><h2>${esc(t(lang, 'portal.uploadTitle'))}</h2><p class="muted">${esc(t(lang, 'portal.uploadHelp'))}</p>
<form method="post" action="${esc(self)}?lang=${lang}" enctype="multipart/form-data">
<label for="file">${esc(t(lang, 'portal.file', { mb: MB }))}</label><input id="file" name="file" type="file" accept="image/*,application/pdf" required>
<label for="note">${esc(t(lang, 'portal.note'))}</label><textarea id="note" name="note" maxlength="500"></textarea>
<button type="submit">${esc(t(lang, 'portal.submit'))}</button></form></section>`;
  const rows = d.installments
    .map((i) => `<tr><td>${i.number}</td><td>${esc(shortDate(i.dueDate, lang))}</td><td class="n">${m(i.amount)}</td><td class="s-${i.status}">${esc(t(lang, `portal.${i.status}`))}</td></tr>`)
    .join('');
  const plan = `<section class="card"><h2>${esc(t(lang, 'portal.plan'))}</h2><table><thead><tr><th>${esc(t(lang, 'portal.number'))}</th><th>${esc(t(lang, 'portal.due'))}</th><th class="n">${esc(t(lang, 'portal.amount'))}</th><th>${esc(t(lang, 'portal.status'))}</th></tr></thead><tbody>${rows}</tbody></table></section>`;
  // Exclusión desde el portal (§20.1): deja de recibir mensajes por WhatsApp y correo, de inmediato.
  const optOut = `<section class="card" style="border-top-color:var(--line)"><h2>${esc(t(lang, 'portal.messagesTitle'))}</h2><p class="muted">${esc(t(lang, 'portal.messagesHelp'))}</p>
<form method="post" action="${esc(self)}/opt-out?lang=${lang}"><input type="hidden" name="channel" value="all"><button type="submit" style="background:#fff;border:1px solid var(--line)">${esc(t(lang, 'portal.optOutButton'))}</button></form></section>`;
  return page(lang, t(lang, 'portal.title'), alert + head + upload + plan + optOut, self);
}

export function portalErrorHtml(lang: Lang): string {
  return page(lang, t(lang, 'portal.invalidTitle'), `<section class="card"><h1>${esc(t(lang, 'portal.invalidTitle'))}</h1><p>${esc(t(lang, 'portal.invalidBody'))}</p></section>`);
}
