import crypto from 'node:crypto';
import { Body, Controller, Delete, Get, HttpCode, Inject, Logger, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import { normalizePhone } from '@coroc/core';
import busboy from 'busboy';
import type { Request, Response } from 'express';
import { AuditService } from '../audit/audit.service.js';
import { SecretBox } from '../auth/crypto.js';
import { Clock } from '../common/clock.js';
import type { AuthContext } from '../common/context.js';
import { Auth, Idempotent, Op, Public, Requires } from '../common/decorators.js';
import { pickLang, t, type Lang } from '../common/i18n.js';
import { Problem } from '../common/problem.js';
import { RateLimiter } from '../common/rate-limit.js';
import { TenantCache } from '../company/tenant-cache.js';
import { CONFIG, type AppConfig } from '../config.js';
import { DbService } from '../db/db.service.js';
import { readBody } from '../documents/documents.controller.js';
import { MAX_UPLOAD_BYTES } from '../documents/documents.service.js';
import { MessagingService } from '../messaging/messaging.service.js';
import { IntakeService, type IntakeChannel } from './intake.service.js';
import { PORTAL_CSP, portalErrorHtml, portalHtml } from './portal.js';
import { UploadLinksService } from './upload-links.service.js';

const APP_CHANNELS: IntakeChannel[] = ['share', 'folder', 'upload'];
const langOf = (q: unknown): Lang | null => (q === 'es' ? 'es' : q === 'pt-BR' || q === 'pt' ? 'pt-BR' : q === 'en' ? 'en' : null);

/** Bandeja de validación (§13.6) y carga de comprobantes desde la app: compartir, carpeta vigilada o subida manual (§12.4–§12.6). */
@Controller('intake')
export class IntakeController {
  constructor(private readonly intake: IntakeService) {}

  @Post()
  @Requires('documents.upload')
  @Op('uploadIntake')
  @HttpCode(202)
  async upload(@Auth() a: AuthContext, @Req() req: Request, @Query() q: { channel?: string; clientId?: string; loanId?: string; fileName?: string; note?: string }) {
    const channel = (APP_CHANNELS as string[]).includes(q.channel ?? '') ? (q.channel as IntakeChannel) : 'upload';
    const body = await readBody(req, MAX_UPLOAD_BYTES);
    const r = await this.intake.ingest(a, {
      channel, body, fileName: q.fileName ?? null, hintClientId: q.clientId || null, hintLoanId: q.loanId || null, messageText: q.note ?? null, createdBy: a.userId,
    });
    return this.intake.get(a, r.id);
  }

  @Get()
  @Requires('intake.view')
  @Op('listIntake')
  list(@Auth() a: AuthContext, @Query() q: { status?: string; channel?: string; clientId?: string; cursor?: string; limit?: number }) {
    return this.intake.list(a, q);
  }

  @Get('summary')
  @Requires('intake.view')
  @Op('intakeSummary')
  summary(@Auth() a: AuthContext) {
    return this.intake.summary(a);
  }

  @Post('approve-batch')
  @Requires('payments.register')
  @Op('approveIntakeBatch')
  @HttpCode(200)
  batch(@Auth() a: AuthContext, @Body() b: { ids: string[] }) {
    return this.intake.approveBatch(a, b.ids);
  }

  @Get(':id')
  @Requires('intake.view')
  @Op('getIntake')
  get(@Auth() a: AuthContext, @Param('id') id: string) {
    return this.intake.get(a, id);
  }

  @Post(':id/approve')
  @Requires('payments.register')
  @Idempotent()
  @Op('approveIntake')
  approve(@Auth() a: AuthContext, @Param('id') id: string, @Body() b: Parameters<IntakeService['approve']>[2]) {
    return this.intake.approve(a, id, b);
  }

  @Post(':id/reject')
  @Requires('payments.register')
  @Op('rejectIntake')
  @HttpCode(200)
  reject(@Auth() a: AuthContext, @Param('id') id: string, @Body() b: { reason: string }) {
    return this.intake.reject(a, id, b.reason);
  }

  @Post(':id/archive')
  @Requires('payments.register')
  @Op('archiveIntake')
  @HttpCode(200)
  archive(@Auth() a: AuthContext, @Param('id') id: string) {
    return this.intake.archive(a, id);
  }

  @Post(':id/revert')
  @Requires('payments.reverse')
  @Op('revertAutoIntake')
  @HttpCode(200)
  revert(@Auth() a: AuthContext, @Param('id') id: string, @Body() b: { reason?: string } = {}) {
    return this.intake.revert(a, id, b?.reason);
  }
}

/** Enlace personal de carga del préstamo (§12.3). */
@Controller('loans')
export class UploadLinksController {
  constructor(private readonly links: UploadLinksService) {}

  @Get(':id/upload-link')
  @Requires('clients.view')
  @Op('getUploadLink')
  get(@Auth() a: AuthContext, @Param('id') id: string) {
    return this.links.get(a, id);
  }

  @Post(':id/upload-link')
  @Requires('payments.register')
  @Op('rotateUploadLink')
  rotate(@Auth() a: AuthContext, @Param('id') id: string) {
    return this.links.rotate(a, id);
  }

  @Delete(':id/upload-link')
  @Requires('payments.register')
  @Op('revokeUploadLink')
  @HttpCode(204)
  async revoke(@Auth() a: AuthContext, @Param('id') id: string): Promise<void> {
    await this.links.revoke(a, id);
  }
}

/** Lee un formulario multipart con un solo archivo, con límite de tamaño. */
function readMultipart(req: Request, max: number): Promise<{ file: Buffer | null; fileName: string | null; truncated: boolean; fields: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    let bb: busboy.Busboy;
    try {
      bb = busboy({ headers: req.headers, limits: { files: 1, fileSize: max, fields: 5, fieldSize: 4000 } });
    } catch {
      resolve({ file: null, fileName: null, truncated: false, fields: {} });
      return;
    }
    const fields: Record<string, string> = {};
    let file: Buffer | null = null;
    let fileName: string | null = null;
    let truncated = false;
    bb.on('file', (_name, stream, info) => {
      const parts: Buffer[] = [];
      fileName = info.filename ?? null;
      stream.on('data', (d: Buffer) => parts.push(d));
      stream.on('limit', () => (truncated = true));
      stream.on('end', () => (file = Buffer.concat(parts)));
    });
    bb.on('field', (name, value) => (fields[name] = value));
    bb.on('close', () => resolve({ file, fileName, truncated, fields }));
    bb.on('error', reject);
    req.pipe(bb);
  });
}

