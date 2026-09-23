import { Injectable } from '@nestjs/common';
import { documentFileName, documentFolder, rootFolders, CLIENT_MARKER, SUBFOLDERS, type DocKind } from '@coroc/core';
import { AuditService } from '../audit/audit.service.js';
import { AccessService } from '../common/access.js';
import { Clock } from '../common/clock.js';
import type { AuthContext } from '../common/context.js';
import type { Lang } from '../common/i18n.js';
import { Problem } from '../common/problem.js';
import { TenantCache } from '../company/tenant-cache.js';
import { DbService, type Tx } from '../db/db.service.js';
import { ObjectStore } from '../storage/object-store.js';
import { LinkSigner } from './links.js';

export interface NewDocument {
  clientId: string | null;
  loanId: string | null;
  kind: DocKind;
  /** Nombre visible, con tildes (§16.3: en la app y en los documentos el nombre se ve completo). */
  name: string;
  /** Nombre en la carpeta COROC (AAAA-MM-DD_HHMM_TIPO_…). */
  fileName: string;
  mime: string;
  body: Buffer;
  /** Documentos versionados: la versión nueva reemplaza a la anterior sin borrarla (§16.1). */
  versionKey?: string | null;
  source: 'system' | 'manual' | 'folder';
  lang?: Lang | null;
  meta?: Record<string, unknown>;
  tags?: string[];
  createdBy?: string | null;
}

export interface DocListQuery {
  clientId?: string;
  loanId?: string;
  kind?: DocKind;
  from?: string;
  to?: string;
  q?: string;
  tag?: string;
  includeSuperseded?: boolean;
  cursor?: string;
  limit?: number;
}

