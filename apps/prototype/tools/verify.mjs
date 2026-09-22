// Verificación de CA-13 (respaldo), CA-15 (carpeta COROC), CA-16 (roles y bitácora) y CA-18 (reverso)
// sobre dist/COROC.html servido en localhost. Uso: node tools/verify.mjs
import { serve, launch, setupDemo, check, finish } from './_harness.mjs';

const srv = await serve();
const { browser, page, errors } = await launch();
const results = [];
await setupDemo(page, srv.url + '/COROC.html');

const r = await page.evaluate(async () => {
  const out = {};
  const tree = async (dir, prefix = '') => {
    const acc = [];
    for await (const [n, h] of dir.entries()) {
      acc.push(prefix + n + (h.kind === 'directory' ? '/' : ''));
      if (h.kind === 'directory') acc.push(...(await tree(h, prefix + n + '/')));
    }
    return acc;
  };
  // La carpeta privada del navegador (OPFS) expone la misma API que la carpeta que el usuario autoriza.
  const opfs = await navigator.storage.getDirectory();
  const root = await opfs.getDirectoryHandle('COROC', { create: true });
  C.fs.root = root;
  C.fs.status = 'connected';
  for (const f of Object.values(C.ROOTFOLDERS.es)) await root.getDirectoryHandle(f, { create: true });
  out.synced = await C.fs.syncAll();

  // ── CA-15 ──
  const client = await C.saveClient({ firstName: 'María José', lastName: 'Pérez Gómez', phone: C.normalizePhoneOrNull('3157778899'), email: '', consents: { whatsapp: { at: C.nowLocal(), method: 'verificacion' } } }, true);
  const loan = await C.createLoan(client, C.termsFromForm({ principal: 1000000, method: 'french', rate: '0.018', installments: 6, frequency: 'monthly', disbursementDate: C.today(), excludeHolidays: true, collectionDays: [1, 2, 3, 4, 5, 6] }), {});
  let all = await tree(root);
  const base = `${client.folderName}/${loan.contract}/`;
  out.ca15 = {
    folderName: client.folderName, contract: loan.contract,
    subfolders: all.filter((x) => x.startsWith(base) && x.endsWith('/') && x.split('/').length === 4).map((x) => x.slice(base.length, -1)).sort(),
    planPdf: all.filter((x) => x.startsWith(base + '01 ') && x.endsWith('.pdf')),
    idFile: all.includes(client.folderName + '/.coroc-id'),
    rootFolders: all.filter((x) => /^_[^/]+\/$/.test(x)).sort(),
  };

  // ── CA-18 ──
  const m0 = C.metrics.compute();
  const pay = await C.registerPayment(loan.id, { amount: loan.installments[0].amount, method: 'Efectivo' });
  const m1 = C.metrics.compute();
  all = await tree(root);
  const receiptFiles = () => all.filter((x) => x.startsWith(base + '03 ') && x.endsWith('.pdf'));
  const afterPay = { balance: C.loanState(loan).summary.balance, receipts: receiptFiles().length };
  await C.reversePayment(loan.id, pay.entry.id, 'Verificación CA-18');
  const m2 = C.metrics.compute();
  all = await tree(root);
  const rev = loan.ledger.find((e) => e.type === 'reversal' && e.reverses === pay.entry.id);
  out.ca18 = {
    reversal: rev ? { amount: rev.amount, reason: rev.reason } : null,
    original: pay.entry.amount,
    voided: !!C.state.documents.find((d) => d.voidOf === pay.receipt.doc.id),
    voidedFile: receiptFiles().some((x) => /ANULADO/.test(x)),
    balanceBefore: loan.totalPayable, afterPay, balanceAfterReverse: C.loanState(loan).summary.balance,
    receivable: [m0.totalReceivable, m1.totalReceivable, m2.totalReceivable],
    collectedToday: [m0.collectedToday, m1.collectedToday, m2.collectedToday],
  };

  // Renombrar cliente: la carpeta cambia sin perder archivos
  const old = client.folderName;
  const filesBefore = all.filter((x) => x.startsWith(old + '/') && !x.endsWith('/')).length;
  client.lastName = 'Pérez Gómez de Ríos';
  await C.saveClient(client, false);
  await C.fs.renameClientFolder(client, old);
  all = await tree(root);
  out.rename = { oldExists: all.some((x) => x.startsWith(old + '/')), newFolder: client.folderName, filesBefore, filesAfter: all.filter((x) => x.startsWith(client.folderName + '/') && !x.endsWith('/')).length };

  // ── CA-13 ──
  const counts = { clients: C.state.clients.length, loans: C.state.loans.length, documents: C.state.documents.length };
  const bk = await C.backup.create('RespaldoSeguro2026');
  out.backupName = bk.name;
  try { await C.backup.open(new File([bk.blob], bk.name), 'otra-clave-123'); out.wrongPwd = null; } catch (e) { out.wrongPwd = e.message; }
  const bytes = new Uint8Array(await bk.blob.arrayBuffer());
  bytes[bytes.length - 50] ^= 0xff;
  try { await C.backup.open(new File([bytes], 'x.coroc'), 'RespaldoSeguro2026'); out.tamper = null; } catch (e) { out.tamper = e.message; }
  const opened = await C.backup.open(new File([bk.blob], bk.name), 'RespaldoSeguro2026');
  for (const s of C.db.STORES) await C.db.clear(s);
  await C.backup.restore(opened);
  const [clients, loans, documents, blobs] = await Promise.all(['clients', 'loans', 'documents', 'blobs'].map((s) => C.db.all(s)));
  let hashOk = 0;
  let pdfOk = 0;
  for (const d of documents) {
    const bl = blobs.find((x) => x.id === d.id);
    if (bl && (await C.sha256(bl.blob)) === d.sha256) hashOk++;
    if (bl && d.mime === 'application/pdf' && new TextDecoder().decode(await bl.blob.slice(0, 5).arrayBuffer()) === '%PDF-') pdfOk++;
  }
  out.ca13 = { before: counts, after: { clients: clients.length, loans: loans.length, documents: documents.length }, blobs: blobs.length, sha256Match: hashOk, pdfs: documents.filter((d) => d.mime === 'application/pdf').length, pdfOk };
  return out;
});

