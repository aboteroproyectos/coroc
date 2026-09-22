/**
 * Criterios de aceptación del prompt maestro (§22) que dependen del núcleo de negocio.
 * Cada prueba lleva el ID del criterio.
 */
import { describe, expect, it } from 'vitest';
import {
  RULESET_CO_LEY_2300,
  allocatePayment,
  buildReceiptData,
  buildSchedule,
  checkRateCap,
  decideAutoApply,
  evaluateContact,
  identifySender,
  isDuplicate,
  logicalFingerprint,
  pickLoan,
  summarize,
  validateExtraction,
  type ClientRef,
  type Extraction,
  type InstallmentState,
  type LoanTerms,
} from '../src';

const CA01: LoanTerms = {
  principal: 1_000_000,
  currency: 'COP',
  method: 'simple',
  rate: '0.20',
  installments: 20,
  frequency: 'daily',
  disbursementDate: '2026-10-08',
  country: 'CO',
};

const toState = (s: ReturnType<typeof buildSchedule>): InstallmentState[] =>
  s.installments.map((i) => ({ number: i.number, dueDate: i.dueDate, amount: i.amount, paid: 0 }));

describe('Motor financiero', () => {
  it('CA-01 interés simple: $1.000.000 al 20 % en 20 cuotas diarias', () => {
    const s = buildSchedule(CA01);
    expect(s.totalPayable).toBe(1_200_000);
    expect(s.regularInstallment).toBe(60_000);
    expect(s.installments.every((i) => i.amount === 60_000)).toBe(true);
    expect(s.totalInterest).toBe(200_000);
    expect(s.installments.reduce((a, i) => a + i.principal, 0)).toBe(1_000_000);
  });

  it('CA-02 redondeo: $1.000.000 al 15 % en 7 cuotas, la última absorbe la diferencia', () => {
    const s = buildSchedule({ ...CA01, rate: '0.15', installments: 7 });
    expect(s.installments.slice(0, 6).every((i) => i.amount === 164_286)).toBe(true);
    expect(s.installments[6]!.amount).toBe(164_284);
    expect(s.totalPayable).toBe(1_150_000);
  });

  it('CA-03 francés: $5.000.000 al 2 % mensual en 12 cuotas', () => {
    const s = buildSchedule({ ...CA01, principal: 5_000_000, method: 'french', rate: '0.02', installments: 12, frequency: 'monthly' });
    expect(s.regularInstallment).toBe(472_798);
    const first = s.installments[0]!;
    expect(first.interest).toBe(100_000);
    expect(first.principal).toBe(372_798);
    expect(5_000_000 - first.principal).toBe(4_627_202);
    expect(s.installments.reduce((a, i) => a + i.principal, 0)).toBe(5_000_000);
    expect(s.installments[11]!.balanceAfter).toBe(0);
    expect(s.totalPayable).toBe(5_673_576);
  });

  it('CA-04 calendario diario lunes a sábado sin festivos de Colombia', () => {
    const s = buildSchedule(CA01);
    expect(s.installments.slice(0, 4).map((i) => i.dueDate)).toEqual(['2026-10-09', '2026-10-10', '2026-10-13', '2026-10-14']);
  });

  it('CA-05 y CA-06 aplicación de pagos, cuotas restantes, acumulado y nuevo saldo', () => {
    const s = buildSchedule(CA01);
    const today = '2026-10-13';
    const st0 = toState(s);
    const before1 = summarize(st0, today);
    const p1 = allocatePayment(st0, 60_000);
    const after1 = summarize(p1.after, today);
    expect(p1.lines).toEqual([{ number: 1, toLateFee: 0, toInstallment: 60_000, completed: true, partial: false }]);
    expect(after1.remainingInstallments).toBe(19);
    expect(after1.paidTotal).toBe(60_000);
    expect(after1.balance).toBe(1_140_000);

    const p2 = allocatePayment(p1.after, 150_000);
    const after2 = summarize(p2.after, today);
    expect(p2.lines.filter((l) => l.completed).map((l) => l.number)).toEqual([2, 3]);
    expect(p2.lines.find((l) => l.partial)).toMatchObject({ number: 4, toInstallment: 30_000 });
    expect(after2.remainingInstallments).toBe(17);
    expect(after2.paidTotal).toBe(210_000);
    expect(after2.balance).toBe(990_000);
    expect(p2.surplus).toBe(0);

    const rd = buildReceiptData({
      lang: 'es', number: 'RC-000002', issuedAt: '2026-10-13 10:15', company: { name: 'Empresa de prueba' },
      client: { fullName: 'María José Pérez Gómez', code: 'C000042' }, contract: 'CT-000125', currency: 'COP',
      payment: { date: '2026-10-13', amount: 150_000 }, lines: p2.lines, before: after1, after: after2, verificationCode: 'X',
    });
    expect(rd.coverage).toBe('Cuotas 2 y 3 (completas) · Cuota 4 (abono parcial $ 30.000)');
    expect(rd.totalInstallments).toBe(20);
    expect(rd.remainingInstallments).toBe(17);
    expect(rd.accumulatedPaid).toBe(210_000);
    expect(rd.previousBalance).toBe(1_140_000);
    expect(rd.newBalance).toBe(990_000);
    expect(rd.next).toEqual({ number: 4, dueDate: '2026-10-14', amount: 30_000 });
    void before1;
  });

  it('CA-12 tope de tasa: no se permite superar el tope y se informa la tasa máxima', () => {
    const cap = 0.25; // tope configurado de prueba (EA); en producción: tasa de usura vigente registrada por el usuario
    const r = checkRateCap(CA01, cap);
    expect(r.ok).toBe(false);
    expect(r.maxRate).toBeDefined();
    const ok = checkRateCap({ ...CA01, rate: r.maxRate! }, cap);
    expect(ok.ok).toBe(true);
    const over = checkRateCap({ ...CA01, rate: (Number(r.maxRate) + 0.0001).toFixed(4) }, cap);
    expect(over.ok).toBe(false);
  });
});

