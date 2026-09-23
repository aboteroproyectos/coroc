import type { Channel, MessageKind } from './compliance.js';
import type { Lang } from './receipt.js';
import { stripAccents } from './text.js';

/**
 * Mensajería automática (§11.3): plantillas por evento e idioma, variables, validador de contenido y palabras de
 * exclusión. Todo es puro para que la API, los workers y las pruebas usen la misma implementación.
 */
export type MessageEvent = 'welcome' | 'reminder' | 'overdue' | 'receipt' | 'statement' | 'payoff' | 'manual';

export const MESSAGE_EVENTS: MessageEvent[] = ['welcome', 'reminder', 'overdue', 'receipt', 'statement', 'payoff', 'manual'];

/** Variables disponibles (§11.3). Los nombres son parte del contrato con el usuario: no se traducen. */
export const TEMPLATE_VARIABLES = [
  'nombre', 'apellidos', 'contrato', 'valor_cuota', 'fecha_vencimiento', 'cuota_numero', 'cuotas_restantes', 'saldo',
  'valor_pagado', 'enlace_carga', 'enlace_recibo', 'empresa', 'telefono_empresa',
] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];
export type TemplateValues = Partial<Record<TemplateVariable, string>>;

/**
 * Tipo y canales por defecto de cada evento (§11.3). El recibo sale por el canal por el que llegó el comprobante; si
 * llegó por un canal que no es de mensajería (portal, carpeta, efectivo), por WhatsApp.
 */
export const EVENT_DEFAULTS: Record<MessageEvent, { kind: MessageKind; channels: Channel[]; enabled: boolean }> = {
  welcome: { kind: 'transactional', channels: ['whatsapp', 'email'], enabled: true },
  reminder: { kind: 'collection', channels: ['whatsapp'], enabled: true },
  overdue: { kind: 'collection', channels: ['whatsapp'], enabled: true },
  receipt: { kind: 'transactional', channels: ['whatsapp'], enabled: true },
  statement: { kind: 'transactional', channels: ['email'], enabled: true },
  payoff: { kind: 'transactional', channels: ['whatsapp', 'email'], enabled: true },
  manual: { kind: 'collection', channels: ['whatsapp'], enabled: true },
};

/** Límite del cuerpo de una plantilla de WhatsApp aprobada por Meta, que es también el del editor. */
export const TEMPLATE_MAX_LENGTH = 1024;

const OPT_OUT_HINT: Record<Lang, string> = {
  es: 'Si no quieres recibir más mensajes, responde SALIR.',
  'pt-BR': 'Se não quiser mais receber mensagens, responda SAIR.',
  en: 'To stop receiving messages, reply STOP.',
};

