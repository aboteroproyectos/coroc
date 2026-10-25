import { fork, spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { findBrowser, freePort, LogFile, readState, writeState, type Layout } from './layout.js';
import { Cluster } from './postgres.js';
import { loadSecrets, type Secrets } from './secrets.js';

/** Puertos de COROC en 127.0.0.1; si están ocupados se usa otro libre (la app lo recibe en el evento «listo»). */
const PG_PORT = 54329;
const API_PORT = 41217;
const BACKOFF = [1_000, 2_000, 5_000, 10_000, 30_000];

/** Eventos para la app (una línea JSON por evento en la salida estándar). Nunca llevan datos personales. */
export type Event =
  | { evento: 'iniciando'; paso: 'claves' | 'base' | 'migraciones' | 'servidor' }
  | { evento: 'listo'; api: string; clave: string; version: string; datos: string }
  | { evento: 'reiniciando'; motivo: 'servidor' | 'base' }
  | { evento: 'error'; codigo: string; detalle?: string }
  | { evento: 'detenido'; motivo: StopReason };

/** Por qué se apagó: la app lo pidió (o se cerró), el instalador va a actualizar o desinstalar, o falló el arranque. */
export type StopReason = 'app' | 'instalador' | 'error';

export class SupervisorError extends Error {
  constructor(readonly code: string, detail?: string) {
    super(detail ?? code);
  }
}

/**
 * Supervisor de COROC Escritorio (ADR-062): enciende la base PostgreSQL de este PC y el servidor de COROC (la API),
 * los vigila (salud cada 10 s, reinicio con espera creciente si algo cae) y los apaga en orden. Lo abre la app al
 * arrancar; si la app se cierra del todo, su entrada estándar se cierra y el supervisor apaga todo.
 */
export class Supervisor {
  private readonly log: LogFile;
  private cluster!: Cluster;
  private secrets!: Secrets;
  private api: ChildProcess | null = null;
  private apiLog: fs.WriteStream | null = null;
  private apiPort = 0;
  private pgPort = 0;
  readonly token = crypto.randomBytes(32).toString('base64url');
  private stopping: Promise<void> | null = null;
  private failures = 0;
  private restarts = 0;
  private lastRestartAt = 0;
  private healthyAt = 0;
  private timers: NodeJS.Timeout[] = [];
  private restarting = false;

  constructor(private readonly l: Layout, private readonly emit: (e: Event) => void = () => undefined, private readonly opts: { healthMs?: number; apiEntry?: string } = {}) {
    fs.mkdirSync(l.data, { recursive: true });
    this.log = new LogFile(l, 'supervisor.log');
  }

  get version(): string {
    try {
      return fs.readFileSync(path.join(this.l.programs, 'VERSION'), 'utf8').trim();
    } catch {
      return JSON.parse(fs.readFileSync(path.join(this.l.api, 'package.json'), 'utf8')).version as string;
    }
  }

  /** Un solo supervisor por instalación: si quedó otro (o su archivo de bloqueo), se le pide parar o se limpia. */
  private async lock(): Promise<void> {
    for (let i = 0; i < 2; i++) {
      try {
        fs.writeFileSync(this.l.lock, String(process.pid), { flag: 'wx' });
        return;
      } catch {
        const pid = Number(fs.readFileSync(this.l.lock, 'utf8'));
        if (pid && pid !== process.pid && alive(pid)) {
          this.log.write(`otro supervisor (${pid}) seguía activo: se le pide parar`);
          fs.writeFileSync(this.l.stopRequest, 'detener');
          if (!(await waitFor(() => !fs.existsSync(this.l.lock), 60_000))) throw new SupervisorError('YA_INICIADO');
        } else {
          fs.rmSync(this.l.lock, { force: true });
        }
      }
    }
    throw new SupervisorError('YA_INICIADO');
  }

  async start(): Promise<{ api: string; token: string }> {
    await this.lock();
    fs.rmSync(this.l.stopRequest, { force: true });
    this.log.write(`inicio (versión ${this.version}, pid ${process.pid})`);
    try {
      this.emit({ evento: 'iniciando', paso: 'claves' });
      this.secrets = (await loadSecrets(this.l, { create: true }))!;
      this.cluster = new Cluster(this.l, this.log, this.secrets);
      this.emit({ evento: 'iniciando', paso: 'base' });
      await this.startDatabase();
      this.emit({ evento: 'iniciando', paso: 'migraciones' });
      const applied = await this.cluster.prepare(this.pgPort);
      if (applied.length) this.log.write(`migraciones aplicadas: ${applied.join(', ')}`);
      fs.mkdirSync(this.l.files, { recursive: true });
      this.emit({ evento: 'iniciando', paso: 'servidor' });
      this.apiPort = await freePort(readState(this.l).apiPort ?? API_PORT);
      await this.startApi();
      writeState(this.l, { version: this.version, pgPort: this.pgPort, apiPort: this.apiPort, startedAt: new Date().toISOString(), pid: process.pid, apiPid: this.api?.pid });
      this.watch();
      const api = `http://127.0.0.1:${this.apiPort}/v1`;
      this.emit({ evento: 'listo', api, clave: this.token, version: this.version, datos: this.l.data });
      this.log.write(`listo en el puerto ${this.apiPort}`);
      if (!findBrowser(this.l)) void this.downloadBrowser();
      return { api, token: this.token };
    } catch (e) {
      const code = e instanceof SupervisorError ? e.code : 'INICIO_FALLIDO';
      this.log.write(`error al iniciar: ${code} ${(e as Error).message}`);
      await this.stop('error');
      throw e instanceof SupervisorError ? e : new SupervisorError(code, (e as Error).message);
    }
  }

  private async startDatabase(): Promise<void> {
    if (!this.cluster.initialized) {
      this.log.write('primera vez: se crea la base de datos');
      await this.cluster.init();
    }
    if (await this.cluster.running()) {
      // El supervisor anterior se cerró sin apagar la base (corte de luz, cierre forzado): se usa la que ya corre.
      const port = this.cluster.runningPort();
      if (port) {
        this.pgPort = port;
        this.log.write(`la base ya estaba encendida en el puerto ${port}`);
        return;
      }
      await this.cluster.stop();
    }
    this.pgPort = await freePort(readState(this.l).pgPort ?? PG_PORT);
    const pgLog = new LogFile(this.l, 'postgres.log', 10 * 1024 * 1024);
    try {
      await this.cluster.start(this.pgPort, pgLog.path);
    } catch (e) {
      throw new SupervisorError('BASE_NO_INICIA', (e as Error).message);
    }
  }

  private apiEnv(): NodeJS.ProcessEnv {
    const browser = findBrowser(this.l);
    const tess = path.join(this.l.programs, 'tesseract', process.platform === 'win32' ? 'tesseract.exe' : 'tesseract');
    const pdftoppm = path.join(this.l.programs, 'poppler', 'bin', process.platform === 'win32' ? 'pdftoppm.exe' : 'pdftoppm');
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: 'production',
      COROC_MODE: 'desktop',
      COROC_DESKTOP_TOKEN: this.token,
      COROC_HOST: '127.0.0.1',
      PORT: String(this.apiPort),
      DATABASE_URL: this.cluster.apiUrl(this.pgPort),
      COROC_JWT_SECRET: this.secrets.jwt,
      COROC_DATA_KEY: this.secrets.dataKey,
      COROC_STORAGE: 'fs',
      COROC_STORAGE_DIR: this.l.files,
      COROC_API_PUBLIC_URL: `http://127.0.0.1:${this.apiPort}`,
      COROC_PUBLIC_URL: `http://127.0.0.1:${this.apiPort}`,
      COROC_EMAIL_PROVIDER: 'none',
      COROC_OCR_LANGS: 'spa+por+eng',
      PLAYWRIGHT_BROWSERS_PATH: this.l.browser,
    };
    if (browser) env.COROC_CHROMIUM_PATH = browser;
    if (fs.existsSync(tess)) {
      env.COROC_TESSERACT_PATH = tess;
      env.TESSDATA_PREFIX = path.join(this.l.programs, 'tesseract', 'tessdata');
    }
    if (fs.existsSync(pdftoppm)) env.COROC_PDFTOPPM_PATH = pdftoppm;
    // Nada de la base de administración llega a la API (ADR-060).
    delete env.DATABASE_ADMIN_URL;
    delete env.DATABASE_SUPERUSER_URL;
    return env;
  }

  /** Enciende la API y espera a que responda la salud (o que avise por IPC que ya escucha). */
  private async startApi(): Promise<void> {
    const entry = this.opts.apiEntry ?? path.join(this.l.api, 'dist', 'main.js');
    const apiLog = new LogFile(this.l, 'api.log', 10 * 1024 * 1024);
    this.apiLog = fs.createWriteStream(apiLog.path, { flags: 'a' });
    const child = fork(entry, [], { cwd: this.l.api, env: this.apiEnv(), stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true, execArgv: [] });
    this.api = child;
    child.stdout?.pipe(this.apiLog, { end: false });
    child.stderr?.pipe(this.apiLog, { end: false });
    child.once('exit', (code, signal) => this.onApiExit(child, code, signal));
    const ok = await waitFor(async () => (child.exitCode !== null ? 'exit' : (await this.healthy()) ? 'ok' : false), 120_000, 500);
    if (ok !== 'ok') throw new SupervisorError('SERVIDOR_NO_INICIA', child.exitCode !== null ? `salió con ${child.exitCode}` : 'sin respuesta');
    this.healthyAt = Date.now();
    this.failures = 0;
    if (this.secrets) writeState(this.l, { ...readState(this.l), apiPid: child.pid });
  }

  private async healthy(): Promise<boolean> {
    try {
      const r = await fetch(`http://127.0.0.1:${this.apiPort}/health`, { signal: AbortSignal.timeout(3000) });
      return r.ok;
    } catch {
      return false;
    }
  }

  private onApiExit(child: ChildProcess, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.api !== child) return;
    this.api = null;
    if (this.stopping) return;
    this.log.write(`el servidor se detuvo (código ${code ?? signal}): se reinicia`);
    void this.restartApi();
  }

  /** Reinicio con espera creciente (1 s, 2 s, 5 s, 10 s, 30 s); si el último reinicio fue hace más de 5 minutos, vuelve a 1 s. */
  private async restartApi(): Promise<void> {
    if (this.restarting || this.stopping) return;
    this.restarting = true;
    try {
      for (;;) {
        if (Date.now() - this.lastRestartAt > 5 * 60_000) this.restarts = 0;
        await sleep(BACKOFF[Math.min(this.restarts, BACKOFF.length - 1)]!);
        this.restarts++;
        this.lastRestartAt = Date.now();
        if (this.stopping) return;
        try {
          this.emit({ evento: 'reiniciando', motivo: 'servidor' });
          if (this.api) await this.stopApi();
          if (!(await this.cluster.running())) {
            this.emit({ evento: 'reiniciando', motivo: 'base' });
            await this.startDatabase();
          }
          await this.startApi();
          this.log.write('servidor reiniciado');
          return;
        } catch (e) {
          this.log.write(`no se pudo reiniciar: ${(e as Error).message}`);
        }
      }
    } finally {
      this.restarting = false;
    }
  }

  /** Salud cada 10 s; tres fallas seguidas reinician el servidor. También atiende la solicitud de apagado del instalador. */
  private watch(): void {
    const every = this.opts.healthMs ?? 10_000;
    this.timers.push(setInterval(() => void (async () => {
      if (this.stopping || this.restarting || !this.api) return;
      if (await this.healthy()) {
        this.failures = 0;
        this.healthyAt = Date.now();
        return;
      }
      if (++this.failures >= 3) {
        this.log.write('el servidor no responde: se reinicia');
        this.failures = 0;
        this.api?.kill();
      }
    })(), every));
    this.timers.push(setInterval(() => {
      if (fs.existsSync(this.l.stopRequest)) {
        fs.rmSync(this.l.stopRequest, { force: true });
        this.log.write('apagado pedido por el instalador');
        void this.stop('instalador');
      }
    }, 1000));
    for (const t of this.timers) t.unref();
  }

  private async stopApi(): Promise<void> {
    const child = this.api;
    if (!child) return;
    this.api = null;
    if (child.exitCode !== null) return;
    const exited = new Promise<void>((ok) => child.once('exit', () => ok()));
    // En Windows no hay SIGTERM: el cierre ordenado se pide por el canal IPC (main.ts).
    try {
      child.send('shutdown');
    } catch {
      child.kill();
    }
    if (!(await waitFor(() => child.exitCode !== null || child.signalCode !== null, 20_000, 200))) child.kill('SIGKILL');
    await Promise.race([exited, sleep(5000)]);
  }

  /** Apaga en orden: primero el servidor (termina lo que tenía en curso) y después la base. */
  stop(reason: StopReason = 'app'): Promise<void> {
    this.stopping ??= (async () => {
      for (const t of this.timers) clearInterval(t);
      await this.stopApi().catch(() => undefined);
      this.apiLog?.end();
      await this.cluster?.stop().catch((e: Error) => this.log.write(`la base no se apagó bien: ${e.message}`));
      try {
        if (Number(fs.readFileSync(this.l.lock, 'utf8')) === process.pid) fs.rmSync(this.l.lock, { force: true });
      } catch {
        /* ya no estaba */
      }
      this.log.write('detenido');
      this.emit({ evento: 'detenido', motivo: reason });
    })();
    return this.stopping;
  }

  /** Sin Microsoft Edge: se descarga Chromium una sola vez y el servidor se reinicia para usarlo en los PDF. */
  private async downloadBrowser(): Promise<void> {
    const cli = path.join(this.l.api, 'node_modules', 'playwright-core', 'cli.js');
    const alt = path.join(this.l.api, '..', '..', 'node_modules', 'playwright-core', 'cli.js');
    const script = fs.existsSync(cli) ? cli : alt;
    if (!fs.existsSync(script)) return;
    this.log.write('no hay Microsoft Edge: se descarga Chromium para los PDF');
    const code = await new Promise<number | null>((ok) => {
      const p = spawn(process.execPath, [script, 'install', 'chromium-headless-shell'], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: this.l.browser }, stdio: 'ignore', windowsHide: true });
      p.once('exit', ok);
      p.once('error', () => ok(null));
    });
    if (code === 0 && findBrowser(this.l) && !this.stopping) {
      this.log.write('Chromium listo: se reinicia el servidor');
      await this.stopApi();
      await this.startApi().catch(() => this.restartApi());
    }
  }
}

