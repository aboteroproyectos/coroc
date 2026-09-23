import { Injectable, OnModuleInit } from '@nestjs/common';
import { addDays, CURRENCIES, documentFileName, fromMinor, isoWeekday, LOCALE_OF, type Currency } from '@coroc/core';
import ExcelJS from 'exceljs';
import { AuditService } from '../audit/audit.service.js';
import { Clock } from '../common/clock.js';
import type { AuthContext } from '../common/context.js';
import { t, type Lang } from '../common/i18n.js';
import { Problem } from '../common/problem.js';
import { TenantCache, type TenantInfo } from '../company/tenant-cache.js';
import { DbService, type Tx } from '../db/db.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { companyOf } from '../documents/factory.js';
import { DocumentTasks, type TaskRow } from '../documents/tasks.js';
import { LoanStateService } from '../loans/loan-state.service.js';
import { PdfRenderer } from '../pdf/renderer.js';
import { footerTemplate, longDate, money, reportHtml, shortDate } from '../pdf/templates.js';

export const REPORT_TYPES = ['portfolio', 'portfolio_by_collector', 'collections', 'aging', 'closed', 'cashflow', 'ledger', 'messages'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export interface ReportRequest {
  type: ReportType;
  format: 'pdf' | 'xlsx' | 'csv';
  lang?: Lang;
  from?: string;
  to?: string;
  collectorId?: string;
  currency?: Currency;
}

/** Celda tipada: el PDF la muestra con el formato del idioma y el XLSX/CSV la guarda como número o fecha. */
type Cell = { k: 'text'; v: string } | { k: 'money'; v: number } | { k: 'int'; v: number } | { k: 'date'; v: string | null };
const tx_ = (v: string | null | undefined): Cell => ({ k: 'text', v: v ?? '' });
const mn = (v: number): Cell => ({ k: 'money', v });
const int = (v: number): Cell => ({ k: 'int', v });
const dt = (v: string | null | undefined): Cell => ({ k: 'date', v: v ?? null });

interface Column {
  key: string;
  align?: 'right';
  width?: number;
}

interface Built {
  title: string;
  subtitle: string;
  columns: Column[];
  rows: Cell[][];
  totals?: (Cell | null)[] | null;
}

/**
 * Informes (§18) en PDF, XLSX o CSV y en el idioma elegido. Cada informe lleva logo, fecha de corte, filtros y
 * paginación; los montos se muestran en una sola moneda (nunca se suman monedas distintas, §17). Se generan como
 * tarea en segundo plano y quedan en el repositorio, en la carpeta `_Informes`.
 */
@Injectable()
export class ReportsService implements OnModuleInit {
  constructor(
    private readonly db: DbService,
    private readonly tasks: DocumentTasks,
    private readonly docs: DocumentsService,
    private readonly state: LoanStateService,
    private readonly tenants: TenantCache,
    private readonly pdf: PdfRenderer,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.tasks.register('report', (task, progress) => this.run(task, progress));
  }

  async request(auth: AuthContext, r: ReportRequest) {
    const tenant = await this.tenants.get(auth.tenantId);
    if (r.from && r.to && r.from > r.to) throw new Problem(422, 'VALIDATION_FAILED', {}, [{ field: 'to', message: 'other' }]);
    const params = { ...r, lang: r.lang ?? auth.lang, currency: r.currency ?? tenant.currency };
    const row = await this.db.tx({ tenantId: auth.tenantId, userId: auth.userId, role: auth.role }, async (tx) => {
      if (r.collectorId && !(await tx.one("SELECT 1 FROM users WHERE id = $1 AND role = 'collector'", [r.collectorId]))) {
        throw new Problem(422, 'VALIDATION_FAILED', {}, [{ field: 'collectorId', message: 'enum' }]);
      }
      const id = await this.tasks.enqueue(tx, { kind: 'report', params, createdBy: auth.userId });
      await this.audit.log(tx, 'report.requested', 'report', id, { after: params });
      return tx.one<Record<string, any>>('SELECT * FROM document_tasks WHERE id = $1', [id]);
    });
    this.tasks.kick();
    return row!;
  }

  private async run(task: TaskRow, progress: (p: number) => Promise<void>): Promise<string> {
    const p = task.params as ReportRequest & { lang: Lang; currency: Currency };
    const tenant = await this.tenants.get(task.tenant_id);
    const today = this.clock.today(tenant.timezone);
    const stamp = this.clock.localStamp(tenant.timezone);
    const L = p.lang;
    const built = await this.db.tx({ tenantId: task.tenant_id }, async (tx) => {
      const collector = p.collectorId ? (await tx.one<{ name: string }>('SELECT name FROM users WHERE id = $1', [p.collectorId]))?.name ?? '' : '';
      const filters = [
        t(L, 'doc.report.byCurrency', { currency: p.currency }),
        `${t(L, 'doc.common.collector')}: ${collector || t(L, 'doc.common.allCollectors')}`,
        ...(p.from || p.to ? [`${t(L, 'doc.common.period')}: ${p.from ? shortDate(p.from, L) : '…'} – ${p.to ? shortDate(p.to, L) : '…'}`] : []),
      ];
      const b = await this.build(tx, tenant, p, today, progress);
      return { ...b, filters };
    });
    await progress(80);
    const label = t(L, `doc.report.${p.type}`);
    const body = p.format === 'pdf' ? await this.toPdf(built, tenant, L, p.currency, stamp) : p.format === 'xlsx' ? await this.toXlsx(built, tenant, L, p.currency, stamp) : this.toCsv(built, L, p.currency);
    const mime = { pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv' }[p.format];
    const doc = await this.db.tx({ tenantId: task.tenant_id, userId: task.created_by }, async (tx) => {
      const d = await this.docs.save(tx, tenant.id, {
        clientId: null, loanId: null, kind: 'report', name: `${label} · ${longDate(today, L)}`,
        fileName: documentFileName(tenant.lang, { stamp, kind: 'report', label, ext: p.format }), mime, body, source: 'system', lang: L,
        meta: { type: p.type, format: p.format, from: p.from ?? null, to: p.to ?? null, collectorId: p.collectorId ?? null, currency: p.currency, rows: built.rows.length },
        tags: [p.type.replace(/_/g, '-')], createdBy: task.created_by,
      });
      await this.audit.log(tx, 'report.generated', 'report', task.id, { after: { type: p.type, format: p.format, documentId: d.id, rows: built.rows.length } }, task.created_by);
      return d;
    });
    return doc.id;
  }

  // ─────────────────────────── Datos de cada informe ───────────────────────────
  private async build(tx: Tx, tenant: TenantInfo, p: ReportRequest & { lang: Lang; currency: Currency }, today: string, progress: (n: number) => Promise<void>): Promise<Built> {
    const L = p.lang;
    const cutoff = `${t(L, 'doc.common.cutoff')} ${longDate(today, L)}`;
    const col = (key: string, align?: 'right', width?: number): Column => ({ key, align, width });
    const statusOf = (bucket: string) => t(L, `doc.loanStatus.${bucket === 'closed' ? 'closed' : bucket === 'current' ? 'current' : 'overdue'}`);
    const byCollector = p.collectorId ? 'AND c.collector_id = $2' : '';
    const args = (...extra: unknown[]) => [p.currency, ...(p.collectorId ? [p.collectorId] : []), ...extra];
    const n = p.collectorId ? 3 : 2;

    if (p.type === 'portfolio' || p.type === 'portfolio_by_collector') {
      const rows = await tx.many<Record<string, any>>(
        `SELECT c.first_name || ' ' || c.last_name AS client, c.code, l.contract, l.frequency, l.principal, l.total_payable, s.paid_total, s.balance,
                s.remaining_installments, s.next_due_date, s.days_past_due, s.bucket, coalesce(u.name, '') AS collector
           FROM loans l JOIN clients c ON c.id = l.client_id JOIN loan_state s ON s.loan_id = l.id LEFT JOIN users u ON u.id = c.collector_id
          WHERE l.currency = $1 AND l.status = 'active' ${byCollector}
          ORDER BY ${p.type === 'portfolio_by_collector' ? 'coalesce(u.name, \'\'), ' : ''}s.days_past_due DESC, c.sort_name`,
        args(),
      );
      const withCollector = p.type === 'portfolio_by_collector';
      const sum = (k: string) => rows.reduce((a, r) => a + Number(r[k]), 0);
      return {
        title: t(L, `doc.report.${p.type}`),
        subtitle: `${cutoff} · ${t(L, 'doc.report.loans', { n: rows.length })} · ${t(L, 'doc.report.totalBalance', { total: money(sum('balance'), p.currency, L) })}`,
        columns: [col('colClient', undefined, 20), col('colCode'), col('colContract'), ...(withCollector ? [col('colCollector')] : []), col('colFrequency'), col('colPrincipal', 'right'), col('colTotal', 'right'),
          col('colPaid', 'right'), col('colBalance', 'right'), col('colRemaining', 'right'), col('colNext'), col('colDpd', 'right'), col('colStatus')],
        rows: rows.map((r) => [tx_(r.client), tx_(r.code), tx_(r.contract), ...(withCollector ? [tx_(r.collector || t(L, 'doc.common.unassigned'))] : []), tx_(t(L, `doc.freq.${r.frequency}`)),
          mn(Number(r.principal)), mn(Number(r.total_payable)), mn(Number(r.paid_total)), mn(Number(r.balance)), int(r.remaining_installments), dt(r.next_due_date), int(r.days_past_due), tx_(statusOf(r.bucket))]),
        totals: [tx_(t(L, 'doc.common.total')), null, null, ...(withCollector ? [null] : []), null, mn(sum('principal')), mn(sum('total_payable')), mn(sum('paid_total')), mn(sum('balance')), null, null, null, null],
      };
    }

    if (p.type === 'collections' || p.type === 'ledger') {
      const from = p.from ?? addDays(today, -30);
      const to = p.to ?? today;
      const types = p.type === 'collections' ? "AND e.type = 'payment'" : '';
      const rows = await tx.many<Record<string, any>>(
        `SELECT e.id, e.type, e.entry_date, e.recorded_at, e.amount, e.method, e.institution, e.reference, e.reason, e.source, e.auto,
                l.contract, c.first_name || ' ' || c.last_name AS client, rc.number AS receipt, u.name AS user_name,
                EXISTS (SELECT 1 FROM ledger_entries r WHERE r.reverses_id = e.id) AS reversed
           FROM ledger_entries e JOIN loans l ON l.id = e.loan_id JOIN clients c ON c.id = l.client_id
           LEFT JOIN receipts rc ON rc.entry_id = e.id LEFT JOIN users u ON u.id = e.created_by
          WHERE l.currency = $1 ${byCollector} AND e.entry_date BETWEEN $${n} AND $${n + 1} ${types}
          ORDER BY e.entry_date, e.recorded_at`,
        args(from, to),
      );
      const period = `${longDate(from, L)} – ${longDate(to, L)}`;
      if (p.type === 'collections') {
        const valid = rows.filter((r) => !r.reversed);
        const total = valid.reduce((a, r) => a + Number(r.amount), 0);
        return {
          title: t(L, 'doc.report.collections'),
          subtitle: `${period} · ${t(L, 'doc.report.totalCollected', { total: money(total, p.currency, L) })}`,
          columns: [col('colDate'), col('colClient', undefined, 24), col('colContract'), col('colReceipt'), col('colMethod'), col('colReference'), col('colStatus'), col('colAmount', 'right')],
          rows: rows.map((r) => [dt(r.entry_date), tx_(r.client), tx_(r.contract), tx_(r.receipt), tx_(r.method || r.institution || t(L, r.source === 'cash' ? 'doc.statement.cash' : 'doc.statement.manual')),
            tx_(r.reference), tx_(t(L, r.reversed ? 'doc.statement.reversed' : 'doc.statement.applied')), mn(Number(r.amount))]),
          totals: [tx_(t(L, 'doc.common.total')), null, null, null, null, null, null, mn(total)],
        };
      }
      return {
        title: t(L, 'doc.report.ledger'),
        subtitle: `${period} · ${rows.length}`,
        columns: [col('colRecorded'), col('colDate'), col('colType'), col('colContract'), col('colClient', undefined, 20), col('colAmount', 'right'), col('colReceipt'), col('colReference'), col('colReason'), col('colUser')],
        rows: rows.map((r) => [tx_(new Date(r.recorded_at).toISOString()), dt(r.entry_date), tx_(t(L, `doc.report.entry.${r.type}`)), tx_(r.contract), tx_(r.client), mn(Number(r.amount)),
          tx_(r.receipt), tx_(r.reference), tx_(r.reason), tx_(r.user_name)]),
      };
    }

    if (p.type === 'aging') {
      const rows = await tx.many<Record<string, any>>(
        `SELECT c.first_name || ' ' || c.last_name AS client, l.contract, s.days_past_due, s.overdue_amount, s.balance, s.bucket
           FROM loans l JOIN clients c ON c.id = l.client_id JOIN loan_state s ON s.loan_id = l.id
          WHERE l.currency = $1 ${byCollector} AND s.days_past_due > 0 AND s.bucket <> 'closed'
          ORDER BY s.days_past_due DESC, c.sort_name`,
        args(),
      );
      const bucket = (d: number) => (d <= 7 ? '1–7' : d <= 30 ? '8–30' : '> 30');
      const overdue = rows.reduce((a, r) => a + Number(r.overdue_amount), 0);
      const balance = rows.reduce((a, r) => a + Number(r.balance), 0);
      return {
        title: t(L, 'doc.report.aging'),
        subtitle: `${cutoff} · ${t(L, 'doc.report.loans', { n: rows.length })}`,
        columns: [col('colBucket'), col('colClient', undefined, 30), col('colContract'), col('colDpd', 'right'), col('colAmount', 'right'), col('colBalance', 'right')],
        rows: rows.map((r) => [tx_(bucket(r.days_past_due)), tx_(r.client), tx_(r.contract), int(r.days_past_due), mn(Number(r.overdue_amount)), mn(Number(r.balance))]),
        totals: [tx_(t(L, 'doc.common.total')), null, null, null, mn(overdue), mn(balance)],
      };
    }

    if (p.type === 'closed') {
      const rows = await tx.many<Record<string, any>>(
        `SELECT c.first_name || ' ' || c.last_name AS client, l.contract, l.principal, s.paid_total, (l.closed_at AT TIME ZONE $${n})::date AS closed_on
           FROM loans l JOIN clients c ON c.id = l.client_id JOIN loan_state s ON s.loan_id = l.id
          WHERE l.currency = $1 ${byCollector} AND l.status = 'closed'
            AND ($${n + 1}::date IS NULL OR (l.closed_at AT TIME ZONE $${n})::date >= $${n + 1}) AND ($${n + 2}::date IS NULL OR (l.closed_at AT TIME ZONE $${n})::date <= $${n + 2})
          ORDER BY l.closed_at`,
        args(tenant.timezone, p.from ?? null, p.to ?? null),
      );
      const profit = rows.reduce((a, r) => a + Number(r.paid_total) - Number(r.principal), 0);
      return {
        title: t(L, 'doc.report.closed'),
        subtitle: `${t(L, 'doc.report.loans', { n: rows.length })} · ${t(L, 'doc.report.totalProfit', { total: money(profit, p.currency, L) })}`,
        columns: [col('colClient', undefined, 30), col('colContract'), col('colClosedAt'), col('colPrincipal', 'right'), col('colPaid', 'right'), col('colProfit', 'right')],
        rows: rows.map((r) => [tx_(r.client), tx_(r.contract), dt(r.closed_on), mn(Number(r.principal)), mn(Number(r.paid_total)), mn(Number(r.paid_total) - Number(r.principal))]),
        totals: [tx_(t(L, 'doc.common.total')), null, null, mn(rows.reduce((a, r) => a + Number(r.principal), 0)), mn(rows.reduce((a, r) => a + Number(r.paid_total), 0)), mn(profit)],
      };
    }

    if (p.type === 'cashflow') {
      // Saldo pendiente de cada cuota según el libro (ADR-003), agrupado en las próximas 8 semanas (lunes a domingo).
      const WEEKS = 8;
      const start = addDays(today, 1 - isoWeekday(today));
      const weeks = Array.from({ length: WEEKS }, (_, w) => ({ from: addDays(start, w * 7), to: addDays(start, w * 7 + 6), amount: 0, n: 0 }));
      let overdue = 0;
      const ids = (await tx.many<{ id: string }>(`SELECT l.id FROM loans l JOIN clients c ON c.id = l.client_id WHERE l.currency = $1 ${byCollector} AND l.status = 'active' ORDER BY l.id`, args())).map((r) => r.id);
      for (let i = 0; i < ids.length; i += 500) {
        for (const l of await this.state.loadMany(tx, ids.slice(i, i + 500))) {
          for (const s of this.state.replay(l, today).states) {
            const out = s.amount - s.paid;
            if (out <= 0) continue;
            if (s.dueDate < today) overdue += out;
            const wk = weeks.find((w) => s.dueDate >= w.from && s.dueDate <= w.to && s.dueDate >= today);
            if (wk) {
              wk.amount += out;
              wk.n++;
            }
          }
        }
        await progress(10 + Math.round((60 * Math.min(ids.length, i + 500)) / Math.max(1, ids.length)));
      }
      const total = weeks.reduce((a, w) => a + w.amount, 0);
      return {
        title: t(L, 'doc.report.cashflow'),
        subtitle: `${t(L, 'doc.report.nextWeeks', { n: WEEKS })} · ${t(L, 'doc.report.overdueExcluded', { total: money(overdue, p.currency, L) })}`,
        columns: [col('colWeek', 'right'), col('colFrom'), col('colTo'), col('colCount', 'right'), col('colExpected', 'right')],
        rows: weeks.map((w, i) => [int(i + 1), dt(w.from), dt(w.to), int(w.n), mn(w.amount)]),
        totals: [tx_(t(L, 'doc.common.total')), null, null, int(weeks.reduce((a, w) => a + w.n, 0)), mn(total)],
      };
    }

    // messages: bitácora de mensajes y de cumplimiento (§11.4). Se llena a partir de la Fase 4.
    const from = p.from ?? addDays(today, -30);
    const to = p.to ?? today;
    const rows = await tx.many<Record<string, any>>(
      `SELECT m.created_at, m.event, m.kind, m.channel, m.status, m.decision->>'decision' AS decision, m.scheduled_at, m.sent_at, c.first_name || ' ' || c.last_name AS client
         FROM messages m JOIN clients c ON c.id = m.client_id
        WHERE ($1::text IS NOT NULL) ${byCollector} AND (m.created_at AT TIME ZONE $${n})::date BETWEEN $${n + 1} AND $${n + 2}
        ORDER BY m.created_at`,
      args(tenant.timezone, from, to),
    );
    return {
      title: t(L, 'doc.report.messages'),
      subtitle: `${longDate(from, L)} – ${longDate(to, L)} · ${rows.length}`,
      columns: [col('colRecorded'), col('colClient', undefined, 22), col('colEvent'), col('colKind'), col('colChannel'), col('colStatus'), col('colDecision'), col('colScheduled'), col('colSent')],
      rows: rows.map((r) => [tx_(new Date(r.created_at).toISOString()), tx_(r.client), tx_(r.event), tx_(t(L, r.kind === 'collection' ? 'doc.report.kindCollection' : 'doc.report.kindTransactional')),
        tx_(r.channel), tx_(r.status), tx_(r.decision), tx_(r.scheduled_at ? new Date(r.scheduled_at).toISOString() : ''), tx_(r.sent_at ? new Date(r.sent_at).toISOString() : '')]),
    };
  }

  // ─────────────────────────── Formatos ───────────────────────────
  private header = (L: Lang, c: Column) => t(L, `doc.report.${c.key}`);

  private display(c: Cell | null, L: Lang, currency: Currency): string {
    if (!c) return '';
    switch (c.k) {
      case 'money':
        return money(c.v, currency, L);
      case 'int':
        return new Intl.NumberFormat(LOCALE_OF[L]).format(c.v);
      case 'date':
        return shortDate(c.v, L);
      default:
        return c.v;
    }
  }

  private async toPdf(b: Built & { filters: string[] }, tenant: TenantInfo, L: Lang, currency: Currency, stamp: string): Promise<Buffer> {
    const html = reportHtml({
      lang: L, company: companyOf(tenant), title: b.title, subtitle: b.subtitle, filters: b.filters,
      columns: b.columns.map((c) => ({ header: this.header(L, c), align: c.align, width: c.width })),
      rows: b.rows.map((r) => r.map((c) => this.display(c, L, currency))),
      totals: b.totals ? b.totals.map((c) => this.display(c, L, currency)) : null,
    });
    return this.pdf.render(html, { footer: footerTemplate(L, stamp) });
  }

  private async toXlsx(b: Built & { filters: string[] }, tenant: TenantInfo, L: Lang, currency: Currency, stamp: string): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'COROC';
    wb.created = new Date();
    const ws = wb.addWorksheet(b.title.slice(0, 31), { views: [{ state: 'frozen', ySplit: 6 }] });
    const digits = CURRENCIES[currency].minorDigits;
    const moneyFmt = digits ? `#,##0.${'0'.repeat(digits)} "${currency}"` : `#,##0 "${currency}"`;
    ws.addRow([tenant.name]).font = { bold: true, size: 13, color: { argb: 'FF130E42' } };
    ws.addRow([b.title]).font = { bold: true, size: 12, color: { argb: 'FF130E42' } };
    ws.addRow([b.subtitle]).font = { color: { argb: 'FF5B5878' } };
    ws.addRow([b.filters.join(' · ')]).font = { color: { argb: 'FF5B5878' }, size: 9 };
    ws.addRow([`${t(L, 'doc.common.generatedBy')} · ${stamp}`]).font = { color: { argb: 'FF5B5878' }, size: 9 };
    const head = ws.addRow(b.columns.map((c) => this.header(L, c)));
    head.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFDE7' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF130E42' } };
      cell.alignment = { vertical: 'middle' };
    });
    const put = (cells: (Cell | null)[], bold = false) => {
      const row = ws.addRow(cells.map((c) => (!c ? null : c.k === 'money' ? fromMinor(c.v, currency).toNumber() : c.k === 'date' ? (c.v ? new Date(`${c.v}T00:00:00Z`) : null) : c.v)));
      cells.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        if (c?.k === 'money') cell.numFmt = moneyFmt;
        if (c?.k === 'date') cell.numFmt = L === 'en' ? 'mm/dd/yyyy' : 'dd/mm/yyyy';
        if (bold) cell.font = { bold: true };
      });
    };
    for (const r of b.rows) put(r);
    if (b.totals) put(b.totals, true);
    ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6, column: b.columns.length } };
    b.columns.forEach((c, i) => {
      const values = [this.header(L, c), ...b.rows.slice(0, 500).map((r) => this.display(r[i] ?? null, L, currency))];
      ws.getColumn(i + 1).width = Math.min(48, Math.max(10, ...values.map((v) => v.length + 2)));
    });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /** CSV con BOM para Excel: «;» y coma decimal en español y portugués, «,» y punto decimal en inglés. */
  private toCsv(b: Built, L: Lang, currency: Currency): Buffer {
    const sep = L === 'en' ? ',' : ';';
    const dec = L === 'en' ? '.' : ',';
    const digits = CURRENCIES[currency].minorDigits;
    const q = (s: string) => (/[";,\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    // Evita que una celda que empieza con = + - @ se interprete como fórmula al abrir el archivo (inyección CSV).
    const safe = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);
    const val = (c: Cell | null) => {
      if (!c) return '';
      if (c.k === 'money') return fromMinor(c.v, currency).toFixed(digits).replace('.', dec);
      if (c.k === 'int') return String(c.v);
      if (c.k === 'date') return c.v ?? '';
      return q(safe(c.v));
    };
    const lines = [b.columns.map((c) => q(this.header(L, c))).join(sep), ...b.rows.map((r) => r.map(val).join(sep))];
    if (b.totals) lines.push(b.totals.map(val).join(sep));
    return Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8');
  }
}
