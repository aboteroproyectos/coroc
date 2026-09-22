// Genera los PDF de muestra (recibo es/en, anulado, plan, estado de cuenta, paz y salvo, informe de cartera).
// Uso: node tools/samples.mjs [carpeta_destino]   (por defecto docs/muestras del monorepo)
import fs from 'node:fs';
import path from 'node:path';
import { HERE, serve, launch, setupDemo, check, finish } from './_harness.mjs';

const OUT = path.resolve(process.argv[2] || path.join(HERE, '../../../docs/muestras'));
fs.mkdirSync(OUT, { recursive: true });
const srv = await serve();
const { browser, page, errors } = await launch();
const results = [];
await setupDemo(page, srv.url + '/COROC.html');
const out = await page.evaluate(async () => {
  const b64 = async (blob) => {
    const u = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768));
    return btoa(s);
  };
  const res = {};
  const maria = C.state.clients[0];
  const loan = C.loansOf(maria.id)[0];
  const r = await C.registerPayment(loan.id, { amount: 100000, date: C.today(), method: 'Nequi', reference: 'M99001122' });
  res['01_Recibo_es'] = await b64(await C.docs.blob(r.receipt.doc.id));
  const en = C.state.clients.find((c) => c.lang === 'en') || C.state.clients[8];
  const enLoan = C.loansOf(en.id)[0];
  const r2 = await C.registerPayment(enLoan.id, { amount: C.loanState(enLoan).summary.next.outstanding, date: C.today(), method: 'Transfer' });
  res['02_Receipt_en'] = await b64(await C.docs.blob(r2.receipt.doc.id));
  const plan = C.state.documents.find((d) => d.key === `schedule:${loan.id}` && !d.superseded);
  res['03_Plan_de_pagos'] = await b64(await C.docs.blob(plan.id));
  const st = await C.docs.issueStatement(loan);
  res['04_Estado_de_cuenta'] = await b64(await C.docs.blob(st.id));
  const payoff = C.state.documents.find((d) => d.kind === 'payoff');
  res['05_Paz_y_salvo'] = await b64(await C.docs.blob(payoff.id));
  const rep = await C.reports.build('portfolio', 'pdf', {});
  res['06_Informe_de_cartera'] = await b64(rep.blob);
  await C.reversePayment(loan.id, r.entry.id, 'Muestra de reverso');
  const voided = C.state.documents.find((d) => d.voidOf === r.receipt.doc.id);
  res['07_Recibo_ANULADO'] = await b64(await C.docs.blob(voided.id));
  return res;
});
for (const [k, v] of Object.entries(out)) {
  const buf = Buffer.from(v, 'base64');
  fs.writeFileSync(path.join(OUT, k + '.pdf'), buf);
  check(results, k + '.pdf', buf.subarray(0, 5).toString() === '%PDF-', `${Math.round(buf.length / 1024)} KB`);
}
await browser.close();
srv.close();
finish(results, errors);
