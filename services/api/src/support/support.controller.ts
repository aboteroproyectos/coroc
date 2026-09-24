import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import type { AuthContext } from '../common/context.js';
import { Auth, Op, Requires } from '../common/decorators.js';
import { Problem } from '../common/problem.js';
import { AccessService } from '../common/access.js';
import { DbService } from '../db/db.service.js';
import { taskJson } from '../documents/documents.controller.js';
import { DocumentTasks } from '../documents/tasks.js';

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);

/**
 * Soporte (§20.4, ADR-054): la cola de lo que falló (tareas de documentos, mensajes y comprobantes que no se pudieron
 * leer) en un solo lugar, con reintento, y la traza de un comprobante desde que llega hasta que su recibo sale.
 * Los errores son técnicos y no llevan datos personales.
 */
@Controller()
export class SupportController {
  constructor(private readonly db: DbService, private readonly tasks: DocumentTasks, private readonly access: AccessService) {}

  @Get('support/failures')
  @Requires('audit.view')
  @Op('listFailures')
  failures(@Auth() a: AuthContext, @Query() q: { days?: number }) {
    const days = Math.min(90, Math.max(1, Number(q.days ?? 30)));
    return this.db.tx({ tenantId: a.tenantId, userId: a.userId, role: a.role }, async (tx) => {
      const tasks = await tx.many<Record<string, any>>(
        `SELECT t.*, l.contract FROM document_tasks t LEFT JOIN loans l ON l.id = t.loan_id
          WHERE t.status = 'failed' AND t.created_at > now() - make_interval(days => $1) ORDER BY t.finished_at DESC NULLS LAST LIMIT 200`,
        [days],
      );
      const messages = await tx.many<Record<string, any>>(
        `SELECT m.id, m.client_id, c.first_name || ' ' || c.last_name AS client_name, m.event, m.channel, m.error, m.attempts, m.failed_at
           FROM messages m JOIN clients c ON c.id = m.client_id
          WHERE m.status = 'failed' AND m.failed_at > now() - make_interval(days => $1) ORDER BY m.failed_at DESC LIMIT 200`,
        [days],
      );
      const intake = await tx.many<Record<string, any>>(
        `SELECT id, channel, file_name, error, created_at FROM intake_events
          WHERE status = 'failed' AND created_at > now() - make_interval(days => $1) ORDER BY created_at DESC LIMIT 200`,
        [days],
      );
      return {
        days,
        documentTasks: tasks.map((r) => ({ ...taskJson(r), loanId: r.loan_id ?? null, contract: r.contract ?? null, attempts: r.attempts, detail: r.error ?? null, retryable: r.kind !== 'backup' })),
        messages: messages.map((r) => ({ id: r.id, clientId: r.client_id, clientName: r.client_name, event: r.event, channel: r.channel, attempts: r.attempts, detail: r.error ?? null, failedAt: iso(r.failed_at) })),
        intake: intake.map((r) => ({ id: r.id, channel: r.channel, fileName: r.file_name ?? null, detail: r.error ?? null, createdAt: iso(r.created_at) })),
      };
    });
  }

  /** Reintenta una tarea fallida desde cero. Un respaldo no se reintenta: su clave derivada ya se borró. */
  @Post('tasks/:id/retry')
  @HttpCode(202)
  @Requires('documents.upload')
  @Op('retryTask')
  async retry(@Auth() a: AuthContext, @Param('id') id: string) {
    const row = await this.db.tx({ tenantId: a.tenantId, userId: a.userId, role: a.role }, async (tx) => {
      const t = await tx.one<Record<string, any>>('SELECT * FROM document_tasks WHERE id = $1 FOR UPDATE', [id]);
      if (!t) throw Problem.notFound();
      if (t.status !== 'failed' || t.kind === 'backup') throw new Problem(409, 'TASK_NOT_RETRYABLE');
      return tx.one<Record<string, any>>(
        `UPDATE document_tasks SET status = 'pending', attempts = 0, error = NULL, progress = 0, run_after = now(), locked_until = NULL, finished_at = NULL
          WHERE id = $1 RETURNING *`,
        [id],
      );
    });
    this.tasks.kick();
    return taskJson(row!);
  }

