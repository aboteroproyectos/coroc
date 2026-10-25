import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';
import { migrate } from '../../db/migrate.js';
import type { Layout, LogFile } from './layout.js';
import type { Secrets } from './secrets.js';

const run = promisify(execFile);

/** Ajustes de PostgreSQL para un PC: poca memoria, solo 127.0.0.1 y ningún acceso sin contraseña. */
const DESKTOP_CONF = `
# ─── COROC Escritorio (ADR-062) ───
listen_addresses = '127.0.0.1'
unix_socket_directories = ''
max_connections = 40
shared_buffers = 64MB
work_mem = 8MB
maintenance_work_mem = 64MB
password_encryption = scram-sha-256
log_destination = 'stderr'
logging_collector = off
log_min_messages = warning
log_line_prefix = '%m [%p] '
timezone = 'UTC'
`;

const HBA = `# COROC Escritorio: solo conexiones de este mismo PC y siempre con contraseña.
host all all 127.0.0.1/32 scram-sha-256
`;

/** La base de datos PostgreSQL de este PC: se crea al instalar, la enciende y apaga el supervisor bajo el usuario. */
export class Cluster {
  constructor(private readonly l: Layout, private readonly log: LogFile, private readonly secrets: Secrets) {}

  private exe(name: string): string {
    return path.join(this.l.pgBin, process.platform === 'win32' ? `${name}.exe` : name);
  }

  get initialized(): boolean {
    return fs.existsSync(path.join(this.l.pg, 'PG_VERSION'));
  }

  private async pgCtl(args: string[], timeout = 120_000) {
    return run(this.exe('pg_ctl'), args, { windowsHide: true, timeout });
  }

  /** Crea la base la primera vez. La contraseña del superusuario va en un archivo temporal que solo lee el usuario. */
  async init(): Promise<void> {
    if (this.initialized) return;
    fs.mkdirSync(this.l.data, { recursive: true });
    fs.rmSync(this.l.pg, { recursive: true, force: true });
    const pwDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coroc-pg-'));
    const pwFile = path.join(pwDir, 'pw');
    fs.writeFileSync(pwFile, this.secrets.pgSuper, { mode: 0o600 });
    try {
      // ICU «und»: las tildes ordenan junto a su letra (Álvaro va con la A), igual en español, portugués e inglés.
      await run(this.exe('initdb'), ['-D', this.l.pg, '-U', 'postgres', `--pwfile=${pwFile}`, '-A', 'scram-sha-256', '-E', 'UTF8', '--locale=C', '--locale-provider=icu', '--icu-locale=und', '--no-instructions'], {
        windowsHide: true, timeout: 300_000,
      });
    } finally {
      fs.rmSync(pwDir, { recursive: true, force: true });
    }
    fs.appendFileSync(path.join(this.l.pg, 'postgresql.conf'), DESKTOP_CONF);
    fs.writeFileSync(path.join(this.l.pg, 'pg_hba.conf'), HBA);
    this.log.write('base de datos creada');
  }

  async running(): Promise<boolean> {
    if (!this.initialized) return false;
    try {
      await this.pgCtl(['status', '-D', this.l.pg], 30_000);
      return true;
    } catch {
      return false;
    }
  }

  /** Puerto en el que escucha la base que ya estaba encendida (después de un cierre inesperado del supervisor). */
  runningPort(): number | null {
    try {
      const lines = fs.readFileSync(path.join(this.l.pg, 'postmaster.pid'), 'utf8').split(/\r?\n/);
      const port = Number(lines[3]);
      return Number.isInteger(port) && port > 0 ? port : null;
    } catch {
      return null;
    }
  }

  async start(port: number, logFile: string): Promise<void> {
    await this.pgCtl(['start', '-D', this.l.pg, '-l', logFile, '-w', '-t', '90', '-o', `-p ${port}`], 150_000);
  }

