import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { FetchMessageObject, ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { isOptOut } from '@coroc/core';
import { AuditService } from '../audit/audit.service.js';
import { Clock } from '../common/clock.js';
import { Problem } from '../common/problem.js';
import { CONFIG, type AppConfig } from '../config.js';
import { DbService } from '../db/db.service.js';
import { IntakeService } from '../intake/intake.service.js';
import { MessagingService, type MessageRow } from '../messaging/messaging.service.js';
import { GmailAccounts, PROCESSED_KEYWORD, PROCESSED_LABEL, gmailProblem, type GmailAccountRow } from './gmail.js';

/** Adjuntos más pequeños que esto son logos y firmas, no comprobantes. */
const MIN_ATTACHMENT_BYTES = 8 * 1024;

/**
 * Lector del Gmail de la empresa (ADR-065): con la conexión abierta, Gmail avisa al instante cuando llega un correo
 * (IMAP IDLE) y, además, se revisa cada 2 minutos. Solo se leen los correos que vienen de la dirección de un cliente:
 * los demás (personales, publicidad) ni se abren. Cada comprobante adjunto entra a la recepción de la Fase 3, que lo lee,
 * identifica al cliente y registra o propone el pago; el recibo sale después por correo en el mismo hilo.
 */
@Injectable()
export class GmailInbox implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Gmail');
  private readonly watchers = new Map<string, Watcher>();
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly db: DbService,
    private readonly accounts: GmailAccounts,
    private readonly intake: IntakeService,
    private readonly messaging: MessagingService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** Una revisión completa con una conexión propia (pruebas, «Revisar ahora» y respaldo del lector). */
  async syncTenant(tenantId: string): Promise<number> {
    const acc = await this.accounts.account(tenantId);
    if (!acc || acc.status !== 'active') return 0;
    const client = this.accounts.imapClient(String(acc.address), this.accounts.password(acc));
    client.on('error', () => undefined);
    try {
      await client.connect();
      const n = await this.sync(client, tenantId);
      await client.logout();
      return n;
    } catch (e) {
      client.close();
      if (e instanceof Problem) throw e;
      await this.accounts.markError(tenantId, gmailProblem(e, 'imap'));
      return 0;
    }
  }

  /** Correos nuevos del buzón de entrada desde el último leído, en orden. */
  async sync(client: ImapFlow, tenantId: string): Promise<number> {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const box = client.mailbox;
      if (!box) return 0;
      const acc = (await this.accounts.account(tenantId))!;
      let last = Number(acc.last_uid);
      // Gmail renumeró el buzón (UIDVALIDITY nueva): se sigue con lo que llegue desde ahora; los duplicados igual se
      // detienen por el identificador del mensaje (CA-07).
      if (acc.uid_validity !== null && String(acc.uid_validity) !== String(box.uidValidity)) last = Math.max(0, Number(box.uidNext) - 1);
      const found: FetchMessageObject[] = [];
      // Con la conexión abierta, UIDNEXT no se actualiza al llegar correo: se pregunta siempre por lo posterior al último
      // leído («n:*» devuelve el último aunque sea anterior, por eso se filtra). No se puede usar la conexión dentro del
      // recorrido: primero se listan los sobres y después se procesa cada uno.
      if (box.exists > 0) {
        for await (const m of client.fetch(`${last + 1}:*`, { uid: true, envelope: true }, { uid: true })) if (m.uid > last) found.push(m);
      }
      found.sort((a, b) => a.uid - b.uid);
      let processed = 0;
      for (const m of found) {
        if (await this.handle(client, tenantId, m)) processed++;
        last = m.uid;
        await this.db.tx({ tenantId }, (tx) => tx.exec('UPDATE gmail_accounts SET last_uid = $1, uid_validity = $2 WHERE tenant_id = current_tenant()', [last, String(box.uidValidity)]));
      }
      await this.db.tx({ tenantId }, (tx) =>
        tx.exec("UPDATE gmail_accounts SET last_uid = greatest(last_uid, $1), uid_validity = $2, last_check_at = $3, last_error = NULL, status = 'active' WHERE tenant_id = current_tenant()", [
          last, String(box.uidValidity), this.clock.now(),
        ]),
      );
      return processed;
    } finally {
      lock.release();
    }
  }

  /** Un correo: si es de un cliente, sus comprobantes van a la recepción y queda en el hilo; «SALIR» lo excluye. */
  private async handle(client: ImapFlow, tenantId: string, m: FetchMessageObject): Promise<boolean> {
    const from = m.envelope?.from?.[0]?.address?.trim().toLowerCase();
    if (!from) return false;
    const clients = await this.db.tx({ tenantId }, (tx) => tx.many<{ id: string }>('SELECT id FROM clients WHERE email = $1 ORDER BY created_at LIMIT 5', [from]));
    if (!clients.length) return false;
    const full = await client.fetchOne(String(m.uid), { source: true }, { uid: true });
    if (!full || !full.source) return false;
    const mail = await simpleParser(full.source, { skipImageLinks: true, skipTextLinks: true });
    // Respuestas automáticas (fuera de la oficina, rebotes): no son del cliente.
    const auto = String(mail.headers.get('auto-submitted') ?? 'no').toLowerCase();
    if (auto !== 'no') return false;
    const messageId = (mail.messageId ?? m.envelope?.messageId ?? `<uid-${m.uid}@gmail.coroc>`).trim();
    const text = (mail.text ?? '').trim();
    const clientId = clients.length === 1 ? clients[0]!.id : null;
    let acted = false;
    // Exclusión por respuesta (§20.1): la primera línea es SALIR, SAIR o STOP.
    const firstLine = text.split(/\r?\n/).find((l) => l.trim()) ?? '';
    if (isOptOut(firstLine)) {
      const blocked: MessageRow[] = [];
      await this.db.tx({ tenantId }, async (tx) => {
        for (const c of clients) await this.messaging.optOutTx(tx, c.id, ['email'], 'keyword', blocked);
      });
      this.messaging.published(tenantId, blocked);
      acted = true;
    }
    const attachments: { name: string | null; size: number; intakeId: string | null }[] = [];
    for (const [i, a] of mail.attachments.entries()) {
      if (a.size < MIN_ATTACHMENT_BYTES) continue;
      try {
        const r = await this.intake.ingest({ tenantId, userId: null, role: 'owner' }, {
          channel: 'email', body: a.content, fileName: a.filename ?? null, senderEmail: from, providerMsgId: `${messageId}#${i}`,
          messageText: [mail.subject, text].filter(Boolean).join('\n').slice(0, 2000) || null,
        });
        attachments.push({ name: a.filename ?? null, size: a.size, intakeId: r.id });
        acted = true;
      } catch (e) {
        // Lo que no es un comprobante (un documento de texto, un video) se ignora sin detener la lectura.
        if (e instanceof Problem && (e.code === 'FILE_TYPE_NOT_ALLOWED' || e.code === 'FILE_TOO_LARGE')) {
          attachments.push({ name: a.filename ?? null, size: a.size, intakeId: null });
          continue;
        }
        throw e;
      }
    }
    await this.db.tx({ tenantId }, async (tx) => {
      await this.accounts.record(tx, {
        clientId, direction: 'in', messageId, inReplyTo: mail.inReplyTo ?? null, subject: mail.subject ?? null, text, from,
        to: String(m.envelope?.to?.[0]?.address ?? '') || null, attachments, at: mail.date ?? this.clock.now(),
      });
      if (acted) await this.audit.log(tx, 'gmail.received', 'client', clientId, { after: { attachments: attachments.length } });
    });
    if (acted) await this.label(client, m.uid);
    return acted;
  }

  /** Etiqueta «COROC/Procesado» en Gmail; en otro servidor IMAP, una palabra clave equivalente. */
  private async label(client: ImapFlow, uid: number): Promise<void> {
    const gmail = client.capabilities.has('X-GM-EXT-1');
    await client.messageFlagsAdd(String(uid), [gmail ? PROCESSED_LABEL : PROCESSED_KEYWORD], { uid: true, useLabels: gmail }).catch((e: Error) => this.log.warn(`No se pudo etiquetar un correo: ${e.message}`));
  }

  // ───────────────────────── Lector permanente ─────────────────────────

  onApplicationBootstrap(): void {
    if (!this.config.gmail.enabled || this.config.gmail.worker !== 'on') return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.config.gmail.pollSeconds * 1000);
    this.timer.unref();
  }

  /** Arranca el lector de cada empresa con Gmail conectado, detiene los que ya no aplican y revisa los que corren. */
  async refresh(): Promise<void> {
    if (this.stopped) return;
    try {
      const ids = new Set((await this.db.tx(null, (tx) => tx.many<{ id: string }>('SELECT gmail_tenant_ids() AS id'))).map((r) => r.id));
      for (const [id, w] of this.watchers) {
        if (!ids.has(id)) {
          w.stop();
          this.watchers.delete(id);
        }
      }
      for (const id of ids) {
        const w = this.watchers.get(id);
        if (w) w.kick();
        else {
          const nw = new Watcher(this, this.accounts, id, this.config.gmail.pollSeconds * 1000, this.log);
          this.watchers.set(id, nw);
          nw.start();
        }
      }
    } catch (e) {
      this.log.warn(`Lector de Gmail: ${(e as Error).message}`);
    }
  }

  /** Después de conectar o cambiar la cuenta: el lector se reinicia con la contraseña nueva. */
  restart(tenantId: string): void {
    this.watchers.get(tenantId)?.stop();
    this.watchers.delete(tenantId);
    if (this.config.gmail.worker === 'on') void this.refresh();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await Promise.all([...this.watchers.values()].map((w) => w.stop()));
    this.watchers.clear();
  }
}

