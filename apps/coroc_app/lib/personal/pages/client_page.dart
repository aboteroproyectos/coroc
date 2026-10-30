import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_exception.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/brand.dart';
import '../../design/widgets/common.dart';
import '../../design/widgets/labels.dart' show installmentStatus;
import '../../features/desktop/receipt_prompt.dart';
import '../../features/documents/documents.dart' show openDocument;
import '../../features/loans/loan_providers.dart';
import '../../features/loans/payment_sheet.dart';
import '../../features/messaging/client_emails.dart';
import '../../features/messaging/desktop_send.dart';
import '../data.dart';
import '../ui/bank.dart';
import 'clients_page.dart' show clientState;

/// Ficha del cliente: sus datos, cada préstamo con su avance, sus cuotas y sus pagos con recibo, y las dos acciones
/// del día a día: registrar un pago (efectivo o transferencia) y enviar el estado de cuenta.
class PersonalClientPage extends ConsumerWidget {
  const PersonalClientPage({super.key, required this.clientId});
  final String clientId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final client = ref.watch(clientProvider(clientId));
    return AsyncBody<Client>(value: client, onRetry: () => ref.invalidate(clientProvider(clientId)), builder: (c) => _ClientView(c));
  }
}

class _ClientView extends ConsumerWidget {
  const _ClientView(this.c);
  final Client c;

  /// El préstamo con el que se trabaja: el activo más reciente (o el último, si todos están pagados).
  Loan? get current {
    if (c.loans.isEmpty) return null;
    final active = c.loans.where((x) => x.status == 'active').toList();
    return (active.isEmpty ? c.loans : active).last;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final loan = current;
    final doc = [if (c.idDocNumber != null && c.idDocNumber!.isNotEmpty) '${c.idDocType ?? l.pDocument} ${c.idDocNumber}', c.phone, if (c.email != null && c.email!.isNotEmpty) c.email!];
    return BankPage(
      leading: IconButton(tooltip: l.actionBack, onPressed: () => context.go('/clientes'), icon: const Icon(Icons.arrow_back)),
      title: c.fullName,
      subtitle: doc.join(' · '),
      actions: [
        OutlinedButton.icon(onPressed: () => _edit(context, ref), icon: const Icon(Icons.edit_outlined), label: Text(l.pEditClient)),
        if (loan != null) OutlinedButton.icon(onPressed: () => sendStatement(context, ref, c, loan), icon: const Icon(Icons.description_outlined), label: Text(l.pSendStatement)),
        if (loan != null && loan.status == 'active') GoldButton(label: l.pRegisterPayment, icon: Icons.payments_outlined, onPressed: () => _pay(context, ref, loan)),
      ],
      children: [
        _Totals(c),
        const SizedBox(height: 32),
        SectionHeader(l.pClientLoans, action: l.pNewLoanForClient, onAction: () => context.go('/prestamo?cliente=${c.id}')),
        for (final x in c.loans.reversed) ...[_LoanCard(client: c, loan: x), const SizedBox(height: 20)],
        if (c.email != null && c.email!.isNotEmpty) ...[const SizedBox(height: 12), BankCard(child: ClientEmails(clientId: c.id))],
      ],
    );
  }

  Future<void> _pay(BuildContext context, WidgetRef ref, Loan loan) async {
    final suggested = loan.summary.next?.outstanding ?? loan.summary.balance;
    final r = await showPaymentSheet(context, ref, loanId: loan.id, currency: loan.terms.currency, suggested: suggested, clientName: c.fullName);
    if (r == null) return;
    PersonalRealtime.refreshMoney(ref, clientId: c.id);
    ref.invalidate(receiptsProvider(loan.id));
    // El recibo, con el estado de cuenta, sale por WhatsApp con un clic (el correo, si el cliente lo autorizó, sale solo).
    if (context.mounted) await offerReceipt(context, ref, clientId: c.id, receiptNumber: r.receipt.number);
  }

  Future<void> _edit(BuildContext context, WidgetRef ref) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => EditClientDialog(client: c),
    );
    if (saved == true) ref.invalidate(clientProvider(c.id));
  }
}

