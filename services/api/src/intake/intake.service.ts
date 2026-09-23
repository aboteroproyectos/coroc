import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  decideAutoApply,
  documentFileName,
  identifySender,
  logicalFingerprint,
  pickLoan,
  validateExtraction,
  type ClientRef,
  type Extraction,
  type Flag,
  type Identification,
  type LoanRef,
} from '@coroc/core';
import { AuditService } from '../audit/audit.service.js';
import { AccessService } from '../common/access.js';
import { Clock, localDate } from '../common/clock.js';
import type { AuthContext } from '../common/context.js';
import { Problem } from '../common/problem.js';
import { TenantCache, type TenantInfo } from '../company/tenant-cache.js';
import { CONFIG, type AppConfig } from '../config.js';
import { EventBus } from '../dashboard/event-bus.js';
import { DbService, type Tx } from '../db/db.service.js';
import { DocumentsService, MAX_UPLOAD_BYTES, sniffMime } from '../documents/documents.service.js';
import { DocumentTasks, type TaskRow } from '../documents/tasks.js';
import { LoanStateService } from '../loans/loan-state.service.js';
import { PaymentsService, type Actor, type PaymentInput } from '../loans/payments.service.js';
import { ObjectStore } from '../storage/object-store.js';
import { ReceiptExtractor, type ExtractionOutcome } from './extractor.js';
import { ReceiptReader } from './reader.js';

export type IntakeChannel = 'whatsapp' | 'email' | 'upload_link' | 'share' | 'folder' | 'upload';
export type IntakeStatus = 'processing' | 'review' | 'unassigned' | 'applied_auto' | 'approved' | 'duplicate' | 'rejected' | 'archived' | 'failed';

export interface IngestInput {
  channel: IntakeChannel;
  body: Buffer;
  fileName?: string | null;
  senderPhone?: string | null;
  senderEmail?: string | null;
  providerMsgId?: string | null;
  uploadLinkId?: string | null;
  hintClientId?: string | null;
  hintLoanId?: string | null;
  messageText?: string | null;
  createdBy?: string | null;
}

/** Libro: el canal del comprobante queda como origen del movimiento (§9.7). */
const SOURCE: Record<IntakeChannel, NonNullable<PaymentInput['source']>> = {
  whatsapp: 'whatsapp', email: 'email', upload_link: 'upload_link', share: 'inbox', folder: 'folder', upload: 'manual',
};
/** Lo que aún cuenta para el antiduplicado: aplicado o esperando revisión (ADR-020). */
const LIVE: IntakeStatus[] = ['processing', 'review', 'unassigned', 'applied_auto', 'approved'];
const PENDING: IntakeStatus[] = ['review', 'unassigned'];

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

/**
 * Recepción, lectura y registro de comprobantes (§12–§14). Cada canal entrega el archivo a `ingest`, que lo guarda
 * cifrado en el repositorio y registra la tarea de lectura en la misma transacción (ADR-032). La tarea lee, extrae,
 * identifica al remitente, valida y decide: registra el pago solo si todo es inequívoco; si no, va a la Bandeja.
 */
@Injectable()
export class IntakeService implements OnModuleInit {
  private readonly log = new Logger('Recepcion');

  constructor(
    private readonly db: DbService,
    private readonly tasks: DocumentTasks,
    private readonly docs: DocumentsService,
    private readonly store: ObjectStore,
    private readonly reader: ReceiptReader,
    private readonly extractor: ReceiptExtractor,
    private readonly payments: PaymentsService,
    private readonly state: LoanStateService,
    private readonly tenants: TenantCache,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly bus: EventBus,
    private readonly clock: Clock,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.tasks.register('intake', (task) => this.process(task));
  }

  private ctx(a: Actor) {
    return { tenantId: a.tenantId, userId: a.userId, role: a.role };
  }

  /* ───────────────────────── Entrada común de los canales (§12) ───────────────────────── */

