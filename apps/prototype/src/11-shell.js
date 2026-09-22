/* COROC · estructura, navegación, tema, búsqueda y bloqueo por inactividad */
C.NAV = [
  { id: 'dashboard', icon: 'home', label: 'Dashboard' },
  { id: 'today', icon: 'today', label: 'Cobros de hoy' },
  { id: 'clients', icon: 'users', label: 'Clientes' },
  { id: 'inbox', icon: 'inbox', label: 'Bandeja de validación', short: 'Bandeja' },
  { id: 'messages', icon: 'chat', label: 'Mensajería' },
  { id: 'reports', icon: 'chart', label: 'Informes', perm: 'reports.view' },
  { id: 'settings', icon: 'settings', label: 'Configuración' },
  { id: 'help', icon: 'help', label: 'Ayuda' },
];

C.applyTheme = () => {
  const t = (C.state.settings && C.state.settings.theme) || 'system';
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
};
C.isDark = () => {
  const t = document.documentElement.getAttribute('data-theme');
  return t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
};

C.route = () => {
  const h = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [name, ...rest] = h.split('/');
  return { name, arg: rest.join('/') };
};
C.go = (path) => {
  if (location.hash === '#/' + path) C.render();
  else location.hash = '#/' + path;
};

C.shell = () => {
  const r = C.route();
  const inboxN = C.intake.pendingCount();
  const dueN = C.msg.due().length;
  const u = C.state.user;
  const navItems = C.NAV.filter((n) => !n.perm || C.can(n.perm));
  const link = (n) => `<a href="#/${n.id}" ${r.name === n.id || (r.name === 'client' && n.id === 'clients') || (r.name === 'new-client' && n.id === 'clients') ? 'aria-current="page"' : ''}>${C.icon(n.icon)}<span>${C.esc(C.t(n.label))}</span>${n.id === 'inbox' && inboxN ? `<span class="badge">${inboxN}</span>` : ''}${n.id === 'messages' && dueN ? `<span class="badge">${dueN}</span>` : ''}</a>`;
  const bottom = ['dashboard', 'today', 'clients', 'inbox', 'more'].map((id) => {
    if (id === 'more') return `<a href="#/more" ${['messages', 'reports', 'settings', 'help', 'more'].includes(r.name) ? 'aria-current="page"' : ''}>${C.icon('more', 22)}<span>${C.esc(C.t('Más'))}</span></a>`;
    const n = C.NAV.find((x) => x.id === id);
    return `<a href="#/${id}" ${r.name === id || (r.name === 'client' && id === 'clients') ? 'aria-current="page"' : ''}>${C.icon(n.icon, 22)}<span>${C.esc(C.t(n.short || n.label))}</span>${id === 'inbox' && inboxN ? `<span class="badge">${inboxN}</span>` : ''}</a>`;
  }).join('');
  return `<div class="app">
    <aside class="side" aria-label="${C.esc(C.t('Navegación principal'))}">
      <div class="brand"><img src="${C.ASSETS.logoHDark}" alt="COROC Personal Loans"></div>
      <nav>${navItems.map(link).join('')}</nav>
      <div class="foot">
        <div class="who"><span class="avatar">${C.esc(C.initials(u.name))}</span><div style="min-width:0"><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${C.esc(u.name)}</div><small>${C.esc(C.t(C.ROLE_LABEL[u.role]))}</small></div></div>
        <div style="display:flex;gap:4px;padding:0 4px">
          <button class="icon-btn" data-act="theme" title="${C.esc(C.t('Cambiar tema'))}" aria-label="${C.esc(C.t('Cambiar tema'))}">${C.icon(C.isDark() ? 'sun' : 'moon')}</button>
          <button class="icon-btn" data-act="lang" title="${C.esc(C.t('Idioma'))}" aria-label="${C.esc(C.t('Idioma'))}">${C.icon('globe')}</button>
          ${C.can('backup.create') ? `<button class="icon-btn" data-act="backup" title="${C.esc(C.t('Crear respaldo'))}" aria-label="${C.esc(C.t('Crear respaldo'))}">${C.icon('archive')}</button>` : ''}
          <button class="icon-btn" data-act="logout" title="${C.esc(C.t('Cerrar sesión'))}" aria-label="${C.esc(C.t('Cerrar sesión'))}">${C.icon('logout')}</button>
        </div>
      </div>
    </aside>
    <div class="main">
      <header class="top">
        <label class="search" id="gsearch">${C.icon('search', 18)}<input id="gsearch-in" placeholder="${C.esc(C.t('Buscar cliente, contrato o teléfono'))}" autocomplete="off"><kbd class="hide-m">Ctrl K</kbd></label>
        <span class="spacer"></span>
        ${C.state.company.demo ? `<span class="demo-flag">${C.esc(C.t('DEMO'))}</span>` : ''}
        ${C.can('client.create') ? `<button class="btn btn-primary" data-act="new-client">${C.icon('plus', 18)}<span class="hide-m">${C.esc(C.t('Nuevo cliente'))}</span></button>` : ''}
      </header>
      <main class="content" id="view" tabindex="-1"></main>
    </div>
    <nav class="bottom-nav" aria-label="${C.esc(C.t('Navegación principal'))}">${bottom}</nav>
  </div>`;
};
C.ROLE_LABEL = { owner: 'Propietario', admin: 'Administrador', collector: 'Cobrador', auditor: 'Auditor' };