describe('Recepción de documentos', () => {
  const clients: ClientRef[] = [
    { id: 'c1', fullName: 'María José Pérez Gómez', phones: ['+573001234567'], emails: ['maria@example.com'], active: true, loans: [{ id: 'l1', currency: 'COP', pendingAmounts: [60_000, 60_000] }] },
    { id: 'c2', fullName: 'Carlos Andrés Ruiz', phones: ['+573109876543'], emails: [], active: true, loans: [{ id: 'l2', currency: 'COP', pendingAmounts: [100_000] }] },
  ];

  it('CA-07 el mismo comprobante por WhatsApp y luego por correo es DUPLICADO', () => {
    const files = new Set<string>();
    const logical = new Set<string>();
    const key = logicalFingerprint({ reference: 'M1234567', amount: 60_000, date: '2026-10-09', entity: 'Nequi' });
    expect(isDuplicate('sha-a', key, files, logical)).toBe(false);
    files.add('sha-a');
    logical.add(key);
    // Mismo archivo reenviado
    expect(isDuplicate('sha-a', key, files, logical)).toBe('file');
    // Captura distinta (otro hash) del mismo pago
    const key2 = logicalFingerprint({ reference: 'm-1234567', amount: 60_000, date: '2026-10-09', entity: 'NEQUI' });
    expect(isDuplicate('sha-b', key2, files, logical)).toBe('logical');
    const decision = decideAutoApply({ status: 'identified', clientId: 'c1', candidates: [] }, { loanId: 'l1', rule: 'single' }, { flags: [], autoEligible: true }, 'logical', 'auto_with_audit');
    expect(decision).toBe('duplicate');
  });

  it('CA-08 comprobante desde un número no registrado queda sin asignar, con sugerencias', () => {
    const id = identifySender({ phone: '+573150000000', payerName: 'MARIA PEREZ', amount: 60_000 }, clients);
    expect(id.status).toBe('unknown');
    expect(id.candidates[0]?.clientId).toBe('c1');
    const known = identifySender({ phone: '+573001234567' }, clients);
    expect(known).toMatchObject({ status: 'identified', clientId: 'c1', via: 'phone' });
    expect(pickLoan(clients[0]!, 60_000)).toEqual({ loanId: 'l1', rule: 'single' });
  });

  it('CA-09 beneficiario distinto de las cuentas receptoras: no se aplica automáticamente', () => {
    const base: Extraction = {
      receiverName: { value: 'Pedro Martínez', confidence: 0.97 },
      payerName: { value: 'María Pérez', confidence: 0.97 },
      amount: { value: 60_000, confidence: 0.97 },
      currency: { value: 'COP', confidence: 0.97 },
      date: { value: '2026-10-09', confidence: 0.97 },
      documentType: { value: 'transfer_receipt', confidence: 0.95 },
    };
    const ctx = {
      receivingAccounts: [{ holderName: 'Inversiones Coroc S.A.S.', entity: 'Bancolombia', last4: '4455' }, { holderName: 'Andrés Botero' }],
      clientName: 'María José Pérez Gómez',
      loanCurrency: 'COP' as const,
      disbursementDate: '2026-10-08',
      today: '2026-10-09',
    };
    const bad = validateExtraction(base, ctx);
    expect(bad.autoEligible).toBe(false);
    expect(bad.flags.map((f) => f.code)).toContain('RECEIVER_MISMATCH');
    expect(decideAutoApply({ status: 'identified', clientId: 'c1', candidates: [] }, { loanId: 'l1', rule: 'single' }, bad, false, 'auto_with_audit')).toBe('review');

    const good = validateExtraction({ ...base, receiverName: { value: 'INVERSIONES COROC SAS', confidence: 0.97 } }, ctx);
    expect(good.autoEligible).toBe(true);
    expect(decideAutoApply({ status: 'identified', clientId: 'c1', candidates: [] }, { loanId: 'l1', rule: 'single' }, good, false, 'auto_with_audit')).toBe('apply');

    // Billetera que no imprime el nombre del pagador: solo se infiere si el remitente está verificado.
    const noPayer = { ...base, receiverName: { value: 'INVERSIONES COROC SAS', confidence: 0.97 }, payerName: { value: null, confidence: 0 } };
    expect(validateExtraction(noPayer, ctx).autoEligible).toBe(false);
    const inferred = validateExtraction(noPayer, { ...ctx, senderVerified: true });
    expect(inferred.autoEligible).toBe(true);
    expect(inferred.flags).toEqual([{ code: 'PAYER_INFERRED', field: 'payerName', severity: 'warning' }]);
  });
});