/// Envía el estado de cuenta a la fecha: por correo sale solo; por WhatsApp se abre el chat con el PDF copiado.
Future<void> sendStatement(BuildContext context, WidgetRef ref, Client c, Loan loan, {Duration pollStep = const Duration(milliseconds: 1500)}) async {
  final l = context.l10n;
  final canEmail = c.email != null && c.email!.isNotEmpty;
  final channel = await showDialog<String>(
    context: context,
    builder: (ctx) => SimpleDialog(
      title: Text(l.pStatementHow),
      contentPadding: const EdgeInsets.fromLTRB(12, 16, 12, 16),
      children: [
        _ChannelOption(icon: Icons.chat_outlined, title: l.channelWhatsapp, subtitle: l.pStatementWhatsappHelp, onTap: () => Navigator.pop(ctx, 'whatsapp')),
        if (canEmail) _ChannelOption(icon: Icons.mail_outline, title: l.channelEmail, subtitle: l.pStatementEmailHelp(c.email!), onTap: () => Navigator.pop(ctx, 'email')),
      ],
    ),
  );
  if (channel == null || !context.mounted) return;
  final messenger = ScaffoldMessenger.maybeOf(context);
  void say(String text) => messenger
    ?..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(text), duration: const Duration(seconds: 8)));
  try {
    final api = ref.read(apiProvider);
    final m = await api.composeMessage(loanId: loan.id, event: 'statement', channel: channel);
    if (channel == 'email') return say(m.status == 'blocked' ? l.pStatementBlocked : l.pStatementEmailSent);
    say(l.pStatementPreparing);
    // El PDF del estado de cuenta se genera en el servidor en unos segundos; luego el mensaje queda listo para enviar.
    CorocMessage? ready;
    for (var i = 0; i < 20 && ready == null; i++) {
      if (i > 0) await Future<void>.delayed(pollStep);
      final page = await api.messages(status: const ['ready'], clientId: c.id, event: 'statement', limit: 10);
      ready = page.items.where((x) => x.id == m.id).firstOrNull;
    }
    if (ready == null) return say(l.pStatementBlocked);
    final r = await sendOnDesktop(ref, ready);
    say(r.pdfCopied ? l.todayMessagesPasteHint : (r.opened ? l.receiptPromptOpened : l.msgCannotOpen));
  } catch (e) {
    if (context.mounted) say(errorText(context, e));
  }
}

class _ChannelOption extends StatelessWidget {
  const _ChannelOption({required this.icon, required this.title, required this.subtitle, required this.onTap});
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => ListTile(
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    leading: CircleAvatar(
      backgroundColor: CorocColors.navy800,
      child: Icon(icon, color: CorocColors.gold300),
    ),
    title: Text(title),
    subtitle: Text(subtitle),
    onTap: onTap,
  );
}

/// Lo que debe el cliente en total y lo que ya pagó, sumando sus préstamos.
class _Totals extends StatelessWidget {
  const _Totals(this.c);
  final Client c;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    if (c.loans.isEmpty) return const SizedBox.shrink();
    final currency = c.loans.first.terms.currency;
    final balance = c.loans.fold<int>(0, (a, x) => a + x.summary.balance);
    final paid = c.loans.fold<int>(0, (a, x) => a + x.summary.paidTotal);
    final late = c.loans.fold<int>(0, (a, x) => a > x.summary.daysPastDue ? a : x.summary.daysPastDue);
    final next = c.loans.map((x) => x.summary.next).whereType<NextInstallment>().toList()..sort((a, b) => a.dueDate.compareTo(b.dueDate));
    return LayoutBuilder(
      builder: (context, box) {
        final tiles = [
          KpiTile(
            icon: Icons.account_balance_wallet_outlined,
            label: l.pClientBalance,
            value: Money.format(balance, currency),
            caption: late > 0 ? l.pDaysLate(late) : l.clientCurrent,
            tone: late > 0 ? StatusTone.error : null,
          ),
          KpiTile(icon: Icons.savings_outlined, label: l.pClientPaid, value: Money.format(paid, currency)),
          KpiTile(
            icon: Icons.event_outlined,
            label: l.pClientNext,
            value: next.isEmpty ? '—' : Money.format(next.first.outstanding, currency),
            caption: next.isEmpty ? l.pLoanPaidOff : Dates.long(next.first.dueDate, context.lang),
          ),
        ];
        if (box.maxWidth < 760)
          return Column(
            children: [for (final t in tiles) Padding(padding: const EdgeInsets.only(bottom: 12), child: t)],
          );
        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final (i, t) in tiles.indexed) ...[if (i > 0) const SizedBox(width: 16), Expanded(child: t)],
          ],
        );
      },
    );
  }
}

/// Un préstamo: cifras, avance, próxima cuota, y sus cuotas y pagos (con su recibo) a un toque.
class _LoanCard extends ConsumerStatefulWidget {
  const _LoanCard({required this.client, required this.loan});
  final Client client;
  final Loan loan;
  @override
  ConsumerState<_LoanCard> createState() => _LoanCardState();
}

