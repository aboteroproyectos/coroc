/* COROC · clientes, asistente de creación, ficha 360 y cuadro de inversión y pagos (§8, §10) */
C.STATUS_CHIP = {
  current: ['ok', 'Al día'], overdue: ['err', 'En mora'], closed: ['info', 'Finalizado'],
  paid: ['ok', 'Pagada'], partial: ['warn', 'Parcial'], pending: ['', 'Pendiente'], waived: ['info', 'Condonada'],
};
C.chip = (key) => {
  const [cls, label] = C.STATUS_CHIP[key] || ['', key];
  return `<span class="chip ${cls}">${C.esc(C.t(label))}</span>`;
};
C.instStatus = (s) => (Core.statusOf(s, C.today()) === 'overdue' ? 'overdue_i' : Core.statusOf(s, C.today()));
C.STATUS_CHIP.overdue_i = ['err', 'Vencida'];
C.freqText = (f) => C.t({ daily: 'Diaria', weekly: 'Semanal', monthly: 'Mensual' }[f]);
C.WEEKDAYS = (lang) => [1, 2, 3, 4, 5, 6, 7].map((d) => C.fmtDate(Core.addDays('2026-01-04', d), { weekday: 'short' }, lang));

/* ───────────── Lista de clientes ───────────── */
C.views.clients = (view) => {
  const st = (C.state.clientsFilter ||= { status: 'all', q: '', freq: '', page: 1 });
  const rows = C.visibleClients().map((c) => {
    const loans = C.loansOf(c.id);
    const active = loans.find((l) => l.status === 'active') || loans[0];
    const s = active ? C.loanState(active) : null;
    const status = active ? C.statusOfLoan(active, s) : 'closed';
    const balance = loans.reduce((a, l) => a + C.loanState(l).summary.balance, 0);
    return { c, loans, active, s, status, balance };
  });
  const norm = (x) => Core.stripAccents(String(x || '')).toLowerCase();
  const filtered = rows.filter((r) => (st.status === 'all' || r.status === st.status) && (!st.freq || (r.active && r.active.terms.frequency === st.freq)) &&
    (!st.q || norm(`${C.fullName(r.c)} ${r.c.code} ${r.c.phone} ${r.loans.map((l) => l.contract).join(' ')}`).includes(norm(st.q))))
    .sort((a, b) => C.fullName(a.c).localeCompare(C.fullName(b.c)));
  const pageSize = 50;
  const shown = filtered.slice(0, st.page * pageSize);
  const count = (k) => rows.filter((r) => k === 'all' || r.status === k).length;
  view.innerHTML = `<div class="page-head"><div><h1>${C.esc(C.t('Clientes'))}</h1><p>${C.esc(C.tp('{n} cliente', '{n} clientes', rows.length))}</p></div>
      ${C.can('client.create') ? `<a class="btn btn-primary" href="#/new-client">${C.icon('plus', 18)}${C.esc(C.t('Nuevo cliente'))}</a>` : ''}</div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:16px">
      <div class="seg" role="group">${[['all', 'Todos'], ['current', 'Al día'], ['overdue', 'En mora'], ['closed', 'Finalizados']].map(([k, l]) => `<button data-st="${k}" aria-pressed="${st.status === k}">${C.esc(C.t(l))} <span class="muted num">${count(k)}</span></button>`).join('')}</div>
      <label class="field" style="flex-direction:row;align-items:center"><select id="cl-freq" style="height:40px"><option value="">${C.esc(C.t('Todas las frecuencias'))}</option>${['daily', 'weekly', 'monthly'].map((f) => `<option value="${f}" ${st.freq === f ? 'selected' : ''}>${C.esc(C.freqText(f))}</option>`).join('')}</select></label>
      <label class="search" style="max-width:320px;height:40px">${C.icon('search', 16)}<input id="cl-q" placeholder="${C.esc(C.t('Filtrar'))}" value="${C.esc(st.q)}"></label>
    </div>
    <div class="card table-wrap">${filtered.length ? `<table class="t"><thead><tr><th>${C.esc(C.t('Cliente'))}</th><th>${C.esc(C.t('Contrato'))}</th><th>${C.esc(C.t('Frecuencia'))}</th><th>${C.esc(C.t('Próxima cuota'))}</th><th class="r">${C.esc(C.t('Saldo'))}</th><th>${C.esc(C.t('Estado'))}</th></tr></thead><tbody>
      ${shown.map((r) => `<tr class="link" data-id="${r.c.id}"><td><div style="display:flex;gap:12px;align-items:center"><span class="avatar">${C.esc(C.initials(C.fullName(r.c)))}</span><div><div class="row-title">${C.esc(C.fullName(r.c))}</div><div class="row-sub">${C.esc(r.c.code)} · ${C.esc(r.c.phone || '')}</div></div></div></td>
        <td>${C.esc(r.loans.map((l) => l.contract).join(', ') || '—')}</td><td>${r.active ? C.esc(C.freqText(r.active.terms.frequency)) : '—'}</td>
        <td>${r.s && r.s.summary.next ? `<div>${C.esc(C.fmtDate(r.s.summary.next.dueDate))}</div><div class="row-sub num">${C.esc(C.money(r.s.summary.next.outstanding, r.active.terms.currency))}</div>` : '—'}</td>
        <td class="r">${C.esc(C.money(r.balance, r.active ? r.active.terms.currency : undefined))}</td><td>${C.chip(r.status)}</td></tr>`).join('')}</tbody></table>
      ${shown.length < filtered.length ? `<div style="padding:16px;text-align:center"><button class="btn" id="cl-more">${C.esc(C.t('Mostrar más'))}</button></div>` : ''}`
    : `<div class="empty">${C.icon('users', 30)}<div>${C.esc(rows.length ? C.t('Ningún cliente coincide con el filtro.') : C.t('Aún no hay clientes. Cree el primero en menos de un minuto.'))}</div>${!rows.length && C.can('client.create') ? `<a class="btn btn-primary" href="#/new-client">${C.esc(C.t('Nuevo cliente'))}</a>` : ''}</div>`}</div>`;
  C.$$('[data-st]', view).forEach((b) => (b.onclick = () => {
    st.status = b.dataset.st;
    st.page = 1;
    C.views.clients(view);
  }));
  C.$('#cl-freq', view).onchange = (e) => {
    st.freq = e.target.value;
    C.views.clients(view);
  };
  const q = C.$('#cl-q', view);
  q.oninput = C.debounce(() => {
    st.q = q.value;
    st.page = 1;
    C.views.clients(view);
    const n = C.$('#cl-q');
    n.focus();
    n.setSelectionRange(n.value.length, n.value.length);
  }, 180);
  C.$$('tr.link', view).forEach((tr) => (tr.onclick = () => C.go(`client/${tr.dataset.id}`)));
  const more = C.$('#cl-more', view);
  if (more) more.onclick = () => {
    st.page++;
    C.views.clients(view);
  };
};