/** Conexión permanente de una empresa: IDLE para enterarse al instante y una revisión periódica de respaldo. */
class Watcher {
  private client: ImapFlow | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private stopped = false;
  private wake: (() => void) | null = null;

  constructor(private readonly inbox: GmailInbox, private readonly accounts: GmailAccounts, private readonly tenantId: string, private readonly interval: number, private readonly log: Logger) {}

  start(): void {
    void this.loop();
  }

  /** Revisa ya (llegó un correo o pasó el intervalo). Si hay una revisión en curso, otra la sigue. */
  kick(): void {
    if (!this.client?.usable) return;
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.inbox.sync(this.client!, this.tenantId).catch((e: Error) => this.log.warn(`Revisión de Gmail: ${e.message}`));
      } while (this.again && this.client?.usable && !this.stopped);
    })().finally(() => (this.running = null));
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      let acc: GmailAccountRow | null = null;
      try {
        acc = await this.accounts.account(this.tenantId);
        if (!acc || acc.status !== 'active') return;
        const client = this.accounts.imapClient(String(acc.address), this.accounts.password(acc));
        client.on('error', () => undefined);
        this.client = client;
        await client.connect();
        client.on('exists', () => this.kick());
        this.kick();
        const timer = setInterval(() => this.kick(), this.interval);
        await new Promise<void>((resolve) => {
          this.wake = resolve;
          client.once('close', () => resolve());
        });
        clearInterval(timer);
      } catch (e) {
        if (acc) await this.accounts.markError(this.tenantId, gmailProblem(e, 'imap')).catch(() => undefined);
      }
      await this.running?.catch(() => undefined);
      this.client?.close();
      this.client = null;
      if (this.stopped) return;
      // Sin internet o Gmail no disponible: se reintenta con calma.
      await new Promise<void>((r) => {
        const t = setTimeout(r, this.interval);
        t.unref();
        this.wake = () => {
          clearTimeout(t);
          r();
        };
      });
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.wake?.();
    await this.running?.catch(() => undefined);
    const c = this.client;
    this.client = null;
    if (c) await c.logout().catch(() => c.close());
  }
}
