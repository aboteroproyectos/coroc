/* COROC · bandeja de validación (§13.6) */
C.FLAG_TEXT = {
  MISSING_FIELD: 'Falta un dato obligatorio', LOW_CONFIDENCE: 'Lectura con baja confianza', RECEIVER_MISMATCH: 'El pago no se hizo a tus cuentas',
  PAYER_MISMATCH: 'El pagador no coincide con el cliente (pago de tercero)', PAYER_INFERRED: 'El comprobante no muestra el pagador; se asume el cliente remitente',
  FUTURE_DATE: 'La fecha del comprobante es futura', BEFORE_DISBURSEMENT: 'La fecha es anterior al desembolso', TOO_OLD: 'El comprobante es demasiado antiguo',
  NON_POSITIVE_AMOUNT: 'Valor no válido', CURRENCY_MISMATCH: 'La moneda no coincide con la del préstamo', TAMPER_SIGNAL: 'Posible alteración del documento',
  NOT_A_RECEIPT: 'No parece un comprobante de pago', OCR_UNAVAILABLE: 'No se pudo leer el documento automáticamente; digite los datos',
};
C.FIELD_TEXT = { receiverName: 'Nombre de quien recibe', payerName: 'Nombre de quien paga', amount: 'Valor pagado', date: 'Fecha del pago' };
C.INBOX_STATUS = {
  processing: ['info', 'Leyendo'], review: ['warn', 'Por revisar'], unassigned: ['warn', 'Sin asignar'], applied_auto: ['ok', 'Registrado automáticamente'],
  approved: ['ok', 'Aprobado'], duplicate: ['err', 'Duplicado'], rejected: ['err', 'Rechazado'], archived: ['', 'No es comprobante'],
};
C.inboxChip = (s) => {
  const [cls, l] = C.INBOX_STATUS[s] || ['', s];
  return `<span class="chip ${cls}">${C.esc(C.t(l))}</span>`;
};
C.confChip = (c) => `<span class="conf ${c >= 0.95 ? 'hi' : c >= 0.8 ? 'mid' : 'lo'}">${Math.round((c || 0) * 100)}%</span>`;

