import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';
import type { AppConfig } from '../config.js';

export interface OutboundEmail {
  from: string;
  replyTo?: string | null;
  to: string;
  subject: string;
  text: string;
  html: string;
  /** `cid`: imagen incrustada en el HTML (el logo), no un adjunto visible. */
  attachments?: { name: string; content: Buffer; contentType: string; cid?: string }[];
  /** Metadatos que el proveedor devuelve en sus avisos de rebote y entrega (sin datos personales). */
  metadata?: Record<string, string>;
  /** Encabezado List-Unsubscribe (§20.1): exclusión con un clic desde el programa de correo. */
  unsubscribeUrl?: string | null;
}

export type SendResult = { ok: true; providerId: string } | { ok: false; permanent: boolean; error: string };

/**
 * Puerto de correo saliente (§4.5 EmailProvider). Adaptadores: Postmark (API HTTP), SMTP propio (también el de Amazon
 * SES, que expone SMTP) y memoria (desarrollo y pruebas). La elección es del servidor, no de la empresa.
 */
export abstract class EmailProvider {
  abstract readonly name: 'postmark' | 'smtp' | 'memory' | 'none';
  abstract send(m: OutboundEmail): Promise<SendResult>;
}

/**
 * Postmark · API de envío `POST /email` (https://postmarkapp.com/developer/api/email-api). Responde `ErrorCode` 0 si
 * aceptó el mensaje. Los códigos 300 (correo inválido) y 406 (destinatario inactivo por rebote o queja) son
 * permanentes: no se reintenta.
 */
export class PostmarkProvider extends EmailProvider {
  readonly name = 'postmark' as const;
  constructor(private readonly cfg: AppConfig['email']) {
    super();
  }