/**
 * Portal del deudor (§12.3): una página sin JavaScript, en el idioma del deudor y con la marca COROC. El enlace
 * identifica al remitente. Responde JSON si se pide (`Accept: application/json`).
 */
@Controller('public/upload')
export class PortalController {
  constructor(
    private readonly links: UploadLinksService,
    private readonly intake: IntakeService,
    private readonly limiter: RateLimiter,
    private readonly clock: Clock,
    private readonly db: DbService,
    private readonly messaging: MessagingService,
  ) {}

  private wantsJson(req: Request) {
    return (req.headers.accept ?? '').includes('application/json') && !(req.headers.accept ?? '').includes('text/html');
  }

  private fail(req: Request, res: Response, e: unknown, lang: Lang): void {
    const p = e instanceof Problem ? e : new Problem(500, 'INTERNAL');
    if (this.wantsJson(req) || p.status >= 500) throw p;
    res.status(p.status).type('html').setHeader('Content-Security-Policy', PORTAL_CSP).setHeader('Cache-Control', 'no-store').send(portalErrorHtml(lang));
  }

  @Public()
  @Get(':token')
  @Op('debtorPortal')
  async view(@Param('token') token: string, @Query() q: { lang?: string; sent?: string; dup?: string; optedOut?: string }, @Req() req: Request, @Res() res: Response): Promise<void> {
    this.limiter.hit(`portal:${req.ip}`, 120, 60_000);
    const fallback = langOf(q.lang) ?? pickLang(null, req.headers['accept-language']);
    try {
      const link = await this.links.resolve(token);
      const d = await this.links.portal(link, (tz) => this.clock.today(tz));
      res.setHeader('Cache-Control', 'no-store');
      if (this.wantsJson(req)) {
        res.json({ ...d, summary: { ...d.summary } });
        return;
      }
      const lang = langOf(q.lang) ?? d.lang;
      const notice = q.sent ? { kind: 'sent' as const } : q.dup ? { kind: 'duplicate' as const } : q.optedOut ? { kind: 'optedOut' as const } : undefined;
      res.type('html').setHeader('Content-Security-Policy', PORTAL_CSP).send(portalHtml(d, lang, `/v1/public/upload/${token}`, notice));
    } catch (e) {
      this.fail(req, res, e, fallback);
    }
  }

