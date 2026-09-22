/* COROC · mensajería (§11): cola asistida, plantillas y estado de canales */
C.msg.feedback = (m) => {
  if (!m) return C.toast(C.t('El cliente no tiene autorizado ningún canal de mensajes.'), 'error');
  if (m.status === 'blocked') return C.toast(`${C.t('Bloqueado por las reglas de contacto')}: ${C.msg.reasonText(m.decision)}`, 'error', 7000);
  if (m.status === 'scheduled') return C.toast(`${C.t('Programado por las reglas de contacto')}: ${C.msg.reasonText(m.decision)} → ${C.fmtDateTime(m.scheduledAt)}`, 'info', 7000);
  return null;
};

C.views.messages = (view) => {
  const ui = (C.state.msgUi ||= { tab: 'due' });
  const vis = new Set(C.visibleClients().map((c) => c.id));
  const mine = C.state.messages.filter((m) => vis.has(m.clientId));
  const now = C.nowLocal();
  const groups = {
    due: C.msg.due(),
    scheduled: mine.filter((m) => m.status === 'scheduled' && m.scheduledAt > now),
    blocked: mine.filter((m) => m.status === 'blocked'),
    sent: mine.filter((m) => m.status === 'sent'),
    templates: [],
    channels: [],
  };
  const labels = { due: 'Por enviar ahora', scheduled: 'Programados', blocked: 'Bloqueados por regla', sent: 'Enviados', templates: 'Plantillas', channels: 'Canales' };
  const tabsAllowed = Object.keys(labels).filter((k) => !['templates', 'channels'].includes(k) || C.can('settings.edit'));
  view.innerHTML = `<div class="page-head"><div><h1>${C.esc(C.t('Mensajería'))}</h1><p>${C.esc(C.t('Modo asistido: COROC redacta y programa cada mensaje respetando las reglas de contacto; usted solo confirma el envío.'))}</p></div>
    ${ui.tab === 'due' && groups.due.length && C.can('message.send') ? `<button class="btn btn-primary" id="mq-next">${C.icon('share', 18)}${C.esc(C.t('Enviar siguiente'))} (${groups.due.length})</button>` : ''}</div>
    <div class="tabs" role="tablist">${tabsAllowed.map((k) => `<button role="tab" data-tab="${k}" aria-selected="${ui.tab === k}">${C.esc(C.t(labels[k]))}${groups[k].length ? ` <span class="muted">${groups[k].length}</span>` : ''}</button>`).join('')}</div>
    <div id="mq-body"></div>`;
  C.$$('[data-tab]', view).forEach((b) => (b.onclick = () => {
    ui.tab = b.dataset.tab;
    C.views.messages(view);
  }));
  const box = C.$('#mq-body', view);
  if (ui.tab === 'templates') return C.ui.templatesEditor(box);
  if (ui.tab === 'channels') return C.ui.channelsPanel(box);
  const list = groups[ui.tab].slice(0, 300);
  box.innerHTML = `<div class="card">${list.length ? `<div class="list">${list.map((m) => {
    const c = C.clientById(m.clientId);
    const l = C.loanById(m.loanId);
    return `<div class="li" style="align-items:flex-start"><span class="avatar">${C.esc(C.initials(C.fullName(c)))}</span><div class="grow">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><a href="#/client/${c.id}" class="row-title" style="color:inherit;text-decoration:none">${C.esc(C.fullName(c))}</a><span class="note">${C.esc(l ? l.contract : '')} · ${C.esc(C.t(C.EVENT_LABEL[m.event]))} · ${C.esc(m.channel === 'email' ? C.t('Correo') : 'WhatsApp')}${m.attachmentDocId ? ' · PDF' : ''}</span></div>
      <div class="bubble" style="margin-top:8px" data-text="${m.id}"></div>
      <div class="note" style="margin-top:6px">${C.esc(m.status === 'sent' ? `${C.t('Enviado')} ${C.fmtDateTime(m.sentAt)} · ${m.sentBy || ''}` : m.status === 'scheduled' ? `${C.t('Programado para')} ${C.fmtDateTime(m.scheduledAt)} · ${C.msg.reasonText(m.decision)}` : m.status === 'blocked' ? C.msg.reasonText(m.decision) : C.t('Listo para enviar'))}</div></div>
      <div style="display:flex;gap:6px;flex-direction:column">${['ready', 'scheduled'].includes(m.status) && C.can('message.send') ? `<button class="btn btn-sm btn-primary" data-send="${m.id}">${C.esc(C.t('Enviar'))}</button>` : ''}
      ${['ready', 'scheduled', 'blocked'].includes(m.status) && C.can('message.send') ? `<button class="btn btn-sm btn-ghost" data-cancel="${m.id}">${C.esc(C.t('Descartar'))}</button>` : ''}</div></div>`;
  }).join('')}</div>` : `<div class="empty">${C.icon('chat', 30)}<div>${C.esc(ui.tab === 'due' ? C.t('No hay mensajes pendientes por enviar.') : C.t('Sin elementos.'))}</div></div>`}</div>`;
  C.$$('[data-text]', box).forEach((b) => (b.textContent = C.state.messages.find((m) => m.id === b.dataset.text).text));
  const find = (id) => C.state.messages.find((m) => m.id === id);
  C.$$('[data-send]', box).forEach((b) => (b.onclick = async () => {
    await C.msg.send(find(b.dataset.send));
    C.views.messages(view);
    C.refreshBadges();
  }));
  C.$$('[data-cancel]', box).forEach((b) => (b.onclick = async () => {
    await C.msg.cancel(find(b.dataset.cancel));
    C.views.messages(view);
    C.refreshBadges();
  }));
  const next = C.$('#mq-next', view);
  if (next) next.onclick = async () => {
    const m = C.msg.due()[0];
    if (m) await C.msg.send(m);
    C.views.messages(view);
    C.refreshBadges();
  };
};