check(results, 'CA-15 carpeta del cliente con código', /^Maria Jose Perez Gomez - C\d{6}$/.test(r.ca15.folderName), r.ca15.folderName);
check(results, 'CA-15 carpeta del contrato con 5 subcarpetas', r.ca15.subfolders.length === 5, r.ca15.subfolders);
check(results, 'CA-15 PDF del plan de pagos en «01 Contrato y plan de pagos»', r.ca15.planPdf.length >= 1, r.ca15.planPdf[0]);
check(results, 'CA-15 archivo .coroc-id en la carpeta del cliente', r.ca15.idFile);
check(results, 'CA-15 carpetas raíz _Sin asignar, _Entrada, _Informes, _Respaldos', r.ca15.rootFolders.length === 4, r.ca15.rootFolders);
check(results, 'Renombrar cliente conserva todos los archivos', !r.rename.oldExists && r.rename.filesAfter === r.rename.filesBefore, r.rename);
check(results, 'CA-18 contramovimiento en el libro', r.ca18.reversal && r.ca18.reversal.amount === -r.ca18.original, r.ca18.reversal);
check(results, 'CA-18 recibo marcado ANULADO (repositorio y carpeta)', r.ca18.voided && r.ca18.voidedFile);
check(results, 'CA-18 saldo recalculado', r.ca18.afterPay.balance === r.ca18.balanceBefore - r.ca18.original && r.ca18.balanceAfterReverse === r.ca18.balanceBefore, r.ca18);
check(results, 'CA-18 dashboard recalculado', r.ca18.receivable[0] === r.ca18.receivable[2] && r.ca18.receivable[1] === r.ca18.receivable[0] - r.ca18.original && r.ca18.collectedToday[2] === r.ca18.collectedToday[0], { porRecibir: r.ca18.receivable, recaudadoHoy: r.ca18.collectedToday });
check(results, 'CA-13 contraseña errada rechazada', !!r.wrongPwd, r.wrongPwd);
check(results, 'CA-13 byte alterado rechazado', !!r.tamper, r.tamper);
check(results, 'CA-13 conteos idénticos tras restaurar', JSON.stringify(r.ca13.before) === JSON.stringify(r.ca13.after), r.ca13.after);
check(results, 'CA-13 huellas SHA-256 idénticas', r.ca13.sha256Match === r.ca13.after.documents && r.ca13.blobs === r.ca13.after.documents, `${r.ca13.sha256Match}/${r.ca13.after.documents}`);
check(results, 'CA-13 todos los PDF abren (cabecera %PDF)', r.ca13.pdfOk === r.ca13.pdfs, `${r.ca13.pdfOk}/${r.ca13.pdfs}`);

