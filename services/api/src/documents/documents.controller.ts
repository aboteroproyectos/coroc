import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { formatMoney, LOCALE_OF, type Currency } from '@coroc/core';
import { AccessService } from '../common/access.js';
import type { AuthContext } from '../common/context.js';
import { Auth, Op, Public, Requires } from '../common/decorators.js';
import { pickLang, t } from '../common/i18n.js';
import { Problem } from '../common/problem.js';
import { RateLimiter } from '../common/rate-limit.js';
import { DbService } from '../db/db.service.js';
import { ObjectStore } from '../storage/object-store.js';
import { DocumentsService, MAX_UPLOAD_BYTES, type DocListQuery } from './documents.service.js';
import { LinkSigner } from './links.js';
import { DocumentTasks } from './tasks.js';
import { esc } from '../pdf/templates.js';

/** Lee el cuerpo binario de la petición con un tope de tamaño (cargas de archivos). */
export async function readBody(req: Request, max: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > max) throw new Problem(413, 'FILE_TOO_LARGE', { mb: Math.round(max / 1024 / 1024) });
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max) throw new Problem(413, 'FILE_TOO_LARGE', { mb: Math.round(max / 1024 / 1024) });
    parts.push(chunk as Buffer);
  }
  return Buffer.concat(parts);
}

export const taskJson = (r: Record<string, any>) => ({
  id: r.id,
  kind: r.kind,
  status: r.status,
  progress: r.progress,
  documentId: r.document_id ?? null,
  error: r.status === 'failed' ? 'TASK_FAILED' : null,
  createdAt: new Date(r.created_at).toISOString(),
  finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
});

@Controller('documents')
export class DocumentsController {
  constructor(private readonly docs: DocumentsService) {}

  @Get()
  @Requires('clients.view')
  @Op('listDocuments')
  list(@Auth() a: AuthContext, @Query() q: DocListQuery) {
    return this.docs.list(a, q);
  }

  @Get(':id')
  @Requires('clients.view')
  @Op('getDocument')
  get(@Auth() a: AuthContext, @Param('id') id: string) {
    return this.docs.get(a, id);
  }

  @Patch(':id')
  @Requires('documents.upload')
  @Op('updateDocument')
  tags(@Auth() a: AuthContext, @Param('id') id: string, @Body() b: { tags: string[] }) {
    return this.docs.setTags(a, id, b.tags);
  }

  @Post(':id/link')
  @HttpCode(200)
  @Requires('clients.view')
  @Op('createDocumentLink')
  link(@Auth() a: AuthContext, @Param('id') id: string) {
    return this.docs.link(a, id);
  }
}

@Controller('clients')
export class ClientDocumentsController {
  constructor(private readonly docs: DocumentsService) {}

  /** Carga manual (§12.6). El cuerpo es el archivo; tipo y nombre van en la consulta. */
  @Post(':id/documents')
  @Requires('documents.upload')
  @Op('uploadDocument')
  async upload(@Auth() a: AuthContext, @Param('id') id: string, @Query() q: { loanId?: string; kind?: 'other' | 'receipt_in'; name?: string; tags?: string }, @Req() req: Request) {
    const body = await readBody(req, MAX_UPLOAD_BYTES);
    return this.docs.upload(a, id, body, { loanId: q.loanId, kind: q.kind, name: q.name, tags: q.tags ? q.tags.split(',') : [] });
  }
}

@Controller('loans')
export class LoanDocumentsController {
  constructor(private readonly db: DbService, private readonly tasks: DocumentTasks, private readonly access: AccessService) {}

  /** Estado de cuenta bajo demanda (§16.4). Se genera en segundo plano; la app sigue la tarea. */
  @Post(':id/statements')
  @HttpCode(202)
  @Requires('documents.upload')
  @Op('requestStatement')
  async statement(@Auth() a: AuthContext, @Param('id') id: string) {
    const row = await this.db.tx({ tenantId: a.tenantId, userId: a.userId, role: a.role }, async (tx) => {
      if (!(await tx.one('SELECT 1 FROM loans WHERE id = $1', [id]))) return this.access.deny(tx, a, 'loan', id);
      const taskId = await this.tasks.enqueue(tx, { kind: 'statement', loanId: id, params: { reason: 'on_demand' }, createdBy: a.userId });
      return tx.one<Record<string, any>>('SELECT * FROM document_tasks WHERE id = $1', [taskId]);
    });
    this.tasks.kick();
    return taskJson(row!);
  }
}

@Controller('tasks')
export class TasksController {
  constructor(private readonly db: DbService) {}

  @Get(':id')
  @Requires('clients.view')
  @Op('getTask')
  async get(@Auth() a: AuthContext, @Param('id') id: string) {
    const r = await this.db.tx({ tenantId: a.tenantId, userId: a.userId, role: a.role }, (tx) => tx.one<Record<string, any>>('SELECT * FROM document_tasks WHERE id = $1', [id]));
    if (!r || (r.kind === 'report' && r.created_by !== a.userId && a.role !== 'owner' && a.role !== 'admin')) throw Problem.notFound();
    return taskJson(r);
  }
}

@Controller('folder')
export class FolderController {
  constructor(private readonly docs: DocumentsService) {}

  @Get('manifest')
  @Requires('clients.view')
  @Op('getFolderManifest')
  manifest(@Auth() a: AuthContext, @Query() q: { since?: string; after?: string; limit?: number }) {
    return this.docs.manifest(a, q);
  }
}

