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
  app.set('trust proxy', 1);
  app.use(helmet());
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
