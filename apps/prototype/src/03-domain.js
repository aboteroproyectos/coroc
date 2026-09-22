/* COROC · dominio: empresa, usuarios, clientes, préstamos, libro, pagos y documentos */
C.DEFAULT_SETTINGS = {
  supervisionMode: 'auto_with_audit',
  confidenceThreshold: 0.95,
  maxAgeDays: 30,
  autoRevertHours: 72,
  contactRules: true,
  transactionalImmediate: false,
  whatsappMode: 'assisted',
  rateCap: { ea: null, validFrom: '', validTo: '' },
  receivingAccounts: [],
  prefixes: { client: 'C', contract: 'CT-', receipt: 'RC-' },
  roundingUnit: 1,
  defaultCollectionDays: [1, 2, 3, 4, 5, 6],
  excludeHolidays: true,
  lateFee: null,
  messages: { welcome: true, reminder: true, overdue: true, receipt: true, statement: true, payoff: true },
  reminderTime: '08:00',
  dailyReminders: false,
  theme: 'system',
};

C.ROLES = {
  owner: ['*'],
  admin: ['client.create', 'client.edit', 'loan.create', 'payment.register', 'payment.reverse', 'inbox.validate', 'message.send', 'reports.view', 'settings.edit', 'users.manage', 'backup.create', 'audit.view', 'data.all'],
  collector: ['payment.register', 'inbox.validate', 'message.send'],
  auditor: ['reports.view', 'audit.view', 'data.all'],
};
C.can = (action) => {
  const u = C.state.user;
  if (!u) return false;
  const perms = C.ROLES[u.role] || [];
  return perms.includes('*') || perms.includes(action);
};
C.visibleClients = () => (C.can('data.all') ? C.state.clients : C.state.clients.filter((c) => c.collectorId === C.state.user.id));
C.visibleLoans = () => {
  const ids = new Set(C.visibleClients().map((c) => c.id));
  return C.state.loans.filter((l) => ids.has(l.clientId));
};

/* ─────────── Contraseñas (PBKDF2-SHA256 en el prototipo; Argon2id en el servidor, ADR-006) ─────────── */
C.auth = {
  ITER: 310000,
  async hash(password, saltB64, iterations = C.auth.ITER) {
    const salt = saltB64 ? C.b64.dec(saltB64) : crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
    return { salt: C.b64.enc(salt), hash: C.b64.enc(bits), iterations };
  },
  policy(pw) {
    const common = ['123456789012', 'password1234', 'contraseña123', 'qwertyuiop12', 'coroc1234567'];
    if (!pw || pw.length < 12) return C.t('La contraseña debe tener al menos 12 caracteres.');
    if (common.includes(pw.toLowerCase())) return C.t('Esa contraseña es demasiado común.');
    if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return C.t('Use letras y números.');
    return null;
  },
  async createUser({ username, name, role, password, collectorOf }) {
    const u = username.trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(u)) throw new Error(C.t('El usuario debe tener de 3 a 32 caracteres: letras, números, punto o guion.'));
    if (C.state.users.some((x) => x.username === u)) throw new Error(C.t('Ese usuario ya existe.'));
    const err = C.auth.policy(password);
    if (err) throw new Error(err);
    const h = await C.auth.hash(password);
    const user = { id: C.uid(), username: u, name: name.trim(), role, ...h, failed: 0, lockedUntil: 0, active: true, createdAt: C.nowLocal(), collectorOf: collectorOf || null };
    await C.db.put('users', user);
    C.state.users.push(user);
    return user;
  },
  async login(username, password) {
    const u = C.state.users.find((x) => x.username === String(username).trim().toLowerCase() && x.active);
    const generic = new Error(C.t('Usuario o contraseña incorrectos.'));
    if (!u) {
      await C.auth.hash(password || 'x'); // tiempo constante aproximado
      throw generic;
    }
    if (u.lockedUntil && Date.now() < u.lockedUntil) {
      const min = Math.ceil((u.lockedUntil - Date.now()) / 60000);
      throw new Error(C.tp('Cuenta bloqueada por seguridad. Intente de nuevo en {n} minuto.', 'Cuenta bloqueada por seguridad. Intente de nuevo en {n} minutos.', min));
    }
    const h = await C.auth.hash(password, u.salt, u.iterations);
    if (h.hash !== u.hash) {
      u.failed = (u.failed || 0) + 1;
      if (u.failed >= 5) {
        u.lockedUntil = Date.now() + 15 * 60000;
        u.failed = 0;
        await C.audit('auth.locked', 'user', u.id, { username: u.username });
      }
      await C.db.put('users', u);
      throw generic;
    }
    u.failed = 0;
    u.lockedUntil = 0;
    u.lastLoginAt = C.nowLocal();
    await C.db.put('users', u);
    C.state.user = u;
    await C.audit('auth.login', 'user', u.id, {});
    return u;
  },
  async changePassword(user, next) {
    const err = C.auth.policy(next);
    if (err) throw new Error(err);
    Object.assign(user, await C.auth.hash(next));
    await C.db.put('users', user);
    await C.audit('auth.password_changed', 'user', user.id, {});
  },
};