  /**
   * Exclusión desde el portal o desde el enlace del correo (§20.1): el deudor deja de recibir mensajes, de inmediato.
   * Acepta el formulario del portal y la baja con un clic de los programas de correo (RFC 8058, `List-Unsubscribe-Post`).
   */
  @Public()
  @Post(':token/opt-out')
  @Op('debtorOptOut')
  async optOut(@Param('token') token: string, @Query() q: { lang?: string; channel?: string }, @Req() req: Request, @Res() res: Response): Promise<void> {
    this.limiter.hit(`portal-out:${req.ip}`, 30, 60_000);
    const fallback = langOf(q.lang) ?? pickLang(null, req.headers['accept-language']);
    let link: Awaited<ReturnType<UploadLinksService['resolve']>>;
    try {
      link = await this.links.resolve(token);
    } catch (e) {
      return this.fail(req, res, e, fallback);
    }
    const form = new URLSearchParams((await readBody(req, 16 * 1024)).toString('utf8'));
    const oneClick = form.get('List-Unsubscribe') === 'One-Click';
    const which = q.channel ?? form.get('channel') ?? 'all';
    const channels: ('whatsapp' | 'email')[] = which === 'email' ? ['email'] : which === 'whatsapp' ? ['whatsapp'] : ['whatsapp', 'email'];
    const blocked: Record<string, any>[] = [];
    await this.db.tx({ tenantId: link.tenantId }, async (tx) => {
      const loan = await tx.one<{ client_id: string }>('SELECT client_id FROM loans WHERE id = $1', [link.loanId]);
      if (loan) await this.messaging.optOutTx(tx, loan.client_id, channels, oneClick || q.channel === 'email' ? 'email_link' : 'portal', blocked);
    });
    this.messaging.published(link.tenantId, blocked);
    if (oneClick || this.wantsJson(req)) {
      res.status(200).json({ optedOut: channels });
      return;
    }
    res.redirect(303, `/v1/public/upload/${token}?lang=${langOf(q.lang) ?? fallback}&optedOut=1`);
  }

