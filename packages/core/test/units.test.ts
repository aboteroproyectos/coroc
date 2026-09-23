import { describe, expect, it } from 'vitest';
import {
  RULESET_CO_LEY_2300,
  accrueLateFees,
  addMonthsClamped,
  allocatePayment,
  buildSchedule,
  checkRateCap,
  dailyLateFeeWithinCap,
  describeCoverage,
  effectiveAnnualRate,
  evaluateContact,
  extractFromText,
  formatMoney,
  identifySender,
  loanEffectiveAnnualRate,
  nameSimilarity,
  normalizePhone,
  parseAmount,
  pickLoan,
  summarize,
  toMinor,
  type ClientRef,
  type LoanTerms,
  replayLoan,
  clientFolderName,
  sanitizeFolderName,
} from '../src/index.js';

const base: LoanTerms = {
  principal: 1_000_000, currency: 'COP', method: 'simple', rate: '0.20', installments: 20,
  frequency: 'daily', disbursementDate: '2026-10-08', country: 'CO',
};

describe('calendario y plan', () => {
  it('mensual: día 31 pasa al último día del mes', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamped('2028-01-31', 1)).toBe('2028-02-29');
    const s = buildSchedule({ ...base, frequency: 'monthly', installments: 3, disbursementDate: '2026-12-31', excludeHolidays: false, collectionDays: [1, 2, 3, 4, 5, 6, 7] });
    expect(s.installments.map((i) => i.dueDate)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
  });

  it('semanal: un vencimiento en festivo pasa al siguiente día de cobro sin desplazar la serie', () => {
    // 5-oct-2026 lunes; serie de lunes: 12-oct (festivo) → 13-oct; 19-oct sigue en lunes
    const s = buildSchedule({ ...base, frequency: 'weekly', installments: 3, disbursementDate: '2026-09-28', firstDueDate: '2026-10-05' });
    expect(s.installments.map((i) => i.dueDate)).toEqual(['2026-10-05', '2026-10-13', '2026-10-19']);
  });

  it('diaria con domingo incluido y sin excluir festivos', () => {
    const s = buildSchedule({ ...base, installments: 4, collectionDays: [1, 2, 3, 4, 5, 6, 7], excludeHolidays: false });
    expect(s.installments.map((i) => i.dueDate)).toEqual(['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12']);
  });

  it('redondeo a múltiplos de $1.000', () => {
    const s = buildSchedule({ ...base, rate: '0.15', installments: 7, roundingUnit: 1000 });
    expect(s.installments.slice(0, 6).every((i) => i.amount === 164_000)).toBe(true);
    expect(s.installments[6]!.amount).toBe(166_000);
    expect(s.totalPayable).toBe(1_150_000);
  });

  it('francés con tasa cero reparte el capital', () => {
    const s = buildSchedule({ ...base, method: 'french', rate: '0', installments: 3, frequency: 'monthly' });
    expect(s.installments.map((i) => i.amount)).toEqual([333_333, 333_333, 333_334]);
  });

  it('BRL en centavos', () => {
    expect(toMinor('1234.56', 'BRL')).toBe(123_456);
    expect(formatMoney(123_456, 'BRL')).toBe('R$ 1.234,56');
    expect(formatMoney(1_200_000, 'COP')).toBe('$ 1.200.000');
    expect(formatMoney(120_000_000, 'USD')).toBe('$1,200,000.00');
  });

  it('rechaza términos inválidos', () => {
    expect(() => buildSchedule({ ...base, principal: 0 })).toThrow();
    expect(() => buildSchedule({ ...base, installments: 0 })).toThrow();
    expect(() => buildSchedule({ ...base, firstDueDate: '2026-10-08' })).toThrow();
  });
});

