import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type Lang = 'es' | 'pt-BR' | 'en';
export const LANGS: Lang[] = ['es', 'pt-BR', 'en'];

type Catalog = Record<string, Record<string, unknown>>;
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../i18n');
const catalogs = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(fs.readFileSync(path.join(DIR, `${l}.json`), 'utf8')) as Catalog])) as Record<Lang, Catalog>;

function lookup(lang: Lang, key: string): string | undefined {
  let node: unknown = catalogs[lang];
  for (const part of key.split('.')) node = node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined;
  return typeof node === 'string' ? node : undefined;
}

/** Traducción con variables `{nombre}`. Si falta la clave en el idioma pedido, usa el español (idioma base). */
export function t(lang: Lang, key: string, vars: Record<string, string | number> = {}): string {
  const s = lookup(lang, key) ?? lookup('es', key) ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`));
}

/**
 * Idioma de la respuesta: el que la app declara en Accept-Language (el idioma que el usuario ve en ese momento, §6)
 * y, si no declara uno soportado, la preferencia guardada del usuario; por último, español.
 */
export function pickLang(userLang: string | null | undefined, acceptLanguage?: string): Lang {
  const header = (acceptLanguage ?? '').toLowerCase();
  const ranked = header
    .split(',')
    .map((p) => {
      const [tag, q] = p.trim().split(';q=');
      return { tag: tag ?? '', q: q ? Number(q) : 1 };
    })
    .filter((x) => x.tag)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of ranked) {
    if (tag.startsWith('pt')) return 'pt-BR';
    if (tag.startsWith('en')) return 'en';
    if (tag.startsWith('es')) return 'es';
  }
  if (userLang && (LANGS as string[]).includes(userLang)) return userLang as Lang;
  return 'es';
}

/** Porcentaje legible en el idioma: 0.2493 → "24,93 %" / "24.93%". */
export function pct(lang: Lang, x: number): string {
  const locale = lang === 'es' ? 'es-CO' : lang === 'pt-BR' ? 'pt-BR' : 'en-US';
  return new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
}