  @Public()
  @Post(':token')
  @Op('debtorUpload')
  async upload(@Param('token') token: string, @Query() q: { lang?: string }, @Req() req: Request, @Res() res: Response): Promise<void> {
    const fallback = langOf(q.lang) ?? pickLang(null, req.headers['accept-language']);
    let link: Awaited<ReturnType<UploadLinksService['resolve']>>;
    let d: Awaited<ReturnType<UploadLinksService['portal']>>;
    try {
      link = await this.links.resolve(token);
      d = await this.links.portal(link, (tz) => this.clock.today(tz));
    } catch (e) {
      return this.fail(req, res, e, fallback);
    }
    const lang = langOf(q.lang) ?? d.lang;
    const self = `/v1/public/upload/${token}`;
    const error = (status: number, code: string, message: string) => {
      if (this.wantsJson(req)) throw new Problem(status, code);
      res.status(status).type('html').setHeader('Content-Security-Policy', PORTAL_CSP).send(portalHtml(d, lang, self, { kind: 'error', message }));
    };
    try {
      this.limiter.hit(`portal-up:${token}`, 20, 3_600_000);
      this.limiter.hit(`portal-up-ip:${req.ip}`, 60, 3_600_000);
    } catch {
      return error(429, 'RATE_LIMITED', t(lang, 'portal.errorRate'));
    }
    const mb = MAX_UPLOAD_BYTES / 1024 / 1024;
    const multipart = (req.headers['content-type'] ?? '').startsWith('multipart/form-data');
    const form = multipart ? await readMultipart(req, MAX_UPLOAD_BYTES) : { file: await readBody(req, MAX_UPLOAD_BYTES), fileName: null, truncated: false, fields: {} as Record<string, string> };
    if (form.truncated) return error(413, 'FILE_TOO_LARGE', t(lang, 'portal.errorSize', { mb }));
    if (!form.file?.length) return error(422, 'VALIDATION_FAILED', t(lang, 'portal.errorEmpty'));
    try {
      const r = await this.intake.ingest({ tenantId: link.tenantId, userId: null, role: 'owner' }, {
        channel: 'upload_link', body: form.file, fileName: form.fileName, uploadLinkId: link.linkId, messageText: form.fields.note ?? null,
      });
      await this.links.touch(link);
      if (this.wantsJson(req)) {
        res.status(202).json({ id: r.id, status: r.status, duplicate: r.duplicate });
        return;
      }
      // Post/Redirect/Get: recargar la página no vuelve a enviar el archivo.
      res.redirect(303, `${self}?lang=${lang}&${r.duplicate ? 'dup' : 'sent'}=1`);
    } catch (e) {
      if (e instanceof Problem && e.code === 'FILE_TYPE_NOT_ALLOWED') return error(415, e.code, t(lang, 'portal.errorType'));
      if (e instanceof Problem && e.code === 'FILE_TOO_LARGE') return error(413, e.code, t(lang, 'portal.errorSize', { mb }));
      throw e;
    }
  }
}

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/**
 * Webhooks entrantes: WhatsApp Cloud API (§12.1) y correo (§12.2). Leen el cuerpo crudo: la firma de Meta se calcula
 * sobre los bytes exactos y los correos traen adjuntos de varios megas.
 */
@Controller('webhooks')
export class WebhooksController {
  private readonly log = new Logger('Webhooks');
  private readonly box: SecretBox;

