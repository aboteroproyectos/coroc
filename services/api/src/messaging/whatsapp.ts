import type { AppConfig } from '../config.js';

/** Resultado de un envío por la Cloud API, ya clasificado para decidir qué hacer con el mensaje. */
export type CloudResult =
  | { kind: 'sent'; id: string }
  /** La cuenta o el número fueron bloqueados o suspendidos por Meta: la empresa pasa al modo asistido (CA-20). */
  | { kind: 'suspended'; code: number }
  /** Fuera de la ventana de 24 horas sin plantilla aprobada: este mensaje sigue por el modo asistido. */
  | { kind: 'window'; code: number }
  /** El destinatario no puede recibirlo (número sin WhatsApp, parámetros inválidos): no se reintenta. */
  | { kind: 'permanent'; code: number }
  /** Error transitorio (límite de velocidad, caída del servicio, token vencido): se reintenta. */
  | { kind: 'retry'; code: number };

/**
 * Códigos de error de la Cloud API que indican que la cuenta no puede enviar
 * (https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes): 368 bloqueo temporal por infringir
 * políticas, 131031 cuenta bloqueada, 131042 problema de pago de la cuenta, 131045 número sin registrar.
 */
export const SUSPENSION_CODES = new Set([368, 131031, 131042, 131045]);
/** 131047: han pasado más de 24 horas desde la última respuesta del cliente (re-engagement). */
const WINDOW_CODES = new Set([131047]);
/** 131026 no entregable, 131021 destinatario = remitente, 131051 tipo no soportado, 132000/132001/132012 plantilla o parámetros, 100 parámetro inválido. */
const PERMANENT_CODES = new Set([100, 131021, 131026, 131051, 132000, 132001, 132012]);

export function classify(code: number): CloudResult['kind'] {
  if (SUSPENSION_CODES.has(code)) return 'suspended';
  if (WINDOW_CODES.has(code)) return 'window';
  if (PERMANENT_CODES.has(code)) return 'permanent';
  return 'retry';
}

export type CloudPayload =
  | { type: 'text'; body: string }
  | { type: 'template'; name: string; language: string; parameters: string[] };

/**
 * WhatsApp Cloud API · `POST /{phone-number-id}/messages`
 * (https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages). Dentro de la ventana de atención se
 * envía texto libre; fuera, solo una plantilla aprobada por Meta, con los valores como parámetros posicionales
 * `{{1}}`, `{{2}}`… en el mismo orden en que aparecen las variables en la plantilla de COROC.
 */
export async function sendCloudMessage(cfg: AppConfig['whatsapp'], account: { phoneNumberId: string; token: string }, toE164: string, p: CloudPayload): Promise<CloudResult> {
  const to = toE164.replace(/\D/g, '');
  const body =
    p.type === 'text'
      ? { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: true, body: p.body } }
      : {
          messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'template',
          template: {
            name: p.name,
            language: { code: p.language },
            ...(p.parameters.length ? { components: [{ type: 'body', parameters: p.parameters.map((text) => ({ type: 'text', text: text || '-' })) }] } : {}),
          },
        };
  let res: Response;
  try {
    res = await fetch(`${cfg.graphUrl}/${cfg.graphVersion}/${encodeURIComponent(account.phoneNumberId)}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${account.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { kind: 'retry', code: 0 };
  }
  const json = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[]; error?: { code?: number } };
  const id = json.messages?.[0]?.id;
  if (res.ok && id) return { kind: 'sent', id };
  const code = Number(json.error?.code ?? res.status);
  return { kind: classify(code), code } as CloudResult;
}

/** Avisos de la cuenta (`account_update`) que significan que la empresa ya no puede enviar por la Cloud API. */
export function isSuspensionUpdate(value: Record<string, any>): boolean {
  const event = String(value.event ?? '').toUpperCase();
  const ban = value.ban_info?.waba_ban_state;
  const states = (Array.isArray(ban) ? ban : ban ? [ban] : []).map((s: unknown) => String(s).toUpperCase());
  if (states.some((s: string) => s === 'DISABLE' || s === 'SCHEDULE_FOR_DISABLE')) return true;
  return event === 'DISABLED_UPDATE' || event === 'ACCOUNT_RESTRICTION' || event === 'BAN';
}
