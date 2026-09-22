// Recorrido de extremo a extremo con Chromium: configuración, demo, vistas, idiomas, capturas y errores de consola.
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
import { playwright } from './_harness.mjs';
const { chromium } = playwright();

const OUT = process.env.SHOTS || path.resolve('../../docs/pantallas');
fs.mkdirSync(OUT, { recursive: true });
const url = 'file://' + path.resolve('dist/COROC.html');
const errors = [];
const missing = new Set();

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 920 }, locale: 'es-CO', timezoneId: 'America/Bogota', acceptDownloads: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
  if (m.text().startsWith('MISSING::')) missing.add(m.text().slice(9));
});
const shot = async (name, full = false) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
const t0 = Date.now();
await page.goto(url);
await page.waitForSelector('#setup');
await shot('00-setup');
await page.fill('[name=company]', 'Inversiones Coroc S.A.S.');
await page.fill('[name=name]', 'Andrés Botero');
await page.fill('[name=u]', 'andres');
await page.fill('[name=p]', 'CorocSegura2026');
await page.fill('[name=p2]', 'CorocSegura2026');
await page.check('[name=demo]');
await page.click('#setup .btn-primary');
await page.waitForSelector('#ob', { timeout: 240000 });
console.log('seed ms', Date.now() - t0);
await shot('01-onboarding-0');
await page.click('#ob .actions .btn-primary');
await page.waitForSelector('#accs');
await shot('02-onboarding-accounts');
await page.click('#ob .actions .btn-primary');
await page.waitForTimeout(200);
await shot('03-onboarding-folder');
await page.click('#ob .actions .btn-primary');
await page.waitForTimeout(200);
await shot('04-onboarding-compliance');
await page.click('#ob .actions .btn-primary');
await page.waitForSelector('.kpis');
await page.waitForTimeout(1400);
await shot('10-dashboard');
if (process.env.ONLY_SETUP) {
  console.log(JSON.stringify({ errors }, null, 1));
  await browser.close();
  process.exit(0);
}
const go = async (hash, name, wait = '.content') => {
  await page.evaluate((h) => (location.hash = h), hash);
  await page.waitForSelector(wait);
  await page.waitForTimeout(600);
  await shot(name, true);
};
await go('#/today', '11-today');
await go('#/clients', '12-clients');
const firstClient = await page.evaluate(() => C.state.clients[0].id);
await go(`#/client/${firstClient}`, '13-client');
await page.click('[data-tab="schedule"]');
await page.waitForTimeout(300);
await shot('14-client-schedule', true);
await page.click('[data-tab="docs"]');
await page.waitForTimeout(300);
await shot('15-client-docs', true);
await page.click('[data-tab="msgs"]');
await page.waitForTimeout(300);
await shot('16-client-msgs', true);
await page.click('[data-tab="history"]');
await page.waitForTimeout(300);
await go('#/inbox', '17-inbox');
// abrir el primer elemento por revisar
const hasItem = await page.$('[data-item]');
if (hasItem) {
  await hasItem.click();
  await page.waitForSelector('.review');
  await page.waitForTimeout(500);
  await shot('18-inbox-review');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}
await go('#/messages', '19-messages');
await page.click('[data-tab="templates"]');
await page.waitForTimeout(300);
await shot('20-templates');
await go('#/reports', '21-reports');
await go('#/settings', '22-settings');
await go('#/help', '23-help');
await go('#/new-client', '24-new-client');

// Pago manual desde la ficha
await page.evaluate((id) => (location.hash = `#/client/${id}`), firstClient);
await page.waitForSelector('#c-pay');
await page.click('#c-pay');
await page.waitForSelector('#pay-prev .impact');
await shot('25-payment-dialog');
await page.click('[data-ok]');
await page.waitForSelector('.modal-wrap .lead', { timeout: 30000 });
await page.waitForTimeout(400);
await shot('26-after-payment');
await page.keyboard.press('Escape');