/* ───────────── Formulario de préstamo con vista previa en vivo ───────────── */
C.ui.loanForm = (root, init = {}) => {
  const S = C.state.settings;
  const cur = C.currency();
  const v = {
    principal: init.principal || null, method: init.method || 'simple', ratePct: init.ratePct || '', installments: init.installments || '',
    frequency: init.frequency || 'daily', disbursementDate: init.disbursementDate || C.today(), firstDueDate: init.firstDueDate || '',
    collectionDays: init.collectionDays || [...S.defaultCollectionDays], excludeHolidays: init.excludeHolidays ?? S.excludeHolidays,
    monthlyDay: init.monthlyDay || '', contract: init.contract || '', lateType: init.lateType || 'none', lateValue: init.lateValue || '', lateGrace: init.lateGrace || '0',
    expectedMethod: init.expectedMethod || '',
  };
  const days = C.WEEKDAYS();
  const draw = () => {
    root.innerHTML = `<div class="grid g3">
      <label class="field"><span>${C.esc(C.t('Capital prestado'))} (${cur})</span><input name="principal" inputmode="decimal" required value="${v.principal ? C.esc(C.money(v.principal).replace(/[^\d.,]/g, '')) : ''}"></label>
      <div class="field"><span>${C.esc(C.t('Método de cálculo'))}</span><div class="seg" role="group">${[['simple', 'Interés simple fijo'], ['french', 'Cuota fija (francés)']].map(([k, l]) => `<button type="button" data-method="${k}" aria-pressed="${v.method === k}">${C.esc(C.t(l))}</button>`).join('')}</div></div>
      <label class="field"><span>${C.esc(v.method === 'simple' ? C.t('Interés sobre el total (%)') : C.t('Tasa por período (%)'))}</span><input name="ratePct" inputmode="decimal" required value="${C.esc(v.ratePct)}"></label>
      <label class="field"><span>${C.esc(C.t('Total de cuotas'))}</span><input name="installments" inputmode="numeric" required value="${C.esc(v.installments)}"></label>
      <div class="field span2"><span>${C.esc(C.t('Forma de pago'))}</span><div class="seg" role="group">${['daily', 'weekly', 'monthly'].map((f) => `<button type="button" data-freq="${f}" aria-pressed="${v.frequency === f}">${C.esc(C.freqText(f))}</button>`).join('')}</div></div>
      <label class="field"><span>${C.esc(C.t('Fecha de desembolso'))}</span><input name="disbursementDate" type="date" required value="${C.esc(v.disbursementDate)}"></label>
      <label class="field"><span>${C.esc(C.t('Primera cuota (opcional)'))}</span><input name="firstDueDate" type="date" value="${C.esc(v.firstDueDate)}"></label>
      ${v.frequency === 'monthly' ? `<label class="field"><span>${C.esc(C.t('Día de cobro del mes'))}</span><input name="monthlyDay" inputmode="numeric" placeholder="1–31" value="${C.esc(v.monthlyDay)}"></label>` : '<div></div>'}
      ${v.frequency === 'daily' ? `<div class="field span2"><span>${C.esc(C.t('Días de cobro'))}</span><div class="days">${days.map((d, i) => `<label><input type="checkbox" data-day="${i + 1}" ${v.collectionDays.includes(i + 1) ? 'checked' : ''}><span>${C.esc(d.replace('.', ''))}</span></label>`).join('')}</div></div>` : ''}
      <label class="check" style="align-self:end;padding-bottom:10px"><input type="checkbox" name="excludeHolidays" ${v.excludeHolidays ? 'checked' : ''}><span>${C.esc(C.t('Excluir festivos'))}</span></label>
      <label class="field"><span>${C.esc(C.t('Número de contrato'))}</span><input name="contract" placeholder="${C.esc(C.t('Automático'))}" value="${C.esc(v.contract)}"></label>
      <label class="field"><span>${C.esc(C.t('Mora'))}</span><select name="lateType"><option value="none">${C.esc(C.t('Sin mora'))}</option><option value="percent_daily" ${v.lateType === 'percent_daily' ? 'selected' : ''}>${C.esc(C.t('% diario sobre lo vencido'))}</option><option value="fixed_daily" ${v.lateType === 'fixed_daily' ? 'selected' : ''}>${C.esc(C.t('Valor fijo por día'))}</option></select></label>
      ${v.lateType !== 'none' ? `<label class="field"><span>${C.esc(v.lateType === 'percent_daily' ? C.t('% diario') : C.t('Valor por día'))}</span><input name="lateValue" inputmode="decimal" value="${C.esc(v.lateValue)}"></label>
      <label class="field"><span>${C.esc(C.t('Días de gracia'))}</span><input name="lateGrace" inputmode="numeric" value="${C.esc(v.lateGrace)}"></label>` : ''}
      <label class="field ${v.lateType !== 'none' ? '' : 'span2'}"><span>${C.esc(C.t('Medio de pago esperado'))}</span><input name="expectedMethod" placeholder="${C.esc(C.t('Transferencia, efectivo, billetera…'))}" value="${C.esc(v.expectedMethod)}"></label>
    </div><div id="lf-preview" class="section"></div>`;
    bind();
    preview();
  };
  const read = () => {
    const q = (n) => root.querySelector(`[name="${n}"]`);
    if (q('principal')) v.principal = C.parseMoney(q('principal').value, cur);
    v.ratePct = q('ratePct').value.trim();
    v.installments = q('installments').value.trim();
    v.disbursementDate = q('disbursementDate').value;
    v.firstDueDate = q('firstDueDate').value;
    v.excludeHolidays = q('excludeHolidays').checked;
    v.contract = q('contract').value.trim();
    v.lateType = q('lateType').value;
    v.expectedMethod = q('expectedMethod').value.trim();
    if (q('monthlyDay')) v.monthlyDay = q('monthlyDay').value.trim();
    if (q('lateValue')) v.lateValue = q('lateValue').value.trim();
    if (q('lateGrace')) v.lateGrace = q('lateGrace').value.trim();
    const dd = C.$$('[data-day]', root);
    if (dd.length) v.collectionDays = dd.filter((x) => x.checked).map((x) => Number(x.dataset.day));
  };
  const terms = () => {
    read();
    if (!v.principal || !v.ratePct || !v.installments) return null;
    const rate = new Core.Decimal(v.ratePct.replace(',', '.')).div(100).toString();
    return C.termsFromForm({
      principal: v.principal, currency: cur, method: v.method, rate, installments: Number(v.installments), frequency: v.frequency,
      disbursementDate: v.disbursementDate, firstDueDate: v.firstDueDate || undefined, collectionDays: v.collectionDays, excludeHolidays: v.excludeHolidays,
      monthlyDay: v.monthlyDay ? Number(v.monthlyDay) : undefined,
    });
  };
  const lateFee = () => {
    if (v.lateType === 'none' || !v.lateValue) return null;
    const value = v.lateType === 'percent_daily' ? new Core.Decimal(v.lateValue.replace(',', '.')).div(100).toString() : String(C.parseMoney(v.lateValue, cur) || 0);
    return { type: v.lateType, value, graceDays: Number(v.lateGrace || 0) };
  };
  let lastPreview = null;
  const preview = C.debounce(() => {
    const box = root.querySelector('#lf-preview');
    if (!box) return;
    let t;
    try {
      t = terms();
    } catch (e) {
      box.innerHTML = `<div class="flag">${C.icon('alert', 16)}<span></span></div>`;
      box.querySelector('span').textContent = e.message;
      lastPreview = null;
      return;
    }
    if (!t) {
      box.innerHTML = `<div class="card card-pad note">${C.esc(C.t('Complete capital, tasa y número de cuotas para ver el plan de pagos.'))}</div>`;
      lastPreview = null;
      return;
    }
    try {
      const p = C.previewLoan(t);
      lastPreview = p;
      const lf = lateFee();
      const cap = S.rateCap && S.rateCap.ea;
      const lateBad = lf && lf.type === 'percent_daily' && cap && !Core.dailyLateFeeWithinCap(lf.value, cap);
      const s = p.schedule;
      box.innerHTML = `<div class="card"><div class="card-head"><h3>${C.icon('sparkle', 18, 'gold')}${C.esc(C.t('Vista previa del plan de pagos'))}</h3></div>
        <div class="card-pad"><div class="stats" style="grid-template-columns:repeat(5,minmax(0,1fr))">
          ${[[C.t('Valor de la cuota'), C.money(s.regularInstallment)], [C.t('Total a pagar'), C.money(s.totalPayable)], [C.t('Utilidad'), C.money(s.totalInterest)], [C.t('Tasa efectiva anual'), C.pct(p.ea)], [C.t('Última cuota'), C.fmtDate(s.installments[s.installments.length - 1].dueDate)]].map(([k, x]) => `<div class="stat card" style="box-shadow:none"><div class="overline">${C.esc(k)}</div><div class="v num">${C.esc(x)}</div></div>`).join('')}</div>
          ${p.capCheck && !p.capCheck.ok ? `<div class="flag" style="margin-top:14px">${C.icon('alert', 16)}<span>${C.esc(C.t('La tasa efectiva anual ({ea}) supera el tope legal configurado ({cap}). Tasa máxima que cumple: {max} %.', { ea: C.pct(p.ea), cap: C.pct(p.capCheck.cap), max: (Number(p.capCheck.maxRate) * 100).toFixed(2) }))}</span></div>` : ''}
          ${!cap ? `<div class="flag warning" style="margin-top:14px">${C.icon('alert', 16)}<span>${C.esc(C.t('No hay tope legal de tasa configurado. Regístrelo en Configuración › Cumplimiento.'))}</span></div>` : ''}
          ${lateBad ? `<div class="flag" style="margin-top:14px">${C.icon('alert', 16)}<span>${C.esc(C.t('La mora diaria equivale a una tasa anual superior al tope legal.'))}</span></div>` : ''}
          <div class="table-wrap" style="margin-top:14px;max-height:280px;overflow:auto"><table class="t"><thead><tr><th>${C.esc(C.t('N.º'))}</th><th>${C.esc(C.t('Vence'))}</th><th class="r">${C.esc(C.t('Cuota'))}</th><th class="r">${C.esc(C.t('Capital'))}</th><th class="r">${C.esc(C.t('Interés'))}</th><th class="r">${C.esc(C.t('Saldo'))}</th></tr></thead><tbody>
          ${s.installments.map((i) => `<tr><td>${i.number}</td><td>${C.esc(C.fmtDate(i.dueDate, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))}</td><td class="r">${C.esc(C.money(i.amount))}</td><td class="r">${C.esc(C.money(i.principal))}</td><td class="r">${C.esc(C.money(i.interest))}</td><td class="r">${C.esc(C.money(i.balanceAfter))}</td></tr>`).join('')}</tbody></table></div></div></div>`;
    } catch (e) {
      lastPreview = null;
      box.innerHTML = `<div class="flag">${C.icon('alert', 16)}<span></span></div>`;
      box.querySelector('span').textContent = e.message;
    }
  }, 150);
  const bind = () => {
    C.$$('input, select', root).forEach((i) => i.addEventListener('input', preview));
    C.$$('input, select', root).forEach((i) => i.addEventListener('change', preview));
    C.$$('[data-method]', root).forEach((b) => (b.onclick = () => {
      read();
      v.method = b.dataset.method;
      draw();
    }));
    C.$$('[data-freq]', root).forEach((b) => (b.onclick = () => {
      read();
      v.frequency = b.dataset.freq;
      draw();
    }));
    root.querySelector('[name="lateType"]').onchange = () => {
      read();
      draw();
    };
    const pr = root.querySelector('[name="principal"]');
    pr.onblur = () => {
      const m = C.parseMoney(pr.value, cur);
      if (m) pr.value = C.money(m).replace(/[^\d.,]/g, '');
    };
  };
  draw();
  return {
    get: () => {
      const t = terms();
      if (!t) throw new Error(C.t('Complete capital, tasa y número de cuotas.'));
      if (!lastPreview) C.previewLoan(t);
      const p = C.previewLoan(t);
      if (p.capCheck && !p.capCheck.ok) throw new Error(C.t('La tasa supera el tope legal configurado.'));
      const lf = lateFee();
      const cap = S.rateCap && S.rateCap.ea;
      if (lf && lf.type === 'percent_daily' && cap && !Core.dailyLateFeeWithinCap(lf.value, cap)) throw new Error(C.t('La mora diaria equivale a una tasa anual superior al tope legal.'));
      if (v.contract && C.state.loans.some((l) => l.contract === v.contract)) throw new Error(C.t('Ese número de contrato ya existe.'));
      return { terms: t, contract: v.contract || undefined, lateFee: lf, expectedMethod: v.expectedMethod, raw: { ...v } };
    },
  };
};