/** Plantillas por defecto, en tono respetuoso y sin datos sensibles. Cada empresa puede editarlas. */
export const DEFAULT_TEMPLATES: Record<Lang, Record<MessageEvent, string>> = {
  es: {
    welcome:
      'Hola {{nombre}}, te damos la bienvenida a {{empresa}}. Tu préstamo {{contrato}} quedó registrado. La primera cuota es de {{valor_cuota}} y vence el {{fecha_vencimiento}}. Consulta tu plan y envía tus comprobantes aquí: {{enlace_carga}}',
    reminder:
      'Hola {{nombre}}, te recordamos que la cuota {{cuota_numero}} de tu préstamo {{contrato}}, por {{valor_cuota}}, vence el {{fecha_vencimiento}}. Cuando pagues, envía el comprobante aquí: {{enlace_carga}}',
    overdue:
      'Hola {{nombre}}, la cuota {{cuota_numero}} de tu préstamo {{contrato}}, por {{valor_cuota}}, venció el {{fecha_vencimiento}}. Si ya pagaste, envía el comprobante aquí: {{enlace_carga}}. Si necesitas ayuda, escríbenos al {{telefono_empresa}}.',
    receipt:
      '¡Gracias por tu pago, {{nombre}}! Recibimos {{valor_pagado}} para tu préstamo {{contrato}}. Tu nuevo saldo es {{saldo}} y te quedan {{cuotas_restantes}} cuotas. Descarga tu recibo aquí: {{enlace_recibo}}',
    statement:
      'Hola {{nombre}}, adjuntamos el estado de cuenta de tu préstamo {{contrato}}. Tu saldo es {{saldo}}. También puedes descargarlo aquí: {{enlace_recibo}}',
    payoff:
      '¡Felicitaciones, {{nombre}}! Pagaste por completo tu préstamo {{contrato}}. Descarga tu paz y salvo aquí: {{enlace_recibo}}. Gracias por confiar en {{empresa}}.',
    manual: 'Hola {{nombre}}, te escribimos de {{empresa}} sobre tu préstamo {{contrato}}.',
  },
  'pt-BR': {
    welcome:
      'Olá {{nombre}}, boas-vindas à {{empresa}}. Seu empréstimo {{contrato}} foi registrado. A primeira parcela é de {{valor_cuota}} e vence em {{fecha_vencimiento}}. Consulte seu plano e envie seus comprovantes aqui: {{enlace_carga}}',
    reminder:
      'Olá {{nombre}}, lembramos que a parcela {{cuota_numero}} do seu empréstimo {{contrato}}, de {{valor_cuota}}, vence em {{fecha_vencimiento}}. Quando pagar, envie o comprovante aqui: {{enlace_carga}}',
    overdue:
      'Olá {{nombre}}, a parcela {{cuota_numero}} do seu empréstimo {{contrato}}, de {{valor_cuota}}, venceu em {{fecha_vencimiento}}. Se já pagou, envie o comprovante aqui: {{enlace_carga}}. Se precisar de ajuda, fale conosco pelo {{telefono_empresa}}.',
    receipt:
      'Obrigado pelo seu pagamento, {{nombre}}! Recebemos {{valor_pagado}} para o seu empréstimo {{contrato}}. Seu novo saldo é {{saldo}} e restam {{cuotas_restantes}} parcelas. Baixe seu recibo aqui: {{enlace_recibo}}',
    statement:
      'Olá {{nombre}}, enviamos o extrato do seu empréstimo {{contrato}}. Seu saldo é {{saldo}}. Você também pode baixá-lo aqui: {{enlace_recibo}}',
    payoff:
      'Parabéns, {{nombre}}! Você quitou o seu empréstimo {{contrato}}. Baixe sua declaração de quitação aqui: {{enlace_recibo}}. Obrigado por confiar na {{empresa}}.',
    manual: 'Olá {{nombre}}, escrevemos da {{empresa}} sobre o seu empréstimo {{contrato}}.',
  },
  en: {
    welcome:
      'Hi {{nombre}}, welcome to {{empresa}}. Your loan {{contrato}} has been set up. The first installment is {{valor_cuota}}, due on {{fecha_vencimiento}}. See your plan and send your payment receipts here: {{enlace_carga}}',
    reminder:
      'Hi {{nombre}}, a friendly reminder that installment {{cuota_numero}} of your loan {{contrato}}, for {{valor_cuota}}, is due on {{fecha_vencimiento}}. Once you pay, send the receipt here: {{enlace_carga}}',
    overdue:
      'Hi {{nombre}}, installment {{cuota_numero}} of your loan {{contrato}}, for {{valor_cuota}}, was due on {{fecha_vencimiento}}. If you have already paid, send the receipt here: {{enlace_carga}}. If you need help, contact us at {{telefono_empresa}}.',
    receipt:
      'Thank you for your payment, {{nombre}}! We received {{valor_pagado}} for your loan {{contrato}}. Your new balance is {{saldo}} with {{cuotas_restantes}} installments left. Download your receipt here: {{enlace_recibo}}',
    statement:
      'Hi {{nombre}}, here is the statement for your loan {{contrato}}. Your balance is {{saldo}}. You can also download it here: {{enlace_recibo}}',
    payoff:
      'Congratulations, {{nombre}}! Your loan {{contrato}} is paid in full. Download your payoff letter here: {{enlace_recibo}}. Thank you for trusting {{empresa}}.',
    manual: 'Hi {{nombre}}, this is {{empresa}} writing about your loan {{contrato}}.',
  },
};

