/* COROC · configuración (§5.7-11), usuarios y roles (§7.2), carpeta (§16.2) y respaldo (§19) */
C.views.settings = (view) => {
  const ui = (C.state.setUi ||= { tab: C.can('settings.edit') ? 'company' : 'security' });
  const tabs = [
    ['company', 'Empresa', 'settings.edit'], ['accounts', 'Cuentas receptoras', 'settings.edit'], ['compliance', 'Cumplimiento', 'settings.edit'],
    ['loans', 'Préstamos', 'settings.edit'], ['users', 'Usuarios y roles', 'users.manage'], ['security', 'Seguridad', null],
    ['folder', 'Carpeta COROC', 'settings.edit'], ['backup', 'Respaldo', 'backup.create'], ['look', 'Apariencia', null],
  ].filter(([, , p]) => !p || C.can(p));
  if (!tabs.some(([k]) => k === ui.tab)) ui.tab = tabs[0][0];
  view.innerHTML = `<div class="page-head"><div><h1>${C.esc(C.t('Configuración'))}</h1></div></div>
    <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${ui.tab === k}">${C.esc(C.t(l))}</button>`).join('')}</div><div id="set-body"></div>`;
  C.$$('[data-tab]', view).forEach((b) => (b.onclick = () => {
    ui.tab = b.dataset.tab;
    C.views.settings(view);
  }));
  C.settingsTabs[ui.tab](C.$('#set-body', view), view);
};

C.formCard = (inner, saveLabel = 'Guardar cambios') => `<form class="card card-pad" novalidate>${inner}<div class="flags" data-err></div><div class="actions"><button class="btn btn-primary">${C.esc(C.t(saveLabel))}</button></div></form>`;
C.bindForm = (box, fn) => {
  const f = box.querySelector('form');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const err = f.querySelector('[data-err]');
    err.innerHTML = '';
    try {
      await fn(f);
      C.toast(C.t('Configuración guardada.'), 'success');
    } catch (ex) {
      err.innerHTML = `<div class="flag">${C.icon('alert', 16)}<span>${C.esc(ex.message)}</span></div>`;
    }
  };
  return f;
};

C.settingsTabs = {
  company(box) {
    const co = C.state.company;
    const hasLoans = C.state.loans.length > 0;
    box.innerHTML = C.formCard(`<div class="grid g2">
      <label class="field"><span>${C.esc(C.t('Nombre de la empresa'))}</span><input name="name" value="${C.esc(co.name)}"></label>
      <label class="field"><span>${C.esc(C.t('NIT / ID'))}</span><input name="taxId" value="${C.esc(co.taxId || '')}"></label>
      <label class="field"><span>${C.esc(C.t('Teléfono'))}</span><input name="phone" value="${C.esc(co.phone || '')}"></label>
      <label class="field"><span>${C.esc(C.t('Correo'))}</span><input name="email" type="email" value="${C.esc(co.email || '')}"></label>
      <label class="field"><span>${C.esc(C.t('Dirección'))}</span><input name="address" value="${C.esc(co.address || '')}"></label>
      <label class="field"><span>${C.esc(C.t('Ciudad'))}</span><input name="city" value="${C.esc(co.city || '')}"></label>
      <label class="field"><span>${C.esc(C.t('País de operación'))}</span><select name="country" ${hasLoans ? 'disabled' : ''}>${Object.entries(C.COUNTRIES).map(([k, v]) => `<option value="${k}" ${co.country === k ? 'selected' : ''}>${C.esc(C.t(v.name))} · ${v.currency}</option>`).join('')}</select>${hasLoans ? `<small>${C.esc(C.t('No se puede cambiar cuando ya existen préstamos.'))}</small>` : ''}</label>
      <label class="field"><span>${C.esc(C.t('Zona horaria'))}</span><select name="timezone">${C.timezones().map((z) => `<option ${z === co.timezone ? 'selected' : ''}>${z}</option>`).join('')}</select></label>
      <label class="field"><span>${C.esc(C.t('Idioma de la empresa (carpetas e informes)'))}</span><select name="lang">${C.LANGS.map((l) => `<option value="${l.code}" ${co.lang === l.code ? 'selected' : ''}>${C.esc(l.label)}</option>`).join('')}</select></label></div>`);
    C.bindForm(box, async (f) => {
      if (!f.name.value.trim()) throw new Error(C.t('Ingrese el nombre de la empresa.'));
      const patch = { name: f.name.value.trim(), taxId: f.taxId.value.trim(), phone: f.phone.value.trim(), email: f.email.value.trim(), address: f.address.value.trim(), city: f.city.value.trim(), timezone: f.timezone.value, lang: f.lang.value };
      if (!hasLoans) Object.assign(patch, { country: f.country.value, currency: C.COUNTRIES[f.country.value].currency });
      await C.saveCompany(patch);
      await C.audit('settings.company', 'company', 'company', {});
    });
  },

  accounts(box, view) {
    const S = C.state.settings;
    box.innerHTML = `<div class="card">${S.receivingAccounts.length ? `<div class="list">${S.receivingAccounts.map((a, i) => `<div class="li">${C.icon('bank', 20, 'gold')}<div class="grow"><div class="row-title">${C.esc(a.holderName)}</div><div class="row-sub">${C.esc([a.entity, a.last4 ? '•••• ' + a.last4 : ''].filter(Boolean).join(' · '))}</div></div><button class="btn btn-sm btn-ghost" data-rm="${i}">${C.esc(C.t('Quitar'))}</button></div>`).join('')}</div>` : `<div class="empty">${C.icon('bank', 28)}<div>${C.esc(C.t('Aún no hay cuentas. Sin ellas, todo comprobante irá a revisión.'))}</div></div>`}</div>
      <div class="section">${C.formCard(`<h3 style="margin-bottom:12px">${C.esc(C.t('Agregar cuenta'))}</h3><div class="grid g3">
        <label class="field"><span>${C.esc(C.t('Titular'))}</span><input name="holder"></label><label class="field"><span>${C.esc(C.t('Entidad'))}</span><input name="entity"></label>
        <label class="field"><span>${C.esc(C.t('Últimos 4 dígitos'))}</span><input name="last4" inputmode="numeric" maxlength="4"></label></div>`, 'Agregar cuenta')}</div>`;
    C.$$('[data-rm]', box).forEach((b) => (b.onclick = async () => {
      S.receivingAccounts.splice(Number(b.dataset.rm), 1);
      await C.saveSettings({ receivingAccounts: S.receivingAccounts });
      C.views.settings(view);
    }));
    C.bindForm(box.querySelector('.section'), async (f) => {
      if (!f.holder.value.trim()) throw new Error(C.t('Ingrese el titular.'));
      S.receivingAccounts.push({ id: C.uid(), holderName: f.holder.value.trim(), entity: f.entity.value.trim(), last4: f.last4.value.replace(/\D/g, '').slice(0, 4) });
      await C.saveSettings({ receivingAccounts: S.receivingAccounts });
      await C.audit('settings.accounts', 'settings', 'accounts', {});
      C.views.settings(view);
    });
  },

  compliance(box) {
    const S = C.state.settings;
    const expired = S.rateCap.validTo && S.rateCap.validTo < C.today();
    box.innerHTML = `${expired ? `<div class="banner">${C.icon('alert', 20)}<div class="grow">${C.esc(C.t('La tasa de usura registrada venció el {d}. Actualícela con la certificada para el período vigente.', { d: C.fmtDate(S.rateCap.validTo) }))}</div></div>` : ''}
      ${C.formCard(`<div class="grid g2">
      <label class="field"><span>${C.esc(C.t('Tope legal de tasa (efectiva anual, %)'))}</span><input name="cap" inputmode="decimal" value="${S.rateCap.ea ? (S.rateCap.ea * 100).toFixed(2) : ''}"><small>${C.esc(C.state.company.country === 'CO' ? C.t('En Colombia: tasa de usura vigente certificada por la Superintendencia Financiera.') : C.t('Tasa máxima permitida en su jurisdicción.'))}</small></label>
      <div class="grid g2"><label class="field"><span>${C.esc(C.t('Vigente desde'))}</span><input name="from" type="date" value="${C.esc(S.rateCap.validFrom || '')}"></label><label class="field"><span>${C.esc(C.t('Vigente hasta'))}</span><input name="to" type="date" value="${C.esc(S.rateCap.validTo || '')}"></label></div>
      <label class="check spanall"><input type="checkbox" name="rules" ${S.contactRules ? 'checked' : ''}><span>${C.esc(C.t('Aplicar reglas de contacto de la Ley 2300 de 2023 (horarios, un contacto de cobranza por día, un canal por semana).'))}</span></label>
      <label class="field"><span>${C.esc(C.t('Registro de pagos leídos de comprobantes'))}</span><select name="mode"><option value="auto_with_audit" ${S.supervisionMode === 'auto_with_audit' ? 'selected' : ''}>${C.esc(C.t('Automático con auditoría (recomendado)'))}</option><option value="prior_approval" ${S.supervisionMode === 'prior_approval' ? 'selected' : ''}>${C.esc(C.t('Aprobación previa: todo pasa por la bandeja'))}</option></select></label>
      <label class="field"><span>${C.esc(C.t('Umbral de confianza para registrar solo (%)'))}</span><input name="th" inputmode="numeric" value="${Math.round(S.confidenceThreshold * 100)}"></label>
      <label class="field"><span>${C.esc(C.t('Antigüedad máxima de un comprobante (días)'))}</span><input name="age" inputmode="numeric" value="${S.maxAgeDays}"></label>
      <label class="field"><span>${C.esc(C.t('Horas para revertir con un toque'))}</span><input name="rev" inputmode="numeric" value="${S.autoRevertHours}"></label></div>`)}`;
    C.bindForm(box, async (f) => {
      const cap = f.cap.value.trim() ? Number(f.cap.value.replace(',', '.')) / 100 : null;
      if (cap !== null && !(cap > 0 && cap < 10)) throw new Error(C.t('Ingrese una tasa válida.'));
      const th = Number(f.th.value) / 100;
      if (!(th >= 0.8 && th <= 1)) throw new Error(C.t('El umbral debe estar entre 80 y 100.'));
      await C.saveSettings({ rateCap: { ea: cap, validFrom: f.from.value, validTo: f.to.value }, contactRules: f.rules.checked, supervisionMode: f.mode.value, confidenceThreshold: th, maxAgeDays: Math.max(1, Number(f.age.value) || 30), autoRevertHours: Math.max(1, Number(f.rev.value) || 72) });
      await C.audit('settings.compliance', 'settings', 'compliance', { cap, rules: f.rules.checked });
    });
  },

  loans(box) {
    const S = C.state.settings;
    const days = C.WEEKDAYS();
    const p = S.prefixes;
    box.innerHTML = C.formCard(`<div class="grid g3">
      <label class="field"><span>${C.esc(C.t('Redondeo de cuotas'))}</span><select name="round">${(C.currency() === 'COP' ? [1, 50, 100, 1000] : [1, 100]).map((u) => `<option value="${u}" ${S.roundingUnit === u ? 'selected' : ''}>${C.esc(C.money(u))}</option>`).join('')}</select></label>
      <div class="field span2"><span>${C.esc(C.t('Días de cobro por defecto (diaria)'))}</span><div class="days">${days.map((d, i) => `<label><input type="checkbox" data-day="${i + 1}" ${S.defaultCollectionDays.includes(i + 1) ? 'checked' : ''}><span>${C.esc(d.replace('.', ''))}</span></label>`).join('')}</div></div>
      <label class="check spanall"><input type="checkbox" name="hol" ${S.excludeHolidays ? 'checked' : ''}><span>${C.esc(C.t('Excluir festivos por defecto'))}</span></label>
      <label class="field"><span>${C.esc(C.t('Prefijo de cliente'))}</span><input name="pc" value="${C.esc(p.client)}"></label>
      <label class="field"><span>${C.esc(C.t('Prefijo de contrato'))}</span><input name="pk" value="${C.esc(p.contract)}"></label>
      <label class="field"><span>${C.esc(C.t('Prefijo de recibo'))}</span><input name="pr" value="${C.esc(p.receipt)}"></label></div>`);
    C.bindForm(box, async (f) => {
      const dd = C.$$('[data-day]', box).filter((x) => x.checked).map((x) => Number(x.dataset.day));
      if (!dd.length) throw new Error(C.t('Seleccione al menos un día de cobro.'));
      await C.saveSettings({ roundingUnit: Number(f.round.value), defaultCollectionDays: dd, excludeHolidays: f.hol.checked, prefixes: { client: f.pc.value.trim() || 'C', contract: f.pk.value.trim() || 'CT-', receipt: f.pr.value.trim() || 'RC-' } });
      await C.audit('settings.loans', 'settings', 'loans', {});
    });
  },

  users(box, view) {
    box.innerHTML = `<div class="card table-wrap"><table class="t"><thead><tr><th>${C.esc(C.t('Nombre'))}</th><th>${C.esc(C.t('Usuario'))}</th><th>${C.esc(C.t('Rol'))}</th><th>${C.esc(C.t('Último ingreso'))}</th><th>${C.esc(C.t('Estado'))}</th><th></th></tr></thead><tbody>
      ${C.state.users.map((u) => `<tr><td class="row-title">${C.esc(u.name)}</td><td>${C.esc(u.username)}</td><td>${C.esc(C.t(C.ROLE_LABEL[u.role]))}</td><td>${C.esc(C.fmtDateTime(u.lastLoginAt))}</td><td>${u.active ? `<span class="chip ok">${C.esc(C.t('Activo'))}</span>` : `<span class="chip">${C.esc(C.t('Inactivo'))}</span>`}</td>
        <td>${u.role !== 'owner' ? `<button class="btn btn-sm btn-ghost" data-toggle="${u.id}">${C.esc(u.active ? C.t('Desactivar') : C.t('Activar'))}</button><button class="btn btn-sm btn-ghost" data-reset="${u.id}">${C.esc(C.t('Nueva contraseña'))}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
      <div class="section">${C.formCard(`<h3 style="margin-bottom:12px">${C.esc(C.t('Agregar usuario'))}</h3><div class="grid g2">
        <label class="field"><span>${C.esc(C.t('Nombre'))}</span><input name="name"></label><label class="field"><span>${C.esc(C.t('Usuario'))}</span><input name="u" autocomplete="off"></label>
        <label class="field"><span>${C.esc(C.t('Rol'))}</span><select name="role">${['admin', 'collector', 'auditor'].map((r) => `<option value="${r}">${C.esc(C.t(C.ROLE_LABEL[r]))}</option>`).join('')}</select></label>
        <label class="field"><span>${C.esc(C.t('Contraseña inicial'))}</span><input name="p" type="password" autocomplete="new-password"></label></div>
        <p class="note">${C.esc(C.t('Cobrador: ve solo sus clientes asignados, registra pagos y valida comprobantes; no puede reversar. Auditor: solo lectura.'))}</p>`, 'Agregar usuario')}</div>`;
    C.bindForm(box.querySelector('.section'), async (f) => {
      await C.auth.createUser({ username: f.u.value, name: f.name.value || f.u.value, role: f.role.value, password: f.p.value });
      await C.audit('user.created', 'user', f.u.value, { role: f.role.value });
      C.views.settings(view);
    });
    C.$$('[data-toggle]', box).forEach((b) => (b.onclick = async () => {
      const u = C.state.users.find((x) => x.id === b.dataset.toggle);
      u.active = !u.active;
      await C.db.put('users', u);
      await C.audit(u.active ? 'user.activated' : 'user.deactivated', 'user', u.id, {});
      C.views.settings(view);
    }));
    C.$$('[data-reset]', box).forEach((b) => (b.onclick = async () => {
      const u = C.state.users.find((x) => x.id === b.dataset.reset);
      const pw = await C.prompt(C.t('Nueva contraseña'), C.t('Contraseña nueva para {u}', { u: u.username }), { type: 'password' });
      if (!pw) return;
      try {
        await C.auth.changePassword(u, pw);
        u.lockedUntil = 0;
        await C.db.put('users', u);
        C.toast(C.t('Contraseña actualizada.'), 'success');
      } catch (e) {
        C.toast(e.message, 'error');
      }
    }));
  },

  security(box) {
    box.innerHTML = C.formCard(`<div class="grid g2">
      <label class="field"><span>${C.esc(C.t('Contraseña actual'))}</span><input name="cur" type="password" autocomplete="current-password"></label><div></div>
      <label class="field"><span>${C.esc(C.t('Contraseña nueva'))}</span><input name="p1" type="password" autocomplete="new-password"></label>
      <label class="field"><span>${C.esc(C.t('Confirmar contraseña'))}</span><input name="p2" type="password" autocomplete="new-password"></label>
      ${C.can('settings.edit') ? `<label class="field"><span>${C.esc(C.t('Bloqueo automático por inactividad (minutos)'))}</span><input name="lock" inputmode="numeric" value="${C.state.settings.lockMinutes || 5}"></label>` : ''}</div>`);
    C.bindForm(box, async (f) => {
      if (f.p1.value || f.cur.value) {
        const h = await C.auth.hash(f.cur.value, C.state.user.salt, C.state.user.iterations);
        if (h.hash !== C.state.user.hash) throw new Error(C.t('La contraseña actual no es correcta.'));
        if (f.p1.value !== f.p2.value) throw new Error(C.t('Las contraseñas no coinciden.'));
        await C.auth.changePassword(C.state.user, f.p1.value);
        f.cur.value = f.p1.value = f.p2.value = '';
      }
      if (f.lock) await C.saveSettings({ lockMinutes: Math.min(60, Math.max(1, Number(f.lock.value) || 5)) });
    });
  },

  folder(box, view) {
    const st = C.fs.status;
    const pending = C.state.documents.filter((d) => !d.superseded && (d.folderPending || !d.folderPath)).length;
    box.innerHTML = `<div class="card card-pad"><div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">${C.icon('folder', 32, 'gold')}<div class="grow"><h3>${C.esc(st === 'connected' ? C.t('Carpeta conectada') : st === 'needs-permission' ? C.t('Se necesita su permiso de nuevo') : st === 'unsupported' ? C.t('Este navegador no permite acceso a carpetas') : C.t('Sin conectar'))}</h3>
      <p class="muted" style="margin:6px 0 0">${C.esc(st === 'connected' ? C.t('COROC guarda cada documento en COROC › [cliente] › [contrato] › [tipo].') : st === 'unsupported' ? C.t('Use Chrome o Edge en el computador para guardar directo en la carpeta. Mientras tanto, los archivos quedan en COROC y puede descargar la carpeta completa como ZIP.') : C.t('Sugerencia: elija «Documentos». COROC crea allí la carpeta COROC.'))}</p>
      ${st === 'connected' && pending ? `<p class="note">${C.esc(C.tp('{n} documento pendiente por copiar.', '{n} documentos pendientes por copiar.', pending))}</p>` : ''}</div></div>
      <div class="actions">${st === 'disconnected' ? `<button class="btn btn-primary" data-f="connect">${C.esc(C.t('Permitir y crear carpeta'))}</button>` : ''}
        ${st === 'needs-permission' ? `<button class="btn btn-primary" data-f="reauth">${C.esc(C.t('Permitir'))}</button>` : ''}
        ${st === 'connected' ? `<button class="btn" data-f="sync">${C.icon('refresh', 16)}${C.esc(C.t('Sincronizar ahora'))}</button><button class="btn" data-f="scan">${C.icon('scan', 16)}${C.esc(C.t('Revisar carpeta COROC'))}</button><button class="btn btn-ghost" data-f="change">${C.esc(C.t('Cambiar ubicación'))}</button>` : ''}
        <button class="btn" data-f="zip">${C.icon('download', 16)}${C.esc(C.t('Descargar carpeta COROC (.zip)'))}</button></div></div>`;
    C.$$('[data-f]', box).forEach((b) => (b.onclick = async () => {
      b.disabled = true;
      try {
        const a = b.dataset.f;
        if (a === 'connect' || a === 'change') await C.fs.connect();
        if (a === 'reauth') await C.fs.reauthorize();
        if (a === 'sync') C.toast(C.tp('{n} documento copiado.', '{n} documentos copiados.', await C.fs.syncAll()), 'success');
        if (a === 'scan') C.toast(C.tp('{n} archivo nuevo procesado desde la carpeta COROC.', '{n} archivos nuevos procesados desde la carpeta COROC.', await C.fs.scan()), 'success');
        if (a === 'zip') C.download(await C.fs.exportZip(), `COROC_${C.today()}.zip`);
      } catch (e) {
        if (e.name !== 'AbortError') C.toast(e.message, 'error');
      }
      C.views.settings(view);
    }));
  },

  backup(box) {
    box.innerHTML = `<div class="grid g2"><article class="card card-pad"><div style="display:flex;gap:12px">${C.icon('archive', 26, 'gold')}<div><h3>${C.esc(C.t('Crear respaldo'))}</h3><p class="muted">${C.esc(C.t('Un solo archivo cifrado con toda la información: clientes, préstamos, pagos, mensajes, bitácora y todos los documentos recibidos y generados.'))}</p></div></div>
      <div class="actions"><button class="btn btn-primary" id="bk-new">${C.icon('archive', 16)}${C.esc(C.t('Crear respaldo'))}</button></div></article>
      ${C.can('backup.restore') ? `<article class="card card-pad"><div style="display:flex;gap:12px">${C.icon('refresh', 26, 'gold')}<div><h3>${C.esc(C.t('Restaurar respaldo'))}</h3><p class="muted">${C.esc(C.t('Reemplaza toda la información actual por la del respaldo, después de verificar su integridad.'))}</p></div></div>
      <div class="actions"><button class="btn" id="bk-restore">${C.icon('upload', 16)}${C.esc(C.t('Restaurar…'))}</button></div></article>` : ''}
      ${C.state.user.role === 'owner' ? `<article class="card card-pad"><div style="display:flex;gap:12px">${C.icon('alert', 26)}<div><h3>${C.esc(C.t('Eliminar todos los datos'))}</h3><p class="muted">${C.esc(C.state.company.demo ? C.t('Borra los datos de demostración y deja COROC listo para empezar.') : C.t('Borra definitivamente toda la información de este dispositivo. Cree un respaldo antes.'))}</p></div></div>
      <div class="actions"><button class="btn btn-danger" id="bk-wipe">${C.esc(C.t('Eliminar todo'))}</button></div></article>` : ''}</div>`;
    C.$('#bk-new', box).onclick = () => C.views.backupDialog();
    const rs = C.$('#bk-restore', box);
    if (rs) rs.onclick = () => C.views.restoreDialog();
    const wp = C.$('#bk-wipe', box);
    if (wp) wp.onclick = async () => {
      if (!(await C.confirm(C.t('Eliminar todos los datos'), C.t('Esta acción no se puede deshacer.'), { danger: true, okText: C.t('Eliminar todo'), requireText: C.state.company.name }))) return;
      for (const s of C.db.STORES) await C.db.clear(s);
      try {
        localStorage.removeItem('coroc.lang');
      } catch (e) {
        /* sin almacenamiento local */
      }
      location.hash = '';
      location.reload();
    };
  },

  look(box) {
    const t = C.state.settings.theme || 'system';
    box.innerHTML = `<div class="card card-pad"><div class="field"><span>${C.esc(C.t('Tema'))}</span><div class="seg" role="group">${[['system', 'Automático'], ['light', 'Marfil (claro)'], ['dark', 'Medianoche (oscuro)']].map(([k, l]) => `<button data-th="${k}" aria-pressed="${t === k}">${C.esc(C.t(l))}</button>`).join('')}</div></div>
      <div class="field" style="margin-top:18px"><span>${C.esc(C.t('Idioma'))}</span><div class="lang-switch">${C.LANGS.map((l) => `<button data-lg="${l.code}" aria-pressed="${C.lang() === l.code}">${C.esc(l.label)}</button>`).join('')}</div></div></div>`;
    C.$$('[data-th]', box).forEach((b) => (b.onclick = async () => {
      await C.saveSettings({ theme: b.dataset.th });
      C.applyTheme();
      C.render();
    }));
    C.$$('[data-lg]', box).forEach((b) => (b.onclick = async () => {
      C.setLang(b.dataset.lg);
      C.state.user.lang = b.dataset.lg;
      await C.db.put('users', C.state.user);
      C.render();
    }));
  },
};

C.views.backupDialog = () =>
  C.modal({
    title: C.t('Crear respaldo'),
    render: (body, close) => {
      body.innerHTML = `<p class="lead">${C.esc(C.t('Defina una contraseña para cifrar el respaldo. Sin ella no se podrá restaurar: guárdela en un lugar seguro.'))}</p>
        <div class="grid g2"><label class="field"><span>${C.esc(C.t('Contraseña del respaldo'))}</span><input id="bk-p1" type="password" autocomplete="new-password"></label><label class="field"><span>${C.esc(C.t('Confirmar contraseña'))}</span><input id="bk-p2" type="password" autocomplete="new-password"></label></div>
        <div class="progress section" style="display:none" id="bk-prog"><i style="width:0"></i></div><div class="flags" id="bk-err"></div>
        <div class="actions"><button class="btn btn-ghost" data-x>${C.esc(C.t('Cancelar'))}</button><button class="btn btn-primary" data-ok>${C.icon('archive', 16)}${C.esc(C.t('Crear y descargar'))}</button></div>`;
      body.querySelector('[data-x]').onclick = () => close(false);
      body.querySelector('[data-ok]').onclick = async (e) => {
        const p1 = C.$('#bk-p1', body).value;
        if (p1 !== C.$('#bk-p2', body).value) return (C.$('#bk-err', body).innerHTML = `<div class="flag">${C.icon('alert', 16)}<span>${C.esc(C.t('Las contraseñas no coinciden.'))}</span></div>`);
        e.target.disabled = true;
        C.state.busy = true;
        const prog = C.$('#bk-prog', body);
        prog.style.display = 'block';
        try {
          const { blob, name } = await C.backup.create(p1, (p) => (prog.firstElementChild.style.width = `${p}%`));
          C.download(blob, name);
          close(true);
          C.toast(C.t('Respaldo creado: {f}', { f: name }), 'success', 7000);
        } catch (ex) {
          e.target.disabled = false;
          C.$('#bk-err', body).innerHTML = `<div class="flag">${C.icon('alert', 16)}<span>${C.esc(ex.message)}</span></div>`;
        }
        C.state.busy = false;
      };
    },
  });

C.views.restoreDialog = () =>
  C.modal({
    title: C.t('Restaurar respaldo'),
    render: (body, close) => {
      body.innerHTML = `<div class="grid"><label class="field"><span>${C.esc(C.t('Archivo .coroc'))}</span><input id="rs-f" type="file" accept=".coroc"></label>
        <label class="field"><span>${C.esc(C.t('Contraseña del respaldo'))}</span><input id="rs-p" type="password"></label></div><div id="rs-sum"></div><div class="flags" id="rs-err"></div>
        <div class="actions"><button class="btn btn-ghost" data-x>${C.esc(C.t('Cancelar'))}</button><button class="btn btn-primary" data-ok>${C.esc(C.t('Verificar respaldo'))}</button></div>`;
      let opened = null;
      body.querySelector('[data-x]').onclick = () => close(false);
      body.querySelector('[data-ok]').onclick = async (e) => {
        const err = C.$('#rs-err', body);
        err.innerHTML = '';
        try {
          e.target.disabled = true;
          C.state.busy = true;
          if (!opened) {
            const f = C.$('#rs-f', body).files[0];
            if (!f) throw new Error(C.t('Elija el archivo de respaldo.'));
            opened = await C.backup.open(f, C.$('#rs-p', body).value);
            const k = opened.manifest.counts;
            C.$('#rs-sum', body).innerHTML = `<div class="card card-pad section" style="box-shadow:none"><div class="overline">${C.esc(C.t('Integridad verificada'))}</div>
              <p style="margin:8px 0 0">${C.esc(C.t('Se restaurarán {a} clientes, {b} préstamos y {c} documentos de «{e}», respaldo del {d}.', { a: k.clients, b: k.loans, c: k.documents, e: opened.manifest.company, d: C.fmtDateTime(opened.manifest.createdAt) }))}</p></div>`;
            e.target.textContent = C.t('Restaurar ahora');
            e.target.disabled = false;
            C.state.busy = false;
            return;
          }
          const ok = await C.confirm(C.t('Restaurar respaldo'), C.t('Toda la información actual será reemplazada.'), { danger: true, okText: C.t('Restaurar'), requireText: opened.manifest.company });
          if (!ok) {
            e.target.disabled = false;
            C.state.busy = false;
            return;
          }
          await C.backup.restore(opened);
          close(true);
          location.hash = '';
          location.reload();
        } catch (ex) {
          e.target.disabled = false;
          C.state.busy = false;
          err.innerHTML = `<div class="flag">${C.icon('alert', 16)}<span>${C.esc(ex.message)}</span></div>`;
        }
      };
    },
  });
