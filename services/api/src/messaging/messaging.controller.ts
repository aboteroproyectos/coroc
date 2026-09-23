import crypto from 'node:crypto';
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query } from '@nestjs/common';
import {
  CONTACT_PRESETS,
  DEFAULT_TEMPLATES,
  EMAIL_SUBJECTS,
  MESSAGE_EVENTS,
  evaluateContact,
  fromLocalDateTime,
  renderTemplate,
  templateVariables,
  toLocalDateTime,
  validateTemplate,
  type Channel,
  type ContactWindow,
  type MessageEvent,
  type TemplateValues,
} from '@coroc/core';
import { AuditService } from '../audit/audit.service.js';
import { AccessService } from '../common/access.js';
import { Clock } from '../common/clock.js';
import type { AuthContext } from '../common/context.js';
import { Auth, Op, Requires } from '../common/decorators.js';
import { LANGS, type Lang } from '../common/i18n.js';
import { Problem } from '../common/problem.js';
import { TenantCache } from '../company/tenant-cache.js';
import { CONFIG, type AppConfig } from '../config.js';
import { DbService, type Tx } from '../db/db.service.js';
import { checkDomain, DnsResolver } from './dns.js';
import { EmailProvider } from './email.js';
import { MessagingService, type MessageRow } from './messaging.service.js';

const ctxOf = (a: AuthContext) => ({ tenantId: a.tenantId, userId: a.userId, role: a.role });
const STATUSES = ['ready', 'scheduled', 'sent', 'delivered', 'read', 'failed', 'blocked', 'cancelled'];
const isEvent = (e: unknown): e is MessageEvent => (MESSAGE_EVENTS as unknown[]).includes(e);
const isLang = (l: unknown): l is Lang => (LANGS as unknown[]).includes(l);

/** Filas con el nombre del cliente y el contrato para la vista. */
async function withClients(tx: Tx, svc: MessagingService, rows: MessageRow[]) {
  if (!rows.length) return [];
  const clients = new Map((await tx.many<Record<string, any>>('SELECT id, first_name, last_name, phone_e164, email FROM clients WHERE id = ANY($1::uuid[])', [[...new Set(rows.map((r) => r.client_id))]])).map((c) => [c.id, c]));
  const loans = new Map((await tx.many<{ id: string; contract: string }>('SELECT id, contract FROM loans WHERE id = ANY($1::uuid[])', [[...new Set(rows.map((r) => r.loan_id).filter(Boolean))]])).map((l) => [l.id, l.contract]));
  return rows.map((m) => svc.json(m, clients.get(m.client_id) as any, m.loan_id ? loans.get(m.loan_id) : null));
}

/**
 * Mensajería (§11.3, pantalla 9): «Por enviar hoy» del modo asistido, programados, bloqueados con la regla aplicada e
 * historial con estados de entrega. El Cobrador solo ve los mensajes de sus clientes (RLS).
 */
