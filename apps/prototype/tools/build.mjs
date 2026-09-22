// Ensambla COROC.html: un solo archivo autocontenido (núcleo probado + app + fuentes + logo + librerías).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(HERE, '..');
process.chdir(root);
const brand = path.resolve(root, '../../brand');
const read = (p, enc = 'utf8') => fs.readFileSync(p, enc);
const b64 = (p) => fs.readFileSync(p).toString('base64');

// 1) Diccionarios
const i18n = JSON.parse(read('tools/i18n.json'));
const dict = { 'pt-BR': {}, en: {} };
for (const [k, v] of Object.entries(i18n)) {
  if (v['pt-BR']) dict['pt-BR'][k] = v['pt-BR'];
  if (v.en) dict.en[k] = v.en;
}
const dictJs = `C.DICT = ${JSON.stringify(dict)};`;

// 2) Recursos de marca
const svgUri = (f) => `data:image/svg+xml;base64,${b64(path.join(brand, 'svg', f))}`;
const logoHPng = await sharp(path.join(brand, 'svg', 'coroc-logo-horizontal.svg'), { density: 300 }).resize({ width: 900 }).png().toBuffer();
const meta = await sharp(logoHPng).metadata();
const favicon = b64(path.join(brand, 'icons', 'icon-64.png'));
const assets = `window.C = window.C || {};
C.ASSETS = ${JSON.stringify({
  logoV: svgUri('coroc-logo-vertical.svg'), logoVDark: svgUri('coroc-logo-vertical-dark.svg'), logoHDark: svgUri('coroc-logo-horizontal-dark.svg'),
  logoH: `data:image/png;base64,${logoHPng.toString('base64')}`, logoHRatio: meta.width / meta.height,
})};
C.FONTS_TTF = ${JSON.stringify({
  inter400: b64('vendor/ttf/inter-400.ttf'), inter600: b64('vendor/ttf/inter-600.ttf'), mont500: b64('vendor/ttf/montserrat-500.ttf'), mont600: b64('vendor/ttf/montserrat-600.ttf'),
})};`;

// 3) Fuentes de la interfaz (woff2 embebidas)
const fs_ = '@fontsource';
const face = (fam, w, file) => `@font-face{font-family:'${fam}';font-style:normal;font-weight:${w};font-display:swap;src:url(data:font/woff2;base64,${b64(`node_modules/${fs_}/${file}`)}) format('woff2');}`;
const fonts = [
  face('Inter', 300, 'inter/files/inter-latin-300-normal.woff2'), face('Inter', 400, 'inter/files/inter-latin-400-normal.woff2'),
  face('Inter', 500, 'inter/files/inter-latin-500-normal.woff2'), face('Inter', 600, 'inter/files/inter-latin-600-normal.woff2'),
  face('Montserrat', 500, 'montserrat/files/montserrat-latin-500-normal.woff2'), face('Montserrat', 600, 'montserrat/files/montserrat-latin-600-normal.woff2'),
].join('\n');

// 4) Librerías
const vendor = [
  read('node_modules/jspdf/dist/jspdf.umd.min.js'),
  read('node_modules/jszip/dist/jszip.min.js'),
  read('node_modules/qrcode-generator/qrcode.js'),
].join('\n;\n');
// El núcleo se empaqueta para el navegador desde @coroc/core (mismo código que usa la API).
const coreBundle = path.resolve(root, '../../packages/core/dist/coroc-core.browser.js');
if (!fs.existsSync(coreBundle)) execSync('npm run bundle:browser -w @coroc/core', { cwd: path.resolve(root, '../..'), stdio: 'inherit' });
const core = fs.readFileSync(coreBundle, 'utf8');

// 5) Aplicación
const srcFiles = fs.readdirSync('src').filter((f) => f.endsWith('.js')).sort();
const app = srcFiles.map((f) => {
  const code = read(path.join('src', f));
  return f === '01-i18n.js' ? `${code}\n${dictJs}` : code;
}).join('\n\n');
const css = read('src/styles.css');
const guard = (s) => s.replace(/<\/script/gi, '<\\/script');

const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#130E42">
<meta name="description" content="COROC · Plataforma de gestión y cobro de préstamos personales">
<title>COROC · Personal Loans</title>
<link rel="icon" type="image/png" href="data:image/png;base64,${favicon}">
<style>${fonts}\n${css}</style>
</head>
<body>
<div style="min-height:100vh;display:grid;place-items:center;background:#130E42"><div style="width:180px;height:3px;border-radius:2px;background:linear-gradient(90deg,#A57E33,#E9C879,#A57E33)"></div></div>
<script>${guard(vendor)}</script>
<script>${guard(core)}</script>
<script>${guard(assets)}</script>
<script>${guard(app)}</script>
</body>
</html>`;
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/COROC.html', html);
console.log('dist/COROC.html', (html.length / 1024 / 1024).toFixed(2), 'MB', srcFiles.length, 'files');
