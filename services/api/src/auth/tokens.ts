import { SignJWT, jwtVerify } from 'jose';
import type { AuthContext } from '../common/context.js';

const ISS = 'coroc';
const AUD = 'coroc-app';

export async function signAccess(ctx: AuthContext, secret: Uint8Array, ttlSeconds: number, now: Date): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ tid: ctx.tenantId, sid: ctx.sessionId, role: ctx.role, lang: ctx.lang, dev: ctx.deviceId, mfa: ctx.mfa })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(ctx.userId)
    .setIssuer(ISS)
    .setAudience(AUD)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ttlSeconds)
    .sign(secret);
}

export async function verifyAccess(token: string, secret: Uint8Array, now: Date): Promise<AuthContext> {
  const { payload } = await jwtVerify(token, secret, { issuer: ISS, audience: AUD, algorithms: ['HS256'], currentDate: now });
  return {
    userId: String(payload.sub),
    tenantId: String(payload.tid),
    sessionId: String(payload.sid),
    role: payload.role as AuthContext['role'],
    lang: payload.lang as AuthContext['lang'],
    deviceId: String(payload.dev),
    mfa: payload.mfa === 'enroll_required' ? 'enroll_required' : 'ok',
  };
}

/** Token de renovación opaco: `rt1.<empresa>.<sesión>.<secreto>`. Solo el SHA-256 del secreto se guarda. */
export const packRefresh = (tenantId: string, sessionId: string, secret: string): string => `rt1.${tenantId}.${sessionId}.${secret}`;
export function unpackRefresh(token: string): { tenantId: string; sessionId: string; secret: string } | null {
  const m = /^rt1\.([0-9a-f-]{36})\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(token);
  return m ? { tenantId: m[1]!, sessionId: m[2]!, secret: m[3]! } : null;
}