  constructor(
    private readonly db: DbService,
    private readonly intake: IntakeService,
    private readonly tenants: TenantCache,
    private readonly limiter: RateLimiter,
    private readonly messaging: MessagingService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {
    this.box = new SecretBox(config.dataKey);
  }

  @Public()
  @Get('whatsapp')
  @Op('whatsappVerify')
  verify(@Query() q: Record<string, string>, @Res() res: Response): void {
    if (!this.config.whatsapp.verifyToken) throw new Problem(404, 'WEBHOOK_NOT_CONFIGURED');
    if (q['hub.mode'] === 'subscribe' && safeEqual(q['hub.verify_token'] ?? '', this.config.whatsapp.verifyToken)) {
      res.status(200).type('text/plain').send(q['hub.challenge'] ?? '');
      return;
    }
    throw new Problem(403, 'WEBHOOK_SIGNATURE_INVALID');
  }

  @Public()
  @Post('whatsapp')
  @Op('whatsappEvents')
  @HttpCode(200)
  async whatsapp(@Req() req: Request) {
    if (!this.config.whatsapp.appSecret) throw new Problem(404, 'WEBHOOK_NOT_CONFIGURED');
    const raw = await readBody(req, 5 * 1024 * 1024);
    const expected = `sha256=${crypto.createHmac('sha256', this.config.whatsapp.appSecret).update(raw).digest('hex')}`;
    if (!safeEqual(String(req.headers['x-hub-signature-256'] ?? ''), expected)) throw new Problem(401, 'WEBHOOK_SIGNATURE_INVALID');
    const payload = JSON.parse(raw.toString('utf8')) as { entry?: { id?: string; changes?: { field?: string; value?: Record<string, any> }[] }[] };
    let received = 0;
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const v = change.value ?? {};
        // Avisos de la cuenta (suspensión, CA-20) y del estado de las plantillas: llegan con el id de la cuenta de WhatsApp Business.
        if (change.field === 'account_update' || change.field === 'message_template_status_update') {
          await this.messaging.onWhatsAppAccountEvent(String(entry.id ?? ''), change.field, v);
          continue;
        }
        const phoneNumberId = String(v.metadata?.phone_number_id ?? '');
        const messages: Record<string, any>[] = v.messages ?? [];
        const statuses: Record<string, any>[] = v.statuses ?? [];
        if (!phoneNumberId || (!messages.length && !statuses.length)) continue;
        const tenantId = (await this.db.tx(null, (tx) => tx.one<{ t: string | null }>('SELECT whatsapp_tenant($1) AS t', [phoneNumberId])))?.t;
        if (!tenantId) {
          this.log.warn(`Evento para un número de WhatsApp sin empresa (${phoneNumberId})`);
          continue;
        }
        // Estados de entrega de los mensajes enviados por la Cloud API (§11.3).
        if (statuses.length) await this.messaging.onWhatsAppStatuses(tenantId, statuses);
        if (!messages.length) continue;
        const tenant = await this.tenants.get(tenantId);
        let token: string | null = null;
        for (const m of messages) {
          const phone = normalizePhone(`+${String(m.from ?? '').replace(/\D/g, '')}`, tenant.country);
          // Todo mensaje del deudor abre la ventana de 24 horas; «SALIR», «SAIR» o «STOP» lo excluyen de inmediato (§20.1).
          await this.messaging.onWhatsAppInbound(tenantId, phone, m.type === 'text' ? String(m.text?.body ?? '') : null);
          const media = m.type === 'image' ? m.image : m.type === 'document' ? m.document : null;
          if (!media?.id) continue;
          if (!token) {
            const account = await this.db.tx({ tenantId }, (tx) => tx.one<{ token_enc: Buffer }>('SELECT token_enc FROM whatsapp_accounts WHERE tenant_id = current_tenant()'));
            token = this.box.open(account!.token_enc, `whatsapp:${tenantId}`).toString();
          }
          // La URL del medio caduca en minutos: se descarga ya, antes de responder (§12.1).
          const body = await this.media(String(media.id), token);
          await this.intake.ingest({ tenantId, userId: null, role: 'owner' }, {
            channel: 'whatsapp', body, fileName: media.filename ?? null, senderPhone: phone, providerMsgId: String(m.id), messageText: media.caption ?? null,
          }).catch((e) => {
            if (e instanceof Problem && (e.code === 'FILE_TYPE_NOT_ALLOWED' || e.code === 'FILE_TOO_LARGE')) return null;
            throw e;
          });
          received++;
        }
      }
    }
    return { received };
  }

  private async media(mediaId: string, token: string): Promise<Buffer> {
    const base = `${this.config.whatsapp.graphUrl}/${this.config.whatsapp.graphVersion}`;
    const meta = await fetch(`${base}/${encodeURIComponent(mediaId)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!meta.ok) throw new Error(`Graph API ${meta.status} al consultar el medio`);
    const { url } = (await meta.json()) as { url?: string };
    if (!url) throw new Error('Graph API no devolvió la URL del medio');
    const file = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!file.ok) throw new Error(`Graph API ${file.status} al descargar el medio`);
    const len = Number(file.headers.get('content-length') ?? 0);
    if (len > MAX_UPLOAD_BYTES) throw new Problem(413, 'FILE_TOO_LARGE', { mb: MAX_UPLOAD_BYTES / 1024 / 1024 });
    return Buffer.from(await file.arrayBuffer());
  }

  /**
   * Correo entrante del buzón de pagos (§12.2), en el formato JSON de Postmark (también lo emiten SendGrid y SES con
   * un adaptador). La empresa se reconoce por la dirección `pagos-<empresa>@<dominio>`; el remitente, por su correo.
   */
  @Public()
  @Post('email/inbound')
  @Op('emailInbound')
  @HttpCode(200)
  async email(@Req() req: Request, @Query('token') token?: string) {
    const secret = this.config.inboundEmail.secret;
    if (!secret) throw new Problem(404, 'WEBHOOK_NOT_CONFIGURED');
    this.limiter.hit(`email-in:${req.ip}`, 600, 60_000);
    const basic = /^Basic (.+)$/i.exec(String(req.headers.authorization ?? ''))?.[1];
    const given = token ?? (basic ? Buffer.from(basic, 'base64').toString().split(':').slice(1).join(':') : '');
    if (!safeEqual(given, secret)) throw new Problem(401, 'WEBHOOK_SIGNATURE_INVALID');
    const mail = JSON.parse((await readBody(req, 40 * 1024 * 1024)).toString('utf8')) as Record<string, any>;
    const recipients: string[] = [
      ...(mail.ToFull ?? []).map((x: { Email?: string }) => x.Email ?? ''),
      ...(mail.CcFull ?? []).map((x: { Email?: string }) => x.Email ?? ''),
      mail.OriginalRecipient ?? '', ...String(mail.To ?? '').split(','),
    ].map((s) => String(s).replace(/.*</, '').replace(/>.*/, '').trim().toLowerCase()).filter(Boolean);
    const domain = this.config.inboundEmail.domain;
    const slug = recipients
      .map((r) => /^pagos[-+]([a-z0-9][a-z0-9-]{1,40})@(.+)$/.exec(r))
      .find((m) => m && (!domain || m[2] === domain))?.[1];
    if (!slug) return { received: 0, ignored: 'unknown_recipient' };
    const tenant = await this.db.tx(null, (tx) => tx.one<{ id: string }>('SELECT id FROM tenants WHERE slug = $1', [slug]), { lookupSlug: slug });
    if (!tenant) return { received: 0, ignored: 'unknown_recipient' };
    const from = String(mail.FromFull?.Email ?? mail.From ?? '').replace(/.*</, '').replace(/>.*/, '').trim().toLowerCase() || null;
    const messageId = String(mail.MessageID ?? mail.MessageId ?? '') || null;
    let received = 0;
    const attachments: Record<string, any>[] = mail.Attachments ?? [];
    for (const [i, at] of attachments.entries()) {
      if (!at?.Content) continue;
      const body = Buffer.from(String(at.Content), 'base64');
      try {
        await this.intake.ingest({ tenantId: tenant.id, userId: null, role: 'owner' }, {
          channel: 'email', body, fileName: at.Name ?? null, senderEmail: from, providerMsgId: messageId ? `${messageId}#${i}` : null,
          messageText: [mail.Subject, mail.TextBody].filter(Boolean).join('\n').slice(0, 2000) || null,
        });
        received++;
      } catch (e) {
        // Firmas, logos y otros adjuntos que no son comprobantes se ignoran sin fallar el webhook.
        if (e instanceof Problem && (e.code === 'FILE_TYPE_NOT_ALLOWED' || e.code === 'FILE_TOO_LARGE')) continue;
        throw e;
      }
    }
    return { received };
  }
  /**
   * Avisos del proveedor de correo saliente (§11.2): entrega, rebote y queja, en el formato de los webhooks de Postmark.
   * Un rebote duro marca la dirección como inválida en la ficha del cliente; una queja lo excluye del correo.
   */
  @Public()
  @Post('email/events')
  @Op('emailEvents')
  @HttpCode(200)
  async emailEvents(@Req() req: Request, @Query('token') token?: string) {
    const secret = this.config.email.eventsSecret;
    if (!secret) throw new Problem(404, 'WEBHOOK_NOT_CONFIGURED');
    this.limiter.hit(`email-ev:${req.ip}`, 1200, 60_000);
    const basic = /^Basic (.+)$/i.exec(String(req.headers.authorization ?? ''))?.[1];
    const given = token ?? (basic ? Buffer.from(basic, 'base64').toString().split(':').slice(1).join(':') : '');
    if (!safeEqual(given, secret)) throw new Problem(401, 'WEBHOOK_SIGNATURE_INVALID');
    const body = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8')) as Record<string, any> | Record<string, any>[];
    let matched = 0;
    for (const e of Array.isArray(body) ? body : [body]) if (await this.messaging.onEmailEvent(e)) matched++;
    return { matched };
  }
}