/**
 * Antes de actualizar (lo llama el instalador): apaga COROC si está abierto y copia la base en frío. Devuelve la
 * carpeta de la copia, o null si aún no hay datos.
 */
export async function preUpdate(l: Layout): Promise<string | null> {
  await requestStop(l);
  const secrets = await loadSecrets(l, { create: false });
  if (!secrets) return null;
  const log = new LogFile(l, 'supervisor.log');
  const cluster = new Cluster(l, log, secrets);
  await cluster.stop();
  return cluster.preUpdateCopy();
}

/** Pide al supervisor que esté corriendo que apague todo y espera a que termine. */
export async function requestStop(l: Layout, timeoutMs = 90_000): Promise<boolean> {
  if (!fs.existsSync(l.lock)) return true;
  const pid = Number(fs.readFileSync(l.lock, 'utf8'));
  if (!pid || !alive(pid)) {
    fs.rmSync(l.lock, { force: true });
    return true;
  }
  fs.mkdirSync(l.data, { recursive: true });
  fs.writeFileSync(l.stopRequest, 'detener');
  return waitFor(() => !fs.existsSync(l.lock), timeoutMs);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const sleep = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

async function waitFor<T>(fn: () => T | Promise<T>, timeoutMs: number, everyMs = 500): Promise<T | false> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) return false;
    await sleep(everyMs);
  }
}
