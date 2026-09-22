/* COROC · informes (§18): PDF con marca y CSV para contabilidad */
C.views.reports = async (view) => {
  if (!C.can('reports.view')) return C.go('dashboard');
  const today = C.today();
  const from30 = Core.addDays(today, -30);
  const cards = [
    { id: 'portfolio', icon: 'chart', title: 'Cartera total', desc: 'Todos los préstamos con capital, recaudo, saldo, próxima cuota y días de mora.', pdf: true, csv: true },
    { id: 'collections', icon: 'cash', title: 'Recaudo por período', desc: 'Pagos recibidos entre dos fechas, con recibo y medio.', pdf: true, csv: true, period: true },
    { id: 'aging', icon: 'alert', title: 'Mora por edades', desc: 'Cartera vencida agrupada en 1–7, 8–30 y más de 30 días.', pdf: true },
    { id: 'closed', icon: 'check', title: 'Préstamos finalizados y utilidad', desc: 'Préstamos pagados en su totalidad y la utilidad obtenida.', pdf: true, csv: true },
    { id: 'cashflow', icon: 'today', title: 'Proyección de flujo de caja', desc: 'Cuotas por cobrar en las próximas 8 semanas.', pdf: true, csv: true },
    { id: 'ledger', icon: 'file', title: 'Libro de movimientos', desc: 'Desembolsos, pagos y reversos para la contabilidad.', csv: true },
    { id: 'messages', icon: 'chat', title: 'Bitácora de mensajes y cumplimiento', desc: 'Cada mensaje con su decisión de las reglas de contacto.', csv: true },
    ...(C.can('audit.view') ? [{ id: 'audit', icon: 'shield', title: 'Bitácora de auditoría', desc: 'Quién hizo qué y cuándo.', csv: true }] : []),
  ];
  view.innerHTML = `<div class="page-head"><div><h1>${C.esc(C.t('Informes'))}</h1><p>${C.esc(C.t('Se descargan y, si la carpeta está conectada, se guardan en COROC › _Informes.'))}</p></div></div>
    <div class="grid g2">${cards.map((c) => `<article class="card card-pad"><div style="display:flex;gap:12px;align-items:flex-start">${C.icon(c.icon, 24, 'gold')}<div class="grow"><h3>${C.esc(C.t(c.title))}</h3><p class="muted" style="margin:6px 0 0">${C.esc(C.t(c.desc))}</p></div></div>
      ${c.period ? `<div class="grid g2" style="margin-top:14px"><label class="field"><span>${C.esc(C.t('Desde'))}</span><input type="date" id="rp-from" value="${from30}"></label><label class="field"><span>${C.esc(C.t('Hasta'))}</span><input type="date" id="rp-to" value="${today}"></label></div>` : ''}
      <div class="actions" style="margin-top:14px">${c.csv ? `<button class="btn btn-sm" data-r="${c.id}" data-f="csv">${C.icon('download', 16)}CSV</button>` : ''}${c.pdf ? `<button class="btn btn-sm btn-primary" data-r="${c.id}" data-f="pdf">${C.icon('download', 16)}PDF</button>` : ''}</div></article>`).join('')}</div>`;
  C.$$('[data-r]', view).forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try {
      const out = await C.reports.build(b.dataset.r, b.dataset.f, { from: (C.$('#rp-from') || {}).value || from30, to: (C.$('#rp-to') || {}).value || today });
      C.download(out.blob, out.name);
      if (C.fs.status === 'connected') await C.fs.write([C.ROOTFOLDERS[C.companyLang()].reports], out.name, out.blob);
      await C.audit('report.generated', 'report', b.dataset.r, { format: b.dataset.f });
    } catch (e) {
      C.toast(e.message, 'error');
    }
    b.disabled = false;
  }));
};

