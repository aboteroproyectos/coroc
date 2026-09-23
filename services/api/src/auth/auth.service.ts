import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { Clock } from '../common/clock.js';
import type { AuthContext } from '../common/context.js';
import { pickLang, type Lang } from '../common/i18n.js';
import { Mailer } from '../common/mailer.js';
import { Problem } from '../common/problem.js';
import { CONFIG, type AppConfig } from '../config.js';
import { EventBus } from '../dashboard/event-bus.js';
import { DbService, type Tx } from '../db/db.service.js';
import { randomToken, SecretBox, sameHash, sha256 } from './crypto.js';
import { currentMeta } from '../common/context.js';
import { assertStrongPassword, dummyVerify, hashPassword, verifyPassword } from './password.js';
import { permissionsOf, type Role } from './permissions.js';
import { packRefresh, signAccess, unpackRefresh } from './tokens.js';
import { newTotpSecret, otpauthUri, verifyTotp } from './totp.js';

export interface UserJson {
  id: string;
  username: string;
  name: string;
  email: string | null;
  role: Role;
  lang: Lang;
  theme: string;
  active: boolean;
  mfaEnabled: boolean;
  autoLockMinutes: number;
  lastLoginAt: string | null;
  permissions: string[];
}

export interface SessionJson {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  mfaEnrollmentRequired: boolean;
  user: UserJson;
  company: { id: string; slug: string; name: string; currency: string; country: string; timezone: string; lang: Lang };
}

export const userJson = (u: Record<string, any>, companyLang: Lang = 'es'): UserJson => ({
  id: u.id,
  username: u.username,
  name: u.name,
  email: u.email ?? null,
  role: u.role,
  lang: u.lang ?? companyLang,
  theme: u.theme ?? 'system',
  active: u.active,
  mfaEnabled: !!u.totp_secret_enc,
  autoLockMinutes: u.auto_lock_minutes ?? 5,
  lastLoginAt: u.last_login_at ? new Date(u.last_login_at).toISOString() : null,
  permissions: permissionsOf(u.role),
});

const LOCK_BASE_MIN = 15;
const MAX_FAILED = 5;
/** Bloqueo progresivo (§7.1): 15 min tras 5 intentos; cada bloqueo siguiente duplica el tiempo, hasta 24 h. */
export const lockMinutes = (lockouts: number): number => Math.min(LOCK_BASE_MIN * 2 ** Math.max(0, lockouts - 1), 24 * 60);

interface DeviceInfo {
  deviceId: string;
  deviceName?: string | null;
}

@Injectable()
export class AuthService {
  private readonly box: SecretBox;

  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly bus: EventBus,
    private readonly mailer: Mailer,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {
    this.box = new SecretBox(config.dataKey);
  }