describe('aplicación de pagos y mora', () => {
  const st = buildSchedule(base).installments.map((i) => ({ number: i.number, dueDate: i.dueDate, amount: i.amount, paid: 0 }));

  it('la mora se cobra primero y el excedente queda como saldo a favor', () => {
    const withFees = accrueLateFees(st, '2026-10-12', { type: 'fixed_daily', value: '1000', graceDays: 0 });
    // cuota 1 vence 9-oct: 3 días → 3.000; cuota 2 vence 10-oct: 2 días → 2.000
    expect(withFees[0]!.lateFeeAccrued).toBe(3000);
    expect(withFees[1]!.lateFeeAccrued).toBe(2000);
    const r = allocatePayment(withFees, 65_000);
    expect(r.lines[0]).toMatchObject({ number: 1, toLateFee: 3000, toInstallment: 60_000, completed: true });
    expect(r.lines[1]).toMatchObject({ number: 2, toLateFee: 2000, toInstallment: 0 });
    const all = allocatePayment(st, 1_300_000);
    expect(all.surplus).toBe(100_000);
    expect(summarize(all.after, '2026-10-12').balance).toBe(0);
  });

  it('resumen con días de mora', () => {
    const s = summarize(st, '2026-10-14');
    expect(s.overdueCount).toBe(3);
    expect(s.daysPastDue).toBe(5);
    expect(s.next).toEqual({ number: 1, dueDate: '2026-10-09', outstanding: 60_000 });
  });

  it('describe la cobertura en portugués e inglés', () => {
    const r = allocatePayment(st, 150_000);
    expect(describeCoverage(r.lines, 'COP', 'pt-BR')).toBe('Parcelas 1 e 2 (quitadas) · Parcela 3 (pagamento parcial COP 30.000)');
    expect(describeCoverage(r.lines, 'COP', 'en')).toBe('Installments 1 and 2 (paid in full) · Installment 3 (partial payment COP 30,000)');
    const big = allocatePayment(st, 360_000);
    expect(describeCoverage(big.lines, 'COP', 'es')).toBe('Cuotas 1–6 (completas)');
  });
});

describe('tasas', () => {
  it('francés 2 % mensual ≈ 26,8 % efectivo anual', () => {
    const ea = loanEffectiveAnnualRate({ ...base, principal: 5_000_000, method: 'french', rate: '0.02', installments: 12, frequency: 'monthly', excludeHolidays: false, collectionDays: [1, 2, 3, 4, 5, 6, 7] });
    expect(ea).toBeGreaterThan(0.26);
    expect(ea).toBeLessThan(0.28);
  });
  it('flujo simple de un año al 10 %', () => {
    expect(effectiveAnnualRate([{ date: '2025-01-01', amount: -1000 }, { date: '2026-01-01', amount: 1100 }])).toBeCloseTo(0.1, 6);
  });
  it('préstamo dentro del tope pasa', () => {
    const r = checkRateCap({ ...base, rate: '0.005' }, 0.25);
    expect(r.ok).toBe(true);
  });
  it('mora diaria contra el tope', () => {
    expect(dailyLateFeeWithinCap('0.0005', 0.25)).toBe(true);
    expect(dailyLateFeeWithinCap('0.002', 0.25)).toBe(false);
  });
});

describe('reglas de contacto', () => {
  const R = RULESET_CO_LEY_2300;
  it('sábado después de las 15:00 pasa al lunes 07:00', () => {
    const d = evaluateContact({ kind: 'collection', channel: 'whatsapp', requestedAt: '2026-10-17T15:00' }, [], R);
    expect(d).toMatchObject({ decision: 'reschedule', at: '2026-10-19T07:00' });
  });
  it('dentro de franja se envía', () => {
    expect(evaluateContact({ kind: 'collection', channel: 'whatsapp', requestedAt: '2026-10-14T18:59' }, [], R).decision).toBe('send');
  });
  it('otro canal en la misma semana queda bloqueado', () => {
    const d = evaluateContact({ kind: 'collection', channel: 'email', requestedAt: '2026-10-15T09:00' }, [{ at: '2026-10-13T08:00', kind: 'collection', channel: 'whatsapp' }], R);
    expect(d.decision).toBe('block');
    expect(d.reasons.at(-1)).toEqual({ code: 'CHANNEL_WEEK', detail: 'whatsapp' });
    const nextWeek = evaluateContact({ kind: 'collection', channel: 'email', requestedAt: '2026-10-19T09:00' }, [{ at: '2026-10-13T08:00', kind: 'collection', channel: 'whatsapp' }], R);
    expect(nextWeek.decision).toBe('send');
  });
  it('transaccional respeta la franja salvo envío inmediato habilitado', () => {
    expect(evaluateContact({ kind: 'transactional', channel: 'whatsapp', requestedAt: '2026-10-11T21:00' }, [], R).decision).toBe('reschedule');
    expect(evaluateContact({ kind: 'transactional', channel: 'whatsapp', requestedAt: '2026-10-11T21:00' }, [], R, { transactionalImmediate: true }).decision).toBe('send');
    // los transaccionales no cuentan para el límite diario de cobranza
    expect(evaluateContact({ kind: 'transactional', channel: 'email', requestedAt: '2026-10-13T09:00' }, [{ at: '2026-10-13T08:00', kind: 'collection', channel: 'whatsapp' }], R).decision).toBe('send');
  });
  it('excepción autorizada por el deudor', () => {
    const d = evaluateContact({ kind: 'collection', channel: 'whatsapp', requestedAt: '2026-10-11T20:30' }, [], R, { debtorAuthorizedWindows: [{ day: 7, start: '20:00', end: '21:00' }] });
    expect(d.decision).toBe('send');
  });
});

