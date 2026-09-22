/* COROC · dashboard inicial (§17) */
C.ui.tip = (() => {
  let el;
  return {
    show(html, x, y) {
      if (!el) {
        el = document.createElement('div');
        el.className = 'tip';
        document.body.appendChild(el);
      }
      el.innerHTML = html;
      const w = el.offsetWidth;
      el.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2))}px`;
      el.style.top = `${y - el.offsetHeight - 12}px`;
      el.style.opacity = 1;
    },
    hide() {
      if (el) el.style.opacity = 0;
    },
  };
})();

C.ui.ring = (fraction, size = 132, stroke = 10) => {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, fraction || 0));
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${Math.round(f * 100)} %">
    <defs><linearGradient id="rg" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#A57E33"/><stop offset=".5" stop-color="#E9C879"/><stop offset="1" stop-color="#CAA555"/></linearGradient></defs>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(233,200,121,.18)" stroke-width="${stroke}"/>
    <circle class="ring-fill" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="url(#rg)" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${c}" data-target="${c * (1 - f)}" transform="rotate(-90 ${size / 2} ${size / 2})" style="transition:stroke-dashoffset 1.1s cubic-bezier(.22,.61,.36,1)"/>
  </svg>`;
};

/** Barras verticales de una serie (recaudo diario). Tooltip por barra; los valores también están en Informes. */
C.ui.bars = (points, { height = 190, width = 640 } = {}) => {
  const W = Math.max(280, Math.round(width));
  const pad = { l: 56, r: 8, t: 12, b: 26 };
  const max = Math.max(1, ...points.map((p) => p.amount));
  const niceStep = (m) => {
    const raw = m / 3;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / pow;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
  };
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const iw = W - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const slot = iw / points.length;
  const bw = Math.min(24, slot - 2);
  const y = (v) => pad.t + ih - (v / top) * ih;
  let g = '';
  for (let v = 0; v <= top + 1e-9; v += step) {
    g += `<line class="grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${C.esc(C.moneyCompact(v))}</text>`;
  }
  const today = C.today();
  const bars = points.map((p, i) => {
    const x = pad.l + i * slot + (slot - bw) / 2;
    const h = Math.max(0, (p.amount / top) * ih);
    const yy = pad.t + ih - h;
    const rr = Math.min(4, h);
    const d = h <= 0 ? '' : `M${x},${pad.t + ih} V${yy + rr} Q${x},${yy} ${x + rr},${yy} H${x + bw - rr} Q${x + bw},${yy} ${x + bw},${yy + rr} V${pad.t + ih} Z`;
    return `<g><rect x="${pad.l + i * slot}" y="${pad.t}" width="${slot}" height="${ih}" fill="transparent" data-i="${i}" tabindex="0" class="hit"/>${d ? `<path class="bar ${p.date === today ? 'today' : ''}" d="${d}" data-i="${i}"/>` : ''}</g>`;
  }).join('');
  const last = points.length - 1;
  const lbl = [0, Math.floor(points.length / 2), last].map((i) => `<text x="${i === 0 ? pad.l : i === last ? W - pad.r : pad.l + i * slot + slot / 2}" y="${height - 6}" text-anchor="${i === 0 ? 'start' : i === last ? 'end' : 'middle'}">${C.esc(C.fmtDate(points[i].date, { day: 'numeric', month: 'short' }))}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${height}" preserveAspectRatio="none" role="img" aria-label="${C.esc(C.t('Recaudo diario de los últimos 30 días'))}">${g}${bars}${lbl}</svg>`;
};
C.ui.bindBars = (root, points) => {
  C.$$('.hit', root).forEach((h) => {
    const show = () => {
      const p = points[Number(h.dataset.i)];
      const b = h.getBoundingClientRect();
      C.ui.tip.show(`<strong>${C.esc(C.money(p.amount))}</strong><span>${C.esc(C.fmtDate(p.date, { weekday: 'short', day: 'numeric', month: 'short' }))}</span>`, b.left + b.width / 2, b.top + 20);
    };
    h.addEventListener('pointerenter', show);
    h.addEventListener('focus', show);
    h.addEventListener('pointerleave', C.ui.tip.hide);
    h.addEventListener('blur', C.ui.tip.hide);
  });
};

C.views.dashboard = async (view) => {
  const m = C.metrics.compute();
  const hour = Number(C.nowLocal().slice(11, 13));
  const greet = hour < 12 ? C.t('Buenos días') : hour < 19 ? C.t('Buenas tardes') : C.t('Buenas noches');
  const pctToday = m.expectedToday ? m.collectedToday / (m.expectedToday + m.collectedToday) : m.collectedToday ? 1 : 0;
  const agingMax = Math.max(1, ...Object.values(m.aging).map((a) => a.amount));
  const agingRows = [
    ['current', C.t('Al día')], ['d1_7', C.t('1 a 7 días')], ['d8_30', C.t('8 a 30 días')], ['d30p', C.t('Más de 30 días')],
  ];
  const inboxN = C.intake.pendingCount();
  const dueMsgs = C.msg.due().length;
  const kpi = (id, icon, label, sub) => `<article class="card kpi" id="kpi-${id}"><div class="label overline">${C.icon(icon, 16)}${C.esc(label)}</div><div class="value num" data-kpi="${id}">—</div><div class="sub">${sub}</div></article>`;

  view.innerHTML = `
    <div class="page-head"><div><span class="overline">${C.esc(C.fmtDate(m.today, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</span>
      <h1 style="margin-top:6px">${C.esc(greet)}, ${C.esc(C.state.user.name.split(' ')[0])}</h1></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        ${inboxN ? `<a class="btn" href="#/inbox">${C.icon('inbox', 18)}${C.esc(C.tp('{n} comprobante por revisar', '{n} comprobantes por revisar', inboxN))}</a>` : ''}
        ${dueMsgs ? `<a class="btn" href="#/messages">${C.icon('chat', 18)}${C.esc(C.tp('{n} mensaje por enviar', '{n} mensajes por enviar', dueMsgs))}</a>` : ''}
      </div></div>
    ${C.folderBanner()}
    <section class="kpis" aria-label="${C.esc(C.t('Indicadores principales'))}">
      ${kpi('clients', 'users', C.t('Total de clientes'), C.esc(C.tp('{n} registrado', '{n} registrados', m.clientsTotal)))}
      ${kpi('lent', 'cash', C.t('Total prestado'), `${C.esc(C.t('Histórico'))} <span class="num">${C.esc(C.money(m.totalLentHistoric))}</span>`)}
      ${kpi('today', 'today', C.t('Esperado para hoy'), `${C.esc(C.t('Recaudado hoy'))} <span class="num">${C.esc(C.money(m.collectedToday))}</span> · ${C.esc(C.t('Vencido'))} <span class="num">${C.esc(C.money(m.overdueTotal))}</span>`)}
      ${kpi('receivable', 'chart', C.t('Total por recibir'), C.esc(C.t('Capital, intereses pactados y mora')))}
    </section>
    <section class="dash-grid">
      <article class="card hero-card card-pad" style="display:grid;grid-template-columns:auto minmax(0,1fr);gap:28px;align-items:center">
        <div class="progress-ring" style="position:relative">${C.ui.ring(pctToday)}<div style="position:absolute;text-align:center"><div style="font:500 26px var(--font-text)" class="num">${Math.round(pctToday * 100)}%</div><div class="overline" style="font-size:9px">${C.esc(C.t('de hoy'))}</div></div></div>
        <div style="min-width:0;position:relative"><div class="overline">${C.esc(C.t('Recaudo de hoy'))}</div>
          <div style="font:500 30px/1.15 var(--font-text);margin:10px 0 4px;color:#E9C879" class="num">${C.esc(C.money(m.collectedToday))}</div>
          <div style="color:#B8B4D6">${C.esc(C.t('Pendiente para hoy: {x}', { x: C.money(m.expectedToday) }))}</div>
          <div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap"><a class="btn btn-primary btn-sm" href="#/today">${C.esc(C.t('Ver cobros de hoy'))}${C.icon('arrow', 16)}</a></div></div>
      </article>
      <article class="card"><div class="card-head"><h3>${C.esc(C.t('Cartera por estado'))}</h3><span class="note">${C.esc(C.t('Días de mora · saldo por recibir'))}</span></div>
        <div class="card-pad" style="padding-top:12px">${agingRows.map(([k, label]) => `<div class="hbar"><div><div style="font-weight:500">${C.esc(label)}</div><div class="row-sub">${C.esc(C.tp('{n} préstamo', '{n} préstamos', m.aging[k].n))}</div></div>
          <div class="track"><div class="fill" style="width:0" data-w="${(m.aging[k].amount / agingMax) * 100}"></div></div><div class="num" style="font-weight:600">${C.esc(C.moneyCompact(m.aging[k].amount))}</div></div>`).join('')}</div></article>
    </section>
    <section class="dash-grid">
      <article class="card"><div class="card-head"><h3>${C.esc(C.t('Recaudo de los últimos 30 días'))}</h3><span class="note num">${C.esc(C.money(m.trend.reduce((s, p) => s + p.amount, 0)))}</span></div>
        <div class="card-pad" style="padding-top:8px" id="trend"></div></article>
      <article class="card"><div class="card-head"><h3>${C.esc(C.t('Cobros de hoy'))}</h3><a class="note" href="#/today">${C.esc(C.t('Ver todos'))}</a></div>
        <div class="list" style="margin-top:6px">${m.dueToday.slice(0, 6).map((d) => {
          const c = C.clientById(d.loan.clientId);
          return `<a class="li" href="#/client/${c.id}" style="color:inherit;text-decoration:none"><span class="avatar">${C.esc(C.initials(C.fullName(c)))}</span><div class="grow"><div class="row-title">${C.esc(C.fullName(c))}</div><div class="row-sub">${C.esc(d.loan.contract)} · ${C.esc(C.t('Cuota {n}', { n: d.inst.number }))}</div></div><span class="amt">${C.esc(C.money(d.outstanding))}</span></a>`;
        }).join('') || `<div class="empty">${C.icon('check', 26)}<div>${C.esc(C.t('No hay cuotas pendientes para hoy.'))}</div></div>`}</div></article>
    </section>`;

  const fmt = (v) => C.money(v);
  const prev = C.state.lastKpis || {};
  const vals = { clients: m.clientsActive, lent: m.totalLent, today: m.expectedToday, receivable: m.totalReceivable };
  for (const [k, v] of Object.entries(vals)) {
    const el = view.querySelector(`[data-kpi="${k}"]`);
    el.dataset.value = String(prev[k] !== undefined ? prev[k] : 0);
    C.countUp(el, v, k === 'clients' ? (x) => new Intl.NumberFormat(C.localeOf()).format(x) : fmt);
    if (prev[k] !== undefined && prev[k] !== v) view.querySelector(`#kpi-${k}`).classList.add('flash');
  }
  C.state.lastKpis = vals;
  const trend = C.$('#trend');
  const drawTrend = () => {
    trend.innerHTML = C.ui.bars(m.trend, { width: trend.clientWidth - 44 });
    C.ui.bindBars(trend, m.trend);
  };
  drawTrend();
  C.state.onResize = C.debounce(() => document.body.contains(trend) && drawTrend(), 150);
  requestAnimationFrame(() => {
    C.$$('.ring-fill', view).forEach((c) => (c.style.strokeDashoffset = c.dataset.target));
    C.$$('.hbar .fill', view).forEach((f) => (f.style.width = `${f.dataset.w}%`));
  });
};

C.folderBanner = () => {
  if (C.fs.status === 'needs-permission') {
    return `<div class="banner">${C.icon('folder', 20)}<div class="grow">${C.esc(C.t('COROC necesita su permiso de nuevo para guardar en la carpeta COROC de este equipo.'))}</div><button class="btn btn-sm btn-primary" onclick="C.fs.reauthorize().then(()=>C.render())">${C.esc(C.t('Permitir'))}</button></div>`;
  }
  return '';
};

C.views.more = (view) => {
  view.innerHTML = `<div class="page-head"><h1>${C.esc(C.t('Más'))}</h1></div><div class="card"><div class="list">
    ${C.NAV.filter((n) => ['messages', 'reports', 'settings', 'help'].includes(n.id) && (!n.perm || C.can(n.perm))).map((n) => `<a class="li" href="#/${n.id}" style="color:inherit;text-decoration:none">${C.icon(n.icon, 20, 'gold')}<span class="grow">${C.esc(C.t(n.label))}</span>${C.icon('chevron', 18)}</a>`).join('')}
    <button class="li" style="border:0;background:none;width:100%;text-align:left;cursor:pointer" data-m="theme">${C.icon(C.isDark() ? 'sun' : 'moon', 20, 'gold')}<span class="grow">${C.esc(C.t('Cambiar tema'))}</span></button>
    <button class="li" style="border:0;background:none;width:100%;text-align:left;cursor:pointer" data-m="lang">${C.icon('globe', 20, 'gold')}<span class="grow">${C.esc(C.t('Idioma'))}</span></button>
    ${C.can('backup.create') ? `<button class="li" style="border:0;background:none;width:100%;text-align:left;cursor:pointer" data-m="backup">${C.icon('archive', 20, 'gold')}<span class="grow">${C.esc(C.t('Crear respaldo'))}</span></button>` : ''}
    <button class="li" style="border:0;background:none;width:100%;text-align:left;cursor:pointer" data-m="logout">${C.icon('logout', 20, 'gold')}<span class="grow">${C.esc(C.t('Cerrar sesión'))}</span></button>
  </div></div>`;
  C.$$('[data-m]', view).forEach((b) => (b.onclick = () => C.shellAction(b.dataset.m)));
};
