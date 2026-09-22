import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AccessService } from '../common/access.js';
import { Clock } from '../common/clock.js';
import type { AuthContext } from '../common/context.js';
import { Auth, Idempotent, Op, Requires } from '../common/decorators.js';
import { pickLang } from '../common/i18n.js';
import { TenantCache } from '../company/tenant-cache.js';
import { DbService } from '../db/db.service.js';
import { LoanStateService } from './loan-state.service.js';
import { LoansService, type LoanTermsInput } from './loans.service.js';
import { entryJson, PaymentsService, type PaymentInput } from './payments.service.js';

@Controller('loans')
export class LoansController {
  constructor(
    private readonly db: DbService,
    private readonly loans: LoansService,
    private readonly state: LoanStateService,
    private readonly payments: PaymentsService,
    private readonly tenants: TenantCache,
    private readonly access: AccessService,
    private readonly clock: Clock,
  ) {}

  private ctx(a: AuthContext) {
    return { tenantId: a.tenantId, userId: a.userId, role: a.role };
  }

  @Post('preview')
  @HttpCode(200)
  @Requires('loans.create')
  @Op('previewLoan')
  async preview(@Auth() a: AuthContext, @Body() b: LoanTermsInput, @Req() req: Request) {
    const tenant = await this.tenants.get(a.tenantId);
    return this.db.tx(this.ctx(a), (tx) => this.loans.preview(tx, tenant, b, pickLang(a.lang, req.headers['accept-language'])));
  }

  private async withLoan<T>(a: AuthContext, id: string, fn: (l: NonNullable<Awaited<ReturnType<LoanStateService['load']>>>, today: string, tx: Parameters<Parameters<DbService['tx']>[1]>[0]) => Promise<T>): Promise<T> {
    const tenant = await this.tenants.get(a.tenantId);
    const today = this.clock.today(tenant.timezone);
    return this.db.tx(this.ctx(a), async (tx) => {
      const l = await this.state.load(tx, id);
      if (!l) return this.access.deny(tx, a, 'loan', id);
      return fn(l, today, tx);
    });
  }

  @Get(':id')
  @Requires('clients.view')
  @Op('getLoan')
  async get(@Auth() a: AuthContext, @Param('id') id: string) {
    const tenant = await this.tenants.get(a.tenantId);
    return this.withLoan(a, id, async (l, today) => this.loans.loanJson(l, this.state.replay(l, today), tenant));
  }

  /** Cuadro de inversión y pagos (§10): el plan pactado con lo pagado, el estado y los recibos de cada cuota. */
  @Get(':id/schedule')
  @Requires('clients.view')
  @Op('getSchedule')
  schedule(@Auth() a: AuthContext, @Param('id') id: string) {
    return this.withLoan(a, id, async (l, today, tx) => {
      const r = this.state.replay(l, today);
      const receipts = new Map((await tx.many<{ entry_id: string; number: string }>('SELECT entry_id, number FROM receipts WHERE loan_id = $1 AND voided_at IS NULL', [id])).map((x) => [x.entry_id, x.number]));
      const perInstallment = new Map<number, string[]>();
      for (const [entryId, alloc] of r.allocations) {
        const n = receipts.get(entryId);
        if (!n) continue;
        for (const line of alloc.lines) (perInstallment.get(line.number) ?? perInstallment.set(line.number, []).get(line.number)!).push(n);
      }
      return l.plan.map((p) => {
        const st = r.states.find((s) => s.number === p.number)!;
        return {
          number: p.number, dueDate: p.due_date, amount: p.amount, principal: p.principal, interest: p.interest, balanceAfter: p.balance_after,
          paid: st.paid, lateFeeAccrued: st.lateFeeAccrued ?? 0, lateFeePaid: st.lateFeePaid ?? 0, status: st.status,
          lastPaymentDate: st.lastPaymentDate, proofDocumentIds: [], receiptNumbers: perInstallment.get(p.number) ?? [],
        };
      });
    });
  }

  /** Libro de movimientos (§9.7): inmutable; los reversos aparecen como contramovimientos con motivo. */
  @Get(':id/ledger')
  @Requires('clients.view')
  @Op('getLedger')
  ledger(@Auth() a: AuthContext, @Param('id') id: string) {
    return this.withLoan(a, id, async (l, today, tx) => {
      const r = this.state.replay(l, today);
      const receipts = new Map((await tx.many<{ entry_id: string; number: string }>('SELECT entry_id, number FROM receipts WHERE loan_id = $1', [id])).map((x) => [x.entry_id, x.number]));
      const stored = await tx.many<{ entry_id: string; installment_number: number; to_late_fee: number; to_installment: number }>(
        'SELECT a.* FROM payment_allocations a JOIN ledger_entries e ON e.id = a.entry_id WHERE e.loan_id = $1 ORDER BY a.installment_number', [id],
      );
      return l.ledger.map((e) => {
        const live = r.allocations.get(e.id)?.lines;
        const allocation = live ?? stored.filter((s) => s.entry_id === e.id).map((s) => ({ number: s.installment_number, toLateFee: s.to_late_fee, toInstallment: s.to_installment, completed: false, partial: false }));
        return entryJson(e, { allocation, receiptNumber: receipts.get(e.id) ?? null });
      });
    });
  }

  @Get(':id/receipts')
  @Requires('clients.view')
  @Op('listReceipts')
  receipts(@Auth() a: AuthContext, @Param('id') id: string) {
    return this.withLoan(a, id, (_l, _t, tx) => this.payments.receipts(tx, id));
  }

  @Post(':id/payments')
  @Requires('payments.register')
  @Idempotent()
  @Op('postPayment')
  pay(@Auth() a: AuthContext, @Param('id') id: string, @Body() b: PaymentInput) {
    return this.payments.post(a, id, b);
  }

  @Post(':id/payments/:entryId/reversal')
  @Requires('payments.reverse')
  @Op('reversePayment')
  reverse(@Auth() a: AuthContext, @Param('id') id: string, @Param('entryId') entryId: string, @Body() b: { reason: string }) {
    return this.payments.reverse(a, id, entryId, b.reason);
  }
}