@Controller('messages')
export class MessagesController {
  constructor(
    private readonly db: DbService,
    private readonly svc: MessagingService,
    private readonly access: AccessService,
    private readonly tenants: TenantCache,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Requires('messages.view')
  @Op('listMessages')
  list(@Auth() a: AuthContext, @Query() q: { status?: string; clientId?: string; channel?: string; event?: string; cursor?: string; limit?: number }) {
    const limit = Math.min(200, Math.max(1, Number(q.limit ?? 50)));
    return this.db.tx(ctxOf(a), async (tx) => {
      const where: string[] = [];
      const params: unknown[] = [];
      const p = (v: unknown) => {
        params.push(v);
        return `$${params.length}`;
      };
      const statuses = (q.status ?? '').split(',').map((s) => s.trim()).filter((s) => STATUSES.includes(s));
      if (statuses.length) where.push(`m.status = ANY(${p(statuses)}::message_status[])`);
      if (q.clientId) where.push(`m.client_id = ${p(q.clientId)}::uuid`);
      if (q.channel === 'whatsapp' || q.channel === 'email') where.push(`m.channel = ${p(q.channel)}::channel`);
      if (isEvent(q.event)) where.push(`m.event = ${p(q.event)}::message_event`);
      // «Por enviar» y «Programados» van por hora de envío; el resto, del más reciente al más antiguo.
      const ascending = statuses.length > 0 && statuses.every((s) => s === 'ready' || s === 'scheduled');
      const sortExpr = ascending ? 'coalesce(m.scheduled_at, m.created_at)' : 'm.created_at';
      if (q.cursor) {
        try {
          const [at, id] = JSON.parse(Buffer.from(q.cursor, 'base64url').toString()) as [string, string];
          where.push(`(${sortExpr}, m.id) ${ascending ? '>' : '<'} (${p(at)}::timestamptz, ${p(id)}::uuid)`);
        } catch {
          throw new Problem(422, 'VALIDATION_FAILED', {}, [{ field: 'cursor', message: 'format' }]);
        }
      }
      const rows = await tx.many<MessageRow>(
        `SELECT m.*, ${sortExpr} AS sort_at FROM messages m ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY ${sortExpr} ${ascending ? 'ASC' : 'DESC'}, m.id ${ascending ? 'ASC' : 'DESC'} LIMIT ${limit + 1}`,
        params,
      );
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: await withClients(tx, this.svc, page),
        nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify([new Date(last.sort_at).toISOString(), last.id])).toString('base64url') : null,
      };
    });
  }

  @Get('summary')
  @Requires('messages.view')
  @Op('messagesSummary')
  summary(@Auth() a: AuthContext) {
    return this.db.tx(ctxOf(a), async (tx) => {
      const r = (await tx.one<Record<string, string>>(
        `SELECT count(*) FILTER (WHERE status = 'ready') AS ready,
                count(*) FILTER (WHERE status = 'scheduled') AS scheduled,
                count(*) FILTER (WHERE status = 'blocked' AND requested_at > $1::timestamptz - interval '7 days') AS blocked,
                count(*) FILTER (WHERE status = 'failed' AND coalesce(failed_at, requested_at) > $1::timestamptz - interval '7 days') AS failed,
                count(*) FILTER (WHERE status IN ('sent', 'delivered', 'read') AND sent_at > $1::timestamptz - interval '24 hours') AS sent_today
           FROM messages`,
        [this.clock.now()],
      ))!;
      return { ready: Number(r.ready), scheduled: Number(r.scheduled), blocked: Number(r.blocked), failed: Number(r.failed), sentToday: Number(r.sent_today) };
    });
  }

  /** Mensaje manual desde una plantilla o con texto propio: pasa por el validador y por las reglas de contacto. */
  @Post()
  @Requires('messages.send')
  @Op('composeMessage')
  async compose(@Auth() a: AuthContext, @Body() b: { loanId: string; event: MessageEvent; channel: Channel; body?: string }) {
    if (!isEvent(b.event)) throw new Problem(422, 'VALIDATION_FAILED', {}, [{ field: 'event', message: 'enum' }]);
    if (b.body !== undefined && b.body !== null) {
      const issues = validateTemplate(b.body);
      if (issues.length) throw new Problem(422, 'TEMPLATE_BLOCKED', {}, issues.map((i) => ({ field: 'body', message: i.code })), { issues });
    }
    const out = await this.db.tx(ctxOf(a), async (tx) => {
      const loan = await tx.one<{ id: string; client_id: string }>('SELECT id, client_id FROM loans WHERE id = $1', [b.loanId]);
      if (!loan) return this.access.deny(tx, a, 'loan', b.loanId);
      const rows = await this.svc.enqueueTx(tx, a.tenantId, {
        event: b.event, loanId: loan.id, channels: [b.channel], dedupeKey: `manual:${crypto.randomUUID()}`, body: b.body ?? null, createdBy: a.userId,
      });
      await this.audit.log(tx, 'message.composed', 'client', loan.client_id, { after: { event: b.event, channel: b.channel, status: rows[0]?.status } });
      return { rows, items: await withClients(tx, this.svc, rows) };
    });
    this.svc.published(a.tenantId, out.rows);
    return out.items[0];
  }

  private async load(tx: Tx, id: string): Promise<MessageRow> {
    const m = await tx.one<MessageRow>('SELECT * FROM messages WHERE id = $1 FOR UPDATE', [id]);
    if (!m) throw Problem.notFound();
    return m;
  }

  private async one(a: AuthContext, id: string) {
    return this.db.tx(ctxOf(a), async (tx) => (await withClients(tx, this.svc, [await this.load(tx, id)]))[0]);
  }

  /**
   * Modo asistido: el usuario toca «Enviar» y la app abre WhatsApp o el correo con el texto listo. Antes se vuelven a
   * aplicar las reglas: fuera de franja o con el cupo del día usado, no se envía (§11.4). Un programado se envía ya.
   */
  @Post(':id/send')
  @Requires('messages.send')
  @Op('sendMessage')
  @HttpCode(200)
  async send(@Auth() a: AuthContext, @Param('id') id: string) {
    const tenant = await this.tenants.get(a.tenantId);
    const r = await this.db.tx(ctxOf(a), async (tx) => {
      const m = await this.load(tx, id);
      if (m.status === 'scheduled') {
        await tx.exec('UPDATE messages SET scheduled_at = $2, locked_until = NULL WHERE id = $1', [id, this.clock.now()]);
        return { deliver: true };
      }
      if (m.status !== 'ready') throw new Problem(409, 'MESSAGE_NOT_PENDING');
      const client = (await tx.one<Record<string, any>>('SELECT * FROM clients WHERE id = $1', [m.client_id]))!;
      const tz = (client.timezone as string | null) ?? tenant.timezone;
      const { rules } = await this.svc.rulesFor(tx, tenant);
      const consent = await tx.one('SELECT 1 FROM consents WHERE client_id = $1 AND channel = $2 AND revoked_at IS NULL', [m.client_id, m.channel]);
      if (!consent) throw new Problem(409, 'CONTACT_BLOCKED', { rule: 'OPTED_OUT' });
      const hist = await tx.many<{ at: Date; channel: Channel }>(
        `SELECT coalesce(sent_at, scheduled_at) AS at, channel FROM messages WHERE client_id = $1 AND kind = 'collection' AND id <> $2
            AND status IN ('sent', 'delivered', 'read') AND sent_at > $3::timestamptz - interval '21 days'`,
        [m.client_id, id, this.clock.now()],
      );
      const d = evaluateContact({ kind: m.kind, channel: m.channel, requestedAt: toLocalDateTime(this.clock.now(), tz) },
        hist.map((h) => ({ at: toLocalDateTime(new Date(h.at), tz), kind: 'collection' as const, channel: h.channel })), rules, {
          transactionalImmediate: !!tenant.settings.transactionalImmediate,
          debtorAuthorizedWindows: (client.authorized_windows as ContactWindow[] | null) ?? undefined,
        });
      if (d.decision === 'block') throw new Problem(409, 'CONTACT_BLOCKED', { rule: d.reasons.at(-1)?.code ?? '' }, [], { decision: d });
      if (d.decision === 'reschedule') {
        throw new Problem(409, 'CONTACT_OUT_OF_WINDOW', { at: d.at!.replace('T', ' ') }, [], { decision: { ...d, localAt: d.at, at: fromLocalDateTime(d.at!, tz).toISOString(), timeZone: tz } });
      }
      const row = (await tx.one<MessageRow>("UPDATE messages SET status = 'sent', sent_at = $3, sent_by = $2, via = 'assisted' WHERE id = $1 RETURNING *", [id, a.userId, this.clock.now()]))!;
      await this.audit.log(tx, 'message.sent_assisted', 'client', m.client_id, { after: { messageId: id, channel: m.channel, event: m.event } });
      return { row };
    });
    if ('deliver' in r) await this.svc.deliver(id, a.tenantId);
    else this.svc.published(a.tenantId, [r.row!]);
    const out = await this.one(a, id);
    // Los enlaces listos se devuelven también después de marcarlo enviado: la app abre WhatsApp con ellos.
    return r.row ? { ...out, assisted: this.svc.json({ ...r.row, status: 'ready' }).assisted } : out;
  }

  @Post(':id/cancel')
  @Requires('messages.send')
  @Op('cancelMessage')
  @HttpCode(200)
  async cancel(@Auth() a: AuthContext, @Param('id') id: string) {
    const row = await this.db.tx(ctxOf(a), async (tx) => {
      const m = await this.load(tx, id);
      if (!['scheduled', 'ready'].includes(m.status)) throw new Problem(409, 'MESSAGE_NOT_PENDING');
      const r = (await tx.one<MessageRow>("UPDATE messages SET status = 'cancelled', locked_until = NULL WHERE id = $1 RETURNING *", [id]))!;
      await this.audit.log(tx, 'message.cancelled', 'client', m.client_id, { after: { messageId: id } });
      return r;
    });
    this.svc.published(a.tenantId, [row]);
    return this.one(a, id);
  }

  /** Reintentar un fallido o un bloqueado: vuelve a pasar por todas las validaciones y reglas en el despacho. */
  @Post(':id/retry')
  @Requires('messages.send')
  @Op('retryMessage')
  @HttpCode(200)
  async retry(@Auth() a: AuthContext, @Param('id') id: string) {
    const row = await this.db.tx(ctxOf(a), async (tx) => {
      const m = await this.load(tx, id);
      if (!['failed', 'blocked'].includes(m.status)) throw new Problem(409, 'MESSAGE_NOT_RETRYABLE');
      const r = (await tx.one<MessageRow>("UPDATE messages SET status = 'scheduled', scheduled_at = $2, attempts = 0, error = NULL, failed_at = NULL, locked_until = NULL WHERE id = $1 RETURNING *", [id, this.clock.now()]))!;
      await this.audit.log(tx, 'message.retried', 'client', m.client_id, { after: { messageId: id } });
      return r;
    });
    await this.svc.deliver(row.id, a.tenantId);
    return this.one(a, id);
  }
}

