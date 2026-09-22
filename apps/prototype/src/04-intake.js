/* COROC · recepción y lectura de comprobantes (§12–§14) */
C.intake = {
  clientRefs() {
    return C.state.clients.map((c) => {
      const loans = C.loansOf(c.id).filter((l) => l.status === 'active').map((l) => {
        const st = C.loanState(l);
        const pending = st.states.filter((s) => s.paid < s.amount).map((s) => s.amount - s.paid);
        const overdue = st.states.find((s) => s.paid < s.amount && s.dueDate < C.today());
        return { id: l.id, currency: l.terms.currency, pendingAmounts: pending, oldestOverdueDate: overdue ? overdue.dueDate : undefined };
      });
      return {
        id: c.id, fullName: C.fullName(c), phones: [c.phone, c.phone2].filter(Boolean), emails: [c.email].filter(Boolean),
        coDebtorPhones: c.coDebtor && c.coDebtor.phone ? [c.coDebtor.phone] : [], coDebtorName: c.coDebtor ? c.coDebtor.name : undefined,
        active: loans.length > 0, loans,
      };
    });
  },

  /** Huellas ya conocidas. `pending` incluye los comprobantes que esperan revisión (para no duplicar la bandeja). */
  seenKeys({ pending = false, exceptId = null } = {}) {
    const files = new Set();
    const logical = new Set();
    const ok = pending ? ['applied_auto', 'approved', 'review', 'unassigned'] : ['applied_auto', 'approved'];
    for (const it of C.state.inbox) {
      if (it.id === exceptId || !ok.includes(it.status)) continue;
      if (it.sha256) files.add(it.sha256);
      if (it.logicalKey) logical.add(it.logicalKey);
    }
    return { files, logical };
  },

  async readText(blob, onProgress) {
    const type = blob.type || '';
    if (type === 'application/pdf') return C.ocr.pdfText(blob, onProgress);
    if (type.startsWith('image/')) return C.ocr.imageText(blob, onProgress);
    if (type.startsWith('text/')) return blob.text();
    return '';
  },

  /** Recibe un archivo por cualquier canal y lo lleva por el pipeline completo. */
  async receive(file, evidence = {}) {
    const blob = file instanceof Blob ? file : new Blob([file]);
    const sha = await C.sha256(blob);
    const item = {
      id: C.uid(), createdAt: C.nowLocal(), ts: Date.now(), status: 'processing', stage: 'RECIBIDO', source: evidence.source || 'upload',
      sha256: sha, fileName: file.name || 'comprobante', mime: blob.type, senderPhone: evidence.phone || null, senderEmail: evidence.email || null,
      hintClientId: evidence.clientId || null, folderPath: evidence.folderPath || null,
    };
    C.state.inbox.unshift(item);
    await C.db.put('inbox', item);
    C.emit('inbox');

    // Duplicado exacto (ya registrado o esperando revisión) antes de guardar otra copia
    const seen = C.intake.seenKeys({ pending: true, exceptId: item.id });
    if (seen.files.has(sha)) {
      item.status = 'duplicate';
      item.stage = 'DUPLICADO';
      item.duplicateOf = 'file';
      await C.db.put('inbox', item);
      await C.audit('intake.duplicate', 'inbox', item.id, { file: item.fileName });
      C.emit('inbox');
      return item;
    }

    const doc = await C.docs.save({ clientId: null, loanId: null, kind: 'receipt_in', name: `${C.docs.fileStamp()}_${C.t('COMPROBANTE', null, C.companyLang())}_${item.fileName}`, source: item.source, sha256: sha, mime: blob.type }, blob);
    item.docId = doc.id;
    item.stage = 'ALMACENADO';
    // Archivo dejado en la carpeta COROC: se mueve a su ubicación definitiva con el nombre estándar (§16.3).
    if (item.folderPath && doc.folderPath) await C.fs.remove(item.folderPath);
    await C.db.put('inbox', item);

    let text = '';
    try {
      item.stage = 'LEÍDO';
      text = await C.intake.readText(blob, (p) => {
        item.progress = p;
        C.emit('inbox-progress', item);
      });
      item.ocrOk = true;
    } catch (e) {
      item.ocrOk = false;
      item.ocrError = String(e && e.message ? e.message : e);
    }
    item.text = text;
    await C.intake.evaluate(item);
    return item;
  },

  /** Extrae, identifica, valida y decide (también se usa al reprocesar). */
  async evaluate(item, override) {
    const S = C.state.settings;
    const ex = override && override.extraction ? override.extraction : Core.extractFromText(item.text || '', { receivedOn: C.today(), defaultCurrency: C.currency() });
    item.extraction = ex;
    item.stage = 'EXTRAÍDO';
    const refs = C.intake.clientRefs();
    const ev = {
      phone: item.senderPhone || undefined, email: item.senderEmail || undefined,
      folderClientId: item.hintClientId || undefined, payerName: ex.payerName.value || undefined, amount: ex.amount.value || undefined,
    };
    const ident = Core.identifySender(ev, refs);
    item.identification = ident;
    let clientRef = ident.status === 'identified' ? refs.find((r) => r.id === ident.clientId) : null;
    let pick = clientRef && ex.amount.value ? Core.pickLoan(clientRef, ex.amount.value) : { rule: 'ambiguous' };
    if (clientRef && !ex.amount.value && clientRef.loans.length === 1) pick = { loanId: clientRef.loans[0].id, rule: 'single' };
    item.clientId = ident.clientId || null;
    item.loanId = pick.loanId || null;
    item.loanRule = pick.rule;

    const logicalKey = ex.amount.value && ex.date.value
      ? Core.logicalFingerprint({ reference: ex.reference && ex.reference.value, amount: ex.amount.value, date: ex.date.value, time: ex.time && ex.time.value, entity: ex.entity && ex.entity.value, payerName: ex.payerName.value })
      : null;
    item.logicalKey = logicalKey;
    const seen = C.intake.seenKeys({ pending: true, exceptId: item.id });
    const dup = Core.isDuplicate(item.sha256, logicalKey, seen.files, seen.logical);

    const client = item.clientId ? C.clientById(item.clientId) : null;
    const loan = item.loanId ? C.loanById(item.loanId) : null;
    let validation = { flags: [], autoEligible: false };
    if (client && loan) {
      validation = Core.validateExtraction(ex, {
        receivingAccounts: S.receivingAccounts, clientName: C.fullName(client), coDebtorName: client.coDebtor && client.coDebtor.name,
        loanCurrency: loan.terms.currency, disbursementDate: loan.terms.disbursementDate, today: C.today(), maxAgeDays: S.maxAgeDays,
        confidenceThreshold: S.confidenceThreshold, senderVerified: ident.status === 'identified' && !!ident.via,
      });
    } else if (ex.documentType.value === 'other') {
      validation.flags.push({ code: 'NOT_A_RECEIPT', severity: 'blocking' });
    }
    if (!item.ocrOk && !override) validation.flags.push({ code: 'OCR_UNAVAILABLE', severity: 'blocking' });
    item.validation = validation;
    item.stage = 'VALIDADO';

    const decision = Core.decideAutoApply(ident, pick, validation, dup, S.supervisionMode);
    item.decision = decision;
    if (decision === 'duplicate') {
      item.status = 'duplicate';
      item.stage = 'DUPLICADO';
      item.duplicateOf = dup;
    } else if (decision === 'apply' && !override) {
      await C.intake.apply(item, { auto: true });
      return item;
    } else if (ident.status === 'unknown' || ident.status === 'ambiguous') {
      item.status = 'unassigned';
      item.stage = 'EN_REVISIÓN';
    } else {
      item.status = 'review';
      item.stage = 'EN_REVISIÓN';
    }
    if (client && item.docId) await C.docs.link(item.docId, client, loan, 'receipt_in');
    await C.db.put('inbox', item);
    await C.audit('intake.evaluated', 'inbox', item.id, { decision, status: item.status });
    C.emit('inbox');
    return item;
  },

  /** Registra el pago de un elemento de la bandeja (automático o aprobado por una persona). */
  async apply(item, { auto = false, fields } = {}) {
    const ex = item.extraction;
    const amount = fields ? fields.amount : ex.amount.value;
    const date = fields ? fields.date : ex.date.value;
    const clientId = fields ? fields.clientId : item.clientId;
    const loanId = fields ? fields.loanId : item.loanId;
    if (!clientId || !loanId) throw new Error(C.t('Seleccione el cliente y el préstamo.'));
    if (!amount || amount <= 0) throw new Error(C.t('El valor del pago debe ser mayor que cero.'));
    const loan = C.loanById(loanId);
    if (fields) {
      item.extraction = {
        ...ex,
        amount: { value: amount, confidence: 1 }, date: { value: date, confidence: 1 },
        payerName: { value: fields.payerName || null, confidence: 1 }, receiverName: { value: fields.receiverName || null, confidence: 1 },
        reference: { value: fields.reference || null, confidence: 1 }, entity: { value: fields.entity || null, confidence: 1 },
      };
      item.logicalKey = Core.logicalFingerprint({ reference: fields.reference, amount, date, entity: fields.entity, payerName: fields.payerName });
      const seen = C.intake.seenKeys({ exceptId: item.id });
      if (item.logicalKey && seen.logical.has(item.logicalKey)) throw new Error(C.t('Este comprobante ya fue registrado (duplicado).'));
    }
    const res = await C.registerPayment(loanId, {
      amount, date: date || C.today(), method: (item.extraction.entity && item.extraction.entity.value) || '', entity: (item.extraction.entity && item.extraction.entity.value) || '',
      reference: (item.extraction.reference && item.extraction.reference.value) || '', source: item.source === 'folder' ? 'folder' : 'inbox',
      docId: item.docId, inboxId: item.id, auto, replyChannel: item.senderEmail && !item.senderPhone ? 'email' : 'whatsapp',
    });
    item.clientId = clientId;
    item.loanId = loanId;
    item.entryId = res.entry.id;
    item.status = auto ? 'applied_auto' : 'approved';
    item.stage = 'RECIBO_EMITIDO';
    item.appliedAt = C.nowLocal();
    item.appliedTs = Date.now();
    item.decidedBy = auto ? 'sistema' : C.state.user.username;
    await C.db.put('inbox', item);
    await C.audit(auto ? 'intake.auto_applied' : 'intake.approved', 'inbox', item.id, { contract: loan.contract, amount });
    C.emit('inbox');
    return res;
  },

  async revertAuto(item) {
    const hours = C.state.settings.autoRevertHours || 72;
    if (item.status !== 'applied_auto' || Date.now() - item.appliedTs > hours * 3600000) throw new Error(C.t('El plazo para revertir con un toque ya venció; use el reverso formal.'));
    await C.reversePayment(item.loanId, item.entryId, C.t('Reversión de registro automático desde la bandeja'));
    item.status = 'review';
    item.stage = 'EN_REVISIÓN';
    item.revertedAt = C.nowLocal();
    await C.db.put('inbox', item);
    C.emit('inbox');
  },

  async setStatus(item, status, reason) {
    item.status = status;
    item.reason = reason || '';
    item.decidedBy = C.state.user.username;
    if (status === 'archived' && item.docId) {
      const doc = C.state.documents.find((d) => d.id === item.docId);
      if (doc) {
        doc.kind = 'other';
        await C.db.put('documents', doc);
        if (item.clientId) await C.docs.link(doc.id, C.clientById(item.clientId), item.loanId ? C.loanById(item.loanId) : null, 'other');
      }
    }
    await C.db.put('inbox', item);
    await C.audit(`intake.${status}`, 'inbox', item.id, { reason });
    C.emit('inbox');
  },

  pendingCount: () => C.state.inbox.filter((i) => ['review', 'unassigned'].includes(i.status) && (C.can('data.all') || !i.clientId || C.visibleClients().some((c) => c.id === i.clientId))).length,
};
