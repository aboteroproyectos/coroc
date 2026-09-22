/* COROC · ingreso, configuración inicial y asistente de primer uso (§5.7, §7.1) */
C.COUNTRIES = {
  CO: { name: 'Colombia', currency: 'COP', tz: 'America/Bogota', lang: 'es' },
  BR: { name: 'Brasil', currency: 'BRL', tz: 'America/Sao_Paulo', lang: 'pt-BR' },
  US: { name: 'Estados Unidos', currency: 'USD', tz: 'America/New_York', lang: 'en' },
};
C.timezones = () => {
  try {
    return Intl.supportedValuesOf('timeZone').filter((z) => z.startsWith('America/'));
  } catch (e) {
    return ['America/Bogota', 'America/Sao_Paulo', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Mexico_City', 'America/Lima'];
  }
};

C.authFrame = (inner) => `<div class="auth">
  <section class="art">
    <img src="${C.ASSETS.logoVDark}" alt="COROC Personal Loans">
    <div class="claim"><h2>${C.esc(C.t('Registras una vez. COROC hace el resto y tú supervisas.'))}</h2>
    <p>${C.esc(C.t('Cartera, recaudo, comprobantes y recibos en un solo lugar, con la precisión de un sistema contable.'))}</p></div>
  </section>
  <section class="panel">${inner}</section></div>`;

C.langButtons = () => `<div class="lang-switch" role="group" aria-label="${C.esc(C.t('Idioma'))}">${C.LANGS.map((l) => `<button type="button" data-lang="${l.code}" aria-pressed="${C.lang() === l.code}">${C.esc(l.label)}</button>`).join('')}</div>`;
C.bindLang = (root, rerender) => C.$$('[data-lang]', root).forEach((b) => (b.onclick = () => {
  C.setLang(b.dataset.lang);
  rerender();
}));

C.views.login = () => {
  if (!C.state.users.length) return C.views.setup();
  document.body.innerHTML = C.authFrame(`<form id="login" novalidate>
    <img class="logo-mobile" src="${C.isDark() ? C.ASSETS.logoVDark : C.ASSETS.logoV}" alt="COROC">
    ${C.langButtons()}
    <div><h1>${C.esc(C.t('Ingresar'))}</h1><p class="muted" style="margin:6px 0 0">${C.esc(C.state.company.name || '')}</p></div>
    <label class="field"><span>${C.esc(C.t('Usuario'))}</span><input name="u" autocomplete="username" required value="${C.esc(C.state.lockedUser || '')}"></label>
    <label class="field"><span>${C.esc(C.t('Contraseña'))}</span><input name="p" type="password" autocomplete="current-password" required></label>
    <p class="field"><span class="err" id="login-err" role="alert"></span></p>
    <button class="btn btn-primary" style="height:46px">${C.icon('lock', 18)}${C.esc(C.t('Ingresar'))}</button>
    <p class="note">${C.esc(C.t('Tras 5 intentos fallidos la cuenta se bloquea 15 minutos. La sesión se bloquea sola tras unos minutos sin uso.'))}</p>
  </form>`);
  const f = C.$('#login');
  C.bindLang(f, C.views.login);
  (f.u.value ? f.p : f.u).focus();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = f.querySelector('.btn-primary');
    btn.disabled = true;
    C.$('#login-err').textContent = '';
    try {
      const u = await C.auth.login(f.u.value, f.p.value);
      if (u.lang) C.setLang(u.lang);
      C.state.lockedUser = null;
      C.idle.last = Date.now();
      await C.afterLogin();
    } catch (err) {
      C.$('#login-err').textContent = err.message;
      btn.disabled = false;
      f.p.value = '';
      f.p.focus();
    }
  };
};

C.afterLogin = async () => {
  if (!C.state.company.onboarded && C.state.user.role === 'owner') return C.views.onboarding();
  if (!location.hash || location.hash === '#/') location.hash = '#/dashboard';
  C.render();
  C.automation.tick();
};

