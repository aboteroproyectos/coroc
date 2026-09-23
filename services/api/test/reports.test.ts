// Fase 2 · Informes (§18): PDF, XLSX y CSV en el idioma elegido, con cifras que cuadran con el libro.
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DocumentTasks } from '../src/documents/tasks.js';
import { auth, bootApp, expectContract, newTenant, ownerSession, PASSWORD } from './helpers.js';
import { pdfText } from './pdf-text.js';

type T = Awaited<ReturnType<typeof bootApp>>;
const terms = (over: Record<string, unknown> = {}) => ({ principal: 1_000_000, currency: 'COP', method: 'simple', rate: '0.20', installments: 20, frequency: 'daily', disbursementDate: '2026-10-08', ...over });
const binary = (res: any, cb: (e: Error | null, b: Buffer) => void) => {
  const parts: Buffer[] = [];
  res.on('data', (c: Buffer) => parts.push(c));
  res.on('end', () => cb(null, Buffer.concat(parts)));
};

describe('Informes (§18)', () => {
  let t: T;
  let token: string;
  let slug: string;
  const idle = () => t.app.get(DocumentTasks).idle();
  /** Pide el informe, espera la tarea y descarga el archivo generado. */
  const report = async (body: Record<string, unknown>) => {
    const task = (await t.http().post('/v1/reports').set(auth(token)).send(body).expect(202)).body;
    expectContract('requestReport', 202, task);
    await idle();
    const done = (await t.http().get(`/v1/tasks/${task.id}`).set(auth(token)).expect(200)).body;
    expect(done.status).toBe('done');
    const doc = (await t.http().get(`/v1/documents/${done.documentId}`).set(auth(token)).expect(200)).body;
    const link = (await t.http().post(`/v1/documents/${doc.id}/link`).set(auth(token)).expect(200)).body;
    const file = await t.http().get(`/v1${link.path}`).buffer(true).parse(binary).expect(200);
    return { doc, body: file.body as Buffer };
  };

  beforeAll(async () => {
    t = await bootApp('2026-10-20T15:00:00Z');
    const tenant = await newTenant({ country: 'US', lang: 'es' });
    slug = tenant.slug;
    token = (await ownerSession(t, slug)).token;
    const a = (await t.http().post('/v1/clients').set(auth(token)).send({ client: { firstName: 'Ana', lastName: 'Ríos', phone: '+57 315 111 2233' }, loan: terms() }).expect(201)).body;
    const rb = await t.http().post('/v1/clients').set(auth(token)).send({ client: { firstName: 'Beto', lastName: 'Luna', phone: '+57 315 444 5566' }, loan: terms({ principal: 500_000, installments: 5 }) });
    expect(rb.status, JSON.stringify(rb.body)).toBe(201);
    const b = rb.body;
    await t.http().post(`/v1/loans/${a.loan.id}/payments`).set(auth(token)).send({ amount: 60_000, date: '2026-10-09', method: 'Nequi' }).expect(201);
    await t.http().post(`/v1/loans/${a.loan.id}/payments`).set(auth(token)).send({ amount: 120_000, date: '2026-10-15', cash: true }).expect(201);
    // El préstamo de Beto se paga completo: aparece en «finalizados y utilidad».
    await t.http().post(`/v1/loans/${b.loan.id}/payments`).set(auth(token)).send({ amount: 600_000, date: '2026-10-16' }).expect(201);
    await idle();
  });
  afterAll(async () => t.app.close());

  it('cartera total en PDF: logo, corte, filtros, préstamos activos y saldo total', async () => {
    const { doc, body } = await report({ type: 'portfolio', format: 'pdf', currency: 'COP' });
    expect(doc).toMatchObject({ kind: 'report', clientId: null, folderPath: '_Informes', mime: 'application/pdf' });
    expect(doc.fileName).toMatch(/^2026-10-20_\d{4}_INFORME_Cartera_total\.pdf$/);
    const { text } = await pdfText(body);
    for (const s of ['Cartera total', 'Corte 20 de octubre de 2026', 'Préstamos: 1', 'Saldo total $ 1.020.000', 'Ana Ríos', 'Montos en COP', 'Todos los cobradores']) expect(text).toContain(s);
    expect(text).not.toContain('Beto Luna');
  });

  it('recaudo por período en XLSX: números reales, total que cuadra y formato de moneda', async () => {
    const { doc, body } = await report({ type: 'collections', format: 'xlsx', currency: 'COP', from: '2026-10-01', to: '2026-10-31' });
    expect(doc.mime).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(body as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(ws.getRow(2).getCell(1).value).toBe('Recaudo por período');
    const header = ws.getRow(6).values as unknown[];
    expect(header).toContain('Valor');
    const amounts: number[] = [];
    ws.eachRow((row, n) => {
      if (n > 6) amounts.push(Number(row.getCell(8).value));
    });
    expect(amounts).toEqual([60_000, 120_000, 600_000, 780_000]);
    expect(ws.getRow(7).getCell(8).numFmt).toBe('#,##0 "COP"');
  });

  it('libro de movimientos en CSV (§9.7) en inglés: separador y encabezados del idioma elegido, sin fórmulas inyectables', async () => {
    const { body, doc } = await report({ type: 'ledger', format: 'csv', lang: 'en', currency: 'COP', from: '2026-10-01', to: '2026-10-31' });
    expect(doc.lang).toBe('en');
    const text = body.toString('utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).trim().split('\r\n');
    expect(lines[0]).toBe('Recorded,Date,Entry,Contract,Client,Amount,Receipt,Reference,Reason,User');
    expect(lines.filter((l) => l.includes(',Disbursement,'))).toHaveLength(2);
    expect(lines.filter((l) => l.includes(',Payment,'))).toHaveLength(3);
    expect(lines.some((l) => l.includes(',1000000,'))).toBe(true);
  });

  it('finalizados y utilidad, mora por edades y flujo de caja', async () => {
    const closed = await pdfText((await report({ type: 'closed', format: 'pdf', currency: 'COP' })).body);
    for (const s of ['Préstamos finalizados y utilidad', 'Beto Luna', 'Utilidad total $ 100.000']) expect(closed.text).toContain(s);
    const aging = await pdfText((await report({ type: 'aging', format: 'pdf', currency: 'COP' })).body);
    expect(aging.text).toContain('Mora por edades');
    expect(aging.text).toContain('Ana Ríos');
    const cash = await pdfText((await report({ type: 'cashflow', format: 'pdf', currency: 'COP' })).body);
    expect(cash.text).toContain('Proyección de flujo de caja');
    expect(cash.text).toContain('Próximas 8 semanas');
  });

  it('el Cobrador no genera informes globales (§7.2) y un período invertido se rechaza', async () => {
    await t.http().post('/v1/users').set(auth(token)).send({ username: 'cobra1', name: 'Cobra Uno', role: 'collector', password: PASSWORD }).expect(201);
    const ct = (await t.http().post('/v1/auth/login').send({ tenant: slug, username: 'cobra1', password: PASSWORD, deviceId: 'dispositivo-cobrador' }).expect(200)).body.accessToken;
    await t.http().post('/v1/reports').set(auth(ct)).send({ type: 'portfolio', format: 'pdf' }).expect(403);
    const inv = await t.http().post('/v1/reports').set(auth(token)).send({ type: 'collections', format: 'pdf', from: '2026-10-31', to: '2026-10-01' }).expect(422);
    expect(inv.body.errors[0].field).toBe('to');
    await t.http().post('/v1/reports').set(auth(token)).send({ type: 'nada', format: 'pdf' }).expect(422);
    const reports = (await t.http().get('/v1/documents').set(auth(token)).query({ kind: 'report' }).expect(200)).body.items;
    expect(reports.length).toBeGreaterThanOrEqual(6);
    expect((await t.http().get('/v1/documents').set(auth(ct)).query({ kind: 'report' }).expect(200)).body.items).toEqual([]);
  });
});