C.views.inbox = (view) => {
  const ui = (C.state.inboxUi ||= { tab: 'pending' });
  const vis = new Set(C.visibleClients().map((c) => c.id));
  const all = C.state.inbox.filter((i) => C.can('data.all') || !i.clientId || vis.has(i.clientId));
  const tabs = {
    pending: all.filter((i) => ['review', 'unassigned', 'processing'].includes(i.status)),
    auto: all.filter((i) => i.status === 'applied_auto'),
    approved: all.filter((i) => i.status === 'approved'),
    other: all.filter((i) => ['duplicate', 'rejected', 'archived'].includes(i.status)),
    all,
  };
  const labels = { pending: 'Por revisar', auto: 'Registrados automáticamente', approved: 'Aprobados', other: 'Duplicados y descartados', all: 'Todos' };
  const list = tabs[ui.tab];
  view.innerHTML = `<div class="page-head"><div><h1>${C.esc(C.t('Bandeja de validación'))}</h1><p>${C.esc(C.t('COROC lee cada comprobante, identifica al cliente y registra el pago. Aquí usted supervisa y corrige.'))}</p></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">${C.fs.status === 'connected' ? `<button class="btn" id="ib-scan">${C.icon('scan', 18)}${C.esc(C.t('Revisar carpeta COROC'))}</button>` : ''}</div></div>
    ${C.can('inbox.validate') ? `<section class="drop" id="ib-drop">${C.icon('upload', 28, 'gold')}
      <p style="margin:8px 0 4px"><strong>${C.esc(C.t('Recibir comprobantes'))}</strong> · ${C.esc(C.t('Arrastre aquí imágenes o PDF, o'))} <label style="color:var(--gold-text);cursor:pointer;text-decoration:underline">${C.esc(C.t('elija archivos'))}<input type="file" id="ib-in" multiple accept="image/*,application/pdf" hidden></label></p>
      <div class="grid g2" style="max-width:640px;margin:14px auto 0;text-align:left">
        <label class="field"><span>${C.esc(C.t('Número de WhatsApp que lo envió (opcional)'))}</span><input id="ib-phone" type="tel" placeholder="+57 300 123 4567"></label>
        <label class="field"><span>${C.esc(C.t('Correo que lo envió (opcional)'))}</span><input id="ib-email" type="email"></label></div>
      <p class="note" style="margin-top:10px">${C.esc(C.t('Con el número o el correo, COROC identifica al cliente automáticamente. Sin ellos, lo sugiere por el nombre del pagador y el valor.'))}</p></section>` : ''}
    <div class="tabs" role="tablist">${Object.keys(tabs).map((k) => `<button role="tab" data-tab="${k}" aria-selected="${ui.tab === k}">${C.esc(C.t(labels[k]))} <span class="muted">${tabs[k].length}</span></button>`).join('')}</div>
    <div class="card">${list.length ? `<div class="list">${list.map((i) => {
      const c = i.clientId ? C.clientById(i.clientId) : null;
      const ex = i.extraction;
      const blocking = i.validation ? i.validation.flags.filter((f) => f.severity === 'blocking').length : 0;
      return `<button class="li" data-item="${i.id}" style="border:0;border-top:1px solid var(--line-2);background:none;width:100%;text-align:left;cursor:pointer">
        ${C.icon(i.mime === 'application/pdf' ? 'file' : 'receipt', 22, 'gold')}
        <div class="grow"><div class="row-title">${c ? C.esc(C.fullName(c)) : `<span class="muted">${C.esc(C.t('Cliente sin identificar'))}</span>`}</div>
        <div class="row-sub">${C.esc(i.fileName)} · ${C.esc(C.fmtDateTime(i.createdAt))}${ex && ex.entity && ex.entity.value ? ' · ' + C.esc(ex.entity.value) : ''}${blocking ? ` · <span style="color:var(--err)">${C.esc(C.tp('{n} alerta', '{n} alertas', blocking))}</span>` : ''}</div>
        ${i.status === 'processing' ? `<div class="progress" style="margin-top:6px;max-width:240px"><i style="width:${i.progress || 5}%" data-prog="${i.id}"></i></div>` : ''}</div>
        <span class="amt">${ex && ex.amount && ex.amount.value ? C.esc(C.money(ex.amount.value)) : '—'}</span>${C.inboxChip(i.status)}</button>`;
    }).join('')}</div>` : `<div class="empty">${C.icon('inbox', 30)}<div>${C.esc(ui.tab === 'pending' ? C.t('Nada por revisar. COROC registró todo lo que pudo leer con certeza.') : C.t('Sin elementos.'))}</div></div>`}</div>`;

  C.$$('[data-tab]', view).forEach((b) => (b.onclick = () => {
    ui.tab = b.dataset.tab;
    C.views.inbox(view);
  }));
  C.$$('[data-item]', view).forEach((b) => (b.onclick = () => C.ui.reviewItem(C.state.inbox.find((i) => i.id === b.dataset.item))));
  const scan = C.$('#ib-scan', view);
  if (scan) scan.onclick = async () => {
    scan.disabled = true;
    const n = await C.fs.scan();
    C.toast(n ? C.tp('{n} archivo nuevo procesado desde la carpeta COROC.', '{n} archivos nuevos procesados desde la carpeta COROC.', n) : C.t('No hay archivos nuevos en la carpeta COROC.'), n ? 'success' : 'info');
    C.render();
  };
  const drop = C.$('#ib-drop', view);
  if (!drop) return;
  const handle = async (files) => {
    const phoneRaw = C.$('#ib-phone').value.trim();
    const phone = phoneRaw ? C.normalizePhoneOrNull(phoneRaw) : null;
    if (phoneRaw && !phone) return C.toast(C.t('El número de WhatsApp no es válido.'), 'error');
    const email = C.$('#ib-email').value.trim().toLowerCase() || null;
    ui.tab = 'pending';
    const jobs = files.map((f) => C.intake.receive(f, { source: phone ? 'whatsapp' : email ? 'email' : 'upload', phone, email }));
    C.views.inbox(view);
    for (const j of jobs) C.ui.intakeToast(await j);
    C.render();
  };
  C.$('#ib-in', view).onchange = (e) => handle([...e.target.files]);
  drop.ondragover = (e) => {
    e.preventDefault();
    drop.classList.add('over');
  };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    handle([...e.dataTransfer.files]);
  };
};

