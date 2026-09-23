import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { CONFIG, type AppConfig } from '../config.js';
import { Clock } from '../common/clock.js';
import type { AuthContext } from '../common/context.js';
import { DURING_ENROLLMENT, PERMISSION, PUBLIC } from '../common/decorators.js';
import { Problem } from '../common/problem.js';
import { DbService } from '../db/db.service.js';
import { can, type Permission } from './permissions.js';
import { verifyAccess } from './tokens.js';

/**
 * Guardián global: exige token de acceso válido (15 min), sesión no revocada, segundo factor cuando aplica
 * y el permiso del rol (§7). Las rutas marcadas con @Public() quedan fuera.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DbService,
    private readonly clock: Clock,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest<Request & { auth?: AuthContext }>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new Problem(401, 'UNAUTHENTICATED');
    let auth: AuthContext;
    try {
      auth = await verifyAccess(token, this.config.jwtSecret, this.clock.now());
    } catch {
      throw new Problem(401, 'SESSION_EXPIRED');
    }
    const session = await this.db.tx({ tenantId: auth.tenantId, userId: auth.userId }, (tx) =>
      tx.one<{ ok: boolean }>(
        `SELECT (s.revoked_at IS NULL AND s.expires_at > $2 AND u.active) AS ok
           FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1`,
        [auth.sessionId, this.clock.now()],
      ),
    );
    if (!session?.ok) throw new Problem(401, 'SESSION_EXPIRED');
    req.auth = auth;
    if (auth.mfa === 'enroll_required' && !this.reflector.getAllAndOverride<boolean>(DURING_ENROLLMENT, targets)) {
      throw new Problem(403, 'MFA_ENROLLMENT_REQUIRED');
    }
    const perm = this.reflector.getAllAndOverride<Permission>(PERMISSION, targets);
    if (perm && !can(auth.role, perm)) throw Problem.forbidden();
    return true;
  }
}
