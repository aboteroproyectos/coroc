import crypto from 'node:crypto';
import { Body, Controller, Delete, HttpCode, Param, Post } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { Clock } from '../common/clock.js';
import type { AuthContext } from '../common/context.js';
import { Auth, Op, Requires } from '../common/decorators.js';
import { Problem } from '../common/problem.js';
import { DbService, type Tx } from '../db/db.service.js';
import { hashPassword, verifyPassword } from './password.js';

/** Días en que el Propietario puede arrepentirse del cierre antes de que soporte purgue los datos (ADR-056). */
export const CLOSURE_GRACE_DAYS = 30;

/**
 * Eliminación de cuentas (App Store 5.1.1(v), Google Play; ADR-056).
 * - Un usuario elimina su propia cuenta desde la app; el Administrador puede eliminar la de otro usuario.
 *   Se anonimiza en vez de borrarse: los movimientos que registró siguen siendo prueba contable y conservan su autor
 *   como «Usuario eliminado».
 * - El Propietario no elimina su usuario: cierra la empresa. Se cierran todas las sesiones, nadie más puede ingresar y,
 *   pasado el plazo de gracia, soporte purga los datos personales conservando solo lo que la ley obliga a guardar.
 */
@Controller()
export class AccountController {
  constructor(private readonly db: DbService, private readonly audit: AuditService, private readonly clock: Clock) {}

  private ctx(a: AuthContext) {
    return { tenantId: a.tenantId, userId: a.userId, role: a.role };
  }

  private async anonymize(tx: Tx, id: string): Promise<void> {
    await tx.exec(
      `UPDATE users SET active = false, deleted_at = $2, name = 'Usuario eliminado', email = NULL,
              username = 'eliminado-' || substr(id::text, 1, 8), password_hash = $3,
              totp_secret_enc = NULL, totp_pending_enc = NULL, version = version + 1
        WHERE id = $1`,
      [id, this.clock.now(), await hashPassword(crypto.randomBytes(32).toString('base64url'))],
    );
    await tx.exec('UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL', [id, this.clock.now()]);
  }

  @Delete('me')
  @HttpCode(204)
  @Op('deleteMyAccount')
  async deleteMe(@Auth() a: AuthContext, @Body() b: { password: string }): Promise<void> {
    if (a.role === 'owner') throw new Problem(409, 'OWNER_MUST_CLOSE_COMPANY');
    const ok = await this.db.tx(this.ctx(a), async (tx) => {
      const u = await tx.one<Record<string, any>>('SELECT password_hash FROM users WHERE id = $1 FOR UPDATE', [a.userId]);
      if (!u || !(await verifyPassword(u.password_hash, b.password))) return false;
      await this.anonymize(tx, a.userId);
      await this.audit.log(tx, 'user.deleted', 'user', a.userId, { after: { by: 'self' } });
      return true;
    });
    if (!ok) throw new Problem(401, 'INVALID_CREDENTIALS');
  }

  @Delete('users/:id')
  @HttpCode(204)
  @Requires('users.manage')
  @Op('deleteUser')
  async deleteUser(@Auth() a: AuthContext, @Param('id') id: string): Promise<void> {
    await this.db.tx(this.ctx(a), async (tx) => {
      const u = await tx.one<{ role: string; deleted_at: string | null }>('SELECT role, deleted_at FROM users WHERE id = $1 FOR UPDATE', [id]);
      if (!u || u.deleted_at) throw Problem.notFound();
      if (u.role === 'owner' || id === a.userId) throw new Problem(409, 'USER_NOT_DELETABLE');
      await this.anonymize(tx, id);
      await this.audit.log(tx, 'user.deleted', 'user', id, { after: { by: a.userId } });
    });
  }

  @Post('company/closure')
  @HttpCode(202)
  @Requires('subscription.manage')
  @Op('closeCompany')
  async close(@Auth() a: AuthContext, @Body() b: { password: string; confirmSlug: string }) {
    const now = this.clock.now();
    const res = await this.db.tx(this.ctx(a), async (tx) => {
      const u = await tx.one<Record<string, any>>('SELECT u.password_hash, t.slug FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1', [a.userId]);
      if (!u || !(await verifyPassword(u.password_hash, b.password))) return null;
      if (String(b.confirmSlug).trim().toLowerCase() !== u.slug) throw new Problem(422, 'VALIDATION_FAILED', {}, [{ field: 'confirmSlug', message: 'other' }]);
      await tx.exec('UPDATE tenants SET closure_requested_at = $1 WHERE id = current_tenant()', [now]);
      await tx.exec('UPDATE sessions SET revoked_at = $1 WHERE revoked_at IS NULL', [now]);
      await this.audit.log(tx, 'company.closure_requested', 'tenant', a.tenantId, { after: { graceDays: CLOSURE_GRACE_DAYS } });
      return true;
    });
    if (!res) throw new Problem(401, 'INVALID_CREDENTIALS');
    return { closureRequestedAt: now.toISOString(), purgeAfter: new Date(now.getTime() + CLOSURE_GRACE_DAYS * 86_400_000).toISOString() };
  }
}