  /** Traza de un comprobante (§21: comprobante→pago): cada etapa con su hora, hasta el recibo entregado. */
  @Get('intake/:id/trace')
  @Requires('intake.view')
  @Op('traceIntake')
  trace(@Auth() a: AuthContext, @Param('id') id: string) {
    return this.db.tx({ tenantId: a.tenantId, userId: a.userId, role: a.role }, async (tx) => {
      const e = await tx.one<Record<string, any>>('SELECT * FROM intake_events WHERE id = $1', [id]);
      if (!e) {
        // Igual que en la Bandeja: el comprobante de un cliente ajeno se registra como acceso denegado (CA-16).
        const other = a.role === 'collector' ? await this.db.tx({ tenantId: a.tenantId }, (t2) => t2.one<{ client_id: string | null }>('SELECT client_id FROM intake_events WHERE id = $1', [id])) : null;
        if (other?.client_id) return this.access.deny(tx, a, 'client', other.client_id);
        throw Problem.notFound();
      }
      type Step = { step: string; at: string | null; status: 'done' | 'pending' | 'failed' | 'skipped'; detail: string | null };
      const steps: Step[] = [{ step: 'received', at: iso(e.created_at), status: 'done', detail: e.channel }];
      const finalStatus = e.status as string;
      const failed = finalStatus === 'failed';
      steps.push({ step: 'read', at: e.reading ? iso(e.updated_at) : null, status: e.reading ? 'done' : failed ? 'failed' : 'pending', detail: e.reading?.method ?? (failed ? e.error ?? null : null) });
      steps.push({ step: 'identified', at: e.identification ? iso(e.updated_at) : null, status: e.identification?.via ? 'done' : e.reading ? 'pending' : 'skipped', detail: e.identification?.via ?? null });
      const decided = e.decision ? 'done' : ['review', 'unassigned'].includes(finalStatus) ? 'pending' : failed ? 'skipped' : 'pending';
      steps.push({ step: 'decided', at: iso(e.decided_at) ?? (e.decision ? iso(e.updated_at) : null), status: decided, detail: e.decision ?? finalStatus });
      let entry: Record<string, any> | null = null;
      if (e.entry_id) entry = await tx.one<Record<string, any>>('SELECT id, recorded_at AS created_at FROM ledger_entries WHERE id = $1', [e.entry_id]);
      steps.push({ step: 'payment', at: iso(entry?.created_at), status: entry ? 'done' : decided === 'done' ? 'skipped' : 'pending', detail: null });
      const receipt = entry ? await tx.one<Record<string, any>>("SELECT status, finished_at, error FROM document_tasks WHERE entry_id = $1 AND kind = 'receipt' ORDER BY created_at DESC LIMIT 1", [entry.id]) : null;
      steps.push({ step: 'receipt', at: iso(receipt?.finished_at), status: !entry ? 'skipped' : receipt?.status === 'done' ? 'done' : receipt?.status === 'failed' ? 'failed' : 'pending', detail: receipt?.status === 'failed' ? receipt.error ?? null : null });
      const msg = entry ? await tx.one<Record<string, any>>("SELECT status, channel, via, sent_at, failed_at, error FROM messages WHERE entry_id = $1 AND event = 'receipt' ORDER BY created_at DESC LIMIT 1", [entry.id]) : null;
      const sent = msg && ['sent', 'delivered', 'read'].includes(msg.status);
      steps.push({
        step: 'delivered',
        at: iso(msg?.sent_at ?? msg?.failed_at),
        status: !entry || !msg ? 'skipped' : sent ? 'done' : msg.status === 'failed' ? 'failed' : 'pending',
        detail: msg ? `${msg.channel}${msg.via ? `/${msg.via}` : ''}:${msg.status}` : null,
      });
      const start = new Date(e.created_at).getTime();
      return {
        intakeId: e.id,
        status: finalStatus,
        steps,
        paymentSeconds: entry ? Math.max(0, Math.round((new Date(entry.created_at).getTime() - start) / 1000)) : null,
        deliveredSeconds: sent ? Math.max(0, Math.round((new Date(msg!.sent_at).getTime() - start) / 1000)) : null,
      };
    });
  }
}