  /**
   * Guarda el archivo y lo deja en cola de lectura. Idempotente por el identificador del mensaje del proveedor: un
   * reintento del webhook devuelve lo que ya se recibió.
   */
  async ingest(actor: Actor, input: IngestInput): Promise<{ id: string; status: IntakeStatus; duplicate: boolean }> {
    if (!input.body.length || input.body.length > MAX_UPLOAD_BYTES) throw new Problem(413, 'FILE_TOO_LARGE', { mb: MAX_UPLOAD_BYTES / 1024 / 1024 });
    const type = sniffMime(input.body);
    if (!type) throw new Problem(415, 'FILE_TYPE_NOT_ALLOWED');
    const tenant = await this.tenants.get(actor.tenantId);
    const out = await this.db.tx(this.ctx(actor), async (tx) => {
      if (input.providerMsgId) {
        const seen = await tx.one<{ id: string; status: IntakeStatus }>('SELECT id, status FROM intake_events WHERE channel = $1 AND provider_msg_id = $2', [input.channel, input.providerMsgId]);
        if (seen) return { id: seen.id, status: seen.status, duplicate: true };
      }
      let clientId: string | null = null;
      let loanId: string | null = null;
      let contract: string | null = null;
      if (input.hintClientId) {
        const c = await tx.one<{ id: string }>('SELECT id FROM clients WHERE id = $1', [input.hintClientId]);
        if (!c) return this.access.deny(tx, actor as AuthContext, 'client', input.hintClientId);
        clientId = c.id;
      }
      if (input.hintLoanId) {
        const l = await tx.one<{ id: string; client_id: string; contract: string }>('SELECT id, client_id, contract FROM loans WHERE id = $1', [input.hintLoanId]);
        if (!l || (clientId && l.client_id !== clientId)) throw new Problem(422, 'VALIDATION_FAILED', {}, [{ field: 'loanId', message: 'other' }]);
        clientId = l.client_id;
        loanId = l.id;
        contract = l.contract;
      }
      const stamp = this.clock.localStamp(tenant.timezone);
      const fileName = documentFileName(tenant.lang, { stamp, kind: 'receipt_in', contract, ext: type.ext });
      const doc = await this.docs.save(tx, tenant.id, {
        clientId, loanId, kind: 'receipt_in', name: (input.fileName ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 160) || fileName, fileName,
        mime: type.mime, body: input.body, source: SOURCE[input.channel], meta: { channel: input.channel }, createdBy: actor.userId,
      });
      const row = (await tx.one<{ id: string }>(
        `INSERT INTO intake_events (tenant_id, channel, provider_msg_id, sender_phone, sender_email, upload_link_id, document_id, file_sha256,
                                    status, stage, file_name, mime, message_text, hint_client_id, hint_loan_id, client_id, loan_id, created_by)
         VALUES (current_tenant(), $1, $2, $3, $4, $5, $6, $7, 'processing', 'ALMACENADO', $8, $9, $10, $11, $12, $11, $12, $13) RETURNING id`,
        [input.channel, input.providerMsgId ?? null, input.senderPhone ?? null, input.senderEmail ?? null, input.uploadLinkId ?? null, doc.id, doc.sha256,
          input.fileName?.slice(0, 200) ?? null, type.mime, input.messageText?.slice(0, 2000) ?? null, clientId, loanId, actor.userId],
      ))!;
      await this.tasks.enqueue(tx, { kind: 'intake', loanId, params: { intakeId: row.id }, dedupeKey: `intake:${row.id}`, createdBy: actor.userId });
      await this.audit.log(tx, 'intake.received', 'intake', row.id, { after: { channel: input.channel, documentId: doc.id, size: input.body.length, sha256: doc.sha256 } });
      return { id: row.id, status: 'processing' as IntakeStatus, duplicate: false, clientId };
    });
    if (!out.duplicate) {
      this.tasks.kick();
      this.publish(actor.tenantId, out.id, (out as { clientId?: string | null }).clientId ?? null, 'processing');
    }
    return { id: out.id, status: out.status, duplicate: out.duplicate };
  }

  private async publish(tenantId: string, id: string, clientId: string | null, status: string): Promise<void> {
    let collectorId: string | null = null;
    if (clientId) {
      collectorId = (await this.db.tx({ tenantId }, (tx) => tx.one<{ collector_id: string | null }>('SELECT collector_id FROM clients WHERE id = $1', [clientId])))?.collector_id ?? null;
    }
    this.bus.publish({ type: 'intake.updated', tenantId, clientId: clientId ?? undefined, collectorId, data: { intakeId: id, status } });
  }

  /* ───────────────────────── Lectura y decisión (§13, §14) ───────────────────────── */

  private async process(task: TaskRow): Promise<string | null> {
    const intakeId = String(task.params.intakeId);
    const system: Actor = { tenantId: task.tenant_id, userId: null, role: 'owner' };
    const tenant = await this.tenants.get(task.tenant_id);
    const row = await this.db.tx(this.ctx(system), (tx) =>
      tx.one<Record<string, any>>('SELECT i.*, d.storage_key, d.size_bytes, d.created_at AS received_at FROM intake_events i JOIN documents d ON d.id = i.document_id WHERE i.id = $1', [intakeId]),
    );
    if (!row || row.status !== 'processing') return null;
    try {
      const body = await this.store.getBuffer(task.tenant_id, row.storage_key, Number(row.size_bytes));
      const reading = await this.reader.read(body, row.mime);
      const receivedOn = localDate(new Date(row.received_at), tenant.timezone);
      // Moneda por defecto para leer «$ 60.000»: la de los préstamos del remitente, si ya se sabe quién es; si no, la de la empresa.
      const currency = await this.db.tx(this.ctx(system), (tx) => this.senderCurrency(tx, row));
      const extraction = await this.extractor.extract({ reading, body, mime: row.mime, receivedOn, defaultCurrency: currency ?? tenant.currency });
      const result = await this.db.tx(this.ctx(system), (tx) => this.decide(tx, system, tenant, row, reading, extraction));
      if (result.posted) this.payments.published(task.tenant_id, result.loanId!, result.amount!, result.posted);
      this.publish(task.tenant_id, intakeId, result.clientId, result.status);
      this.log.log(`Comprobante ${intakeId}: ${result.status}`);
    } catch (e) {
      if (task.attempts < 5) throw e;
      // Tras varios intentos no se pierde: queda en la Bandeja para revisión manual.
      await this.db.tx(this.ctx(system), (tx) =>
        tx.exec(
          `UPDATE intake_events SET status = CASE WHEN client_id IS NULL THEN 'unassigned'::intake_status ELSE 'review'::intake_status END,
                  stage = 'EN_REVISIÓN', error = $2, flags = $3 WHERE id = $1 AND status = 'processing'`,
          [intakeId, (e as Error).message.slice(0, 300), JSON.stringify([{ code: 'OCR_UNAVAILABLE', severity: 'blocking', detail: 'processing_failed' }])],
        ),
      );
      this.publish(task.tenant_id, intakeId, row.client_id, 'review');
    }
    return null;
  }

