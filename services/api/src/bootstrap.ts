import 'reflect-metadata';
import crypto from 'node:crypto';
import { type INestApplication, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { loadConfig } from './config.js';

/** Construye la aplicación con los mismos ajustes en producción y en las pruebas. */
export async function createApp(opts: { logger?: false } = {}): Promise<INestApplication> {
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: opts.logger ?? ['error', 'warn', 'log'], bodyParser: false });
  // En Escritorio no hay balanceador delante: la dirección es la del propio PC.
  app.set('trust proxy', config.mode === 'desktop' ? false : 1);
  app.use(helmet());
  if (config.desktopToken) app.use(desktopGate(config.desktopToken));
  const http = new Logger('HTTP');
  app.use((req: { headers: Record<string, string | string[] | undefined>; method: string; path: string; requestId?: string }, res: any, next: () => void) => {
    // Id de petición (§20.4): se acepta el del balanceador si es seguro, o se genera; viaja en la respuesta y en los registros.
    const incoming = req.headers['x-request-id'];
    const id = typeof incoming === 'string' && /^[A-Za-z0-9._-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
    req.requestId = id;
    res.setHeader('X-Request-Id', id);
    // Las respuestas de la API contienen datos personales: ningún intermediario ni navegador las guarda (ASVS 8.2.1).
    res.setHeader('Cache-Control', 'no-store');
    const started = process.hrtime.bigint();
    // Sin datos personales: la ruta sin la consulta (las búsquedas llevan nombres), el estado y la duración.
    res.on('finish', () => http.log(`${id} ${req.method} ${req.path} ${res.statusCode} ${Number(process.hrtime.bigint() - started) / 1e6 | 0}ms`));
    next();
  });
  // Los webhooks leen el cuerpo crudo: la firma de WhatsApp se calcula sobre los bytes exactos y los correos traen adjuntos grandes.
  app.useBodyParser('json', { limit: '1mb', type: (req: { url?: string; headers: Record<string, unknown> }) => !req.url?.startsWith('/v1/webhooks/') && /json/i.test(String(req.headers['content-type'] ?? '')) });
  app.setGlobalPrefix('v1', { exclude: ['health'] });
  app.enableCors({ origin: config.corsOrigins.length ? config.corsOrigins : false, exposedHeaders: ['Idempotent-Replayed', 'X-Request-Id'] });
  app.enableShutdownHooks();
  return app;
}

export const logger = new Logger('COROC');

/** Rutas que no llevan la clave de Escritorio: la salud (supervisor) y los enlaces firmados de descarga. */
const DESKTOP_OPEN = [/^\/health$/, /^\/v1\/files\/[^/]+$/, /^\/v1\/public\/privacy$/];

/**
 * COROC Escritorio (ADR-062): la API escucha solo en 127.0.0.1 y, además, exige en cada petición la clave que el
 * supervisor generó para esta ejecución y entregó solo a la app. Así ni otra cuenta de Windows del mismo PC ni una página
 * web abierta en el navegador (CSRF o «DNS rebinding» hacia 127.0.0.1) pueden usarla.
 */
export function desktopGate(token: string) {
  const expected = crypto.createHash('sha256').update(token).digest();
  return (req: { headers: Record<string, string | string[] | undefined>; method: string; path: string }, res: any, next: () => void) => {
    if ((req.method === 'GET' || req.method === 'HEAD') && DESKTOP_OPEN.some((r) => r.test(req.path))) return next();
    const got = req.headers['x-coroc-desktop'];
    const ok = typeof got === 'string' && crypto.timingSafeEqual(crypto.createHash('sha256').update(got).digest(), expected);
    if (ok) return next();
    res.status(403).type('application/problem+json').send(JSON.stringify({ type: 'https://docs.coroc.app/problems/desktop-only', title: 'COROC', status: 403, code: 'DESKTOP_ONLY' }));
  };
}
