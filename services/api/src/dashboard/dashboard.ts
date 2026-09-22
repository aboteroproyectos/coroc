import { Controller, Get, Injectable, MessageEvent, Query, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { addDays } from '@coroc/core';
import { Clock } from '../common/clock.js';
import type { AuthContext } from '../common/context.js';
import { Auth, Op, Requires } from '../common/decorators.js';
import { TenantCache } from '../company/tenant-cache.js';
import { DbService } from '../db/db.service.js';
import { LoanStateService } from '../loans/loan-state.service.js';
import { EventBus, type CorocEvent } from './event-bus.js';

/**
 * Indicadores del dashboard (§17) con definiciones contables exactas, calculados en SQL sobre el estado derivado
 * de cada préstamo (ADR-021). Nunca se suman monedas distintas: cada respuesta es de una sola moneda.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly db: DbService, private readonly state: LoanStateService, private readonly tenants: TenantCache, private readonly clock: Clock) {}

  async compute(auth: AuthContext, q: { currency?: string; collectorId?: string; days?: number }) {
    const tenant = await this.tenants.get(auth.tenantId);
    const today = this.clock.today(tenant.timezone);
    const days = Math.min(90, Math.max(7, q.days ?? 30));
    const from = addDays(today, -(days - 1));
    const ctx = { tenantId: auth.tenantId, userId: auth.userId, role: auth.role };
    const refreshing = await this.state.ensureFresh(ctx, today);
    return this.db.tx(ctx, async (tx) => {
      const currencies = (await tx.many<{ currency: string }>('SELECT DISTINCT currency FROM loan_state ORDER BY currency')).map((r) => r.currency);
      const currency = q.currency ?? (currencies.includes(tenant.currency) || !currencies.length ? tenant.currency : currencies[0]!);
      const coll = q.collectorId ?? null;
      // Filtro por cobrador solo cuando se pide; el Cobrador ya ve únicamente lo suyo por RLS.
      const byCollector = coll ? 'JOIN clients c ON c.id = s.client_id AND c.collector_id = $2' : '';
      const k = await tx.one<Record<string, any>>(
        `SELECT count(DISTINCT s.client_id) FILTER (WHERE s.bucket <> 'closed')::int AS clients_active,
                coalesce(sum(s.principal) FILTER (WHERE s.bucket <> 'closed'), 0)::bigint AS total_lent,
                coalesce(sum(s.principal), 0)::bigint AS total_lent_historic,
                coalesce(sum(s.due_today_amount) FILTER (WHERE s.bucket <> 'closed'), 0)::bigint AS expected_today,
                coalesce(sum(s.overdue_amount) FILTER (WHERE s.bucket <> 'closed'), 0)::bigint AS overdue_total,
                coalesce(sum(s.balance) FILTER (WHERE s.bucket <> 'closed'), 0)::bigint AS total_receivable,
                coalesce(sum(s.late_fees_outstanding) FILTER (WHERE s.bucket <> 'closed'), 0)::bigint AS late_fees,
                count(*) FILTER (WHERE s.bucket = 'current')::int AS a_current, coalesce(sum(s.balance) FILTER (WHERE s.bucket = 'current'), 0)::bigint AS b_current,
                count(*) FILTER (WHERE s.bucket = 'd1_7')::int AS a_d1_7, coalesce(sum(s.balance) FILTER (WHERE s.bucket = 'd1_7'), 0)::bigint AS b_d1_7,
                count(*) FILTER (WHERE s.bucket = 'd8_30')::int AS a_d8_30, coalesce(sum(s.balance) FILTER (WHERE s.bucket = 'd8_30'), 0)::bigint AS b_d8_30,
                count(*) FILTER (WHERE s.bucket = 'd30p')::int AS a_d30p, coalesce(sum(s.balance) FILTER (WHERE s.bucket = 'd30p'), 0)::bigint AS b_d30p
           FROM loan_state s ${byCollector}
          WHERE s.currency = $1 ${coll ? '' : 'AND $2::uuid IS NULL'}`,
        [currency, coll],
      );
      const clientsTotal = await tx.one<{ n: number }>('SELECT count(*)::int AS n FROM clients c WHERE ($1::uuid IS NULL OR c.collector_id = $1)', [coll]);
      let trend: { day: string; amount: number }[];
      if (auth.role === 'collector' || coll) {
        // Cartera de un cobrador: se suma sobre sus propios pagos (pocos), con el índice por préstamo y fecha.
        trend = await tx.many(
          `SELECT d::date::text AS day, coalesce(sum(e.amount), 0)::bigint AS amount
             FROM generate_series($2::date, $3::date, interval '1 day') d
             LEFT JOIN (
               SELECT e.entry_date, e.amount FROM ledger_entries e
                 JOIN loans l ON l.id = e.loan_id AND l.currency = $1
                 JOIN clients c ON c.id = l.client_id AND ($4::uuid IS NULL OR c.collector_id = $4)
                WHERE e.type = 'payment' AND e.entry_date BETWEEN $2 AND $3
                  AND NOT EXISTS (SELECT 1 FROM ledger_entries r WHERE r.reverses_id = e.id)
             ) e ON e.entry_date = d::date
            GROUP BY d ORDER BY d`,
          [currency, from, today, coll],
        );
      } else {
        trend = await tx.many(
          `SELECT d::date::text AS day, coalesce(dc.amount, 0)::bigint AS amount
             FROM generate_series($2::date, $3::date, interval '1 day') d
             LEFT JOIN daily_collections dc ON dc.day = d::date AND dc.currency = $1
            ORDER BY d`,
          [currency, from, today],
        );
      }
      const collectedToday = trend.find((t) => t.day === today)?.amount ?? 0;
      return {
        currency,
        currencies: currencies.length ? currencies : [tenant.currency],
        asOf: today,
        refreshing,
        clientsActive: k!.clients_active,
        clientsTotal: clientsTotal!.n,
        totalLent: k!.total_lent,
        totalLentHistoric: k!.total_lent_historic,
        expectedToday: k!.expected_today,
        collectedToday,
        overdueTotal: k!.overdue_total,
        totalReceivable: k!.total_receivable,
        lateFeesOutstanding: k!.late_fees,
        trend: trend.map((t) => ({ date: t.day, amount: t.amount })),
        aging: {
          current: { loans: k!.a_current, amount: k!.b_current },
          d1_7: { loans: k!.a_d1_7, amount: k!.b_d1_7 },
          d8_30: { loans: k!.a_d8_30, amount: k!.b_d8_30 },
          d30p: { loans: k!.a_d30p, amount: k!.b_d30p },
        },
      };
    });
  }

  /** Cobros de hoy (§5.7-4): cuotas que vencen hoy y vencidas, con su saldo y días de mora. */
  async today(auth: AuthContext, q: { collectorId?: string; limit?: number }) {
    const tenant = await this.tenants.get(auth.tenantId);
    const today = this.clock.today(tenant.timezone);
    const ctx = { tenantId: auth.tenantId, userId: auth.userId, role: auth.role };
    await this.state.ensureFresh(ctx, today);
    return this.db.tx(ctx, async (tx) => {
      const rows = await tx.many<Record<string, any>>(
        `SELECT s.loan_id, s.client_id, c.code, c.first_name, c.last_name, c.phone_e164, l.contract, s.currency, s.next_number, s.next_due_date,
                s.next_outstanding, s.due_today_amount, s.overdue_amount, s.days_past_due, s.bucket, s.balance
           FROM loan_state s JOIN loans l ON l.id = s.loan_id JOIN clients c ON c.id = s.client_id
          WHERE s.bucket <> 'closed' AND s.next_due_date <= $1 AND ($2::uuid IS NULL OR c.collector_id = $2)
          ORDER BY s.days_past_due DESC, c.first_name, c.last_name
          LIMIT $3`,
        [today, q.collectorId ?? null, Math.min(1000, q.limit ?? 500)],
      );
      return {
        asOf: today,
        items: rows.map((r) => ({
          loanId: r.loan_id, clientId: r.client_id, clientCode: r.code, clientName: `${r.first_name} ${r.last_name}`, phone: r.phone_e164,
          contract: r.contract, currency: r.currency, installmentNumber: r.next_number, dueDate: r.next_due_date,
          dueToday: r.due_today_amount, overdue: r.overdue_amount, amountToCollect: r.due_today_amount + r.overdue_amount,
          daysPastDue: r.days_past_due, status: r.days_past_due > 0 ? 'overdue' : 'due_today', balance: r.balance,
        })),
      };
    });
  }
}

