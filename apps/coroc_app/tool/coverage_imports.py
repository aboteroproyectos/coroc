#!/usr/bin/env python3
"""Genera test/all_files_test.dart, que importa todos los archivos de lib/ para que la cobertura cuente también el código
que ninguna prueba toca (Flutter solo mide los archivos cargados). Uso: python3 tool/coverage_imports.py [--check]."""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'test' / 'all_files_test.dart'
files = sorted(
    p.relative_to(ROOT / 'lib').as_posix()
    for p in (ROOT / 'lib').rglob('*.dart')
    if not p.name.endswith(('.g.dart', '.freezed.dart')) and 'l10n/gen' not in p.as_posix() and p.name != 'main.dart'
)
text = (
    '// Generado por tool/coverage_imports.py: no editar a mano.\n'
    '// Importa todo lib/ para que la cobertura de la app incluya los archivos sin pruebas.\n'
    '// ignore_for_file: unused_import\n'
    + ''.join(f"import 'package:coroc/{f}';\n" for f in files)
    + "import 'package:flutter_test/flutter_test.dart';\n\n"
    "void main() {\n  test('todos los archivos de lib/ compilan juntos', () {});\n}\n"
)
if '--check' in sys.argv:
    if not OUT.exists() or OUT.read_text(encoding='utf-8') != text:
        sys.exit('test/all_files_test.dart está desactualizado: ejecute python3 tool/coverage_imports.py')
else:
    OUT.write_text(text, encoding='utf-8')
    print(f'{len(files)} archivos importados')
