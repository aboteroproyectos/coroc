// Lectura real de un comprobante con Tesseract.js (CA-07 y camino automático de §13.5).
// Por defecto COROC carga Tesseract y PDF.js desde su CDN. Sin internet, defina OCR_ASSETS con una carpeta que contenga
// node_modules/tesseract.js, node_modules/tesseract.js-core, lang/{spa,por,eng}.traineddata.gz y pdfjs/build.
// Uso: OCR_ASSETS=/ruta node tools/verify-ocr.mjs
import { serve, launch, setupDemo, check, finish } from './_harness.mjs';

const assets = process.env.OCR_ASSETS;
const srv = await serve(assets ? { '/ocr': assets } : {});
const { browser, ctx, page, errors } = await launch();
const results = [];

// Comprobante realista (maqueta de una transferencia bancaria) convertido en imagen PNG
const r = await ctx.newPage();
await r.setViewportSize({ width: 420, height: 760 });
await r.setContent(`<body style="margin:0;font-family:Arial;background:#fff">
<div style="background:#FDDA24;padding:18px 22px;font-weight:700;font-size:22px;color:#2C2A29">Bancolombia</div>
<div style="padding:22px;color:#2C2A29">
<div style="font-size:20px;font-weight:700;margin-bottom:18px">¡Transferencia exitosa!</div>
<div style="font-size:14px;color:#666">Comprobante No. 0048213377</div>
<div style="font-size:14px;color:#666;margin-top:6px">__FECHA__ - 10:41 a. m.</div>
<hr style="margin:18px 0;border:0;border-top:1px solid #ddd">
<div style="font-size:13px;color:#666">Valor enviado</div><div style="font-size:24px;font-weight:700;margin-bottom:14px">$ 38.000,00</div>
<div style="font-size:13px;color:#666">Producto destino</div><div style="font-size:16px;margin-bottom:14px">Ahorros *4455</div>
<div style="font-size:13px;color:#666">Nombre del destinatario</div><div style="font-size:16px;margin-bottom:14px">INVERSIONES COROC SAS</div>
<div style="font-size:13px;color:#666">Nombre del pagador</div><div style="font-size:16px;margin-bottom:14px">María José Pérez Gómez</div>
<div style="font-size:13px;color:#666">Costo de la transacción</div><div style="font-size:16px">$ 0</div></div></body>`.replace('__FECHA__', (() => { const [y, m, d] = new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10).split('-'); return `${+d} ${['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][m - 1]} ${y}`; })()));
const png = await r.screenshot();
await r.close();

await setupDemo(page, srv.url + '/COROC.html');
const res = await page.evaluate(async ({ b64, base }) => {
  if (base) C.OCR_CONFIG = { tesseract: base + '/node_modules/tesseract.js/dist/tesseract.min.js', workerPath: base + '/node_modules/tesseract.js/dist/worker.min.js', corePath: base + '/node_modules/tesseract.js-core', langPath: base + '/lang', langs: 'spa+por+eng', pdfjs: base + '/pdfjs/build/pdf.min.mjs', pdfjsWorker: base + '/pdfjs/build/pdf.worker.min.mjs' };
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const maria = C.state.clients[0];
  const t0 = performance.now();
  const item = await C.intake.receive(new File([bytes], 'bancolombia.png', { type: 'image/png' }), { source: 'whatsapp', phone: maria.phone });
  const ms = performance.now() - t0;
  const dup = await C.intake.receive(new File([bytes], 'bancolombia_reenviado.png', { type: 'image/png' }), { source: 'email', email: maria.email });
  const loan = C.loansOf(maria.id)[0];
  const rdoc = C.state.documents.find((d) => d.kind === 'receipt_out' && d.loanId === loan.id);
  const pdfText = await C.ocr.pdfText(await C.docs.blob(rdoc.id));
  const f = (x) => (x ? { v: x.value, c: x.confidence } : null);
  return { ms: Math.round(ms), status: item.status, ocrOk: item.ocrOk, ocrError: item.ocrError, amount: f(item.extraction.amount), date: f(item.extraction.date), payer: f(item.extraction.payerName), payee: f(item.extraction.receiverName), reference: f(item.extraction.reference), flags: item.validation.flags, client: item.clientId === maria.id, dup: dup.status, pdfText: /Gracias por tu pago/.test(pdfText) };
}, { b64: png.toString('base64'), base: assets ? srv.url + '/ocr' : null });

check(results, 'OCR ejecutado', res.ocrOk, res.ocrError || `${res.ms} ms`);
check(results, 'Valor leído', res.amount && res.amount.v === 38000, res.amount);
check(results, 'Fecha leída', !!(res.date && res.date.v), res.date);
check(results, 'Pagador leído', res.payer && /Mar[ií]a/i.test(res.payer.v), res.payer);
check(results, 'Beneficiario leído', res.payee && /COROC/i.test(res.payee.v), res.payee);
check(results, 'Referencia leída', res.reference && res.reference.v === '0048213377', res.reference);
check(results, 'Remitente identificado por número de WhatsApp', res.client);
check(results, 'Pago registrado automáticamente', res.status === 'applied_auto', `${res.status} · alertas: ${res.flags.map((x) => x.code || x).join(', ') || 'ninguna'}`);
check(results, 'CA-07 reenvío por correo marcado DUPLICADO', res.dup === 'duplicate', res.dup);
check(results, 'Texto extraído de un PDF con capa de texto', res.pdfText);

await browser.close();
srv.close();
finish(results, errors);