/** Asuntos de los correos por evento. */
export const EMAIL_SUBJECTS: Record<Lang, Record<MessageEvent, string>> = {
  es: {
    welcome: 'Bienvenida · préstamo {{contrato}}', reminder: 'Recordatorio de cuota · {{contrato}}', overdue: 'Cuota vencida · {{contrato}}',
    receipt: 'Gracias por tu pago · {{contrato}}', statement: 'Estado de cuenta · {{contrato}}', payoff: 'Paz y salvo · {{contrato}}', manual: '{{empresa}} · {{contrato}}',
  },
  'pt-BR': {
    welcome: 'Boas-vindas · empréstimo {{contrato}}', reminder: 'Lembrete de parcela · {{contrato}}', overdue: 'Parcela vencida · {{contrato}}',
    receipt: 'Obrigado pelo seu pagamento · {{contrato}}', statement: 'Extrato · {{contrato}}', payoff: 'Declaração de quitação · {{contrato}}', manual: '{{empresa}} · {{contrato}}',
  },
  en: {
    welcome: 'Welcome · loan {{contrato}}', reminder: 'Installment reminder · {{contrato}}', overdue: 'Installment past due · {{contrato}}',
    receipt: 'Thank you for your payment · {{contrato}}', statement: 'Account statement · {{contrato}}', payoff: 'Payoff letter · {{contrato}}', manual: '{{empresa}} · {{contrato}}',
  },
};

export function optOutHint(lang: Lang): string {
  return OPT_OUT_HINT[lang];
}

const VAR_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** Variables que usa un cuerpo, en orden de aparición y sin repetir. */
export function templateVariables(body: string): string[] {
  return [...new Set([...body.matchAll(VAR_RE)].map((m) => m[1]!))];
}

/** Sustituye las variables. Las que no tienen valor quedan vacías; el validador ya rechazó las desconocidas. */
export function renderTemplate(body: string, values: TemplateValues): string {
  return body.replace(VAR_RE, (_, name: string) => values[name as TemplateVariable] ?? '').replace(/[ \t]{2,}/g, ' ').trim();
}

export type TemplateIssueCode = 'EMPTY' | 'TOO_LONG' | 'UNKNOWN_VARIABLE' | 'UNBALANCED_BRACES' | 'THREAT' | 'ASKS_CAUSE' | 'THIRD_PARTY' | 'SENSITIVE_DATA';

export interface TemplateIssue {
  code: TemplateIssueCode;
  /** Fragmento que disparó la regla o nombre de la variable. */
  match?: string;
}

/** Texto normalizado para las reglas: sin tildes, en minúsculas y con espacios simples. */
const norm = (s: string) => stripAccents(s).toLowerCase().replace(/\s+/g, ' ');

/**
 * Reglas del validador (§11.3), en los tres idiomas a la vez porque una empresa puede escribir en cualquiera. Se
 * aplican sobre el texto sin tildes. Son deliberadamente conservadoras: ante la duda, bloquean y el usuario reescribe.
 */
