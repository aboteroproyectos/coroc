import { Injectable, Logger } from '@nestjs/common';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * Puerto de correo saliente (§4.5 EmailProvider). En la Fase 1 solo se usa para la recuperación de contraseña.
 * Los adaptadores de SES, Postmark y SMTP llegan con la mensajería (Fase 4); hasta entonces la API usa el adaptador
 * registrado en el módulo. `MemoryMailer` guarda los mensajes para las pruebas y el desarrollo local.
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