C.on('inbox-progress', (item) => {
  const bar = document.querySelector(`[data-prog="${item.id}"]`);
  if (bar) bar.style.width = `${Math.max(5, item.progress || 0)}%`;
});

C.ui.reviewItem = async (item) => {
  if (!item) return;
  const blob = item.docId ? await C.docs.blob(item.docId) : null;
  const url = blob ? URL.createObjectURL(blob) : '';
  const ex = item.extraction || { receiverName: {}, payerName: {}, amount: {}, date: {}, reference: {}, entity: {}, documentType: {} };
  const editable = ['review', 'unassigned'].includes(item.status) && C.can('inbox.validate');
  const clients = C.visibleClients().slice().sort((a, b) => C.fullName(a).localeCompare(C.fullName(b)));
  const cands = (item.identification && item.identification.candidates) || [];
  await C.modal({
    title: `${C.t('Comprobante')} · ${item.fileName}`, wide: true,
    render: (body, close) => {
      const f = (k) => (ex[k] && ex[k].value) || '';
      const cf = (k) => (ex[k] ? C.confChip(ex[k].confidence) : '');
      body.innerHTML = `<div class="review">
        <div class="preview">${blob ? (item.mime === 'application/pdf' ? `<iframe src="${url}" title="PDF"></iframe>` : `<img src="${url}" alt="">`) : ''}</div>
        <div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${C.inboxChip(item.status)}<span class="note">${C.esc(C.t('Canal'))}: ${C.esc(C.t({ whatsapp: 'WhatsApp', email: 'Correo', upload: 'Carga manual', folder: 'Carpeta COROC' }[item.source] || item.source))}${item.senderPhone ? ' · ' + C.esc(item.senderPhone) : ''}${item.senderEmail ? ' · ' + C.esc(item.senderEmail) : ''}</span></div>
          <div class="flags">${(item.validation ? item.validation.flags : []).map((fl) => `<div class="flag ${fl.severity === 'warning' ? 'warning' : ''}">${C.icon('alert', 16)}<span>${C.esc(C.t(C.FLAG_TEXT[fl.code] || fl.code))}${fl.field ? ' · ' + C.esc(C.t(C.FIELD_TEXT[fl.field] || fl.field)) : ''}</span></div>`).join('')}
            ${item.status === 'duplicate' ? `<div class="flag">${C.icon('alert', 16)}<span>${C.esc(C.t('Este comprobante ya había sido registrado. No se aplicó de nuevo.'))}</span></div>` : ''}</div>
          <div class="grid g2">
            <label class="field"><span>${C.esc(C.t('Valor pagado'))} ${cf('amount')}</span><input name="amount" inputmode="decimal" value="${f('amount') ? C.esc(C.money(f('amount')).replace(/[^\d.,]/g, '')) : ''}" ${editable ? '' : 'disabled'}></label>
            <label class="field"><span>${C.esc(C.t('Fecha del pago'))} ${cf('date')}</span><input name="date" type="date" value="${C.esc(f('date'))}" max="${C.today()}" ${editable ? '' : 'disabled'}></label>
            <label class="field"><span>${C.esc(C.t('Nombre de quien paga'))} ${cf('payerName')}</span><input name="payerName" value="${C.esc(f('payerName'))}" ${editable ? '' : 'disabled'}></label>
            <label class="field"><span>${C.esc(C.t('Nombre de quien recibe'))} ${cf('receiverName')}</span><input name="receiverName" value="${C.esc(f('receiverName'))}" ${editable ? '' : 'disabled'}></label>
            <label class="field"><span>${C.esc(C.t('Referencia'))}</span><input name="reference" value="${C.esc(f('reference'))}" ${editable ? '' : 'disabled'}></label>
            <label class="field"><span>${C.esc(C.t('Entidad'))}</span><input name="entity" value="${C.esc(f('entity'))}" ${editable ? '' : 'disabled'}></label>
            <label class="field"><span>${C.esc(C.t('Cliente'))}</span><select name="clientId" ${editable ? '' : 'disabled'}><option value="">${C.esc(C.t('Seleccione…'))}</option>
              ${cands.length ? `<optgroup label="${C.esc(C.t('Sugeridos'))}">${cands.map((cd) => C.clientById(cd.clientId)).filter(Boolean).map((c) => `<option value="${c.id}" ${item.clientId === c.id ? 'selected' : ''}>${C.esc(C.fullName(c))} · ${C.esc(c.code)}</option>`).join('')}</optgroup>` : ''}
              <optgroup label="${C.esc(C.t('Todos'))}">${clients.map((c) => `<option value="${c.id}" ${item.clientId === c.id && !cands.some((cd) => cd.clientId === c.id) ? 'selected' : ''}>${C.esc(C.fullName(c))} · ${C.esc(c.code)}</option>`).join('')}</optgroup></select></label>
            <label class="field"><span>${C.esc(C.t('Préstamo'))}</span><select name="loanId" ${editable ? '' : 'disabled'}></select></label>
          </div>
          <label class="check section" id="rv-save" hidden><input type="checkbox" name="savePhone" checked><span></span></label>
          <div id="rv-impact" class="section"></div><div class="flags" id="rv-err"></div>
          ${item.text ? `<details class="section"><summary class="note" style="cursor:pointer">${C.esc(C.t('Texto leído del documento'))}</summary><pre style="white-space:pre-wrap;font-size:12px;background:var(--surface-2);padding:12px;border-radius:10px;max-height:200px;overflow:auto"></pre></details>` : ''}
          <div class="actions">
            ${editable ? `<button class="btn btn-ghost" data-a="reject">${C.esc(C.t('Rechazar'))}</button><button class="btn btn-ghost" data-a="archive">${C.esc(C.t('No es comprobante'))}</button><button class="btn btn-primary" data-a="approve">${C.icon('check', 18)}${C.esc(C.t('Aprobar y registrar'))}</button>` : ''}
            ${item.status === 'applied_auto' && C.can('inbox.validate') ? `<button class="btn" data-a="revert">${C.icon('undo', 16)}${C.esc(C.t('Revertir registro automático'))}</button>` : ''}
            ${item.entryId ? `<button class="btn btn-primary" data-a="receipt">${C.icon('receipt', 16)}${C.esc(C.t('Ver recibo'))}</button>` : ''}
          </div></div></div>`;
      const pre = body.querySelector('pre');
      if (pre) pre.textContent = item.text;
      const q = (n) => body.querySelector(`[name="${n}"]`);
      const fillLoans = () => {
        const cid = q('clientId').value;
        const loans = cid ? C.loansOf(cid).filter((l) => l.status === 'active' || l.id === item.loanId) : [];
        q('loanId').innerHTML = loans.map((l) => `<option value="${l.id}" ${l.id === item.loanId ? 'selected' : ''}>${C.esc(l.contract)} · ${C.esc(C.money(C.loanState(l).summary.balance, l.terms.currency))}</option>`).join('') || `<option value="">—</option>`;
        impact();
      };
      const impact = () => {
        const box = C.$('#rv-impact', body);
        const loan = q('loanId').value ? C.loanById(q('loanId').value) : null;
        const amt = C.parseMoney(q('amount').value);
        if (!loan || !amt || !editable) return (box.innerHTML = '');
        const st = C.loanState(loan);
        const r = Core.allocatePayment(st.states, amt);
        const after = Core.summarize(r.after, C.today());
        box.innerHTML = `<div class="impact"><div><div class="overline">${C.esc(C.t('Saldo actual'))}</div><div class="num">${C.esc(C.money(st.summary.balance, loan.terms.currency))}</div></div>${C.icon('arrow', 20, 'gold')}<div><div class="overline">${C.esc(C.t('Nuevo saldo'))}</div><div class="num gold">${C.esc(C.money(after.balance, loan.terms.currency))}</div></div></div>
          <p class="note" style="margin-top:8px">${C.esc(Core.describeCoverage(r.lines, loan.terms.currency, C.lang()))}</p>`;
      };
      const offerPhone = () => {
        const box = C.$('#rv-save', body);
        const c = q('clientId').value ? C.clientById(q('clientId').value) : null;
        const show = editable && item.senderPhone && c && c.phone !== item.senderPhone && c.phone2 !== item.senderPhone && C.can('client.edit');
        box.hidden = !show;
        if (show) box.querySelector('span').textContent = C.t(c.phone2 ? 'Reemplazar el número secundario de {name} por {phone}' : 'Guardar {phone} como número secundario de {name}', { phone: item.senderPhone, name: C.fullName(c) });
      };
      q('clientId').onchange = () => {
        item.loanId = null;
        fillLoans();
        offerPhone();
      };
      q('loanId').onchange = impact;
      q('amount').oninput = impact;
      fillLoans();
      offerPhone();
      const err = (m) => (C.$('#rv-err', body).innerHTML = `<div class="flag">${C.icon('alert', 16)}<span>${C.esc(m)}</span></div>`);
      C.$$('[data-a]', body).forEach((b) => (b.onclick = async () => {
        const a = b.dataset.a;
        try {
          b.disabled = true;
          if (a === 'approve') {
            const amount = C.parseMoney(q('amount').value);
            if (!q('date').value) throw new Error(C.t('Indique la fecha del pago.'));
            if (q('date').value > C.today()) throw new Error(C.t('La fecha del comprobante es futura'));
            await C.intake.apply(item, { fields: { amount, date: q('date').value, clientId: q('clientId').value, loanId: q('loanId').value, payerName: q('payerName').value.trim(), receiverName: q('receiverName').value.trim(), reference: q('reference').value.trim(), entity: q('entity').value.trim() } });
            if (!C.$('#rv-save', body).hidden && q('savePhone').checked) {
              const c = C.clientById(q('clientId').value);
              c.phone2 = item.senderPhone;
              await C.saveClient(c, false);
              await C.audit('client.phone_learned', 'client', c.id, { source: 'inbox' });
            }
            C.toast(C.t('Pago registrado y recibo emitido.'), 'success');
          } else if (a === 'reject') {
            const reason = await C.prompt(C.t('Rechazar comprobante'), C.t('Motivo'), { okText: C.t('Rechazar') });
            if (reason === null) return (b.disabled = false);
            await C.intake.setStatus(item, 'rejected', reason);
          } else if (a === 'archive') {
            await C.intake.setStatus(item, 'archived');
          } else if (a === 'revert') {
            await C.intake.revertAuto(item);
            C.toast(C.t('Registro revertido. El comprobante volvió a revisión.'), 'success');
          } else if (a === 'receipt') {
            const loan = C.loanById(item.loanId);
            const e = loan.ledger.find((x) => x.id === item.entryId);
            close(true);
            return C.ui.viewDoc(C.state.documents.find((d) => d.id === e.receiptDocId));
          }
          close(true);
          C.render();
        } catch (ex2) {
          b.disabled = false;
          err(ex2.message);
        }
      }));
      body.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && editable && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'SELECT') {
          e.preventDefault();
          body.querySelector('[data-a="approve"]').click();
        }
      });
    },
  });
  if (url) URL.revokeObjectURL(url);
};