/* ─────────── Bitácora inmutable ─────────── */
C.audit = async (action, entity, entityId, detail) => {
  const rec = { id: C.uid(), at: C.nowLocal(), ts: Date.now(), userId: C.state.user ? C.state.user.id : null, username: C.state.user ? C.state.user.username : 'sistema', action, entity, entityId, detail: detail || {} };
  await C.db.put('audit', rec);
  return rec;
};

/* ─────────── Numeraciones ─────────── */
C.nextSeq = async (name) => {
  const seq = await C.db.kvGet('seq', { client: 0, contract: 0, receipt: 0 });
  seq[name] = (seq[name] || 0) + 1;
  await C.db.kvSet('seq', seq);
  const p = C.state.settings.prefixes;
  if (name === 'client') return `${p.client}${String(seq[name]).padStart(6, '0')}`;
  if (name === 'contract') return `${p.contract}${String(seq[name]).padStart(6, '0')}`;
  return `${p.receipt}${String(seq[name]).padStart(6, '0')}`;
};

C.saveSettings = async (patch) => {
  C.state.settings = { ...C.state.settings, ...patch };
  await C.db.kvSet('settings', C.state.settings);
};
C.saveCompany = async (patch) => {
  C.state.company = { ...C.state.company, ...patch };
  await C.db.kvSet('company', C.state.company);
};

