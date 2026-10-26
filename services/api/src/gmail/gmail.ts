import { Inject, Injectable, Logger } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { AuditService } from '../audit/audit.service.js';
import { SecretBox } from '../auth/crypto.js';
import { Clock } from '../common/clock.js';
import type { AuthContext } from '../common/context.js';
import { Problem } from '../common/problem.js';
import { TenantCache } from '../company/tenant-cache.js';
import { CONFIG, type AppConfig } from '../config.js';
import { DbService, type Tx } from '../db/db.service.js';
import type { OutboundEmail, SendResult } from '../messaging/email.js';

/** Etiqueta de Gmail de los correos que COROC ya procesó (en otros servidores IMAP, la palabra clave `$CorocProcesado`). */
export const PROCESSED_LABEL = 'COROC/Procesado';
export const PROCESSED_KEYWORD = '$CorocProcesado';

export type GmailProblem = 'GMAIL_AUTH_FAILED' | 'GMAIL_APP_PASSWORD_REQUIRED' | 'GMAIL_UNREACHABLE' | 'GMAIL_IMAP_FAILED' | 'GMAIL_SMTP_FAILED';
export type GmailAccountRow = Record<string, any> & { tenant_id: string; address: string; password_enc: Buffer; status: string; last_uid: string | number; uid_validity: string | number | null };
export type GmailSendResult = SendResult | { ok: false; permanent: false; error: string; limited: true };

const NETWORK = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'CONNECT_TIMEOUT', 'GREETING_TIMEOUT', 'ESOCKET', 'ECONNECTION', 'EDNS', 'NoConnection']);

/** Lo que dijo Gmail, en uno de los códigos que la app explica con palabras simples (qué falta y qué hacer). */
export function gmailProblem(e: unknown, protocol: 'imap' | 'smtp'): GmailProblem {
  const err = e as { code?: string; responseCode?: number; authenticationFailed?: boolean; response?: unknown; responseText?: string; message?: string };
  const text = `${String(err.response ?? '')} ${err.responseText ?? ''} ${err.message ?? ''}`;
  if (/application-specific password required/i.test(text)) return 'GMAIL_APP_PASSWORD_REQUIRED';
  if (err.authenticationFailed || err.code === 'EAUTH' || err.responseCode === 535 || err.responseCode === 534) return 'GMAIL_AUTH_FAILED';
  if (err.code && NETWORK.has(err.code)) return 'GMAIL_UNREACHABLE';
  return protocol === 'imap' ? 'GMAIL_IMAP_FAILED' : 'GMAIL_SMTP_FAILED';
}

/** Contraseña de aplicación de Google: 16 letras, que Google muestra en grupos de cuatro. */
export function normalizeAppPassword(raw: string): string | null {
  const s = String(raw ?? '').replace(/\s+/g, '').toLowerCase();
  return /^[a-z]{16}$/.test(s) ? s : null;
}

/**
 * Cuenta de Gmail de la empresa (ADR-065): conexión, prueba, envío por SMTP con el límite diario y el hilo de correo de
 * cada cliente. La lectura por IMAP está en `GmailInbox`.
 */
@Injectable()
export class GmailAccounts {
  private readonly log = new Logger('Gmail');
  private readonly box: SecretBox;