  async stop(): Promise<void> {
    if (!(await this.running())) return;
    try {
      await this.pgCtl(['stop', '-D', this.l.pg, '-m', 'fast', '-w', '-t', '60'], 90_000);
    } catch {
      await this.pgCtl(['stop', '-D', this.l.pg, '-m', 'immediate', '-w', '-t', '30'], 60_000).catch(() => undefined);
    }
  }

  superUrl(port: number, db = 'postgres'): string {
    return `postgres://postgres:${encodeURIComponent(this.secrets.pgSuper)}@127.0.0.1:${port}/${db}`;
  }

  apiUrl(port: number): string {
    return `postgres://coroc_api:${encodeURIComponent(this.secrets.pgApi)}@127.0.0.1:${port}/coroc`;
  }

  /**
   * Base `coroc` al día: la crea si falta, aplica las migraciones pendientes (también después de una actualización) y
   * deja el usuario de la API sin BYPASSRLS, igual que en la nube (ADR-022).
   */
  async prepare(port: number): Promise<string[]> {
    const admin = new pg.Client({ connectionString: this.superUrl(port) });
    await admin.connect();
    try {
      const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', ['coroc']);
      if (!exists.rowCount) await admin.query('CREATE DATABASE coroc');
    } finally {
      await admin.end();
    }
    const applied = await migrate(this.superUrl(port, 'coroc'), (m) => this.log.write(`migración ${m}`));
    const c = new pg.Client({ connectionString: this.superUrl(port, 'coroc') });
    await c.connect();
    try {
      await c.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'coroc_api') THEN CREATE ROLE coroc_api LOGIN NOBYPASSRLS; END IF; END $$`);
      await c.query(`ALTER ROLE coroc_api WITH LOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${c.escapeLiteral(this.secrets.pgApi)}`);
      await c.query('GRANT coroc_app TO coroc_api');
      // Sin herencia: las políticas del Cobrador solo aplican cuando la API asume ese rol (ADR-022).
      await c.query('GRANT coroc_collector TO coroc_api WITH INHERIT FALSE, SET TRUE');
      await c.query('GRANT CONNECT ON DATABASE coroc TO coroc_api');
    } finally {
      await c.end();
    }
    return applied;
  }

  /**
   * Copia en frío de la base antes de actualizar (la base debe estar apagada). Si una actualización saliera mal, soporte
   * vuelve a esta copia con `restaurar-previo`. Se guardan las tres últimas.
   */
  async preUpdateCopy(stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)): Promise<string | null> {
    if (!this.initialized) return null;
    if (await this.running()) throw new Error('La base debe estar apagada para copiarla');
    const target = path.join(this.l.preUpdate, `${stamp}-${crypto.randomBytes(2).toString('hex')}`);
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(this.l.pg, path.join(target, 'pg'), { recursive: true, filter: (src) => path.basename(src) !== 'postmaster.pid' });
    const all = fs.readdirSync(this.l.preUpdate).filter((d) => fs.statSync(path.join(this.l.preUpdate, d)).isDirectory()).sort();
    for (const d of all.slice(0, Math.max(0, all.length - 3))) fs.rmSync(path.join(this.l.preUpdate, d), { recursive: true, force: true });
    this.log.write(`copia previa a la actualización: ${path.basename(target)}`);
    return target;
  }

  /** Vuelve a una copia previa a la actualización; la base actual queda aparte por si soporte la necesita. */
  async restorePreUpdate(folder: string): Promise<void> {
    if (await this.running()) throw new Error('La base debe estar apagada');
    const src = path.join(folder, 'pg');
    if (!fs.existsSync(path.join(src, 'PG_VERSION'))) throw new Error('No es una copia de la base');
    if (this.initialized) fs.renameSync(this.l.pg, `${this.l.pg}.anterior-${Date.now()}`);
    fs.cpSync(src, this.l.pg, { recursive: true });
    this.log.write(`base restaurada desde ${path.basename(folder)}`);
  }
}