/* ───────────── Campos personales ───────────── */
C.ui.personFields = (c = {}) => `<div class="grid g2">
  <label class="field"><span>${C.esc(C.t('Nombre(s)'))} *</span><input name="firstName" required autocomplete="off" value="${C.esc(c.firstName || '')}"></label>
  <label class="field"><span>${C.esc(C.t('Apellidos'))} *</span><input name="lastName" required autocomplete="off" value="${C.esc(c.lastName || '')}"></label>
  <label class="field"><span>${C.esc(C.t('Número de contacto principal (WhatsApp)'))} *</span><input name="phone" type="tel" required value="${C.esc(c.phone || '')}"><small>${C.esc(C.t('Con este número COROC identifica quién envía cada comprobante.'))}</small></label>
  <label class="field"><span>${C.esc(C.t('Número secundario'))}</span><input name="phone2" type="tel" value="${C.esc(c.phone2 || '')}"></label>
  <label class="field"><span>${C.esc(C.t('Correo electrónico'))}</span><input name="email" type="email" value="${C.esc(c.email || '')}"></label>
  <label class="field"><span>${C.esc(C.t('Documento de identidad'))}</span><input name="idDoc" value="${C.esc(c.idDoc || '')}"></label>
  <label class="field"><span>${C.esc(C.t('Dirección'))}</span><input name="address" value="${C.esc(c.address || '')}"></label>
  <label class="field"><span>${C.esc(C.t('Ciudad'))}</span><input name="city" value="${C.esc(c.city || '')}"></label>
  <label class="field"><span>${C.esc(C.t('Idioma de mensajes y documentos'))}</span><select name="lang">${C.LANGS.map((l) => `<option value="${l.code}" ${(c.lang || C.companyLang()) === l.code ? 'selected' : ''}>${C.esc(l.label)}</option>`).join('')}</select></label>
  <label class="field"><span>${C.esc(C.t('Cobrador asignado'))}</span><select name="collectorId"><option value="">${C.esc(C.t('Sin asignar'))}</option>${C.state.users.filter((u) => u.role === 'collector' && u.active).map((u) => `<option value="${u.id}" ${c.collectorId === u.id ? 'selected' : ''}>${C.esc(u.name)}</option>`).join('')}</select></label>
  <label class="field"><span>${C.esc(C.t('Codeudor (nombre)'))}</span><input name="cdName" value="${C.esc((c.coDebtor && c.coDebtor.name) || '')}"></label>
  <label class="field"><span>${C.esc(C.t('Codeudor (teléfono)'))}</span><input name="cdPhone" type="tel" value="${C.esc((c.coDebtor && c.coDebtor.phone) || '')}"></label>
  <label class="field spanall"><span>${C.esc(C.t('Notas'))}</span><textarea name="notes" style="min-height:70px">${C.esc(c.notes || '')}</textarea></label>
</div>`;

C.ui.readPerson = (root, base = {}) => {
  const q = (n) => root.querySelector(`[name="${n}"]`).value.trim();
  const errs = [];
  const phone = C.normalizePhoneOrNull(q('phone'));
  const phone2 = q('phone2') ? C.normalizePhoneOrNull(q('phone2')) : null;
  const cdPhone = q('cdPhone') ? C.normalizePhoneOrNull(q('cdPhone')) : null;
  if (!q('firstName')) errs.push(C.t('Ingrese el nombre.'));
  if (!q('lastName')) errs.push(C.t('Ingrese los apellidos.'));
  if (!phone) errs.push(C.t('El número de contacto principal no es válido.'));
  if (q('phone2') && !phone2) errs.push(C.t('El número secundario no es válido.'));
  if (q('email') && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(q('email'))) errs.push(C.t('El correo no es válido.'));
  if (q('cdPhone') && !cdPhone) errs.push(C.t('El teléfono del codeudor no es válido.'));
  return {
    errs,
    data: {
      ...base, firstName: q('firstName'), lastName: q('lastName'), phone, phone2, email: q('email').toLowerCase(), idDoc: q('idDoc'), address: q('address'), city: q('city'),
      lang: q('lang'), collectorId: q('collectorId') || null, coDebtor: q('cdName') || cdPhone ? { name: q('cdName'), phone: cdPhone } : null, notes: q('notes'),
    },
  };
};

C.ui.consentFields = (c = {}) => {
  const w = (c.consents && c.consents.whatsapp) || null;
  const e = (c.consents && c.consents.email) || null;
  const methods = ['Cláusula firmada en el contrato', 'Mensaje de aceptación del cliente', 'Formulario de autorización'];
  return `<div class="grid g2">
    <div class="card card-pad" style="box-shadow:none"><label class="check"><input type="checkbox" name="cWa" ${w ? 'checked' : ''}><span><strong>${C.esc(C.t('Autoriza mensajes por WhatsApp'))}</strong><br><span class="note">${C.esc(C.t('Requerido por WhatsApp y por la ley de datos personales antes de cualquier mensaje.'))}</span></span></label>
      <label class="field" style="margin-top:10px"><span>${C.esc(C.t('Evidencia'))}</span><select name="cWaM">${methods.map((m) => `<option ${w && w.method === m ? 'selected' : ''}>${C.esc(C.t(m))}</option>`).join('')}</select></label></div>
    <div class="card card-pad" style="box-shadow:none"><label class="check"><input type="checkbox" name="cEm" ${e ? 'checked' : ''}><span><strong>${C.esc(C.t('Autoriza mensajes por correo'))}</strong><br><span class="note">${C.esc(C.t('Se usa para recibos, estados de cuenta y paz y salvo.'))}</span></span></label>
      <label class="field" style="margin-top:10px"><span>${C.esc(C.t('Evidencia'))}</span><select name="cEmM">${methods.map((m) => `<option ${e && e.method === m ? 'selected' : ''}>${C.esc(C.t(m))}</option>`).join('')}</select></label></div>
    <label class="check spanall"><input type="checkbox" name="habeas" ${c.dataConsentAt ? 'checked' : ''}><span>${C.esc(C.t('El cliente autorizó el tratamiento de sus datos personales (Ley 1581 de 2012 / LGPD).'))}</span></label>
  </div>`;
};
C.ui.readConsents = (root, prev = {}) => {
  const q = (n) => root.querySelector(`[name="${n}"]`);
  const now = C.nowLocal();
  const keep = (k, on, method) => (on ? (prev.consents && prev.consents[k] && prev.consents[k].method === method ? prev.consents[k] : { at: now, method, by: C.state.user.username }) : null);
  return {
    consents: { whatsapp: keep('whatsapp', q('cWa').checked, q('cWaM').value), email: keep('email', q('cEm').checked, q('cEmM').value) },
    dataConsentAt: q('habeas').checked ? prev.dataConsentAt || now : null,
  };
};

