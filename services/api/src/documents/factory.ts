import { Injectable, OnModuleInit } from '@nestjs/common';
import { documentFileName, RECEIPT_TEXT, type ReceiptData } from '@coroc/core';
import { Clock } from '../common/clock.js';
import { t, type Lang } from '../common/i18n.js';
import { TenantCache, type TenantInfo } from '../company/tenant-cache.js';
import { EventBus } from '../dashboard/event-bus.js';
import { DbService, type Tx } from '../db/db.service.js';
import { LoanStateService, type LoadedLoan } from '../loans/loan-state.service.js';
import { PdfRenderer } from '../pdf/renderer.js';
import { footerTemplate, payoffHtml, planHtml, receiptHtml, statementHtml, type Company } from '../pdf/templates.js';
import { DocumentsService } from './documents.service.js';
import { DocumentTasks, type TaskRow } from './tasks.js';

export const companyOf = (t: TenantInfo): Company => ({ name: t.name, taxId: t.taxId, phone: t.phone, email: t.email, address: t.address, city: t.city });

/**
 * Documentos del préstamo (§8.3, §10, §15, §16.4): plan de pagos versionado, recibo y su anulación, estado de cuenta y
 * paz y salvo. Siempre en el idioma del deudor (§6) y con los saldos derivados del libro en el momento de generarlos.
 */
@Injectable()
export class DocumentFactory implements OnModuleInit {
  constructor(
    private readonly db: DbService,
    private readonly tasks: DocumentTasks,
    private readonly docs: DocumentsService,
    private readonly state: LoanStateService,
    private readonly tenants: TenantCache,
    private readonly pdf: PdfRenderer,
    private readonly bus: EventBus,
    private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.tasks.register('schedule', (task) => this.schedule(task));
    this.tasks.register('receipt', (task) => this.receipt(task, false));
    this.tasks.register('receipt_void', (task) => this.receipt(task, true));
    this.tasks.register('statement', (task) => this.statement(task));
    this.tasks.register('payoff', (task) => this.payoff(task));
  }

  private async loan(tx: Tx, id: string) {
    const l = await this.state.load(tx, id);
    if (!l) throw new Error('Préstamo no encontrado');
    const client = (await tx.one<Record<string, any>>('SELECT * FROM clients WHERE id = $1', [l.loan.client_id]))!;
    return { l, client, lang: client.lang as Lang };
  }

  private published(tenantId: string, clientId: string, collectorId: string | null, documentId: string, kind: string): void {
    this.bus.publish({ type: 'document.created', tenantId, clientId, collectorId, data: { documentId, clientId, kind } });
  }

  private fullName = (c: Record<string, any>) => `${c.first_name} ${c.last_name}`;

  /** Contrato y plan de pagos: una versión nueva cada vez que cambia (§10), la anterior queda en el historial. */
  private async schedule(task: TaskRow): Promise<string> {
    const tenant = await this.tenants.get(task.tenant_id);
    const today = this.clock.today(tenant.timezone);
    const stamp = this.clock.localStamp(tenant.timezone);
    const out = await this.db.tx({ tenantId: task.tenant_id }, async (tx) => {
      const { l, client, lang } = await this.loan(tx, task.loan_id!);
      const r = this.state.replay(l, today);
      const key = `schedule:${l.loan.id}`;
      const version = ((await tx.one<{ v: number | null }>('SELECT max(version) AS v FROM documents WHERE version_key = $1', [key]))?.v ?? 0) + 1;
      const html = planHtml({
        lang, company: companyOf(tenant), client: { fullName: this.fullName(client), code: client.code, idDoc: [client.id_doc_type, client.id_doc_number].filter(Boolean).join(' ') || null },
        contract: l.loan.contract, currency: l.loan.currency, method: l.loan.method, rate: String(l.loan.rate), frequency: l.loan.frequency,
        installmentsCount: l.loan.installments_count, principal: l.loan.principal, totalInterest: l.plan.reduce((s, i) => s + i.interest, 0),
        totalPayable: l.loan.total_payable, effectiveAnnualRate: Number(l.loan.effective_annual_rate), disbursementDate: l.loan.disbursement_date,
        firstDueDate: l.loan.first_due_date, lateFee: l.loan.late_fee as any, paidTotal: r.summary.paidTotal, balance: r.summary.balance,
        remaining: r.summary.remainingInstallments, daysPastDue: r.summary.daysPastDue, version, stamp,
        rows: l.plan.map((p) => {
          const st = r.states.find((s) => s.number === p.number)!;
          return { number: p.number, dueDate: p.due_date, amount: p.amount, principal: p.principal, interest: p.interest, paid: st.paid, paidOn: st.lastPaymentDate, status: st.status, balanceAfter: p.balance_after };
        }),
      });
      const body = await this.pdf.render(html, { footer: footerTemplate(lang, stamp) });
      const doc = await this.docs.save(tx, tenant.id, {
        clientId: client.id, loanId: l.loan.id, kind: 'schedule', name: `${t(lang, 'doc.plan.title')} ${l.loan.contract}`,
        fileName: documentFileName(tenant.lang, { stamp, kind: 'schedule', contract: l.loan.contract, ext: 'pdf' }),
        mime: 'application/pdf', body, versionKey: key, source: 'system', lang, meta: { contract: l.loan.contract, version, balance: r.summary.balance },
      });
      return { doc, client };
    });
    this.published(task.tenant_id, out.client.id, out.client.collector_id, out.doc.id, 'schedule');
    return out.doc.id;
  }

