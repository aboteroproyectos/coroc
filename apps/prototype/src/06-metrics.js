/* COROC · indicadores del dashboard e informes (§17, §18) */
C.metrics = {
  /** Calcula todos los indicadores de la cartera visible en una sola pasada. */
  compute() {
    const today = C.today();
    const loans = C.visibleLoans();
    const clientsActive = new Set();
    let totalLent = 0;
    let totalLentHistoric = 0;
    let expectedToday = 0;
    let overdueTotal = 0;
    let totalReceivable = 0;
    let collectedToday = 0;
    const byDay = {};
    const aging = { current: { n: 0, amount: 0 }, d1_7: { n: 0, amount: 0 }, d8_30: { n: 0, amount: 0 }, d30p: { n: 0, amount: 0 } };
    const dueToday = [];
    const overdueList = [];
    const start = Core.addDays(today, -29);
    for (let i = 0; i < 30; i++) byDay[Core.addDays(start, i)] = 0;

    for (const loan of loans) {
      totalLentHistoric += loan.terms.principal;
      const st = C.loanState(loan, today);
      for (const p of st.payments) {
        if (byDay[p.date] !== undefined) byDay[p.date] += p.amount;
        if (p.date === today) collectedToday += p.amount;
      }
      if (st.summary.balance === 0) continue;
      clientsActive.add(loan.clientId);
      totalLent += loan.terms.principal;
      totalReceivable += st.summary.balance;
      let overdueHere = 0;
      for (const s of st.states) {
        const out = s.amount - s.paid;
        if (out <= 0) continue;
        if (s.dueDate === today) {
          expectedToday += out;
          dueToday.push({ loan, inst: s, outstanding: out });
        } else if (s.dueDate < today) {
          overdueTotal += out;
          overdueHere += out;
        }
      }
      if (overdueHere > 0) overdueList.push({ loan, outstanding: overdueHere, days: st.summary.daysPastDue });
      const d = st.summary.daysPastDue;
      const bucket = d === 0 ? 'current' : d <= 7 ? 'd1_7' : d <= 30 ? 'd8_30' : 'd30p';
      aging[bucket].n += 1;
      aging[bucket].amount += st.summary.balance;
    }
    return {
      today, clientsActive: clientsActive.size, clientsTotal: C.visibleClients().length, totalLent, totalLentHistoric,
      expectedToday, collectedToday, overdueTotal, totalReceivable, trend: Object.entries(byDay).map(([date, amount]) => ({ date, amount })),
      aging, dueToday: dueToday.sort((a, b) => b.outstanding - a.outstanding), overdueList: overdueList.sort((a, b) => b.days - a.days),
    };
  },

  portfolioRows() {
    return C.visibleLoans().map((loan) => {
      const client = C.clientById(loan.clientId);
      const st = C.loanState(loan);
      return {
        client: C.fullName(client), code: client.code, contract: loan.contract, frequency: loan.terms.frequency, principal: loan.terms.principal,
        totalPayable: loan.totalPayable, paid: st.summary.paidTotal, balance: st.summary.balance, remaining: st.summary.remainingInstallments,
        next: st.summary.next ? st.summary.next.dueDate : '', daysPastDue: st.summary.daysPastDue, status: C.statusOfLoan(loan, st), currency: loan.terms.currency,
      };
    });
  },

  collectionsRows(from, to) {
    const rows = [];
    for (const loan of C.visibleLoans()) {
      const client = C.clientById(loan.clientId);
      const reversed = new Set(loan.ledger.filter((e) => e.type === 'reversal').map((e) => e.reverses));
      for (const e of loan.ledger) {
        if (e.type !== 'payment' || e.date < from || e.date > to) continue;
        rows.push({ date: e.date, client: C.fullName(client), contract: loan.contract, amount: e.amount, receipt: e.receiptNo, method: e.method || e.source, reversed: reversed.has(e.id), auto: !!e.auto, currency: loan.terms.currency });
      }
    }
    return rows.sort((a, b) => (a.date < b.date ? -1 : 1));
  },

  ledgerRows() {
    const rows = [];
    for (const loan of C.visibleLoans()) {
      const client = C.clientById(loan.clientId);
      for (const e of loan.ledger) rows.push({ at: e.at, date: e.date, type: e.type, contract: loan.contract, client: C.fullName(client), amount: e.amount, receipt: e.receiptNo || '', reference: e.reference || '', reason: e.reason || '', user: (C.state.users.find((u) => u.id === e.userId) || {}).username || 'sistema' });
    }
    return rows.sort((a, b) => (a.at < b.at ? -1 : 1));
  },
};

/** CSV con separador «;» (Excel en español lo abre directamente) y BOM UTF-8. */
C.toCSV = (headers, rows) => {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return new Blob(['﻿' + [headers.map(cell).join(';'), ...rows.map((r) => r.map(cell).join(';'))].join('\r\n')], { type: 'text/csv;charset=utf-8' });
};