/** Plantillas por evento e idioma con vista previa en vivo y validador (§11.3, pantalla 9). */
@Controller('message-templates')
export class TemplatesController {
  constructor(private readonly db: DbService, private readonly svc: MessagingService, private readonly tenants: TenantCache, private readonly audit: AuditService, @Inject(CONFIG) private readonly config: AppConfig) {}

  private json(event: MessageEvent, lang: Lang, r: Record<string, any> | null) {
    const body = (r?.active ? r.body : null) ?? DEFAULT_TEMPLATES[lang][event];
    return {
      event, lang, body, subject: (r?.active ? r.subject : null) ?? EMAIL_SUBJECTS[lang][event], custom: !!r?.active,
      metaTemplateName: r?.meta_template_name ?? null, metaTemplateLang: r?.meta_template_lang ?? null,
      variables: templateVariables(body), updatedAt: r ? new Date(r.updated_at).toISOString() : null,
    };
  }

  @Get()
  @Requires('messages.view')
  @Op('listTemplates')
  async list(@Auth() a: AuthContext) {
    const tenant = await this.tenants.get(a.tenantId);
    return this.db.tx(ctxOf(a), async (tx) => {
      const rows = await tx.many<Record<string, any>>('SELECT * FROM message_templates');
      const find = (e: string, l: string) => rows.find((r) => r.event === e && r.lang === l) ?? null;
      return {
        templates: MESSAGE_EVENTS.flatMap((e) => LANGS.map((l) => this.json(e, l, find(e, l)))),
        events: MESSAGE_EVENTS.filter((e) => e !== 'manual').map((e) => ({ event: e, kind: e === 'reminder' || e === 'overdue' ? 'collection' : 'transactional', ...this.svc.eventConfig(tenant, e) })),
      };
    });
  }

