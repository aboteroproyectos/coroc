/** Configuración leída del entorno una sola vez al iniciar. Nunca se registra en los logs. */
export interface AppConfig {
  /**
   * 'cloud': servidor en internet para varias empresas. 'desktop': COROC Escritorio (ADR-062), todo en el PC del
   * usuario: una sola empresa, solo 127.0.0.1 y cada petición con la clave de esta ejecución.
   */
  mode: 'cloud' | 'desktop';
  port: number;
  /** Interfaz en la que escucha (Escritorio: 127.0.0.1). Vacío: todas. */
  host: string | null;
  /** Escritorio: clave que el supervisor genera en cada arranque y la app envía en `X-Coroc-Desktop`. */
  desktopToken: string | null;
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
  /** Dirección que abre el código QR del recibo (§15), seguida del código de verificación. En Escritorio no hay QR. */
  verifyUrlBase: string | null;
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
  /** Tamaño máximo de un `.coroc` que se sube para restaurar. */
  restoreMaxBytes: number;
  /** Lectura de comprobantes (§13.2): OCR local con Tesseract o desactivado. */
  ocr: { provider: 'tesseract' | 'none'; tesseract: string; pdftoppm: string; langs: string; maxPages: number };
  /**
   * Extracción de campos (§13.3, ADR-017): 'rules' (lector por reglas de @coroc/core) o 'claude' (IA con visión y
   * salida JSON validada, verificada por las reglas). La clave de la API nunca pasa por la base de datos.
   */
  extraction: { provider: 'rules' | 'claude'; model: string; apiKey: string | null; timeoutMs: number };
  /** Portal del deudor (§12.3): base del enlace personal de carga y su vigencia en días. */
  portalUrlBase: string;
  uploadLinkDays: number;
  /** Correo entrante (§12.2): dominio de las direcciones `pagos-<empresa>@…` y secreto del webhook del proveedor. */
  inboundEmail: { domain: string | null; secret: string | null };
  /** WhatsApp Cloud API entrante (§12.1): firma de Meta, token de verificación y Graph API. */
  whatsapp: { appSecret: string | null; verifyToken: string | null; graphUrl: string; graphVersion: string };
  /**
   * Correo saliente (§11.2, §4.5): Postmark (API HTTP), SMTP propio o de Amazon SES, o memoria (desarrollo). `from` es
   * el remitente de COROC cuando la empresa no verificó su dominio; `eventsSecret` protege el webhook de rebotes.
   */
  email: {
    provider: 'postmark' | 'smtp' | 'memory' | 'none';
    postmarkToken: string | null;
    postmarkUrl: string;
    postmarkStream: string;
    smtpUrl: string | null;
    from: string;
    eventsSecret: string | null;
    /** `include` de SPF del proveedor, para el asistente de dominio (Postmark: spf.mtasv.net). */
    spfInclude: string | null;
  };
  /**
   * Gmail de la empresa con contraseña de aplicación (ADR-065): IMAP para leer los comprobantes y SMTP para enviar. Por
   * defecto solo en Escritorio. `worker`: lector de correo en este proceso ('inline' en pruebas: `GmailInbox.syncTenant`).
   * Los servidores y `tls` solo se cambian en pruebas (servidores IMAP y SMTP locales).
   */
  gmail: { enabled: boolean; worker: 'on' | 'off' | 'inline'; imap: { host: string; port: number }; smtp: { host: string; port: number }; tls: boolean; pollSeconds: number };
  /** Mensajería (§11): vigencia del enlace seguro de descarga del recibo (días) y despachador en este proceso. */
  deliveryLinkDays: number;
  messageWorker: 'on' | 'off' | 'inline';
  /** Contacto de privacidad publicado en la política (§20.4). */
  privacyContact: string;
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
  const mode = env.COROC_MODE === 'desktop' ? 'desktop' : 'cloud';
  const desktopToken = env.COROC_DESKTOP_TOKEN || null;
  if (mode === 'desktop' && (!desktopToken || desktopToken.length < 32)) throw new Error('COROC_DESKTOP_TOKEN debe tener al menos 32 caracteres en el modo Escritorio');
  return {
    mode,
    port: Number(env.PORT ?? 3000),
    host: env.COROC_HOST || (mode === 'desktop' ? '127.0.0.1' : null),
    desktopToken: mode === 'desktop' ? desktopToken : null,
    databaseUrl: required('DATABASE_URL'),
    redisUrl: env.REDIS_URL || null,
    jwtSecret: new TextEncoder().encode(jwt),
    dataKey,
    accessTtlSeconds: Number(env.COROC_ACCESS_TTL ?? 900),
    refreshTtlDays: Number(env.COROC_REFRESH_TTL_DAYS ?? 30),
    // En Escritorio la verificación en dos pasos se ofrece y es opcional (ADR-063); en la nube es obligatoria.
    mfaRequiredForOwner: env.COROC_MFA_OWNER ? env.COROC_MFA_OWNER !== 'optional' : mode !== 'desktop',
    breachedPasswordCheck: env.COROC_BREACHED_CHECK === 'local' ? 'local' : 'hibp',
    publicAppUrl: env.COROC_PUBLIC_URL ?? 'https://app.coroc.app',
    publicApiUrl: (env.COROC_API_PUBLIC_URL ?? `http://localhost:${env.PORT ?? 3000}`).replace(/\/+$/, ''),
    clockNow: env.COROC_CLOCK_NOW || null,
    logLevel: env.LOG_LEVEL ?? 'info',
    corsOrigins: (env.COROC_CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    storage: storageConfig(env),
    chromiumPath: env.COROC_CHROMIUM_PATH || null,
    verifyUrlBase: mode === 'desktop' ? null : env.COROC_VERIFY_URL ?? `${(env.COROC_API_PUBLIC_URL ?? `http://localhost:${env.PORT ?? 3000}`).replace(/\/+$/, '')}/v1/public/receipts/`,
    documentWorker: env.COROC_DOCUMENT_WORKER === 'off' ? 'off' : env.COROC_DOCUMENT_WORKER === 'inline' ? 'inline' : 'on',
    restoreMaxBytes: Number(env.COROC_RESTORE_MAX_BYTES ?? 20 * 1024 ** 3),
    linkTtlSeconds: Math.min(3600, Math.max(30, Number(env.COROC_LINK_TTL ?? 300))),
    ocr: {
      provider: env.COROC_OCR === 'none' ? 'none' : 'tesseract',
      tesseract: env.COROC_TESSERACT_PATH || 'tesseract',
      pdftoppm: env.COROC_PDFTOPPM_PATH || 'pdftoppm',
      langs: env.COROC_OCR_LANGS || 'spa+por+eng',
      maxPages: Math.min(10, Math.max(1, Number(env.COROC_OCR_MAX_PAGES ?? 3))),
    },
    extraction: {
      provider: env.COROC_EXTRACTION === 'claude' ? 'claude' : 'rules',
      model: env.COROC_EXTRACTION_MODEL || 'claude-opus-5',
      apiKey: env.ANTHROPIC_API_KEY || null,
      timeoutMs: Number(env.COROC_EXTRACTION_TIMEOUT_MS ?? 120_000),
    },
    portalUrlBase: (env.COROC_PORTAL_URL ?? `${(env.COROC_API_PUBLIC_URL ?? `http://localhost:${env.PORT ?? 3000}`).replace(/\/+$/, '')}/v1/public/upload/`),
    uploadLinkDays: Math.min(730, Math.max(1, Number(env.COROC_UPLOAD_LINK_DAYS ?? 365))),
    inboundEmail: { domain: env.COROC_INBOUND_EMAIL_DOMAIN?.toLowerCase() || null, secret: env.COROC_INBOUND_EMAIL_SECRET || null },
    whatsapp: {
      appSecret: env.COROC_WHATSAPP_APP_SECRET || null,
      verifyToken: env.COROC_WHATSAPP_VERIFY_TOKEN || null,
      graphUrl: (env.COROC_WHATSAPP_GRAPH_URL || 'https://graph.facebook.com').replace(/\/+$/, ''),
      graphVersion: env.COROC_WHATSAPP_GRAPH_VERSION || 'v23.0',
    },
    email: {
      provider: env.COROC_EMAIL_PROVIDER === 'postmark' ? 'postmark' : env.COROC_EMAIL_PROVIDER === 'smtp' ? 'smtp' : env.COROC_EMAIL_PROVIDER === 'memory' ? 'memory' : 'none',
      postmarkToken: env.POSTMARK_SERVER_TOKEN || null,
      postmarkUrl: (env.COROC_POSTMARK_URL || 'https://api.postmarkapp.com').replace(/\/+$/, ''),
      postmarkStream: env.COROC_POSTMARK_STREAM || 'outbound',
      smtpUrl: env.COROC_SMTP_URL || null,
      from: env.COROC_EMAIL_FROM || 'notificaciones@coroc.app',
      eventsSecret: env.COROC_EMAIL_EVENTS_SECRET || null,
      spfInclude: env.COROC_EMAIL_SPF_INCLUDE || (env.COROC_EMAIL_PROVIDER === 'postmark' ? 'spf.mtasv.net' : null),
    },
    gmail: {
      enabled: env.COROC_GMAIL ? env.COROC_GMAIL === 'on' : mode === 'desktop',
      worker: env.COROC_GMAIL_WORKER === 'off' ? 'off' : env.COROC_GMAIL_WORKER === 'inline' ? 'inline' : 'on',
      imap: hostPort(env.COROC_GMAIL_IMAP, 'imap.gmail.com', 993),
      smtp: hostPort(env.COROC_GMAIL_SMTP, 'smtp.gmail.com', 465),
      tls: env.COROC_GMAIL_TLS !== 'off',
      pollSeconds: Math.min(900, Math.max(5, Number(env.COROC_GMAIL_POLL_SECONDS ?? 120))),
    },
    deliveryLinkDays: Math.min(365, Math.max(1, Number(env.COROC_DELIVERY_LINK_DAYS ?? 30))),
    messageWorker: env.COROC_MESSAGE_WORKER === 'off' ? 'off' : env.COROC_MESSAGE_WORKER === 'inline' ? 'inline' : 'on',
    privacyContact: env.COROC_PRIVACY_CONTACT || 'privacidad@coroc.app',
  };
}

function hostPort(v: string | undefined, host: string, port: number): { host: string; port: number } {
  const m = /^\[?([^\]]+?)\]?:(\d+)$/.exec(v ?? '');
  return m ? { host: m[1]!, port: Number(m[2]) } : { host, port };
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