/* ── Configuración inicial: empresa + propietario ── */
C.views.setup = (draft = {}) => {
  document.body.innerHTML = C.authFrame(`<form id="setup" novalidate>
    <img class="logo-mobile" src="${C.isDark() ? C.ASSETS.logoVDark : C.ASSETS.logoV}" alt="COROC">
    ${C.langButtons()}
    <div><span class="overline">${C.esc(C.t('Primer uso'))}</span><h1 style="margin-top:6px">${C.esc(C.t('Configure COROC'))}</h1></div>
    <label class="field"><span>${C.esc(C.t('Nombre de la empresa'))}</span><input name="company" required value="${C.esc(draft.company || '')}"></label>
    <label class="field"><span>${C.esc(C.t('País de operación'))}</span><select name="country">${Object.entries(C.COUNTRIES).map(([k, v]) => `<option value="${k}" ${draft.country === k ? 'selected' : ''}>${C.esc(C.t(v.name))} · ${v.currency}</option>`).join('')}</select></label>
    <div class="grid g2"><label class="field"><span>${C.esc(C.t('Su nombre'))}</span><input name="name" autocomplete="name" required value="${C.esc(draft.name || '')}"></label>
    <label class="field"><span>${C.esc(C.t('Usuario'))}</span><input name="u" autocomplete="username" required value="${C.esc(draft.u || '')}"></label></div>
    <label class="field"><span>${C.esc(C.t('Contraseña'))}</span><input name="p" type="password" autocomplete="new-password" required><small>${C.esc(C.t('Mínimo 12 caracteres, con letras y números.'))}</small></label>
    <label class="field"><span>${C.esc(C.t('Confirmar contraseña'))}</span><input name="p2" type="password" autocomplete="new-password" required></label>
    <label class="check"><input type="checkbox" name="demo" ${draft.demo ? 'checked' : ''}><span>${C.esc(C.t('Cargar datos de demostración para explorar (se marcan como DEMO y se pueden borrar).'))}</span></label>
    <p class="field"><span class="err" id="setup-err" role="alert"></span></p>
    <button class="btn btn-primary" style="height:46px">${C.esc(C.t('Crear cuenta de propietario'))}${C.icon('arrow', 18)}</button>
  </form>`);
  const f = C.$('#setup');
  const snapshot = () => ({ company: f.company.value, country: f.country.value, name: f.name.value, u: f.u.value, demo: f.demo.checked });
  C.bindLang(f, () => C.views.setup(snapshot()));
  f.company.focus();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const err = C.$('#setup-err');
    err.textContent = '';
    if (!f.company.value.trim() || !f.name.value.trim()) return (err.textContent = C.t('Complete todos los campos.'));
    if (f.p.value !== f.p2.value) return (err.textContent = C.t('Las contraseñas no coinciden.'));
    const btn = f.querySelector('.btn-primary');
    btn.disabled = true;
    try {
      const ctry = C.COUNTRIES[f.country.value];
      await C.saveCompany({ name: f.company.value.trim(), country: f.country.value, currency: ctry.currency, timezone: ctry.tz, lang: C.lang(), createdAt: new Date().toISOString(), onboarded: false, demo: f.demo.checked });
      await C.saveSettings({ ...C.DEFAULT_SETTINGS });
      const u = await C.auth.createUser({ username: f.u.value, name: f.name.value, role: 'owner', password: f.p.value });
      u.lang = C.lang();
      await C.db.put('users', u);
      C.state.user = u;
      await C.audit('company.created', 'company', 'company', { name: C.state.company.name });
      if (f.demo.checked) await C.demo.seed();
      await C.afterLogin();
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
    }
  };
};