  @Put(':event/:lang')
  @Requires('compliance.manage')
  @Op('saveTemplate')
  async save(@Auth() a: AuthContext, @Param('event') event: string, @Param('lang') lang: string, @Body() b: { body: string; subject?: string; active?: boolean; metaTemplateName?: string | null; metaTemplateLang?: string | null }) {
    if (!isEvent(event) || !isLang(lang)) throw Problem.notFound();
    const active = b.active !== false;
    if (active) {
      const issues = [...validateTemplate(b.body), ...(b.subject ? validateTemplate(b.subject) : [])];
      if (issues.length) throw new Problem(422, 'TEMPLATE_BLOCKED', {}, issues.map((i) => ({ field: 'body', message: i.code })), { issues });
    }
    const metaName = b.metaTemplateName?.trim() || null;
    if (metaName && !/^[a-z0-9_]{1,512}$/.test(metaName)) throw new Problem(422, 'VALIDATION_FAILED', {}, [{ field: 'metaTemplateName', message: 'format' }]);
    return this.db.tx(ctxOf(a), async (tx) => {
      const before = await tx.one<Record<string, any>>('SELECT * FROM message_templates WHERE event = $1 AND lang = $2', [event, lang]);
      const r = await tx.one<Record<string, any>>(
        `INSERT INTO message_templates (tenant_id, event, lang, body, subject, meta_template_name, meta_template_lang, active, updated_by, updated_at)
         VALUES (current_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, now())
         ON CONFLICT (tenant_id, event, lang) DO UPDATE SET body = EXCLUDED.body, subject = EXCLUDED.subject, meta_template_name = EXCLUDED.meta_template_name,
                meta_template_lang = EXCLUDED.meta_template_lang, active = EXCLUDED.active, updated_by = EXCLUDED.updated_by, updated_at = now()
         RETURNING *`,
        [event, lang, active ? b.body : (before?.body ?? DEFAULT_TEMPLATES[lang][event]), b.subject?.trim() || null, metaName, b.metaTemplateLang?.trim() || null, active, a.userId],
      );
      await this.audit.log(tx, 'template.saved', 'company', a.tenantId, { before: before ? { body: before.body, active: before.active } : undefined, after: { event, lang, body: b.body, active } });
      return this.json(event, lang, r);
    });
  }