C.render = async () => {
  if (!C.state.user) return C.views.login();
  const r = C.route();
  document.body.innerHTML = C.shell();
  C.bindShell();
  const view = C.$('#view');
  const fn = C.views[r.name] || C.views.dashboard;
  try {
    await fn(view, r.arg);
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="card card-pad"><h2>${C.esc(C.t('Algo salió mal'))}</h2><p class="muted"></p></div>`;
    view.querySelector('p').textContent = e.message;
  }
  window.scrollTo(0, 0);
};

/** Actualiza solo contadores de la navegación sin redibujar la vista. */
C.refreshBadges = () => {
  if (!C.state.user || !C.$('.side')) return;
  const inboxN = C.intake.pendingCount();
  const dueN = C.msg.due().length;
  const set = (sel, n) => C.$$(sel).forEach((a) => {
    let b = a.querySelector('.badge');
    if (!n) return b && b.remove();
    if (!b) {
      b = document.createElement('span');
      b.className = 'badge';
      a.appendChild(b);
    }
    b.textContent = n;
  });
  set('a[href="#/inbox"]', inboxN);
  set('.side a[href="#/messages"]', dueN);
};

C.bindShell = () => {
  C.$$('[data-act]').forEach((b) => (b.onclick = () => C.shellAction(b.dataset.act)));
  const inp = C.$('#gsearch-in');
  inp.oninput = C.debounce(() => C.globalSearch(inp.value), 120);
  inp.onkeydown = (e) => {
    if (e.key === 'Enter') {
      const first = C.$('#gsearch-results a');
      if (first) first.click();
    }
    if (e.key === 'Escape') {
      inp.value = '';
      C.globalSearch('');
    }
  };
};

C.globalSearch = (q) => {
  let box = C.$('#gsearch-results');
  if (!q.trim()) return box && box.remove();
  if (!box) {
    box = document.createElement('div');
    box.id = 'gsearch-results';
    box.className = 'card';
    const s = C.$('#gsearch').getBoundingClientRect();
    Object.assign(box.style, { position: 'fixed', top: `${s.bottom + 6}px`, left: `${s.left}px`, width: `${Math.max(320, s.width)}px`, zIndex: 50, maxHeight: '60vh', overflow: 'auto' });
    document.body.appendChild(box);
    setTimeout(() => document.addEventListener('click', function off(e) {
      if (!box.contains(e.target) && e.target.id !== 'gsearch-in') {
        box.remove();
        document.removeEventListener('click', off);
      }
    }), 0);
  }
  const norm = (s) => Core.stripAccents(String(s || '')).toLowerCase();
  const nq = norm(q);
  const digits = q.replace(/\D/g, '');
  const hits = [];
  for (const c of C.visibleClients()) {
    const loans = C.loansOf(c.id);
    const hay = norm(`${C.fullName(c)} ${c.code} ${c.email || ''} ${loans.map((l) => l.contract).join(' ')}`);
    const phoneHit = digits.length >= 4 && [c.phone, c.phone2].some((p) => p && p.replace(/\D/g, '').includes(digits));
    if (hay.includes(nq) || phoneHit) hits.push({ c, loans });
    if (hits.length >= 8) break;
  }
  box.innerHTML = hits.length
    ? `<div class="list">${hits.map(({ c, loans }) => `<a class="li" href="#/client/${c.id}" style="text-decoration:none;color:inherit"><span class="avatar">${C.esc(C.initials(C.fullName(c)))}</span><div class="grow"><div class="row-title">${C.esc(C.fullName(c))}</div><div class="row-sub">${C.esc(c.code)} · ${C.esc(loans.map((l) => l.contract).join(', '))} · ${C.esc(c.phone || '')}</div></div>${C.icon('chevron', 18)}</a>`).join('')}</div>`
    : `<div class="empty">${C.esc(C.t('Sin resultados'))}</div>`;
  C.$$('a', box).forEach((a) => a.addEventListener('click', () => box.remove()));
};

C.shellAction = async (act) => {
  if (act === 'theme') {
    const next = C.isDark() ? 'light' : 'dark';
    await C.saveSettings({ theme: next });
    C.applyTheme();
    C.render();
  } else if (act === 'lang') {
    C.langPicker();
  } else if (act === 'logout') {
    await C.audit('auth.logout', 'user', C.state.user.id, {});
    C.state.user = null;
    location.hash = '#/dashboard';
    C.render();
  } else if (act === 'new-client') {
    C.go('new-client');
  } else if (act === 'backup') {
    C.views.backupDialog();
  }
};

C.langPicker = () =>
  C.modal({
    title: C.t('Idioma'),
    render: (body, close) => {
      body.innerHTML = `<div class="list">${C.LANGS.map((l) => `<button class="li btn-ghost" style="border:0;background:none;cursor:pointer;text-align:left" data-l="${l.code}">${C.icon('globe', 18)}<span class="grow">${C.esc(l.label)}</span>${C.lang() === l.code ? C.icon('check', 18, 'gold') : ''}</button>`).join('')}</div>`;
      C.$$('[data-l]', body).forEach((b) => (b.onclick = async () => {
        C.setLang(b.dataset.l);
        if (C.state.user) {
          C.state.user.lang = b.dataset.l;
          await C.db.put('users', C.state.user);
        }
        close(true);
        C.render();
      }));
    },
  });

/* Atajos de teclado (escritorio) */
document.addEventListener('keydown', (e) => {
  if (!C.state.user) return;
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = ['input', 'textarea', 'select'].includes(tag);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    const i = C.$('#gsearch-in');
    if (i) i.focus();
  } else if (!typing && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'n' && C.can('client.create') && !C.$('.modal-wrap')) {
    C.go('new-client');
  }
});

/* Bloqueo automático por inactividad (§7.1) */
C.idle = { last: Date.now() };
['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach((ev) => document.addEventListener(ev, () => (C.idle.last = Date.now()), { passive: true }));
setInterval(() => {
  const mins = (C.state.settings && C.state.settings.lockMinutes) || 5;
  if (C.state.user && Date.now() - C.idle.last > mins * 60000 && !C.state.busy) {
    C.audit('auth.auto_lock', 'user', C.state.user.id, {});
    C.state.lockedUser = C.state.user.username;
    C.state.user = null;
    C.render();
    C.toast(C.t('Sesión bloqueada por inactividad.'));
  }
}, 15000);
