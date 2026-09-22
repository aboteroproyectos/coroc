// Utilidades compartidas por las verificaciones con Chromium (Playwright).
// Playwright se resuelve desde el proyecto o desde PLAYWRIGHT_MODULE (ruta de una instalación global).
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DIST = path.resolve(HERE, '../dist');

export function playwright() {
  const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright', '@playwright/test'].filter(Boolean);
  for (const c of candidates) {
    try { return require(c); } catch { /* siguiente */ }
  }
  throw new Error('Playwright no está instalado. Ejecute «npm i -D playwright» o defina PLAYWRIGHT_MODULE.');
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.gz': 'application/gzip', '.png': 'image/png', '.pdf': 'application/pdf' };

// Servidor estático en localhost: la carpeta COROC (File System Access / OPFS) exige contexto seguro,
// que file:// no ofrece. `mounts` permite publicar recursos extra, p. ej. { '/ocr': '/ruta/a/tesseract' }.
export function serve(mounts = {}) {
  const table = { '/': DIST, ...mounts };
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const prefix = Object.keys(table).filter((m) => url.startsWith(m)).sort((a, b) => b.length - a.length)[0];
    const base = table[prefix];
    const file = path.join(base, url.slice(prefix.length));
    if (!file.startsWith(base) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}

export async function launch(opts = {}) {
  const { chromium } = playwright();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-CO', timezoneId: 'America/Bogota', acceptDownloads: true, ...opts });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  return { browser, ctx, page, errors };
}

// Configuración inicial con datos de demostración (12 clientes, 3 comprobantes en la Bandeja).
export async function setupDemo(page, url) {
  await page.goto(url);
  await page.waitForSelector('#setup');
  await page.fill('[name=company]', 'Inversiones Coroc S.A.S.');
  await page.fill('[name=name]', 'Andrés Botero');
  await page.fill('[name=u]', 'andres');
  await page.fill('[name=p]', 'CorocSegura2026');
  await page.fill('[name=p2]', 'CorocSegura2026');
  await page.check('[name=demo]');
  await page.click('#setup .btn-primary');
  await page.waitForSelector('#ob', { timeout: 240000 });
}

export function check(results, name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail !== undefined ? ' · ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
}

export function finish(results, errors) {
  const failed = results.filter((r) => !r.ok).length;
  if (errors.length) console.log('Errores de consola:', errors);
  console.log(`\n${results.length - failed}/${results.length} verificaciones correctas${errors.length ? ` · ${errors.length} errores de consola` : ''}`);
  process.exitCode = failed || errors.length ? 1 : 0;
  return { passed: results.length - failed, total: results.length, errors };
}