  /** Moneda de los préstamos activos del remitente (enlace, carpeta, número o correo), si todos usan la misma. */
  private async senderCurrency(tx: Tx, row: Record<string, any>): Promise<'COP' | 'BRL' | 'USD' | null> {
    const rows = await tx.many<{ currency: 'COP' | 'BRL' | 'USD' }>(
      `SELECT DISTINCT l.currency FROM loans l JOIN clients c ON c.id = l.client_id
        WHERE l.status = 'active' AND (
              l.id = $1 OR l.id = (SELECT loan_id FROM upload_links WHERE id = $2) OR c.id = $3
           OR ($4::text IS NOT NULL AND (c.phone_e164 = $4 OR c.phone2_e164 = $4 OR EXISTS (SELECT 1 FROM co_debtors cd WHERE cd.client_id = c.id AND cd.phone_e164 = $4)))
           OR ($5::text IS NOT NULL AND c.email = $5::citext))`,
      [row.hint_loan_id, row.upload_link_id, row.hint_client_id, row.sender_phone, row.sender_email],
    );
    return rows.length === 1 ? rows[0]!.currency : null;
  }

  /** Clientes candidatos con sus préstamos activos y lo que queda pendiente de cada cuota (§12.7). */
  private async clientRefs(tx: Tx, ids: string[], today: string): Promise<ClientRef[]> {
    if (!ids.length) return [];
    const clients = await tx.many<Record<string, any>>(
      `SELECT c.id, c.first_name, c.last_name, c.phone_e164, c.phone2_e164, c.email,
              (SELECT array_agg(cd.phone_e164) FROM co_debtors cd WHERE cd.client_id = c.id AND cd.phone_e164 IS NOT NULL) AS cd_phones,
              (SELECT min(cd.name) FROM co_debtors cd WHERE cd.client_id = c.id) AS cd_name
         FROM clients c WHERE c.id = ANY($1::uuid[])`,
      [ids],
    );
    const loans = await tx.many<{ id: string; client_id: string }>("SELECT id, client_id FROM loans WHERE client_id = ANY($1::uuid[]) AND status = 'active' ORDER BY created_at", [ids]);
    const loaded = await this.state.loadMany(tx, loans.map((l) => l.id));
    const refs = new Map<string, LoanRef[]>();
    for (const l of loaded) {
      const r = this.state.replay(l, today);
      const open = r.states.filter((s) => s.status !== 'paid');
      const pending = open.map((s) => s.amount - s.paid + (s.lateFeeAccrued ?? 0) - (s.lateFeePaid ?? 0)).filter((x) => x > 0);
      const overdue = open.find((s) => s.dueDate < today);
      (refs.get(l.loan.client_id) ?? refs.set(l.loan.client_id, []).get(l.loan.client_id)!).push({ id: l.loan.id, currency: l.loan.currency, pendingAmounts: pending, oldestOverdueDate: overdue?.dueDate });
    }
    return clients.map((c) => ({
      id: c.id,
      fullName: `${c.first_name} ${c.last_name}`,
      phones: [c.phone_e164, c.phone2_e164].filter(Boolean),
      emails: c.email ? [String(c.email)] : [],
      coDebtorPhones: c.cd_phones ?? [],
      coDebtorName: c.cd_name ?? undefined,
      active: (refs.get(c.id) ?? []).length > 0,
      loans: refs.get(c.id) ?? [],
    }));
  }

  /** Clientes a considerar: los del número o correo del remitente y, si no hay, los de nombre parecido al del pagador. */
  private async candidates(tx: Tx, phone: string | null, email: string | null, payerName: string | null): Promise<string[]> {
    const ids = new Set<string>();
    if (phone) {
      for (const r of await tx.many<{ id: string }>(
        `SELECT id FROM clients WHERE phone_e164 = $1 OR phone2_e164 = $1
         UNION SELECT client_id FROM co_debtors WHERE phone_e164 = $1`,
        [phone],
      )) ids.add(r.id);
    }
    if (email) for (const r of await tx.many<{ id: string }>('SELECT id FROM clients WHERE email = $1::citext', [email])) ids.add(r.id);
    if (!ids.size && payerName) {
      const folded = payerName.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      for (const r of await tx.many<{ id: string }>(
        `SELECT c.id FROM clients c WHERE EXISTS (SELECT 1 FROM loans l WHERE l.client_id = c.id AND l.status = 'active')
            AND word_similarity($1, c.search_text) > 0.45 ORDER BY word_similarity($1, c.search_text) DESC LIMIT 5`,
        [folded],
      )) ids.add(r.id);
    }
    return [...ids].slice(0, 20);
  }