  /** Vista previa en vivo con los datos de un préstamo real (§11.3), sin registrar nada. */
  @Post('preview')
  @Requires('messages.view')
  @Op('previewTemplate')
  @HttpCode(200)
  async preview(@Auth() a: AuthContext, @Body() b: { event: MessageEvent; lang?: Lang; loanId?: string; body?: string; subject?: string }) {
    if (!isEvent(b.event)) throw new Problem(422, 'VALIDATION_FAILED', {}, [{ field: 'event', message: 'enum' }]);
    const tenant = await this.tenants.get(a.tenantId);
    return this.db.tx(ctxOf(a), async (tx) => {
      let lang: Lang = isLang(b.lang) ? b.lang : tenant.lang;
      let values: TemplateValues;
      if (b.loanId) {
        const loan = await tx.one<{ id: string; client_id: string }>('SELECT id, client_id FROM loans WHERE id = $1', [b.loanId]);
        if (!loan) throw Problem.notFound();
        const client = (await tx.one<Record<string, any>>('SELECT * FROM clients WHERE id = $1', [loan.client_id]))!;
        if (!isLang(b.lang)) lang = client.lang;
        // La vista previa no crea enlaces ni registra nada: el enlace real se genera al enviar.
        values = await this.svc.values(tx, tenant, { loanId: loan.id, client, lang, event: b.event, messageId: crypto.randomUUID(), uploadUrl: `${this.config.portalUrlBase}…` });
      } else {
        values = {
          nombre: 'María José', apellidos: 'Pérez Gómez', contrato: 'CT-000123', valor_cuota: '$ 60.000', fecha_vencimiento: '13/10/2026', cuota_numero: '4',
          cuotas_restantes: '16', saldo: '$ 960.000', valor_pagado: '$ 60.000', enlace_carga: `${this.config.portalUrlBase}…`, enlace_recibo: `${this.config.publicApiUrl}/v1/files/…`,
          empresa: tenant.name, telefono_empresa: tenant.phone ?? tenant.email ?? '',
        };
      }
      const tpl = await this.svc.template(tx, b.event, lang);
      const source = b.body ?? tpl.body;
      const subject = b.subject ?? tpl.subject;
      const body = renderTemplate(source, values);
      return { lang, body, subject: renderTemplate(subject, values), length: body.length, variables: templateVariables(source), issues: [...validateTemplate(source), ...validateTemplate(subject)] };
    });
  }
}

const WINDOW_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const validWindows = (w: unknown): w is ContactWindow[] =>
  Array.isArray(w) && w.length > 0 && w.length <= 21 && w.every((x) => x && Number.isInteger(x.day) && x.day >= 1 && x.day <= 7 && WINDOW_RE.test(x.start) && WINDOW_RE.test(x.end) && x.start < x.end);

/** Motor de reglas de contacto por empresa (§11.4): preset, revisión legal, transaccionales inmediatos y simulación. */
@Controller('compliance')
export class ContactRulesController {
  constructor(private readonly db: DbService, private readonly svc: MessagingService, private readonly tenants: TenantCache, private readonly audit: AuditService, private readonly clock: Clock, private readonly access: AccessService) {}

  private async view(tx: Tx, tenantId: string) {
    const tenant = await this.tenants.get(tenantId);
    const { rules, preset, reviewedAt } = await this.svc.rulesFor(tx, tenant);
    return {
      preset: preset ?? rules.id,
      effective: rules,
      counselReviewedAt: reviewedAt,
      presets: Object.values(CONTACT_PRESETS).map((p) => ({ id: p.id, country: p.country, legalReference: p.legalReference, requiresCounselReview: !!p.requiresCounselReview })),
      transactionalImmediate: !!tenant.settings.transactionalImmediate,
      reminderTime: tenant.settings.reminderTime ?? '08:00',
      dailyReminders: !!tenant.settings.dailyReminders,
    };
  }