const ACCENTS_FROM = 'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ';
const ACCENTS_TO = 'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC';
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Tipos de archivo que se aceptan al subir, reconocidos por su contenido y no por la extensión que dice tener. */
export function sniffMime(b: Buffer): { mime: string; ext: string } | null {
  if (b.subarray(0, 5).toString('latin1') === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  const brand = b.subarray(4, 12).toString('latin1');
  if (/^ftyp(heic|heix|hevc|mif1|msf1)$/.test(brand)) return { mime: 'image/heic', ext: 'heic' };
  return null;
}

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Repositorio documental por cliente (§16.1): versiones, etiquetas, búsqueda y enlaces firmados. */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly db: DbService,
    private readonly store: ObjectStore,
    private readonly links: LinkSigner,
    private readonly tenants: TenantCache,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  ctx(a: AuthContext) {
    return { tenantId: a.tenantId, userId: a.userId, role: a.role };
  }

  /**
   * Guarda un documento: primero el archivo cifrado y después la fila, dentro de la transacción del llamador. Si la
   * transacción se revierte queda un objeto sin fila, que no es visible para nadie ni ocupa un lugar en la carpeta.
   */
  async save(tx: Tx, tenantId: string, d: NewDocument): Promise<Record<string, any>> {
    const key = this.store.newKey(tenantId, 'documents');
    const stored = await this.store.put(tenantId, key, d.body);
    let version = 1;
    if (d.versionKey) {
      const prev = await tx.many<{ version: number }>('SELECT version FROM documents WHERE version_key = $1 ORDER BY version DESC FOR UPDATE', [d.versionKey]);
      version = (prev[0]?.version ?? 0) + 1;
      if (prev.length) await tx.exec('UPDATE documents SET superseded = true WHERE version_key = $1 AND NOT superseded', [d.versionKey]);
    }
    return (await tx.one(
      `INSERT INTO documents (tenant_id, client_id, loan_id, kind, name, file_name, mime, size_bytes, sha256, storage_key, version_key, version, source, lang, meta, tags, created_by)
       VALUES (current_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
      [d.clientId, d.loanId, d.kind, d.name, d.fileName, d.mime, stored.size, stored.sha256, key, d.versionKey ?? null, version, d.source, d.lang ?? null, JSON.stringify(d.meta ?? {}), d.tags ?? [], d.createdBy ?? null],
    ))!;
  }

  json(r: Record<string, any>, companyLang: Lang) {
    const kind = r.kind as DocKind;
    return {
      id: r.id,
      clientId: r.client_id ?? null,
      loanId: r.loan_id ?? null,
      contract: r.contract ?? null,
      kind,
      name: r.name,
      fileName: r.file_name,
      folderPath: documentFolder(companyLang, { kind, clientFolder: r.folder_name ?? null, contract: r.contract ?? null }).join('/'),
      mime: r.mime,
      size: Number(r.size_bytes),
      sha256: r.sha256,
      version: r.version,
      superseded: r.superseded,
      source: r.source,
      tags: r.tags ?? [],
      lang: r.lang ?? null,
      meta: r.meta ?? {},
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
    };
  }

  private readonly select = `SELECT d.*, c.folder_name, l.contract FROM documents d
    LEFT JOIN clients c ON c.id = d.client_id LEFT JOIN loans l ON l.id = d.loan_id`;

  async list(auth: AuthContext, q: DocListQuery) {
    const tenant = await this.tenants.get(auth.tenantId);
    const limit = Math.min(200, Math.max(1, q.limit ?? 50));
    return this.db.tx(this.ctx(auth), async (tx) => {
      if (q.clientId && !(await tx.one('SELECT 1 FROM clients WHERE id = $1', [q.clientId]))) return this.access.deny(tx, auth, 'client', q.clientId);
      if (q.loanId && !(await tx.one('SELECT 1 FROM loans WHERE id = $1', [q.loanId]))) return this.access.deny(tx, auth, 'loan', q.loanId);
      const where: string[] = [];
      const params: unknown[] = [];
      const p = (v: unknown) => {
        params.push(v);
        return `$${params.length}`;
      };
      if (q.clientId) where.push(`d.client_id = ${p(q.clientId)}`);
      if (q.loanId) where.push(`d.loan_id = ${p(q.loanId)}`);
      if (q.kind) where.push(`d.kind = ${p(q.kind)}`);
      if (q.from) where.push(`d.created_at >= (${p(q.from)}::date::timestamp AT TIME ZONE ${p(tenant.timezone)})`);
      if (q.to) where.push(`d.created_at < ((${p(q.to)}::date + 1)::timestamp AT TIME ZONE ${p(tenant.timezone)})`);
      if (q.tag) where.push(`${p(q.tag.trim().toLowerCase())} = ANY (d.tags)`);
      if (!q.includeSuperseded) where.push('NOT d.superseded');
      if (q.q?.trim()) {
        const like = p(`%${fold(q.q.trim()).replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
        where.push(`lower(translate(d.name || ' ' || coalesce(d.ocr_text, ''), '${ACCENTS_FROM}', '${ACCENTS_TO}')) LIKE ${like}`);
      }
      if (q.cursor) {
        try {
          const [at, id] = JSON.parse(Buffer.from(q.cursor, 'base64url').toString()) as [string, string];
          where.push(`(d.created_at, d.id) < (${p(at)}::timestamptz, ${p(id)}::uuid)`);
        } catch {
          throw new Problem(422, 'VALIDATION_FAILED', {}, [{ field: 'cursor', message: 'format' }]);
        }
      }
      const rows = await tx.many<Record<string, any>>(`${this.select} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY d.created_at DESC, d.id DESC LIMIT ${limit + 1}`, params);
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map((r) => this.json(r, tenant.lang)),
        nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify([new Date(last.created_at).toISOString(), last.id])).toString('base64url') : null,
      };
    });
  }

  private async load(tx: Tx, auth: AuthContext, id: string): Promise<Record<string, any>> {
    const r = await tx.one<Record<string, any>>(`${this.select} WHERE d.id = $1`, [id]);
    if (r) return r;
    // Un documento de un cliente ajeno se registra como acceso denegado (CA-16), igual que el cliente.
    if (auth.role === 'collector') {
      const owner = await tx.one<{ client_id: string | null }>('SELECT client_id FROM document_owner($1)', [id]);
      if (owner?.client_id) return this.access.deny(tx, auth, 'client', owner.client_id);
    }
    throw Problem.notFound();
  }

  /** Documento con todas sus versiones (la vigente primero). */
  async get(auth: AuthContext, id: string) {
    const tenant = await this.tenants.get(auth.tenantId);
    return this.db.tx(this.ctx(auth), async (tx) => {
      const r = await this.load(tx, auth, id);
      const versions = r.version_key
        ? await tx.many<Record<string, any>>(`${this.select} WHERE d.version_key = $1 ORDER BY d.version DESC`, [r.version_key])
        : [r];
      return { ...this.json(r, tenant.lang), versions: versions.map((v) => this.json(v, tenant.lang)) };
    });
  }

  async setTags(auth: AuthContext, id: string, tags: string[]) {
    const tenant = await this.tenants.get(auth.tenantId);
    const clean = [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
    return this.db.tx(this.ctx(auth), async (tx) => {
      const before = await this.load(tx, auth, id);
      await tx.exec('UPDATE documents SET tags = $2 WHERE id = $1', [id, clean]);
      await this.audit.log(tx, 'document.tagged', 'document', id, { before: { tags: before.tags }, after: { tags: clean } });
      return this.json({ ...before, tags: clean, updated_at: new Date() }, tenant.lang);
    });
  }

  /** Enlace firmado de corta duración para ver, descargar o compartir el archivo. */
  async link(auth: AuthContext, id: string) {
    await this.db.tx(this.ctx(auth), (tx) => this.load(tx, auth, id));
    const { token, expiresAt } = this.links.sign({ t: auth.tenantId, k: 'document', i: id });
    return { url: this.links.url(token), path: `/files/${token}`, expiresAt };
  }

  /** Carga manual al repositorio del cliente (§12.6): otros documentos o un comprobante recibido. */
  async upload(auth: AuthContext, clientId: string, body: Buffer, meta: { loanId?: string; kind?: 'other' | 'receipt_in'; name?: string; tags?: string[] }) {
    const tenant = await this.tenants.get(auth.tenantId);
    if (!body.length || body.length > MAX_UPLOAD_BYTES) throw new Problem(413, 'FILE_TOO_LARGE', { mb: MAX_UPLOAD_BYTES / 1024 / 1024 });
    const type = sniffMime(body);
    if (!type) throw new Problem(415, 'FILE_TYPE_NOT_ALLOWED');
    const kind = meta.kind ?? 'other';
    return this.db.tx(this.ctx(auth), async (tx) => {
      const c = await tx.one<Record<string, any>>('SELECT id, folder_name FROM clients WHERE id = $1', [clientId]);
      if (!c) return this.access.deny(tx, auth, 'client', clientId);
      let contract: string | null = null;
      if (meta.loanId) {
        const l = await tx.one<{ contract: string }>('SELECT contract FROM loans WHERE id = $1 AND client_id = $2', [meta.loanId, clientId]);
        if (!l) throw new Problem(422, 'VALIDATION_FAILED', {}, [{ field: 'loanId', message: 'other' }]);
        contract = l.contract;
      }
      const stamp = this.clock.localStamp(tenant.timezone);
      const display = (meta.name ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 160);
      const fileName = documentFileName(tenant.lang, { stamp, kind, contract, label: display || null, ext: type.ext });
      const row = await this.save(tx, tenant.id, {
        clientId, loanId: meta.loanId ?? null, kind, name: display || fileName, fileName, mime: type.mime, body, source: 'manual',
        tags: [...new Set((meta.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20), createdBy: auth.userId,
      });
      await this.audit.log(tx, 'document.uploaded', 'document', row.id, { after: { clientId, loanId: meta.loanId ?? null, kind, size: body.length, sha256: row.sha256 } });
      return this.json({ ...row, folder_name: c.folder_name, contract }, tenant.lang);
    });
  }

  /**
   * Manifiesto de la carpeta COROC (§16.2–16.3). La app lo usa para mantener el espejo local: carpetas, archivo
   * `.coroc-id` de cada cliente, archivos vigentes y archivos reemplazados que debe retirar. Con `since` solo trae lo que
   * cambió; se pagina por documentos.
   */
  async manifest(auth: AuthContext, q: { since?: string; after?: string; limit?: number }) {
    const tenant = await this.tenants.get(auth.tenantId);
    const lang = tenant.lang;
    const limit = Math.min(5000, Math.max(1, q.limit ?? 2000));
    return this.db.tx(this.ctx(auth), async (tx) => {
      const now = (await tx.one<{ now: Date }>('SELECT now() AS now'))!.now;
      const since = q.since ? new Date(q.since) : null;
      if (since && Number.isNaN(since.getTime())) throw new Problem(422, 'VALIDATION_FAILED', {}, [{ field: 'since', message: 'format' }]);
      const firstPage = !q.after;
      let clients: { id: string; code: string; folderName: string; marker: string; contracts: string[] }[] = [];
      if (firstPage) {
        const rows = await tx.many<{ id: string; code: string; folder_name: string; contracts: string[] }>(
          `SELECT c.id, c.code, c.folder_name, coalesce(array_agg(l.contract ORDER BY l.created_at) FILTER (WHERE l.id IS NOT NULL), '{}') AS contracts
             FROM clients c LEFT JOIN loans l ON l.client_id = c.id
            WHERE $1::timestamptz IS NULL OR c.updated_at >= $1 OR c.created_at >= $1 OR l.created_at >= $1
            GROUP BY c.id ORDER BY c.code`,
          [since],
        );
        clients = rows.map((r) => ({ id: r.id, code: r.code, folderName: r.folder_name, marker: `${r.folder_name}/${CLIENT_MARKER}`, contracts: r.contracts }));
      }
      const params: unknown[] = [since];
      let cursorSql = '';
      if (q.after) {
        try {
          const [at, id] = JSON.parse(Buffer.from(q.after, 'base64url').toString()) as [string, string];
          params.push(at, id);
          cursorSql = 'AND (d.updated_at, d.id) > ($2::timestamptz, $3::uuid)';
        } catch {
          throw new Problem(422, 'VALIDATION_FAILED', {}, [{ field: 'after', message: 'format' }]);
        }
      }
      // Sin `since` solo interesan los vigentes; con `since`, también los reemplazados para retirarlos del espejo.
      const rows = await tx.many<Record<string, any>>(
        `${this.select} WHERE ($1::timestamptz IS NULL AND NOT d.superseded OR $1::timestamptz IS NOT NULL AND d.updated_at >= $1) ${cursorSql}
          ORDER BY d.updated_at, d.id LIMIT ${limit + 1}`,
        params,
      );
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        lang,
        full: !since,
        generatedAt: new Date(now).toISOString(),
        // Se solapan 5 minutos con la consulta siguiente: una transacción que empezó antes y confirmó después no se pierde.
        nextSince: new Date(new Date(now).getTime() - 5 * 60_000).toISOString(),
        // Estructura (§16.3): carpetas de primer nivel y las cinco subcarpetas de cada contrato, en el idioma de la empresa.
        rootFolders: rootFolders(lang),
        subfolders: [...SUBFOLDERS[lang]],
        clients,
        files: page.filter((r) => !r.superseded).map((r) => ({
          documentId: r.id, clientId: r.client_id ?? null, path: [...documentFolder(lang, { kind: r.kind, clientFolder: r.folder_name ?? null, contract: r.contract ?? null }), r.file_name].join('/'),
          size: Number(r.size_bytes), sha256: r.sha256, updatedAt: new Date(r.updated_at).toISOString(),
        })),
        removed: page.filter((r) => r.superseded).map((r) => r.id),
        nextPage: rows.length > limit && last ? Buffer.from(JSON.stringify([new Date(last.updated_at).toISOString(), last.id])).toString('base64url') : null,
      };
    });
  }
}