@Controller()
export class DashboardController {
  constructor(private readonly dashboard: DashboardService, private readonly bus: EventBus) {}

  @Get('dashboard')
  @Requires('dashboard.view')
  @Op('getDashboard')
  get(@Auth() a: AuthContext, @Query() q: { currency?: string; collectorId?: string; days?: number }) {
    return this.dashboard.compute(a, q);
  }

  @Get('collections/today')
  @Requires('dashboard.view')
  @Op('todayCollections')
  today(@Auth() a: AuthContext, @Query() q: { collectorId?: string; limit?: number }) {
    return this.dashboard.today(a, q);
  }

  /**
   * Eventos en tiempo real (Server-Sent Events): el dashboard de todos los dispositivos se actualiza al registrar un pago.
   * El Cobrador solo recibe los de sus clientes; los avisos de seguridad solo llegan a Propietario y Administrador.
   */
  @Sse('events')
  @Requires('dashboard.view')
  @Op('events')
  events(@Auth() a: AuthContext): Observable<MessageEvent> {
    return new Observable<MessageEvent>((sub) => {
      const visible = (ev: CorocEvent) => {
        if (ev.type === 'security.lockout') return a.role === 'owner' || a.role === 'admin';
        if (a.role === 'collector') return !!ev.collectorId && ev.collectorId === a.userId;
        return true;
      };
      const off = this.bus.subscribe(a.tenantId, (ev) => {
        if (visible(ev)) sub.next({ type: ev.type, data: { ...ev.data, at: ev.at } });
      });
      sub.next({ type: 'ready', data: { at: new Date().toISOString() } });
      const ping = setInterval(() => sub.next({ type: 'ping', data: {} }), 25_000);
      return () => {
        clearInterval(ping);
        off();
      };
    });
  }
}
