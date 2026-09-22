/* COROC · arranque, automatización periódica y enlaces entre eventos */
C.automation = {
  running: false,
  lastScan: 0,
  async tick() {
    if (!C.state.user || C.automation.running || C.state.seeding) return;
    C.automation.running = true;
    try {
      await C.msg.generateScheduled();
      if (C.fs.status === 'connected' && Date.now() - C.automation.lastScan > 120000) {
        C.automation.lastScan = Date.now();
        const n = await C.fs.scan();
        if (n) C.toast(C.tp('{n} archivo nuevo procesado desde la carpeta COROC.', '{n} archivos nuevos procesados desde la carpeta COROC.', n), 'success');
      }
      C.refreshBadges();
    } catch (e) {
      console.error('COROC automation', e);
    } finally {
      C.automation.running = false;
    }
  },
};

C.on('payment', ({ client, entry }) => {
  if (entry.auto) C.toast(`${C.t('Pago registrado')} · ${C.fullName(client)} · ${C.money(entry.amount)}`, 'success', 6000);
});
C.on('data', C.debounce(() => {
  const r = C.route();
  if (C.state.user && !C.$('.modal-wrap') && ['dashboard', 'today'].includes(r.name) && C.$('#view')) C.views[r.name](C.$('#view'));
  C.refreshBadges();
}, 250));
C.on('inbox', C.debounce(() => {
  C.refreshBadges();
  if (C.route().name === 'inbox' && !C.$('.modal-wrap') && C.$('#view')) C.views.inbox(C.$('#view'));
}, 200));
C.on('messages', C.debounce(C.refreshBadges, 200));

C.boot = async () => {
  await C.db.open();
  C.state.company = await C.db.kvGet('company', {});
  C.state.settings = { ...C.DEFAULT_SETTINGS, ...(await C.db.kvGet('settings', {})) };
  C.state.settings.messages = { ...C.DEFAULT_SETTINGS.messages, ...(C.state.settings.messages || {}) };
  C.state.templates = await C.db.kvGet('templates', {});
  const [users, clients, loans, documents, inbox, messages] = await Promise.all(['users', 'clients', 'loans', 'documents', 'inbox', 'messages'].map((s) => C.db.all(s)));
  Object.assign(C.state, { users, clients, loans, documents, inbox: inbox.sort((a, b) => b.ts - a.ts), messages: messages.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)) });
  let lang = null;
  try {
    lang = localStorage.getItem('coroc.lang');
  } catch (e) {
    /* sin almacenamiento local */
  }
  const nav = (navigator.language || 'es').toLowerCase();
  const guess = nav.startsWith('pt') ? 'pt-BR' : nav.startsWith('en') ? 'en' : 'es';
  C.setLang(lang || C.state.company.lang || guess);
  C.applyTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => C.state.user && C.render());
  await C.fs.init();
  window.addEventListener('hashchange', () => C.render());
  window.addEventListener('resize', () => C.state.onResize && C.state.onResize());
  setInterval(() => C.automation.tick(), 60000);
  C.render();
};

window.addEventListener('DOMContentLoaded', () => {
  C.boot().catch((e) => {
    document.body.innerHTML = '<div style="padding:40px;font-family:system-ui"><h1>COROC</h1><p></p></div>';
    document.querySelector('p').textContent = `${C.t('No se pudo iniciar COROC')}: ${e.message}`;
    console.error(e);
  });
});