describe('teléfonos, nombres e identificación', () => {
  it('normaliza formatos locales y wa_id', () => {
    expect(normalizePhone('300 123 4567')).toBe('+573001234567');
    expect(normalizePhone('573001234567')).toBe('+573001234567');
    expect(normalizePhone('+55 11 91234-5678')).toBe('+5511912345678');
    expect(normalizePhone('(415) 555-2671', 'US')).toBe('+14155552671');
    expect(normalizePhone('123')).toBeNull();
  });
  it('similitud de nombres con tildes, orden, sufijos legales y máscaras', () => {
    expect(nameSimilarity('INVERSIONES COROC SAS', 'Inversiones Coroc S.A.S.')).toBe(1);
    expect(nameSimilarity('Pérez Gómez María José', 'MARIA JOSE PEREZ GOMEZ')).toBe(1);
    expect(nameSimilarity('Mar*** Pér***', 'María Pérez')).toBeGreaterThan(0.85);
    expect(nameSimilarity('Maria Perez', 'María José Pérez Gómez')).toBeGreaterThan(0.85);
    expect(nameSimilarity('Juan Rodríguez', 'María Pérez')).toBeLessThan(0.3);
  });
  it('número compartido por dos clientes: desempata por nombre y valor', () => {
    const clients: ClientRef[] = [
      { id: 'a', fullName: 'Ana Lucía Torres', phones: ['+573001112233'], emails: [], active: true, loans: [{ id: 'la', currency: 'COP', pendingAmounts: [50_000] }] },
      { id: 'b', fullName: 'Jorge Torres', phones: ['+573001112233'], emails: [], active: true, loans: [{ id: 'lb', currency: 'COP', pendingAmounts: [80_000] }] },
    ];
    expect(identifySender({ phone: '+573001112233', payerName: 'Ana Lucia Torres', amount: 50_000 }, clients)).toMatchObject({ status: 'identified', clientId: 'a' });
    expect(identifySender({ phone: '+573001112233' }, clients).status).toBe('ambiguous');
    expect(identifySender({ uploadLinkClientId: 'b' }, clients)).toMatchObject({ status: 'identified', via: 'upload_link' });
  });
  it('varios préstamos: por valor y luego por mora más antigua', () => {
    const c: ClientRef = {
      id: 'x', fullName: 'X', phones: [], emails: [], active: true,
      loans: [
        { id: 'l1', currency: 'COP', pendingAmounts: [60_000], oldestOverdueDate: '2026-10-01' },
        { id: 'l2', currency: 'COP', pendingAmounts: [100_000], oldestOverdueDate: '2026-09-20' },
      ],
    };
    expect(pickLoan(c, 100_000)).toEqual({ loanId: 'l2', rule: 'amount_match' });
    expect(pickLoan(c, 75_000)).toEqual({ loanId: 'l2', rule: 'oldest_overdue' });
  });
});

