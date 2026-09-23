/** Configuración leída del entorno una sola vez al iniciar. Nunca se registra en los logs. */
export interface AppConfig {
  port: number;
  databaseUrl: string;
  redisUrl: string | null;
  jwtSecret: Uint8Array;
  dataKey: Buffer;
  accessTtlSeconds: number;
  refreshTtlDays: number;
  mfaRequiredForOwner: boolean;
  breachedPasswordCheck: 'hibp' | 'local';
  publicAppUrl: string;
  clockNow: string | null;
  logLevel: string;
  corsOrigins: string[];
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

export function loadConfig(env = process.env): AppConfig {
  const jwt = required('COROC_JWT_SECRET');
  if (Buffer.byteLength(jwt) < 32) throw new Error('COROC_JWT_SECRET debe tener al menos 32 bytes');
  const dataKey = Buffer.from(required('COROC_DATA_KEY'), 'base64');
  if (dataKey.length !== 32) throw new Error('COROC_DATA_KEY debe ser una clave AES-256 en base64 (32 bytes)');
  return {
    port: Number(env.PORT ?? 3000),
    databaseUrl: required('DATABASE_URL'),
    redisUrl: env.REDIS_URL || null,
    jwtSecret: new TextEncoder().encode(jwt),
    dataKey,
    accessTtlSeconds: Number(env.COROC_ACCESS_TTL ?? 900),
    refreshTtlDays: Number(env.COROC_REFRESH_TTL_DAYS ?? 30),
    mfaRequiredForOwner: env.COROC_MFA_OWNER !== 'optional',
    breachedPasswordCheck: env.COROC_BREACHED_CHECK === 'local' ? 'local' : 'hibp',
    publicAppUrl: env.COROC_PUBLIC_URL ?? 'https://app.coroc.app',
    clockNow: env.COROC_CLOCK_NOW || null,
    logLevel: env.LOG_LEVEL ?? 'info',
    corsOrigins: (env.COROC_CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  };
}

export const CONFIG = Symbol('CONFIG');