/**
 * Número de WhatsApp Business de la empresa (§12.1) y modo de envío (§11.1). El token nunca vuelve a mostrarse. El modo
 * automático (Cloud API) solo se activa con la lista de verificación completa y la aceptación del propietario.
 */
@Controller('company/whatsapp')
export class WhatsAppAccountController {
  private readonly box: SecretBox;

  constructor(private readonly db: DbService, private readonly audit: AuditService, private readonly tenants: TenantCache, private readonly clock: Clock, @Inject(CONFIG) private readonly config: AppConfig) {
    this.box = new SecretBox(config.dataKey);
  }

  private json(r: Record<string, any> | null, mode: string) {
    const c = (r?.checklist ?? {}) as Record<string, any>;
    return {
      configured: !!r,
      phoneNumberId: r?.phone_number_id ?? null,
      displayNumber: r?.display_number ?? null,
      wabaId: r?.waba_id ?? null,
      active: r?.active ?? false,
      status: (r?.status as string | undefined) ?? 'active',
      suspendedAt: r?.suspended_at ? new Date(r.suspended_at).toISOString() : null,
      suspensionReason: r?.suspension_reason ?? null,
      mode: mode === 'cloud_api' ? 'cloud_api' : 'assisted',
      checklist: {
        businessVerified: !!c.businessVerified, dedicatedNumber: !!c.dedicatedNumber, templatesApproved: !!c.templatesApproved,
        legalReview: !!c.legalReview, policyAccepted: !!c.policyAccepted, acceptedAt: c.acceptedAt ?? null,
      },
      updatedAt: r ? new Date(r.updated_at).toISOString() : null,
      webhookUrl: `${this.config.publicApiUrl}/v1/webhooks/whatsapp`,
      serverReady: !!(this.config.whatsapp.appSecret && this.config.whatsapp.verifyToken),
    };
  }

