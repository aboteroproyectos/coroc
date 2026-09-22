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
  app.useBodyParser('json', { limit: '1mb' });
  app.setGlobalPrefix('v1', { exclude: ['health'] });
  app.enableCors({ origin: config.corsOrigins.length ? config.corsOrigins : false, exposedHeaders: ['Idempotent-Replayed'] });
  app.enableShutdownHooks();
  return app;
}

export const logger = new Logger('COROC');