/* ─────────── Clientes ─────────── */
C.fullName = (c) => `${c.firstName} ${c.lastName}`.trim();
C.clientById = (id) => C.state.clients.find((c) => c.id === id);
C.loanById = (id) => C.state.loans.find((l) => l.id === id);
C.loansOf = (clientId) => C.state.loans.filter((l) => l.clientId === clientId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

/**
 * Nombre seguro para carpetas y archivos en Windows, macOS, Android, iOS, ZIP y sincronizadores en la nube:
 * sin caracteres reservados y sin tildes (ADR-013; «María José Pérez» → «Maria Jose Perez»).
 */
C.sanitizeFolder = (s) => Core.stripAccents(String(s)).replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
C.clientFolderName = (c) => C.sanitizeFolder(`${C.fullName(c)} - ${c.code}`);

C.normalizePhoneOrNull = (raw) => {
  if (!raw || !String(raw).trim()) return null;
  return Core.normalizePhone(String(raw), C.state.company.country || 'CO');
};

C.findDuplicateClient = ({ phone, idDoc }, exceptId) =>
  C.state.clients.find((c) => c.id !== exceptId && ((phone && (c.phone === phone || c.phone2 === phone)) || (idDoc && c.idDoc && c.idDoc.replace(/\D/g, '') === idDoc.replace(/\D/g, ''))));

C.saveClient = async (client, isNew) => {
  if (isNew) {
    client.id = C.uid();
    client.code = await C.nextSeq('client');
    client.createdAt = C.nowLocal();
    client.createdBy = C.state.user.id;
    C.state.clients.push(client);
  }
  client.folderName = C.clientFolderName(client);
  await C.db.put('clients', client);
  await C.audit(isNew ? 'client.created' : 'client.updated', 'client', client.id, { code: client.code });
  return client;
};

/* ─────────── Préstamos ─────────── */
C.termsFromForm = (f) => ({
  principal: f.principal,
  currency: f.currency || C.currency(),
  method: f.method,
  rate: f.rate,
  installments: f.installments,
  frequency: f.frequency,
  disbursementDate: f.disbursementDate,
  firstDueDate: f.firstDueDate || undefined,
  country: C.state.company.country || 'CO',
  collectionDays: f.frequency === 'daily' ? f.collectionDays : undefined,
  excludeHolidays: f.excludeHolidays,
  monthlyDay: f.frequency === 'monthly' && f.monthlyDay ? f.monthlyDay : undefined,
  roundingUnit: f.roundingUnit || C.state.settings.roundingUnit || 1,
});

C.previewLoan = (terms) => {
  const schedule = Core.buildSchedule(terms);
  const ea = Core.effectiveAnnualRate(Core.scheduleFlows(schedule));
  const cap = C.state.settings.rateCap && C.state.settings.rateCap.ea;
  const capCheck = cap ? Core.checkRateCap(terms, cap) : null;
  return { schedule, ea, capCheck };
};

C.createLoan = async (client, terms, extra = {}) => {
  const { schedule, ea, capCheck } = C.previewLoan(terms);
  if (capCheck && !capCheck.ok) throw new Error(C.t('La tasa supera el tope legal configurado.'));
  const loan = {
    id: C.uid(),
    clientId: client.id,
    contract: extra.contract || (await C.nextSeq('contract')),
    terms: schedule.terms,
    lateFee: extra.lateFee || C.state.settings.lateFee || null,
    expectedMethod: extra.expectedMethod || '',
    installments: schedule.installments,
    regularInstallment: schedule.regularInstallment,
    totalPayable: schedule.totalPayable,
    totalInterest: schedule.totalInterest,
    ea,
    status: 'active',
    createdAt: C.nowLocal(),
    createdBy: C.state.user.id,
    ledger: [{ id: C.uid(), type: 'disbursement', date: terms.disbursementDate, at: C.nowLocal(), amount: terms.principal, userId: C.state.user.id }],
  };
  if (C.state.loans.some((l) => l.contract === loan.contract)) throw new Error(C.t('Ese número de contrato ya existe.'));
  await C.db.put('loans', loan);
  C.state.loans.push(loan);
  await C.audit('loan.created', 'loan', loan.id, { contract: loan.contract, principal: terms.principal });
  await C.docs.refreshPlan(loan);
  if (C.state.settings.messages.welcome) await C.msg.enqueueEvent('welcome', loan);
  C.emit('data');
  return loan;
};

/** Estado vivo de un préstamo reconstruido desde su libro (§9.7). */
C._stateCache = new Map();
C.loanState = (loan, asOf) => {
  const today = asOf || C.today();
  const key = `${loan.id}|${loan.ledger.length}|${today}|${loan.installments.length}|${loan.lateFee ? JSON.stringify(loan.lateFee) : ''}`;
  const hit = C._stateCache.get(loan.id);
  if (hit && hit.key === key) return hit.value;
  const value = C._loanState(loan, today);
  C._stateCache.set(loan.id, { key, value });
  return value;
};
C._loanState = (loan, today) => {
  let states = loan.installments.map((i) => ({ number: i.number, dueDate: i.dueDate, amount: i.amount, paid: 0, lateFeeAccrued: 0, lateFeePaid: 0 }));
  const reversed = new Set(loan.ledger.filter((e) => e.type === 'reversal').map((e) => e.reverses));
  const payments = loan.ledger.filter((e) => e.type === 'payment' && !reversed.has(e.id)).sort((a, b) => (a.date + a.at < b.date + b.at ? -1 : 1));
  const allocations = {};
  for (const p of payments) {
    if (loan.lateFee) states = Core.accrueLateFees(states, p.date, loan.lateFee);
    const r = Core.allocatePayment(states, p.amount);
    allocations[p.id] = r;
    states = r.after;
  }
  if (loan.lateFee) states = Core.accrueLateFees(states, today, loan.lateFee);
  const summary = Core.summarize(states, today);
  const surplus = payments.reduce((s, p) => s + (allocations[p.id] ? allocations[p.id].surplus : 0), 0);
  return { states, summary, allocations, payments, surplus };
};

C.statusOfLoan = (loan, st) => {
  if (loan.status === 'closed' || st.summary.balance === 0) return 'closed';
  if (st.summary.overdueCount > 0) return 'overdue';
  return 'current';
};

/* ─────────── Pagos ─────────── */
C.registerPayment = async (loanId, p) => {
  const loan = C.loanById(loanId);
  const client = C.clientById(loan.clientId);
  if (!Number.isSafeInteger(p.amount) || p.amount <= 0) throw new Error(C.t('El valor del pago debe ser mayor que cero.'));
  const before = C.loanState(loan);
  if (before.summary.balance === 0) throw new Error(C.t('Este préstamo ya está pagado.'));
  const entry = {
    id: C.uid(), type: 'payment', date: p.date || C.today(), at: C.nowLocal(), amount: p.amount,
    method: p.method || '', reference: p.reference || '', entity: p.entity || '', source: p.source || 'manual',
    docId: p.docId || null, inboxId: p.inboxId || null, auto: !!p.auto, userId: C.state.user ? C.state.user.id : null, note: p.note || '',
  };
  loan.ledger.push(entry);
  const after = C.loanState(loan);
  const alloc = after.allocations[entry.id];
  entry.allocation = alloc.lines;
  entry.surplus = alloc.surplus;
  entry.receiptNo = await C.nextSeq('receipt');
  if (after.summary.balance === 0) {
    loan.status = 'closed';
    loan.closedAt = C.nowLocal();
  }
  await C.db.put('loans', loan);
  if (p.docId) await C.docs.link(p.docId, client, loan, 'receipt_in');
  const receipt = await C.docs.issueReceipt(loan, client, entry, before.summary, after.summary, alloc.lines);
  entry.receiptDocId = receipt.doc.id;
  entry.receiptHash = receipt.hash;
  await C.db.put('loans', loan);
  await C.audit(p.auto ? 'payment.auto_applied' : 'payment.registered', 'loan', loan.id, { contract: loan.contract, amount: p.amount, receipt: entry.receiptNo });
  if (!C.state.seeding) await C.docs.refreshPlan(loan);
  if (C.state.settings.messages.receipt) await C.msg.enqueueEvent('receipt', loan, { entry, receiptDoc: receipt.doc, channel: p.replyChannel });
  if (loan.status === 'closed') {
    const payoff = await C.docs.issuePayoff(loan, client);
    if (C.state.settings.messages.payoff) await C.msg.enqueueEvent('payoff', loan, { doc: payoff });
  }
  C.emit('payment', { loan, client, entry });
  C.emit('data');
  return { entry, receipt };
};

C.reversePayment = async (loanId, entryId, reason) => {
  if (!reason || !reason.trim()) throw new Error(C.t('Indique el motivo del reverso.'));
  const loan = C.loanById(loanId);
  const entry = loan.ledger.find((e) => e.id === entryId);
  if (!entry || entry.type !== 'payment') throw new Error(C.t('Movimiento no encontrado.'));
  if (loan.ledger.some((e) => e.type === 'reversal' && e.reverses === entryId)) throw new Error(C.t('Ese pago ya fue reversado.'));
  loan.ledger.push({ id: C.uid(), type: 'reversal', reverses: entryId, date: C.today(), at: C.nowLocal(), amount: -entry.amount, reason: reason.trim(), userId: C.state.user.id });
  loan.status = C.loanState(loan).summary.balance === 0 ? 'closed' : 'active';
  await C.db.put('loans', loan);
  if (entry.receiptDocId) await C.docs.voidReceipt(entry.receiptDocId, loan, entry);
  await C.audit('payment.reversed', 'loan', loan.id, { contract: loan.contract, amount: entry.amount, receipt: entry.receiptNo, reason: reason.trim() });
  await C.docs.refreshPlan(loan);
  C.emit('data');
};

/* ─────────── Eventos internos ─────────── */
C._listeners = {};
C.on = (ev, fn) => (C._listeners[ev] ||= []).push(fn);
C.emit = (ev, payload) => (C._listeners[ev] || []).forEach((fn) => {
  try {
    fn(payload);
  } catch (e) {
    console.error(e);
  }
});

/* ─────────── Documentos (repositorio por cliente, §16) ─────────── */
C.SUBFOLDERS = {
  es: ['01 Contrato y plan de pagos', '02 Comprobantes recibidos', '03 Recibos emitidos', '04 Estados de cuenta', '05 Otros documentos'],
  'pt-BR': ['01 Contrato e plano de pagamento', '02 Comprovantes recebidos', '03 Recibos emitidos', '04 Extratos', '05 Outros documentos'],
  en: ['01 Contract and payment plan', '02 Received receipts', '03 Issued receipts', '04 Statements', '05 Other documents'],
};
C.ROOTFOLDERS = {
  es: { unassigned: '_Sin asignar', inbox: '_Entrada', reports: '_Informes', backups: '_Respaldos' },
  'pt-BR': { unassigned: '_Sem atribuição', inbox: '_Entrada', reports: '_Relatórios', backups: '_Backups' },
  en: { unassigned: '_Unassigned', inbox: '_Inbox', reports: '_Reports', backups: '_Backups' },
};
C.KIND_FOLDER = { plan: 0, schedule: 0, receipt_in: 1, receipt_out: 2, statement: 3, payoff: 3, other: 4 };
C.companyLang = () => C.state.company.lang || 'es';

C.docs = {
  async save(meta, blob) {
    const doc = {
      id: C.uid(), createdAt: C.nowLocal(), version: 1, size: blob.size, mime: blob.type || meta.mime || 'application/octet-stream',
      sha256: meta.sha256 || (await C.sha256(blob)), folderPath: null, ...meta,
    };
    if (doc.key) {
      const prev = C.state.documents.filter((d) => d.key === doc.key);
      doc.version = prev.length + 1;
      prev.forEach((d) => (d.superseded = true));
      for (const d of prev) await C.db.put('documents', d);
    }
    await C.db.putMany([{ store: 'documents', value: doc }, { store: 'blobs', value: { id: doc.id, blob } }]);
    C.state.documents.push(doc);
    await C.fs.writeDoc(doc, blob);
    return doc;
  },
  blob: async (id) => ((await C.db.get('blobs', id)) || {}).blob,
  of: (clientId) => C.state.documents.filter((d) => d.clientId === clientId && !d.superseded).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
  folderParts(doc) {
    const lang = C.companyLang();
    if (!doc.clientId) return [C.ROOTFOLDERS[lang].unassigned];
    const client = C.clientById(doc.clientId);
    const loan = doc.loanId ? C.loanById(doc.loanId) : null;
    const parts = [client.folderName || C.clientFolderName(client)];
    if (loan) parts.push(loan.contract);
    parts.push(C.SUBFOLDERS[lang][C.KIND_FOLDER[doc.kind] ?? 4]);
    return parts;
  },
  async link(docId, client, loan, kind) {
    const doc = C.state.documents.find((d) => d.id === docId);
    if (!doc) return;
    doc.clientId = client.id;
    doc.loanId = loan ? loan.id : null;
    doc.kind = kind || doc.kind;
    await C.db.put('documents', doc);
    const blob = await C.docs.blob(doc.id);
    await C.fs.writeDoc(doc, blob);
  },
  fileStamp() {
    return C.nowLocal().replace(/[-:]/g, '').replace('T', '_').replace(/^(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
  },
  async refreshPlan(loan) {
    const client = C.clientById(loan.clientId);
    const blob = await C.pdf.plan(loan, client);
    const name = `${C.t('Plan_de_pagos', null, C.companyLang())}_${loan.contract}.pdf`;
    return C.docs.save({ clientId: client.id, loanId: loan.id, kind: 'schedule', key: `schedule:${loan.id}`, name, source: 'system', fixedName: true }, blob);
  },
  async issueReceipt(loan, client, entry, before, after, lines) {
    const lang = client.lang || C.companyLang();
    const data = Core.buildReceiptData({
      lang, number: entry.receiptNo, issuedAt: C.nowLocal().replace('T', ' '),
      company: { name: C.state.company.name, taxId: C.state.company.taxId, phone: C.state.company.phone, email: C.state.company.email, address: [C.state.company.address, C.state.company.city].filter(Boolean).join(', ') },
      client: { fullName: C.fullName(client), code: client.code }, contract: loan.contract, currency: loan.terms.currency,
      payment: { date: entry.date, amount: entry.amount, method: entry.method || entry.entity, reference: entry.reference }, lines, before, after, verificationCode: '',
    });
    const hash = (await C.sha256(JSON.stringify({ n: data.number, c: data.contract, a: data.payment.amount, d: data.payment.date, b: data.newBalance, i: data.issuedAt }))).slice(0, 16).toUpperCase();
    data.verificationCode = `COROC-VERIFY|${data.number}|${hash}`;
    const blob = await C.pdf.receipt(data);
    const name = `${entry.date}_${C.t('RECIBO', null, C.companyLang())}_${entry.receiptNo}_${loan.contract}.pdf`;
    const doc = await C.docs.save({ clientId: client.id, loanId: loan.id, kind: 'receipt_out', name, source: 'system', receiptNo: entry.receiptNo, entryId: entry.id, receiptData: data }, blob);
    return { doc, hash, data };
  },
  async voidReceipt(docId, loan, entry) {
    const doc = C.state.documents.find((d) => d.id === docId);
    if (!doc || !doc.receiptData) return;
    const data = { ...doc.receiptData, voided: true };
    const blob = await C.pdf.receipt(data);
    const client = C.clientById(loan.clientId);
    await C.docs.save({ clientId: client.id, loanId: loan.id, kind: 'receipt_out', name: doc.name.replace(/\.pdf$/, `_${C.t('ANULADO', null, C.companyLang())}.pdf`), source: 'system', receiptNo: entry.receiptNo, voidOf: doc.id, receiptData: data }, blob);
    doc.voided = true;
    await C.db.put('documents', doc);
  },
  async issueStatement(loan) {
    const client = C.clientById(loan.clientId);
    const blob = await C.pdf.statement(loan, client);
    const name = `${C.today()}_${C.t('ESTADO_DE_CUENTA', null, C.companyLang())}_${loan.contract}.pdf`;
    return C.docs.save({ clientId: client.id, loanId: loan.id, kind: 'statement', name, source: 'system' }, blob);
  },
  async issuePayoff(loan, client) {
    const blob = await C.pdf.payoff(loan, client);
    const name = `${C.today()}_${C.t('PAZ_Y_SALVO', null, C.companyLang())}_${loan.contract}.pdf`;
    return C.docs.save({ clientId: client.id, loanId: loan.id, kind: 'payoff', name, source: 'system' }, blob);
  },
};
