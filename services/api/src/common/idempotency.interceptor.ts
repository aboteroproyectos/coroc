import { CallHandler, ExecutionContext, HttpStatus, Injectable, NestInterceptor } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { from, lastValueFrom, Observable } from 'rxjs';
import { sha256hex } from '../auth/crypto.js';
import { DbService } from '../db/db.service.js';
import type { AuthContext } from './context.js';
import { IDEMPOTENT } from './decorators.js';
import { Problem } from './problem.js';

/**
 * Encabezado Idempotency-Key en operaciones contables: si el celular reintenta por mala señal, el pago no se registra
 * dos veces; se devuelve la misma respuesta. La misma clave con datos distintos se rechaza.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector, private readonly db: DbService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.reflector.get<boolean>(IDEMPOTENT, ctx.getHandler())) return next.handle();
    const req = ctx.switchToHttp().getRequest<Request & { auth: AuthContext }>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || !key) return next.handle();
    if (key.length < 8 || key.length > 128) throw new Problem(422, 'VALIDATION_FAILED', {}, [{ field: 'Idempotency-Key', message: 'minLength' }]);
    const a = req.auth;
    const tctx = { tenantId: a.tenantId, userId: a.userId, role: a.role };
    const hash = sha256hex(JSON.stringify([req.method, req.path, req.body ?? null]));
    const status = this.reflector.get<number>(HTTP_CODE_METADATA, ctx.getHandler()) ?? (req.method === 'POST' ? HttpStatus.CREATED : HttpStatus.OK);
    return from(
      (async () => {
        const existing = await this.db.tx(tctx, async (tx) => {
          const ins = await tx.one('INSERT INTO idempotency_keys (tenant_id, key, user_id, request_hash) VALUES (current_tenant(), $1, $2, $3) ON CONFLICT DO NOTHING RETURNING key', [key, a.userId, hash]);
          return ins ? null : tx.one<Record<string, any>>('SELECT * FROM idempotency_keys WHERE key = $1', [key]);
        });
        if (existing) {
          if (existing.request_hash !== hash || existing.user_id !== a.userId) throw new Problem(422, 'IDEMPOTENCY_MISMATCH');
          if (existing.status_code === null) throw new Problem(409, 'IDEMPOTENCY_IN_PROGRESS');
          res.status(existing.status_code).setHeader('Idempotent-Replayed', 'true');
          return existing.response;
        }
        try {
          const body = await lastValueFrom(next.handle(), { defaultValue: undefined });
          await this.db.tx(tctx, (tx) => tx.exec('UPDATE idempotency_keys SET status_code = $2, response = $3 WHERE key = $1', [key, status, JSON.stringify(body ?? null)]));
          return body;
        } catch (e) {
          await this.db.tx(tctx, (tx) => tx.exec('DELETE FROM idempotency_keys WHERE key = $1 AND status_code IS NULL', [key])).catch(() => undefined);
          throw e;
        }
      })(),
    );
  }
}

