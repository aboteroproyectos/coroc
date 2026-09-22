/* COROC · mensajería asistida y motor de reglas de contacto (§11) */
C.EVENTS = ['welcome', 'reminder', 'overdue', 'receipt', 'statement', 'payoff'];
C.EVENT_KIND = { welcome: 'transactional', reminder: 'collection', overdue: 'collection', receipt: 'transactional', statement: 'transactional', payoff: 'transactional' };

C.DEFAULT_TEMPLATES = {
  welcome: {
    es: 'Hola {{nombre}}, te damos la bienvenida a {{empresa}}. Tu préstamo {{contrato}} quedó registrado: {{total_cuotas}} cuotas de {{valor_cuota}} ({{frecuencia}}). La primera vence el {{fecha_vencimiento}}. Cuando pagues, envíanos el comprobante por este medio. Gracias por tu confianza.',
    'pt-BR': 'Olá {{nombre}}, boas-vindas à {{empresa}}. Seu empréstimo {{contrato}} foi registrado: {{total_cuotas}} parcelas de {{valor_cuota}} ({{frecuencia}}). A primeira vence em {{fecha_vencimiento}}. Quando pagar, envie o comprovante por aqui. Obrigado pela confiança.',
    en: 'Hi {{nombre}}, welcome to {{empresa}}. Your loan {{contrato}} is set up: {{total_cuotas}} installments of {{valor_cuota}} ({{frecuencia}}). The first one is due on {{fecha_vencimiento}}. When you pay, please send us the receipt here. Thank you for your trust.',
  },
  reminder: {
    es: 'Hola {{nombre}}, te recordamos que la cuota {{cuota_numero}} de tu contrato {{contrato}}, por {{valor_cuota}}, vence el {{fecha_vencimiento}}. Si ya pagaste, envíanos el comprobante por este medio. Gracias.',
    'pt-BR': 'Olá {{nombre}}, lembramos que a parcela {{cuota_numero}} do seu contrato {{contrato}}, no valor de {{valor_cuota}}, vence em {{fecha_vencimiento}}. Se já pagou, envie o comprovante por aqui. Obrigado.',
    en: 'Hi {{nombre}}, a friendly reminder that installment {{cuota_numero}} of your contract {{contrato}}, for {{valor_cuota}}, is due on {{fecha_vencimiento}}. If you have already paid, please send us the receipt here. Thank you.',
  },
  overdue: {
    es: 'Hola {{nombre}}, a la fecha registramos pendiente la cuota {{cuota_numero}} de tu contrato {{contrato}}, por {{valor_cuota}}, que venció el {{fecha_vencimiento}}. Si ya realizaste el pago, envíanos el comprobante. Si necesitas una alternativa de pago, con gusto te ayudamos.',
    'pt-BR': 'Olá {{nombre}}, até hoje consta em aberto a parcela {{cuota_numero}} do seu contrato {{contrato}}, no valor de {{valor_cuota}}, vencida em {{fecha_vencimiento}}. Se já pagou, envie o comprovante. Se precisar de uma alternativa de pagamento, teremos prazer em ajudar.',
    en: 'Hi {{nombre}}, as of today installment {{cuota_numero}} of your contract {{contrato}}, for {{valor_cuota}}, due on {{fecha_vencimiento}}, is still open. If you have already paid, please send us the receipt. If you need a payment alternative, we are happy to help.',
  },
  receipt: {
    es: 'Hola {{nombre}}, recibimos tu pago de {{valor_pagado}}. ¡Gracias! Cuotas restantes: {{cuotas_restantes}}. Nuevo saldo: {{saldo}}. Tu recibo: {{enlace_recibo}}',
    'pt-BR': 'Olá {{nombre}}, recebemos seu pagamento de {{valor_pagado}}. Obrigado! Parcelas restantes: {{cuotas_restantes}}. Novo saldo: {{saldo}}. Seu recibo: {{enlace_recibo}}',
    en: 'Hi {{nombre}}, we received your payment of {{valor_pagado}}. Thank you! Installments remaining: {{cuotas_restantes}}. New balance: {{saldo}}. Your receipt: {{enlace_recibo}}',
  },
  statement: {
    es: 'Hola {{nombre}}, te compartimos el estado de cuenta de tu contrato {{contrato}}. Saldo a la fecha: {{saldo}}. Cuotas restantes: {{cuotas_restantes}}.',
    'pt-BR': 'Olá {{nombre}}, compartilhamos o extrato do seu contrato {{contrato}}. Saldo até hoje: {{saldo}}. Parcelas restantes: {{cuotas_restantes}}.',
    en: 'Hi {{nombre}}, here is the statement for your contract {{contrato}}. Balance to date: {{saldo}}. Installments remaining: {{cuotas_restantes}}.',
  },
  payoff: {
    es: '¡Felicitaciones, {{nombre}}! Tu contrato {{contrato}} quedó pagado en su totalidad. Te compartimos tu paz y salvo. Gracias por tu confianza en {{empresa}}.',
    'pt-BR': 'Parabéns, {{nombre}}! Seu contrato {{contrato}} foi totalmente quitado. Compartilhamos seu termo de quitação. Obrigado pela confiança na {{empresa}}.',
    en: 'Congratulations, {{nombre}}! Your contract {{contrato}} is paid in full. Here is your payoff letter. Thank you for trusting {{empresa}}.',
  },
};

