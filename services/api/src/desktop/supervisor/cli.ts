// Supervisor de COROC Escritorio (ADR-062). Lo usan la app y el instalador; nadie lo escribe a mano.
//   node supervisor/cli.js iniciar [--datos <carpeta>] [--programas <carpeta>] [--sin-entrada]
//   node supervisor/cli.js detener | respaldo-previo | restaurar-previo <carpeta> | estado
// Cada evento sale como una línea JSON en la salida estándar; los registros técnicos van a datos\registros.
import fs from 'node:fs';
import { layout, readState } from './layout.js';
import { Cluster } from './postgres.js';
import { loadSecrets } from './secrets.js';
import { LogFile } from './layout.js';
import { preUpdate, requestStop, Supervisor, SupervisorError, type Event } from './supervisor.js';

const [cmd = 'iniciar', ...rest] = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const l = layout({ data: arg('datos'), programs: arg('programas') });
const out = (e: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(e)}\n`);
const fail = (e: unknown): never => {
  out({ evento: 'error', codigo: e instanceof SupervisorError ? e.code : 'ERROR', detalle: (e as Error).message?.slice(0, 300) });
  process.exit(1);
};

switch (cmd) {
  case 'iniciar': {
    const sup = new Supervisor(l, (e: Event) => {
      out(e);
      // Apagado pedido por el instalador o por la app: se sale cuando todo quedó apagado.
      if (e.evento === 'detenido') setTimeout(() => process.exit(0), 100);
    });
    const shutdown = () => void sup.stop();
    // La app escribe «detener» o se cierra (fin de la entrada estándar): en ambos casos se apaga todo en orden.
    if (!rest.includes('--sin-entrada')) {
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (d: string) => {
        if (d.includes('detener')) shutdown();
      });
      process.stdin.on('end', shutdown);
    }
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    await sup.start().catch(fail);
    break;
  }
  case 'detener': {
    const ok = await requestStop(l).catch(fail);
    out(ok ? { evento: 'detenido' } : { evento: 'error', codigo: 'NO_SE_DETUVO' });
    process.exit(ok ? 0 : 1);
    break;
  }
  case 'respaldo-previo': {
    const folder = await preUpdate(l).catch(fail);
    out({ evento: 'respaldo-previo', carpeta: folder });
    process.exit(0);
    break;
  }
  case 'restaurar-previo': {
    const folder = rest.find((x) => !x.startsWith('--') && x !== arg('datos') && x !== arg('programas'));
    if (!folder || !fs.existsSync(folder)) fail(new SupervisorError('CARPETA_NO_EXISTE'));
    await requestStop(l).catch(fail);
    const secrets = await loadSecrets(l, { create: false }).catch(fail);
    if (!secrets) fail(new SupervisorError('SIN_DATOS'));
    await new Cluster(l, new LogFile(l, 'supervisor.log'), secrets!).restorePreUpdate(folder!).catch(fail);
    out({ evento: 'restaurado', carpeta: folder });
    process.exit(0);
    break;
  }
  case 'estado': {
    const lock = fs.existsSync(l.lock) ? Number(fs.readFileSync(l.lock, 'utf8')) : null;
    out({ evento: 'estado', instalado: fs.existsSync(l.secrets), iniciado: !!lock, ...readState(l), datos: l.data });
    process.exit(0);
    break;
  }
  default:
    fail(new SupervisorError('COMANDO_DESCONOCIDO', cmd));
}