/* ───────────── Asistente "Nuevo cliente" (§8.3) ───────────── */
C.views['new-client'] = (view) => {
  if (!C.can('client.create')) return C.go('clients');
  const W = (C.state.wizard ||= { step: 0, person: {}, loan: {}, consents: {} });
  const titles = [C.t('Datos personales'), C.t('Condiciones del préstamo'), C.t('Canales y consentimientos')];
  view.innerHTML = `<div class="page-head"><div><a href="#/clients" class="note">${C.icon('back', 14)} ${C.esc(C.t('Clientes'))}</a><h1 style="margin-top:6px">${C.esc(C.t('Nuevo cliente'))}</h1><p>${C.esc(titles[W.step])} · ${C.esc(C.t('Paso {a} de {b}', { a: W.step + 1, b: 3 }))}</p></div></div>
    <div class="steps" style="max-width:520px">${[0, 1, 2].map((i) => `<i class="${i <= W.step ? 'on' : ''}"></i>`).join('')}</div>
    <form id="wz" class="card card-pad" novalidate><div id="wz-body"></div><div class="flags" id="wz-err" role="alert"></div>
      <div class="actions">${W.step > 0 ? `<button type="button" class="btn btn-ghost" id="wz-back">${C.esc(C.t('Atrás'))}</button>` : `<button type="button" class="btn btn-ghost" id="wz-cancel">${C.esc(C.t('Cancelar'))}</button>`}
      <button class="btn btn-primary">${C.esc(W.step === 2 ? C.t('Guardar y generar plan') : C.t('Continuar'))}${C.icon(W.step === 2 ? 'check' : 'arrow', 18)}</button></div></form>`;
  const body = C.$('#wz-body');
  const errBox = C.$('#wz-err');
  const showErrs = (errs) => (errBox.innerHTML = errs.map((e) => `<div class="flag">${C.icon('alert', 16)}<span>${C.esc(e)}</span></div>`).join(''));
  let loanForm;
  if (W.step === 0) body.innerHTML = C.ui.personFields(W.person);
  if (W.step === 1) loanForm = C.ui.loanForm(body, W.loan);
  if (W.step === 2) {
    const p = W.person;
    body.innerHTML = `${C.ui.consentFields(W.consents)}
      <div class="card card-pad section" style="box-shadow:none;background:var(--surface-2)"><div class="overline">${C.esc(C.t('Resumen'))}</div>
      <p style="margin:10px 0 0"><strong>${C.esc(`${p.firstName} ${p.lastName}`)}</strong> · ${C.esc(p.phone || '')}${p.email ? ' · ' + C.esc(p.email) : ''}</p>
      <p class="muted" style="margin:6px 0 0">${C.esc(C.t('{n} cuotas {f} de {v}. Total a pagar {t}.', { n: W.preview.installments.length, f: C.freqText(W.preview.terms.frequency).toLowerCase(), v: C.money(W.preview.regularInstallment), t: C.money(W.preview.totalPayable) }))}</p>
      <p class="note" style="margin-top:10px">${C.esc(C.t('Al guardar, COROC genera el plan de pagos en PDF, crea la carpeta del cliente y, si hay autorización, deja listo el mensaje de bienvenida.'))}</p></div>`;
  }
  const cancel = C.$('#wz-cancel');
  if (cancel) cancel.onclick = () => {
    C.state.wizard = null;
    C.go('clients');
  };
  const back = C.$('#wz-back');
  if (back) back.onclick = () => {
    if (W.step === 1) try {
      W.loan = loanForm.get().raw;
    } catch (e) {
      /* se conserva lo digitado aunque esté incompleto */
    }
    W.step--;
    C.views['new-client'](view);
  };
  C.$('#wz').onsubmit = async (e) => {
    e.preventDefault();
    errBox.innerHTML = '';
    if (W.step === 0) {
      const { errs, data } = C.ui.readPerson(body);
      if (errs.length) return showErrs(errs);
      const dup = C.findDuplicateClient(data);
      if (dup && !(await C.confirm(C.t('Posible cliente duplicado'), C.t('Ya existe {n} ({c}) con el mismo número o documento. ¿Desea continuar de todos modos?', { n: C.fullName(dup), c: dup.code }), { okText: C.t('Continuar') }))) return;
      W.person = data;
      W.step = 1;
      return C.views['new-client'](view);
    }
    if (W.step === 1) {
      try {
        const out = loanForm.get();
        W.loan = out.raw;
        W.loanOut = out;
        W.preview = C.previewLoan(out.terms).schedule;
      } catch (ex) {
        return showErrs([ex.message]);
      }
      W.step = 2;
      return C.views['new-client'](view);
    }
    const btn = e.submitter || C.$('#wz .btn-primary');
    btn.disabled = true;
    try {
      const cons = C.ui.readConsents(body, {});
      W.consents = cons;
      const client = await C.saveClient({ ...W.person, ...cons }, true);
      const loan = await C.createLoan(client, W.loanOut.terms, { contract: W.loanOut.contract, lateFee: W.loanOut.lateFee, expectedMethod: W.loanOut.expectedMethod });
      C.state.wizard = null;
      C.toast(C.t('Cliente {n} creado con el contrato {c}.', { n: C.fullName(client), c: loan.contract }), 'success');
      C.go(`client/${client.id}`);
    } catch (ex) {
      btn.disabled = false;
      showErrs([ex.message]);
    }
  };
};