  private async resolveTenant(slug: string): Promise<Record<string, any> | null> {
    const clean = String(slug ?? '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(clean)) return null;
    return this.db.tx(null, (tx) => tx.one('SELECT * FROM tenants WHERE slug = $1', [clean]), { lookupSlug: clean });
  }

  /** §7.1: usuario y contraseña; bloqueo progresivo; segundo factor si está activo; Propietario obligado a activarlo. */
  async login(input: { tenant: string; username: string; password: string } & DeviceInfo, acceptLanguage?: string): Promise<SessionJson | { mfa_required: true; challengeId: string }> {
    const tenant = await this.resolveTenant(input.tenant);
    if (!tenant) {
      await dummyVerify(input.password);
      throw new Problem(401, 'INVALID_CREDENTIALS');
    }
    const now = this.clock.now();
    const outcome = await this.db.tx({ tenantId: tenant.id }, async (tx) => {
      const u = await tx.one<Record<string, any>>('SELECT * FROM users WHERE username = $1 FOR UPDATE', [String(input.username).trim().toLowerCase()]);
      if (!u || !u.active) {
        await dummyVerify(input.password);
        await this.audit.log(tx, 'auth.login_failed', 'user', u?.id ?? null, { after: { reason: u ? 'inactive' : 'unknown_user' } });
        return { kind: 'invalid' as const };
      }
      if (u.locked_until && new Date(u.locked_until) > now) {
        return { kind: 'locked' as const, minutes: Math.ceil((new Date(u.locked_until).getTime() - now.getTime()) / 60000) };
      }
      if (!(await verifyPassword(u.password_hash, input.password))) {
        const failed = u.failed_attempts + 1;
        if (failed >= MAX_FAILED) {
          const lockouts = u.lockouts + 1;
          const minutes = lockMinutes(lockouts);
          await tx.exec('UPDATE users SET failed_attempts = 0, lockouts = $2, locked_until = $3 WHERE id = $1', [u.id, lockouts, new Date(now.getTime() + minutes * 60000)]);
          await this.audit.log(tx, 'security.lockout', 'user', u.id, { after: { minutes, lockouts } }, u.id);
          this.bus.publish({ type: 'security.lockout', tenantId: tenant.id, data: { userId: u.id, username: u.username, minutes } });
          return { kind: 'locked' as const, minutes };
        }
        await tx.exec('UPDATE users SET failed_attempts = $2 WHERE id = $1', [u.id, failed]);
        await this.audit.log(tx, 'auth.login_failed', 'user', u.id, { after: { reason: 'password', attempt: failed } }, u.id);
        return { kind: 'invalid' as const };
      }
      await tx.exec('UPDATE users SET failed_attempts = 0, lockouts = 0, locked_until = NULL WHERE id = $1', [u.id]);
      if (u.totp_secret_enc) {
        const ch = await tx.one<{ id: string }>(
          'INSERT INTO mfa_challenges (tenant_id, user_id, device_id, device_name, expires_at) VALUES (current_tenant(), $1, $2, $3, $4) RETURNING id',
          [u.id, input.deviceId, input.deviceName ?? null, new Date(now.getTime() + 5 * 60000)],
        );
        return { kind: 'mfa' as const, challengeId: `${tenant.id}.${ch!.id}` };
      }
      const level = u.role === 'owner' && this.config.mfaRequiredForOwner ? 'enroll_required' : 'none';
      return { kind: 'session' as const, session: await this.openSession(tx, tenant, u, input, level) };
    });
    if (outcome.kind === 'invalid') throw new Problem(401, 'INVALID_CREDENTIALS');
    if (outcome.kind === 'locked') throw new Problem(423, 'ACCOUNT_LOCKED', { minutes: outcome.minutes });
    if (outcome.kind === 'mfa') return { mfa_required: true, challengeId: outcome.challengeId };
    void acceptLanguage;
    return outcome.session;
  }

  async verifyMfa(challengeId: string, code: string): Promise<SessionJson> {
    const m = /^([0-9a-f-]{36})\.([0-9a-f-]{36})$/.exec(String(challengeId));
    if (!m) throw new Problem(401, 'MFA_INVALID');
    const [, tenantId, id] = m as unknown as [string, string, string];
    const now = this.clock.now();
    const result = await this.db.tx({ tenantId }, async (tx) => {
      const ch = await tx.one<Record<string, any>>('SELECT * FROM mfa_challenges WHERE id = $1 FOR UPDATE', [id]);
      if (!ch || ch.used_at || new Date(ch.expires_at) <= now || ch.attempts >= 5) return null;
      const u = await tx.one<Record<string, any>>('SELECT * FROM users WHERE id = $1 FOR UPDATE', [ch.user_id]);
      if (!u?.active || !u.totp_secret_enc) return null;
      const secret = this.box.open(u.totp_secret_enc, `totp:${u.id}`);
      const counter = verifyTotp(secret, code, now);
      if (counter === null || (u.totp_last_counter !== null && counter <= Number(u.totp_last_counter))) {
        await tx.exec('UPDATE mfa_challenges SET attempts = attempts + 1 WHERE id = $1', [id]);
        await this.audit.log(tx, 'auth.mfa_failed', 'user', u.id, {}, u.id);
        return null;
      }
      await tx.exec('UPDATE mfa_challenges SET used_at = $2 WHERE id = $1', [id, now]);
      await tx.exec('UPDATE users SET totp_last_counter = $2 WHERE id = $1', [u.id, counter]);
      const tenant = await tx.one<Record<string, any>>('SELECT * FROM tenants WHERE id = current_tenant()');
      return this.openSession(tx, tenant!, u, { deviceId: ch.device_id, deviceName: ch.device_name }, 'totp');
    });
    if (!result) throw new Problem(401, 'MFA_INVALID');
    return result;
  }

  /** Una sesión por dispositivo: iniciar sesión de nuevo en el mismo equipo cierra la anterior. */
  private async openSession(tx: Tx, tenant: Record<string, any>, u: Record<string, any>, dev: DeviceInfo, level: 'none' | 'totp' | 'enroll_required'): Promise<SessionJson> {
    const now = this.clock.now();
    await tx.exec('UPDATE sessions SET revoked_at = $3 WHERE user_id = $1 AND device_id = $2 AND revoked_at IS NULL', [u.id, dev.deviceId, now]);
    const secret = randomToken(32);
    const s = await tx.one<{ id: string }>(
      `INSERT INTO sessions (tenant_id, user_id, device_id, device_name, refresh_hash, expires_at, mfa_level, ip, user_agent)
       VALUES (current_tenant(), $1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [u.id, dev.deviceId, dev.deviceName ?? null, sha256(secret), new Date(now.getTime() + this.config.refreshTtlDays * 86400000), level, currentMeta()?.ip ?? null, currentMeta()?.userAgent?.slice(0, 300) ?? null],
    );
    await tx.exec('UPDATE users SET last_login_at = $2 WHERE id = $1', [u.id, now]);
    await this.audit.log(tx, 'auth.login', 'session', s!.id, { after: { deviceId: dev.deviceId, mfa: level } }, u.id);
    return this.sessionJson(tenant, u, s!.id, dev.deviceId, secret, level);
  }

  private async sessionJson(tenant: Record<string, any>, u: Record<string, any>, sessionId: string, deviceId: string, secret: string, level: string): Promise<SessionJson> {
    const lang = (u.lang ?? tenant.lang) as Lang;
    const ctx: AuthContext = { userId: u.id, tenantId: tenant.id, sessionId, role: u.role, lang, deviceId, mfa: level === 'enroll_required' ? 'enroll_required' : 'ok' };
    return {
      accessToken: await signAccess(ctx, this.config.jwtSecret, this.config.accessTtlSeconds, this.clock.now()),
      refreshToken: packRefresh(tenant.id, sessionId, secret),
      expiresIn: this.config.accessTtlSeconds,
      mfaEnrollmentRequired: level === 'enroll_required',
      user: userJson(u, tenant.lang),
      company: { id: tenant.id, slug: tenant.slug, name: tenant.name, currency: tenant.currency, country: tenant.country, timezone: tenant.timezone, lang: tenant.lang },
    };
  }

  /** Token de renovación rotativo ligado al dispositivo; reutilizar uno ya rotado revoca la sesión (robo de token). */
  async refresh(refreshToken: string, deviceId: string): Promise<SessionJson> {
    const parts = unpackRefresh(String(refreshToken));
    if (!parts) throw new Problem(401, 'SESSION_EXPIRED');
    const now = this.clock.now();
    const out = await this.db.tx({ tenantId: parts.tenantId }, async (tx) => {
      const s = await tx.one<Record<string, any>>('SELECT * FROM sessions WHERE id = $1 FOR UPDATE', [parts.sessionId]);
      if (!s || s.revoked_at || new Date(s.expires_at) <= now || s.device_id !== deviceId) return null;
      const presented = sha256(parts.secret);
      if (!sameHash(s.refresh_hash, presented)) {
        if (sameHash(s.previous_hash, presented)) {
          await tx.exec('UPDATE sessions SET revoked_at = $2 WHERE id = $1', [s.id, now]);
          await this.audit.log(tx, 'security.refresh_reuse', 'session', s.id, {}, s.user_id);
        }
        return null;
      }
      const u = await tx.one<Record<string, any>>('SELECT * FROM users WHERE id = $1', [s.user_id]);
      if (!u?.active) return null;
      const secret = randomToken(32);
      await tx.exec('UPDATE sessions SET previous_hash = refresh_hash, refresh_hash = $2, last_used_at = $3, expires_at = $4 WHERE id = $1', [
        s.id, sha256(secret), now, new Date(now.getTime() + this.config.refreshTtlDays * 86400000),
      ]);
      const tenant = await tx.one<Record<string, any>>('SELECT * FROM tenants WHERE id = current_tenant()');
      const level = s.mfa_level === 'enroll_required' && u.totp_secret_enc ? 'totp' : s.mfa_level;
      return this.sessionJson(tenant!, u, s.id, deviceId, secret, level);
    });
    if (!out) throw new Problem(401, 'SESSION_EXPIRED');
    return out;
  }

  async logout(auth: AuthContext): Promise<void> {
    await this.db.tx({ tenantId: auth.tenantId, userId: auth.userId }, async (tx) => {
      await tx.exec('UPDATE sessions SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL', [auth.sessionId, this.clock.now()]);
      await this.audit.log(tx, 'auth.logout', 'session', auth.sessionId);
    });
  }

  /** Enlace de un solo uso válido 30 minutos (§7.1). La respuesta es la misma exista o no el usuario. */
  async forgotPassword(tenantSlug: string, username: string, acceptLanguage?: string): Promise<void> {
    const tenant = await this.resolveTenant(tenantSlug);
    if (!tenant) return;
    const now = this.clock.now();
    const mail = await this.db.tx({ tenantId: tenant.id }, async (tx) => {
      const u = await tx.one<Record<string, any>>('SELECT * FROM users WHERE username = $1 AND active', [String(username).trim().toLowerCase()]);
      if (!u?.email) return null;
      const recent = await tx.one<{ n: number }>("SELECT count(*)::int AS n FROM password_resets WHERE user_id = $1 AND created_at > $2", [u.id, new Date(now.getTime() - 3600000)]);
      if ((recent?.n ?? 0) >= 3) return null;
      const secret = randomToken(32);
      await tx.exec('INSERT INTO password_resets (tenant_id, user_id, token_hash, expires_at) VALUES (current_tenant(), $1, $2, $3)', [u.id, sha256(secret), new Date(now.getTime() + 30 * 60000)]);
      await this.audit.log(tx, 'auth.password_reset_requested', 'user', u.id, {}, u.id);
      return { to: u.email as string, token: `pr1.${tenant.id}.${secret}`, lang: pickLang(u.lang ?? tenant.lang, u.lang || tenant.lang ? undefined : acceptLanguage), name: u.name as string };
    });
    if (!mail) return;
    const link = `${this.config.publicAppUrl}/restablecer?token=${encodeURIComponent(mail.token)}`;
    const T = {
      es: ['Restablecer su contraseña de COROC', `Hola, ${mail.name}. Para crear una contraseña nueva abra este enlace en los próximos 30 minutos:\n\n${link}\n\nSi usted no lo pidió, ignore este mensaje.`],
      'pt-BR': ['Redefinir sua senha do COROC', `Olá, ${mail.name}. Para criar uma nova senha abra este link nos próximos 30 minutos:\n\n${link}\n\nSe você não pediu, ignore esta mensagem.`],
      en: ['Reset your COROC password', `Hello ${mail.name}. To create a new password open this link within the next 30 minutes:\n\n${link}\n\nIf you did not request it, ignore this message.`],
    }[mail.lang] as [string, string];
    await this.mailer.send({ to: mail.to, subject: T[0], text: T[1] });
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const m = /^pr1\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(String(token));
    if (!m) throw new Problem(400, 'RESET_TOKEN_INVALID');
    const [, tenantId, secret] = m as unknown as [string, string, string];
    const now = this.clock.now();
    const ok = await this.db.tx({ tenantId }, async (tx) => {
      const r = await tx.one<Record<string, any>>('SELECT * FROM password_resets WHERE token_hash = $1 FOR UPDATE', [sha256(secret)]);
      if (!r || r.used_at || new Date(r.expires_at) <= now) return false;
      const u = await tx.one<Record<string, any>>('SELECT * FROM users WHERE id = $1', [r.user_id]);
      const tenant = await tx.one<Record<string, any>>('SELECT slug FROM tenants WHERE id = current_tenant()');
      await assertStrongPassword(password, { username: u!.username, tenantSlug: tenant!.slug, mode: this.config.breachedPasswordCheck });
      await tx.exec('UPDATE password_resets SET used_at = $2 WHERE id = $1', [r.id, now]);
      await tx.exec('UPDATE users SET password_hash = $2, password_changed_at = $3, failed_attempts = 0, lockouts = 0, locked_until = NULL, version = version + 1 WHERE id = $1', [u!.id, await hashPassword(password), now]);
      await tx.exec('UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL', [u!.id, now]);
      await this.audit.log(tx, 'auth.password_reset', 'user', u!.id, {}, u!.id);
      return true;
    });
    if (!ok) throw new Problem(400, 'RESET_TOKEN_INVALID');
  }

  async changePassword(auth: AuthContext, current: string, next: string): Promise<void> {
    const now = this.clock.now();
    const ok = await this.db.tx({ tenantId: auth.tenantId, userId: auth.userId, role: auth.role }, async (tx) => {
      const u = await tx.one<Record<string, any>>('SELECT u.*, t.slug FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1', [auth.userId]);
      if (!u || !(await verifyPassword(u.password_hash, current))) return false;
      await assertStrongPassword(next, { username: u.username, tenantSlug: u.slug, mode: this.config.breachedPasswordCheck });
      await tx.exec('UPDATE users SET password_hash = $2, password_changed_at = $3, version = version + 1 WHERE id = $1', [u.id, await hashPassword(next), now]);
      // Las demás sesiones se cierran; la actual sigue abierta.
      await tx.exec('UPDATE sessions SET revoked_at = $3 WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL', [u.id, auth.sessionId, now]);
      await this.audit.log(tx, 'auth.password_changed', 'user', u.id);
      return true;
    });
    if (!ok) throw new Problem(401, 'INVALID_CREDENTIALS');
  }

  /** Paso 1 del segundo factor: genera el secreto y lo guarda cifrado como pendiente. */
  async enrollMfa(auth: AuthContext): Promise<{ secret: string; otpauthUri: string }> {
    return this.db.tx({ tenantId: auth.tenantId, userId: auth.userId, role: auth.role }, async (tx) => {
      const u = await tx.one<Record<string, any>>('SELECT u.username, t.slug FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1', [auth.userId]);
      const secret = newTotpSecret();
      await tx.exec('UPDATE users SET totp_pending_enc = $2 WHERE id = $1', [auth.userId, this.box.seal(secret, `totp:${auth.userId}`)]);
      const uri = otpauthUri(secret, `${u!.username}@${u!.slug}`);
      return { secret: uri.match(/secret=([A-Z2-7]+)/)![1]!, otpauthUri: uri };
    });
  }

  /** Paso 2: confirma con un código; activa el segundo factor y emite tokens con el nivel completo. */
  async confirmMfa(auth: AuthContext, code: string): Promise<SessionJson> {
    const now = this.clock.now();
    const out = await this.db.tx({ tenantId: auth.tenantId, userId: auth.userId, role: auth.role }, async (tx) => {
      const u = await tx.one<Record<string, any>>('SELECT * FROM users WHERE id = $1 FOR UPDATE', [auth.userId]);
      if (!u?.totp_pending_enc) return null;
      const secret = this.box.open(u.totp_pending_enc, `totp:${u.id}`);
      const counter = verifyTotp(secret, code, now);
      if (counter === null) return null;
      await tx.exec('UPDATE users SET totp_secret_enc = totp_pending_enc, totp_pending_enc = NULL, totp_last_counter = $2, version = version + 1 WHERE id = $1', [u.id, counter]);
      await this.audit.log(tx, 'auth.mfa_enabled', 'user', u.id);
      const secretRt = randomToken(32);
      await tx.exec("UPDATE sessions SET refresh_hash = $2, previous_hash = NULL, mfa_level = 'totp', last_used_at = $3 WHERE id = $1", [auth.sessionId, sha256(secretRt), now]);
      const fresh = await tx.one<Record<string, any>>('SELECT * FROM users WHERE id = $1', [u.id]);
      const tenant = await tx.one<Record<string, any>>('SELECT * FROM tenants WHERE id = current_tenant()');
      return this.sessionJson(tenant!, fresh!, auth.sessionId, auth.deviceId, secretRt, 'totp');
    });
    if (!out) throw new Problem(401, 'MFA_INVALID');
    return out;
  }

  async disableMfa(auth: AuthContext, code: string): Promise<void> {
    if (auth.role === 'owner' && this.config.mfaRequiredForOwner) throw Problem.forbidden();
    const now = this.clock.now();
    const ok = await this.db.tx({ tenantId: auth.tenantId, userId: auth.userId, role: auth.role }, async (tx) => {
      const u = await tx.one<Record<string, any>>('SELECT * FROM users WHERE id = $1 FOR UPDATE', [auth.userId]);
      if (!u?.totp_secret_enc) return false;
      if (verifyTotp(this.box.open(u.totp_secret_enc, `totp:${u.id}`), code, now) === null) return false;
      await tx.exec('UPDATE users SET totp_secret_enc = NULL, totp_last_counter = NULL, version = version + 1 WHERE id = $1', [u.id]);
      await this.audit.log(tx, 'auth.mfa_disabled', 'user', u.id);
      return true;
    });
    if (!ok) throw new Problem(401, 'MFA_INVALID');
  }
}
