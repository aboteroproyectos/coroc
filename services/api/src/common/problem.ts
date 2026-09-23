import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { pickLang, t, type Lang } from './i18n.js';

export interface FieldError {
  field: string;
  message: string;
}

/**
 * Error de dominio con código estable (contrato OpenAPI) y texto traducido al idioma del usuario.
 * Se serializa como `application/problem+json` (RFC 9457).
 */
export class Problem extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly vars: Record<string, string | number> = {},
    public readonly errors: FieldError[] = [],
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
  static notFound(): Problem {
    return new Problem(404, 'NOT_FOUND');
  }
  static forbidden(): Problem {
    return new Problem(403, 'FORBIDDEN');
  }
}

/** Traduce códigos de PostgreSQL que la aplicación espera (no filtra detalles internos). */
function fromPg(err: { code?: string; constraint?: string }): Problem | null {
  switch (err.code) {
    case '42501': // violación de RLS: se trata como inexistente para no revelar datos de otra empresa
      return Problem.notFound();
    case '40001':
    case '40P01':
      return new Problem(409, 'VERSION_CONFLICT');
    case '23P01':
      if (err.constraint?.startsWith('rate_caps')) return new Problem(409, 'RATE_CAP_OVERLAP');
      return null;
    default:
      return null;
  }
}

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly log = new Logger('Problem');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request & { auth?: { lang?: Lang } }>();
    const res = http.getResponse<Response>();
    const lang = pickLang(req.auth?.lang, req.headers['accept-language']);
    let p: Problem | null = exception instanceof Problem ? exception : null;
    if (!p && exception && typeof exception === 'object' && 'code' in exception) {
      p = fromPg(exception as { code?: string });
      // Una violación de RLS nunca debería ocurrir en uso normal: se registra (sin datos personales) para investigarla.
      if (p && (exception as { code?: string }).code === '42501') this.log.warn(`RLS/permiso denegado en ${req.method} ${req.route?.path ?? ''}: ${(exception as unknown as Error).message}`);
    }
    if (!p && exception instanceof HttpException) {
      const status = exception.getStatus();
      p = new Problem(status, status === 404 ? 'NOT_FOUND' : status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : status === 413 || status === 400 ? 'VALIDATION_FAILED' : 'INTERNAL');
    }
    if (!p) {
      // Sin datos personales: solo el tipo de error y la pila, nunca el cuerpo de la petición.
      const e = exception as Error;
      this.log.error(`${e?.name ?? 'Error'} en ${req.method} ${req.route?.path ?? 'ruta'}: ${e?.message ?? ''}`, e?.stack);
      p = new Problem(HttpStatus.INTERNAL_SERVER_ERROR, 'INTERNAL');
    }
    const body = {
      type: `https://docs.coroc.app/problems/${p.code.toLowerCase().replace(/_/g, '-')}`,
      title: t(lang, `errors.${p.code}.title`, p.vars),
      status: p.status,
      detail: t(lang, `errors.${p.code}.detail`, p.vars),
      code: p.code,
      ...(p.errors.length ? { errors: p.errors.map((e) => ({ field: e.field, message: t(lang, `validation.${e.message}`) })) } : {}),
      ...p.extra,
    };
    res.status(p.status).type('application/problem+json').send(JSON.stringify(body));
  }
}
