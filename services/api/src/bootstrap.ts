import 'reflect-metadata';
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
  // Los webhooks leen el cuerpo crudo: la firma de WhatsApp se calcula sobre los bytes exactos y los correos traen adjuntos grandes.
  app.useBodyParser('json', { limit: '1mb', type: (req: { url?: string; headers: Record<string, unknown> }) => !req.url?.startsWith('/v1/webhooks/') && /json/i.test(String(req.headers['content-type'] ?? '')) });
  app.setGlobalPrefix('v1', { exclude: ['health'] });
  app.enableCors({ origin: config.corsOrigins.length ? config.corsOrigins : false, exposedHeaders: ['Idempotent-Replayed'] });
  app.enableShutdownHooks();
  return app;
}

export const logger = new Logger('COROC');
