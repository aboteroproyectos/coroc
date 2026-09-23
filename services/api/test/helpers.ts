import crypto from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { expect } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { createTenant } from '../src/cli/tenant-create.js';
import { Clock } from '../src/common/clock.js';
import { contract } from '../src/common/openapi.js';
import { hotp, base32Decode, counterAt } from '../src/auth/totp.js';

export const PASSWORD = 'Cobranza-Segura-2026';

export async function bootApp(clockIso = '2026-10-09T14:00:00Z') {
  const app = await createApp({ logger: process.env.TEST_LOGS ? undefined : false });
  await app.init();
  const clock = app.get(Clock);
  clock.set(clockIso);
  return { app, clock, http: () => request(app.getHttpServer()) };
}

let n = 0;
export const uniq = (p: string) => `${p}-${process.pid}-${++n}-${crypto.randomBytes(2).toString('hex')}`.slice(0, 40);

export async function newTenant(opts: { country?: 'CO' | 'BR' | 'US'; slug?: string; lang?: 'es' | 'pt-BR' | 'en' } = {}) {
  const slug = opts.slug ?? uniq('emp');
  const r = await createTenant(process.env.DATABASE_ADMIN_URL!, { slug, name: `Empresa ${slug}`, country: opts.country ?? 'CO', lang: opts.lang, owner: 'propietario', ownerName: 'Ana Dueña', email: 'ana@example.com', password: PASSWORD });
  return { slug, ...r };
}

export const totpNow = (secretB32: string, at: Date, step = 0) => hotp(base32Decode(secretB32), counterAt(at) + step);

/** Ingreso completo del Propietario: contraseña → activación obligatoria del segundo factor. */
export async function ownerSession(t: { http: () => request.Agent | any; clock: Clock }, slug: string, deviceId = 'dispositivo-prueba-1') {
  const res = await t.http().post('/v1/auth/login').send({ tenant: slug, username: 'propietario', password: PASSWORD, deviceId }).expect(200);
  if (res.body.mfa_required) throw new Error('Se esperaba activación, no desafío');
  expect(res.body.mfaEnrollmentRequired).toBe(true);
  const enroll = await t.http().post('/v1/me/mfa/enroll').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
  const code = totpNow(enroll.body.secret, t.clock.now());
  const ok = await t.http().post('/v1/me/mfa/confirm').set('Authorization', `Bearer ${res.body.accessToken}`).send({ code }).expect(200);
  return { token: ok.body.accessToken as string, refresh: ok.body.refreshToken as string, secret: enroll.body.secret as string, user: ok.body.user, deviceId };
}

/** Valida la respuesta contra el contrato OpenAPI (operación y código de estado). */
export function expectContract(operationId: string, status: number, body: unknown): void {
  const op = contract().ops.get(operationId);
  if (!op) throw new Error(`Operación ${operationId} no está en el contrato`);
  const v = op.responses[String(status)] ?? op.responses[`${String(status)[0]}XX`];
  if (!v) return;
  const ok = v(body);
  if (!ok) throw new Error(`Respuesta de ${operationId} (${status}) no cumple el contrato: ${JSON.stringify(v.errors?.slice(0, 5))}`);
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function registerRateCap(http: () => any, token: string, ea = 0.2493, from = '2026-10-01', to = '2026-12-31') {
  return http().post('/v1/compliance/rate-caps').set(auth(token)).send({ country: 'CO', effectiveAnnual: ea, validFrom: from, validTo: to, source: 'Superintendencia Financiera — certificación de prueba' }).expect(201);
}

export type App = INestApplication;
