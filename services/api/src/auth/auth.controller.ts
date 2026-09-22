import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Clock } from '../common/clock.js';
import type { AuthContext } from '../common/context.js';
import { Auth, DuringEnrollment, Op, Public } from '../common/decorators.js';
import { Problem } from '../common/problem.js';
import { RateLimiter } from '../common/rate-limit.js';
import { DbService } from '../db/db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthService, userJson } from './auth.service.js';

const ip = (req: Request) => req.ip ?? 'desconocida';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly limiter: RateLimiter) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Op('login')
  login(@Body() b: { tenant: string; username: string; password: string; deviceId: string; deviceName?: string }, @Req() req: Request) {
    this.limiter.hit(`login:${ip(req)}`, 30, 60_000);
    return this.auth.login(b, req.headers['accept-language']);
  }

  @Public()
  @Post('mfa')
  @HttpCode(200)
  @Op('verifyMfa')
  mfa(@Body() b: { challengeId: string; code: string }, @Req() req: Request) {
    this.limiter.hit(`mfa:${ip(req)}`, 30, 60_000);
    return this.auth.verifyMfa(b.challengeId, b.code);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @Op('refresh')
  refresh(@Body() b: { refreshToken: string; deviceId: string }) {
    return this.auth.refresh(b.refreshToken, b.deviceId);
  }

  @Post('logout')
  @HttpCode(204)
  @DuringEnrollment()
  @Op('logout')
  async logout(@Auth() a: AuthContext): Promise<void> {
    await this.auth.logout(a);
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(202)
  @Op('forgotPassword')
  async forgot(@Body() b: { tenant: string; username: string }, @Req() req: Request): Promise<void> {
    this.limiter.hit(`forgot:${ip(req)}`, 5, 60_000);
    await this.auth.forgotPassword(b.tenant, b.username, req.headers['accept-language']);
  }

  @Public()
  @Post('password/reset')
  @HttpCode(204)
  @Op('resetPassword')
  async reset(@Body() b: { token: string; password: string }, @Req() req: Request): Promise<void> {
    this.limiter.hit(`reset:${ip(req)}`, 10, 60_000);
    await this.auth.resetPassword(b.token, b.password);
  }
}

@Controller('me')
export class MeController {
  constructor(private readonly auth: AuthService, private readonly db: DbService, private readonly audit: AuditService, private readonly clock: Clock) {}

  private ctx(a: AuthContext) {
    return { tenantId: a.tenantId, userId: a.userId, role: a.role };
  }

  @Get()
  @DuringEnrollment()
  @Op('me')
  async me(@Auth() a: AuthContext) {
    return this.db.tx(this.ctx(a), async (tx) => {
      const u = await tx.one<Record<string, any>>('SELECT u.*, t.lang AS company_lang FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1', [a.userId]);
      if (!u) throw Problem.notFound();
      return userJson(u, u.company_lang);
    });
  }

  /** Preferencias del usuario: idioma (§6), apariencia (§5.4) y bloqueo por inactividad (§7.1). */
  @Patch()
  @DuringEnrollment()
  @Op('updateMe')
  async update(@Auth() a: AuthContext, @Body() b: { lang?: string; theme?: string; name?: string; autoLockMinutes?: number; email?: string | null }) {
    return this.db.tx(this.ctx(a), async (tx) => {
      const before = await tx.one<Record<string, any>>('SELECT lang, theme, name, auto_lock_minutes, email FROM users WHERE id = $1', [a.userId]);
      const u = await tx.one<Record<string, any>>(
        `UPDATE users SET lang = coalesce($2::lang_code, lang), theme = coalesce($3, theme), name = coalesce($4, name),
                auto_lock_minutes = coalesce($5, auto_lock_minutes), email = CASE WHEN $7 THEN $6::citext ELSE email END, version = version + 1
          WHERE id = $1 RETURNING *`,
        [a.userId, b.lang ?? null, b.theme ?? null, b.name?.trim() || null, b.autoLockMinutes ?? null, b.email ?? null, b.email !== undefined],
      );
      await this.audit.log(tx, 'user.preferences', 'user', a.userId, { before, after: b });
      const t = await tx.one<{ lang: string }>('SELECT lang FROM tenants WHERE id = current_tenant()');
      return userJson(u!, t!.lang as never);
    });
  }

  @Post('password')
  @HttpCode(204)
  @Op('changePassword')
  async password(@Auth() a: AuthContext, @Body() b: { currentPassword: string; newPassword: string }): Promise<void> {
    await this.auth.changePassword(a, b.currentPassword, b.newPassword);
  }

  @Post('mfa/enroll')
  @HttpCode(200)
  @DuringEnrollment()
  @Op('enrollMfa')
  enroll(@Auth() a: AuthContext) {
    return this.auth.enrollMfa(a);
  }

  @Post('mfa/confirm')
  @HttpCode(200)
  @DuringEnrollment()
  @Op('confirmMfa')
  confirm(@Auth() a: AuthContext, @Body() b: { code: string }) {
    return this.auth.confirmMfa(a, b.code);
  }

  @Delete('mfa')
  @HttpCode(204)
  @Op('disableMfa')
  async disable(@Auth() a: AuthContext, @Body() b: { code: string }): Promise<void> {
    await this.auth.disableMfa(a, b.code);
  }

  @Get('sessions')
  @Op('mySessions')
  sessions(@Auth() a: AuthContext) {
    return this.db.tx(this.ctx(a), async (tx) =>
      (await tx.many<Record<string, any>>(
        'SELECT id, device_id, device_name, created_at, last_used_at FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > $2 ORDER BY last_used_at DESC',
        [a.userId, this.clock.now()],
      )).map((s) => ({ id: s.id, deviceId: s.device_id, deviceName: s.device_name, createdAt: new Date(s.created_at).toISOString(), lastUsedAt: new Date(s.last_used_at).toISOString(), current: s.id === a.sessionId })),
    );
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  @Op('revokeMySession')
  async revoke(@Auth() a: AuthContext, @Param('id') id: string): Promise<void> {
    await this.db.tx(this.ctx(a), async (tx) => {
      const n = await tx.exec('UPDATE sessions SET revoked_at = $3 WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL', [id, a.userId, this.clock.now()]);
      if (!n) throw Problem.notFound();
      await this.audit.log(tx, 'auth.session_revoked', 'session', id);
    });
  }
}