const RULES: { code: TemplateIssueCode; re: RegExp }[] = [
  // Amenazas o lenguaje intimidante.
  {
    code: 'THREAT',
    re: /\b(embarg\w*|demanda(r|remos|mos)?|proceso judicial|accion(es)? legal(es)?|carcel|prision|policia|atengase|atenerse a las consecuencias|consecuencias|ultimo aviso|iremos a (su|tu) (casa|trabajo|negocio)|visita(remos)? (a )?(su|tu) (casa|trabajo|negocio)|lo vamos a buscar|te vamos a buscar|penhora|processo judicial|acao judicial|cadeia|prisao|ultimo aviso|arcar com as consequencias|lawsuit|legal action|garnish\w*|seize|jail|arrest\w*|police|final warning|or else|we will come to your (home|work))\b/,
  },
  // Preguntar la causa del incumplimiento.
  {
    code: 'ASKS_CAUSE',
    re: /(por ?que no (ha |has |a )?(pagado|pago|pagaste|pagou|cancelado)|(motivo|causa|razon) (del|de su|de tu|por la cual|por el que) (no ?pago|incumplimiento|atraso|retraso|mora|no ha pagado)|(motivo|causa|razao) (do|da|pelo qual) (atraso|nao pagamento|inadimplencia)|por que (voce )?nao pagou|why (haven'?t|didn'?t|have not|did not) you pa(y|id)|reason (for|why) (your )?(non-?payment|not paying|missing|late payment|the delay))/,
  },
  // Menciones a terceros: familia, vecinos, empleador, referencias, compañeros.
  {
    code: 'THIRD_PARTY',
    re: /\b(familia(r|res)?|esposa|esposo|padres|hijos|vecin\w*|jefe|empleador|empresa donde trabaja|companeros de trabajo|(sus|tus) referencias|referencias personales|conocidos|familiares|vizinh\w*|chefe|empregador|colegas|referencias pessoais|parentes|family|relatives|neighbou?rs?|employer|boss|co-?workers|your references)\b/,
  },
  // Solicitar números completos de tarjeta, cuenta o documento de identidad, o claves.
  {
    code: 'SENSITIVE_DATA',
    re: /\b(envi\w*|comparta\w*|compart\w*|indique\w*|indica\w*|confirm\w*|digit\w*|escrib\w*|respond\w*|proporcion\w*|dinos|diganos|informe\w*|mande\w*|passe\w*|send|share|provide|confirm|reply with|tell us|enter)\b.{0,50}\b(numero (completo )?de (la |su |tu )?(tarjeta|cuenta|cedula|documento|identificacion)|numero do (cartao|documento)|numero da conta|cpf|rg|clave|contrasena|senha|cvv|cvc|pin|card number|account number|social security|ssn|password|passcode)\b/,
  },
];

/** Valida el cuerpo de una plantilla antes de guardarla o de enviar un mensaje manual. */
export function validateTemplate(body: string): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  if (!body.trim()) return [{ code: 'EMPTY' }];
  if (body.length > TEMPLATE_MAX_LENGTH) issues.push({ code: 'TOO_LONG', match: String(body.length) });
  const opens = (body.match(/\{\{/g) ?? []).length;
  const closes = (body.match(/\}\}/g) ?? []).length;
  if (opens !== closes || opens !== [...body.matchAll(VAR_RE)].length) issues.push({ code: 'UNBALANCED_BRACES' });
  for (const v of templateVariables(body)) {
    if (!(TEMPLATE_VARIABLES as readonly string[]).includes(v)) issues.push({ code: 'UNKNOWN_VARIABLE', match: v });
  }
  // Las reglas de contenido no miran los nombres de variables: {{telefono_empresa}} no es un tercero.
  const text = norm(body.replace(VAR_RE, ' '));
  for (const r of RULES) {
    const m = r.re.exec(text);
    if (m) issues.push({ code: r.code, match: m[0].trim() });
  }
  return issues;
}

/** Palabras de exclusión (§20.1): el mensaje completo debe ser la palabra, sin importar mayúsculas, tildes ni signos. */
const OPT_OUT_WORDS = new Set(['salir', 'sair', 'stop', 'baja', 'unsubscribe', 'parar', 'cancelar suscripcion']);

export function isOptOut(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = norm(text).replace(/[^a-z ]/g, '').trim();
  return OPT_OUT_WORDS.has(t);
}

/** Enlace de WhatsApp con el texto listo para el modo asistido (§11.1, modo B). */
export function whatsappLink(phoneE164: string, text: string): string {
  return `https://wa.me/${phoneE164.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}

/** Enlace `mailto:` para enviar un correo desde el programa del usuario en el modo asistido. */
export function mailtoLink(email: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(email).replace(/%40/g, '@')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Ventana de atención de WhatsApp: fuera de ella solo se pueden enviar plantillas aprobadas por Meta (§11.1). */
export const WHATSAPP_SERVICE_WINDOW_MS = 24 * 3600_000;

export function insideServiceWindow(lastInboundAt: Date | null | undefined, now: Date): boolean {
  return !!lastInboundAt && now.getTime() - lastInboundAt.getTime() < WHATSAPP_SERVICE_WINDOW_MS;
}
