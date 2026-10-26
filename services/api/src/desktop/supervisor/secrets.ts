import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { promisify } from 'node:util';
import type { Layout } from './layout.js';

const run = promisify(execFile);

/** Claves de la instalación: se generan una vez al instalar y nunca se muestran (ADR-062). */
export interface Secrets {
  /** Firma de las sesiones de la API. */
  jwt: string;
  /** Clave AES-256 de los documentos y secretos guardados (base64). */
  dataKey: string;
  /** Superusuario de PostgreSQL de este PC (solo el supervisor lo usa: migraciones y roles). */
  pgSuper: string;
  /** Usuario de la API en PostgreSQL, sin BYPASSRLS. */
  pgApi: string;
}

export function newSecrets(): Secrets {
  const r = (n: number) => crypto.randomBytes(n).toString('base64url');
  return { jwt: r(48), dataKey: crypto.randomBytes(32).toString('base64'), pgSuper: r(24), pgApi: r(24) };
}

/** Entropía propia de COROC: otra aplicación de la misma cuenta no descifra el archivo por accidente. */
const ENTROPY = 'COROC-Escritorio-2026';

/**
 * DPAPI de Windows (CurrentUser) desde PowerShell, que trae todo Windows 10 y 11: el archivo solo lo abre esta cuenta de
 * Windows en este PC. Los datos van por variable de entorno, nunca en la línea de comandos.
 */
async function dpapi(op: 'Protect' | 'Unprotect', b64: string): Promise<string> {
  const script = [
    'Add-Type -AssemblyName System.Security',
    '$e = [Text.Encoding]::UTF8.GetBytes($env:COROC_DPAPI_ENTROPY)',
    `$o = [System.Security.Cryptography.ProtectedData]::${op}([Convert]::FromBase64String($env:COROC_DPAPI_IN), $e, 'CurrentUser')`,
    '[Console]::Out.Write([Convert]::ToBase64String($o))',
  ].join('; ');
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    env: { ...process.env, COROC_DPAPI_IN: b64, COROC_DPAPI_ENTROPY: ENTROPY },
    windowsHide: true,
    timeout: 60_000,
  });
  return stdout.trim();
}

/**
 * Lee las claves o, la primera vez, las crea. En Windows quedan cifradas con DPAPI; en Linux y macOS (pruebas y
 * desarrollo) en un archivo que solo lee el usuario.
 */
export async function loadSecrets(l: Layout, opts: { create: boolean }): Promise<Secrets | null> {
  if (!fs.existsSync(l.secrets)) {
    if (!opts.create) return null;
    const s = newSecrets();
    const json = Buffer.from(JSON.stringify(s)).toString('base64');
    const body = process.platform === 'win32' ? await dpapi('Protect', json) : json;
    fs.mkdirSync(l.data, { recursive: true });
    // Se escribe primero a un temporal: un corte de luz no deja un archivo de claves a medias.
    fs.writeFileSync(`${l.secrets}.tmp`, body, { mode: 0o600 });
    fs.renameSync(`${l.secrets}.tmp`, l.secrets);
    return s;
  }
  const body = fs.readFileSync(l.secrets, 'utf8').trim();
  const json = process.platform === 'win32' ? await dpapi('Unprotect', body) : body;
  return JSON.parse(Buffer.from(json, 'base64').toString('utf8')) as Secrets;
}