describe('lectura de comprobantes por texto', () => {
  it('parsea montos locales', () => {
    expect(parseAmount('60.000', 'COP')).toBe(60_000);
    expect(parseAmount('1.234.567', 'COP')).toBe(1_234_567);
    expect(parseAmount('60.000,00', 'COP')).toBe(60_000);
    expect(parseAmount('1.234,56', 'BRL')).toBe(123_456);
    expect(parseAmount('1,234.56', 'USD')).toBe(123_456);
    expect(parseAmount('150', 'COP')).toBe(150);
  });

  it('comprobante estilo billetera colombiana', () => {
    const text = `Nequi
¡Envío exitoso!
Para
MARIA JOSE PEREZ GOMEZ
¿Cuánto?
$ 60.000,00
Número Nequi
300 *** 4567
Fecha
9 de octubre de 2026 a las 02:32 p. m.
Referencia
M1234567
¿De dónde salió la plata?
Disponible`;
    const x = extractFromText(text, { receivedOn: '2026-10-09', defaultCurrency: 'COP' });
    expect(x.entity?.value).toBe('Nequi');
    expect(x.receiverName.value).toBe('MARIA JOSE PEREZ GOMEZ');
    expect(x.amount).toEqual({ value: 60_000, confidence: 0.96 });
    expect(x.payerName.value).toBeNull();
    expect(x.date.value).toBe('2026-10-09');
    expect(x.time?.value).toBe('14:32');
    expect(x.reference?.value).toBe('M1234567');
    expect(x.destinationLast4?.value).toBe('4567');
    expect(x.documentType.value).toBe('transfer_receipt');
  });

  it('comprobante de transferencia bancaria con etiquetas', () => {
    const text = `Bancolombia
Comprobante de transferencia
Fecha: 09/10/2026 10:41
Valor enviado: $ 150.000
Nombre del pagador: Carlos Andrés Ruiz
Cuenta destino: Ahorros *4455
Nombre del destinatario: INVERSIONES COROC SAS
Comprobante No. 0012345678
Costo de la transacción: $ 0`;
    const x = extractFromText(text, { receivedOn: '2026-10-09', defaultCurrency: 'COP' });
    expect(x.amount).toEqual({ value: 150_000, confidence: 0.96 });
    expect(x.payerName).toEqual({ value: 'Carlos Andrés Ruiz', confidence: 0.96 });
    expect(x.receiverName).toEqual({ value: 'INVERSIONES COROC SAS', confidence: 0.96 });
    expect(x.date).toEqual({ value: '2026-10-09', confidence: 0.96 });
    expect(x.reference?.value).toBe('0012345678');
    expect(x.destinationLast4?.value).toBe('4455');
  });

  it('comprovante PIX', () => {
    const text = `Comprovante de transferência
Pix enviado
Valor: R$ 1.250,00
Data: 12 de outubro de 2026, 09:15
Destinatário: Coroc Serviços Financeiros
Quem pagou: João da Silva Santos
ID da transação: E00000000202610121215ABCDEF1234`;
    const x = extractFromText(text, { receivedOn: '2026-10-12', defaultCurrency: 'COP' });
    expect(x.currency.value).toBe('BRL');
    expect(x.amount.value).toBe(125_000);
    expect(x.date.value).toBe('2026-10-12');
    expect(x.receiverName.value).toBe('Coroc Serviços Financeiros');
    expect(x.payerName.value).toBe('João da Silva Santos');
    expect(x.reference?.value).toBe('E00000000202610121215ABCDEF1234');
  });

  it('pago en EE. UU. con fecha en formato mes/día', () => {
    const text = `Zelle
You sent $1,250.00
Sent to: Coroc Personal Loans LLC
From: John Smith
Date: 10/09/2026
Confirmation code: ZL77889900`;
    const x = extractFromText(text, { receivedOn: '2026-10-09', defaultCurrency: 'USD' });
    expect(x.amount.value).toBe(125_000);
    expect(x.date.value).toBe('2026-10-09');
    expect(x.receiverName.value).toBe('Coroc Personal Loans LLC');
    expect(x.payerName.value).toBe('John Smith');
    expect(x.reference?.value).toBe('ZL77889900');
  });

  it('una sola fecha explícita sin etiqueta tiene confianza alta; una relativa no', () => {
    const a = extractFromText('Bancolombia\n¡Transferencia exitosa!\n22 sep 2026 - 10:41 a. m.\nValor enviado\n$ 38.000,00', { receivedOn: '2026-09-22', defaultCurrency: 'COP' });
    expect(a.date).toEqual({ value: '2026-09-22', confidence: 0.96 });
    expect(a.time?.value).toBe('10:41');
    const b = extractFromText('Nequi\nhoy 14:32\nValor\n$ 10.000', { receivedOn: '2026-09-22', defaultCurrency: 'COP' });
    expect(b.date).toEqual({ value: '2026-09-22', confidence: 0.9 });
  });

  it('un documento sin forma de comprobante se clasifica como otro', () => {
    const x = extractFromText('Cédula de ciudadanía\nRepública de Colombia', { receivedOn: '2026-10-09', defaultCurrency: 'COP' });
    expect(x.documentType.value).toBe('other');
  });
});