C.ui.templatesEditor = (box) => {
  const ui = (C.state.tplUi ||= { event: 'reminder', lang: C.companyLang() });
  const text = C.msg.template(ui.event, ui.lang);
  const sampleClient = C.visibleClients()[0];
  const sampleLoan = sampleClient ? C.loansOf(sampleClient.id)[0] : null;
  box.innerHTML = `<div class="dash-grid" style="margin-top:0"><article class="card card-pad">
    <div class="grid g2"><label class="field"><span>${C.esc(C.t('Evento'))}</span><select id="tp-ev">${C.EVENTS.map((e) => `<option value="${e}" ${ui.event === e ? 'selected' : ''}>${C.esc(C.t(C.EVENT_LABEL[e]))}</option>`).join('')}</select></label>
    <label class="field"><span>${C.esc(C.t('Idioma'))}</span><select id="tp-lang">${C.LANGS.map((l) => `<option value="${l.code}" ${ui.lang === l.code ? 'selected' : ''}>${C.esc(l.label)}</option>`).join('')}</select></label>
    <label class="field spanall"><span>${C.esc(C.t('Plantilla'))}</span><textarea id="tp-text" style="min-height:160px"></textarea></label></div>
    <p class="note">${C.esc(C.t('Variables'))}: ${C.TEMPLATE_VARS.map((v) => `<code>{{${v}}}</code>`).join(' ')}</p>
    <label class="check" style="margin-top:10px"><input type="checkbox" id="tp-on" ${C.state.settings.messages[ui.event] ? 'checked' : ''}><span>${C.esc(C.t('Enviar este mensaje automáticamente'))}</span></label>
    <div class="flags" id="tp-err"></div>
    <div class="actions"><button class="btn btn-ghost" id="tp-reset">${C.esc(C.t('Restaurar texto original'))}</button><button class="btn btn-primary" id="tp-save">${C.esc(C.t('Guardar plantilla'))}</button></div></article>
    <article class="card card-pad"><div class="overline">${C.esc(C.t('Vista previa'))}</div><div class="bubble" id="tp-prev" style="margin-top:12px"></div>
    <p class="note" style="margin-top:12px">${C.esc(sampleClient ? C.t('Con datos de {n}.', { n: C.fullName(sampleClient) }) : C.t('Cree un cliente para ver la vista previa con datos reales.'))} ${C.esc(C.t('Caracteres'))}: <span id="tp-count" class="num"></span></p></article></div>`;
  const ta = C.$('#tp-text', box);
  ta.value = text;
  const upd = () => {
    const out = sampleClient && sampleLoan ? C.msg.render(ta.value, C.msg.vars(sampleLoan, sampleClient)) : ta.value;
    C.$('#tp-prev', box).textContent = out;
    C.$('#tp-count', box).textContent = out.length;
    const issues = C.validateTemplate(ta.value);
    C.$('#tp-err', box).innerHTML = issues.map((i) => `<div class="flag">${C.icon('alert', 16)}<span>${C.esc(C.t('Contenido no permitido: {x}', { x: i }))}</span></div>`).join('');
    C.$('#tp-save', box).disabled = issues.length > 0;
  };
  ta.oninput = upd;
  upd();
  C.$('#tp-ev', box).onchange = (e) => {
    ui.event = e.target.value;
    C.ui.templatesEditor(box);
  };
  C.$('#tp-lang', box).onchange = (e) => {
    ui.lang = e.target.value;
    C.ui.templatesEditor(box);
  };
  C.$('#tp-reset', box).onclick = () => {
    ta.value = C.DEFAULT_TEMPLATES[ui.event][ui.lang];
    upd();
  };
  C.$('#tp-save', box).onclick = async () => {
    const t = (C.state.templates ||= {});
    (t[ui.event] ||= {})[ui.lang] = ta.value;
    await C.db.kvSet('templates', t);
    await C.saveSettings({ messages: { ...C.state.settings.messages, [ui.event]: C.$('#tp-on', box).checked } });
    await C.audit('template.saved', 'template', ui.event, { lang: ui.lang });
    C.toast(C.t('Plantilla guardada.'), 'success');
  };
};