// ── CA-16 y bloqueo por intentos ──
await page.goto(srv.url + '/COROC.html');
await page.waitForSelector('#login');
await page.fill('[name=u]', 'andres');
await page.fill('[name=p]', 'CorocSegura2026');
await page.click('#login .btn-primary');
await page.waitForFunction(() => window.C && C.state && C.state.user, null, { timeout: 60000 });
await page.waitForTimeout(800);
const roles = await page.evaluate(async () => {
  const u = await C.auth.createUser({ username: 'cobrador1', name: 'Cobrador Uno', role: 'collector', password: 'CobradorSeguro2026' });
  const mine = C.state.clients[0];
  mine.collectorId = u.id;
  await C.saveClient(mine, false);
  const other = C.state.clients[1];
  const owner = C.state.user;
  C.state.user = u;
  const res = { visible: C.visibleClients().length, total: C.state.clients.length, canReverse: C.can('payment.reverse'), canReports: C.can('reports.view'), canPay: C.can('payment.register') };
  // Se simula la sesión del Cobrador y se navega a la ficha de un cliente de otro cobrador
  let view = document.querySelector('#view');
  if (!view) { view = document.createElement('main'); view.id = 'view'; document.body.append(view); }
  C.views.client(view, other.id);
  await new Promise((ok) => setTimeout(ok, 300));
  res.view = view.innerText.trim().split('\n')[0];
  const audit = await C.db.all('audit');
  res.logged = audit.some((a) => a.action === 'access.denied' && a.entityId === other.id && a.userId === u.id);
  C.state.user = owner;
  let msg = '';
  for (let i = 0; i < 6; i++) {
    try { await C.auth.login('cobrador1', 'mala-clave-000'); } catch (e) { msg = e.message; }
  }
  res.lockout = msg;
  return res;
});
// ── CA-08: comprobante de un número no registrado → Sin asignar; al asignarlo se ofrece guardar el número ──
const ca08 = await page.evaluate(() => {
  const item = C.state.inbox.find((i) => i.status === 'unassigned');
  return item ? { id: item.id, phone: item.senderPhone, suggestions: ((item.identification && item.identification.candidates) || []).length } : null;
});
check(results, 'CA-08 número no registrado queda «Sin asignar»', ca08 && ca08.phone === '+573150000000', ca08);
check(results, 'CA-08 con sugerencias de cliente', ca08 && ca08.suggestions > 0, ca08 && ca08.suggestions);
await page.evaluate((id) => { C.ui.reviewItem(C.state.inbox.find((i) => i.id === id)); }, ca08.id);
await page.waitForSelector('.review select[name=clientId]');
const target = await page.evaluate(() => { const c = C.state.clients.find((x) => x.status !== 'inactive' && C.loansOf(x.id).some((l) => l.status === 'active')); return { id: c.id, name: C.fullName(c) }; });
await page.selectOption('.review select[name=clientId]', target.id);
const offer = await page.evaluate(() => { const b = document.querySelector('#rv-save'); return b && !b.hidden ? b.innerText.trim() : null; });
check(results, 'CA-08 al asignarlo se ofrece guardar el número', offer && offer.includes('+573150000000'), offer);
await page.click('.review [data-a=approve]');
await page.waitForFunction((id) => C.state.inbox.find((i) => i.id === id).status === 'approved', ca08.id, { timeout: 20000 });
const learned = await page.evaluate((cid) => C.clientById(cid).phone2, target.id);
check(results, 'CA-08 número guardado como secundario del cliente', learned === '+573150000000', learned);

check(results, 'CA-16 el Cobrador solo ve sus clientes', roles.visible === 1 && roles.total > 1, `${roles.visible} de ${roles.total}`);
check(results, 'CA-16 el Cobrador no reversa ni ve informes globales', !roles.canReverse && !roles.canReports && roles.canPay);
check(results, 'CA-16 acceso denegado a cliente de otro cobrador', /sin acceso/i.test(roles.view), roles.view);
check(results, 'CA-16 intento registrado en la bitácora', roles.logged);
check(results, 'Bloqueo tras 5 intentos fallidos', /bloquead/i.test(roles.lockout), roles.lockout);

await browser.close();
srv.close();
finish(results, errors);