  @Get('contact-rules')
  @Requires('compliance.view')
  @Op('getContactRules')
  get(@Auth() a: AuthContext) {
    return this.db.tx(ctxOf(a), (tx) => this.view(tx, a.tenantId));
  }

  @Put('contact-rules')
  @Requires('compliance.manage')
  @Op('saveContactRules')
  async save(@Auth() a: AuthContext, @Body() b: { preset?: string; counselReviewed?: boolean; transactionalImmediate?: boolean; reminderTime?: string; dailyReminders?: boolean }) {
    if (b.preset && !CONTACT_PRESETS[b.preset]) throw new Problem(422, 'VALIDATION_FAILED', {}, [{ field: 'preset', message: 'enum' }]);
    if (b.reminderTime !== undefined && !WINDOW_RE.test(b.reminderTime)) throw new Problem(422, 'VALIDATION_FAILED', {}, [{ field: 'reminderTime', message: 'format' }]);
    // La revisión legal de un preset la declara el propietario (§11.4).
    if (b.counselReviewed && a.role !== 'owner') throw new Problem(403, 'OWNER_REQUIRED');
    await this.db.tx(ctxOf(a), async (tx) => {
      const current = await tx.one<Record<string, any>>('SELECT * FROM contact_rule_sets WHERE active FOR UPDATE');
      const preset = b.preset ?? current?.preset ?? null;
      if (preset) {
        const reviewed = b.counselReviewed === undefined ? (current?.preset === preset ? current?.reviewed_by_counsel_at : null) : b.counselReviewed ? this.clock.now() : null;
        if (current) {
          await tx.exec('UPDATE contact_rule_sets SET preset = $2, config = $3, reviewed_by_counsel_at = $4, reviewed_by = $5, updated_at = now() WHERE id = $1',
            [current.id, preset, JSON.stringify(CONTACT_PRESETS[preset]), reviewed ?? null, reviewed ? a.userId : null]);
        } else {
          await tx.exec('INSERT INTO contact_rule_sets (tenant_id, preset, config, active, reviewed_by_counsel_at, reviewed_by) VALUES (current_tenant(), $1, $2, true, $3, $4)',
            [preset, JSON.stringify(CONTACT_PRESETS[preset]), reviewed ?? null, reviewed ? a.userId : null]);
        }
      }
      const patch: Record<string, unknown> = {};
      if (b.transactionalImmediate !== undefined) patch.transactionalImmediate = !!b.transactionalImmediate;
      if (b.reminderTime !== undefined) patch.reminderTime = b.reminderTime;
      if (b.dailyReminders !== undefined) patch.dailyReminders = !!b.dailyReminders;
      if (Object.keys(patch).length) await tx.exec('UPDATE tenants SET settings = settings || $1::jsonb, version = version + 1 WHERE id = current_tenant()', [JSON.stringify(patch)]);
      await this.audit.log(tx, 'contact_rules.updated', 'company', a.tenantId, { before: current ? { preset: current.preset, reviewed: !!current.reviewed_by_counsel_at } : undefined, after: b });
    });
    this.tenants.invalidate(a.tenantId);
    return this.db.tx(ctxOf(a), (tx) => this.view(tx, a.tenantId));
  }

  /** Simula la decisión del motor para un deudor, en su hora local (§11.4). */
  @Post('contact-evaluation')
  @Requires('compliance.view')
  @Op('evaluateContact')
  @HttpCode(200)
  async evaluate(@Auth() a: AuthContext, @Body() b: { clientId: string; kind: 'collection' | 'transactional'; channel: Channel; requestedAt: string }) {
    const tenant = await this.tenants.get(a.tenantId);
    return this.db.tx(ctxOf(a), async (tx) => {
      const client = await tx.one<Record<string, any>>('SELECT * FROM clients WHERE id = $1', [b.clientId]);
      if (!client) return this.access.deny(tx, a, 'client', b.clientId);
      const tz = (client.timezone as string | null) ?? tenant.timezone;
      const { rules } = await this.svc.rulesFor(tx, tenant);
      const when = new Date(b.requestedAt);
      if (Number.isNaN(when.getTime())) throw new Problem(422, 'VALIDATION_FAILED', {}, [{ field: 'requestedAt', message: 'format' }]);
      const hist = await tx.many<{ at: Date; channel: Channel }>(
        `SELECT coalesce(sent_at, scheduled_at) AS at, channel FROM messages WHERE client_id = $1 AND kind = 'collection'
            AND status IN ('scheduled', 'ready', 'sent', 'delivered', 'read') AND coalesce(sent_at, scheduled_at) > $2::timestamptz - interval '21 days'`,
        [client.id, when],
      );
      const d = evaluateContact({ kind: b.kind, channel: b.channel, requestedAt: toLocalDateTime(when, tz) },
        hist.map((h) => ({ at: toLocalDateTime(new Date(h.at), tz), kind: 'collection' as const, channel: h.channel })), rules, {
          transactionalImmediate: !!tenant.settings.transactionalImmediate,
          debtorAuthorizedWindows: (client.authorized_windows as ContactWindow[] | null) ?? undefined,
        });
      return { ...d, localAt: d.at ?? null, at: d.at ? fromLocalDateTime(d.at, tz).toISOString() : undefined, timeZone: tz };
    });
  }
}

