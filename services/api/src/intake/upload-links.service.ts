import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { randomToken, SecretBox, sha256 } from '../auth/crypto.js';
import { AccessService } from '../common/access.js';
import { Clock } from '../common/clock.js';
import type { AuthContext } from '../common/context.js';
import { Problem } from '../common/problem.js';
import { CONFIG, type AppConfig } from '../config.js';
import { DbService, type Tx } from '../db/db.service.js';
import { LoanStateService } from '../loans/loan-state.service.js';

export interface ResolvedLink {
  linkId: string;
  tenantId: string;
  loanId: string;
}

/**
 * Enlace personal de carga de cada préstamo (§12.3). El enlace identifica al remitente, así que el comprobante queda
 * vinculado al cliente correcto sin depender del número. Se busca por el hash del token; el token se guarda cifrado
 * para poder mostrarlo otra vez y usarlo en los mensajes (Fase 4). Rotar invalida el anterior al instante.
 */
@Injectable()
export class UploadLinksService {
  private readonly box: SecretBox;

  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly state: LoanStateService,
    private readonly clock: Clock,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {
    this.box = new SecretBox(config.dataKey);
  }

  private ctx(a: AuthContext) {
    return { tenantId: a.tenantId, userId: a.userId, role: a.role };
  }

  private json(r: Record<string, any>, tenantId: string) {
    const token = this.box.open(r.token_enc, `upload-link:${tenantId}:${r.id}`).toString();
    return {
      url: `${this.config.portalUrlBase}${token}`,
      expiresAt: new Date(r.expires_at).toISOString(),
      createdAt: new Date(r.created_at).toISOString(),
      uses: r.uses,
      lastUsedAt: r.last_used_at ? new Date(r.last_used_at).toISOString() : null,
    };
  }

  private async loan(tx: Tx, auth: AuthContext, loanId: string) {
    const l = await tx.one<{ id: string; status: string }>('SELECT id, status FROM loans WHERE id = $1', [loanId]);
    if (!l) return this.access.deny(tx, auth, 'loan', loanId);
    return l;
  }

  async get(auth: AuthContext, loanId: string) {
    return this.db.tx(this.ctx(auth), async (tx) => {
      await this.loan(tx, auth, loanId);
      const r = await tx.one<Record<string, any>>('SELECT * FROM upload_links WHERE loan_id = $1 AND revoked_at IS NULL AND expires_at > now() AND token_enc IS NOT NULL', [loanId]);
      if (!r) throw Problem.notFound();
      return this.json(r, auth.tenantId);
    });
  }

  async rotate(auth: AuthContext, loanId: string) {
    return this.db.tx(this.ctx(auth), async (tx) => {
      const l = await this.loan(tx, auth, loanId);
      if (l.status !== 'active') throw new Problem(409, 'LOAN_ALREADY_PAID');
      await tx.exec('UPDATE upload_links SET revoked_at = now() WHERE loan_id = $1 AND revoked_at IS NULL', [loanId]);
      const token = randomToken(24);
      const id = (await tx.one<{ id: string }>('SELECT gen_random_uuid() AS id'))!.id;
      const r = await tx.one<Record<string, any>>(
        `INSERT INTO upload_links (id, tenant_id, loan_id, token_hash, token_enc, expires_at, created_by)
         VALUES ($1, current_tenant(), $2, $3, $4, now() + make_interval(days => $5), $6) RETURNING *`,
        [id, loanId, sha256(token), this.box.seal(Buffer.from(token), `upload-link:${auth.tenantId}:${id}`), this.config.uploadLinkDays, auth.userId],
      );
      await this.audit.log(tx, 'upload_link.rotated', 'loan', loanId, { after: { linkId: id, expiresAt: r!.expires_at } });
      return this.json(r!, auth.tenantId);
    });
  }

  async revoke(auth: AuthContext, loanId: string): Promise<void> {
    await this.db.tx(this.ctx(auth), async (tx) => {
      await this.loan(tx, auth, loanId);
      const n = await tx.exec('UPDATE upload_links SET revoked_at = now() WHERE loan_id = $1 AND revoked_at IS NULL', [loanId]);
      if (n) await this.audit.log(tx, 'upload_link.revoked', 'loan', loanId);
    });
  }

  /** Portal público: token → empresa y préstamo. Un token desconocido, vencido o revocado no revela nada más. */
  async resolve(token: string): Promise<ResolvedLink> {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw new Problem(404, 'UPLOAD_LINK_INVALID');
    const r = await this.db.tx(null, (tx) => tx.one<{ link_id: string; tenant_id: string; loan_id: string; expires_at: Date; revoked: boolean }>('SELECT * FROM resolve_upload_link($1)', [sha256(token)]));
    if (!r) throw new Problem(404, 'UPLOAD_LINK_INVALID');
    if (r.revoked || new Date(r.expires_at) < this.clock.now()) throw new Problem(410, 'UPLOAD_LINK_EXPIRED');
    return { linkId: r.link_id, tenantId: r.tenant_id, loanId: r.loan_id };
  }

  async touch(link: ResolvedLink): Promise<void> {
    await this.db.tx({ tenantId: link.tenantId }, (tx) => tx.exec('UPDATE upload_links SET uses = uses + 1, last_used_at = now() WHERE id = $1', [link.linkId]));
  }

  /** Lo que ve el deudor: su plan de pagos y el saldo, derivados del libro en este momento. */
  async portal(link: ResolvedLink, today: (tz: string) => string) {
    return this.db.tx({ tenantId: link.tenantId }, async (tx) => {
      const t = (await tx.one<Record<string, any>>('SELECT name, phone, email, timezone FROM tenants WHERE id = current_tenant()'))!;
      const l = (await this.state.load(tx, link.loanId))!;
      const c = (await tx.one<{ first_name: string; lang: 'es' | 'pt-BR' | 'en' }>('SELECT first_name, lang FROM clients WHERE id = $1', [l.loan.client_id]))!;
      const asOf = today(t.timezone);
      const r = this.state.replay(l, asOf);
      return {
        company: { name: t.name as string, phone: (t.phone as string | null) ?? null, email: (t.email as string | null) ?? null },
        clientFirstName: c.first_name,
        lang: c.lang,
        contract: l.loan.contract,
        currency: l.loan.currency,
        summary: r.summary,
        closed: r.summary.balance === 0,
        installments: r.states.map((s) => ({
          number: s.number, dueDate: s.dueDate, amount: s.amount, paid: s.paid,
          status: s.status === 'paid' ? 'paid' : s.dueDate < asOf ? 'overdue' : s.paid > 0 ? 'partial' : 'pending',
        })),
      };
    });
  }
}