  /** Recibo «Gracias por tu pago» y, tras un reverso, su versión sellada ANULADO (§15). Nunca se borra el original. */
  private async receipt(task: TaskRow, voidTask: boolean): Promise<string> {
    const tenant = await this.tenants.get(task.tenant_id);
    const stamp = this.clock.localStamp(tenant.timezone);
    const ctx = { tenantId: task.tenant_id };
    // El PDF se genera fuera de la transacción que bloquea: un render lento no retiene filas (ADR-057).
    const pre = await this.db.tx(ctx, (tx) => tx.one<Record<string, any>>('SELECT * FROM receipts WHERE entry_id = $1', [task.entry_id]));
    if (!pre) throw new Error('Recibo no encontrado');
    const render = async (voided: boolean) => this.pdf.render(await receiptHtml({ ...(pre.data as ReceiptData), voided }, companyOf(tenant)));
    let voided = !!pre.voided_at;
    let body = (!voidTask && pre.document_id) || (voidTask && pre.void_document_id) ? null : await render(voided);
    const out = await this.db.tx(ctx, async (tx) => {
      // Mismo orden de bloqueo que el registro y el reverso de pagos (préstamo → recibo): sin interbloqueos.
      await tx.exec('SELECT 1 FROM loans WHERE id = $1 FOR SHARE', [pre.loan_id]);
      const rc = await tx.one<Record<string, any>>('SELECT * FROM receipts WHERE entry_id = $1 FOR UPDATE', [task.entry_id]);
      if (!rc) throw new Error('Recibo no encontrado');
      const client = (await tx.one<Record<string, any>>('SELECT c.* FROM clients c JOIN loans l ON l.client_id = c.id WHERE l.id = $1', [rc.loan_id]))!;
      if (!voidTask && rc.document_id) return { id: rc.document_id as string, client, created: false };
      if (voidTask && rc.void_document_id) return { id: rc.void_document_id as string, client, created: false };
      // Si el pago se reversó mientras se generaba el PDF, se vuelve a generar con el sello ANULADO.
      if (!body || !!rc.voided_at !== voided) {
        voided = !!rc.voided_at;
        body = await render(voided);
      }
      const data = rc.data as ReceiptData;
      const lang = data.lang;
      const doc = await this.docs.save(tx, tenant.id, {
        clientId: client.id, loanId: rc.loan_id, kind: 'receipt_out', name: `${RECEIPT_TEXT[lang]!.receiptNo} ${rc.number}${voided ? ` · ${RECEIPT_TEXT[lang]!.void}` : ''}`,
        fileName: documentFileName(tenant.lang, { stamp, kind: 'receipt_out', number: rc.number, contract: data.contract, voided, ext: 'pdf' }),
        mime: 'application/pdf', body, versionKey: `receipt:${task.entry_id}`, source: 'system', lang,
        meta: { receiptNumber: rc.number, amount: data.payment.amount, paymentDate: data.payment.date, voided },
      });
      if (!rc.document_id) await tx.exec('UPDATE receipts SET document_id = $2 WHERE id = $1', [rc.id, doc.id]);
      if (voided) await tx.exec('UPDATE receipts SET void_document_id = $2 WHERE id = $1', [rc.id, doc.id]);
      return { id: doc.id as string, client, created: true };
    });
    if (out.created) this.published(task.tenant_id, out.client.id, out.client.collector_id, out.id, 'receipt_out');
    return out.id;
  }

