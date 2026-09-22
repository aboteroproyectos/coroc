/* COROC · documentos PDF con la identidad de marca (§15, §16.4, §18) */
C.pdf = (() => {
  const NAVY = [19, 14, 66];
  const GOLD_TEXT = [138, 106, 43];
  const MUTED = [91, 88, 120];
  const LINE = [232, 228, 216];
  const IVORY = [255, 253, 244];
  const RED = [179, 38, 30];
  const GOLD_STOPS = [[165, 126, 51], [202, 163, 86], [233, 200, 121], [202, 165, 85], [165, 126, 51]];

  const newDoc = (format = 'a4', orientation = 'portrait') => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format, orientation, compress: true });
    const F = C.FONTS_TTF || {};
    const reg = (file, name, style, b64) => {
      if (!b64) return;
      doc.addFileToVFS(file, b64);
      doc.addFont(file, name, style);
    };
    reg('Inter-400.ttf', 'Inter', 'normal', F.inter400);
    reg('Inter-600.ttf', 'Inter', 'bold', F.inter600);
    reg('Montserrat-500.ttf', 'Montserrat', 'normal', F.mont500);
    reg('Montserrat-600.ttf', 'Montserrat', 'bold', F.mont600);
    doc.setLineHeightFactor(1.3);
    return doc;
  };
  const font = (doc, fam, style, size, color = NAVY) => {
    const hasFam = C.FONTS_TTF && C.FONTS_TTF.inter400;
    doc.setFont(hasFam ? fam : 'helvetica', style === 'bold' ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...color);
  };
  const goldBand = (doc, x, y, w, h) => {
    const slices = 60;
    for (let i = 0; i < slices; i++) {
      const t = i / (slices - 1);
      const seg = Math.min(GOLD_STOPS.length - 2, Math.floor(t * (GOLD_STOPS.length - 1)));
      const k = t * (GOLD_STOPS.length - 1) - seg;
      const c = GOLD_STOPS[seg].map((v, j) => Math.round(v + (GOLD_STOPS[seg + 1][j] - v) * k));
      doc.setFillColor(...c);
      doc.rect(x + (w * i) / slices, y, w / slices + 0.2, h, 'F');
    }
  };
  const logo = (doc, x, y, h) => {
    if (!C.ASSETS || !C.ASSETS.logoH) return;
    const ratio = C.ASSETS.logoHRatio || 4;
    doc.addImage(C.ASSETS.logoH, 'PNG', x, y, h * ratio, h, undefined, 'FAST');
  };
  const T = (key, lang, vars) => C.t(key, vars, lang);
  const money = (v, cur, lang) => C.money(v, cur, lang);
  const date = (d, lang) => C.fmtDate(d, { day: 'numeric', month: 'long', year: 'numeric' }, lang);

  const header = (doc, title, subtitle, lang) => {
    const W = doc.internal.pageSize.getWidth();
    goldBand(doc, 0, 0, W, 2.2);
    logo(doc, 14, 9, 11);
    font(doc, 'Inter', 'normal', 7.5, MUTED);
    const co = C.state.company;
    const lines = [co.name, co.taxId ? `${T('NIT / ID', lang)} ${co.taxId}` : '', [co.phone, co.email].filter(Boolean).join(' · '), [co.address, co.city].filter(Boolean).join(', ')].filter(Boolean);
    doc.text(lines, W - 14, 11, { align: 'right' });
    font(doc, 'Montserrat', 'bold', 16, NAVY);
    doc.text(title, 14, 34);
    if (subtitle) {
      font(doc, 'Inter', 'normal', 9, MUTED);
      doc.text(subtitle, 14, 40);
    }
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.25);
    doc.line(14, 44, W - 14, 44);
    return 50;
  };
  const footer = (doc, lang) => {
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      const W = doc.internal.pageSize.getWidth();
      const H = doc.internal.pageSize.getHeight();
      doc.setDrawColor(...LINE);
      doc.line(14, H - 12, W - 14, H - 12);
      font(doc, 'Inter', 'normal', 7, MUTED);
      doc.text(`${T('Documento generado por COROC', lang)} · ${C.fmtDateTime(C.nowLocal(), lang)}`, 14, H - 7.5);
      doc.text(T('Página {a} de {b}', lang, { a: i, b: n }), W - 14, H - 7.5, { align: 'right' });
    }
  };
  /** Ajusta un texto a una línea del ancho dado (recorta con «…»). */
  const fit = (doc, text, w) => {
    if (doc.getTextWidth(text) <= w) return text;
    let t = text;
    while (t.length > 1 && doc.getTextWidth(t + '…') > w) t = t.slice(0, -1);
    return t + '…';
  };
  const dshort = (d, lang) => (d ? C.fmtDate(d, { day: '2-digit', month: '2-digit', year: 'numeric' }, lang) : '—');
  /** Tabla con paginación automática. cols: [{h, w, align, get}] */
  const table = (doc, y, cols, rows, lang, { zebra = true, fontSize = 8 } = {}) => {
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const x0 = 14;
    const totalW = cols.reduce((s, c) => s + c.w, 0);
    const scale = (W - 28) / totalW;
    const drawHead = () => {
      doc.setFillColor(...NAVY);
      doc.rect(x0, y, W - 28, 7, 'F');
      font(doc, 'Montserrat', 'bold', 6.8, [255, 253, 231]);
      let x = x0;
      for (const c of cols) {
        const cw = c.w * scale;
        doc.text(fit(doc, c.h.toUpperCase(), cw - 3), c.align === 'right' ? x + cw - 2 : x + 2, y + 4.6, { align: c.align === 'right' ? 'right' : 'left' });
        x += cw;
      }
      y += 7;
    };
    drawHead();
    rows.forEach((r, idx) => {
      const rh = 6.2;
      if (y + rh > H - 18) {
        doc.addPage();
        y = 16;
        drawHead();
      }
      if (zebra && idx % 2 === 1) {
        doc.setFillColor(250, 248, 242);
        doc.rect(x0, y, W - 28, rh, 'F');
      }
      let x = x0;
      for (const c of cols) {
        const cw = c.w * scale;
        font(doc, 'Inter', c.bold && c.bold(r) ? 'bold' : 'normal', fontSize, c.color ? c.color(r) : NAVY);
        const v = fit(doc, String(c.get(r) ?? ''), cw - 3);
        doc.text(v, c.align === 'right' ? x + cw - 2 : x + 2, y + 4.2, { align: c.align === 'right' ? 'right' : 'left' });
        x += cw;
      }
      doc.setDrawColor(...LINE);
      doc.line(x0, y + rh, W - 14, y + rh);
      y += rh;
    });
    return y + 4;
  };
  const kv = (doc, x, y, label, value, lang, { size = 10, color = NAVY, w = 60 } = {}) => {
    font(doc, 'Montserrat', 'normal', 6.5, MUTED);
    doc.text(label.toUpperCase(), x, y, { charSpace: 0.35 });
    font(doc, 'Inter', 'bold', size, color);
    doc.text(String(value), x, y + size * 0.45 + 1.2, { maxWidth: w });
  };
  const statusLabel = (s, today, lang) => {
    const st = Core.statusOf(s, today);
    return { paid: T('Pagada', lang), partial: T('Parcial', lang), overdue: T('Vencida', lang), pending: T('Pendiente', lang), waived: T('Condonada', lang) }[st];
  };

  return {
    /** Recibo "Gracias por tu pago" (A5). */
    async receipt(d) {
      const lang = d.lang;
      const R = Core.RECEIPT_TEXT[lang];
      const doc = newDoc('a5');
      const W = doc.internal.pageSize.getWidth();
      const H = doc.internal.pageSize.getHeight();
      doc.setFillColor(...IVORY);
      doc.rect(0, 0, W, H, 'F');
      goldBand(doc, 0, 0, W, 2.4);
      logo(doc, 12, 9, 9.5);
      font(doc, 'Inter', 'normal', 6.8, MUTED);
      const co = d.company;
      doc.text([co.name, co.taxId ? `${T('NIT / ID', lang)} ${co.taxId}` : '', [co.phone, co.email].filter(Boolean).join(' · ')].filter(Boolean), W - 12, 10.5, { align: 'right' });

      font(doc, 'Montserrat', 'bold', 17, NAVY);
      doc.text(R.title, 12, 32);
      font(doc, 'Inter', 'normal', 8.5, MUTED);
      doc.text(R.thanks, 12, 38, { maxWidth: W - 24 });

      doc.setDrawColor(...LINE);
      doc.setLineWidth(0.25);
      doc.line(12, 44, W - 12, 44);
      kv(doc, 12, 50, R.receiptNo, d.number, lang, { size: 9.5 });
      kv(doc, 62, 50, R.issuedAt, C.fmtDateTime(d.issuedAt.replace(' ', 'T'), lang), lang, { size: 9.5, w: 70 });
      kv(doc, 12, 62, R.client, d.client.fullName, lang, { size: 9.5, w: 60 });
      kv(doc, 82, 62, R.contract, d.contract, lang, { size: 9.5 });
      kv(doc, 12, 74, R.paymentDate, date(d.payment.date, lang), lang, { size: 9.5, w: 60 });
      const meta = [d.payment.method, d.payment.reference].filter(Boolean).join(' · ');
      if (meta) kv(doc, 82, 74, `${R.method} · ${R.reference}`, meta, lang, { size: 8.5, w: 55 });

      // Cifras protagonistas
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(...LINE);
      doc.roundedRect(12, 84, W - 24, 30, 3, 3, 'FD');
      font(doc, 'Montserrat', 'normal', 6.5, MUTED);
      doc.text(R.amountPaid.toUpperCase(), 17, 92, { charSpace: 0.35 });
      doc.text(R.newBalance.toUpperCase(), W / 2 + 3, 92, { charSpace: 0.35 });
      font(doc, 'Inter', 'bold', 19, GOLD_TEXT);
      doc.text(money(d.payment.amount, d.currency, lang), 17, 103);
      font(doc, 'Inter', 'bold', 19, NAVY);
      doc.text(money(d.newBalance, d.currency, lang), W / 2 + 3, 103);
      doc.setDrawColor(...LINE);
      doc.line(W / 2, 88, W / 2, 110);
      if (d.newBalance === 0) {
        font(doc, 'Inter', 'normal', 7, [46, 125, 91]);
        doc.text(R.paidOff, W / 2 + 3, 109);
      }

      const rows = [
        [R.installmentsAgreed, String(d.totalInstallments)],
        [R.installmentPaid, d.coverage],
        [R.installmentsRemaining, String(d.remainingInstallments)],
        [R.accumulated, money(d.accumulatedPaid, d.currency, lang)],
        [R.previousBalance, money(d.previousBalance, d.currency, lang)],
        [R.newBalance, money(d.newBalance, d.currency, lang)],
      ];
      if (d.next) rows.push([R.nextInstallment, `${date(d.next.dueDate, lang)} · ${money(d.next.amount, d.currency, lang)}`]);
      let y = 122;
      for (const [k, v] of rows) {
        font(doc, 'Inter', 'normal', 8.2, MUTED);
        doc.text(k, 12, y);
        font(doc, 'Inter', 'bold', 8.2, NAVY);
        const lines = doc.splitTextToSize(v, 72);
        doc.text(lines, W - 12, y, { align: 'right' });
        y += Math.max(1, lines.length) * 4 + 2.6;
        doc.setDrawColor(...LINE);
        doc.line(12, y - 3.6, W - 12, y - 3.6);
      }

      // QR de verificación
      if (window.qrcode && d.verificationCode) {
        const qr = window.qrcode(0, 'M');
        qr.addData(d.verificationCode);
        qr.make();
        const n = qr.getModuleCount();
        const size = 20;
        const cell = size / n;
        const qx = 12;
        const qy = H - 34;
        doc.setFillColor(...NAVY);
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) doc.rect(qx + c * cell, qy + r * cell, cell + 0.02, cell + 0.02, 'F');
        font(doc, 'Inter', 'normal', 6.5, MUTED);
        doc.text([R.verify, d.verificationCode.split('|').slice(1).join(' · ')], qx + size + 4, qy + 7, { maxWidth: W - qx - size - 16 });
      }
      font(doc, 'Inter', 'normal', 6.5, MUTED);
      doc.text(R.generated, W / 2, H - 6, { align: 'center' });

      if (d.voided) {
        doc.saveGraphicsState();
        doc.setGState(new doc.GState({ opacity: 0.22 }));
        font(doc, 'Montserrat', 'bold', 62, RED);
        doc.text(R.void, W / 2, H / 2 + 10, { align: 'center', angle: 32 });
        doc.restoreGraphicsState();
      }
      return doc.output('blob');
    },

    /** Contrato y plan de pagos / cuadro de inversión y pagos (A4). */
    async plan(loan, client) {
      const lang = client.lang || C.companyLang();
      const doc = newDoc('a4');
      const W = doc.internal.pageSize.getWidth();
      const st = C.loanState(loan);
      const today = C.today();
      const cur = loan.terms.currency;
      let y = header(doc, T('Plan de pagos y cuadro de inversión', lang), `${T('Contrato', lang)} ${loan.contract} · ${C.fullName(client)} · ${client.code}`, lang);
      const freq = C.msg.freqLabel(loan.terms.frequency, lang);
      const method = loan.terms.method === 'simple' ? T('Interés simple fijo', lang) : T('Cuota fija (francés)', lang);
      const cells = [
        [T('Capital prestado', lang), money(loan.terms.principal, cur, lang)],
        [T('Intereses pactados', lang), money(loan.totalInterest, cur, lang)],
        [T('Total a pagar', lang), money(loan.totalPayable, cur, lang)],
        [T('Cuotas', lang), `${loan.installments.length} · ${freq}`],
        [T('Método', lang), method],
        [T('Tasa pactada', lang), loan.terms.method === 'simple' ? C.pct(Number(loan.terms.rate), 2, lang) : `${C.pct(Number(loan.terms.rate), 2, lang)} ${T('por período', lang)}`],
        [T('Tasa efectiva anual', lang), C.pct(loan.ea, 2, lang)],
        [T('Desembolso', lang), date(loan.terms.disbursementDate, lang)],
        [T('Recaudado', lang), money(st.summary.paidTotal, cur, lang)],
        [T('Saldo pendiente', lang), money(st.summary.balance, cur, lang)],
        [T('Cuotas restantes', lang), String(st.summary.remainingInstallments)],
        [T('Días de mora', lang), String(st.summary.daysPastDue)],
      ];
      const colW = (W - 28) / 4;
      cells.forEach(([k, v], i) => kv(doc, 14 + (i % 4) * colW, y + Math.floor(i / 4) * 13, k, v, lang, { size: 9.5, w: colW - 4 }));
      y += Math.ceil(cells.length / 4) * 13 + 4;
      const paidByInst = {};
      for (const p of st.payments) for (const l of (st.allocations[p.id] || { lines: [] }).lines) if (l.toInstallment > 0) paidByInst[l.number] = p.date;
      y = table(doc, y, [
        { h: T('N.º', lang), w: 8, get: (r) => r.number },
        { h: T('Vence', lang), w: 20, get: (r) => dshort(r.dueDate, lang) },
        { h: T('Cuota', lang), w: 20, align: 'right', get: (r) => money(r.amount, cur, lang) },
        { h: T('Capital', lang), w: 20, align: 'right', get: (r) => money(r.principal, cur, lang) },
        { h: T('Interés', lang), w: 18, align: 'right', get: (r) => money(r.interest, cur, lang) },
        { h: T('Pagado', lang), w: 20, align: 'right', get: (r) => money(r.paid, cur, lang) },
        { h: T('Fecha de pago', lang), w: 22, get: (r) => dshort(paidByInst[r.number], lang) },
        { h: T('Estado', lang), w: 16, get: (r) => statusLabel(r, today, lang), color: (r) => (Core.statusOf(r, today) === 'overdue' ? RED : Core.statusOf(r, today) === 'paid' ? [46, 125, 91] : NAVY) },
        { h: T('Saldo', lang), w: 20, align: 'right', get: (r) => money(r.balanceAfter, cur, lang) },
      ], loan.installments.map((i) => ({ ...i, paid: st.states.find((s) => s.number === i.number).paid, lateFeePaid: 0 })), lang, { fontSize: 7.6 });
      const H = doc.internal.pageSize.getHeight();
      if (y > H - 50) {
        doc.addPage();
        y = 30;
      }
      y += 16;
      doc.setDrawColor(...NAVY);
      doc.line(20, y, 90, y);
      doc.line(W - 90, y, W - 20, y);
      font(doc, 'Inter', 'normal', 8, MUTED);
      doc.text([T('Deudor', lang), C.fullName(client)], 20, y + 5);
      doc.text([T('Acreedor', lang), C.state.company.name], W - 90, y + 5);
      footer(doc, lang);
      return doc.output('blob');
    },

    async statement(loan, client) {
      const lang = client.lang || C.companyLang();
      const doc = newDoc('a4');
      const W = doc.internal.pageSize.getWidth();
      const st = C.loanState(loan);
      const cur = loan.terms.currency;
      let y = header(doc, T('Estado de cuenta', lang), `${T('Contrato', lang)} ${loan.contract} · ${C.fullName(client)} · ${T('Corte', lang)} ${date(C.today(), lang)}`, lang);
      const cells = [
        [T('Total pactado', lang), money(loan.totalPayable, cur, lang)],
        [T('Recaudado', lang), money(st.summary.paidTotal, cur, lang)],
        [T('Saldo por pagar', lang), money(st.summary.balance, cur, lang)],
        [T('Cuotas restantes', lang), `${st.summary.remainingInstallments} / ${loan.installments.length}`],
        [T('Próxima cuota', lang), st.summary.next ? `${C.fmtDate(st.summary.next.dueDate, undefined, lang)} · ${money(st.summary.next.outstanding, cur, lang)}` : '—'],
        [T('Días de mora', lang), String(st.summary.daysPastDue)],
      ];
      const colW = (W - 28) / 3;
      cells.forEach(([k, v], i) => kv(doc, 14 + (i % 3) * colW, y + Math.floor(i / 3) * 14, k, v, lang, { size: 10.5, w: colW - 4 }));
      y += 32;
      font(doc, 'Montserrat', 'bold', 10, NAVY);
      doc.text(T('Pagos recibidos', lang), 14, y);
      y += 3;
      const reversed = new Set(loan.ledger.filter((e) => e.type === 'reversal').map((e) => e.reverses));
      const pays = loan.ledger.filter((e) => e.type === 'payment');
      y = table(doc, y, [
        { h: T('Fecha', lang), w: 20, get: (r) => dshort(r.date, lang) },
        { h: T('Recibo', lang), w: 22, get: (r) => r.receiptNo || '' },
        { h: T('Medio', lang), w: 26, get: (r) => r.method || r.entity || T(r.source === 'cash' ? 'Efectivo' : 'Registro manual', lang) },
        { h: T('Referencia', lang), w: 30, get: (r) => r.reference || '' },
        { h: T('Estado', lang), w: 18, get: (r) => (reversed.has(r.id) ? T('Reversado', lang) : T('Aplicado', lang)) },
        { h: T('Valor', lang), w: 22, align: 'right', get: (r) => money(r.amount, cur, lang) },
      ], pays, lang);
      footer(doc, lang);
      return doc.output('blob');
    },

    async payoff(loan, client) {
      const lang = client.lang || C.companyLang();
      const doc = newDoc('a4');
      const W = doc.internal.pageSize.getWidth();
      const cur = loan.terms.currency;
      let y = header(doc, T('Paz y salvo', lang), `${T('Contrato', lang)} ${loan.contract}`, lang);
      y += 12;
      font(doc, 'Inter', 'normal', 11, NAVY);
      const idTxt = client.idDoc ? T(', identificado(a) con documento {d},', lang, { d: client.idDoc }) : '';
      const body = T('{empresa} certifica que {cliente}{id} pagó en su totalidad la obligación del contrato {contrato}, por un valor total de {total}, y se encuentra a paz y salvo por todo concepto relacionado con dicho contrato.', lang, {
        empresa: C.state.company.name, cliente: C.fullName(client), id: idTxt, contrato: loan.contract, total: money(loan.totalPayable, cur, lang),
      });
      doc.text(doc.splitTextToSize(body, W - 40), 20, y);
      y += 40;
      doc.text(T('Se expide en {ciudad}, el {fecha}.', lang, { ciudad: C.state.company.city || '—', fecha: date(C.today(), lang) }), 20, y);
      y += 40;
      doc.setDrawColor(...NAVY);
      doc.line(20, y, 95, y);
      font(doc, 'Inter', 'normal', 9, MUTED);
      doc.text([C.state.company.name, C.state.company.taxId ? `${T('NIT / ID', lang)} ${C.state.company.taxId}` : ''].filter(Boolean), 20, y + 5);
      footer(doc, lang);
      return doc.output('blob');
    },

    /** Informe tabular genérico (A4 horizontal). */
    async report(title, subtitle, cols, rows, lang = C.lang()) {
      const doc = newDoc('a4', 'landscape');
      const y = header(doc, title, subtitle, lang);
      table(doc, y, cols, rows, lang, { fontSize: 7.8 });
      footer(doc, lang);
      return doc.output('blob');
    },
  };
})();
