import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEMPLATES,
  EMAIL_SUBJECTS,
  MESSAGE_EVENTS,
  RULESET_CO_LEY_2300,
  effectiveRuleSet,
  evaluateContact,
  fromLocalDateTime,
  insideServiceWindow,
  isOptOut,
  mailtoLink,
  renderTemplate,
  templateVariables,
  toLocalDateTime,
  validateTemplate,
  whatsappLink,
} from '../src/index.js';

describe('plantillas de mensajes (§11.3)', () => {
  it('las plantillas por defecto pasan el validador en los tres idiomas', () => {
    for (const lang of ['es', 'pt-BR', 'en'] as const) {
      for (const ev of MESSAGE_EVENTS) {
        expect(validateTemplate(DEFAULT_TEMPLATES[lang][ev]), `${lang}/${ev}`).toEqual([]);
        expect(validateTemplate(EMAIL_SUBJECTS[lang][ev]), `${lang}/${ev} asunto`).toEqual([]);
      }
    }
  });

  it('los recordatorios y los vencidos llevan el enlace de carga; los recibos, el enlace de descarga', () => {
    for (const lang of ['es', 'pt-BR', 'en'] as const) {
      expect(templateVariables(DEFAULT_TEMPLATES[lang].reminder)).toContain('enlace_carga');
      expect(templateVariables(DEFAULT_TEMPLATES[lang].overdue)).toContain('enlace_carga');
      expect(templateVariables(DEFAULT_TEMPLATES[lang].receipt)).toContain('enlace_recibo');
      expect(templateVariables(DEFAULT_TEMPLATES[lang].payoff)).toContain('enlace_recibo');
    }
  });

  it('sustituye variables y deja vacías las que no tienen valor', () => {
    const out = renderTemplate('Hola {{nombre}} {{ apellidos }}, saldo {{saldo}}.', { nombre: 'María José', apellidos: 'Pérez Gómez' });
    expect(out).toBe('Hola María José Pérez Gómez, saldo .');
  });

  it('el validador bloquea amenazas, preguntar la causa, terceros y datos sensibles', () => {
    const code = (s: string) => validateTemplate(s).map((i) => i.code);
    expect(code('Si no paga iniciaremos un proceso judicial y el embargo de sus bienes.')).toContain('THREAT');
    expect(code('Último aviso: visitaremos su casa.')).toContain('THREAT');
    expect(code('Se não pagar, haverá penhora.')).toContain('THREAT');
    expect(code('Pay now or else.')).toContain('THREAT');
    expect(code('Cuéntanos por qué no has pagado la cuota.')).toContain('ASKS_CAUSE');
    expect(code('Indique el motivo del incumplimiento.')).toContain('ASKS_CAUSE');
    expect(code('Por que você não pagou?')).toContain('ASKS_CAUSE');
    expect(code("Why haven't you paid?")).toContain('ASKS_CAUSE');
    expect(code('Le avisaremos a tu familia y a tu jefe.')).toContain('THIRD_PARTY');
    expect(code('Vamos falar com seus vizinhos.')).toContain('THIRD_PARTY');
    expect(code('We will contact your employer.')).toContain('THIRD_PARTY');
    expect(code('Envíanos el número completo de tu tarjeta para verificar.')).toContain('SENSITIVE_DATA');
    expect(code('Confirme su clave por este medio.')).toContain('SENSITIVE_DATA');
    expect(code('Envie seu CPF e a senha.')).toContain('SENSITIVE_DATA');
    expect(code('Please send your card number.')).toContain('SENSITIVE_DATA');
  });

  it('no bloquea textos respetuosos que mencionan el pago, la referencia o el teléfono de la empresa', () => {
    expect(validateTemplate('Te vamos a enviar el recibo. Indica la referencia del pago. Escríbenos al {{telefono_empresa}}.')).toEqual([]);
    expect(validateTemplate('Consigna a la cuenta de {{empresa}} y envía el comprobante: {{enlace_carga}}')).toEqual([]);
  });

  it('rechaza variables desconocidas, llaves sin cerrar, vacío y exceso de longitud', () => {
    expect(validateTemplate('Hola {{cedula}}')).toEqual([{ code: 'UNKNOWN_VARIABLE', match: 'cedula' }]);
    expect(validateTemplate('Hola {{nombre}').map((i) => i.code)).toContain('UNBALANCED_BRACES');
    expect(validateTemplate('   ')).toEqual([{ code: 'EMPTY' }]);
    expect(validateTemplate('a'.repeat(1025)).map((i) => i.code)).toEqual(['TOO_LONG']);
  });
});