  private async current(a: AuthContext) {
    const tenant = await this.tenants.get(a.tenantId);
    const r = await this.db.tx({ tenantId: a.tenantId, userId: a.userId, role: a.role }, (tx) => tx.one('SELECT * FROM whatsapp_accounts WHERE tenant_id = current_tenant()'));
    return this.json(r, tenant.settings.whatsappMode);
  }

  @Get()
  @Requires('company.view')
  @Op('getWhatsAppAccount')
  get(@Auth() a: AuthContext) {
    return this.current(a);
  }

  @Put()
  @Requires('company.edit')
  @Op('saveWhatsAppAccount')
  async save(@Auth() a: AuthContext, @Body() b: { phoneNumberId: string; accessToken: string; displayNumber?: string; wabaId?: string }) {
    await this.db.tx({ tenantId: a.tenantId, userId: a.userId, role: a.role }, async (tx) => {
      const taken = await tx.one<{ t: string | null }>('SELECT whatsapp_tenant($1) AS t', [b.phoneNumberId.trim()]);
      if (taken?.t && taken.t !== a.tenantId) throw new Problem(409, 'WHATSAPP_ACCOUNT_IN_USE');
      const wabaId = b.wabaId?.trim() || null;
      const wabaOwner = wabaId ? (await tx.one<{ t: string | null }>('SELECT whatsapp_tenant_by_waba($1) AS t', [wabaId]))?.t : null;
      if (wabaOwner && wabaOwner !== a.tenantId) throw new Problem(409, 'WHATSAPP_ACCOUNT_IN_USE');
      await tx.one(
        `INSERT INTO whatsapp_accounts (tenant_id, phone_number_id, display_number, token_enc, waba_id, updated_by) VALUES (current_tenant(), $1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id) DO UPDATE SET phone_number_id = EXCLUDED.phone_number_id, display_number = EXCLUDED.display_number, token_enc = EXCLUDED.token_enc,
                waba_id = coalesce(EXCLUDED.waba_id, whatsapp_accounts.waba_id), active = true, updated_at = now(), updated_by = EXCLUDED.updated_by RETURNING *`,
        [b.phoneNumberId.trim(), b.displayNumber?.trim() || null, this.box.seal(Buffer.from(b.accessToken.trim()), `whatsapp:${a.tenantId}`), wabaId, a.userId],
      );
      await this.audit.log(tx, 'whatsapp.configured', 'company', a.tenantId, { after: { phoneNumberId: b.phoneNumberId.trim(), wabaId } });
    });
    return this.current(a);
  }