  private async decide(tx: Tx, system: Actor, tenant: TenantInfo, row: Record<string, any>, reading: Awaited<ReturnType<ReceiptReader['read']>>, ex: ExtractionOutcome) {
    const today = this.clock.today(tenant.timezone);
    const x = ex.fields;
    await tx.exec('UPDATE documents SET ocr_text = $2 WHERE id = $1', [row.document_id, reading.text.slice(0, 100_000) || null]);

    // Identificación del remitente (§12.7).
    let linkClient: string | null = null;
    if (row.upload_link_id) {
      linkClient = (await tx.one<{ client_id: string }>('SELECT l.client_id FROM upload_links u JOIN loans l ON l.id = u.loan_id WHERE u.id = $1', [row.upload_link_id]))?.client_id ?? null;
    }
    const hinted = row.hint_client_id as string | null;
    const ids = hinted || linkClient ? [hinted ?? linkClient!] : await this.candidates(tx, row.sender_phone, row.sender_email, x.payerName.value);
    const refs = await this.clientRefs(tx, ids, today);
    const identification: Identification = identifySender(
      {
        phone: row.sender_phone ?? undefined,
        email: row.sender_email ?? undefined,
        uploadLinkClientId: linkClient ?? undefined,
        folderClientId: hinted ?? undefined,
        payerName: x.payerName.value ?? undefined,
        amount: x.amount.value ?? undefined,
      },
      refs,
    );
    const client = identification.clientId ? refs.find((c) => c.id === identification.clientId) : undefined;
    let loanPick: ReturnType<typeof pickLoan> = { rule: 'ambiguous' };
    if (row.hint_loan_id) loanPick = { loanId: row.hint_loan_id, rule: 'single' };
    else if (row.upload_link_id) loanPick = { loanId: (await tx.one<{ loan_id: string }>('SELECT loan_id FROM upload_links WHERE id = $1', [row.upload_link_id]))!.loan_id, rule: 'single' };
    else if (client) loanPick = pickLoan(client, x.amount.value ?? -1);

    // Validaciones (§13.4).
    const flags: Flag[] = [];
    let validation: ReturnType<typeof validateExtraction> = { flags: [], autoEligible: false };
    const loan = loanPick.loanId ? await tx.one<{ id: string; currency: 'COP' | 'BRL' | 'USD'; disbursement_date: string; client_id: string; status: string }>('SELECT id, currency, disbursement_date, client_id, status FROM loans WHERE id = $1', [loanPick.loanId]) : null;
    const accounts = (await tx.many<{ holder_name: string; institution: string | null; last4: string | null }>('SELECT holder_name, institution, last4 FROM receiving_accounts WHERE active')).map((a) => ({
      holderName: a.holder_name, entity: a.institution ?? undefined, last4: a.last4 ?? undefined,
    }));
    if (client) {
      validation = validateExtraction(x, {
        receivingAccounts: accounts,
        clientName: client.fullName,
        coDebtorName: client.coDebtorName,
        loanCurrency: loan?.currency ?? tenant.currency,
        disbursementDate: loan?.disbursement_date ?? '1900-01-01',
        today,
        maxAgeDays: tenant.settings.maxReceiptAgeDays,
        confidenceThreshold: tenant.settings.confidenceThreshold,
        senderVerified: identification.status === 'identified' && identification.via !== undefined,
      });
    } else {
      validation = validateExtraction(x, {
        receivingAccounts: accounts, clientName: '', loanCurrency: tenant.currency, disbursementDate: '1900-01-01', today,
        maxAgeDays: tenant.settings.maxReceiptAgeDays, confidenceThreshold: tenant.settings.confidenceThreshold,
      });
      validation.flags = validation.flags.filter((f) => f.code !== 'PAYER_MISMATCH');
    }
    flags.push(...validation.flags);
    if (reading.method === 'none' || !reading.text.trim()) flags.push({ code: 'OCR_UNAVAILABLE', severity: 'blocking', detail: reading.error ?? 'empty' });
    for (const m of ex.mismatches) flags.push({ code: 'EXTRACTION_MISMATCH', field: m, severity: 'blocking' });
    if (identification.status === 'unknown') flags.push({ code: 'SENDER_UNKNOWN', severity: 'blocking' });
    if (identification.status === 'ambiguous') flags.push({ code: 'SENDER_AMBIGUOUS', severity: 'blocking' });
    if (client && !loanPick.loanId) flags.push({ code: 'LOAN_AMBIGUOUS', severity: 'blocking' });
    if (loan && loan.status !== 'active') flags.push({ code: 'LOAN_AMBIGUOUS', severity: 'blocking', detail: 'loan_closed' });
    const autoEligible = !flags.some((f) => f.severity === 'blocking');

    // Antiduplicado doble (§13.4): huella del archivo y huella lógica, contra lo aplicado y lo pendiente (ADR-020).
    const logicalKey = x.amount.value !== null && x.date.value
      ? logicalFingerprint({ reference: x.reference?.value ?? undefined, amount: x.amount.value, date: x.date.value, time: x.time?.value ?? undefined, entity: x.entity?.value ?? undefined, payerName: x.payerName.value ?? undefined })
      : null;
    const dupFile = await tx.one<{ id: string }>('SELECT id FROM intake_events WHERE file_sha256 = $1 AND id <> $2 AND status = ANY($3::intake_status[]) AND created_at <= $4 LIMIT 1', [row.file_sha256, row.id, LIVE, row.created_at]);
    const dupLogical = !dupFile && logicalKey
      ? await tx.one<{ id: string }>('SELECT id FROM intake_events WHERE logical_key = $1 AND id <> $2 AND status = ANY($3::intake_status[]) LIMIT 1', [logicalKey, row.id, LIVE])
      : null;
    const duplicate: 'file' | 'logical' | false = dupFile ? 'file' : dupLogical ? 'logical' : false;
    const duplicateOf = dupFile?.id ?? dupLogical?.id ?? null;

    const notReceipt = x.documentType.value === 'other' && x.amount.value === null;
    let decision: 'apply' | 'review' | 'duplicate' | 'archive' = decideAutoApply(identification, loanPick, { ...validation, flags, autoEligible }, duplicate, tenant.settings.supervisionMode);
    if (decision !== 'duplicate' && notReceipt && client) decision = 'archive';

    const clientId = client?.id ?? null;
    const loanId = client && loan && loan.client_id === client.id ? loan.id : null;
    let status: IntakeStatus;
    let stage: string;
    let posted: Awaited<ReturnType<PaymentsService['postTx']>> | null = null;
    let entryId: string | null = null;
    let revertibleUntil: Date | null = null;

    if (decision === 'apply') {
      await tx.exec('SAVEPOINT apply');
      try {
        posted = await this.payments.postTx(tx, system, loanId!, {
          amount: x.amount.value!, date: x.date.value!, reference: x.reference?.value ?? undefined, institution: x.entity?.value ?? undefined,
          method: x.entity?.value ?? undefined, source: SOURCE[row.channel as IntakeChannel], auto: true, documentId: row.document_id, intakeId: row.id,
        });
        entryId = posted.body.entry.id;
        revertibleUntil = new Date(this.clock.now().getTime() + Number(tenant.settings.autoRevertHours ?? 72) * 3_600_000);
        await tx.exec('RELEASE SAVEPOINT apply');
      } catch (e) {
        // Un pago que no se puede registrar (fecha fuera de rango, préstamo pagado, carrera con otro igual) va a revisión.
        await tx.exec('ROLLBACK TO SAVEPOINT apply');
        posted = null;
        flags.push({ code: 'LOAN_AMBIGUOUS', severity: 'blocking', detail: e instanceof Problem ? e.code : 'apply_failed' });
        decision = 'review';
      }
    }
    switch (decision) {
      case 'apply': status = 'applied_auto'; stage = 'APLICADO_AUTOMÁTICO'; break;
      case 'duplicate': status = 'duplicate'; stage = 'DUPLICADO'; break;
      case 'archive': status = 'archived'; stage = 'NO_ES_COMPROBANTE'; break;
      default: status = clientId ? 'review' : 'unassigned'; stage = 'EN_REVISIÓN';
    }

    await tx.exec(
      `UPDATE intake_events SET status = $2::intake_status, stage = $3, extraction = $4, identification = $5, validation = $6, flags = $7, logical_key = $8,
              decision = $9, client_id = $10, loan_id = $11, entry_id = $12, revertible_until = $13, reading = $14, decided_at = CASE WHEN $2::intake_status IN ('applied_auto', 'duplicate', 'archived') THEN now() ELSE decided_at END
        WHERE id = $1`,
      [row.id, status, stage, JSON.stringify({ ...ex, fields: x }), JSON.stringify({ ...identification, loanRule: loanPick.rule, duplicateOf }),
        JSON.stringify({ receiverMatch: validation.receiverMatch ?? null, autoEligible }), JSON.stringify(flags), logicalKey, decision,
        clientId, loanId, entryId, revertibleUntil, JSON.stringify({ method: reading.method, confidence: reading.confidence, pages: reading.pages.length, error: reading.error ?? null })],
    );
    // El comprobante pasa a la carpeta del cliente (o a «Otros documentos» si no es un comprobante).
    if (clientId) await tx.exec('UPDATE documents SET client_id = $2, loan_id = $3, kind = $4 WHERE id = $1', [row.document_id, clientId, loanId, decision === 'archive' ? 'other' : 'receipt_in']);
    await this.audit.log(tx, `intake.${status}`, 'intake', row.id, { after: { decision, flags: flags.map((f) => f.code), entryId, engine: ex.engine } });
    return { status, clientId, loanId, posted, amount: x.amount.value };
  }

