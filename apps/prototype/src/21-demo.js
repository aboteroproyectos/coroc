/* COROC · datos de demostración (opcionales, marcados como DEMO y eliminables) */
C.demo = {
  PEOPLE: [
    ['María José', 'Pérez Gómez', '3001234567', 'daily'], ['Carlos Andrés', 'Ruiz Mejía', '3109876543', 'weekly'], ['Luisa Fernanda', 'Castaño Ríos', '3154447788', 'monthly'],
    ['Jhon Jairo', 'Restrepo Vélez', '3206665544', 'daily'], ['Diana Marcela', 'Ospina Arango', '3012223344', 'weekly'], ['Andrés Felipe', 'Montoya Cardona', '3165558899', 'monthly'],
    ['Paola Andrea', 'Giraldo Henao', '3128887766', 'daily'], ['Santiago', 'Londoño Duque', '3043332211', 'weekly'], ['Valentina', 'Zapata Muñoz', '3187771122', 'monthly'],
    ['Juan Esteban', 'Álvarez Toro', '3059990011', 'weekly'], ['Camila', 'Salazar Bedoya', '3141212121', 'daily'], ['Mateo', 'Gallego Posada', '3173434343', 'monthly'],
  ],

  /** Imagen de un comprobante sintético para demostrar la bandeja sin conexión. */
  async receiptImage(lines) {
    const cv = document.createElement('canvas');
    cv.width = 720;
    cv.height = 980;
    const g = cv.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = '#200020';
    g.fillRect(0, 0, cv.width, 120);
    g.fillStyle = '#ffffff';
    g.font = '600 40px Inter, Arial';
    g.fillText(lines[0], 40, 76);
    let y = 190;
    for (const l of lines.slice(1)) {
      const [k, v] = l.split('\n');
      g.fillStyle = '#6b6b80';
      g.font = '400 24px Inter, Arial';
      g.fillText(k, 40, y);
      if (v) {
        g.fillStyle = '#1a1a2e';
        g.font = '600 30px Inter, Arial';
        g.fillText(v, 40, y + 40);
      }
      y += v ? 100 : 60;
    }
    return new Promise((r) => cv.toBlob(r, 'image/png'));
  },

  async seed() {
    C.state.seeding = true;
    const S = C.state.settings;
    const saveMsgs = { ...S.messages };
    await C.saveSettings({
      messages: Object.fromEntries(Object.keys(saveMsgs).map((k) => [k, false])),
      receivingAccounts: [{ id: C.uid(), holderName: C.state.company.name, entity: 'Bancolombia', last4: '4455' }, { id: C.uid(), holderName: C.state.user.name, entity: 'Nequi', last4: '9021' }],
      rateCap: { ea: 0.25, validFrom: C.today(), validTo: Core.addDays(C.today(), 30) },
    });
    await C.saveCompany({ taxId: '901.234.567-8', phone: '+57 604 444 0000', email: 'cartera@example.com', address: 'Cra. 43A # 1-50', city: 'Medellín' });
    const today = C.today();
    const plans = {
      daily: { installments: 40, rate: '0.0006', back: 30 },
      weekly: { installments: 16, rate: '0.004', back: 63 },
      monthly: { installments: 12, rate: '0.018', back: 125 },
    };
    const lateProfile = [0, 3, 0, 12, 0, 40, 0, 1, 0, 6, 0, 0];
    let idx = 0;
    for (const [first, last, phone, freq] of C.demo.PEOPLE) {
      const p = plans[freq];
      const client = await C.saveClient({
        firstName: first, lastName: last, phone: C.normalizePhoneOrNull(phone), phone2: null, email: `${Core.stripAccents(first.split(' ')[0]).toLowerCase()}.${Core.stripAccents(last.split(' ')[0]).toLowerCase()}@example.com`,
        idDoc: String(1020300400 + idx * 7919), address: `Calle ${10 + idx} # ${20 + idx}-${30 + idx}`, city: 'Medellín', lang: idx === 8 ? 'en' : idx === 5 ? 'pt-BR' : 'es',
        collectorId: null, coDebtor: null, notes: '', consents: { whatsapp: { at: C.nowLocal(), method: 'Cláusula firmada en el contrato', by: 'demo' }, email: idx % 3 === 0 ? { at: C.nowLocal(), method: 'Cláusula firmada en el contrato', by: 'demo' } : null },
        dataConsentAt: C.nowLocal(),
      }, true);
      const principal = [1500000, 3000000, 5000000, 800000, 2000000, 8000000, 1200000, 2500000, 6000000, 1800000, 1000000, 4000000][idx];
      const disb = Core.addDays(today, -(p.back + (idx % 3) * 4));
      const loan = await C.createLoan(client, C.termsFromForm({
        principal, method: 'french', rate: p.rate, installments: p.installments, frequency: freq, disbursementDate: disb,
        collectionDays: [1, 2, 3, 4, 5, 6], excludeHolidays: true, roundingUnit: 100,
      }), { expectedMethod: freq === 'monthly' ? 'Transferencia' : 'Nequi' });
      // Pagos históricos: al día salvo el perfil de mora
      const cut = Core.addDays(today, -lateProfile[idx] - 1);
      for (const inst of loan.installments) {
        if (inst.dueDate > cut) break;
        await C.registerPayment(loan.id, { amount: inst.amount, date: inst.dueDate, method: freq === 'monthly' ? 'Transferencia' : 'Nequi', source: 'manual' });
      }
      idx++;
    }
    // Un préstamo terminado
    const c0 = C.state.clients[2];
    const done = await C.createLoan(c0, C.termsFromForm({ principal: 1000000, method: 'french', rate: '0.018', installments: 3, frequency: 'monthly', disbursementDate: Core.addDays(today, -200), excludeHolidays: true, collectionDays: [1, 2, 3, 4, 5, 6], roundingUnit: 100 }), {});
    for (const inst of done.installments) await C.registerPayment(done.id, { amount: inst.amount, date: inst.dueDate, method: 'Transferencia' });

    for (const l of C.state.loans) await C.docs.refreshPlan(l);
    await C.saveSettings({ messages: saveMsgs });
    C.state.seeding = false;

    // Bandeja: comprobantes de ejemplo (el texto se entrega ya leído para funcionar sin conexión)
    const mk = async (fileName, lines, text, evidence) => {
      const blob = await C.demo.receiptImage(lines);
      const file = new File([blob], fileName, { type: 'image/png' });
      const orig = C.intake.readText;
      C.intake.readText = async () => text;
      try {
        await C.intake.receive(file, evidence);
      } finally {
        C.intake.readText = orig;
      }
    };
    const maria = C.state.clients[0];
    const mLoan = C.loansOf(maria.id)[0];
    const next = C.loanState(mLoan).summary.next;
    const fmtCOP = (v) => C.money(v, 'COP', 'es');
    const dText = C.fmtDate(today, { day: 'numeric', month: 'long', year: 'numeric' }, 'es');
    await mk('nequi_maria.png', ['Nequi', '¡Envío exitoso!', `Para\n${C.state.user.name.toUpperCase()}`, `¿Cuánto?\n${fmtCOP(next.outstanding)}`, 'Número Nequi\n300 *** 9021', `Fecha\n${dText} a las 09:14 a. m.`, 'Referencia\nM8201456'],
      `Nequi\n¡Envío exitoso!\nPara\n${C.state.user.name.toUpperCase()}\n¿Cuánto?\n${fmtCOP(next.outstanding)}\nNúmero Nequi\n300 *** 9021\nFecha\n${dText} a las 09:14 a. m.\nReferencia\nM8201456`, { source: 'whatsapp', phone: maria.phone });
    await mk('transferencia_desconocida.png', ['Bancolombia', 'Comprobante de transferencia', `Fecha\n${today.split('-').reverse().join('/')} 10:41`, 'Valor enviado\n$ 250.000', 'Nombre del pagador\nJhon Restrepo', `Nombre del destinatario\n${C.state.company.name.toUpperCase()}`, 'Comprobante No.\n0012345678'],
      `Bancolombia\nComprobante de transferencia\nFecha: ${today.split('-').reverse().join('/')} 10:41\nValor enviado: $ 250.000\nNombre del pagador: Jhon Restrepo\nCuenta destino: Ahorros *4455\nNombre del destinatario: ${C.state.company.name.toUpperCase()}\nComprobante No. 0012345678`, { source: 'whatsapp', phone: '+573150000000' });
    const carlos = C.state.clients[1];
    await mk('pago_tercero.png', ['Daviplata', 'Pasaste plata', 'Para\nPEDRO MARTINEZ', 'Valor\n$ 180.000', `Fecha\n${dText}`, 'Aprobación\nDP99887766'],
      `Daviplata\nPasaste plata\nPara\nPEDRO MARTINEZ\nValor\n$ 180.000\nFecha\n${dText}\nAprobación\nDP99887766`, { source: 'whatsapp', phone: carlos.phone });
    await C.msg.generateScheduled();
    await C.audit('demo.seeded', 'company', 'company', {});
  },
};
