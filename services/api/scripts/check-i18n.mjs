// CI: las tres lenguas del servidor deben tener exactamente las mismas claves y ningún texto vacío (§6, regla 7).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../i18n');
const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? flat(v, `${p}${k}.`) : [[`${p}${k}`, v]]));
const langs = ['es', 'pt-BR', 'en'];
const maps = Object.fromEntries(langs.map((l) => [l, new Map(flat(JSON.parse(fs.readFileSync(path.join(dir, `${l}.json`), 'utf8'))))]));
let errors = 0;
for (const l of langs) {
  for (const [k, v] of maps[l]) if (!String(v).trim()) { console.error(`${l}: ${k} vacío`); errors++; }
  for (const k of maps.es.keys()) if (!maps[l].has(k)) { console.error(`${l}: falta ${k}`); errors++; }
  for (const k of maps[l].keys()) if (!maps.es.has(k)) { console.error(`${l}: sobra ${k}`); errors++; }
  for (const [k, v] of maps.es) {
    const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    if (maps[l].has(k) && ph(v) !== ph(maps[l].get(k))) { console.error(`${l}: ${k} con variables distintas`); errors++; }
  }
}
console.log(errors ? `✘ ${errors} problemas de traducción` : `✔ i18n del servidor: ${maps.es.size} claves en ${langs.length} idiomas`);
process.exit(errors ? 1 : 0);
