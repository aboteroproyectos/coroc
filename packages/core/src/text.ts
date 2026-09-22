/** Utilidades de texto para comparar nombres de personas y titulares de cuentas. */

const LEGAL_SUFFIXES = new Set(['sas', 's', 'a', 'ltda', 'sa', 'inc', 'llc', 'eireli', 'me', 'ltd', 'eu', 'cia', 'y', 'e', 'de', 'del', 'la', 'da', 'do', 'dos', 'das']);

export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Tokens normalizados; conserva "*" como marca de nombre enmascarado (p. ej. "Mar*** Pér***"). */
export function nameTokens(s: string): string[] {
  return stripAccents(s)
    .toLowerCase()
    .replace(/[^a-z0-9*\s]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/\*+$/, '*'))
    .filter((t) => t.length > 0 && t !== '*' && !LEGAL_SUFFIXES.has(t));
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

export function ratio(a: string, b: string): number {
  const m = Math.max(a.length, b.length);
  return m === 0 ? 1 : 1 - levenshtein(a, b) / m;
}

function tokenScore(t: string, u: string): number {
  if (t === u) return 1;
  const tm = t.endsWith('*');
  const um = u.endsWith('*');
  if (tm || um) {
    const tp = tm ? t.slice(0, -1) : t;
    const up = um ? u.slice(0, -1) : u;
    const [shortP, long] = tp.length <= up.length ? [tp, up] : [up, tp];
    if (shortP.length >= 2 && long.startsWith(shortP)) return 0.92;
    return 0;
  }
  if (Math.min(t.length, u.length) <= 2) return 0;
  const r = ratio(t, u);
  return r >= 0.8 ? r : 0;
}

/**
 * Similitud 0–1 entre dos nombres. Tolera tildes, mayúsculas, orden distinto,
 * nombres enmascarados y nombres parciales (penaliza cuando falta información).
 */
export function nameSimilarity(a: string, b: string): number {
  const A = nameTokens(a);
  const B = nameTokens(b);
  if (!A.length || !B.length) return 0;
  const [small, large] = A.length <= B.length ? [A, B] : [B, A];
  const used = new Set<number>();
  let sum = 0;
  for (const t of small) {
    let best = 0;
    let bestJ = -1;
    large.forEach((u, j) => {
      if (used.has(j)) return;
      const s = tokenScore(t, u);
      if (s > best) {
        best = s;
        bestJ = j;
      }
    });
    if (bestJ >= 0) used.add(bestJ);
    sum += best;
  }
  const base = sum / small.length;
  const coverage = small.length === 1 && large.length > 1 ? 0.8 : 0.85 + 0.15 * (small.length / large.length);
  return Math.round(base * coverage * 1000) / 1000;
}
