/* COROC · utilidades de interfaz (sin dependencias) */
'use strict';
const Core = window.CorocCore;
const C = (window.C = Object.assign(window.C || {}, { state: {}, views: {}, ui: {} }));

C.$ = (sel, root = document) => root.querySelector(sel);
C.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Escapa texto de usuario antes de insertarlo en plantillas HTML. */
C.esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

C.uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));

C.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

C.debounce = (fn, ms = 200) => {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};

C.bufToHex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
C.sha256 = async (blobOrText) => {
  const data = typeof blobOrText === 'string' ? new TextEncoder().encode(blobOrText) : await blobOrText.arrayBuffer();
  return C.bufToHex(await crypto.subtle.digest('SHA-256', data));
};

C.b64 = {
  enc: (u8) => {
    let s = '';
    const a = new Uint8Array(u8);
    for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
    return btoa(s);
  },
  dec: (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0)),
};

C.download = (blob, name) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
};

/* ─────────── Fechas en la zona horaria de la empresa ─────────── */
C.tz = () => (C.state.company && C.state.company.timezone) || 'America/Bogota';
C.nowParts = () => {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: C.tz(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const p = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
};
C.today = () => C.state.clockOverride?.date || C.nowParts().date;
C.nowLocal = () => {
  if (C.state.clockOverride) return `${C.state.clockOverride.date}T${C.state.clockOverride.time}`;
  const n = C.nowParts();
  return `${n.date}T${n.time}`;
};
C.fmtDate = (iso, opts = { day: 'numeric', month: 'short', year: 'numeric' }, lang) => {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Intl.DateTimeFormat(C.localeOf(lang), { ...opts, timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
};
C.fmtDateTime = (local, lang) => {
  if (!local) return '—';
  const [d, t] = local.split('T');
  return `${C.fmtDate(d, { day: 'numeric', month: 'short', year: 'numeric' }, lang)} · ${t ? t.slice(0, 5) : ''}`;
};
C.weekdayName = (iso, lang) => C.fmtDate(iso, { weekday: 'long' }, lang);

/* ─────────── Dinero ─────────── */
C.currency = () => (C.state.company && C.state.company.currency) || 'COP';
// En pantalla, cada moneda usa su formato nativo (COP «$ 1.200.000», BRL «R$ 1.200,00», USD «$1,200.00»);
// los documentos para el cliente pasan su idioma explícitamente.
C.money = (minor, currency, lang) => Core.formatMoney(Math.round(minor || 0), currency || C.currency(), lang ? C.localeOf(lang) : undefined);
C.moneyCompact = (minor, currency, lang) => {
  const cur = currency || C.currency();
  const major = Core.fromMinor(Math.round(minor || 0), cur).toNumber();
  return new Intl.NumberFormat(lang ? C.localeOf(lang) : Core.CURRENCIES[cur].defaultLocale, { style: 'currency', currency: cur, notation: 'compact', maximumFractionDigits: 1 }).format(major).replace(/ /g, ' ');
};
C.parseMoney = (text, currency) => {
  const cur = currency || C.currency();
  const s = String(text || '').trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Core.toMinor(s, cur);
  return Core.parseAmount(s, cur);
};
C.pct = (fraction, digits = 2, lang) =>
  new Intl.NumberFormat(C.localeOf(lang), { style: 'percent', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(fraction);

/* ─────────── Íconos (trazo fino 1.5 px) ─────────── */
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  today: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/><circle cx="12" cy="15" r="2.2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.8a3.3 3.3 0 0 1 0 6.4M18.5 14.8c1.6.8 2.6 2.5 3 5.2"/>',
  inbox: '<path d="M3 13.5 5.5 5h13L21 13.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 13.5h5l1.5 2.5h5l1.5-2.5h5"/>',
  chat: '<path d="M4 18.5 5.2 15A7.5 7.5 0 1 1 8.6 18.3z"/><path d="M8.5 11h7M8.5 8h5"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.6 2.6 0 0 1 5 .9c0 1.8-2.5 2.2-2.5 3.9M12 17.3v.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>',
  phone: '<path d="M5 3.5h3.5l1.8 4.5-2.3 1.4a11 11 0 0 0 6.6 6.6l1.4-2.3 4.5 1.8V19a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 3 5.7 2 2 0 0 1 5 3.5z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6z"/><path d="m9 12 2 2 4-4"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  alert: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
  refresh: '<path d="M20 11A8 8 0 0 0 6.3 6.3L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 13.7 4.7L20 15.5M20 20v-4.5h-4.5"/>',
  share: '<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14.5 8.5l2 2"/>',
  cash: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.8"/><path d="M6 9.5v5M18 9.5v5"/>',
  receipt: '<path d="M6 2.5h12v19l-3-2-3 2-3-2-3 2z"/><path d="M9 7.5h6M9 11h6M9 14.5h4"/>',
  sparkle: '<path d="M12 3.5 13.8 10 20.5 12l-6.7 2L12 20.5 10.2 14 3.5 12l6.7-2z"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  archive: '<rect x="3" y="4" width="18" height="4.5" rx="1"/><path d="M5 8.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V8.5M10 12.5h4"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.5 4.2-6.5 8-6.5s7 2 8 6.5"/>',
  bank: '<path d="M3 9.5 12 4l9 5.5M4.5 10v8M9.5 10v8M14.5 10v8M19.5 10v8M3 20.5h18"/>',
  scan: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M7 12h10"/>',
};
C.icon = (name, size = 20, cls = '') =>
  `<svg class="ico ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;

/* ─────────── Avisos, diálogos y hojas ─────────── */
C.toast = (msg, kind = 'info', ms = 4200) => {
  let host = C.$('#toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toasts';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.innerHTML = `${C.icon(kind === 'error' ? 'alert' : kind === 'success' ? 'check' : 'sparkle', 18)}<span></span>`;
  el.querySelector('span').textContent = msg;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => {
    el.classList.remove('in');
    setTimeout(() => el.remove(), 400);
  }, ms);
};

/**
 * Abre un diálogo modal. `render(body, close)` llena el contenido. Devuelve una promesa con el valor de cierre.
 */
C.modal = ({ title, wide = false, render, onClose }) =>
  new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${C.esc(title)}">
      <header class="modal-head"><h2>${C.esc(title)}</h2><button class="icon-btn" data-close aria-label="${C.esc(C.t('Cerrar'))}">${C.icon('x')}</button></header>
      <div class="modal-body"></div></div>`;
    document.body.appendChild(wrap);
    const prevFocus = document.activeElement;
    const close = (val) => {
      wrap.classList.remove('in');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => wrap.remove(), 220);
      if (onClose) onClose(val);
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      resolve(val);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(undefined);
    };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('mousedown', (e) => {
      if (e.target === wrap) close(undefined);
    });
    wrap.querySelector('[data-close]').onclick = () => close(undefined);
    render(wrap.querySelector('.modal-body'), close);
    requestAnimationFrame(() => {
      wrap.classList.add('in');
      const f = wrap.querySelector('[autofocus], input, select, textarea, button.btn-primary');
      if (f) f.focus();
    });
  });

C.confirm = (title, message, { okText, danger = false, requireText } = {}) =>
  C.modal({
    title,
    render: (body, close) => {
      body.innerHTML = `<p class="lead"></p>
        ${requireText ? `<label class="field"><span>${C.esc(C.t('Escriba «{x}» para confirmar', { x: requireText }))}</span><input id="cf-text" autocomplete="off"></label>` : ''}
        <div class="actions"><button class="btn btn-ghost" data-no>${C.esc(C.t('Cancelar'))}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-yes>${C.esc(okText || C.t('Confirmar'))}</button></div>`;
      body.querySelector('.lead').textContent = message;
      const yes = body.querySelector('[data-yes]');
      if (requireText) {
        yes.disabled = true;
        body.querySelector('#cf-text').oninput = (e) => (yes.disabled = e.target.value.trim() !== requireText);
      }
      body.querySelector('[data-no]').onclick = () => close(false);
      yes.onclick = () => close(true);
    },
  });

C.prompt = (title, label, { value = '', placeholder = '', type = 'text', okText } = {}) =>
  C.modal({
    title,
    render: (body, close) => {
      body.innerHTML = `<label class="field"><span></span><input id="pr-in" type="${type}" autocomplete="off"></label>
        <div class="actions"><button class="btn btn-ghost" data-no>${C.esc(C.t('Cancelar'))}</button><button class="btn btn-primary" data-yes>${C.esc(okText || C.t('Aceptar'))}</button></div>`;
      body.querySelector('span').textContent = label;
      const inp = body.querySelector('#pr-in');
      inp.value = value;
      inp.placeholder = placeholder;
      inp.onkeydown = (e) => {
        if (e.key === 'Enter') close(inp.value);
      };
      body.querySelector('[data-no]').onclick = () => close(null);
      body.querySelector('[data-yes]').onclick = () => close(inp.value);
    },
  });

/** Anima un número de 0 (o del valor anterior) al nuevo valor. */
C.countUp = (el, to, formatter, ms = 900) => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const from = Number(el.dataset.value || 0);
  el.dataset.value = String(to);
  if (reduce || from === to) {
    el.textContent = formatter(to);
    return;
  }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = formatter(Math.round(from + (to - from) * e));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
};

C.initials = (name) => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('');