C.TEMPLATE_VARS = ['nombre', 'apellidos', 'contrato', 'valor_cuota', 'fecha_vencimiento', 'cuota_numero', 'total_cuotas', 'cuotas_restantes', 'saldo', 'valor_pagado', 'frecuencia', 'enlace_recibo', 'empresa', 'telefono_empresa'];

/** Contenido prohibido por diseño en las plantillas (§11.3). */
C.TEMPLATE_RULES = [
  { re: /\b(c[aá]rcel|prisi[oó]n|pris[aã]o|jail|polic[ií]a|police|amenaza|threat|te vamos a|vamos a ir|iremos a tu|visitaremos|vamos visitar|we will visit|embarg\w*|demand(a|aremos))\b/i, why: 'Lenguaje intimidante o amenazas' },
  { re: /(por\s*qu[eé]\s+no\s+(ha|has|han)?\s*pag|motivo\s+del?\s+(no\s+pago|incumplimiento)|causa\s+del?\s+incumplimiento|por\s*que\s+n[aã]o\s+pagou|why\s+(haven'?t|didn'?t|have\s+not|did\s+not)\s+you\s+pa)/i, why: 'Preguntar la causa del incumplimiento' },
  { re: /\b(familia(r|res)?|fam[ií]lia|family|referencias?|refer[eê]ncias?|references?|vecin[oa]s?|vizinh[oa]s?|neighbou?rs?|jefe|chefe|employer|empleador|compañeros de trabajo)\b/i, why: 'Menciones a terceros' },
  { re: /(n[uú]mero\s+(completo\s+)?de\s+(la\s+)?(tarjeta|cuenta)|n[uú]mero\s+do\s+cart[aã]o|card\s+number|account\s+number|\bcvv\b|\bpin\b|contraseña|senha|password|c[eé]dula|documento\s+de\s+identidad\s+completo)/i, why: 'Solicitar datos sensibles (tarjeta, cuenta o identificación)' },
];
C.validateTemplate = (text) => C.TEMPLATE_RULES.filter((r) => r.re.test(text)).map((r) => C.t(r.why));