/* ───────────── Ficha del cliente ───────────── */
C.views.client = (view, id) => {
  const [cid, tabArg] = id.split('/');
  const client = C.clientById(cid);
  if (!client || !C.visibleClients().includes(client)) {
    // CA-16: el intento de abrir un cliente ajeno queda en la bitácora
    if (client) C.audit('access.denied', 'client', client.id, { code: client.code, role: C.state.user && C.state.user.role });
    view.innerHTML = `<div class="empty">${C.icon('users', 30)}<div>${C.esc(C.t('Cliente no encontrado o sin acceso.'))}</div><a class="btn" href="#/clients">${C.esc(C.t('Volver a clientes'))}</a></div>`;
    return;
  }
  const loans = C.loansOf(client.id);
  const ui = (C.state.clientUi ||= {});
  if (ui.clientId !== client.id) Object.assign(ui, { clientId: client.id, loanId: (loans.find((l) => l.status === 'active') || loans[0] || {}).id, tab: tabArg || 'summary' });
  const loan = loans.find((l) => l.id === ui.loanId) || loans[0];
  const st = loan ? C.loanState(loan) : null;
  const cur = loan ? loan.terms.currency : C.currency();
  const status = loan ? C.statusOfLoan(loan, st) : 'closed';
  const progress = loan ? st.summary.paidTotal / loan.totalPayable : 0;
  const tabs = [['summary', 'Resumen'], ['schedule', 'Cuadro de inversión y pagos'], ['docs', 'Documentos'], ['msgs', 'Mensajes'], ['history', 'Historial']];
  const docsN = C.docs.of(client.id).length;
  // Utilidad realizada: porción de interés efectivamente cobrada en cada cuota + mora pagada.
  const realized = loan ? loan.installments.reduce((a, i) => {
    const s = st.states.find((x) => x.number === i.number);
    return a + Math.round((i.interest * Math.min(s.paid, i.amount)) / i.amount) + (s.lateFeePaid || 0);
  }, 0) : 0;

  view.innerHTML = `<div class="page-head" style="margin-bottom:18px"><a href="#/clients" class="note">${C.icon('back', 14)} ${C.esc(C.t('Clientes'))}</a></div>
    <section class="card card-pad"><div class="client-head">
      <span class="avatar">${C.esc(C.initials(C.fullName(client)))}</span>
      <div class="meta"><h1 style="font-size:24px">${C.esc(C.fullName(client))}</h1>
        <p>${C.esc(client.code)} · ${C.esc(client.phone || '')}${client.phone2 ? ' · ' + C.esc(client.phone2) : ''}${client.email ? ' · ' + C.esc(client.email) : ''}</p>
        <p>${C.esc([client.address, client.city].filter(Boolean).join(', '))}</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${client.phone ? `<a class="btn btn-sm" href="https://wa.me/${client.phone.replace(/\D/g, '')}" target="_blank" rel="noopener">${C.icon('chat', 16)}WhatsApp</a><a class="btn btn-sm" href="tel:${C.esc(client.phone)}">${C.icon('phone', 16)}${C.esc(C.t('Llamar'))}</a>` : ''}
        ${client.email ? `<a class="btn btn-sm" href="mailto:${C.esc(client.email)}">${C.icon('mail', 16)}${C.esc(C.t('Correo'))}</a>` : ''}
        ${C.can('client.edit') ? `<button class="btn btn-sm" id="c-edit">${C.icon('edit', 16)}${C.esc(C.t('Editar'))}</button>` : ''}
        ${C.can('loan.create') ? `<button class="btn btn-sm" id="c-newloan">${C.icon('plus', 16)}${C.esc(C.t('Nuevo préstamo'))}</button>` : ''}
      </div></div>
      ${loans.length > 1 ? `<div class="seg" style="margin-top:16px" role="group">${loans.map((l) => `<button data-loan="${l.id}" aria-pressed="${l.id === loan.id}">${C.esc(l.contract)} · ${C.esc(C.t(l.status === 'active' ? 'Activo' : 'Finalizado'))}</button>`).join('')}</div>` : ''}
    </section>
    ${loan ? `<section class="section" style="display:grid;grid-template-columns:auto minmax(0,1fr);gap:16px;align-items:stretch">
      <div class="card card-pad progress-ring" style="position:relative;min-width:180px">${C.ui.ring(progress, 124, 9)}<div style="position:absolute;text-align:center"><div class="num" style="font:600 22px var(--font-text)">${Math.round(progress * 100)}%</div><div class="overline" style="font-size:9px">${C.esc(C.t('pagado'))}</div></div></div>
      <div class="stats">${[
        [C.t('Capital invertido'), C.money(loan.terms.principal, cur)], [C.t('Intereses pactados'), C.money(loan.totalInterest, cur)], [C.t('Total a recibir'), C.money(loan.totalPayable, cur)],
        [C.t('Recaudado'), C.money(st.summary.paidTotal, cur)], [C.t('Saldo pendiente'), C.money(st.summary.balance, cur)], [C.t('Utilidad realizada'), C.money(realized, cur)],
        [C.t('Tasa efectiva anual'), C.pct(loan.ea)], [C.t('Próxima cuota'), st.summary.next ? C.money(st.summary.next.outstanding, cur) : '—', st.summary.next ? C.fmtDate(st.summary.next.dueDate, { weekday: 'short', day: 'numeric', month: 'short' }) : ''],
        [C.t('Días de mora'), String(st.summary.daysPastDue)], [C.t('Estado'), null],
      ].map(([k, x, sub]) => `<div class="card stat"><div class="overline">${C.esc(k)}</div><div class="v num">${x === null ? C.chip(status) : C.esc(x)}</div>${sub ? `<div class="s">${C.esc(sub)}</div>` : ''}</div>`).join('')}</div></section>
    <section class="section" style="display:flex;gap:10px;flex-wrap:wrap">
      ${C.can('payment.register') && status !== 'closed' ? `<button class="btn btn-primary" id="c-pay">${C.icon('cash', 18)}${C.esc(C.t('Registrar pago'))}</button>` : ''}
      ${C.can('payment.register') && status !== 'closed' ? `<button class="btn" id="c-upload">${C.icon('upload', 18)}${C.esc(C.t('Subir comprobante'))}</button>` : ''}
      ${C.can('message.send') && status !== 'closed' ? `<button class="btn" id="c-remind">${C.icon('chat', 18)}${C.esc(C.t('Enviar recordatorio'))}</button>` : ''}
      <button class="btn" id="c-statement">${C.icon('file', 18)}${C.esc(C.t('Estado de cuenta'))}</button>
      <button class="btn" id="c-plan">${C.icon('download', 18)}${C.esc(C.t('Plan de pagos PDF'))}</button>
    </section>` : `<div class="empty card section">${C.esc(C.t('Este cliente no tiene préstamos.'))}</div>`}
    <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${ui.tab === k}">${C.esc(C.t(l))}${k === 'docs' ? ` <span class="muted">${docsN}</span>` : ''}</button>`).join('')}</div>
    <div id="c-tab"></div>`;

  const tabBox = C.$('#c-tab');
  const renderTab = () => {
    const fn = C.clientTabs[ui.tab];
    fn(tabBox, client, loan, st);
  };
  C.$$('[data-tab]', view).forEach((b) => (b.onclick = () => {
    ui.tab = b.dataset.tab;
    C.$$('[data-tab]', view).forEach((x) => x.setAttribute('aria-selected', x === b));
    renderTab();
  }));
  C.$$('[data-loan]', view).forEach((b) => (b.onclick = () => {
    ui.loanId = b.dataset.loan;
    C.views.client(view, id);
  }));
  const on = (sel, fn) => {
    const el = C.$(sel, view);
    if (el) el.onclick = fn;
  };
  on('#c-edit', () => C.ui.editClient(client));
  on('#c-newloan', () => C.ui.newLoan(client));
  on('#c-pay', () => C.ui.paymentDialog(loan));
  on('#c-upload', () => C.ui.uploadDialog({ clientId: client.id }));
  on('#c-remind', async () => {
    const m = await C.msg.enqueueEvent(st.summary.overdueCount ? 'overdue' : 'reminder', loan, { dedupeKey: `manual:${loan.id}:${C.nowLocal()}` });
    if (m && m.status === 'ready') await C.msg.send(m);
    else C.msg.feedback(m);
    C.render();
  });
  on('#c-statement', async () => {
    const doc = await C.docs.issueStatement(loan);
    C.ui.viewDoc(doc);
    if (C.state.settings.messages.statement && C.can('message.send')) await C.msg.enqueueEvent('statement', loan, { doc, channel: 'email' });
  });
  on('#c-plan', async () => {
    const doc = C.state.documents.find((d) => d.key === `schedule:${loan.id}` && !d.superseded) || (await C.docs.refreshPlan(loan));
    C.ui.viewDoc(doc);
  });
  renderTab();
};

C.clientTabs = {
  summary(box, client, loan, st) {
    if (!loan) return (box.innerHTML = '');
    const cur = loan.terms.currency;
    const upcoming = st.states.filter((s) => s.paid < s.amount).slice(0, 5);
    const pays = st.payments.slice().reverse().slice(0, 6);
    box.innerHTML = `<div class="dash-grid" style="margin-top:0">
      <article class="card"><div class="card-head"><h3>${C.esc(C.t('Próximas cuotas'))}</h3></div><div class="list" style="margin-top:6px">
        ${upcoming.map((s) => `<div class="li"><div class="grow"><div class="row-title">${C.esc(C.t('Cuota {n}', { n: s.number }))}</div><div class="row-sub">${C.esc(C.fmtDate(s.dueDate, { weekday: 'long', day: 'numeric', month: 'long' }))}</div></div>${C.chip(C.instStatus(s))}<span class="amt">${C.esc(C.money(s.amount - s.paid, cur))}</span></div>`).join('') || `<div class="empty">${C.icon('check', 24)}<div>${C.esc(C.t('Sin cuotas pendientes.'))}</div></div>`}
      </div></article>
      <article class="card"><div class="card-head"><h3>${C.esc(C.t('Últimos pagos'))}</h3></div><div class="list" style="margin-top:6px">
        ${pays.map((p) => `<div class="li">${C.icon(p.auto ? 'sparkle' : 'cash', 18, 'gold')}<div class="grow"><div class="row-title num">${C.esc(C.money(p.amount, cur))}</div><div class="row-sub">${C.esc(C.fmtDate(p.date))} · ${C.esc(p.receiptNo || '')}${p.auto ? ' · ' + C.esc(C.t('registrado automáticamente')) : ''}</div></div>${p.receiptDocId ? `<button class="btn btn-sm" data-doc="${p.receiptDocId}">${C.icon('receipt', 16)}${C.esc(C.t('Recibo'))}</button>` : ''}</div>`).join('') || `<div class="empty">${C.esc(C.t('Aún no hay pagos.'))}</div>`}
      </div></article></div>
      <article class="card card-pad section"><div class="overline">${C.esc(C.t('Condiciones'))}</div><p style="margin:10px 0 0">${C.esc(C.t('{n} cuotas {f} de {v} · {m} · tasa {r} · desembolso {d}', {
        n: loan.installments.length, f: C.freqText(loan.terms.frequency).toLowerCase(), v: C.money(loan.regularInstallment, cur), m: C.t(loan.terms.method === 'simple' ? 'Interés simple fijo' : 'Cuota fija (francés)'),
        r: C.pct(Number(loan.terms.rate)), d: C.fmtDate(loan.terms.disbursementDate),
      }))}${loan.lateFee ? ' · ' + C.esc(C.t('mora configurada')) : ''}</p>
      ${client.consents && (client.consents.whatsapp || client.consents.email) ? `<p class="note" style="margin-top:8px">${C.esc(C.t('Canales autorizados'))}: ${C.esc([client.consents.whatsapp ? 'WhatsApp' : '', client.consents.email ? C.t('Correo') : ''].filter(Boolean).join(', '))}</p>` : `<p class="flag warning" style="margin-top:10px">${C.icon('alert', 16)}<span>${C.esc(C.t('Sin autorización de mensajes: COROC no enviará mensajes a este cliente.'))}</span></p>`}</article>`;
    C.$$('[data-doc]', box).forEach((b) => (b.onclick = () => C.ui.viewDoc(C.state.documents.find((d) => d.id === b.dataset.doc))));
  },

  schedule(box, client, loan, st) {
    if (!loan) return (box.innerHTML = '');
    const cur = loan.terms.currency;
    const payInfo = {};
    for (const p of st.payments) for (const l of (st.allocations[p.id] || { lines: [] }).lines) if (l.toInstallment > 0 || l.toLateFee > 0) (payInfo[l.number] ||= []).push(p);
    box.innerHTML = `<div class="card"><div class="card-head"><h3>${C.esc(C.t('Plan de pagos definido al crear el préstamo'))}</h3><div style="display:flex;gap:8px"><button class="btn btn-sm" id="sch-csv">${C.icon('download', 16)}CSV</button><button class="btn btn-sm" id="sch-pdf">${C.icon('download', 16)}PDF</button></div></div>
      <div class="table-wrap" style="margin-top:12px"><table class="t"><thead><tr><th>${C.esc(C.t('N.º'))}</th><th>${C.esc(C.t('Vence'))}</th><th class="r">${C.esc(C.t('Cuota'))}</th><th class="r">${C.esc(C.t('Capital'))}</th><th class="r">${C.esc(C.t('Interés'))}</th><th class="r">${C.esc(C.t('Pagado'))}</th><th>${C.esc(C.t('Fecha de pago'))}</th><th>${C.esc(C.t('Estado'))}</th><th>${C.esc(C.t('Soporte'))}</th><th>${C.esc(C.t('Recibo'))}</th><th class="r">${C.esc(C.t('Saldo'))}</th></tr></thead><tbody>
      ${loan.installments.map((i) => {
        const s = st.states.find((x) => x.number === i.number);
        const ps = payInfo[i.number] || [];
        const last = ps[ps.length - 1];
        return `<tr><td>${i.number}</td><td>${C.esc(C.fmtDate(i.dueDate, { weekday: 'short', day: 'numeric', month: 'short' }))}</td><td class="r">${C.esc(C.money(i.amount, cur))}</td><td class="r">${C.esc(C.money(i.principal, cur))}</td><td class="r">${C.esc(C.money(i.interest, cur))}</td>
          <td class="r">${C.esc(C.money(s.paid, cur))}${s.lateFeePaid ? `<div class="row-sub">+ ${C.esc(C.money(s.lateFeePaid, cur))} ${C.esc(C.t('mora'))}</div>` : ''}</td><td>${last ? C.esc(C.fmtDate(last.date, { day: 'numeric', month: 'short' })) : '—'}</td><td>${C.chip(C.instStatus(s))}</td>
          <td>${ps.filter((p) => p.docId).map((p) => `<button class="icon-btn" data-doc="${p.docId}" title="${C.esc(C.t('Ver comprobante'))}" aria-label="${C.esc(C.t('Ver comprobante'))}">${C.icon('file', 16)}</button>`).join('')}</td>
          <td>${ps.filter((p) => p.receiptDocId).map((p) => `<button class="icon-btn" data-doc="${p.receiptDocId}" title="${C.esc(p.receiptNo)}" aria-label="${C.esc(p.receiptNo)}">${C.icon('receipt', 16)}</button>`).join('')}</td>
          <td class="r">${C.esc(C.money(i.balanceAfter, cur))}</td></tr>`;
      }).join('')}</tbody></table></div></div>`;
    C.$$('[data-doc]', box).forEach((b) => (b.onclick = () => C.ui.viewDoc(C.state.documents.find((d) => d.id === b.dataset.doc))));
    C.$('#sch-pdf', box).onclick = async () => C.ui.viewDoc(C.state.documents.find((d) => d.key === `schedule:${loan.id}` && !d.superseded) || (await C.docs.refreshPlan(loan)));
    C.$('#sch-csv', box).onclick = () => C.download(C.toCSV(
      [C.t('N.º'), C.t('Vence'), C.t('Cuota'), C.t('Capital'), C.t('Interés'), C.t('Pagado'), C.t('Estado'), C.t('Saldo')],
      loan.installments.map((i) => {
        const s = st.states.find((x) => x.number === i.number);
        return [i.number, i.dueDate, Core.fromMinor(i.amount, cur).toString(), Core.fromMinor(i.principal, cur).toString(), Core.fromMinor(i.interest, cur).toString(), Core.fromMinor(s.paid, cur).toString(), C.t(C.STATUS_CHIP[C.instStatus(s)][1]), Core.fromMinor(i.balanceAfter, cur).toString()];
      }),
    ), `${C.t('Cuadro_de_pagos')}_${loan.contract}.csv`);
  },

  docs(box, client) {
    const docs = C.docs.of(client.id);
    const lang = C.companyLang();
    const groups = C.SUBFOLDERS[lang].map((name, idx) => ({ name, items: docs.filter((d) => (C.KIND_FOLDER[d.kind] ?? 4) === idx) }));
    box.innerHTML = `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <button class="btn btn-sm" id="d-up">${C.icon('upload', 16)}${C.esc(C.t('Agregar documento'))}</button>
        <span class="note" style="align-self:center">${C.esc(C.fs.status === 'connected' ? C.t('Sincronizado con la carpeta COROC › {f}', { f: client.folderName }) : C.t('Repositorio del cliente en COROC'))}</span></div>
      ${groups.map((g) => `<article class="card" style="margin-bottom:14px"><div class="card-head"><h3>${C.icon('folder', 18, 'gold')}${C.esc(g.name)}</h3><span class="note">${g.items.length}</span></div>
        <div class="list" style="margin-top:6px">${g.items.map((d) => `<button class="li" style="border:0;border-top:1px solid var(--line-2);background:none;width:100%;text-align:left;cursor:pointer" data-doc="${d.id}">${C.icon(d.kind === 'receipt_out' ? 'receipt' : 'file', 18, 'gold')}<div class="grow"><div class="row-title" style="font-weight:500;word-break:break-all">${C.esc(d.name)}</div><div class="row-sub">${C.esc(C.fmtDateTime(d.createdAt))} · ${Math.max(1, Math.round(d.size / 1024))} KB${d.version > 1 ? ' · v' + d.version : ''}${d.voided ? ' · ' + C.esc(C.t('ANULADO')) : ''}</div></div>${C.icon('eye', 18)}</button>`).join('') || `<div class="li note">${C.esc(C.t('Sin documentos'))}</div>`}</div></article>`).join('')}`;
    C.$$('[data-doc]', box).forEach((b) => (b.onclick = () => C.ui.viewDoc(C.state.documents.find((d) => d.id === b.dataset.doc))));
    C.$('#d-up', box).onclick = () => C.ui.uploadDialog({ clientId: client.id, allowOther: true });
  },

  msgs(box, client, loan) {
    const list = C.state.messages.filter((m) => m.clientId === client.id);
    const label = { ready: 'Listo para enviar', scheduled: 'Programado', sent: 'Enviado', blocked: 'Bloqueado por regla', cancelled: 'Cancelado' };
    const chipCls = { ready: 'warn', scheduled: 'info', sent: 'ok', blocked: 'err', cancelled: '' };
    box.innerHTML = `${loan && C.can('message.send') ? `<div style="margin-bottom:14px"><button class="btn btn-sm" id="m-new">${C.icon('plus', 16)}${C.esc(C.t('Nuevo mensaje'))}</button></div>` : ''}
      <div class="card"><div class="list">${list.map((m) => `<div class="li" style="align-items:flex-start"><div class="grow"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><strong>${C.esc(C.t(C.EVENT_LABEL[m.event]))}</strong><span class="chip ${chipCls[m.status]}">${C.esc(C.t(label[m.status]))}</span><span class="note">${C.esc(m.channel === 'email' ? C.t('Correo') : 'WhatsApp')} · ${C.esc(C.fmtDateTime(m.sentAt || m.scheduledAt || m.requestedAt))}</span></div>
        <div class="bubble" style="margin-top:8px"></div>${m.status === 'blocked' || m.status === 'scheduled' ? `<div class="note" style="margin-top:6px">${C.esc(C.msg.reasonText(m.decision))}</div>` : ''}</div>
        ${['ready', 'scheduled'].includes(m.status) && C.can('message.send') ? `<button class="btn btn-sm btn-primary" data-send="${m.id}">${C.esc(C.t('Enviar'))}</button>` : ''}</div>`).join('') || `<div class="empty">${C.icon('chat', 26)}<div>${C.esc(C.t('Sin mensajes.'))}</div></div>`}</div></div>`;
    C.$$('.bubble', box).forEach((b, i) => (b.textContent = list[i].text));
    C.$$('[data-send]', box).forEach((b) => (b.onclick = async () => {
      await C.msg.send(C.state.messages.find((m) => m.id === b.dataset.send));
      C.clientTabs.msgs(box, client, loan);
    }));
    const nb = C.$('#m-new', box);
    if (nb) nb.onclick = () => C.ui.composeDialog(client, loan);
  },

  history(box, client, loan) {
    const rows = [];
    for (const l of C.loansOf(client.id)) {
      const reversed = new Set(l.ledger.filter((e) => e.type === 'reversal').map((e) => e.reverses));
      for (const e of l.ledger) rows.push({ l, e, reversed: reversed.has(e.id) });
    }
    rows.sort((a, b) => (a.e.at < b.e.at ? 1 : -1));
    const typeLabel = { disbursement: 'Desembolso', payment: 'Pago', reversal: 'Reverso' };
    box.innerHTML = `<div class="card table-wrap"><table class="t"><thead><tr><th>${C.esc(C.t('Fecha'))}</th><th>${C.esc(C.t('Movimiento'))}</th><th>${C.esc(C.t('Contrato'))}</th><th>${C.esc(C.t('Detalle'))}</th><th class="r">${C.esc(C.t('Valor'))}</th><th></th></tr></thead><tbody>
      ${rows.map(({ l, e, reversed }) => `<tr><td>${C.esc(C.fmtDateTime(e.at))}</td><td>${C.esc(C.t(typeLabel[e.type]))}${e.auto ? ` <span class="chip info plain">${C.esc(C.t('automático'))}</span>` : ''}${reversed ? ` <span class="chip err plain">${C.esc(C.t('reversado'))}</span>` : ''}</td><td>${C.esc(l.contract)}</td>
        <td class="row-sub">${C.esc([e.receiptNo, e.reference, e.method, e.reason].filter(Boolean).join(' · '))}</td><td class="r">${C.esc(C.money(e.amount, l.terms.currency))}</td>
        <td>${e.type === 'payment' && !reversed && C.can('payment.reverse') ? `<button class="btn btn-sm btn-ghost" data-rev="${l.id}|${e.id}">${C.icon('undo', 16)}${C.esc(C.t('Reversar'))}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
    C.$$('[data-rev]', box).forEach((b) => (b.onclick = async () => {
      const [lid, eid] = b.dataset.rev.split('|');
      const reason = await C.prompt(C.t('Reversar pago'), C.t('Motivo del reverso (queda en la bitácora)'), { okText: C.t('Reversar') });
      if (reason === null) return;
      try {
        await C.reversePayment(lid, eid, reason);
        C.toast(C.t('Pago reversado. El recibo quedó marcado como ANULADO.'), 'success');
        C.render();
      } catch (e) {
        C.toast(e.message, 'error');
      }
    }));
  },
};
C.EVENT_LABEL = { welcome: 'Bienvenida y plan de pagos', reminder: 'Recordatorio de cuota', overdue: 'Cuota vencida', receipt: 'Pago recibido y recibo', statement: 'Estado de cuenta', payoff: 'Paz y salvo' };