C.reports = {
  async build(id, fmt, { from, to }) {
    const lang = C.lang();
    const cur = C.currency();
    const M = (v, c) => C.money(v, c || cur);
    const N = (v, c) => Core.fromMinor(v, c || cur).toString();
    const stamp = C.today();
    const name = (base) => `${stamp}_${C.t(base)}.${fmt}`;
    const statusText = (s) => C.t(C.STATUS_CHIP[s][1]);
    if (id === 'portfolio') {
      const rows = C.metrics.portfolioRows().sort((a, b) => b.daysPastDue - a.daysPastDue);
      const head = [C.t('Cliente'), C.t('Código'), C.t('Contrato'), C.t('Frecuencia'), C.t('Capital'), C.t('Total pactado'), C.t('Recaudado'), C.t('Saldo'), C.t('Cuotas restantes'), C.t('Próxima cuota'), C.t('Días de mora'), C.t('Estado')];
      if (fmt === 'csv') return { name: name('Cartera'), blob: C.toCSV(head, rows.map((r) => [r.client, r.code, r.contract, C.freqText(r.frequency), N(r.principal, r.currency), N(r.totalPayable, r.currency), N(r.paid, r.currency), N(r.balance, r.currency), r.remaining, r.next, r.daysPastDue, statusText(r.status)])) };
      const tot = rows.reduce((s, r) => s + r.balance, 0);
      return { name: name('Cartera'), blob: await C.pdf.report(C.t('Cartera total'), `${C.t('Corte')} ${C.fmtDate(stamp)} · ${C.tp('{n} préstamo', '{n} préstamos', rows.length)} · ${C.t('Saldo')} ${M(tot)}`, [
        { h: C.t('Cliente'), w: 40, get: (r) => r.client }, { h: C.t('Contrato'), w: 18, get: (r) => r.contract }, { h: C.t('Frecuencia'), w: 14, get: (r) => C.freqText(r.frequency) },
        { h: C.t('Capital'), w: 20, align: 'right', get: (r) => M(r.principal, r.currency) }, { h: C.t('Recaudado'), w: 20, align: 'right', get: (r) => M(r.paid, r.currency) },
        { h: C.t('Saldo'), w: 20, align: 'right', get: (r) => M(r.balance, r.currency) }, { h: C.t('Próxima cuota'), w: 18, get: (r) => (r.next ? C.fmtDate(r.next, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—') },
        { h: C.t('Mora'), w: 10, align: 'right', get: (r) => r.daysPastDue }, { h: C.t('Estado'), w: 14, get: (r) => statusText(r.status) },
      ], rows, lang) };
    }
    if (id === 'collections') {
      if (from > to) throw new Error(C.t('La fecha inicial es posterior a la final.'));
      const rows = C.metrics.collectionsRows(from, to);
      const valid = rows.filter((r) => !r.reversed);
      const total = valid.reduce((s, r) => s + r.amount, 0);
      const head = [C.t('Fecha'), C.t('Cliente'), C.t('Contrato'), C.t('Recibo'), C.t('Medio'), C.t('Valor'), C.t('Estado')];
      const st = (r) => (r.reversed ? C.t('Reversado') : r.auto ? C.t('Automático') : C.t('Aplicado'));
      if (fmt === 'csv') return { name: name('Recaudo'), blob: C.toCSV(head, rows.map((r) => [r.date, r.client, r.contract, r.receipt, r.method, N(r.amount, r.currency), st(r)])) };
      return { name: name('Recaudo'), blob: await C.pdf.report(C.t('Recaudo por período'), `${C.fmtDate(from)} – ${C.fmtDate(to)} · ${C.t('Total')} ${M(total)}`, [
        { h: C.t('Fecha'), w: 16, get: (r) => C.fmtDate(r.date, { day: '2-digit', month: '2-digit', year: 'numeric' }) }, { h: C.t('Cliente'), w: 40, get: (r) => r.client }, { h: C.t('Contrato'), w: 18, get: (r) => r.contract },
        { h: C.t('Recibo'), w: 18, get: (r) => r.receipt }, { h: C.t('Medio'), w: 20, get: (r) => r.method }, { h: C.t('Valor'), w: 20, align: 'right', get: (r) => M(r.amount, r.currency) }, { h: C.t('Estado'), w: 16, get: st },
      ], rows, lang) };
    }
    if (id === 'aging') {
      const rows = C.metrics.portfolioRows().filter((r) => r.daysPastDue > 0).sort((a, b) => b.daysPastDue - a.daysPastDue);
      const bucket = (d) => (d <= 7 ? '1–7' : d <= 30 ? '8–30' : '> 30');
      return { name: name('Mora_por_edades'), blob: await C.pdf.report(C.t('Mora por edades'), `${C.t('Corte')} ${C.fmtDate(stamp)} · ${C.tp('{n} préstamo en mora', '{n} préstamos en mora', rows.length)}`, [
        { h: C.t('Edad (días)'), w: 14, get: (r) => bucket(r.daysPastDue) }, { h: C.t('Cliente'), w: 42, get: (r) => r.client }, { h: C.t('Contrato'), w: 18, get: (r) => r.contract },
        { h: C.t('Días de mora'), w: 14, align: 'right', get: (r) => r.daysPastDue }, { h: C.t('Saldo'), w: 22, align: 'right', get: (r) => M(r.balance, r.currency) },
      ], rows, lang) };
    }
    if (id === 'closed') {
      const rows = C.metrics.portfolioRows().filter((r) => r.status === 'closed').map((r) => ({ ...r, profit: r.paid - r.principal }));
      const head = [C.t('Cliente'), C.t('Contrato'), C.t('Capital'), C.t('Recaudado'), C.t('Utilidad')];
      if (fmt === 'csv') return { name: name('Prestamos_finalizados'), blob: C.toCSV(head, rows.map((r) => [r.client, r.contract, N(r.principal, r.currency), N(r.paid, r.currency), N(r.profit, r.currency)])) };
      return { name: name('Prestamos_finalizados'), blob: await C.pdf.report(C.t('Préstamos finalizados y utilidad'), `${C.t('Utilidad total')} ${M(rows.reduce((s, r) => s + r.profit, 0))}`, [
        { h: C.t('Cliente'), w: 44, get: (r) => r.client }, { h: C.t('Contrato'), w: 18, get: (r) => r.contract }, { h: C.t('Capital'), w: 22, align: 'right', get: (r) => M(r.principal, r.currency) },
        { h: C.t('Recaudado'), w: 22, align: 'right', get: (r) => M(r.paid, r.currency) }, { h: C.t('Utilidad'), w: 22, align: 'right', get: (r) => M(r.profit, r.currency) },
      ], rows, lang) };
    }
    if (id === 'cashflow') {
      const weeks = [];
      const start = Core.addDays(today, 1 - Core.isoWeekday(today));
      for (let w = 0; w < 8; w++) weeks.push({ from: Core.addDays(start, w * 7), to: Core.addDays(start, w * 7 + 6), amount: 0, n: 0 });
      let overdue = 0;
      for (const loan of C.visibleLoans()) {
        const st = C.loanState(loan);
        for (const s of st.states) {
          const out = s.amount - s.paid;
          if (out <= 0) continue;
          if (s.dueDate < today) overdue += out;
          const wk = weeks.find((w) => s.dueDate >= w.from && s.dueDate <= w.to);
          if (wk) {
            wk.amount += out;
            wk.n++;
          }
        }
      }
      const head = [C.t('Semana'), C.t('Desde'), C.t('Hasta'), C.t('Cuotas'), C.t('Valor esperado')];
      if (fmt === 'csv') return { name: name('Flujo_de_caja'), blob: C.toCSV(head, weeks.map((w, i) => [i + 1, w.from, w.to, w.n, N(w.amount)])) };
      return { name: name('Flujo_de_caja'), blob: await C.pdf.report(C.t('Proyección de flujo de caja'), `${C.t('Próximas 8 semanas')} · ${C.t('Vencido no incluido')} ${M(overdue)}`, [
        { h: C.t('Semana'), w: 12, get: (w) => weeks.indexOf(w) + 1 }, { h: C.t('Desde'), w: 22, get: (w) => C.fmtDate(w.from) }, { h: C.t('Hasta'), w: 22, get: (w) => C.fmtDate(w.to) },
        { h: C.t('Cuotas'), w: 14, align: 'right', get: (w) => w.n }, { h: C.t('Valor esperado'), w: 28, align: 'right', get: (w) => M(w.amount) },
      ], weeks, lang) };
    }
    if (id === 'ledger') {
      const t = { disbursement: C.t('Desembolso'), payment: C.t('Pago'), reversal: C.t('Reverso') };
      return { name: name('Libro_de_movimientos'), blob: C.toCSV([C.t('Registrado'), C.t('Fecha'), C.t('Movimiento'), C.t('Contrato'), C.t('Cliente'), C.t('Valor'), C.t('Recibo'), C.t('Referencia'), C.t('Motivo'), C.t('Usuario')],
        C.metrics.ledgerRows().map((r) => [r.at, r.date, t[r.type], r.contract, r.client, N(r.amount), r.receipt, r.reference, r.reason, r.user])) };
    }
    if (id === 'messages') {
      const vis = new Set(C.visibleClients().map((c) => c.id));
      return { name: name('Bitacora_de_mensajes'), blob: C.toCSV([C.t('Creado'), C.t('Cliente'), C.t('Evento'), C.t('Tipo'), C.t('Canal'), C.t('Estado'), C.t('Decisión'), C.t('Motivo'), C.t('Programado para'), C.t('Enviado')],
        C.state.messages.filter((m) => vis.has(m.clientId)).map((m) => [m.createdAt, C.fullName(C.clientById(m.clientId)), C.t(C.EVENT_LABEL[m.event]), C.t(m.kind === 'collection' ? 'Cobranza' : 'Transaccional'), m.channel, m.status, m.decision ? m.decision.decision : '', C.msg.reasonText(m.decision), m.scheduledAt || '', m.sentAt || ''])) };
    }
    if (id === 'audit') {
      const rows = (await C.db.all('audit')).sort((a, b) => a.ts - b.ts);
      return { name: name('Bitacora_de_auditoria'), blob: C.toCSV([C.t('Fecha'), C.t('Usuario'), C.t('Acción'), C.t('Entidad'), C.t('Detalle')], rows.map((r) => [r.at, r.username, r.action, `${r.entity}:${r.entityId}`, JSON.stringify(r.detail)])) };
    }
    throw new Error(C.t('Informe desconocido'));
  },
};
