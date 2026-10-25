import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { AccessService } from '../common/access.js';
import type { AuthContext } from '../common/context.js';
import { Auth, Op, Requires } from '../common/decorators.js';
import { RateLimiter } from '../common/rate-limit.js';
import { DbService } from '../db/db.service.js';
import { GmailAccounts } from './gmail.js';
import { GmailInbox } from './gmail-inbox.js';

/** Gmail de la empresa (ADR-065, pantalla 4 del asistente): conectar con una contraseña de aplicación, probar, quitar. */
@Controller('company/gmail')
export class GmailController {
  constructor(private readonly gmail: GmailAccounts, private readonly inbox: GmailInbox, private readonly limiter: RateLimiter) {}

  @Get()
  @Requires('company.edit')
  @Op('getGmail')
  get(@Auth() a: AuthContext) {
    return this.gmail.get(a);
  }

  @Put()
  @Requires('company.edit')
  @Op('saveGmail')
  async save(@Auth() a: AuthContext, @Body() b: { address: string; appPassword: string }) {
    // Cada intento entra a Gmail: pocos por minuto para que Google no bloquee la cuenta.
    this.limiter.hit(`gmail:${a.tenantId}`, 6, 60_000);
    const out = await this.gmail.save(a, b);
    this.inbox.restart(a.tenantId);
    return out;
  }

  @Post('test')
  @HttpCode(200)
  @Requires('company.edit')
  @Op('testGmail')
  async test(@Auth() a: AuthContext) {
    this.limiter.hit(`gmail:${a.tenantId}`, 6, 60_000);
    const out = await this.gmail.test(a);
    this.inbox.restart(a.tenantId);
    return out;
  }

  @Delete()
  @HttpCode(204)
  @Requires('company.edit')
  @Op('deleteGmail')
  async remove(@Auth() a: AuthContext): Promise<void> {
    await this.gmail.remove(a);
    this.inbox.restart(a.tenantId);
  }
}

/** Hilo de correo del cliente en su ficha (lo que llegó y lo que COROC envió). El Cobrador solo ve el de sus clientes. */
@Controller('clients')
export class ClientEmailsController {
  constructor(private readonly db: DbService, private readonly gmail: GmailAccounts, private readonly access: AccessService) {}

  @Get(':id/emails')
  @Requires('messages.view')
  @Op('clientEmails')
  thread(@Auth() a: AuthContext, @Param('id') id: string, @Query() q: { limit?: number }) {
    const limit = Math.min(200, Math.max(1, Number(q.limit ?? 50)));
    return this.db.tx({ tenantId: a.tenantId, userId: a.userId, role: a.role }, async (tx) => {
      const c = await tx.one<{ id: string }>('SELECT id FROM clients WHERE id = $1', [id]);
      if (!c) return this.access.deny(tx, a, 'client', id);
      const rows = await tx.many<Record<string, any>>('SELECT * FROM email_messages WHERE client_id = $1 ORDER BY at DESC, id DESC LIMIT $2', [id, limit]);
      return { items: rows.map((r) => this.gmail.threadJson(r)) };
    });
  }
}
