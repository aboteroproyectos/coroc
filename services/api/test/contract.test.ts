import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { contract } from '../src/common/openapi.js';

const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

describe('Contrato OpenAPI 3.1 como fuente de verdad', () => {
  const src = walk(path.resolve(import.meta.dirname, '../src')).filter((f) => f.endsWith('.ts'));
  const ops = src.flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(/@Op\('([A-Za-z]+)'\)/g)].map((m) => m[1]!));

  it('cada operación implementada existe en el contrato', () => {
    expect(ops.length).toBeGreaterThan(35);
    const missing = ops.filter((o) => !contract().ops.has(o));
    expect(missing).toEqual([]);
  });

  it('ninguna operación se implementa dos veces', () => {
    expect(ops.length).toBe(new Set(ops).size);
  });

  it('las rutas del código coinciden con las del contrato', () => {
    for (const f of src) {
      const text = fs.readFileSync(f, 'utf8');
      const controllers = [...text.matchAll(/@Controller\((?:'([^']*)')?\)/g)].map((c) => ({ at: c.index!, base: c[1] ?? '' }));
      for (const m of text.matchAll(/@(Get|Post|Put|Patch|Delete|Sse)\(([^)]*)\)\s*(?:@\w+\([^)]*\)\s*)*@Op\('([A-Za-z]+)'\)/g)) {
        const base = controllers.filter((c) => c.at < m.index!).at(-1)?.base ?? '';
        const sub = m[2]!.replace(/'/g, '');
        const route = `/${[base, sub].filter(Boolean).join('/')}`.replace(/:(\w+)/g, '{$1}');
        const op = contract().ops.get(m[3]!)!;
        const method = m[1] === 'Sse' ? 'get' : m[1]!.toLowerCase();
        expect(`${method} ${route}`, m[3]).toBe(`${op.method} ${op.path}`);
      }
    }
  });
});