/**
 * Excepción horaria autorizada por el deudor (§11.4): solo con evidencia escrita, un documento del cliente distinto del
 * contrato y posterior a él. Habilita esas franjas solo para ese deudor.
 */
@Controller('clients')
export class ContactExceptionController {
  constructor(private readonly db: DbService, private readonly access: AccessService, private readonly audit: AuditService, private readonly clock: Clock) {}

  @Put(':id/contact-exception')
  @Requires('compliance.manage')
  @Op('setContactException')
  async set(@Auth() a: AuthContext, @Param('id') id: string, @Body() b: { windows: ContactWindow[]; documentId: string }) {
    if (!validWindows(b.windows)) throw new Problem(422, 'VALIDATION_FAILED', {}, [{ field: 'windows', message: 'format' }]);
    return this.db.tx(ctxOf(a), async (tx) => {
      const c = await tx.one<Record<string, any>>('SELECT * FROM clients WHERE id = $1 FOR UPDATE', [id]);
      if (!c) return this.access.deny(tx, a, 'client', id);
      const firstLoan = await tx.one<{ at: Date | null }>('SELECT min(created_at) AS at FROM loans WHERE client_id = $1', [id]);
      const doc = await tx.one<{ created_at: Date; kind: string }>('SELECT created_at, kind FROM documents WHERE id = $1 AND client_id = $2', [b.documentId, id]);
      if (!doc || !['other', 'receipt_in'].includes(doc.kind) || (firstLoan?.at && new Date(doc.created_at) <= new Date(firstLoan.at))) {
        throw new Problem(422, 'CONTACT_EXCEPTION_EVIDENCE', {}, [{ field: 'documentId', message: 'other' }]);
      }
      await tx.exec('UPDATE clients SET authorized_windows = $2, authorized_windows_document_id = $3, authorized_windows_at = now(), version = version + 1 WHERE id = $1', [id, JSON.stringify(b.windows), b.documentId]);
      await this.audit.log(tx, 'contact_exception.set', 'client', id, { before: { windows: c.authorized_windows }, after: { windows: b.windows, documentId: b.documentId } });
      return { windows: b.windows, documentId: b.documentId, grantedAt: this.clock.now().toISOString() };
    });
  }

  @Delete(':id/contact-exception')
  @Requires('compliance.manage')
  @Op('removeContactException')
  @HttpCode(204)
  async remove(@Auth() a: AuthContext, @Param('id') id: string): Promise<void> {
    await this.db.tx(ctxOf(a), async (tx) => {
      const c = await tx.one<Record<string, any>>('SELECT authorized_windows FROM clients WHERE id = $1', [id]);
      if (!c) return this.access.deny(tx, a, 'client', id);
      await tx.exec('UPDATE clients SET authorized_windows = NULL, authorized_windows_document_id = NULL, authorized_windows_at = NULL, version = version + 1 WHERE id = $1', [id]);
      await this.audit.log(tx, 'contact_exception.removed', 'client', id, { before: { windows: c.authorized_windows } });
    });
  }
}

/** Remitente de correo de la empresa con su dominio y el asistente de SPF, DKIM y DMARC (§11.2). */
@Controller('company/email-sender')
export class EmailSenderController {
  constructor(private readonly db: DbService, private readonly audit: AuditService, private readonly dns: DnsResolver, private readonly email: EmailProvider, @Inject(CONFIG) private readonly config: AppConfig) {}