describe('exclusión y modo asistido (§11.1, §20.1)', () => {
  it('reconoce SALIR, SAIR y STOP sin importar mayúsculas, tildes ni signos', () => {
    for (const t of ['SALIR', 'salir.', ' Sair ', 'STOP!', 'stop', 'Baja']) expect(isOptOut(t), t).toBe(true);
    for (const t of ['quiero salir de la deuda', 'Hola', '', null]) expect(isOptOut(t)).toBe(false);
  });

  it('arma los enlaces de WhatsApp y de correo con el texto listo', () => {
    expect(whatsappLink('+573157778899', 'Hola María, ¿todo bien?')).toBe('https://wa.me/573157778899?text=Hola%20Mar%C3%ADa%2C%20%C2%BFtodo%20bien%3F');
    expect(mailtoLink('maria.perez@example.com', 'Recibo', 'Gracias & saludos')).toBe('mailto:maria.perez@example.com?subject=Recibo&body=Gracias%20%26%20saludos');
  });

  it('ventana de atención de 24 horas de WhatsApp', () => {
    const now = new Date('2026-10-13T15:00:00Z');
    expect(insideServiceWindow(new Date('2026-10-12T15:00:01Z'), now)).toBe(true);
    expect(insideServiceWindow(new Date('2026-10-12T15:00:00Z'), now)).toBe(false);
    expect(insideServiceWindow(null, now)).toBe(false);
  });
});

describe('zona horaria del deudor y presets por país (§11.4)', () => {
  it('convierte entre UTC y la hora local, también con horario de verano', () => {
    expect(toLocalDateTime(new Date('2026-10-11T15:00:00Z'), 'America/Bogota')).toBe('2026-10-11T10:00');
    expect(fromLocalDateTime('2026-10-13T07:00', 'America/Bogota').toISOString()).toBe('2026-10-13T12:00:00.000Z');
    expect(fromLocalDateTime('2026-07-01T08:00', 'America/New_York').toISOString()).toBe('2026-07-01T12:00:00.000Z');
    expect(fromLocalDateTime('2026-12-01T08:00', 'America/New_York').toISOString()).toBe('2026-12-01T13:00:00.000Z');
    // 8-mar-2026 02:30 no existe en Nueva York: pasa a la primera hora válida.
    expect(toLocalDateTime(fromLocalDateTime('2026-03-08T02:30', 'America/New_York'), 'America/New_York')).toBe('2026-03-08T03:30');
  });

  it('un preset sin revisión legal no rige: se aplica el de Colombia con los festivos del país', () => {
    const br = effectiveRuleSet('BR_CDC_TEMPLATE', 'BR', false);
    expect(br.id).toBe(RULESET_CO_LEY_2300.id);
    expect(br.country).toBe('BR');
    expect(effectiveRuleSet('BR_CDC_TEMPLATE', 'BR', true).id).toBe('BR_CDC_TEMPLATE');
    expect(effectiveRuleSet(null, 'CO', false).id).toBe('CO_LEY_2300_2023');
    const us = effectiveRuleSet('US_FDCPA_REG_F_TEMPLATE', 'US', true);
    // Domingo 20:30 en EE. UU. está dentro de la franja 8:00–21:00.
    expect(evaluateContact({ kind: 'collection', channel: 'email', requestedAt: '2026-10-11T20:30' }, [], us).decision).toBe('send');
  });

  it('un canal por semana: si ya hubo contacto de cobranza por WhatsApp, el correo de cobranza se bloquea', () => {
    const history = [{ at: '2026-10-13T08:00', kind: 'collection' as const, channel: 'whatsapp' as const }];
    const d = evaluateContact({ kind: 'collection', channel: 'email', requestedAt: '2026-10-15T09:00' }, history, RULESET_CO_LEY_2300);
    expect(d).toMatchObject({ decision: 'block', reasons: [{ code: 'CHANNEL_WEEK', detail: 'whatsapp' }] });
  });
});