C.ui.channelsPanel = (box) => {
  const S = C.state.settings;
  box.innerHTML = `<div class="dash-grid" style="margin-top:0">
    <article class="card card-pad"><div style="display:flex;gap:10px;align-items:center">${C.icon('chat', 22, 'gold')}<h3>${C.esc(C.t('WhatsApp · modo asistido'))}</h3><span class="chip ok">${C.esc(C.t('Activo'))}</span></div>
      <p class="muted">${C.esc(C.t('COROC abre WhatsApp con el mensaje escrito para cada cliente; usted confirma el envío. Los recibos se comparten como PDF desde la hoja de compartir del sistema.'))}</p>
      <label class="check" style="margin-top:12px"><input type="checkbox" id="ch-tx" ${S.transactionalImmediate ? 'checked' : ''}><span>${C.esc(C.t('Enviar recibos y paz y salvo de inmediato, aun fuera de la franja horaria (transaccionales).'))}</span></label>
      <label class="check" style="margin-top:10px"><input type="checkbox" id="ch-daily" ${S.dailyReminders ? 'checked' : ''}><span>${C.esc(C.t('Recordatorios también para préstamos de pago diario.'))}</span></label>
      <label class="field" style="margin-top:12px;max-width:220px"><span>${C.esc(C.t('Hora de los recordatorios'))}</span><input type="time" id="ch-time" value="${C.esc(S.reminderTime)}"></label>
      <div class="actions"><button class="btn btn-primary" id="ch-save">${C.esc(C.t('Guardar'))}</button></div></article>
    <article class="card card-pad"><div style="display:flex;gap:10px;align-items:center">${C.icon('shield', 22, 'gold')}<h3>${C.esc(C.t('WhatsApp · modo automático (Cloud API)'))}</h3><span class="chip">${C.esc(C.t('Requiere servidor'))}</span></div>
      <p class="muted">${C.esc(C.t('El envío y la descarga automática desde WhatsApp funcionan con el servidor COROC y la API oficial de Meta. La política de WhatsApp Business restringe el uso para cobranza de deudas y préstamos; antes de activarlo se requiere:'))}</p>
      <ul class="note" style="line-height:1.9"><li>${C.esc(C.t('Cuenta de WhatsApp Business Platform verificada y número dedicado.'))}</li><li>${C.esc(C.t('Plantillas aprobadas por Meta (categoría utilidad).'))}</li><li>${C.esc(C.t('Revisión legal de que su caso de uso es admisible para Meta.'))}</li><li>${C.esc(C.t('Autorización (opt-in) de cada cliente, ya registrada en COROC.'))}</li></ul>
      <p class="note">${C.esc(C.t('No se usan herramientas no oficiales que automaticen WhatsApp Web: violan los términos de WhatsApp y exponen su número a bloqueo permanente.'))}</p></article>
    <article class="card card-pad"><div style="display:flex;gap:10px;align-items:center">${C.icon('mail', 22, 'gold')}<h3>${C.esc(C.t('Correo'))}</h3><span class="chip ok">${C.esc(C.t('Activo'))}</span></div>
      <p class="muted">${C.esc(C.t('COROC abre su aplicación de correo con el asunto y el mensaje listos, y descarga el PDF para adjuntarlo. Con el servidor COROC el envío es directo desde su dominio.'))}</p></article>
    <article class="card card-pad"><div style="display:flex;gap:10px;align-items:center">${C.icon('clock', 22, 'gold')}<h3>${C.esc(C.t('Reglas de contacto'))}</h3><span class="chip ${S.contactRules ? 'ok' : 'err'}">${C.esc(S.contactRules ? C.t('Activas') : C.t('Desactivadas'))}</span></div>
      <p class="muted">${C.esc(C.t('Ley 2300 de 2023: lunes a viernes de 7:00 a. m. a 7:00 p. m., sábados de 8:00 a. m. a 3:00 p. m., nunca domingos ni festivos; un contacto de cobranza por día; un solo canal por semana; nunca a referencias.'))}</p></article></div>`;
  C.$('#ch-save', box).onclick = async () => {
    await C.saveSettings({ transactionalImmediate: C.$('#ch-tx', box).checked, dailyReminders: C.$('#ch-daily', box).checked, reminderTime: C.$('#ch-time', box).value || '08:00' });
    await C.audit('settings.messaging', 'settings', 'messaging', {});
    C.toast(C.t('Configuración guardada.'), 'success');
  };
};