/** Parsea «bytes=a-b», «bytes=a-» o «bytes=-n». Un rango inválido se trata como «todo el archivo». */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | 'invalid' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return null;
  let start: number;
  let end: number;
  if (!m[1]) {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (start > end || start >= size) return 'invalid';
  return { start, end };
}

/**
 * Descarga con enlace firmado (§4.2). Admite rangos (`Range`), así que una descarga cortada se reanuda donde quedó.
 * No requiere sesión: el enlace mismo es la autorización y vence en minutos.
 */
@Controller('files')
export class FilesController {
  constructor(private readonly links: LinkSigner, private readonly db: DbService, private readonly store: ObjectStore) {}

  @Public()
  @Get(':token')
  @Op('downloadFile')
  async download(@Param('token') token: string, @Query('download') dl: string | undefined, @Req() req: Request, @Res() res: Response): Promise<void> {
    const c = this.links.verify(token);
    if (!c) throw new Problem(410, 'LINK_EXPIRED');
    const row = await this.db.tx({ tenantId: c.t }, async (tx) => {
      // Enlace de un mensaje (§11.1): el PDF que el mensaje entregó; si el mensaje ya no existe, el enlace muere con él.
      const docId = c.k === 'message'
        ? (await tx.one<{ d: string | null }>(`SELECT coalesce(m.attachment_document_id, t.document_id) AS d FROM messages m LEFT JOIN document_tasks t ON t.id = m.document_task_id WHERE m.id = $1`, [c.i]))?.d ?? null
        : c.i;
      if (c.k === 'message' && !docId) return null;
      return c.k !== 'backup'
        ? tx.one<{ storage_key: string; size: number; mime: string; name: string; sha: string }>('SELECT storage_key, size_bytes AS size, mime, file_name AS name, sha256 AS sha FROM documents WHERE id = $1', [docId])
        : tx.one<{ storage_key: string; size: number; mime: string; name: string; sha: string }>("SELECT storage_key, size_bytes AS size, 'application/octet-stream' AS mime, file_name AS name, sha256 AS sha FROM backups WHERE id = $1 AND status = 'done'", [c.i]);
    });
    if (!row?.storage_key) throw Problem.notFound();
    const size = Number(row.size);
    const range = parseRange(typeof req.headers.range === 'string' ? req.headers.range : undefined, size);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('ETag', `"${row.sha}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', row.mime);
    res.setHeader('Content-Disposition', `${dl === '1' || c.k === 'backup' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(row.name)}`);
    if (range === 'invalid') {
      res.status(416).setHeader('Content-Range', `bytes */${size}`);
      res.end();
      return;
    }
    const stream = await this.store.get(c.t, row.storage_key, size, range ?? undefined);
    if (range) {
      res.status(206).setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
      res.setHeader('Content-Length', String(range.end - range.start + 1));
    } else {
      res.status(200).setHeader('Content-Length', String(size));
    }
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }
}

/**
 * Verificación pública del recibo (§15): el código QR abre esta página. Solo confirma lo que el recibo ya muestra
 * (empresa, número, fecha, valor y si fue anulado), sin el nombre del deudor.
 */
@Controller('public')
export class PublicReceiptsController {
  constructor(private readonly db: DbService, private readonly limiter: RateLimiter) {}

  @Public()
  @Get('receipts/:code')
  @Op('verifyReceipt')
  async verify(@Param('code') code: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    this.limiter.hit(`verify:${req.ip}`, 30, 60_000);
    const r = await this.db.tx(null, (tx) => tx.one<Record<string, any>>('SELECT * FROM verify_receipt($1)', [code]));
    const lang = pickLang(null, req.headers['accept-language']);
    const body = r
      ? { valid: true, voided: r.voided, company: r.company, number: r.number, paymentDate: r.payment_date, amount: Number(r.amount), currency: r.currency, issuedAt: r.issued_at }
      : { valid: false, voided: false };
    res.setHeader('Cache-Control', 'no-store');
    if (!(req.headers.accept ?? '').includes('text/html')) {
      res.status(r ? 200 : 404).json(body);
      return;
    }
    const state = !r ? 'invalid' : r.voided ? 'voided' : 'valid';
    const color = state === 'valid' ? '#2E7D5B' : '#B3261E';
    const detail = r
      ? `<dl><dt>${esc(t(lang, 'verify.company'))}</dt><dd>${esc(r.company)}</dd><dt>${esc(t(lang, 'verify.number'))}</dt><dd>${esc(r.number)}</dd>
<dt>${esc(t(lang, 'verify.date'))}</dt><dd>${esc(r.payment_date)}</dd><dt>${esc(t(lang, 'verify.amount'))}</dt><dd>${esc(formatMoney(Number(r.amount), r.currency as Currency, LOCALE_OF[lang]))}</dd></dl>`
      : '';
    res.status(r ? 200 : 404).type('html').setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'").send(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>COROC · ${esc(t(lang, 'verify.title'))}</title>
<style>body{margin:0;background:#FFFDE7;color:#130E42;font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}
main{max-width:420px;margin:16px;padding:28px;background:#fff;border:1px solid #E8E4D8;border-radius:16px;border-top:4px solid #CAA555}
h1{font-size:20px;margin:0 0 8px}.state{color:${color};font-weight:600}dl{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;margin:18px 0 0}
dt{color:#5B5878}dd{margin:0;font-weight:600}footer{margin-top:20px;font-size:12px;color:#5B5878}</style></head>
<body><main><h1>${esc(t(lang, 'verify.title'))}</h1><p class="state">${esc(t(lang, `verify.${state}`))}</p>${detail}<footer>${esc(t(lang, 'doc.common.generatedBy'))}</footer></main></body></html>`);
  }
}