  /** Estado de cuenta a la fecha (§16.4): bajo demanda, cada mes y al cerrar el préstamo. */
  private async statement(task: TaskRow): Promise<string> {
    const tenant = await this.tenants.get(task.tenant_id);
    const today = this.clock.today(tenant.timezone);
    const stamp = this.clock.localStamp(tenant.timezone);
    const out = await this.db.tx({ tenantId: task.tenant_id }, async (tx) => {
      const { l, client, lang } = await this.loan(tx, task.loan_id!);
      const r = this.state.replay(l, today);
      const receipts = new Map((await tx.many<{ entry_id: string; number: string }>('SELECT entry_id, number FROM receipts WHERE loan_id = $1', [l.loan.id])).map((x) => [x.entry_id, x.number]));
      const html = statementHtml({
        lang, company: companyOf(tenant), client: { fullName: this.fullName(client), code: client.code }, contract: l.loan.contract, currency: l.loan.currency, asOf: today,
        totalPayable: r.summary.totalPayable, paidTotal: r.summary.paidTotal, balance: r.summary.balance, remaining: r.summary.remainingInstallments,
        totalInstallments: r.summary.totalInstallments, next: r.summary.next ? { dueDate: r.summary.next.dueDate, outstanding: r.summary.next.outstanding } : null,
        daysPastDue: r.summary.daysPastDue, lateFeesOutstanding: r.summary.lateFeesOutstanding,
        overdueAmount: r.states.filter((s) => s.status === 'overdue' || (s.status === 'partial' && s.dueDate < today)).reduce((acc, s) => acc + s.amount - s.paid, 0), surplus: r.surplus,
        payments: l.ledger.filter((e) => e.type === 'payment').map((e) => ({
          date: e.entry_date, receipt: receipts.get(e.id) ?? '', reference: e.reference ?? '', amount: e.amount, reversed: !!e.reversed_by,
          method: e.method || e.institution || t(lang, e.source === 'cash' ? 'doc.statement.cash' : 'doc.statement.manual'),
        })),
        pending: r.states.filter((s) => s.paid < s.amount).map((s) => ({ number: s.number, dueDate: s.dueDate, outstanding: s.amount - s.paid, status: s.status })),
      });
      const body = await this.pdf.render(html, { footer: footerTemplate(lang, stamp) });
      const doc = await this.docs.save(tx, tenant.id, {
        clientId: client.id, loanId: l.loan.id, kind: 'statement', name: `${t(lang, 'doc.statement.title')} ${l.loan.contract} · ${today}`,
        fileName: documentFileName(tenant.lang, { stamp, kind: 'statement', contract: l.loan.contract, ext: 'pdf' }),
        mime: 'application/pdf', body, source: 'system', lang, createdBy: task.created_by,
        meta: { contract: l.loan.contract, asOf: today, reason: task.params.reason ?? 'on_demand', period: task.params.period ?? null, balance: r.summary.balance },
      });
      return { doc, client };
    });
    this.published(task.tenant_id, out.client.id, out.client.collector_id, out.doc.id, 'statement');
    return out.doc.id;
  }

  /** Paz y salvo al llegar el saldo a cero (§15); si un reverso reabre el préstamo, se emite su versión ANULADA. */
  private async payoff(task: TaskRow): Promise<string | null> {
    const tenant = await this.tenants.get(task.tenant_id);
    const today = this.clock.today(tenant.timezone);
    const stamp = this.clock.localStamp(tenant.timezone);
    const out = await this.db.tx({ tenantId: task.tenant_id }, async (tx) => {
      const { l, client, lang } = await this.loan(tx, task.loan_id!);
      const r = this.state.replay(l, today);
      const key = `payoff:${l.loan.id}`;
      const current = await tx.one<{ id: string; meta: Record<string, any> }>('SELECT id, meta FROM documents WHERE version_key = $1 AND NOT superseded', [key]);
      const voided = r.summary.balance > 0;
      // Solo se emite si cambia algo: paz y salvo con saldo cero, o su anulación si ya existía uno vigente.
      if (voided && (!current || current.meta.voided)) return null;
      if (!voided && current && !current.meta.voided) return { doc: { id: current.id }, client, created: false };
      const lastPayment = livePaymentDate(l);
      const html = payoffHtml({
        lang, company: companyOf(tenant), client: { fullName: this.fullName(client), idDocType: client.id_doc_type, idDocNumber: client.id_doc_number },
        contract: l.loan.contract, currency: l.loan.currency, totalPaid: r.summary.paidTotal || l.loan.total_payable, lastPaymentDate: lastPayment, issueDate: today, voided,
      });
      const body = await this.pdf.render(html, { footer: footerTemplate(lang, stamp) });
      const doc = await this.docs.save(tx, tenant.id, {
        clientId: client.id, loanId: l.loan.id, kind: 'payoff', name: `${t(lang, 'doc.payoff.title')} ${l.loan.contract}${voided ? ` · ${RECEIPT_TEXT[lang]!.void}` : ''}`,
        fileName: documentFileName(tenant.lang, { stamp, kind: 'payoff', contract: l.loan.contract, voided, ext: 'pdf' }),
        mime: 'application/pdf', body, versionKey: key, source: 'system', lang, meta: { contract: l.loan.contract, voided },
      });
      return { doc, client, created: true };
    });
    if (!out) return null;
    if (out.created) this.published(task.tenant_id, out.client.id, out.client.collector_id, out.doc.id, 'payoff');
    return out.doc.id;
  }
}

function livePaymentDate(l: LoadedLoan): string | null {
  const dates = l.ledger.filter((e) => e.type === 'payment' && !e.reversed_by).map((e) => e.entry_date).sort();
  return dates.at(-1) ?? null;
}
