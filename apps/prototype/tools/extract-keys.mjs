// Extrae los textos fuente (español) que pasan por C.t / C.tp / T() y por las tablas de etiquetas.
import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve('src');
const files = fs.readdirSync(src).filter((f) => f.endsWith('.js')).sort();
const keys = new Set();
const plurals = new Set();
const lit = `'((?:[^'\\\\]|\\\\.)*)'`;
const unq = (s) => s.replace(/\\'/g, "'");
for (const f of files) {
  const code = fs.readFileSync(path.join(src, f), 'utf8');
  for (const m of code.matchAll(new RegExp(`C\\.tp\\(\\s*${lit}\\s*,\\s*${lit}`, 'g'))) plurals.add(`${unq(m[1])}||${unq(m[2])}`);
  for (const m of code.matchAll(new RegExp(`(?:C\\.t|\\bT)\\(\\s*${lit}`, 'g'))) keys.add(unq(m[1]));
  // Tablas: pares ['clave', 'Etiqueta'] y mapas { clave: 'Etiqueta' } dentro de bloques marcados con etiquetas conocidas
  for (const m of code.matchAll(new RegExp(`\\[\\s*'[a-z_0-9]+'\\s*,\\s*${lit}(?:\\s*,\\s*'[a-z.]+'|\\s*,\\s*null)?\\s*\\]`, 'g'))) keys.add(unq(m[1]));
  for (const m of code.matchAll(new RegExp(`\\[\\s*'[a-z]+'\\s*,\\s*${lit}\\s*,\\s*${lit}\\s*\\]`, 'g'))) {
    keys.add(unq(m[1]));
    keys.add(unq(m[2]));
  }
  for (const m of code.matchAll(new RegExp(`\\[\\s*'ADR-\\d+'\\s*,\\s*${lit}\\s*,\\s*${lit}\\s*\\]`, 'g'))) {
    keys.add(unq(m[1]));
    keys.add(unq(m[2]));
  }
  for (const m of code.matchAll(new RegExp(`(?:label|title|desc|short|why|name):\\s*${lit}`, 'g'))) keys.add(unq(m[1]));
  for (const m of code.matchAll(new RegExp(`\\b[A-Z_]+_(?:LABEL|TEXT|STATUS|CHIP)\\s*=\\s*\\{([\\s\\S]*?)\\};`, 'g'))) {
    for (const v of m[1].matchAll(new RegExp(`:\\s*(?:\\[\\s*'[a-z]*'\\s*,\\s*)?${lit}`, 'g'))) keys.add(unq(v[1]));
  }
}
// Listas literales de opciones traducidas con C.t(x)
const extra = ['Efectivo', 'Transferencia', 'Nequi', 'Daviplata', 'Bre-B', 'PIX', 'Zelle', 'Consignación', 'Otro',
  'Cláusula firmada en el contrato', 'Mensaje de aceptación del cliente', 'Formulario de autorización', 'Colombia', 'Brasil', 'Estados Unidos',
  'Diaria', 'Semanal', 'Mensual', 'diaria', 'semanal', 'mensual', 'Carga manual', 'Carpeta COROC', 'WhatsApp', 'Correo'];
extra.forEach((k) => keys.add(k));
const drop = new Set(['', 'WhatsApp', 'Nequi', 'Daviplata', 'Bre-B', 'PIX', 'Zelle', 'PDF', 'CSV']);
const out = { keys: [...keys].filter((k) => !drop.has(k) && /[A-Za-zÁÉÍÓÚáéíóúñ]/.test(k)).sort(), plurals: [...plurals].sort() };
fs.writeFileSync('tools/keys.json', JSON.stringify(out, null, 1));
console.log('keys', out.keys.length, 'plurals', out.plurals.length);