  private json(r: Record<string, any> | null, check?: Awaited<ReturnType<typeof checkDomain>>) {
    const domain = r ? String(r.from_email).split('@')[1] ?? null : null;
    return {
      configured: !!r, provider: this.email.name, defaultFrom: this.config.email.from,
      fromEmail: r?.from_email ?? null, fromName: r?.from_name ?? null, domain, dkimSelector: r?.dkim_selector ?? null,
      spf: !!r?.spf_ok, dkim: !!r?.dkim_ok, dmarc: !!r?.dmarc_ok, verifiedAt: r?.verified_at ? new Date(r.verified_at).toISOString() : null,
      checkedAt: r?.checked_at ? new Date(r.checked_at).toISOString() : null, records: check?.records ?? [],
    };
  }

  @Get()
  @Requires('company.view')
  @Op('getEmailSender')
  get(@Auth() a: AuthContext) {
    return this.db.tx(ctxOf(a), async (tx) => this.json(await tx.one('SELECT * FROM email_senders WHERE tenant_id = current_tenant()')));
  }

  @Put()
  @Requires('company.edit')
  @Op('saveEmailSender')
  save(@Auth() a: AuthContext, @Body() b: { fromEmail: string; fromName?: string; dkimSelector?: string }) {
    const email = b.fromEmail.trim().toLowerCase();
    if (!/^[^@\s]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) throw new Problem(422, 'VALIDATION_FAILED', {}, [{ field: 'fromEmail', message: 'format' }]);
    const selector = b.dkimSelector?.trim() || null;
    if (selector && !/^[A-Za-z0-9._-]{1,63}$/.test(selector)) throw new Problem(422, 'VALIDATION_FAILED', {}, [{ field: 'dkimSelector', message: 'format' }]);
    return this.db.tx(ctxOf(a), async (tx) => {
      // Cambiar el remitente exige verificar otra vez el dominio.
      const r = await tx.one<Record<string, any>>(
        `INSERT INTO email_senders (tenant_id, from_email, from_name, dkim_selector, updated_by) VALUES (current_tenant(), $1, $2, $3, $4)
         ON CONFLICT (tenant_id) DO UPDATE SET from_email = EXCLUDED.from_email, from_name = EXCLUDED.from_name, dkim_selector = EXCLUDED.dkim_selector,
                spf_ok = false, dkim_ok = false, dmarc_ok = false, verified_at = NULL, checked_at = NULL, updated_at = now(), updated_by = EXCLUDED.updated_by RETURNING *`,
        [email, b.fromName?.trim() || null, selector, a.userId],
      );
      await this.audit.log(tx, 'email_sender.saved', 'company', a.tenantId, { after: { fromEmail: email, dkimSelector: selector } });
      return this.json(r);
    });
  }

  @Post('verify')
  @Requires('company.edit')
  @Op('verifyEmailSender')
  @HttpCode(200)
  async verify(@Auth() a: AuthContext) {
    const current = await this.db.tx(ctxOf(a), (tx) => tx.one<Record<string, any>>('SELECT * FROM email_senders WHERE tenant_id = current_tenant()'));
    if (!current) throw Problem.notFound();
    const check = await checkDomain(this.dns, String(current.from_email).split('@')[1]!, current.dkim_selector, this.config.email.spfInclude);
    const ok = check.spf && check.dkim && check.dmarc;
    return this.db.tx(ctxOf(a), async (tx) => {
      const r = await tx.one<Record<string, any>>(
        'UPDATE email_senders SET spf_ok = $1, dkim_ok = $2, dmarc_ok = $3, checked_at = now(), verified_at = CASE WHEN $4 THEN coalesce(verified_at, now()) ELSE NULL END WHERE tenant_id = current_tenant() RETURNING *',
        [check.spf, check.dkim, check.dmarc, ok],
      );
      await this.audit.log(tx, 'email_sender.verified', 'company', a.tenantId, { after: { spf: check.spf, dkim: check.dkim, dmarc: check.dmarc } });
      return this.json(r, check);
    });
  }

  @Delete()
  @Requires('company.edit')
  @Op('deleteEmailSender')
  @HttpCode(204)
  async remove(@Auth() a: AuthContext): Promise<void> {
    await this.db.tx(ctxOf(a), async (tx) => {
      if (await tx.exec('DELETE FROM email_senders WHERE tenant_id = current_tenant()')) await this.audit.log(tx, 'email_sender.removed', 'company', a.tenantId);
    });
  }
}