  /**
   * Modo de envío de WhatsApp (§11.1). Activar la Cloud API exige la lista de verificación completa y la aceptación
   * explícita del propietario sobre la Política de Mensajería de WhatsApp Business, que prohíbe la cobranza de deudas;
   * la aceptación queda en la bitácora. Si la cuenta estaba suspendida, activarla de nuevo declara que Meta la restableció.
   */
  @Put('mode')
  @Requires('company.edit')
  @Op('setWhatsAppMode')
  async mode(@Auth() a: AuthContext, @Body() b: { mode: 'assisted' | 'cloud_api'; checklist?: Record<string, boolean> }) {
    if (b.mode !== 'assisted' && b.mode !== 'cloud_api') throw new Problem(422, 'VALIDATION_FAILED', {}, [{ field: 'mode', message: 'enum' }]);
    await this.db.tx({ tenantId: a.tenantId, userId: a.userId, role: a.role }, async (tx) => {
      if (b.mode === 'cloud_api') {
        if (a.role !== 'owner') throw new Problem(403, 'OWNER_REQUIRED');
        const acc = await tx.one<Record<string, any>>('SELECT * FROM whatsapp_accounts WHERE tenant_id = current_tenant() FOR UPDATE');
        if (!acc || !acc.waba_id || !this.config.whatsapp.appSecret || !this.config.whatsapp.verifyToken) throw new Problem(409, 'WHATSAPP_NOT_READY');
        const keys = ['businessVerified', 'dedicatedNumber', 'templatesApproved', 'legalReview', 'policyAccepted'];
        const missing = keys.filter((k) => b.checklist?.[k] !== true);
        if (missing.length) throw new Problem(422, 'WHATSAPP_CHECKLIST_INCOMPLETE', {}, missing.map((k) => ({ field: `checklist.${k}`, message: 'required' })));
        const checklist = { ...Object.fromEntries(keys.map((k) => [k, true])), acceptedAt: this.clock.now().toISOString(), acceptedBy: a.userId };
        await tx.exec("UPDATE whatsapp_accounts SET checklist = $1, status = 'active', suspended_at = NULL, suspension_reason = NULL, updated_at = now(), updated_by = $2 WHERE tenant_id = current_tenant()", [JSON.stringify(checklist), a.userId]);
        await this.audit.log(tx, 'whatsapp.cloud_api_enabled', 'company', a.tenantId, { before: { status: acc.status }, after: { checklist } });
      } else {
        await this.audit.log(tx, 'whatsapp.assisted_mode', 'company', a.tenantId, { after: { mode: 'assisted' } });
      }
      await tx.exec(`UPDATE tenants SET settings = jsonb_set(settings, '{whatsappMode}', to_jsonb($1::text)), version = version + 1 WHERE id = current_tenant()`, [b.mode]);
    });
    this.tenants.invalidate(a.tenantId);
    return this.current(a);
  }

  @Delete()
  @Requires('company.edit')
  @Op('deleteWhatsAppAccount')
  @HttpCode(204)
  async remove(@Auth() a: AuthContext): Promise<void> {
    await this.db.tx({ tenantId: a.tenantId, userId: a.userId, role: a.role }, async (tx) => {
      if (await tx.exec('DELETE FROM whatsapp_accounts WHERE tenant_id = current_tenant()')) await this.audit.log(tx, 'whatsapp.removed', 'company', a.tenantId);
    });
  }
}
