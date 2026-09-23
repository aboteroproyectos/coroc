import { describe, expect, it } from 'vitest';
import { clientFolderName, contractFolders, documentFileName, documentFolder, documentPath, rootFolders } from '../src/index.js';

describe('carpeta COROC (§16.3)', () => {
  const folder = clientFolderName('María José', 'Pérez Gómez', 'C000042');

  it('CA-15: carpeta del cliente sin tildes y cinco subcarpetas por contrato', () => {
    expect(folder).toBe('Maria Jose Perez Gomez - C000042');
    expect(contractFolders('es', folder, 'CT-000125').map((p) => p.join('/'))).toEqual([
      'Maria Jose Perez Gomez - C000042/CT-000125/01 Contrato y plan de pagos',
      'Maria Jose Perez Gomez - C000042/CT-000125/02 Comprobantes recibidos',
      'Maria Jose Perez Gomez - C000042/CT-000125/03 Recibos emitidos',
      'Maria Jose Perez Gomez - C000042/CT-000125/04 Estados de cuenta',
      'Maria Jose Perez Gomez - C000042/CT-000125/05 Otros documentos',
    ]);
    expect(rootFolders('es')).toEqual(['_Sin asignar', '_Entrada', '_Informes', '_Respaldos']);
    expect(rootFolders('pt-BR')).toContain('_Relatorios');
  });

  it('cada tipo de documento va a su subcarpeta; sin cliente, a _Sin asignar; informes a _Informes', () => {
    expect(documentFolder('es', { kind: 'receipt_out', clientFolder: folder, contract: 'CT-000125' })).toEqual([folder, 'CT-000125', '03 Recibos emitidos']);
    expect(documentFolder('es', { kind: 'schedule', clientFolder: folder, contract: 'CT-000125' })[2]).toBe('01 Contrato y plan de pagos');
    expect(documentFolder('en', { kind: 'payoff', clientFolder: folder, contract: 'CT-000125' })[2]).toBe('04 Statements');
    expect(documentFolder('es', { kind: 'receipt_in' })).toEqual(['_Sin asignar']);
    expect(documentFolder('es', { kind: 'report' })).toEqual(['_Informes']);
    expect(documentFolder('es', { kind: 'other', clientFolder: folder })).toEqual([folder, '05 Otros documentos']);
  });

  it('nombres de archivo AAAA-MM-DD_HHMM_TIPO_CONTRATO_VALOR.ext', () => {
    expect(documentFileName('es', { stamp: '2026-10-09 14:32', kind: 'receipt_in', contract: 'CT-000125', amount: { minor: 60000, currency: 'COP' }, ext: 'JPG' })).toBe('2026-10-09_1432_COMPROBANTE_CT-000125_60000.jpg');
    expect(documentFileName('es', { stamp: '2026-10-09 14:35', kind: 'receipt_out', number: 'RC-000482', contract: 'CT-000125', ext: 'pdf' })).toBe('2026-10-09_1435_RECIBO_RC-000482_CT-000125.pdf');
    expect(documentFileName('es', { stamp: '2026-10-09T14:35:10', kind: 'receipt_out', number: 'RC-000482', contract: 'CT-000125', ext: '.pdf', voided: true })).toBe('2026-10-09_1435_RECIBO_RC-000482_CT-000125_ANULADO.pdf');
    expect(documentFileName('en', { stamp: '2026-10-09 08:05', kind: 'receipt_in', contract: 'CT-9', amount: { minor: 60050, currency: 'USD' }, ext: 'png' })).toBe('2026-10-09_0805_PROOF_OF_PAYMENT_CT-9_600.50.png');
    expect(documentFileName('pt-BR', { stamp: '2026-10-09 08:05', kind: 'report', label: 'Cartera total', ext: 'xlsx' })).toBe('2026-10-09_0805_RELATORIO_Cartera_total.xlsx');
    expect(() => documentFileName('es', { stamp: 'ayer', kind: 'other', ext: 'pdf' })).toThrow(RangeError);
  });

  it('ruta completa con separador «/»', () => {
    expect(documentPath('es', { kind: 'statement', clientFolder: folder, contract: 'CT-000125' }, 'x.pdf')).toBe(`${folder}/CT-000125/04 Estados de cuenta/x.pdf`);
  });
});