// Modo oscuro
await page.evaluate(() => C.saveSettings({ theme: 'dark' }).then(() => { C.applyTheme(); location.hash = '#/dashboard'; C.render(); }));
await page.waitForTimeout(1500);
await shot('30-dashboard-dark');
await page.evaluate((id) => (location.hash = `#/client/${id}`), firstClient);
await page.waitForTimeout(800);
await shot('31-client-dark', true);
await page.evaluate(() => C.saveSettings({ theme: 'light' }).then(() => C.applyTheme()));

// Idiomas: registrar claves sin traducción
await page.evaluate(() => {
  const orig = C.t;
  C.t = (k, v, l) => {
    const lang = l || C.lang();
    if (lang !== 'es' && !(C.DICT[lang] && C.DICT[lang][k])) console.log('MISSING::' + k);
    return orig(k, v, l);
  };
  const origP = C.tp;
  C.tp = (a, b, n, v, l) => {
    const lang = l || C.lang();
    if (lang !== 'es' && !(C.DICT[lang] && C.DICT[lang][`${a}||${b}`])) console.log('MISSING::' + `${a}||${b}`);
    return origP(a, b, n, v, l);
  };
});
for (const lang of ['pt-BR', 'en']) {
  await page.evaluate((l) => C.setLang(l), lang);
  for (const h of ['#/dashboard', '#/today', '#/clients', `#/client/${firstClient}`, '#/inbox', '#/messages', '#/reports', '#/settings', '#/help', '#/new-client']) {
    await page.evaluate((x) => (location.hash = x), h);
    await page.waitForTimeout(350);
    if (h.startsWith('#/client/')) for (const tab of ['schedule', 'docs', 'msgs', 'history', 'summary']) {
      await page.click(`[data-tab="${tab}"]`);
      await page.waitForTimeout(120);
    }
    if (h === '#/messages') for (const tab of ['scheduled', 'blocked', 'sent', 'templates', 'channels']) {
      await page.click(`[data-tab="${tab}"]`);
      await page.waitForTimeout(120);
    }
    if (h === '#/settings') for (const tab of ['company', 'accounts', 'compliance', 'loans', 'users', 'security', 'folder', 'backup', 'look']) {
      await page.click(`[data-tab="${tab}"]`);
      await page.waitForTimeout(120);
    }
  }
  await page.evaluate(() => (location.hash = '#/dashboard'));
  await page.waitForTimeout(1200);
  await shot(`40-dashboard-${lang}`);
}
await page.evaluate(() => C.setLang('es'));

// Móvil
const m = await ctx.newPage();
await m.setViewportSize({ width: 390, height: 844 });
m.on('pageerror', (e) => errors.push('mobile pageerror: ' + e.message));
await m.goto(url);
await m.waitForSelector('#login');
await m.screenshot({ path: `${OUT}/50-mobile-login.png` });
await m.fill('[name=u]', 'andres');
await m.fill('[name=p]', 'CorocSegura2026');
await m.click('#login .btn-primary');
await m.waitForSelector('.kpis');
await m.waitForTimeout(1300);
await m.screenshot({ path: `${OUT}/51-mobile-dashboard.png`, fullPage: true });
await m.evaluate((id) => (location.hash = `#/client/${id}`), firstClient);
await m.waitForTimeout(700);
await m.screenshot({ path: `${OUT}/52-mobile-client.png`, fullPage: true });
await m.evaluate(() => (location.hash = '#/inbox'));
await m.waitForTimeout(700);
await m.screenshot({ path: `${OUT}/53-mobile-inbox.png`, fullPage: true });

const stats = await page.evaluate(() => ({ clients: C.state.clients.length, loans: C.state.loans.length, docs: C.state.documents.length, inbox: C.state.inbox.map((i) => i.status), msgs: C.state.messages.length }));
if (missing.size) fs.writeFileSync(`${OUT}/missing.json`, JSON.stringify([...missing].sort(), null, 1));
console.log(JSON.stringify({ stats, errors, missing: missing.size }, null, 1));
await browser.close();
