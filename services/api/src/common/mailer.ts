import { Injectable, Logger } from '@nestjs/common';
import type { EmailProvider } from '../messaging/email.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * Correo de la cuenta (recuperación de contraseña). Sale por el proveedor de correo de la mensajería (§4.5,
 * `ProviderMailer`); `MemoryMailer` guarda los mensajes para las pruebas y el desarrollo local.
 */
export abstract class Mailer {
  abstract send(msg: MailMessage): Promise<void>;
}

@Injectable()
export class MemoryMailer extends Mailer {
  readonly outbox: MailMessage[] = [];
  private readonly log = new Logger('Mailer');
  async send(msg: MailMessage): Promise<void> {
    this.outbox.push(msg);
    if (this.outbox.length > 100) this.outbox.shift();
    // Sin datos personales en el log: solo el asunto.
    this.log.log(`Correo en cola local: ${msg.subject}`);
  }
}

/** Correo de la cuenta por el proveedor configurado (Postmark o SMTP). Sin datos personales en el log. */
export class ProviderMailer extends Mailer {
  private readonly log = new Logger('Mailer');
  constructor(private readonly provider: EmailProvider, private readonly from: string) {
    super();
  }
  async send(msg: MailMessage): Promise<void> {
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
    const r = await this.provider.send({ from: `"COROC" <${this.from}>`, to: msg.to, subject: msg.subject, text: msg.text, html: `<pre style="font:15px/1.5 system-ui,sans-serif;white-space:pre-wrap">${esc(msg.text)}</pre>` });
    if (!r.ok) this.log.warn(`Correo de la cuenta no enviado: ${r.error}`);
  }
}