/* ── Asistente de primer uso (§5.7-2) ── */
C.views.onboarding = (step = 0) => {
  const S = C.state.settings;
  const co = C.state.company;
  const total = 4;
  const bar = `<div class="steps">${Array.from({ length: total }, (_, i) => `<i class="${i <= step ? 'on' : ''}"></i>`).join('')}</div>`;
  let inner = '';
  if (step === 0) {
    inner = `<h1>${C.esc(C.t('Datos de la empresa'))}</h1><p class="muted">${C.esc(C.t('Aparecen en recibos, estados de cuenta y paz y salvo.'))}</p>
      <div class="grid g2">
      <label class="field"><span>${C.esc(C.t('NIT / ID'))}</span><input name="taxId" value="${C.esc(co.taxId || '')}"></label>
      <label class="field"><span>${C.esc(C.t('Teléfono'))}</span><input name="phone" value="${C.esc(co.phone || '')}"></label>
      <label class="field span2"><span>${C.esc(C.t('Correo'))}</span><input name="email" type="email" value="${C.esc(co.email || '')}"></label>
      <label class="field"><span>${C.esc(C.t('Dirección'))}</span><input name="address" value="${C.esc(co.address || '')}"></label>
      <label class="field"><span>${C.esc(C.t('Ciudad'))}</span><input name="city" value="${C.esc(co.city || '')}"></label>
      <label class="field span2"><span>${C.esc(C.t('Zona horaria'))}</span><select name="timezone">${C.timezones().map((z) => `<option ${z === co.timezone ? 'selected' : ''}>${z}</option>`).join('')}</select></label></div>`;
  } else if (step === 1) {
    inner = `<h1>${C.esc(C.t('Cuentas receptoras'))}</h1><p class="muted">${C.esc(C.t('COROC verifica que cada comprobante haya sido pagado a una de estas cuentas antes de registrarlo solo.'))}</p>
      <div id="accs"></div>
      <div class="grid g3" style="margin-top:12px">
      <label class="field"><span>${C.esc(C.t('Titular'))}</span><input name="holder"></label>
      <label class="field"><span>${C.esc(C.t('Entidad'))}</span><input name="entity" placeholder="Nequi, Bancolombia…"></label>
      <label class="field"><span>${C.esc(C.t('Últimos 4 dígitos'))}</span><input name="last4" inputmode="numeric" maxlength="4"></label></div>
      <button type="button" class="btn btn-sm" id="acc-add" style="margin-top:10px">${C.icon('plus', 16)}${C.esc(C.t('Agregar cuenta'))}</button>`;
  } else if (step === 2) {
    const st = C.fs.status;
    inner = `<h1>${C.esc(C.t('Carpeta COROC'))}</h1><p class="muted">${C.esc(C.t('COROC necesita su permiso para crear en este equipo una carpeta llamada COROC. Allí guardará, en una subcarpeta por cliente, los comprobantes recibidos, los recibos emitidos, los planes de pago y los estados de cuenta.'))}</p>
      <div class="card card-pad" style="margin-top:14px;display:flex;gap:14px;align-items:center">${C.icon('folder', 28, 'gold')}<div class="grow"><strong>${C.esc(st === 'connected' ? C.t('Carpeta conectada') : st === 'unsupported' ? C.t('Este navegador no permite acceso a carpetas') : C.t('Sin conectar'))}</strong>
      <div class="note">${C.esc(st === 'unsupported' ? C.t('Use Chrome o Edge en el computador para guardar directo en la carpeta. Mientras tanto, los archivos quedan en COROC y puede descargar la carpeta completa como ZIP.') : C.t('Sugerencia: elija «Documentos». COROC crea allí la carpeta COROC.'))}</div></div>
      ${st !== 'unsupported' && st !== 'connected' ? `<button type="button" class="btn btn-primary" id="fs-connect">${C.esc(C.t('Permitir y crear carpeta'))}</button>` : ''}</div>`;
  } else {
    inner = `<h1>${C.esc(C.t('Cumplimiento y supervisión'))}</h1>
      <div class="grid g2" style="margin-top:12px">
      <label class="field"><span>${C.esc(C.t('Tope legal de tasa (efectiva anual, %)'))}</span><input name="cap" inputmode="decimal" value="${S.rateCap.ea ? (S.rateCap.ea * 100).toFixed(2) : ''}"><small>${C.esc(co.country === 'CO' ? C.t('En Colombia: tasa de usura vigente certificada por la Superintendencia Financiera.') : C.t('Tasa máxima permitida en su jurisdicción.'))}</small></label>
      <label class="field"><span>${C.esc(C.t('Vigente hasta'))}</span><input name="capTo" type="date" value="${C.esc(S.rateCap.validTo || '')}"></label>
      <label class="check spanall"><input type="checkbox" name="rules" ${S.contactRules ? 'checked' : ''}><span>${C.esc(C.t('Aplicar reglas de contacto de la Ley 2300 de 2023 (horarios, un contacto de cobranza por día, un canal por semana).'))}</span></label>
      <label class="field spanall"><span>${C.esc(C.t('Registro de pagos leídos de comprobantes'))}</span><select name="mode">
        <option value="auto_with_audit" ${S.supervisionMode === 'auto_with_audit' ? 'selected' : ''}>${C.esc(C.t('Automático con auditoría (recomendado)'))}</option>
        <option value="prior_approval" ${S.supervisionMode === 'prior_approval' ? 'selected' : ''}>${C.esc(C.t('Aprobación previa: todo pasa por la bandeja'))}</option></select></label></div>`;
  }
  document.body.innerHTML = C.authFrame(`<form id="ob" novalidate style="width:min(520px,100%)">
    <img class="logo-mobile" src="${C.isDark() ? C.ASSETS.logoVDark : C.ASSETS.logoV}" alt="COROC">
    <span class="overline">${C.esc(C.t('Paso {a} de {b}', { a: step + 1, b: total }))}</span>${bar}${inner}
    <p class="field"><span class="err" id="ob-err" role="alert"></span></p>
    <div class="actions">${step > 0 ? `<button type="button" class="btn btn-ghost" id="ob-back">${C.esc(C.t('Atrás'))}</button>` : ''}
    <button class="btn btn-primary">${C.esc(step === total - 1 ? C.t('Terminar') : C.t('Continuar'))}${C.icon('arrow', 18)}</button></div></form>`);
  const f = C.$('#ob');
  if (step === 1) {
    const draw = () => {
      C.$('#accs').innerHTML = S.receivingAccounts.length
        ? `<div class="card"><div class="list">${S.receivingAccounts.map((a, i) => `<div class="li">${C.icon('bank', 18, 'gold')}<div class="grow"><div class="row-title">${C.esc(a.holderName)}</div><div class="row-sub">${C.esc([a.entity, a.last4 ? '•••• ' + a.last4 : ''].filter(Boolean).join(' · '))}</div></div><button type="button" class="icon-btn" data-rm="${i}" aria-label="${C.esc(C.t('Quitar'))}">${C.icon('x', 16)}</button></div>`).join('')}</div></div>`
        : `<p class="note">${C.esc(C.t('Aún no hay cuentas. Sin ellas, todo comprobante irá a revisión.'))}</p>`;
      C.$$('[data-rm]').forEach((b) => (b.onclick = async () => {
        S.receivingAccounts.splice(Number(b.dataset.rm), 1);
        await C.saveSettings({ receivingAccounts: S.receivingAccounts });
        draw();
      }));
    };
    draw();
    C.$('#acc-add').onclick = async () => {
      if (!f.holder.value.trim()) return f.holder.focus();
      S.receivingAccounts.push({ id: C.uid(), holderName: f.holder.value.trim(), entity: f.entity.value.trim(), last4: f.last4.value.replace(/\D/g, '').slice(0, 4) });
      await C.saveSettings({ receivingAccounts: S.receivingAccounts });
      f.holder.value = f.entity.value = f.last4.value = '';
      draw();
    };
  }
  if (step === 2 && C.$('#fs-connect')) {
    C.$('#fs-connect').onclick = async () => {
      try {
        await C.fs.connect();
        C.views.onboarding(2);
      } catch (e) {
        if (e.name !== 'AbortError') C.$('#ob-err').textContent = e.message;
      }
    };
  }
  if (C.$('#ob-back')) C.$('#ob-back').onclick = () => C.views.onboarding(step - 1);
  f.onsubmit = async (e) => {
    e.preventDefault();
    if (step === 0) await C.saveCompany({ taxId: f.taxId.value.trim(), phone: f.phone.value.trim(), email: f.email.value.trim(), address: f.address.value.trim(), city: f.city.value.trim(), timezone: f.timezone.value });
    if (step === 3) {
      const cap = f.cap.value.trim() ? Number(f.cap.value.replace(',', '.')) / 100 : null;
      if (cap !== null && !(cap > 0 && cap < 10)) return (C.$('#ob-err').textContent = C.t('Ingrese una tasa válida.'));
      await C.saveSettings({ rateCap: { ea: cap, validFrom: C.today(), validTo: f.capTo.value }, contactRules: f.rules.checked, supervisionMode: f.mode.value });
      await C.saveCompany({ onboarded: true });
      await C.audit('company.onboarded', 'company', 'company', {});
      location.hash = '#/dashboard';
      C.render();
      C.automation.tick();
      return;
    }
    C.views.onboarding(step + 1);
  };
};
