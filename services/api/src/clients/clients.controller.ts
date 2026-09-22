import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthContext } from '../common/context.js';
import { Auth, Idempotent, Op, Requires } from '../common/decorators.js';
import { pickLang } from '../common/i18n.js';
import { Problem } from '../common/problem.js';
import { DbService } from '../db/db.service.js';
import { AccessService } from '../common/access.js';
import type { LoanInput } from '../loans/loans.service.js';
import { ClientsService, type ClientInput, type ListQuery } from './clients.service.js';

@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService, private readonly db: DbService, private readonly access: AccessService) {}

  @Get()
  @Requires('clients.view')
  @Op('listClients')
  list(@Auth() a: AuthContext, @Query() q: ListQuery) {
    return this.clients.list(a, q);
  }

  @Post()
  @Requires('clients.create')
  @Idempotent()
  @Op('createClientWithLoan')
  create(@Auth() a: AuthContext, @Body() b: { client: ClientInput; loan: LoanInput; acknowledgeDuplicate?: boolean }, @Req() req: Request) {
    return this.clients.createWithLoan(a, b, pickLang(a.lang, req.headers['accept-language']));
  }

  @Get(':id')
  @Requires('clients.view')
  @Op('getClient')
  get(@Auth() a: AuthContext, @Param('id') id: string) {
    return this.clients.get(a, id);
  }

  @Patch(':id')
  @Requires('clients.edit')
  @Op('updateClient')
  update(@Auth() a: AuthContext, @Param('id') id: string, @Body() b: ClientInput, @Headers('if-match') ifMatch?: string) {
    return this.clients.update(a, id, b, ifMatch);
  }

  @Post(':id/loans')
  @Requires('loans.create')
  @Idempotent()
  @Op('createLoan')
  addLoan(@Auth() a: AuthContext, @Param('id') id: string, @Body() b: LoanInput, @Req() req: Request) {
    return this.clients.addLoan(a, id, b, pickLang(a.lang, req.headers['accept-language']));
  }

  @Post(':id/consents')
  @Requires('clients.edit')
  @Op('grantConsent')
  grant(@Auth() a: AuthContext, @Param('id') id: string, @Body() b: { channel: 'whatsapp' | 'email' | 'personal_data'; method: string; evidenceDocumentId?: string }) {
    return this.db.tx(this.clients.ctx(a), async (tx) => {
      if (!(await tx.one('SELECT 1 FROM clients WHERE id = $1', [id]))) return this.access.deny(tx, a, 'client', id);
      return this.clients.consentJson(await this.clients.grant(tx, a, id, b));
    });
  }

  @Delete(':id/consents/:channel')
  @HttpCode(204)
  @Requires('clients.edit')
  @Op('revokeConsent')
  async revoke(@Auth() a: AuthContext, @Param('id') id: string, @Param('channel') channel: string): Promise<void> {
    if (!['whatsapp', 'email', 'personal_data'].includes(channel)) throw Problem.notFound();
    await this.clients.revoke(a, id, channel);
  }
}
