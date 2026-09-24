import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { assertStrongPassword, hashPassword } from '../auth/password.js';
import { userJson } from '../auth/auth.service.js';
import { Clock } from '../common/clock.js';
import type { AuthContext } from '../common/context.js';
import { Auth, Op, Requires } from '../common/decorators.js';
import { Problem } from '../common/problem.js';
import { CONFIG, type AppConfig } from '../config.js';
import { DbService, type Tx } from '../db/db.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly db: DbService, private readonly audit: AuditService, private readonly clock: Clock, @Inject(CONFIG) private readonly config: AppConfig) {}

  private ctx(a: AuthContext) {
    return { tenantId: a.tenantId, userId: a.userId, role: a.role };
  }

  private async companyLang(tx: Tx) {
    return ((await tx.one<{ lang: string }>('SELECT lang FROM tenants WHERE id = current_tenant()'))!.lang) as never;
  }

  @Get()
  @Requires('users.view')
  @Op('listUsers')
  list(@Auth() a: AuthContext) {
    return this.db.tx(this.ctx(a), async (tx) => {
      const lang = await this.companyLang(tx);
      return (await tx.many('SELECT * FROM users WHERE deleted_at IS NULL ORDER BY active DESC, name')).map((u) => userJson(u, lang));
    });
  }

  @Post()
  @Requires('users.manage')
  @Op('createUser')
  create(@Auth() a: AuthContext, @Body() b: { username: string; name: string; role: string; password: string; email?: string; lang?: string }) {
    if (b.role === 'owner' && a.role !== 'owner') throw Problem.forbidden();
    return this.db.tx(this.ctx(a), async (tx) => {
      const username = b.username.trim().toLowerCase();
      const t = await tx.one<{ slug: string; lang: string }>('SELECT slug, lang FROM tenants WHERE id = current_tenant()');
      await assertStrongPassword(b.password, { username, tenantSlug: t!.slug, mode: this.config.breachedPasswordCheck });
      if (await tx.one('SELECT 1 FROM users WHERE username = $1', [username])) throw new Problem(409, 'USERNAME_TAKEN');
      const u = await tx.one<Record<string, any>>(
        `INSERT INTO users (tenant_id, username, name, role, password_hash, email, lang)
         VALUES (current_tenant(), $1, $2, $3, $4, $5, $6::lang_code) RETURNING *`,
        [username, b.name.trim(), b.role, await hashPassword(b.password), b.email?.trim() || null, b.lang ?? null],
      );
      await this.audit.log(tx, 'user.created', 'user', u!.id, { after: { username, role: b.role } });
      return userJson(u!, t!.lang as never);
    });
  }

  @Patch(':id')
  @Requires('users.manage')
  @Op('updateUser')
  update(@Auth() a: AuthContext, @Param('id') id: string, @Body() b: { active?: boolean; role?: string; name?: string; email?: string | null }) {
    return this.db.tx(this.ctx(a), async (tx) => {
      const before = await tx.one<Record<string, any>>('SELECT * FROM users WHERE id = $1 FOR UPDATE', [id]);
      if (!before) throw Problem.notFound();
      if ((before.role === 'owner' || b.role === 'owner') && a.role !== 'owner') throw Problem.forbidden();
      const losesOwner = before.role === 'owner' && before.active && (b.active === false || (b.role && b.role !== 'owner'));
      if (losesOwner) {
        const owners = await tx.one<{ n: number }>("SELECT count(*)::int AS n FROM users WHERE role = 'owner' AND active AND id <> $1", [id]);
        if ((owners?.n ?? 0) === 0) throw new Problem(409, 'LAST_OWNER');
      }
      const u = await tx.one<Record<string, any>>(
        `UPDATE users SET active = coalesce($2, active), role = coalesce($3::user_role, role), name = coalesce($4, name),
                email = CASE WHEN $6 THEN $5::citext ELSE email END, version = version + 1 WHERE id = $1 RETURNING *`,
        [id, b.active ?? null, b.role ?? null, b.name?.trim() || null, b.email ?? null, b.email !== undefined],
      );
      // Un cambio de rol o una desactivación cierra sus sesiones: el nuevo alcance rige de inmediato.
      if (b.active === false || (b.role && b.role !== before.role)) {
        await tx.exec('UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL', [id, this.clock.now()]);
      }
      await this.audit.log(tx, 'user.updated', 'user', id, { before: { active: before.active, role: before.role, name: before.name }, after: b });
      return userJson(u!, await this.companyLang(tx));
    });
  }

  /** §7.1: cierre remoto de sesiones desde Configuración. */
  @Delete(':id/sessions')
  @HttpCode(204)
  @Requires('users.manage')
  @Op('revokeSessions')
  async revoke(@Auth() a: AuthContext, @Param('id') id: string): Promise<void> {
    await this.db.tx(this.ctx(a), async (tx) => {
      if (!(await tx.one('SELECT 1 FROM users WHERE id = $1', [id]))) throw Problem.notFound();
      await tx.exec('UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL', [id, this.clock.now()]);
      await this.audit.log(tx, 'user.sessions_revoked', 'user', id);
    });
  }
}