describe('lectura de comprobantes: formularios y referencias (Fase 3)', () => {
  const opts = { receivedOn: '2026-10-09', defaultCurrency: 'COP' as const };
  it('formulario en tabla sin dos puntos: lee los nombres con confianza bajo el umbral', () => {
    const x = extractFromText('BANCO DE BOGOTÁ\nComprobante de consignación\nBeneficiario Inversiones Coroc SAS\nRemitente Luz Ángela Martínez Rojas\nValor $ 38.000\nFecha 07/10/2026\nNúmero de comprobante R313821397', opts);
    expect(x.receiverName).toEqual({ value: 'Inversiones Coroc SAS', confidence: 0.93 });
    expect(x.payerName.value).toBe('Luz Ángela Martínez Rojas');
    expect(x.reference.value).toBe('R313821397');
    expect(x.amount.value).toBe(38_000);
  });
  it('referencia en el renglón siguiente a rótulos de varias palabras', () => {
    const read = (label: string) => extractFromText(`Valor\n$ 60.000\n${label}\nA266305531`, opts).reference.value;
    expect(read('Código de transacción')).toBe('A266305531');
    expect(read('Número de giro')).toBe('A266305531');
    expect(read('CUS / Referencia')).toBe('A266305531');
    expect(read('Reference number')).toBe('A266305531');
    expect(read('Autenticacáo')).toBe('A266305531');
  });
});

describe('replayLoan y nombres de carpeta', () => {
  const plan = [1, 2, 3, 4].map((n) => ({ number: n, dueDate: `2026-10-0${n + 1}`, amount: 60000 }));
  it('aplica los pagos vigentes en orden de fecha y de registro', () => {
    const r = replayLoan(plan, [
      { id: 'b', date: '2026-10-03', order: '2', amount: 150000 },
      { id: 'a', date: '2026-10-02', order: '1', amount: 60000 },
    ], '2026-10-03');
    expect(r.states.map((s) => s.paid)).toEqual([60000, 60000, 60000, 30000]);
    expect(r.allocations.get('b')!.lines.map((l) => l.number)).toEqual([2, 3, 4]);
    expect(r.summary.balance).toBe(30000);
    expect(r.states[3]!.status).toBe('partial');
    expect(r.states[0]!.lastPaymentDate).toBe('2026-10-02');
  });
  it('reversar un pago antiguo reacomoda los posteriores (ADR-003)', () => {
    const r = replayLoan(plan, [{ id: 'b', date: '2026-10-03', order: '2', amount: 60000 }], '2026-10-06');
    expect(r.states.map((s) => s.paid)).toEqual([60000, 0, 0, 0]);
    expect(r.summary.overdueCount).toBe(3);
    expect(r.states[1]!.status).toBe('overdue');
  });
  it('excedente queda como saldo a favor', () => {
    const r = replayLoan(plan, [{ id: 'x', date: '2026-10-02', order: '1', amount: 250000 }], '2026-10-02');
    expect(r.surplus).toBe(10000);
    expect(r.summary.balance).toBe(0);
  });
  it('carpeta sin tildes ni caracteres inválidos', () => {
    expect(clientFolderName('María José', 'Pérez Gómez', 'C000042')).toBe('Maria Jose Perez Gomez - C000042');
    expect(sanitizeFolderName('Ñandú: <Ltda.> ')).toBe('Nandu Ltda');
  });
});

describe('la reconstrucción rápida equivale a aplicar pago por pago', () => {
  it('500 préstamos aleatorios con pagos, excedentes y mora', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let k = 0; k < 500; k++) {
      const n = 1 + Math.floor(rnd() * 30);
      const plan = Array.from({ length: n }, (_, i) => ({ number: i + 1, dueDate: `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`, amount: 1000 + Math.floor(rnd() * 90000) }));
      const payments = Array.from({ length: Math.floor(rnd() * 12) }, (_, i) => ({ id: `p${i}`, date: `2026-0${1 + Math.floor(rnd() * 3)}-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}`, order: String(i).padStart(3, '0'), amount: 1 + Math.floor(rnd() * 120000) }));
      const lateFee = rnd() < 0.3 ? { type: 'fixed_daily' as const, value: '50', graceDays: 2 } : null;
      const fast = replayLoan(plan, payments, '2026-04-15', lateFee);
      // Referencia: la función pública, una copia completa por pago.
      let st = plan.map((i) => ({ ...i, paid: 0, lateFeeAccrued: 0, lateFeePaid: 0 }));
      const sorted = [...payments].sort((a, b) => (a.date === b.date ? a.order.localeCompare(b.order) : a.date < b.date ? -1 : 1));
      for (const p of sorted) {
        if (lateFee) st = accrueLateFees(st, p.date, lateFee);
        const r = allocatePayment(st, p.amount);
        expect(fast.allocations.get(p.id)!.lines).toEqual(r.lines);
        st = r.after;
      }
      if (lateFee) st = accrueLateFees(st, '2026-04-15', lateFee);
      expect(fast.summary).toEqual(summarize(st, '2026-04-15'));
    }
  });
});