  async send(m: OutboundEmail): Promise<SendResult> {
    const headers = m.unsubscribeUrl
      ? [{ Name: 'List-Unsubscribe', Value: `<${m.unsubscribeUrl}>` }, { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' }]
      : [];
    let res: Response;
    try {
      res = await fetch(`${this.cfg.postmarkUrl}/email`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Postmark-Server-Token': this.cfg.postmarkToken ?? '' },
        body: JSON.stringify({
          From: m.from, To: m.to, ReplyTo: m.replyTo ?? undefined, Subject: m.subject, TextBody: m.text, HtmlBody: m.html,
          MessageStream: this.cfg.postmarkStream, Metadata: m.metadata, Headers: headers, TrackOpens: false,
          Attachments: (m.attachments ?? []).map((a) => ({ Name: a.name, Content: a.content.toString('base64'), ContentType: a.contentType, ...(a.cid ? { ContentID: `cid:${a.cid}` } : {}) })),
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      return { ok: false, permanent: false, error: `Postmark ${(e as Error).name}` };
    }
    const body = (await res.json().catch(() => ({}))) as { ErrorCode?: number; Message?: string; MessageID?: string };
    if (res.ok && body.ErrorCode === 0 && body.MessageID) return { ok: true, providerId: body.MessageID };
    const code = body.ErrorCode ?? res.status;
    return { ok: false, permanent: code === 300 || code === 406, error: `Postmark ${res.status}/${code}` };
  }
}

/** SMTP propio o de Amazon SES (email-smtp.<región>.amazonaws.com) con nodemailer. */
export class SmtpProvider extends EmailProvider {
  readonly name = 'smtp' as const;
  private readonly transport: ReturnType<typeof nodemailer.createTransport>;
  constructor(cfg: AppConfig['email']) {
    super();
    this.transport = nodemailer.createTransport(cfg.smtpUrl!);
  }

  async send(m: OutboundEmail): Promise<SendResult> {
    try {
      const info = await this.transport.sendMail({
        from: m.from, to: m.to, replyTo: m.replyTo ?? undefined, subject: m.subject, text: m.text, html: m.html,
        attachments: (m.attachments ?? []).map((a) => ({ filename: a.name, content: a.content, contentType: a.contentType, ...(a.cid ? { cid: a.cid } : {}) })),
        headers: { ...(m.metadata ? { 'X-Coroc-Message': m.metadata.message ?? '' } : {}) },
        list: m.unsubscribeUrl ? { unsubscribe: { url: m.unsubscribeUrl, comment: 'Unsubscribe' } } : undefined,
      });
      return { ok: true, providerId: String(info.messageId) };
    } catch (e) {
      const code = (e as { responseCode?: number }).responseCode ?? 0;
      // 5xx de SMTP es permanente (buzón inexistente, dominio inválido); 4xx y fallas de red se reintentan.
      return { ok: false, permanent: code >= 500 && code < 600, error: `SMTP ${code || (e as Error).name}` };
    }
  }
}

/** Correo en memoria: desarrollo y pruebas. Nunca registra el destinatario ni el cuerpo (§2 regla 9). */
export class MemoryEmailProvider extends EmailProvider {
  readonly name = 'memory' as const;
  readonly sent: (OutboundEmail & { providerId: string })[] = [];
  private readonly log = new Logger('Correo');
  /** Direcciones que el «proveedor» rechaza como permanentes, para probar los rebotes. */
  readonly rejecting = new Set<string>();

  async send(m: OutboundEmail): Promise<SendResult> {
    if (this.rejecting.has(m.to.toLowerCase())) return { ok: false, permanent: true, error: 'Memory 406' };
    const providerId = `mem-${this.sent.length + 1}-${Date.now().toString(36)}`;
    this.sent.push({ ...m, providerId });
    if (this.sent.length > 500) this.sent.shift();
    this.log.log(`Correo en cola local: ${m.subject.length} caracteres de asunto`);
    return { ok: true, providerId };
  }
}

/**
 * Sin proveedor configurado: no se simula el envío. Los correos quedan en «Por enviar hoy» para enviarlos desde el
 * programa de correo del usuario (enlace `mailto:`), igual que el modo asistido de WhatsApp.
 */
export class NoEmailProvider extends EmailProvider {
  readonly name = 'none' as const;
  async send(): Promise<SendResult> {
    return { ok: false, permanent: false, error: 'EMAIL_NOT_CONFIGURED' };
  }
}

export function emailProviderFactory(config: AppConfig): EmailProvider {
  if (config.email.provider === 'postmark' && config.email.postmarkToken) return new PostmarkProvider(config.email);
  if (config.email.provider === 'smtp' && config.email.smtpUrl) return new SmtpProvider(config.email);
  if (config.email.provider === 'memory') return new MemoryEmailProvider();
  return new NoEmailProvider();
}

/** Cuerpo HTML elegante con el logo (§11.2): el texto del mensaje, sin estilos externos ni rastreo. */
export const LOGO_CID = 'coroc-logo';
let cachedLogo: Buffer | null = null;
/** Logo en PNG para el correo: la mayoría de los programas de correo no muestran SVG ni imágenes `data:`. */
export function emailLogo(): Buffer {
  cachedLogo ??= fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/brand/coroc-logo-email.png'));
  return cachedLogo;
}

export function emailHtml(args: { company: string; text: string; footer: string; lang: string }): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const linkify = (s: string) => esc(s).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" style="color:#130E42">${u}</a>`);
  const paragraphs = args.text.split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${linkify(p).replace(/\n/g, '<br>')}</p>`).join('');
  return `<!doctype html><html lang="${esc(args.lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 12px;background:#FFFDE7;font:16px/1.55 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#130E42">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #E8E4D8;border-top:4px solid #CAA555;border-radius:14px">
<tr><td style="padding:24px 28px 8px"><strong style="font-size:18px">${esc(args.company)}</strong></td></tr>
<tr><td style="padding:12px 28px 8px">${paragraphs}</td></tr>
<tr><td style="padding:10px 28px 22px;font-size:12px;color:#5B5878;border-top:1px solid #F1EEE4">${esc(args.footer)}<br><img src="cid:${LOGO_CID}" alt="COROC" width="114" height="22" style="display:block;margin-top:10px;width:114px;height:22px"></td></tr>
</table></td></tr></table></body></html>`;
}
