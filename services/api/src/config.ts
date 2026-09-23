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
  /** URL pública de esta API, para los enlaces firmados de descarga. */
  publicApiUrl: string;
  /** Dirección que abre el código QR del recibo (§15), seguida del código de verificación. */
  verifyUrlBase: string;
  clockNow: string | null;
  logLevel: string;
  corsOrigins: string[];
  storage: {
    driver: 'fs' | 's3';
    dir?: string;
    bucket?: string;
    region?: string;
    endpoint?: string;
    forcePathStyle?: boolean;
    sse?: 'AES256' | 'aws:kms';
    prefix?: string;
  };
  /** Chromium para los PDF (§4.2). Vacío: el que instala Playwright. */
  chromiumPath: string | null;
  /** Tareas de documentos en este proceso: 'on' (por defecto), 'off' (solo API) o 'inline' (pruebas: se esperan con `idle()`). */
  documentWorker: 'on' | 'off' | 'inline';
  /** Validez de los enlaces firmados de descarga, en segundos. */
  linkTtlSeconds: number;
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
    publicApiUrl: (env.COROC_API_PUBLIC_URL ?? `http://localhost:${env.PORT ?? 3000}`).replace(/\/+$/, ''),
    clockNow: env.COROC_CLOCK_NOW || null,
    logLevel: env.LOG_LEVEL ?? 'info',
    corsOrigins: (env.COROC_CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    storage: storageConfig(env),
    chromiumPath: env.COROC_CHROMIUM_PATH || null,
    verifyUrlBase: env.COROC_VERIFY_URL ?? `${(env.COROC_API_PUBLIC_URL ?? `http://localhost:${env.PORT ?? 3000}`).replace(/\/+$/, '')}/v1/public/receipts/`,
    documentWorker: env.COROC_DOCUMENT_WORKER === 'off' ? 'off' : env.COROC_DOCUMENT_WORKER === 'inline' ? 'inline' : 'on',
    linkTtlSeconds: Math.min(3600, Math.max(30, Number(env.COROC_LINK_TTL ?? 300))),
  };
}

function storageConfig(env: NodeJS.ProcessEnv): AppConfig['storage'] {
  if ((env.COROC_STORAGE ?? 'fs') === 's3') {
    const bucket = required('COROC_S3_BUCKET');
    const sse = env.COROC_S3_SSE === 'AES256' || env.COROC_S3_SSE === 'aws:kms' ? env.COROC_S3_SSE : undefined;
    return { driver: 's3', bucket, region: env.COROC_S3_REGION ?? env.AWS_REGION ?? 'us-east-1', endpoint: env.COROC_S3_ENDPOINT || undefined, forcePathStyle: env.COROC_S3_PATH_STYLE === 'true', sse, prefix: env.COROC_S3_PREFIX || undefined };
  }
  return { driver: 'fs', dir: env.COROC_STORAGE_DIR ?? './data/objects' };
}

export const CONFIG = Symbol('CONFIG');