/* ───────────── Diálogos ───────────── */
C.ui.viewDoc = async (doc) => {
  if (!doc) return;
  const blob = await C.docs.blob(doc.id);
  const url = URL.createObjectURL(blob);
  const isImg = (doc.mime || '').startsWith('image/');
  const isPdf = doc.mime === 'application/pdf';
  await C.modal({
    title: doc.name, wide: true,
    render: (body) => {
      body.innerHTML = `<div class="preview">${isImg ? `<img src="${url}" alt="">` : isPdf ? `<iframe src="${url}" title="${C.esc(doc.name)}"></iframe>` : `<div class="empty">${C.icon('file', 30)}</div>`}</div>
        <div class="actions"><button class="btn" id="dv-dl">${C.icon('download', 16)}${C.esc(C.t('Descargar'))}</button>${navigator.canShare ? `<button class="btn btn-primary" id="dv-sh">${C.icon('share', 16)}${C.esc(C.t('Compartir'))}</button>` : ''}</div>`;
      C.$('#dv-dl', body).onclick = () => C.download(blob, doc.name);
      const sh = C.$('#dv-sh', body);
      if (sh) sh.onclick = async () => {
        const f = new File([blob], doc.name, { type: doc.mime });
        if (navigator.canShare({ files: [f] })) await navigator.share({ files: [f], title: doc.name }).catch(() => {});
        else C.download(blob, doc.name);
      };
    },
  });
  URL.revokeObjectURL(url);
};