describe('Motor de reglas de contacto (Ley 2300 de 2023)', () => {
  it('CA-10 recordatorio el domingo 11-oct-2026 10:00 se reprograma al martes 13-oct 07:00 (12-oct festivo)', () => {
    const d = evaluateContact({ kind: 'collection', channel: 'whatsapp', requestedAt: '2026-10-11T10:00' }, [], RULESET_CO_LEY_2300);
    expect(d.decision).toBe('reschedule');
    expect(d.at).toBe('2026-10-13T07:00');
    expect(d.reasons.map((r) => r.code)).toEqual(['OUT_OF_WINDOW', 'HOLIDAY_SKIPPED']);
    expect(d.reasons[1]!.detail).toBe('2026-10-12');
  });

  it('CA-11 segundo mensaje de cobranza el mismo día queda bloqueado con la regla aplicada', () => {
    const history = [{ at: '2026-10-13T08:00', kind: 'collection' as const, channel: 'whatsapp' as const }];
    const d = evaluateContact({ kind: 'collection', channel: 'whatsapp', requestedAt: '2026-10-13T15:00' }, history, RULESET_CO_LEY_2300);
    expect(d.decision).toBe('block');
    expect(d.reasons.at(-1)).toEqual({ code: 'MAX_PER_DAY', detail: '2026-10-13' });
  });
});