class _LoanCardState extends ConsumerState<_LoanCard> {
  /// 0: nada abierto · 1: cuotas · 2: pagos.
  int _open = 0;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    final x = widget.loan;
    final s = x.summary;
    final cur = x.terms.currency;
    final closed = x.status != 'active';
    final (state, tone) = closed ? (l.pFilterPaid, StatusTone.neutral) : clientState(l, s.daysPastDue > 0 ? 'overdue' : 'current', s.daysPastDue);
    Widget figure(String label, int amount, {bool strong = false}) => Padding(
      padding: const EdgeInsets.only(right: 36, bottom: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label.toUpperCase(), style: t.labelSmall),
          const SizedBox(height: 4),
          MoneyText(
            amount,
            currency: cur,
            style: (strong ? t.headlineSmall : t.titleMedium)?.copyWith(fontFamily: 'Inter', fontFeatures: const [FontFeature.tabularFigures()]),
          ),
        ],
      ),
    );
    return BankCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(color: CorocColors.navy800, borderRadius: BorderRadius.circular(12)),
                child: const Icon(Icons.handshake_outlined, color: CorocColors.gold300, size: 22),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(l.pLoanTitle(x.contract), style: t.titleMedium),
                    Text(l.pLoanSince(Dates.medium(x.terms.disbursementDate, context.lang), _terms(l, x)), style: t.bodySmall),
                  ],
                ),
              ),
              Pill(state, tone: tone),
            ],
          ),
          const SizedBox(height: 20),
          Wrap(
            children: [
              figure(l.pLent, x.terms.principal),
              figure(l.pInterest, x.totalInterest),
              figure(l.pTotalToPay, x.totalPayable),
              figure(l.pClientPaid, s.paidTotal),
              figure(l.pClientBalance, s.balance, strong: true),
            ],
          ),
          const SizedBox(height: 8),
          LoanProgress(s.progress),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(child: Text(l.pInstallmentsPaid(s.paidInstallments, s.totalInstallments), style: t.bodyMedium)),
              if (s.next != null && !closed)
                Text(l.pNextInstallment(Dates.dayMonth(s.next!.dueDate, context.lang), Money.format(s.next!.outstanding, cur)), style: t.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
            ],
          ),
          if (x.rateCapOverride) ...[const SizedBox(height: 12), InfoNote(l.loanAboveCap, icon: Icons.gavel_outlined, tone: StatusTone.warn)],
          const SizedBox(height: 16),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              ChoiceChip(label: Text(l.pShowInstallments), selected: _open == 1, onSelected: (v) => setState(() => _open = v ? 1 : 0)),
              ChoiceChip(label: Text(l.pShowPayments), selected: _open == 2, onSelected: (v) => setState(() => _open = v ? 2 : 0)),
              ActionChip(avatar: const Icon(Icons.picture_as_pdf_outlined, size: 18), label: Text(l.pOpenContract), onPressed: () => _openContract(context)),
            ],
          ),
          AnimatedSize(
            duration: CorocMotion.normal,
            curve: CorocMotion.curve,
            alignment: Alignment.topCenter,
            child: switch (_open) {
              1 => _Installments(loan: x),
              2 => _Payments(loan: x),
              _ => const SizedBox(width: double.infinity),
            },
          ),
        ],
      ),
    );
  }

  String _terms(AppLocalizations l, Loan x) => switch (x.terms.frequency) {
    'daily' => l.pTermsDaily(x.terms.installments),
    'weekly' => l.pTermsWeekly(x.terms.installments),
    _ => l.pTermsMonthly(x.terms.installments),
  };

  Future<void> _openContract(BuildContext context) async {
    final l = context.l10n;
    try {
      final docs = await ref.read(apiProvider).documents(loanId: widget.loan.id, kind: 'schedule', limit: 1);
      if (!context.mounted) return;
      if (docs.items.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l.pContractPreparing)));
        return;
      }
      await openDocument(context, docs.items.first.id);
    } on ApiException catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(context, e))));
    }
  }
}

