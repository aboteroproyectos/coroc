/* COROC · internacionalización (es base, pt-BR, en). Los diccionarios se generan en 01b-dict.js */
C.LANGS = [
  { code: 'es', label: 'Español', locale: 'es-CO' },
  { code: 'pt-BR', label: 'Português (Brasil)', locale: 'pt-BR' },
  { code: 'en', label: 'English', locale: 'en-US' },
];
C.DICT = C.DICT || { 'pt-BR': {}, en: {} };
C.lang = () => C.state.lang || 'es';
C.localeOf = (lang) => (C.LANGS.find((l) => l.code === (lang || C.lang())) || C.LANGS[0]).locale;

const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m)) : s);

/** Traduce un texto fuente en español al idioma activo (o al indicado). */
C.t = (key, vars, lang) => {
  const l = lang || C.lang();
  const s = l === 'es' ? key : (C.DICT[l] && C.DICT[l][key]) || key;
  return fill(s, vars);
};

/** Plural: `tp('{n} cuota', '{n} cuotas', n)`. */
C.tp = (one, other, n, vars, lang) => {
  const l = lang || C.lang();
  const key = `${one}||${other}`;
  const pair = l === 'es' ? key : (C.DICT[l] && C.DICT[l][key]) || key;
  const [o, m] = pair.split('||');
  const rule = new Intl.PluralRules(C.localeOf(l)).select(n);
  return fill(rule === 'one' ? o : m, { n, ...(vars || {}) });
};

C.setLang = (code) => {
  C.state.lang = code;
  document.documentElement.lang = code;
  try {
    localStorage.setItem('coroc.lang', code);
  } catch (e) {
    /* almacenamiento no disponible: se conserva en memoria */
  }
};