  /* ───────────────────────── Bandeja de validación (§13.6) ───────────────────────── */

  private readonly select = `SELECT i.*, c.first_name, c.last_name, c.code AS client_code, l.contract, l.currency AS loan_currency, r.number AS receipt_number, r.document_id AS receipt_document_id,
      u.name AS decided_by_name FROM intake_events i
      LEFT JOIN clients c ON c.id = i.client_id LEFT JOIN loans l ON l.id = i.loan_id
      LEFT JOIN receipts r ON r.entry_id = i.entry_id LEFT JOIN users u ON u.id = i.decided_by`;

  json(r: Record<string, any>) {
    const ex = r.extraction ?? {};
    const fields: Partial<Extraction> = ex.fields ?? {};
    const regions = ex.regions ?? {};
    const extraction: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      extraction[k] = k === 'tamperSignals' ? v : { ...(v as object), region: regions[k] ?? null };
    }
    let stage = r.stage;
    if (r.status === 'applied_auto' || r.status === 'approved') stage = r.receipt_document_id ? 'RECIBO_EMITIDO' : r.status === 'approved' ? 'VALIDADO' : 'APLICADO_AUTOMÁTICO';
    const idn = r.identification ?? { status: 'unknown', candidates: [] };
    return {
      id: r.id,
      channel: r.channel,
      senderPhone: r.sender_phone ?? null,
      senderEmail: r.sender_email ?? null,
      messageText: r.message_text ?? null,
      documentId: r.document_id,
      fileName: r.file_name ?? null,
      mime: r.mime ?? null,
      status: r.status,
      stage,
      engine: ex.engine ?? null,
      extraction,
      identification: { status: idn.status, clientId: idn.clientId ?? null, via: idn.via ?? null, candidates: idn.candidates ?? [], loanRule: idn.loanRule ?? null, duplicateOf: idn.duplicateOf ?? null },
      flags: r.flags ?? [],
      receiverMatch: r.validation?.receiverMatch ? { holderName: r.validation.receiverMatch.account.holderName, score: r.validation.receiverMatch.score } : null,
      clientId: r.client_id ?? null,
      clientName: r.first_name ? `${r.first_name} ${r.last_name}` : null,
      clientCode: r.client_code ?? null,
      loanId: r.loan_id ?? null,
      contract: r.contract ?? null,
      currency: r.loan_currency ?? null,
      entryId: r.entry_id ?? null,
      receiptNumber: r.receipt_number ?? null,
      receiptDocumentId: r.receipt_document_id ?? null,
      revertibleUntil: r.status === 'applied_auto' ? iso(r.revertible_until) : null,
      reason: r.reason ?? null,
      decidedBy: r.decided_by_name ?? null,
      decidedAt: iso(r.decided_at),
      createdAt: iso(r.created_at)!,
      updatedAt: iso(r.updated_at)!,
    };
  }

  async list(auth: AuthContext, q: { status?: string | string[]; channel?: string; clientId?: string; cursor?: string; limit?: number }) {
    const statuses = (Array.isArray(q.status) ? q.status : q.status ? String(q.status).split(',') : []).filter(Boolean);
    const limit = Math.min(200, Math.max(1, Number(q.limit ?? 50)));
    return this.db.tx(this.ctx(auth), async (tx) => {
      const where: string[] = [];
      const args: unknown[] = [];
      if (statuses.length) where.push(`i.status = ANY($${args.push(statuses)}::intake_status[])`);
      if (q.channel) where.push(`i.channel = $${args.push(q.channel)}::intake_channel`);
      if (q.clientId) where.push(`i.client_id = $${args.push(q.clientId)}`);
      if (q.cursor) {
        const [at, id] = Buffer.from(q.cursor, 'base64url').toString().split('|');
        where.push(`(i.created_at, i.id) < ($${args.push(at)}::timestamptz, $${args.push(id)}::uuid)`);
      }
      const rows = await tx.many<Record<string, any>>(`${this.select} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY i.created_at DESC, i.id DESC LIMIT ${limit + 1}`, args);
      const items = rows.slice(0, limit).map((r) => this.json(r));
      const last = rows.length > limit ? rows[limit - 1]! : null;
      return { items, nextCursor: last ? Buffer.from(`${new Date(last.created_at).toISOString()}|${last.id}`).toString('base64url') : null };
    });
  }

  /** Contadores de la navegación (§13.6). */
  async summary(auth: AuthContext) {
    return this.db.tx(this.ctx(auth), async (tx) => {
      const r = (await tx.one<Record<string, string>>(
        `SELECT count(*) FILTER (WHERE status = 'review') AS review, count(*) FILTER (WHERE status = 'unassigned') AS unassigned,
                count(*) FILTER (WHERE status = 'processing') AS processing,
                count(*) FILTER (WHERE status = 'applied_auto' AND revertible_until > $1) AS revertible
           FROM intake_events WHERE status IN ('review', 'unassigned', 'processing', 'applied_auto')`,
        [this.clock.now()],
      ))!;
      const n = (k: string) => Number(r[k] ?? 0);
      return { review: n('review'), unassigned: n('unassigned'), processing: n('processing'), revertible: n('revertible'), pending: n('review') + n('unassigned') };
    });
  }

  private async load(tx: Tx, auth: AuthContext, id: string, lock = false) {
    const r = await tx.one<Record<string, any>>(`${this.select} WHERE i.id = $1${lock ? ' FOR UPDATE OF i' : ''}`, [id]);
    if (r) return r;
    // Distingue «no existe» de «es de un cliente ajeno» para registrar el acceso denegado (CA-16).
    if (auth.role === 'collector') {
      const other = await this.db.tx({ tenantId: auth.tenantId }, (t2) => t2.one<{ client_id: string | null }>('SELECT client_id FROM intake_events WHERE id = $1', [id]));
      if (other?.client_id) return this.access.deny(tx, auth, 'client', other.client_id);
    }
    throw Problem.notFound();
  }

  async get(auth: AuthContext, id: string) {
    return this.db.tx(this.ctx(auth), async (tx) => {
      const r = await this.load(tx, auth, id);
      const out = this.json(r);
      // Nombres de las sugerencias para elegir cliente sin otra consulta.
      const ids = (out.identification.candidates as { clientId: string }[]).map((c) => c.clientId);
      const names = ids.length ? await tx.many<{ id: string; name: string; code: string }>("SELECT id, first_name || ' ' || last_name AS name, code FROM clients WHERE id = ANY($1::uuid[])", [ids]) : [];
      out.identification.candidates = (out.identification.candidates as { clientId: string }[]).map((c) => ({ ...c, name: names.find((n) => n.id === c.clientId)?.name ?? null, code: names.find((n) => n.id === c.clientId)?.code ?? null }));
      return out;
    });
  }

  /** Aprobar, con correcciones o reasignando cliente y préstamo (§13.6). El pago y el estado del comprobante van juntos. */
  async approve(auth: AuthContext, id: string, b: { clientId: string; loanId: string; amount: number; date: string; payerName?: string; receiverName?: string; reference?: string; institution?: string; saveSenderAsSecondaryNumber?: boolean }) {
    const out = await this.db.tx(this.ctx(auth), async (tx) => {
      const r = await this.load(tx, auth, id, true);
      if (!PENDING.includes(r.status)) throw new Problem(409, 'INTAKE_NOT_PENDING');
      const loan = await tx.one<{ id: string; client_id: string }>('SELECT id, client_id FROM loans WHERE id = $1', [b.loanId]);
      if (!loan) return this.access.deny(tx, auth, 'loan', b.loanId);
      if (loan.client_id !== b.clientId) throw new Problem(422, 'VALIDATION_FAILED', {}, [{ field: 'loanId', message: 'other' }]);
      const fields: Partial<Extraction> = r.extraction?.fields ?? {};
      const reference = b.reference?.trim() || fields.reference?.value || undefined;
      const institution = b.institution?.trim() || fields.entity?.value || undefined;
      const payerName = b.payerName?.trim() || fields.payerName?.value || undefined;
      const logicalKey = logicalFingerprint({ reference, amount: b.amount, date: b.date, time: fields.time?.value ?? undefined, entity: institution, payerName });
      const dup = await tx.one<{ id: string }>("SELECT id FROM intake_events WHERE logical_key = $1 AND id <> $2 AND status IN ('applied_auto', 'approved') LIMIT 1", [logicalKey, id]);
      if (dup) throw new Problem(409, 'INTAKE_DUPLICATE');
      const posted = await this.payments.postTx(tx, auth, b.loanId, {
        amount: b.amount, date: b.date, reference, institution, method: institution, source: SOURCE[r.channel as IntakeChannel], auto: false, documentId: r.document_id, intakeId: id,
      });
      // Cada corrección queda como ejemplo de la empresa para mejorar la lectura (§13.6).
      const corrections: [string, unknown, unknown][] = [
        ['amount', fields.amount?.value ?? null, b.amount], ['date', fields.date?.value ?? null, b.date],
        ['payerName', fields.payerName?.value ?? null, b.payerName ?? fields.payerName?.value ?? null],
        ['receiverName', fields.receiverName?.value ?? null, b.receiverName ?? fields.receiverName?.value ?? null],
        ['reference', fields.reference?.value ?? null, reference ?? null], ['entity', fields.entity?.value ?? null, institution ?? null],
        ['client', r.identification?.clientId ?? null, b.clientId],
      ];
      for (const [field, before, after] of corrections) {
        if (String(before ?? '') !== String(after ?? '')) {
          await tx.exec('INSERT INTO extraction_corrections (tenant_id, intake_id, entity, field, extracted, corrected, created_by) VALUES (current_tenant(), $1, $2, $3, $4, $5, $6)', [
            id, fields.entity?.value ?? null, field, before === null ? null : String(before), after === null ? null : String(after), auth.userId,
          ]);
        }
      }
      let senderSaved = false;
      if (b.saveSenderAsSecondaryNumber && r.sender_phone) {
        const c = await tx.one<{ phone_e164: string; phone2_e164: string | null }>('SELECT phone_e164, phone2_e164 FROM clients WHERE id = $1', [b.clientId]);
        if (c && c.phone_e164 !== r.sender_phone && !c.phone2_e164) {
          await tx.exec('UPDATE clients SET phone2_e164 = $2, version = version + 1 WHERE id = $1', [b.clientId, r.sender_phone]);
          await this.audit.log(tx, 'client.updated', 'client', b.clientId, { before: { phone2: null }, after: { phone2: r.sender_phone, from: 'intake' } });
          senderSaved = true;
        }
      }
      await tx.exec(
        `UPDATE intake_events SET status = 'approved', stage = 'VALIDADO', client_id = $2, loan_id = $3, entry_id = $4, logical_key = $5, decided_by = $6, decided_at = now(), decision = 'approve'
          WHERE id = $1`,
        [id, b.clientId, b.loanId, posted.body.entry.id, logicalKey, auth.userId],
      );
      await tx.exec("UPDATE documents SET client_id = $2, loan_id = $3, kind = 'receipt_in' WHERE id = $1", [r.document_id, b.clientId, b.loanId]);
      await this.audit.log(tx, 'intake.approved', 'intake', id, { after: { clientId: b.clientId, loanId: b.loanId, amount: b.amount, date: b.date, entryId: posted.body.entry.id, senderSaved } });
      return { posted, senderSaved };
    });
    this.payments.published(auth.tenantId, b.loanId, b.amount, out.posted);
    this.publish(auth.tenantId, id, b.clientId, 'approved');
    return { ...out.posted.body, intakeId: id, senderSaved: out.senderSaved };
  }

  /** Aprobación en lote de lo que no tiene alertas bloqueantes (p. ej. en modo «Aprobación previa»). */
  async approveBatch(auth: AuthContext, ids: string[]) {
    const approved: string[] = [];
    const skipped: { id: string; reason: string }[] = [];
    for (const id of [...new Set(ids)].slice(0, 100)) {
      try {
        const it = await this.get(auth, id);
        const f = it.extraction as Record<string, { value: any }>;
        const blocking = (it.flags as Flag[]).filter((x) => x.severity === 'blocking');
        if (!['review'].includes(it.status) || !it.clientId || !it.loanId || f.amount?.value == null || !f.date?.value || blocking.length) {
          skipped.push({ id, reason: blocking[0]?.code ?? (it.status === 'review' ? 'INCOMPLETE' : 'INTAKE_NOT_PENDING') });
          continue;
        }
        await this.approve(auth, id, { clientId: it.clientId, loanId: it.loanId, amount: f.amount.value, date: f.date.value });
        approved.push(id);
      } catch (e) {
        skipped.push({ id, reason: e instanceof Problem ? e.code : 'ERROR' });
      }
    }
    return { approved, skipped };
  }

  async reject(auth: AuthContext, id: string, reason: string) {
    if (!reason?.trim()) throw new Problem(422, 'VALIDATION_FAILED', {}, [{ field: 'reason', message: 'required' }]);
    return this.close(auth, id, 'rejected', 'RECHAZADO', reason.trim());
  }

  /** «No es comprobante»: se archiva en Otros documentos del cliente (§13.1). */
  async archive(auth: AuthContext, id: string) {
    return this.close(auth, id, 'archived', 'NO_ES_COMPROBANTE', null);
  }

  private async close(auth: AuthContext, id: string, status: 'rejected' | 'archived', stage: string, reason: string | null) {
    const out = await this.db.tx(this.ctx(auth), async (tx) => {
      const r = await this.load(tx, auth, id, true);
      if (!PENDING.includes(r.status) && !(status === 'archived' && r.status === 'duplicate')) throw new Problem(409, 'INTAKE_NOT_PENDING');
      await tx.exec('UPDATE intake_events SET status = $2::intake_status, stage = $3, reason = $4, decided_by = $5, decided_at = now(), decision = $2::text WHERE id = $1', [id, status, stage, reason, auth.userId]);
      if (status === 'archived') await tx.exec("UPDATE documents SET kind = 'other' WHERE id = $1", [r.document_id]);
      if (status === 'rejected') await tx.exec("UPDATE documents SET tags = array_append(array_remove(tags, 'rechazado'), 'rechazado') WHERE id = $1", [r.document_id]);
      await this.audit.log(tx, `intake.${status}`, 'intake', id, { after: { reason } });
      return this.json({ ...(await tx.one<Record<string, any>>(`${this.select} WHERE i.id = $1`, [id]))! });
    });
    this.publish(auth.tenantId, id, out.clientId, status);
    return out;
  }

  /** Reversión con un toque de un registro automático dentro del plazo (§13.5); vuelve a revisión. */
  async revert(auth: AuthContext, id: string, reason?: string) {
    const out = await this.db.tx(this.ctx(auth), async (tx) => {
      const r = await this.load(tx, auth, id, true);
      if (r.status !== 'applied_auto' || !r.entry_id) throw new Problem(409, 'INTAKE_NOT_REVERTIBLE');
      if (!r.revertible_until || new Date(r.revertible_until) < this.clock.now()) throw new Problem(409, 'INTAKE_REVERT_EXPIRED', { hours: Number((await this.tenants.get(auth.tenantId)).settings.autoRevertHours ?? 72) });
      const why = reason?.trim() || 'Registro automático revertido desde la Bandeja';
      const rev = await this.payments.reverseTx(tx, auth, r.loan_id, r.entry_id, why);
      await tx.exec("UPDATE intake_events SET status = 'review', stage = 'EN_REVISIÓN', entry_id = NULL, revertible_until = NULL, reason = $2, decided_by = $3, decided_at = now(), decision = 'revert' WHERE id = $1", [id, why, auth.userId]);
      await this.audit.log(tx, 'intake.reverted', 'intake', id, { before: { entryId: r.entry_id }, after: { reversalId: rev.body.entry.id, reason: why } });
      return { rev, loanId: r.loan_id as string, entryId: r.entry_id as string, json: this.json((await tx.one<Record<string, any>>(`${this.select} WHERE i.id = $1`, [id]))!) };
    });
    this.payments.reversed(auth.tenantId, out.loanId, out.entryId, out.rev);
    this.publish(auth.tenantId, id, out.json.clientId, 'review');
    return out.json;
  }
}
