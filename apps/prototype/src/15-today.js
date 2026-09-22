/* COROC · cobros de hoy (§5.7-4) */
C.views.today = (view) => {
  const m = C.metrics.compute();
  const overdueRows = [];
  for (const o of m.overdueList) {
    const st = C.loanState(o.loan);
    const oldest = st.states.find((s) => s.paid < s.amount && s.dueDate < m.today);
    overdueRows.push({ loan: o.loan, outstanding: o.outstanding, days: o.days, inst: oldest });
  }
  const row = (loan, inst, outstanding, extra) => {
    const c = C.clientById(loan.clientId);
    return `<div class="li"><span class="avatar">${C.esc(C.initials(C.fullName(c)))}</span>
      <div class="grow"><a href="#/client/${c.id}" class="row-title" style="color:inherit;text-decoration:none">${C.esc(C.fullName(c))}</a>
      <div class="row-sub">${C.esc(loan.contract)} · ${C.esc(C.t('Cuota {n}', { n: inst.number }))} · ${C.esc(C.freqText(loan.terms.frequency))}${extra}</div></div>
      <span class="amt">${C.esc(C.money(outstanding, loan.terms.currency))}</span>
      <div style="display:flex;gap:6px">
        ${C.can('message.send') ? `<button class="icon-btn" data-remind="${loan.id}" title="${C.esc(C.t('Enviar recordatorio'))}" aria-label="${C.esc(C.t('Enviar recordatorio'))}">${C.icon('chat', 18)}</button>` : ''}
        ${C.can('payment.register') ? `<button class="btn btn-sm" data-pay="${loan.id}">${C.icon('cash', 16)}<span class="hide-m">${C.esc(C.t('Registrar pago'))}</span></button>` : ''}
      </div></div>`;
  };
  view.innerHTML = `<div class="page-head"><div><h1>${C.esc(C.t('Cobros de hoy'))}</h1><p>${C.esc(C.fmtDate(m.today, { weekday: 'long', day: 'numeric', month: 'long' }))}</p></div></div>
    <section class="kpis" style="grid-template-columns:repeat(3,minmax(0,1fr))">
      <article class="card kpi"><div class="label overline">${C.icon('today', 16)}${C.esc(C.t('Esperado para hoy'))}</div><div class="value num">${C.esc(C.money(m.expectedToday))}</div><div class="sub">${C.esc(C.tp('{n} cuota', '{n} cuotas', m.dueToday.length))}</div></article>
      <article class="card kpi"><div class="label overline">${C.icon('check', 16)}${C.esc(C.t('Recaudado hoy'))}</div><div class="value num">${C.esc(C.money(m.collectedToday))}</div><div class="sub">${C.esc(C.t('Incluye pagos de cuotas vencidas'))}</div></article>
      <article class="card kpi"><div class="label overline">${C.icon('alert', 16)}${C.esc(C.t('Vencido'))}</div><div class="value num">${C.esc(C.money(m.overdueTotal))}</div><div class="sub">${C.esc(C.tp('{n} préstamo en mora', '{n} préstamos en mora', overdueRows.length))}</div></article>
    </section>
    <article class="card section"><div class="card-head"><h3>${C.esc(C.t('Vencen hoy'))}</h3><span class="note">${m.dueToday.length}</span></div>
      <div class="list" style="margin-top:6px">${m.dueToday.map((d) => row(d.loan, d.inst, d.outstanding, '')).join('') || `<div class="empty">${C.icon('check', 26)}<div>${C.esc(C.t('No hay cuotas pendientes para hoy.'))}</div></div>`}</div></article>
    <article class="card section"><div class="card-head"><h3>${C.esc(C.t('Vencidas'))}</h3><span class="note">${overdueRows.length}</span></div>
      <div class="list" style="margin-top:6px">${overdueRows.map((o) => row(o.loan, o.inst, o.outstanding, ` · <span style="color:var(--err)">${C.esc(C.tp('{n} día de mora', '{n} días de mora', o.days))}</span>`)).join('') || `<div class="empty">${C.icon('shield', 26)}<div>${C.esc(C.t('Sin cartera vencida.'))}</div></div>`}</div></article>`;
  C.$$('[data-pay]', view).forEach((b) => (b.onclick = () => C.ui.paymentDialog(C.loanById(b.dataset.pay))));
  C.$$('[data-remind]', view).forEach((b) => (b.onclick = async () => {
    const loan = C.loanById(b.dataset.remind);
    const st = C.loanState(loan);
    const msg = await C.msg.enqueueEvent(st.summary.overdueCount ? 'overdue' : 'reminder', loan, { dedupeKey: `manual:${loan.id}:${Date.now()}` });
    if (msg && msg.status === 'ready') await C.msg.send(msg);
    else C.msg.feedback(msg);
    C.refreshBadges();
  }));
};
