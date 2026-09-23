#!/usr/bin/env python3
"""Lista las claves de traducción usadas en lib/ (l.clave o context.l10n.clave) y cuántos argumentos reciben.
Uso: python3 tool/l10n_keys.py [--check]   (--check compara con los ARB y falla si falta o sobra algo)."""
import json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
LIB = ROOT / 'lib'
pat = re.compile(r'(?:\bl|context\.l10n|l10n)\.([a-z][A-Za-z0-9]*)(\()?')

def count_args(src, start):
    depth, i, args, cur = 1, start, 0, ''
    has = False
    while i < len(src) and depth:
        ch = src[i]
        if ch in '([{': depth += 1
        elif ch in ')]}': depth -= 1
        if depth == 1 and ch == ',': args += 1
        if depth >= 1 and not ch.isspace() and not (depth == 1 and ch == ','): has = True
        i += 1
    return (args + 1) if has else 0

used = {}
for f in sorted(LIB.rglob('*.dart')):
    if '/gen/' in str(f): continue
    src = f.read_text(encoding='utf-8')
    for m in pat.finditer(src):
        key = m.group(1)
        if key in ('l10n', 'lang', 'dart'): continue
        n = count_args(src, m.end()) if m.group(2) else 0
        used.setdefault(key, set()).add(n)

if '--check' not in sys.argv:
    for k in sorted(used): print(k, sorted(used[k]))
    sys.exit(0)

ok = True
for lang in ('es', 'pt', 'en'):
    arb = json.loads((LIB / 'l10n' / f'app_{lang}.arb').read_text(encoding='utf-8'))
    keys = {k for k in arb if not k.startswith('@')}
    for k, ns in used.items():
        if k not in keys:
            print(f'[{lang}] falta la clave {k}'); ok = False; continue
        ph = arb.get('@' + k, {}).get('placeholders', {}) if lang == 'es' else json.loads((LIB / 'l10n' / 'app_es.arb').read_text(encoding='utf-8')).get('@' + k, {}).get('placeholders', {})
        for n in ns:
            if n != len(ph):
                print(f'[{lang}] {k}: se usa con {n} argumentos y define {len(ph)}'); ok = False
        for p in ph:
            if '{' + p not in arb[k]:
                print(f'[{lang}] {k}: no usa el marcador {{{p}}}'); ok = False
    for k in keys - set(used):
        print(f'[{lang}] clave sin uso: {k}')
    if lang != 'es':
        es = json.loads((LIB / 'l10n' / 'app_es.arb').read_text(encoding='utf-8'))
        missing = {k for k in es if not k.startswith('@')} - keys
        for k in missing: print(f'[{lang}] falta traducir {k}'); ok = False
sys.exit(0 if ok else 1)