C.ui.paymentDialog = (loan) => {
  const st = C.loanState(loan);
  const cur = loan.terms.currency;
  const client = C.clientById(loan.clientId);
  return C.modal({
    title: C.t('Registrar pago · {c}', { c: loan.contract }),
    render: (body, close) => {
      body.innerHTML = `<div class="grid g2">
        <label class="field"><span>${C.esc(C.t('Valor pagado'))} (${cur})</span><input name="amount" inputmode="decimal" autofocus value="${C.esc(st.summary.next ? C.money(st.summary.next.outstanding, cur).replace(/[^\d.,]/g, '') : '')}"></label>
        <label class="field"><span>${C.esc(C.t('Fecha del pago'))}</span><input name="date" type="date" value="${C.today()}" max="${C.today()}"></label>
        <label class="field"><span>${C.esc(C.t('Medio'))}</span><select name="method">${['Efectivo', 'Transferencia', 'Nequi', 'Daviplata', 'Bre-B', 'PIX', 'Zelle', 'Consignación', 'Otro'].map((x) => `<option>${C.esc(C.t(x))}</option>`).join('')}</select></label>
        <label class="field"><span>${C.esc(C.t('Referencia'))}</span><input name="reference"></label>
        <label class="field spanall"><span>${C.esc(C.t('Nota'))}</span><input name="note"></label></div>
        <div id="pay-prev" class="section"></div><div class="flags" id="pay-err"></div>
        <div class="actions"><button class="btn btn-ghost" data-x>${C.esc(C.t('Cancelar'))}</button><button class="btn btn-primary" data-ok>${C.icon('check', 18)}${C.esc(C.t('Registrar y emitir recibo'))}</button></div>`;
      const q = (n) => body.querySelector(`[name="${n}"]`);
      const prev = () => {
        const amt = C.parseMoney(q('amount').value, cur);
        const box = C.$('#pay-prev', body);
        if (!amt || amt <= 0) return (box.innerHTML = '');
        const r = Core.allocatePayment(st.states, amt);
        const after = Core.summarize(r.after, C.today());
        box.innerHTML = `<div class="impact"><div><div class="overline">${C.esc(C.t('Saldo actual'))}</div><div class="num">${C.esc(C.money(st.summary.balance, cur))}</div></div>${C.icon('arrow', 20, 'gold')}<div><div class="overline">${C.esc(C.t('Nuevo saldo'))}</div><div class="num gold">${C.esc(C.money(after.balance, cur))}</div></div></div>
          <p class="note" style="margin-top:10px">${C.esc(Core.describeCoverage(r.lines, cur, C.lang()))}${r.surplus ? ' · ' + C.esc(C.t('Saldo a favor: {x}', { x: C.money(r.surplus, cur) })) : ''}</p>`;
      };
      q('amount').oninput = prev;
      prev();
      body.querySelector('[data-x]').onclick = () => close(false);
      body.querySelector('[data-ok]').onclick = async (ev) => {
        const amt = C.parseMoney(q('amount').value, cur);
        ev.target.disabled = true;
        try {
          const { entry, receipt } = await C.registerPayment(loan.id, { amount: amt, date: q('date').value, method: q('method').value, reference: q('reference').value.trim(), note: q('note').value.trim(), source: q('method').value === C.t('Efectivo') ? 'cash' : 'manual' });
          close(true);
          C.toast(C.t('Pago de {x} registrado. Recibo {r} emitido.', { x: C.money(amt, cur), r: entry.receiptNo }), 'success');
          C.render();
          const m = C.state.messages.find((x) => x.dedupeKey && x.dedupeKey.includes(entry.id));
          const act = await C.ui.afterPayment(receipt.doc, m, client);
          return act;
        } catch (e) {
          ev.target.disabled = false;
          C.$('#pay-err', body).innerHTML = `<div class="flag">${C.icon('alert', 16)}<span>${C.esc(e.message)}</span></div>`;
        }
      };
    },
  });
};

