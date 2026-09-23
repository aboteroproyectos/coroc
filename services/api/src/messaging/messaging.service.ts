import crypto from 'node:crypto';
import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import {
  DEFAULT_TEMPLATES,
  EMAIL_SUBJECTS,
  EVENT_DEFAULTS,
  LOCALE_OF,
  MESSAGE_EVENTS,
  addDays,
  effectiveRuleSet,
  evaluateContact,
  formatMoney,
  fromLocalDateTime,
  insideServiceWindow,
  isOptOut,
  mailtoLink,
  optOutHint,
  renderTemplate,
  templateVariables,
  toLocalDateTime,
  validateTemplate,
  whatsappLink,
  type Channel,
  type ContactDecision,
  type ContactRecord,
  type ContactRuleSet,
  type ContactWindow,
  type Currency,
  type MessageEvent,
  type MessageKind,
  type ReasonCode,
  type TemplateValues,
} from '@coroc/core';
import { AuditService } from '../audit/audit.service.js';
import { SecretBox } from '../auth/crypto.js';
import { Clock } from '../common/clock.js';
import { t, type Lang } from '../common/i18n.js';
import { TenantCache, type TenantInfo } from '../company/tenant-cache.js';
import { CONFIG, type AppConfig } from '../config.js';
import { EventBus } from '../dashboard/event-bus.js';
import { DbService, type Tx } from '../db/db.service.js';
import { LinkSigner } from '../documents/links.js';
import { UploadLinksService } from '../intake/upload-links.service.js';
import { LoanStateService } from '../loans/loan-state.service.js';
import { ObjectStore } from '../storage/object-store.js';
import { EmailProvider, LOGO_CID, emailHtml, emailLogo } from './email.js';
import { SUSPENSION_CODES, isSuspensionUpdate, sendCloudMessage } from './whatsapp.js';

export interface EnqueueRequest {
  event: MessageEvent;
  loanId: string;
  /** Clave de idempotencia del hecho; se le agrega el canal. */
  dedupeKey: string;
  /** Canales pedidos (mensaje manual). Si no, los de la configuración del evento. */
  channels?: Channel[];
  entryId?: string | null;
  installmentNumber?: number | null;
  /** Tarea que genera el PDF del mensaje: el envío espera a que termine. */
  documentTaskId?: string | null;
  /** Canal por el que llegó el comprobante (el recibo responde por el mismo, §11.3). */
  source?: string | null;
  body?: string | null;
  requestedAt?: Date;
  createdBy?: string | null;
}

export type MessageRow = Record<string, any>;

const MAX_ATTEMPTS = 6;
const ACTIVE_STATUSES = ['scheduled', 'ready', 'sent', 'delivered', 'read'];
/** Eventos con un PDF que se entrega con enlace seguro (§11.1 modo B) o adjunto (§11.2). */
const WITH_DOCUMENT = new Set<MessageEvent>(['welcome', 'receipt', 'statement', 'payoff']);

/**
 * Mensajería automática (§11): registra cada mensaje en la transacción del hecho que lo origina, decide con el motor de
 * reglas de contacto en la hora local del deudor (§11.4), y un despachador lo envía por correo, por la Cloud API de
 * WhatsApp (modo A) o lo deja listo para el modo asistido (modo B). Si Meta suspende la cuenta, la empresa pasa al modo
 * asistido sin perder mensajes (CA-20).
 */
