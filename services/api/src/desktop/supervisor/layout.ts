import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Carpetas de COROC Escritorio (ADR-062). Los programas van en `%LOCALAPPDATA%\COROC\servidor` (los reemplaza cada
 * actualización) y los datos en `%LOCALAPPDATA%\COROC\datos` (nunca los toca el instalador):
 *
 *   datos\pg                 base de datos PostgreSQL de este PC
 *   datos\archivos           documentos y comprobantes, cifrados
 *   datos\secretos.bin       claves de la instalación protegidas con DPAPI (solo esta cuenta de Windows las abre)
 *   datos\estado.json        puertos y versión de la última ejecución (sin secretos)
 *   datos\registros          registros técnicos para soporte, sin datos personales
 *   datos\respaldos-previos  copia de la base antes de cada actualización
 *   datos\navegador          Chromium, solo si el PC no tiene Microsoft Edge
 */
export interface Layout {
  data: string;
  pg: string;
  files: string;
  logs: string;
  preUpdate: string;
  browser: string;
  secrets: string;
  state: string;
  lock: string;
  stopRequest: string;
  /** Carpeta del servidor: node.exe, api, pgsql, tesseract y poppler. */
  programs: string;
  api: string;
  pgBin: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * `servidor\services\api\dist\desktop\supervisor\layout.js` → la API en `servidor\services\api` y los programas en
 * `servidor` (la misma estructura del monorepo y de la imagen Docker).
 */
export function layout(opts: { data?: string; programs?: string; pgBin?: string } = {}): Layout {
  const api = path.resolve(here, '../../..');
  const programs = path.resolve(opts.programs ?? path.join(api, '..', '..'));
  const data = path.resolve(opts.data ?? path.join(process.env.LOCALAPPDATA ?? path.join(programs, '..'), process.env.LOCALAPPDATA ? 'COROC/datos' : 'datos'));
  return {
    data,
    pg: path.join(data, 'pg'),
    files: path.join(data, 'archivos'),
    logs: path.join(data, 'registros'),
    preUpdate: path.join(data, 'respaldos-previos'),
    browser: path.join(data, 'navegador'),
    secrets: path.join(data, process.platform === 'win32' ? 'secretos.bin' : 'secretos.json'),
    state: path.join(data, 'estado.json'),
    lock: path.join(data, 'supervisor.lock'),
    stopRequest: path.join(data, 'detener.solicitud'),
    programs,
    api,
    pgBin: path.resolve(opts.pgBin ?? process.env.COROC_PG_BIN ?? path.join(programs, 'pgsql', 'bin')),
  };
}

export interface State {
  version?: string;
  pgPort?: number;
  apiPort?: number;
  startedAt?: string;
  pid?: number;
  /** Proceso del servidor (soporte). */
  apiPid?: number;
}

export function readState(l: Layout): State {
  try {
    return JSON.parse(fs.readFileSync(l.state, 'utf8')) as State;
  } catch {
    return {};
  }
}

export function writeState(l: Layout, s: State): void {
  fs.writeFileSync(l.state, `${JSON.stringify(s, null, 2)}\n`);
}

/** Puerto libre en 127.0.0.1: el preferido si está libre, si no, uno que el sistema asigne. */
export async function freePort(preferred?: number): Promise<number> {
  const tryPort = (port: number) =>
    new Promise<number | null>((resolve) => {
      const srv = net.createServer();
      srv.once('error', () => resolve(null));
      srv.listen(port, '127.0.0.1', () => {
        const got = (srv.address() as net.AddressInfo).port;
        srv.close(() => resolve(got));
      });
    });
  if (preferred) {
    const p = await tryPort(preferred);
    if (p) return p;
  }
  return (await tryPort(0))!;
}

/** Registro técnico con rotación por tamaño (sin datos personales: solo eventos y códigos). */
export class LogFile {
  private readonly file: string;
  constructor(l: Layout, name: string, private readonly maxBytes = 5 * 1024 * 1024) {
    fs.mkdirSync(l.logs, { recursive: true });
    this.file = path.join(l.logs, name);
    this.rotate();
  }

  get path(): string {
    return this.file;
  }

  /** Guarda hasta tres registros anteriores: `x.log.1`, `x.log.2`, `x.log.3`. */
  rotate(): void {
    try {
      if (fs.statSync(this.file).size < this.maxBytes) return;
    } catch {
      return;
    }
    for (let i = 2; i >= 1; i--) {
      try {
        fs.renameSync(`${this.file}.${i}`, `${this.file}.${i + 1}`);
      } catch {
        /* no existía */
      }
    }
    fs.renameSync(this.file, `${this.file}.1`);
  }

  write(line: string): void {
    fs.appendFileSync(this.file, `${new Date().toISOString()} ${line}\n`);
  }
}

/** Microsoft Edge del sistema para los PDF (§4.2); Chromium descargado en `datos\navegador` si el PC no lo tiene. */
export function findBrowser(l: Layout): string | null {
  const candidates =
    process.platform === 'win32'
      ? [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean).map((b) => path.join(b!, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
      : [];
  if (process.env.COROC_CHROMIUM_PATH) candidates.unshift(process.env.COROC_CHROMIUM_PATH);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  // Chromium que el supervisor descargó antes con Playwright: la ruta exacta depende de la versión.
  try {
    for (const d of fs.readdirSync(l.browser).sort().reverse()) {
      const exe = process.platform === 'win32' ? path.join(l.browser, d, 'chrome-win', 'chrome.exe') : path.join(l.browser, d, 'chrome-linux', 'chrome');
      const shell = process.platform === 'win32' ? path.join(l.browser, d, 'chrome-win', 'headless_shell.exe') : path.join(l.browser, d, 'chrome-linux', 'headless_shell');
      if (fs.existsSync(shell)) return shell;
      if (fs.existsSync(exe)) return exe;
    }
  } catch {
    /* aún no hay */
  }
  return null;
}