C.ui.afterPayment = (doc, m, client) =>
  C.modal({
    title: C.t('Recibo emitido'),
    render: (body, close) => {
      body.innerHTML = `<p class="lead">${C.esc(C.t('El recibo quedó guardado en el repositorio de {n}.', { n: C.fullName(client) }))}</p>
        ${m ? `<p class="note">${C.esc(m.status === 'ready' ? C.t('El mensaje de agradecimiento está listo para enviarse.') : C.t('Mensaje programado por las reglas de contacto: {r}', { r: C.msg.reasonText(m.decision) }))}</p>` : `<p class="note">${C.esc(C.t('El cliente no tiene canales autorizados; comparta el recibo manualmente si lo desea.'))}</p>`}
        <div class="actions"><button class="btn" data-v>${C.icon('eye', 16)}${C.esc(C.t('Ver recibo'))}</button>${m && m.status === 'ready' ? `<button class="btn btn-primary" data-s>${C.icon('share', 16)}${C.esc(C.t('Enviar al cliente'))}</button>` : ''}</div>`;
      body.querySelector('[data-v]').onclick = () => {
        close();
        C.ui.viewDoc(doc);
      };
      const s = body.querySelector('[data-s]');
      if (s) s.onclick = async () => {
        await C.msg.send(m);
        close();
        C.render();
      };
    },
  });

C.ui.uploadDialog = ({ clientId, allowOther } = {}) =>
  C.modal({
    title: C.t('Subir comprobante o documento'),
    render: (body, close) => {
      body.innerHTML = `<div class="drop" id="up-drop">${C.icon('upload', 28, 'gold')}<p>${C.esc(C.t('Arrastre aquí imágenes o PDF, o'))} <label style="color:var(--gold-text);cursor:pointer;text-decoration:underline">${C.esc(C.t('elija archivos'))}<input type="file" id="up-in" multiple accept="image/*,application/pdf" hidden></label></p>
        <p class="note">${C.esc(C.t('COROC lee el comprobante, identifica el valor, la fecha y los nombres, y lo registra o lo deja en la bandeja para su revisión.'))}</p></div>
        ${allowOther ? `<label class="check" style="margin-top:14px"><input type="checkbox" id="up-other"><span>${C.esc(C.t('No es un comprobante de pago (guardar en «Otros documentos»)'))}</span></label>` : ''}`;
      const handle = async (files) => {
        close(true);
        const other = allowOther && C.$('#up-other', body) && C.$('#up-other', body).checked;
        for (const f of files) {
          if (other) {
            const client = C.clientById(clientId);
            const loan = C.loansOf(clientId)[0];
            await C.docs.save({ clientId, loanId: loan ? loan.id : null, kind: 'other', name: `${C.docs.fileStamp()}_${f.name}`, source: 'upload', mime: f.type }, f);
            await C.audit('document.added', 'client', client.id, { name: f.name });
          } else {
            C.toast(C.t('Leyendo {f}…', { f: f.name }));
            const item = await C.intake.receive(f, { source: 'upload', clientId });
            C.ui.intakeToast(item);
          }
        }
        C.render();
      };
      C.$('#up-in', body).onchange = (e) => handle([...e.target.files]);
      const drop = C.$('#up-drop', body);
      drop.ondragover = (e) => {
        e.preventDefault();
        drop.classList.add('over');
      };
      drop.ondragleave = () => drop.classList.remove('over');
      drop.ondrop = (e) => {
        e.preventDefault();
        handle([...e.dataTransfer.files]);
      };
    },
  });

C.ui.intakeToast = (item) => {
  const map = { applied_auto: ['success', 'Comprobante leído y pago registrado automáticamente.'], review: ['info', 'Comprobante en la bandeja para su revisión.'], unassigned: ['info', 'Comprobante sin cliente identificado: revíselo en la bandeja.'], duplicate: ['error', 'Este comprobante ya estaba registrado (duplicado).'] };
  const [k, msg] = map[item.status] || ['info', 'Comprobante recibido.'];
  C.toast(C.t(msg), k, 6000);
};

C.ui.editClient = (client) =>
  C.modal({
    title: C.t('Editar cliente'), wide: true,
    render: (body, close) => {
      body.innerHTML = `${C.ui.personFields(client)}<h3 class="section" style="margin-bottom:12px">${C.esc(C.t('Canales y consentimientos'))}</h3>${C.ui.consentFields(client)}<div class="flags" id="ec-err"></div>
        <div class="actions"><button class="btn btn-ghost" data-x>${C.esc(C.t('Cancelar'))}</button><button class="btn btn-primary" data-ok>${C.esc(C.t('Guardar cambios'))}</button></div>`;
      body.querySelector('[data-x]').onclick = () => close(false);
      body.querySelector('[data-ok]').onclick = async () => {
        const { errs, data } = C.ui.readPerson(body, client);
        if (errs.length) return (C.$('#ec-err', body).innerHTML = errs.map((e) => `<div class="flag">${C.icon('alert', 16)}<span>${C.esc(e)}</span></div>`).join(''));
        const oldFolder = client.folderName;
        Object.assign(client, data, C.ui.readConsents(body, client));
        await C.saveClient(client, false);
        await C.fs.renameClientFolder(client, oldFolder);
        close(true);
        C.toast(C.t('Cliente actualizado.'), 'success');
        C.render();
      };
    },
  });

C.ui.newLoan = (client) =>
  C.modal({
    title: C.t('Nuevo préstamo para {n}', { n: C.fullName(client) }), wide: true,
    render: (body, close) => {
      body.innerHTML = `<div id="nl-form"></div><div class="flags" id="nl-err"></div><div class="actions"><button class="btn btn-ghost" data-x>${C.esc(C.t('Cancelar'))}</button><button class="btn btn-primary" data-ok>${C.esc(C.t('Crear préstamo'))}</button></div>`;
      const form = C.ui.loanForm(C.$('#nl-form', body));
      body.querySelector('[data-x]').onclick = () => close(false);
      body.querySelector('[data-ok]').onclick = async (ev) => {
        try {
          ev.target.disabled = true;
          const out = form.get();
          const loan = await C.createLoan(client, out.terms, { contract: out.contract, lateFee: out.lateFee, expectedMethod: out.expectedMethod });
          C.state.clientUi.loanId = loan.id;
          close(true);
          C.toast(C.t('Préstamo {c} creado.', { c: loan.contract }), 'success');
          C.render();
        } catch (e) {
          ev.target.disabled = false;
          C.$('#nl-err', body).innerHTML = `<div class="flag">${C.icon('alert', 16)}<span>${C.esc(e.message)}</span></div>`;
        }
      };
    },
  });

C.ui.composeDialog = (client, loan) =>
  C.modal({
    title: C.t('Nuevo mensaje'),
    render: (body, close) => {
      const lang = client.lang || C.companyLang();
      body.innerHTML = `<div class="grid g2"><label class="field"><span>${C.esc(C.t('Plantilla'))}</span><select name="ev">${['reminder', 'overdue', 'statement', 'welcome'].map((e) => `<option value="${e}">${C.esc(C.t(C.EVENT_LABEL[e]))}</option>`).join('')}</select></label>
        <label class="field"><span>${C.esc(C.t('Canal'))}</span><select name="ch">${client.consents && client.consents.whatsapp ? '<option value="whatsapp">WhatsApp</option>' : ''}${client.consents && client.consents.email && client.email ? `<option value="email">${C.esc(C.t('Correo'))}</option>` : ''}</select></label>
        <label class="field spanall"><span>${C.esc(C.t('Mensaje'))}</span><textarea name="text"></textarea></label></div><div class="flags" id="cm-err"></div>
        <div class="actions"><button class="btn btn-ghost" data-x>${C.esc(C.t('Cancelar'))}</button><button class="btn btn-primary" data-ok>${C.esc(C.t('Enviar'))}</button></div>`;
      const q = (n) => body.querySelector(`[name="${n}"]`);
      const fillText = () => (q('text').value = C.msg.render(C.msg.template(q('ev').value, lang), C.msg.vars(loan, client)));
      q('ev').onchange = fillText;
      fillText();
      body.querySelector('[data-x]').onclick = () => close(false);
      body.querySelector('[data-ok]').onclick = async () => {
        const issues = C.validateTemplate(q('text').value);
        if (!q('ch').value) return (C.$('#cm-err', body).innerHTML = `<div class="flag">${C.icon('alert', 16)}<span>${C.esc(C.t('El cliente no tiene autorizado ningún canal de mensajes.'))}</span></div>`);
        if (issues.length) return (C.$('#cm-err', body).innerHTML = issues.map((i) => `<div class="flag">${C.icon('alert', 16)}<span>${C.esc(C.t('Contenido no permitido: {x}', { x: i }))}</span></div>`).join(''));
        const m = await C.msg.enqueueEvent(q('ev').value, loan, { channel: q('ch').value, dedupeKey: `manual:${loan.id}:${Date.now()}` });
        if (!m) return;
        m.text = q('text').value;
        await C.db.put('messages', m);
        close(true);
        if (m.status === 'ready') await C.msg.send(m);
        else C.msg.feedback(m);
        C.render();
      };
    },
  });