C.msg = {
  template(event, lang) {
    const custom = C.state.templates && C.state.templates[event] && C.state.templates[event][lang];
    return custom || C.DEFAULT_TEMPLATES[event][lang] || C.DEFAULT_TEMPLATES[event].es;
  },
  freqLabel: (f, lang) => ({ daily: C.t('diaria', null, lang), weekly: C.t('semanal', null, lang), monthly: C.t('mensual', null, lang) })[f],
  vars(loan, client, extra = {}) {
    const lang = client.lang || C.companyLang();
    const st = C.loanState(loan);
    const inst = extra.installment || st.states.find((s) => s.paid < s.amount) || loan.installments[0];
    const cur = loan.terms.currency;
    return {
      nombre: client.firstName, apellidos: client.lastName, contrato: loan.contract,
      valor_cuota: C.money(inst ? inst.amount - (inst.paid || 0) : loan.regularInstallment, cur, lang),
      fecha_vencimiento: inst ? C.fmtDate(inst.dueDate, { day: 'numeric', month: 'long', year: 'numeric' }, lang) : '—',
      cuota_numero: inst ? String(inst.number) : '—', total_cuotas: String(loan.installments.length),
      cuotas_restantes: String(st.summary.remainingInstallments), saldo: C.money(st.summary.balance, cur, lang),
      valor_pagado: extra.entry ? C.money(extra.entry.amount, cur, lang) : '', frecuencia: C.msg.freqLabel(loan.terms.frequency, lang),
      enlace_recibo: extra.receiptLabel || (extra.entry ? extra.entry.receiptNo : ''), empresa: C.state.company.name, telefono_empresa: C.state.company.phone || '',
    };
  },
  render: (text, vars) => text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m)),

  history(clientId) {
    return C.state.messages.filter((m) => m.clientId === clientId && m.status === 'sent').map((m) => ({ at: m.sentAt, kind: m.kind, channel: m.channel }));
  },

  evaluate(m) {
    if (!C.state.settings.contactRules) return { decision: 'send', at: m.requestedAt, reasons: [], ruleSet: 'OFF' };
    const client = C.clientById(m.clientId);
    const opts = { transactionalImmediate: C.state.settings.transactionalImmediate, debtorAuthorizedWindows: client && client.authorizedWindows };
    return Core.evaluateContact({ kind: m.kind, channel: m.channel, requestedAt: m.requestedAt }, C.msg.history(m.clientId), Core.RULESET_CO_LEY_2300, opts);
  },

  statusFrom(decision) {
    return decision.decision === 'send' ? 'ready' : decision.decision === 'reschedule' ? 'scheduled' : 'blocked';
  },

  channelFor(client, preferred) {
    const cw = client.consents && client.consents.whatsapp;
    const ce = client.consents && client.consents.email && client.email;
    if (preferred === 'email' && ce) return 'email';
    if (cw && client.phone) return 'whatsapp';
    if (ce) return 'email';
    return null;
  },

  async enqueueEvent(event, loan, extra = {}) {
    const client = C.clientById(loan.clientId);
    const channel = C.msg.channelFor(client, extra.channel);
    if (!channel) return null;
    const lang = client.lang || C.companyLang();
    const dedupeKey = extra.dedupeKey || `${event}:${loan.id}:${extra.entry ? extra.entry.id : extra.doc ? extra.doc.id : C.nowLocal()}`;
    if (C.state.messages.some((m) => m.dedupeKey === dedupeKey)) return null;
    const attachmentDocId = extra.receiptDoc ? extra.receiptDoc.id : extra.doc ? extra.doc.id : null;
    const vars = C.msg.vars(loan, client, { ...extra, receiptLabel: attachmentDocId ? C.t('adjunto en PDF', null, lang) : '' });
    const m = {
      id: C.uid(), clientId: client.id, loanId: loan.id, event, kind: C.EVENT_KIND[event], channel, lang,
      text: C.msg.render(C.msg.template(event, lang), vars), subject: `${C.state.company.name} · ${loan.contract}`,
      attachmentDocId, requestedAt: extra.requestedAt || C.nowLocal(), createdAt: C.nowLocal(), dedupeKey,
    };
    m.decision = C.msg.evaluate(m);
    m.status = C.msg.statusFrom(m.decision);
    m.scheduledAt = m.decision.at || null;
    C.state.messages.unshift(m);
    await C.db.put('messages', m);
    C.emit('messages');
    return m;
  },

  /** Cola "Por enviar": mensajes listos cuya hora ya llegó. */
  due() {
    const now = C.nowLocal();
    const vis = new Set(C.visibleClients().map((c) => c.id));
    return C.state.messages.filter((m) => vis.has(m.clientId) && (m.status === 'ready' || (m.status === 'scheduled' && m.scheduledAt <= now)));
  },

  waLink(m) {
    const client = C.clientById(m.clientId);
    return `https://wa.me/${(client.phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(m.text)}`;
  },
  mailLink(m) {
    const client = C.clientById(m.clientId);
    return `mailto:${encodeURIComponent(client.email || '')}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.text)}`;
  },

  /** Antes de enviar se reevalúan las reglas: pudo haber otro contacto en el intervalo. */
  async recheck(m) {
    m.requestedAt = m.status === 'scheduled' ? m.scheduledAt : C.nowLocal();
    if (m.requestedAt < C.nowLocal()) m.requestedAt = C.nowLocal();
    m.decision = C.msg.evaluate(m);
    m.status = C.msg.statusFrom(m.decision);
    m.scheduledAt = m.decision.at || null;
    await C.db.put('messages', m);
    return m.status === 'ready';
  },

  async markSent(m, how) {
    m.status = 'sent';
    m.sentAt = C.nowLocal();
    m.sentBy = C.state.user.username;
    m.sentHow = how;
    await C.db.put('messages', m);
    await C.audit('message.sent', 'message', m.id, { event: m.event, channel: m.channel, how });
    C.emit('messages');
  },

  async cancel(m) {
    m.status = 'cancelled';
    await C.db.put('messages', m);
    await C.audit('message.cancelled', 'message', m.id, {});
    C.emit('messages');
  },

  /** Envía un mensaje en modo asistido: comparte el PDF cuando el sistema lo permite, o abre WhatsApp / correo con el texto listo. */
  async send(m) {
    if (!(await C.msg.recheck(m))) {
      C.toast(C.t('Las reglas de contacto no permiten enviarlo ahora: {r}', { r: C.msg.reasonText(m.decision) }), 'error', 6000);
      C.emit('messages');
      return false;
    }
    if (m.attachmentDocId) {
      const doc = C.state.documents.find((d) => d.id === m.attachmentDocId);
      const blob = await C.docs.blob(m.attachmentDocId);
      if (blob && doc) {
        const file = new File([blob], doc.name, { type: 'application/pdf' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file], text: m.text, title: m.subject });
            await C.msg.markSent(m, 'share');
            return true;
          } catch (e) {
            if (e && e.name === 'AbortError') return false;
          }
        }
        C.download(blob, doc.name);
      }
    }
    window.open(m.channel === 'email' ? C.msg.mailLink(m) : C.msg.waLink(m), '_blank', 'noopener');
    await C.msg.markSent(m, m.channel === 'email' ? 'mailto' : 'wa.me');
    return true;
  },

  reasonText(d) {
    if (!d || !d.reasons) return '';
    const map = {
      OUT_OF_WINDOW: C.t('fuera de la franja permitida'), HOLIDAY_SKIPPED: C.t('festivo'), MAX_PER_DAY: C.t('ya hubo un contacto de cobranza hoy'),
      CHANNEL_WEEK: C.t('esta semana ya se contactó por otro canal'), TRANSACTIONAL_IMMEDIATE: C.t('transaccional de envío inmediato'), DEBTOR_EXCEPTION: C.t('horario autorizado por el deudor'),
    };
    return d.reasons.map((r) => map[r.code] + (r.code === 'HOLIDAY_SKIPPED' ? ` ${C.fmtDate(r.detail)}` : '')).join(' · ');
  },

  /** Genera los mensajes automáticos del día (idempotente). */
  async generateScheduled() {
    const S = C.state.settings;
    const today = C.today();
    const tomorrow = Core.addDays(today, 1);
    const yesterday = Core.addDays(today, -1);
    for (const loan of C.state.loans) {
      if (loan.status !== 'active') continue;
      const st = C.loanState(loan);
      const open = st.states.filter((s) => s.paid < s.amount);
      const freq = loan.terms.frequency;
      for (const inst of open) {
        const at = `${today}T${S.reminderTime || '08:00'}`;
        if (S.messages.reminder && (freq !== 'daily' || S.dailyReminders)) {
          if (inst.dueDate === today) await C.msg.enqueueEvent('reminder', loan, { installment: inst, dedupeKey: `reminder:${loan.id}:${inst.number}:0`, requestedAt: at });
          if (inst.dueDate === tomorrow && freq !== 'daily') await C.msg.enqueueEvent('reminder', loan, { installment: inst, dedupeKey: `reminder:${loan.id}:${inst.number}:-1`, requestedAt: at });
        }
        if (S.messages.overdue && inst.dueDate === yesterday) {
          await C.msg.enqueueEvent('overdue', loan, { installment: inst, dedupeKey: `overdue:${loan.id}:${inst.number}`, requestedAt: at });
        }
      }
    }
    // Programados cuya hora llegó: se reevalúan
    for (const m of C.state.messages.filter((x) => x.status === 'scheduled' && x.scheduledAt <= C.nowLocal())) await C.msg.recheck(m);
    C.emit('messages');
  },
};