  constructor(
    private readonly db: DbService,
    private readonly tenants: TenantCache,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {
    this.box = new SecretBox(config.dataKey);
  }

  get enabled(): boolean {
    return this.config.gmail.enabled;
  }

  assertEnabled(): void {
    if (!this.config.gmail.enabled) throw Problem.notFound();
  }

  async account(tenantId: string): Promise<GmailAccountRow | null> {
    if (!this.config.gmail.enabled) return null;
    return this.db.tx({ tenantId }, (tx) => tx.one<GmailAccountRow>('SELECT * FROM gmail_accounts WHERE tenant_id = current_tenant()'));
  }

  password(acc: GmailAccountRow): string {
    return this.box.open(acc.password_enc, `gmail:${acc.tenant_id}`).toString();
  }

  /** Conexión IMAP a Gmail (o al servidor de pruebas). Sin registros: nunca se escriben correos ni contraseñas. */
  imapClient(address: string, password: string, opts: { verifyOnly?: boolean } = {}): ImapFlow {
    const { imap, tls } = this.config.gmail;
    return new ImapFlow({
      host: imap.host, port: imap.port, secure: tls, auth: { user: address, pass: password }, logger: false, verifyOnly: opts.verifyOnly,
      disableCompression: true, connectionTimeout: 30_000, greetingTimeout: 16_000, socketTimeout: 10 * 60_000, maxIdleTime: 9 * 60_000,
      clientInfo: { name: 'COROC', vendor: 'COROC' },
    });
  }

  smtpTransport(address: string, password: string) {
    const { smtp, tls } = this.config.gmail;
    return nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: tls, ignoreTLS: !tls, auth: { user: address, pass: password }, connectionTimeout: 30_000, greetingTimeout: 16_000, socketTimeout: 60_000 });
  }

  json(acc: GmailAccountRow | null, today: string) {
    if (!acc) return { connected: false, address: null, status: null, lastError: null, lastCheckAt: null, sentToday: 0, dailyLimit: 400, label: PROCESSED_LABEL };
    return {
      connected: true, address: String(acc.address), status: acc.status, lastError: acc.last_error ?? null,
      lastCheckAt: acc.last_check_at ? new Date(acc.last_check_at).toISOString() : null,
      sentToday: acc.sent_day && String(acc.sent_day) === today ? Number(acc.sent_count) : 0, dailyLimit: Number(acc.daily_limit), label: PROCESSED_LABEL,
    };
  }

  async get(auth: AuthContext) {
    this.assertEnabled();
    const tenant = await this.tenants.get(auth.tenantId);
    return this.json(await this.account(auth.tenantId), this.clock.today(tenant.timezone));
  }

  /**
   * Prueba la cuenta: entra por IMAP (y prepara la etiqueta COROC/Procesado) y por SMTP. Devuelve dónde empieza la
   * lectura: solo los correos que lleguen desde ahora, para no registrar dos veces pagos que ya se anotaron a mano.
   */
  async probe(address: string, password: string): Promise<{ ok: true; uidValidity: string; uidNext: number } | { ok: false; code: GmailProblem }> {
    const imap = this.imapClient(address, password);
    imap.on('error', () => undefined);
    let start: { uidValidity: string; uidNext: number };
    try {
      await imap.connect();
      const box = await imap.mailboxOpen('INBOX', { readOnly: true });
      start = { uidValidity: String(box.uidValidity), uidNext: Number(box.uidNext) };
      if (imap.capabilities.has('X-GM-EXT-1')) {
        await imap.mailboxCreate(PROCESSED_LABEL).catch((e: { serverResponseCode?: string }) => {
          if (e?.serverResponseCode !== 'ALREADYEXISTS') throw e;
        });
      }
      await imap.logout();
    } catch (e) {
      imap.close();
      return { ok: false, code: gmailProblem(e, 'imap') };
    }
    const smtp = this.smtpTransport(address, password);
    try {
      await smtp.verify();
    } catch (e) {
      return { ok: false, code: gmailProblem(e, 'smtp') };
    } finally {
      smtp.close();
    }
    return { ok: true, ...start };
  }

  /** Paso 4 del asistente: conecta el Gmail de la empresa con una contraseña de aplicación, después de probarla. */
  async save(auth: AuthContext, b: { address: string; appPassword: string }) {
    this.assertEnabled();
    const address = String(b.address).trim().toLowerCase();
    const password = normalizeAppPassword(b.appPassword);
    if (!password) throw new Problem(422, 'GMAIL_APP_PASSWORD_FORMAT', {}, [{ field: 'appPassword', message: 'format' }]);
    const r = await this.probe(address, password);
    if (!r.ok) throw new Problem(422, r.code);
    const tenant = await this.tenants.get(auth.tenantId);
    const row = await this.db.tx({ tenantId: auth.tenantId, userId: auth.userId, role: auth.role }, async (tx) => {
      const before = await tx.one<GmailAccountRow>('SELECT * FROM gmail_accounts WHERE tenant_id = current_tenant()');
      // Si es la misma cuenta, se sigue donde iba; si es otra, desde los correos que lleguen ahora.
      const same = before && String(before.address) === address && String(before.uid_validity) === r.uidValidity;
      const out = await tx.one<GmailAccountRow>(
        `INSERT INTO gmail_accounts (tenant_id, address, password_enc, status, last_error, last_check_at, uid_validity, last_uid, created_by)
         VALUES (current_tenant(), $1, $2, 'active', NULL, $3, $4, $5, $6)
         ON CONFLICT (tenant_id) DO UPDATE SET address = EXCLUDED.address, password_enc = EXCLUDED.password_enc, status = 'active', last_error = NULL,
                last_check_at = EXCLUDED.last_check_at, uid_validity = EXCLUDED.uid_validity, last_uid = EXCLUDED.last_uid, updated_at = now()
         RETURNING *`,
        [address, this.box.seal(Buffer.from(password), `gmail:${auth.tenantId}`), this.clock.now(), r.uidValidity, same ? Number(before!.last_uid) : Math.max(0, r.uidNext - 1), auth.userId],
      );
      await this.audit.log(tx, 'gmail.connected', 'company', auth.tenantId, { after: { address } });
      return out!;
    });
    this.log.log('Gmail conectado');
    return this.json(row, this.clock.today(tenant.timezone));
  }

  /** «Probar conexión»: vuelve a entrar con la contraseña guardada y, si funciona, reactiva la cuenta. */
  async test(auth: AuthContext) {
    this.assertEnabled();
    const acc = await this.account(auth.tenantId);
    if (!acc) throw new Problem(409, 'GMAIL_NOT_CONNECTED');
    const r = await this.probe(String(acc.address), this.password(acc));
    const tenant = await this.tenants.get(auth.tenantId);
    const row = await this.db.tx({ tenantId: auth.tenantId }, (tx) =>
      tx.one<GmailAccountRow>(
        "UPDATE gmail_accounts SET status = $1, last_error = $2, last_check_at = $3, updated_at = now() WHERE tenant_id = current_tenant() RETURNING *",
        [r.ok || r.code === 'GMAIL_UNREACHABLE' ? 'active' : 'error', r.ok ? null : r.code, this.clock.now()],
      ),
    );
    if (!r.ok) throw new Problem(422, r.code);
    return this.json(row, this.clock.today(tenant.timezone));
  }

  async remove(auth: AuthContext): Promise<void> {
    this.assertEnabled();
    await this.db.tx({ tenantId: auth.tenantId, userId: auth.userId, role: auth.role }, async (tx) => {
      if (await tx.exec('DELETE FROM gmail_accounts WHERE tenant_id = current_tenant()')) await this.audit.log(tx, 'gmail.disconnected', 'company', auth.tenantId);
    });
  }

  /** Error de la cuenta: con la contraseña rechazada se deja de intentar (Google bloquea los reintentos) hasta corregirla. */
  async markError(tenantId: string, code: GmailProblem): Promise<void> {
    await this.db.tx({ tenantId }, (tx) =>
      tx.exec('UPDATE gmail_accounts SET status = $1, last_error = $2, last_check_at = $3, updated_at = now() WHERE tenant_id = current_tenant()', [
        code === 'GMAIL_AUTH_FAILED' || code === 'GMAIL_APP_PASSWORD_REQUIRED' ? 'error' : 'active', code, this.clock.now(),
      ]),
    );
  }

  /**
   * Envío por el SMTP de Gmail con el límite diario de la cuenta (Gmail admite unos 500 destinatarios al día; COROC usa
   * 400 por defecto). Si se alcanzó, el mensaje espera al día siguiente en vez de fallar.
   */
  async send(tenantId: string, m: OutboundEmail & { inReplyTo?: string | null; references?: string[] }): Promise<GmailSendResult> {
    const acc = await this.account(tenantId);
    if (!acc || acc.status !== 'active') return { ok: false, permanent: false, error: 'GMAIL_NOT_CONNECTED' };
    const tenant = await this.tenants.get(tenantId);
    const today = this.clock.today(tenant.timezone);
    const slot = await this.db.tx({ tenantId }, (tx) =>
      tx.one(
        `UPDATE gmail_accounts SET sent_count = CASE WHEN sent_day = $1::date THEN sent_count + 1 ELSE 1 END, sent_day = $1::date
          WHERE tenant_id = current_tenant() AND (sent_day IS DISTINCT FROM $1::date OR sent_count < daily_limit) RETURNING sent_count`,
        [today],
      ),
    );
    if (!slot) return { ok: false, permanent: false, error: 'GMAIL_DAILY_LIMIT', limited: true };
    const transport = this.smtpTransport(String(acc.address), this.password(acc));
    try {
      const name = (m.from.match(/^"([^"]*)"/)?.[1] ?? tenant.name).replace(/["\\\r\n]/g, '');
      const info = await transport.sendMail({
        from: { name, address: String(acc.address) }, to: m.to, subject: m.subject, text: m.text, html: m.html,
        inReplyTo: m.inReplyTo ?? undefined, references: m.references?.length ? m.references : undefined,
        attachments: (m.attachments ?? []).map((a) => ({ filename: a.name, content: a.content, contentType: a.contentType, ...(a.cid ? { cid: a.cid } : {}) })),
        headers: m.metadata?.message ? { 'X-Coroc-Message': m.metadata.message } : undefined,
      });
      return { ok: true, providerId: String(info.messageId) };
    } catch (e) {
      // El cupo no se gastó: el mensaje no salió.
      await this.db.tx({ tenantId }, (tx) => tx.exec('UPDATE gmail_accounts SET sent_count = greatest(0, sent_count - 1) WHERE tenant_id = current_tenant() AND sent_day = $1::date', [today]));
      const code = gmailProblem(e, 'smtp');
      if (code === 'GMAIL_AUTH_FAILED' || code === 'GMAIL_APP_PASSWORD_REQUIRED') {
        await this.markError(tenantId, code);
        return { ok: false, permanent: false, error: code };
      }
      const rc = (e as { responseCode?: number }).responseCode ?? 0;
      // 5xx: buzón inexistente o dirección inválida (permanente); 4xx y fallas de red se reintentan.
      return { ok: false, permanent: rc >= 500 && rc < 600, error: code === 'GMAIL_UNREACHABLE' ? code : `SMTP ${rc || code}` };
    } finally {
      transport.close();
    }
  }

  /** El recibo de un comprobante que llegó por correo responde en el mismo hilo de Gmail. */
  async replyTarget(tx: Tx, entryId: string | null): Promise<{ messageId: string; subject: string | null } | null> {
    if (!entryId) return null;
    return tx.one<{ messageId: string; subject: string | null }>(
      `SELECT em.message_id AS "messageId", em.subject FROM intake_events ie
         JOIN email_messages em ON em.direction = 'in' AND em.message_id = regexp_replace(ie.provider_msg_id, '#[0-9]+$', '')
        WHERE ie.entry_id = $1 AND ie.channel = 'email' ORDER BY ie.created_at LIMIT 1`,
      [entryId],
    );
  }

  /** Un correo del hilo del cliente (lo que llegó o lo que COROC envió). */
  async record(tx: Tx, r: { clientId: string | null; direction: 'in' | 'out'; messageId: string; inReplyTo?: string | null; subject?: string | null; text?: string | null; from?: string | null; to?: string | null; attachments?: unknown[]; outboundId?: string | null; at: Date }): Promise<void> {
    const snippet = (r.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 280) || null;
    await tx.exec(
      `INSERT INTO email_messages (tenant_id, client_id, direction, message_id, in_reply_to, subject, snippet, from_address, to_address, attachments, outbound_id, at)
       VALUES (current_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (tenant_id, direction, message_id) DO NOTHING`,
      [r.clientId, r.direction, r.messageId.slice(0, 500), r.inReplyTo?.slice(0, 500) ?? null, r.subject?.slice(0, 300) ?? null, snippet, r.from ?? null, r.to ?? null, JSON.stringify(r.attachments ?? []), r.outboundId ?? null, r.at],
    );
  }

  threadJson(r: Record<string, any>) {
    return {
      id: r.id, direction: r.direction, subject: r.subject ?? null, snippet: r.snippet ?? null, from: r.from_address ?? null, to: r.to_address ?? null,
      attachments: r.attachments ?? [], messageId: r.outbound_id ?? null, at: new Date(r.at).toISOString(),
    };
  }
}