@Injectable()
export class MessagingService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Mensajería');
  private readonly box: SecretBox;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<number> | null = null;
  private stopped = false;

  constructor(
    private readonly db: DbService,
    private readonly tenants: TenantCache,
    private readonly state: LoanStateService,
    private readonly links: UploadLinksService,
    private readonly signer: LinkSigner,
    private readonly store: ObjectStore,
    private readonly email: EmailProvider,
    private readonly audit: AuditService,
    private readonly bus: EventBus,
    private readonly clock: Clock,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {
    this.box = new SecretBox(config.dataKey);
  }

  // ───────────────────────── Configuración ─────────────────────────

  /** Evento activo y sus canales (§11.3): lo que la empresa configuró o los valores por defecto. */
  eventConfig(tenant: TenantInfo, event: MessageEvent): { enabled: boolean; channels: Channel[] } {
    const base = EVENT_DEFAULTS[event];
    const custom = (tenant.settings.messageEvents ?? {})[event] as { enabled?: boolean; channels?: Channel[] } | undefined;
    const channels = (custom?.channels ?? base.channels).filter((c) => c === 'whatsapp' || c === 'email');
    // Los recordatorios de préstamos diarios están apagados por defecto (§11.3).
    return { enabled: custom?.enabled ?? base.enabled, channels };
  }

  /** Reglas vigentes de la empresa (§11.4): el preset elegido, o el de Colombia mientras falte la revisión legal. */
  async rulesFor(tx: Tx, tenant: TenantInfo): Promise<{ rules: ContactRuleSet; preset: string | null; reviewedAt: string | null }> {
    const row = await tx.one<{ preset: string; reviewed_by_counsel_at: Date | null }>('SELECT preset, reviewed_by_counsel_at FROM contact_rule_sets WHERE active LIMIT 1');
    return {
      rules: effectiveRuleSet(row?.preset ?? null, tenant.country, !!row?.reviewed_by_counsel_at),
      preset: row?.preset ?? null,
      reviewedAt: row?.reviewed_by_counsel_at ? new Date(row.reviewed_by_counsel_at).toISOString() : null,
    };
  }

  /** Plantilla de la empresa en el idioma del deudor o, si no la personalizó, la de COROC. */
  async template(tx: Tx, event: MessageEvent, lang: Lang) {
    const r = await tx.one<Record<string, any>>('SELECT * FROM message_templates WHERE event = $1 AND lang = $2 AND active', [event, lang]);
    return {
      body: (r?.body as string) ?? DEFAULT_TEMPLATES[lang][event],
      subject: (r?.subject as string | null) ?? EMAIL_SUBJECTS[lang][event],
      metaName: (r?.meta_template_name as string | null) ?? null,
      metaLang: (r?.meta_template_lang as string | null) ?? (lang === 'pt-BR' ? 'pt_BR' : lang === 'en' ? 'en_US' : 'es'),
      custom: !!r,
    };
  }

  private kindOf(event: MessageEvent): MessageKind {
    return EVENT_DEFAULTS[event].kind;
  }

  /** Enlace seguro de descarga del PDF del mensaje (§11.1), válido 30 días por defecto. */
  deliveryLink(tenantId: string, messageId: string): string {
    return this.signer.url(this.signer.sign({ t: tenantId, k: 'message', i: messageId }, this.config.deliveryLinkDays * 86_400).token);
  }

  /** Valores de las variables (§11.3) derivados del libro en este momento, formateados en el idioma del deudor. */
  async values(tx: Tx, tenant: TenantInfo, args: { loanId: string; client: Record<string, any>; lang: Lang; event: MessageEvent; messageId: string; entryId?: string | null; installmentNumber?: number | null; uploadUrl: string }): Promise<TemplateValues> {
    const l = (await this.state.load(tx, args.loanId))!;
    const r = this.state.replay(l, this.clock.today(tenant.timezone));
    const locale = LOCALE_OF[args.lang];
    const money = (n: number) => formatMoney(n, l.loan.currency as Currency, locale);
    const date = (d: string) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
    const target =
      (args.installmentNumber ? r.states.find((s) => s.number === args.installmentNumber) : undefined) ??
      (r.summary.next ? r.states.find((s) => s.number === r.summary.next!.number) : undefined) ??
      r.states[0];
    const entry = args.entryId ? l.ledger.find((e) => e.id === args.entryId) : undefined;
    return {
      nombre: args.client.first_name,
      apellidos: args.client.last_name,
      contrato: l.loan.contract,
      valor_cuota: target ? money(Math.max(0, target.amount - (args.event === 'welcome' ? 0 : target.paid))) : '',
      fecha_vencimiento: target ? date(target.dueDate) : '',
      cuota_numero: target ? String(target.number) : '',
      cuotas_restantes: String(r.summary.remainingInstallments),
      saldo: money(r.summary.balance),
      valor_pagado: entry ? money(entry.amount) : '',
      enlace_carga: args.uploadUrl,
      enlace_recibo: WITH_DOCUMENT.has(args.event) ? this.deliveryLink(tenant.id, args.messageId) : '',
      empresa: tenant.name,
      telefono_empresa: tenant.phone ?? tenant.email ?? '',
    };
  }

  /** Contactos de cobranza del deudor que cuentan para las reglas: enviados y los que ya esperan turno. */
  private async history(tx: Tx, clientId: string, tz: string, exceptId: string | null): Promise<ContactRecord[]> {
    const rows = await tx.many<{ at: Date; channel: Channel }>(
      `SELECT coalesce(sent_at, scheduled_at) AS at, channel FROM messages
        WHERE client_id = $1 AND kind = 'collection' AND status = ANY($2::message_status[]) AND ($3::uuid IS NULL OR id <> $3)
          AND coalesce(sent_at, scheduled_at) > $4::timestamptz - interval '21 days'`,
      [clientId, ACTIVE_STATUSES, exceptId, this.clock.now()],
    );
    return rows.filter((r) => r.at).map((r) => ({ at: toLocalDateTime(new Date(r.at), tz), kind: 'collection', channel: r.channel }));
  }

  /** Motivos que bloquean el mensaje antes del motor: consentimiento, exclusión, dirección y préstamo cerrado. */
  private async precheck(tx: Tx, client: Record<string, any>, loanStatus: string, channel: Channel, kind: MessageKind, body: string): Promise<{ code: ReasonCode; detail?: string } | null> {
    if (kind === 'collection' && loanStatus !== 'active') return { code: 'LOAN_CLOSED' };
    const consent = await tx.one<{ revoked_at: Date | null }>('SELECT revoked_at FROM consents WHERE client_id = $1 AND channel = $2 ORDER BY (revoked_at IS NULL) DESC, granted_at DESC LIMIT 1', [client.id, channel]);
    if (!consent) return { code: 'NO_CONSENT', detail: channel };
    if (consent.revoked_at) return { code: 'OPTED_OUT', detail: channel };
    if (channel === 'email' && !client.email) return { code: 'NO_ADDRESS', detail: 'email' };
    if (channel === 'email' && client.email_status) return { code: 'ADDRESS_INVALID', detail: client.email_status };
    const issues = validateTemplate(body);
    if (issues.length) return { code: 'CONTENT_BLOCKED', detail: issues.map((i) => i.code).join(',') };
    return null;
  }

  private decisionJson(d: ContactDecision, tz: string) {
    return { ...d, localAt: d.at ?? null, at: d.at ? fromLocalDateTime(d.at, tz).toISOString() : undefined, timeZone: tz };
  }

  // ───────────────────────── Registro ─────────────────────────

  /**
   * Registra los mensajes de un hecho dentro de su transacción (§14 paso 5). Devuelve las filas creadas; si el hecho ya
   * había generado el mensaje (misma clave), no crea otro.
   */
  async enqueueTx(tx: Tx, tenantId: string, req: EnqueueRequest): Promise<MessageRow[]> {
    const tenant = await this.tenants.get(tenantId);
    const cfg = this.eventConfig(tenant, req.event);
    if (!req.channels && !cfg.enabled) return [];
    const loan = await tx.one<{ id: string; client_id: string; status: string }>('SELECT id, client_id, status FROM loans WHERE id = $1', [req.loanId]);
    if (!loan) return [];
    const client = (await tx.one<Record<string, any>>('SELECT * FROM clients WHERE id = $1', [loan.client_id]))!;
    let channels = req.channels ?? cfg.channels;
    // El recibo sale por el canal por el que llegó el comprobante (§11.3).
    if (req.event === 'receipt' && !req.channels && (req.source === 'whatsapp' || req.source === 'email')) channels = [req.source];
    const lang = client.lang as Lang;
    const kind = this.kindOf(req.event);
    const tz = (client.timezone as string | null) ?? tenant.timezone;
    const { rules } = await this.rulesFor(tx, tenant);
    const requestedAt = req.requestedAt ?? this.clock.now();
    const history = await this.history(tx, client.id, tz, null);
    const upload = await this.links.ensureTx(tx, tenantId, loan.id, req.createdBy ?? null);
    const tpl = await this.template(tx, req.event, lang);
    const out: MessageRow[] = [];
    for (const channel of [...new Set(channels)]) {
      const id = crypto.randomUUID();
      const values = await this.values(tx, tenant, { loanId: loan.id, client, lang, event: req.event, messageId: id, entryId: req.entryId, installmentNumber: req.installmentNumber, uploadUrl: upload.url });
      const source = req.body?.trim() ? req.body.trim() : tpl.body;
      const body = channel === 'whatsapp' ? `${renderTemplate(source, values)}\n\n${optOutHint(lang)}` : renderTemplate(source, values);
      const subject = renderTemplate(tpl.subject, values);
      const pre = await this.precheck(tx, client, loan.status, channel, kind, source);
      let decision: ContactDecision;
      if (pre) decision = { decision: 'block', reasons: [pre], ruleSet: rules.id };
      else {
        decision = evaluateContact({ kind, channel, requestedAt: toLocalDateTime(requestedAt, tz) }, history, rules, {
          transactionalImmediate: !!tenant.settings.transactionalImmediate,
          debtorAuthorizedWindows: (client.authorized_windows as ContactWindow[] | null) ?? undefined,
        });
      }
      const status = decision.decision === 'block' ? 'blocked' : 'scheduled';
      const scheduledAt = decision.decision === 'send' ? requestedAt : decision.decision === 'reschedule' ? fromLocalDateTime(decision.at!, tz) : null;
      const row = await tx.one<MessageRow>(
        `INSERT INTO messages (id, tenant_id, client_id, loan_id, event, kind, channel, lang, body, subject, vars, requested_at, scheduled_at, decision, status,
                               dedupe_key, entry_id, document_task_id, address, created_by)
         VALUES ($1, current_tenant(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
         ON CONFLICT (tenant_id, dedupe_key) DO NOTHING RETURNING *`,
        [
          id, client.id, loan.id, req.event, kind, channel, lang, body, subject, JSON.stringify({ order: templateVariables(source), values }), requestedAt, scheduledAt,
          JSON.stringify(this.decisionJson(decision, tz)), status, `${req.dedupeKey}:${channel}`, req.entryId ?? null, req.documentTaskId ?? null,
          channel === 'email' ? client.email : client.phone_e164, req.createdBy ?? null,
        ],
      );
      if (!row) continue;
      if (status === 'scheduled' && kind === 'collection') history.push({ at: decision.at!, kind, channel });
      out.push(row);
    }
    return out;
  }

  /** Eventos en vivo después del commit de un registro. */
  published(tenantId: string, rows: MessageRow[], collectorId?: string | null): void {
    for (const m of rows) this.bus.publish({ type: 'message.updated', tenantId, clientId: m.client_id, collectorId: collectorId ?? null, data: { messageId: m.id, status: m.status, clientId: m.client_id } });
    if (rows.some((m) => m.status === 'scheduled')) this.kick();
  }

  // ───────────────────────── Despacho ─────────────────────────

  /** Procesa pronto (después del commit que registró mensajes). En pruebas (`inline`) se llama a `dispatchDue`. */
  kick(): void {
    if (this.config.messageWorker !== 'on' || this.stopped) return;
    setImmediate(() => void this.dispatchDue().catch((e: Error) => this.log.error(e.message)));
  }

  /** Envía los mensajes cuya hora llegó, de todas las empresas. Varias instancias pueden correrlo a la vez. */
  async dispatchDue(): Promise<number> {
    if (this.running) return this.running;
    this.running = (async () => {
      let n = 0;
      for (let round = 0; round < 40; round++) {
        const claimed = await this.db.tx(null, (tx) => tx.many<{ id: string; tenant_id: string }>('SELECT * FROM claim_due_messages($1, $2, $3)', [25, 300, this.clock.now()]));
        if (!claimed.length) break;
        for (const c of claimed) {
          try {
            if (await this.deliver(c.id, c.tenant_id)) n++;
          } catch (e) {
            this.log.warn(`Mensaje ${c.id}: ${(e as Error).message}`);
            await this.db.tx({ tenantId: c.tenant_id }, (tx) => tx.exec("UPDATE messages SET locked_until = now() + interval '2 minutes' WHERE id = $1", [c.id]));
          }
        }
      }
      return n;
    })().finally(() => (this.running = null));
    return this.running;
  }

  private async whatsappAccount(tx: Tx) {
    return tx.one<Record<string, any>>('SELECT * FROM whatsapp_accounts WHERE tenant_id = current_tenant()');
  }

  /** Canal de WhatsApp que usa la empresa ahora: Cloud API solo si está activada, completa y sin suspensión. */
  private cloudReady(tenant: TenantInfo, account: Record<string, any> | null): boolean {
    return tenant.settings.whatsappMode === 'cloud_api' && !!account?.active && account.status === 'active' && !!this.config.whatsapp.appSecret;
  }

  /** Un mensaje: revalida las reglas, espera su PDF y lo envía. Devuelve true si cambió de estado. */
  async deliver(id: string, tenantId: string): Promise<boolean> {
    const tenant = await this.tenants.get(tenantId);
    const ctx = { tenantId };
    const prep = await this.db.tx(ctx, async (tx) => {
      const m = await tx.one<MessageRow>('SELECT * FROM messages WHERE id = $1 FOR UPDATE', [id]);
      if (!m || m.status !== 'scheduled') return null;
      const client = (await tx.one<Record<string, any>>('SELECT * FROM clients WHERE id = $1', [m.client_id]))!;
      const loan = m.loan_id ? await tx.one<{ status: string }>('SELECT status FROM loans WHERE id = $1', [m.loan_id]) : null;
      const tz = (client.timezone as string | null) ?? tenant.timezone;
      const { rules } = await this.rulesFor(tx, tenant);
      const pre = await this.precheck(tx, client, loan?.status ?? 'active', m.channel, m.kind, m.event === 'manual' ? m.body : 'ok');
      if (pre) return { done: await this.update(tx, id, { status: 'blocked', decision: JSON.stringify({ ...m.decision, decision: 'block', reasons: [...(m.decision.reasons ?? []), pre] }) }) };
      // Las reglas se vuelven a aplicar en el momento del envío: otro mensaje pudo ocupar el cupo del día (§11.4).
      const d = evaluateContact({ kind: m.kind, channel: m.channel, requestedAt: toLocalDateTime(this.clock.now(), tz) }, await this.history(tx, client.id, tz, id), rules, {
        transactionalImmediate: !!tenant.settings.transactionalImmediate,
        debtorAuthorizedWindows: (client.authorized_windows as ContactWindow[] | null) ?? undefined,
      });
      if (d.decision === 'block') return { done: await this.update(tx, id, { status: 'blocked', decision: JSON.stringify(this.decisionJson(d, tz)) }) };
      if (d.decision === 'reschedule') {
        return { done: await this.update(tx, id, { scheduled_at: fromLocalDateTime(d.at!, tz), locked_until: null, decision: JSON.stringify(this.decisionJson({ ...d, reasons: [...(m.decision.reasons ?? []), ...d.reasons] }, tz)) }) };
      }
      let attachment: string | null = m.attachment_document_id;
      if (m.document_task_id && !attachment) {
        const task = await tx.one<{ status: string; document_id: string | null }>('SELECT status, document_id FROM document_tasks WHERE id = $1', [m.document_task_id]);
        if (task && (task.status === 'pending' || task.status === 'running')) {
          // El PDF todavía se está generando: se reintenta en un minuto sin contar como intento.
          await tx.exec("UPDATE messages SET locked_until = now() + interval '1 minute' WHERE id = $1", [id]);
          return { wait: true };
        }
        attachment = task?.document_id ?? null;
        if (attachment) await tx.exec('UPDATE messages SET attachment_document_id = $2 WHERE id = $1', [id, attachment]);
      }
      const account = m.channel === 'whatsapp' ? await this.whatsappAccount(tx) : null;
      const upload = m.loan_id ? await this.links.ensureTx(tx, tenantId, m.loan_id, null) : null;
      const tpl = await this.template(tx, m.event, m.lang);
      const doc = attachment ? await tx.one<{ storage_key: string; size_bytes: number; mime: string; file_name: string }>('SELECT storage_key, size_bytes, mime, file_name FROM documents WHERE id = $1', [attachment]) : null;
      return { m, client, account, upload, tpl, doc };
    });
    if (!prep) return false;
    if ('wait' in prep) return false;
    if ('done' in prep) {
      this.publishOne(tenantId, prep.done!);
      return true;
    }
    const { m, client, account, upload, tpl, doc } = prep;
    if (m.channel === 'email') return this.deliverEmail(tenant, m, client, doc, upload?.url ?? null);
    return this.deliverWhatsApp(tenant, m, client, account, tpl);
  }

  private async update(tx: Tx, id: string, fields: Record<string, unknown>): Promise<MessageRow> {
    const keys = Object.keys(fields);
    const sets = keys.map((k, i) => `${k} = $${i + 2}${k === 'status' ? '::message_status' : k === 'decision' || k === 'vars' ? '::jsonb' : ''}`);
    return (await tx.one<MessageRow>(`UPDATE messages SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, [id, ...keys.map((k) => fields[k])]))!;
  }

  private publishOne(tenantId: string, m: MessageRow): void {
    this.bus.publish({ type: 'message.updated', tenantId, clientId: m.client_id, collectorId: null, data: { messageId: m.id, status: m.status, clientId: m.client_id } });
  }

  /** Remitente: el dominio propio de la empresa si está verificado; si no, el de COROC con el nombre de la empresa. */
  private async sender(tenant: TenantInfo): Promise<{ from: string; replyTo: string | null }> {
    const s = await this.db.tx({ tenantId: tenant.id }, (tx) => tx.one<Record<string, any>>('SELECT * FROM email_senders WHERE tenant_id = current_tenant()'));
    const quote = (n: string) => `"${n.replace(/["\\\r\n]/g, '')}"`;
    if (s?.verified_at) return { from: `${quote(s.from_name || tenant.name)} <${s.from_email}>`, replyTo: tenant.email ?? null };
    return { from: `${quote(tenant.name)} <${this.config.email.from}>`, replyTo: tenant.email ?? null };
  }

  private async deliverEmail(tenant: TenantInfo, m: MessageRow, client: Record<string, any>, doc: { storage_key: string; size_bytes: number; mime: string; file_name: string } | null, uploadUrl: string | null): Promise<boolean> {
    const lang = m.lang as Lang;
    if (this.email.name === 'none') {
      const out = await this.db.tx({ tenantId: tenant.id }, (tx) => this.toAssisted(tx, m, client, 'EMAIL_NOT_CONFIGURED'));
      this.publishOne(tenant.id, out);
      return true;
    }
    const attachments = [{ name: 'coroc.png', content: emailLogo(), contentType: 'image/png', cid: LOGO_CID }];
    if (doc) attachments.push({ name: doc.file_name, content: await this.store.getBuffer(tenant.id, doc.storage_key, Number(doc.size_bytes)), contentType: doc.mime } as (typeof attachments)[number]);
    const sender = await this.sender(tenant);
    const footer = t(lang, 'messaging.emailFooter', { company: tenant.name });
    const unsubscribeUrl = uploadUrl ? `${uploadUrl}/opt-out?channel=email` : null;
    const text = `${m.body}\n\n${footer}${unsubscribeUrl ? `\n${t(lang, 'messaging.unsubscribe')}: ${unsubscribeUrl}` : ''}`;
    const r = await this.email.send({
      from: sender.from, replyTo: sender.replyTo, to: client.email, subject: m.subject || EMAIL_SUBJECTS[lang][m.event as MessageEvent], text,
      html: emailHtml({ company: tenant.name, text: m.body, footer, lang }), attachments, metadata: { tenant: tenant.id, message: m.id }, unsubscribeUrl,
    });
    const out = await this.db.tx({ tenantId: tenant.id }, async (tx) => {
      if (r.ok) return this.update(tx, m.id, { status: 'sent', sent_at: this.clock.now(), provider_message_id: r.providerId, via: 'email', address: client.email, attempts: m.attempts + 1, locked_until: null, error: null });
      if (r.permanent) {
        // Dirección inválida: se marca en la ficha del cliente y no se vuelve a usar (§11.2).
        await tx.exec("UPDATE clients SET email_status = 'bounced', email_status_at = now() WHERE id = $1", [client.id]);
        await this.audit.log(tx, 'client.email_invalid', 'client', client.id, { after: { reason: r.error } });
        return this.update(tx, m.id, { status: 'failed', failed_at: this.clock.now(), error: r.error, via: 'email', attempts: m.attempts + 1, locked_until: null });
      }
      return this.retryLater(tx, m, r.error);
    });
    this.publishOne(tenant.id, out);
    return true;
  }

  /** Error transitorio: reintento exponencial; tras el último, el mensaje queda fallido y visible. */
  private async retryLater(tx: Tx, m: MessageRow, error: string): Promise<MessageRow> {
    const attempts = m.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) return this.update(tx, m.id, { status: 'failed', failed_at: this.clock.now(), error, attempts, locked_until: null });
    return this.update(tx, m.id, { scheduled_at: new Date(this.clock.now().getTime() + Math.min(3600, 30 * 2 ** attempts) * 1000), attempts, error, locked_until: null });
  }

  /** Modo asistido (§11.1 modo B): el mensaje queda en «Por enviar hoy» con el texto listo. */
  private async toAssisted(tx: Tx, m: MessageRow, client: Record<string, any>, error: string | null): Promise<MessageRow> {
    return this.update(tx, m.id, { status: 'ready', via: 'assisted', address: m.channel === 'email' ? client.email : client.phone_e164, error, locked_until: null });
  }

  private async deliverWhatsApp(tenant: TenantInfo, m: MessageRow, client: Record<string, any>, account: Record<string, any> | null, tpl: Awaited<ReturnType<MessagingService['template']>>): Promise<boolean> {
    if (!this.cloudReady(tenant, account)) {
      const out = await this.db.tx({ tenantId: tenant.id }, (tx) => this.toAssisted(tx, m, client, null));
      this.publishOne(tenant.id, out);
      return true;
    }
    const inside = insideServiceWindow(client.wa_last_inbound_at ? new Date(client.wa_last_inbound_at) : null, this.clock.now());
    const vars = (m.vars ?? { order: [], values: {} }) as { order: string[]; values: Record<string, string> };
    // Fuera de la ventana de 24 horas solo se puede usar una plantilla aprobada por Meta; un texto manual no tiene plantilla.
    if (!inside && (!tpl.metaName || m.event === 'manual')) {
      const out = await this.db.tx({ tenantId: tenant.id }, (tx) => this.toAssisted(tx, m, client, 'NO_META_TEMPLATE'));
      this.publishOne(tenant.id, out);
      return true;
    }
    const token = this.box.open(account!.token_enc, `whatsapp:${tenant.id}`).toString();
    const r = await sendCloudMessage(this.config.whatsapp, { phoneNumberId: account!.phone_number_id, token }, client.phone_e164,
      inside ? { type: 'text', body: m.body } : { type: 'template', name: tpl.metaName!, language: tpl.metaLang, parameters: vars.order.map((k) => vars.values[k] ?? '') });
    if (r.kind === 'suspended') {
      await this.suspendWhatsApp(tenant.id, `code ${r.code}`);
      const out = await this.db.tx({ tenantId: tenant.id }, (tx) => this.toAssisted(tx, m, client, `WHATSAPP_${r.code}`));
      this.publishOne(tenant.id, out);
      return true;
    }
    const out = await this.db.tx({ tenantId: tenant.id }, async (tx) => {
      if (r.kind === 'sent') return this.update(tx, m.id, { status: 'sent', sent_at: this.clock.now(), provider_message_id: r.id, via: 'cloud_api', address: client.phone_e164, attempts: m.attempts + 1, locked_until: null, error: null });
      if (r.kind === 'window') return this.toAssisted(tx, m, client, `WHATSAPP_${r.code}`);
      if (r.kind === 'permanent') return this.update(tx, m.id, { status: 'failed', failed_at: this.clock.now(), error: `WHATSAPP_${r.code}`, via: 'cloud_api', attempts: m.attempts + 1, locked_until: null });
      // Transitorio: se reintenta; si se agotan los intentos, sigue por el modo asistido en vez de perderse.
      if (m.attempts + 1 >= MAX_ATTEMPTS) return this.toAssisted(tx, m, client, `WHATSAPP_${r.code}`);
      return this.retryLater(tx, m, `WHATSAPP_${r.code}`);
    });
    this.publishOne(tenant.id, out);
    return true;
  }

  // ───────────────────────── Suspensión de WhatsApp (CA-20) ─────────────────────────

  /**
   * Meta suspendió o restringió la cuenta: la empresa pasa al modo asistido. Los mensajes en cola no se pierden: el
   * despachador los deja en «Por enviar hoy», y los que fallaron por la suspensión vuelven a esa cola. Se avisa al
   * propietario por correo y en la app.
   */
  async suspendWhatsApp(tenantId: string, reason: string): Promise<boolean> {
    const tenant = await this.tenants.get(tenantId);
    const changed = await this.db.tx({ tenantId }, async (tx) => {
      const acc = await tx.one(
        "UPDATE whatsapp_accounts SET status = 'suspended', suspended_at = now(), suspension_reason = $1, updated_at = now() WHERE tenant_id = current_tenant() AND status = 'active' RETURNING tenant_id",
        [reason.slice(0, 200)],
      );
      if (!acc) return false;
      await tx.exec(`UPDATE tenants SET settings = jsonb_set(settings, '{whatsappMode}', '"assisted"'), version = version + 1 WHERE id = current_tenant()`);
      const moved = await tx.exec(
        `UPDATE messages SET status = 'ready', via = 'assisted', address = coalesce(address, (SELECT phone_e164 FROM clients c WHERE c.id = client_id)), error = 'WHATSAPP_SUSPENDED'
          WHERE channel = 'whatsapp' AND status = 'failed' AND via = 'cloud_api' AND failed_at > $1::timestamptz - interval '24 hours'`,
        [this.clock.now()],
      );
      await this.audit.log(tx, 'whatsapp.suspended', 'company', tenantId, { after: { reason, mode: 'assisted', requeued: moved } });
      const owners = await tx.many<{ email: string; lang: Lang | null }>("SELECT email, lang FROM users WHERE role = 'owner' AND active AND email IS NOT NULL");
      return { owners };
    });
    this.tenants.invalidate(tenantId);
    if (!changed) return false;
    this.log.warn(`WhatsApp Cloud API suspendida para una empresa (${reason}); pasa al modo asistido`);
    this.bus.publish({ type: 'whatsapp.suspended', tenantId, data: { reason } });
    // Aviso al propietario por correo, en su idioma, además del aviso en la app y la bitácora.
    const recipients = new Map<string, Lang>(changed.owners.map((o) => [o.email.toLowerCase(), o.lang ?? tenant.lang]));
    if (tenant.email && !recipients.has(tenant.email.toLowerCase())) recipients.set(tenant.email.toLowerCase(), tenant.lang);
    for (const [to, lang] of recipients) {
      const text = t(lang, 'messaging.suspendedNotice', { company: tenant.name });
      await this.email.send({
        from: `"COROC" <${this.config.email.from}>`, to, subject: t(lang, 'messaging.suspendedSubject'), text,
        html: emailHtml({ company: tenant.name, text, footer: t(lang, 'doc.common.generatedBy'), lang }),
        attachments: [{ name: 'coroc.png', content: emailLogo(), contentType: 'image/png', cid: LOGO_CID }],
      }).catch(() => undefined);
    }
    return true;
  }

  // ───────────────────────── Webhooks entrantes ─────────────────────────

  /** Estados de entrega de la Cloud API: enviado → entregado → leído, o fallido (§11.3). */
  async onWhatsAppStatuses(tenantId: string, statuses: Record<string, any>[]): Promise<void> {
    const suspension = { code: 0 };
    const changed: MessageRow[] = [];
    await this.db.tx({ tenantId }, async (tx) => {
      for (const s of statuses) {
        const id = String(s.id ?? '');
        const at = s.timestamp ? new Date(Number(s.timestamp) * 1000) : this.clock.now();
        let row: MessageRow | null = null;
        if (s.status === 'delivered') {
          row = await tx.one<MessageRow>("UPDATE messages SET status = CASE WHEN status = 'read' THEN status ELSE 'delivered'::message_status END, delivered_at = coalesce(delivered_at, $2) WHERE provider_message_id = $1 RETURNING *", [id, at]);
        } else if (s.status === 'read') {
          row = await tx.one<MessageRow>("UPDATE messages SET status = 'read', read_at = coalesce(read_at, $2), delivered_at = coalesce(delivered_at, $2) WHERE provider_message_id = $1 RETURNING *", [id, at]);
        } else if (s.status === 'failed') {
          const code = Number(s.errors?.[0]?.code ?? 0);
          if (SUSPENSION_CODES.has(code)) suspension.code = code;
          row = await tx.one<MessageRow>("UPDATE messages SET status = 'failed', failed_at = $2, error = $3 WHERE provider_message_id = $1 RETURNING *", [id, at, `WHATSAPP_${code}`]);
        }
        if (row) changed.push(row);
      }
    });
    for (const m of changed) this.publishOne(tenantId, m);
    if (suspension.code) await this.suspendWhatsApp(tenantId, `code ${suspension.code}`);
  }

  /**
   * Mensaje del deudor por WhatsApp: abre la ventana de 24 horas y, si es una palabra de exclusión (SALIR, SAIR,
   * STOP), revoca de inmediato el consentimiento de WhatsApp y bloquea lo pendiente (§20.1).
   */
  async onWhatsAppInbound(tenantId: string, phone: string | null, text: string | null): Promise<{ optedOut: number }> {
    if (!phone) return { optedOut: 0 };
    const optOut = isOptOut(text);
    const blocked: MessageRow[] = [];
    const n = await this.db.tx({ tenantId }, async (tx) => {
      const clients = await tx.many<{ id: string }>('UPDATE clients SET wa_last_inbound_at = $2 WHERE phone_e164 = $1 OR phone2_e164 = $1 RETURNING id', [phone, this.clock.now()]);
      if (!optOut) return 0;
      for (const c of clients) await this.optOutTx(tx, c.id, ['whatsapp'], 'keyword', blocked);
      return clients.length;
    });
    for (const m of blocked) this.publishOne(tenantId, m);
    return { optedOut: n };
  }

  /** Exclusión: revoca el consentimiento del canal y bloquea los mensajes pendientes por ese canal. */
  async optOutTx(tx: Tx, clientId: string, channels: Channel[], via: 'keyword' | 'portal' | 'email_link' | 'complaint', blocked: MessageRow[] = []): Promise<number> {
    let n = 0;
    for (const channel of channels) {
      n += await tx.exec('UPDATE consents SET revoked_at = now() WHERE client_id = $1 AND channel = $2 AND revoked_at IS NULL', [clientId, channel]);
      const rows = await tx.many<MessageRow>(
        `UPDATE messages SET status = 'blocked', locked_until = NULL,
                decision = decision || jsonb_build_object('decision', 'block', 'reasons', coalesce(decision->'reasons', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('code', 'OPTED_OUT', 'detail', $2::text)))
          WHERE client_id = $1 AND channel = $2::channel AND status IN ('scheduled', 'ready') RETURNING *`,
        [clientId, channel],
      );
      blocked.push(...rows);
    }
    await this.audit.log(tx, 'consent.revoked', 'client', clientId, { after: { channels, via, reason: 'opt_out' } });
    return n;
  }

  /** `account_update` (suspensión o restricción de la cuenta) y `message_template_status_update` de Meta. */
  async onWhatsAppAccountEvent(wabaId: string, field: string, value: Record<string, any>): Promise<void> {
    const tenantId = (await this.db.tx(null, (tx) => tx.one<{ t: string | null }>('SELECT whatsapp_tenant_by_waba($1) AS t', [wabaId])))?.t;
    if (!tenantId) return;
    if (field === 'account_update' && isSuspensionUpdate(value)) {
      await this.suspendWhatsApp(tenantId, String(value.event ?? 'account_update').slice(0, 60));
      return;
    }
    if (field === 'message_template_status_update') {
      const ev = String(value.event ?? '').toUpperCase();
      // Una plantilla rechazada, pausada o desactivada deja de usarse: esos mensajes siguen por el modo asistido.
      if (['REJECTED', 'DISABLED', 'PAUSED', 'FLAGGED'].includes(ev) && value.message_template_name) {
        await this.db.tx({ tenantId }, async (tx) => {
          const n = await tx.exec('UPDATE message_templates SET meta_template_name = NULL, updated_at = now() WHERE meta_template_name = $1', [String(value.message_template_name)]);
          if (n) await this.audit.log(tx, 'whatsapp.template_disabled', 'company', tenantId, { after: { name: value.message_template_name, event: ev } });
        });
      }
    }
  }

  /** Avisos del proveedor de correo (formato de Postmark): entrega, rebote y queja (§11.2). */
  async onEmailEvent(e: Record<string, any>): Promise<boolean> {
    const providerId = String(e.MessageID ?? '');
    if (!providerId) return false;
    const tenantId = (await this.db.tx(null, (tx) => tx.one<{ t: string | null }>('SELECT message_tenant($1) AS t', [providerId])))?.t;
    if (!tenantId) return false;
    const type = String(e.RecordType ?? '');
    const blocked: MessageRow[] = [];
    const row = await this.db.tx({ tenantId }, async (tx) => {
      const m = await tx.one<MessageRow>('SELECT * FROM messages WHERE provider_message_id = $1', [providerId]);
      if (!m) return null;
      if (type === 'Delivery') return this.update(tx, m.id, { status: m.status === 'read' ? 'read' : 'delivered', delivered_at: e.DeliveredAt ? new Date(e.DeliveredAt) : this.clock.now() });
      if (type === 'Bounce') {
        // Rebote duro o dirección desactivada: la dirección se marca inválida; los rebotes suaves solo se registran.
        const hard = ['HardBounce', 'BadEmailAddress', 'ManuallyDeactivated', 'Unknown', 'SpamNotification', 'Blocked'].includes(String(e.Type)) || e.Inactive === true;
        if (hard) {
          await tx.exec("UPDATE clients SET email_status = 'bounced', email_status_at = now() WHERE id = $1", [m.client_id]);
          await this.audit.log(tx, 'client.email_invalid', 'client', m.client_id, { after: { reason: `bounce:${String(e.Type)}` } });
        }
        return this.update(tx, m.id, { status: 'failed', failed_at: this.clock.now(), error: `EMAIL_BOUNCE_${String(e.Type ?? 'Unknown').slice(0, 40)}` });
      }
      if (type === 'SpamComplaint' || type === 'SubscriptionChange') {
        if (type === 'SubscriptionChange' && e.SuppressSending === false) return m;
        await tx.exec("UPDATE clients SET email_status = 'complained', email_status_at = now() WHERE id = $1", [m.client_id]);
        await this.optOutTx(tx, m.client_id, ['email'], type === 'SpamComplaint' ? 'complaint' : 'email_link', blocked);
        return m;
      }
      return m;
    });
    if (row) this.publishOne(tenantId, row);
    for (const m of blocked) this.publishOne(tenantId, m);
    return !!row;
  }

  // ───────────────────────── Programador de cobranza (§11.3) ─────────────────────────

  /**
   * Recordatorios (1 día antes y el día del vencimiento) y aviso de cuota vencida (1 día después), a la hora
   * configurada en la zona del deudor. Las claves evitan duplicados aunque el trabajo corra varias veces.
   */
  async scheduleCollections(onlyTenant?: string): Promise<number> {
    const ids = onlyTenant ? [{ id: onlyTenant }] : await this.db.tx(null, (tx) => tx.many<{ id: string }>('SELECT tenants_with_active_loans() AS id'));
    let n = 0;
    for (const { id } of ids) {
      const tenant = await this.tenants.get(id);
      const today = this.clock.today(tenant.timezone);
      const days = [addDays(today, -1), today, addDays(today, 1)];
      const reminderTime = /^\d{2}:\d{2}$/.test(tenant.settings.reminderTime ?? '') ? (tenant.settings.reminderTime as string) : '08:00';
      const rows = await this.db.tx({ tenantId: id }, async (tx) => {
        const loans = await tx.many<{ id: string; frequency: string; timezone: string | null }>(
          `SELECT DISTINCT l.id, l.frequency, c.timezone FROM installments i JOIN loans l ON l.id = i.loan_id JOIN clients c ON c.id = l.client_id
            WHERE l.status = 'active' AND i.due_date = ANY($1::date[])`,
          [days],
        );
        const out: MessageRow[] = [];
        for (const loan of loans) {
          const l = await this.state.load(tx, loan.id);
          if (!l) continue;
          const r = this.state.replay(l, today);
          const tz = loan.timezone ?? tenant.timezone;
          const at = fromLocalDateTime(`${today}T${reminderTime}`, tz);
          const reminders = loan.frequency !== 'daily' || !!tenant.settings.dailyReminders;
          for (const s of r.states) {
            if (s.paid >= s.amount || s.waived) continue;
            const base = { loanId: loan.id, installmentNumber: s.number, requestedAt: at < this.clock.now() ? this.clock.now() : at };
            if (reminders && s.dueDate === days[2]) out.push(...(await this.enqueueTx(tx, id, { ...base, event: 'reminder', dedupeKey: `reminder:${loan.id}:${s.number}:before` })));
            if (reminders && s.dueDate === days[1]) out.push(...(await this.enqueueTx(tx, id, { ...base, event: 'reminder', dedupeKey: `reminder:${loan.id}:${s.number}:due` })));
            if (s.dueDate === days[0]) out.push(...(await this.enqueueTx(tx, id, { ...base, event: 'overdue', dedupeKey: `overdue:${loan.id}:${s.number}` })));
          }
        }
        // La cola del modo asistido no se acumula: los mensajes de cobranza sin enviar en dos días se descartan.
        await tx.exec("UPDATE messages SET status = 'cancelled', error = 'EXPIRED' WHERE status = 'ready' AND kind = 'collection' AND scheduled_at < $1::timestamptz - interval '2 days'", [this.clock.now()]);
        return out;
      });
      this.published(id, rows);
      n += rows.length;
    }
    return n;
  }

  // ───────────────────────── Vista ─────────────────────────

  /** El mensaje para la API, con los enlaces listos del modo asistido. */
  json(m: MessageRow, client?: { first_name: string; last_name: string; phone_e164: string; email: string | null } | null, contract?: string | null) {
    const phone = m.channel === 'whatsapp' ? (m.address ?? client?.phone_e164 ?? null) : null;
    const email = m.channel === 'email' ? (m.address ?? client?.email ?? null) : null;
    return {
      id: m.id, clientId: m.client_id, clientName: client ? `${client.first_name} ${client.last_name}` : null, loanId: m.loan_id ?? null, contract: contract ?? null,
      event: m.event, kind: m.kind, channel: m.channel, lang: m.lang, body: m.body, subject: m.subject ?? null,
      attachmentDocumentId: m.attachment_document_id ?? null, status: m.status, decision: m.decision,
      requestedAt: new Date(m.requested_at).toISOString(), scheduledAt: m.scheduled_at ? new Date(m.scheduled_at).toISOString() : null,
      sentAt: m.sent_at ? new Date(m.sent_at).toISOString() : null, deliveredAt: m.delivered_at ? new Date(m.delivered_at).toISOString() : null,
      readAt: m.read_at ? new Date(m.read_at).toISOString() : null, failedAt: m.failed_at ? new Date(m.failed_at).toISOString() : null,
      via: m.via ?? null, error: m.error ?? null, createdAt: new Date(m.created_at).toISOString(),
      assisted: m.status === 'ready' || m.status === 'scheduled'
        ? { ...(phone ? { whatsappUrl: whatsappLink(phone, m.body) } : {}), ...(email ? { mailtoUrl: mailtoLink(email, m.subject ?? '', m.body) } : {}) }
        : undefined,
    };
  }

  // ───────────────────────── Ciclo de vida ─────────────────────────

  onApplicationBootstrap(): void {
    if (this.config.messageWorker !== 'on') return;
    this.timer = setInterval(() => void this.dispatchDue().catch((e: Error) => this.log.error(e.message)), 30_000);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.running?.catch(() => undefined);
  }
}

export { MESSAGE_EVENTS };