/// Las cuotas del préstamo con su estado.
class _Installments extends ConsumerWidget {
  const _Installments({required this.loan});
  final Loan loan;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    final rows = ref.watch(scheduleProvider(loan.id));
    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: AsyncBody<List<InstallmentState>>(
        value: rows,
        onRetry: () => ref.invalidate(scheduleProvider(loan.id)),
        builder: (list) => Column(
          children: [
            for (final (i, s) in list.indexed) ...[
              if (i > 0) const Divider(height: 1),
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
                child: Row(
                  children: [
                    SizedBox(width: 48, child: Text('${s.number}', style: t.titleSmall)),
                    Expanded(child: Text(Dates.medium(s.dueDate, context.lang), style: t.bodyMedium)),
                    SizedBox(
                      width: 170,
                      child: Builder(
                        builder: (_) {
                          final (label, tone) = installmentStatus(l, s.status);
                          return Align(
                            alignment: Alignment.centerLeft,
                            child: Pill(label, tone: tone),
                          );
                        },
                      ),
                    ),
                    SizedBox(
                      width: 130,
                      child: Text(
                        Money.format(s.amount, loan.terms.currency),
                        textAlign: TextAlign.right,
                        style: t.bodyMedium?.copyWith(fontFamily: 'Inter'),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Los pagos del préstamo: cada uno con su recibo en PDF.
class _Payments extends ConsumerWidget {
  const _Payments({required this.loan});
  final Loan loan;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final receipts = ref.watch(receiptsProvider(loan.id));
    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: AsyncBody<List<ReceiptRecord>>(
        value: receipts,
        onRetry: () => ref.invalidate(receiptsProvider(loan.id)),
        builder: (list) => list.isEmpty
            ? BankEmpty(icon: Icons.receipt_long_outlined, title: l.pNoPaymentsYet)
            : Column(
                children: [
                  for (final (i, r) in list.reversed.indexed) ...[
                    if (i > 0) const Divider(height: 1, indent: 62),
                    LedgerRow(
                      icon: r.voided ? Icons.block : Icons.receipt_long_outlined,
                      title: l.pMoveReceipt(r.number),
                      subtitle: [Dates.medium(r.data.payment.date, context.lang), if (r.data.payment.method != null) r.data.payment.method!].join(' · '),
                      amount: '+ ${Money.format(r.data.payment.amount, r.data.currency)}',
                      when: r.voided ? l.pMoveReversed : l.pOpenReceipt,
                      struck: r.voided,
                      onTap: r.documentId == null ? null : () => openDocument(context, r.documentId!),
                    ),
                  ],
                ],
              ),
      ),
    );
  }
}

/// Corregir los datos del cliente: nombre, documento, celular y correo.
class EditClientDialog extends ConsumerStatefulWidget {
  const EditClientDialog({super.key, required this.client});
  final Client client;
  @override
  ConsumerState<EditClientDialog> createState() => _EditClientDialogState();
}

class _EditClientDialogState extends ConsumerState<EditClientDialog> {
  late final _first = TextEditingController(text: widget.client.firstName);
  late final _last = TextEditingController(text: widget.client.lastName);
  late final _doc = TextEditingController(text: widget.client.idDocNumber ?? '');
  late final _phone = TextEditingController(text: widget.client.phone);
  late final _email = TextEditingController(text: widget.client.email ?? '');
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    disposeAfterDialog([_first, _last, _doc, _phone, _email]);
    super.dispose();
  }

  Future<void> _save() async {
    final l = context.l10n;
    if (_first.text.trim().isEmpty || _last.text.trim().isEmpty || _phone.text.trim().length < 7) {
      setState(() => _error = l.pClientRequired);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(apiProvider).updateClient(widget.client.id, {
        'firstName': _first.text.trim(),
        'lastName': _last.text.trim(),
        'phone': _phone.text.trim(),
        'email': _email.text.trim().isEmpty ? null : _email.text.trim(),
        'idDocType': _doc.text.trim().isEmpty ? null : (widget.client.idDocType ?? 'CC'),
        'idDocNumber': _doc.text.trim().isEmpty ? null : _doc.text.trim(),
      }, widget.client.version);
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() => _error = errorText(context, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    Widget field(TextEditingController c, String label, IconData icon, {TextInputType? type}) => Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: TextField(
        controller: c,
        keyboardType: type,
        decoration: corocInput(context, label: label, prefix: Icon(icon)),
      ),
    );
    return AlertDialog(
      title: Text(l.pEditClient),
      content: SizedBox(
        width: 480,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            field(_first, l.fieldFirstName, Icons.person_outline),
            field(_last, l.fieldLastName, Icons.person_outline),
            field(_doc, l.fieldIdDoc, Icons.badge_outlined),
            field(_phone, l.fieldPhone, Icons.phone_outlined, type: TextInputType.phone),
            field(_email, l.fieldEmail, Icons.mail_outline, type: TextInputType.emailAddress),
            if (_error != null) InfoNote(_error!, tone: StatusTone.error, icon: Icons.error_outline),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: _busy ? null : () => Navigator.pop(context), child: Text(l.actionCancel)),
        GoldButton(label: l.actionSave, onPressed: _save, busy: _busy),
      ],
    );
  }
}
