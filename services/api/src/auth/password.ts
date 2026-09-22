import argon2 from 'argon2';
import crypto from 'node:crypto';
import { Problem } from '../common/problem.js';

// Argon2id (§7.1). Parámetros por encima del mínimo recomendado por OWASP (m=19 MiB, t=2, p=1).
const ARGON = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 } as const;

export const hashPassword = (plain: string): Promise<string> => argon2.hash(plain, ARGON);
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

// Hash de referencia para igualar el tiempo de respuesta cuando el usuario no existe (evita enumerar usuarios).
let dummy: Promise<string> | null = null;
export const dummyVerify = async (plain: string): Promise<void> => {
  dummy ??= hashPassword(crypto.randomBytes(16).toString('hex'));
  await verifyPassword(await dummy, plain);
};

// Contraseñas de 12 o más caracteres presentes en las listas públicas más usadas. Solo es la última línea de
// defensa: en producción se consulta el servicio de filtraciones con k-anonimato (solo viajan 5 caracteres del hash).
const LOCAL_BREACHED = new Set([
  '123456789012', '1234567890123', '12345678901234', '123456789123', 'qwertyuiopas', 'qwertyuiop123', 'qwerty123456',
  'passwordpassword', 'password1234', 'password12345', 'password123456', 'contraseña123', 'contrasena123', 'contrasena1234',
  'iloveyou1234', 'administrator', 'administrador', 'abcdefghijkl', 'abc123456789', '1q2w3e4r5t6y', '1qaz2wsx3edc',
  'aaaaaaaaaaaa', '111111111111', '000000000000', 'zaq12wsxcde3', 'colombia1234', 'colombia2026', 'medellin1234',
  'bogota123456', 'brasil123456', 'welcome12345', 'letmein12345', 'football1234', 'princess1234', 'sunshine1234',
  'superman1234', 'trustno11234', 'dragon123456', 'monkey123456', 'master123456', 'changeme1234', 'mypassword12',
]);

export interface PasswordContext {
  username: string;
  tenantSlug: string;
  mode: 'hibp' | 'local';
}

export async function assertStrongPassword(plain: string, ctx: PasswordContext): Promise<void> {
  const lower = plain.toLowerCase();
  const weak =
    plain.length < 12 || plain.length > 128 || new Set(plain).size < 5 ||
    (ctx.username.length >= 3 && lower.includes(ctx.username.toLowerCase())) ||
    (ctx.tenantSlug.length >= 3 && lower.includes(ctx.tenantSlug.toLowerCase()));
  if (weak) throw new Problem(422, 'WEAK_PASSWORD', {}, [{ field: 'password', message: 'minLength' }]);
  if (LOCAL_BREACHED.has(lower)) throw new Problem(422, 'BREACHED_PASSWORD', {}, [{ field: 'password', message: 'other' }]);
  if (ctx.mode === 'hibp' && (await pwnedCount(plain)) > 0) throw new Problem(422, 'BREACHED_PASSWORD', {}, [{ field: 'password', message: 'other' }]);
}

/** Pwned Passwords con k-anonimato: se envían solo los 5 primeros caracteres del SHA-1. Si el servicio no responde, no bloquea. */
async function pwnedCount(plain: string): Promise<number> {
  const h = crypto.createHash('sha1').update(plain).digest('hex').toUpperCase();
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${h.slice(0, 5)}`, { headers: { 'Add-Padding': 'true' }, signal: AbortSignal.timeout(3000) });
    if (!res.ok) return 0;
    const line = (await res.text()).split('\n').find((l) => l.startsWith(h.slice(5)));
    return line ? Number(line.split(':')[1]) : 0;
  } catch {
    return 0;
  }
}
