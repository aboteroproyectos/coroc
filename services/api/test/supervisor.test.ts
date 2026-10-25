// Fase 10 · Supervisor de COROC Escritorio (ADR-062, E-2): crea la base PostgreSQL del PC, aplica las migraciones,
// enciende el servidor con la clave de la ejecución, lo reinicia si se cae, apaga todo en orden (también si la app se
// cierra) y, al volver a encender, los datos siguen ahí. Corre con los binarios de PostgreSQL 16 del sistema y el
// supervisor ya compilado (npm run build); initdb no corre como root.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { afterAll, describe, expect, it } from 'vitest';

const PG_BIN = process.env.COROC_PG_BIN ?? '/usr/lib/postgresql/16/bin';
const CLI = path.resolve(import.meta.dirname, '../dist/desktop/supervisor/cli.js');
const canRun = fs.existsSync(path.join(PG_BIN, 'initdb')) && fs.existsSync(CLI) && process.getuid?.() !== 0;
const run = canRun ? describe : describe.skip;

type Ev = Record<string, any>;

function start(data: string): { child: ChildProcess; events: Ev[]; next: (ev: string, ms?: number) => Promise<Ev> } {
  const child = spawn(process.execPath, [CLI, 'iniciar', '--datos', data], { env: { ...process.env, COROC_PG_BIN: PG_BIN }, stdio: ['pipe', 'pipe', 'inherit'] });
  const events: Ev[] = [];
  const waiters: { ev: string; ok: (e: Ev) => void }[] = [];
  readline.createInterface({ input: child.stdout! }).on('line', (line) => {
    const e = JSON.parse(line) as Ev;
    events.push(e);
    for (const w of waiters.filter((x) => x.ev === e.evento)) {
      waiters.splice(waiters.indexOf(w), 1);
      w.ok(e);
    }
  });
  const next = (ev: string, ms = 120_000) =>
    new Promise<Ev>((ok, ko) => {
      const seen = events.find((e) => e.evento === ev && !(e as { _used?: boolean })._used);
      if (seen) {
        (seen as { _used?: boolean })._used = true;
        return ok(seen);
      }
      const t = setTimeout(() => ko(new Error(`sin evento ${ev}: ${JSON.stringify(events)}`)), ms);
      waiters.push({ ev, ok: (e) => (clearTimeout(t), ((e as { _used?: boolean })._used = true), ok(e)) });
    });
  return { child, events, next };
}

/** Espera a que el proceso termine (o ya terminó). */
const exited = (c: ChildProcess) => (c.exitCode !== null || c.signalCode !== null ? Promise.resolve() : new Promise<void>((r) => c.once('exit', () => r())));

const cli = (data: string, ...args: string[]) =>
  new Promise<Ev[]>((ok) => {
    const p = spawn(process.execPath, [CLI, ...args, '--datos', data], { env: { ...process.env, COROC_PG_BIN: PG_BIN }, stdio: ['ignore', 'pipe', 'inherit'] });
    const out: Ev[] = [];
    readline.createInterface({ input: p.stdout! }).on('line', (l) => out.push(JSON.parse(l)));
    p.on('exit', () => ok(out));
  });

run('Supervisor de COROC Escritorio (Fase 10)', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'coroc datos ñandú-'));
  afterAll(async () => {
    await cli(data, 'detener');
    fs.rmSync(data, { recursive: true, force: true });
  });

  it('E-2: instala la base, enciende el servidor, lo reinicia si se cae y conserva los datos al volver a encender', async () => {
    const a = start(data);
    const ready = await a.next('listo');
    expect(a.events.map((e) => e.evento).slice(0, 4)).toEqual(['iniciando', 'iniciando', 'iniciando', 'iniciando']);
    expect(ready.api).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/);
    const key = { 'X-Coroc-Desktop': ready.clave as string, 'Content-Type': 'application/json' };
    expect((await fetch(`${ready.api}/desktop/status`)).status).toBe(403);
    expect(await (await fetch(`${ready.api}/desktop/status`, { headers: key })).json()).toEqual({ configured: false, company: null, restore: null });
    const setup = await fetch(`${ready.api}/desktop/setup`, {
      method: 'POST', headers: key,
      body: JSON.stringify({ company: { name: 'Prueba del Supervisor', country: 'US' }, owner: { name: 'Ana', username: 'ana', password: 'Supervisor-Seguro-2026' }, deviceId: 'pc-prueba-0001' }),
    });
    expect(setup.status).toBe(201);
    // El servidor se cae: el supervisor lo vuelve a encender con la misma clave.
    const state = JSON.parse(fs.readFileSync(path.join(data, 'estado.json'), 'utf8'));
    process.kill(state.apiPid, 'SIGKILL');
    await a.next('reiniciando', 30_000);
    for (let i = 0; i < 60 && !(await fetch(`${ready.api.replace('/v1', '')}/health`).then((r) => r.ok, () => false)); i++) await new Promise((r) => setTimeout(r, 500));
    expect((await fetch(`${ready.api}/desktop/status`, { headers: key })).status).toBe(200);
    // La app se cierra: la entrada estándar termina y el supervisor apaga todo en orden.
    a.child.stdin!.end();
    await a.next('detenido', 60_000);
    await exited(a.child);
    expect(fs.existsSync(path.join(data, 'supervisor.lock'))).toBe(false);

    // Antes de una actualización: copia en frío de la base.
    const copy = await cli(data, 'respaldo-previo');
    expect(copy[0]).toMatchObject({ evento: 'respaldo-previo' });
    expect(fs.existsSync(path.join(copy[0]!.carpeta, 'pg', 'PG_VERSION'))).toBe(true);

    const b = start(data);
    const again = await b.next('listo');
    expect(again.clave).not.toBe(ready.clave);
    const st = await (await fetch(`${again.api}/desktop/status`, { headers: { 'X-Coroc-Desktop': again.clave } })).json();
    expect(st).toMatchObject({ configured: true, company: { name: 'Prueba del Supervisor', slug: 'prueba-del-supervisor' } });
    const off = await cli(data, 'detener');
    expect(off).toEqual([{ evento: 'detenido' }]);
    await exited(b.child);
  }, 300_000);
});
