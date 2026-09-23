import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import YAML from 'yaml';
import { Problem, type FieldError } from './problem.js';

// El contrato OpenAPI 3.1 es la fuente de verdad: los cuerpos y parámetros se validan contra él en tiempo de
// ejecución y las respuestas se verifican en las pruebas (contract.test.ts). Así el contrato no puede desviarse del código.
export const OPENAPI_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../openapi.yaml');
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ?? addFormatsModule) as (ajv: Ajv2020) => Ajv2020;

type Json = Record<string, any>;
const rewrite = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(rewrite);
  if (node && typeof node === 'object') {
    const out: Json = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string') out[k] = v.replace('#/components/schemas/', 'coroc#/$defs/');
      else if (k === 'example' || k === 'readOnly') continue;
      else out[k] = rewrite(v);
    }
    return out;
  }
  return node;
};

export interface OperationValidators {
  method: string;
  path: string;
  body?: ValidateFunction;
  query?: ValidateFunction;
  queryTypes: Record<string, string>;
  params?: ValidateFunction;
  responses: Record<string, ValidateFunction | undefined>;
}

export class Contract {
  readonly doc: Json;
  readonly ajv: Ajv2020;
  readonly ops = new Map<string, OperationValidators>();

  constructor(file = OPENAPI_PATH) {
    this.doc = YAML.parse(fs.readFileSync(file, 'utf8'));
    this.ajv = new Ajv2020({ strict: false, allErrors: true, coerceTypes: false, useDefaults: true });
    addFormats(this.ajv);
    const defs = rewrite(this.doc.components.schemas) as Json;
    this.ajv.addSchema({ $id: 'coroc', $defs: defs });
    const paramRef = (p: Json): Json => (p.$ref ? this.doc.components.parameters[p.$ref.split('/').pop()] : p);
    for (const [route, item] of Object.entries<Json>(this.doc.paths)) {
      for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
        const op = item[method];
        if (!op?.operationId) continue;
        const params = (op.parameters ?? []).map(paramRef);
        const group = (where: string) => {
          const ps = params.filter((p: Json) => p.in === where);
          if (!ps.length) return undefined;
          return this.ajv.compile({
            type: 'object',
            properties: Object.fromEntries(ps.map((p: Json) => [p.name, rewrite(p.schema)])),
            required: ps.filter((p: Json) => p.required).map((p: Json) => p.name),
          });
        };
        const bodySchema = op.requestBody?.content?.['application/json']?.schema;
        const responses: Record<string, ValidateFunction | undefined> = {};
        for (const [code, r] of Object.entries<Json>(op.responses ?? {})) {
          const resp = r.$ref ? this.doc.components.responses[r.$ref.split('/').pop()] : r;
          const s = resp?.content?.['application/json']?.schema ?? resp?.content?.['application/problem+json']?.schema;
          responses[code] = s ? this.ajv.compile(rewrite(s) as Json) : undefined;
        }
        const queryTypes: Record<string, string> = {};
        for (const p of params.filter((x: Json) => x.in === 'query')) {
          const sch = p.schema?.$ref ? this.doc.components.schemas[p.schema.$ref.split('/').pop()] : p.schema;
          queryTypes[p.name] = Array.isArray(sch?.type) ? sch.type[0] : sch?.type ?? 'string';
        }
        this.ops.set(op.operationId, {
          method,
          path: route,
          queryTypes,
          body: bodySchema ? this.ajv.compile(rewrite(bodySchema) as Json) : undefined,
          query: group('query'),
          params: group('path'),
          responses,
        });
      }
    }
  }

  private static fields(errors: ErrorObject[] | null | undefined): FieldError[] {
    return (errors ?? []).map((e) => {
      const missing = e.keyword === 'required' ? `/${(e.params as { missingProperty: string }).missingProperty}` : '';
      const extra = e.keyword === 'additionalProperties' ? `/${(e.params as { additionalProperty: string }).additionalProperty}` : '';
      const field = `${e.instancePath}${missing}${extra}`.replace(/^\//, '').replace(/\//g, '.') || '(body)';
      const known = ['required', 'type', 'format', 'enum', 'pattern', 'minLength', 'maxLength', 'minimum', 'maximum', 'additionalProperties'];
      return { field, message: known.includes(e.keyword) ? e.keyword : 'other' };
    });
  }

  /** Valida y normaliza query (convierte números y booleanos de texto) y cuerpo. Lanza Problem 422 o 404. */
  check(operationId: string, req: { body?: unknown; query?: Json; params?: Json }): void {
    const v = this.ops.get(operationId);
    if (!v) throw new Error(`Operación ${operationId} no existe en el contrato`);
    if (v.params && !v.params(req.params ?? {})) throw Problem.notFound();
    if (v.query) {
      const q: Json = { ...(req.query ?? {}) };
      // Solo se convierten los parámetros que el contrato declara numéricos o booleanos (una búsqueda «7778899» sigue siendo texto).
      for (const [k, val] of Object.entries(q)) {
        const type = v.queryTypes[k];
        if (typeof val !== 'string') continue;
        if ((type === 'integer' || type === 'number') && /^-?\d+(\.\d+)?$/.test(val)) q[k] = Number(val);
        else if (type === 'boolean' && (val === 'true' || val === 'false')) q[k] = val === 'true';
      }
      if (!v.query(q)) throw new Problem(422, 'VALIDATION_FAILED', {}, Contract.fields(v.query.errors));
      Object.assign(req.query ?? {}, q);
    }
    if (v.body) {
      if (!v.body(req.body ?? {})) throw new Problem(422, 'VALIDATION_FAILED', {}, Contract.fields(v.body.errors));
    }
  }
}

let shared: Contract | null = null;
export const contract = (): Contract => (shared ??= new Contract());
