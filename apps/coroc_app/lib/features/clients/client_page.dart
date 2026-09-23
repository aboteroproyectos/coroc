import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/brand.dart';
import '../../design/widgets/common.dart';
import '../../design/widgets/labels.dart';
import '../dashboard/dashboard_page.dart';
import '../documents/documents.dart';
import '../inbox/upload_link_card.dart';
import '../loans/loan_providers.dart';
import '../loans/payment_sheet.dart';
import '../shell/app_shell.dart';
import 'client_form.dart';

/// Ficha del cliente (§5.7-7): Resumen · Cuadro de inversión y pagos · Documentos · Historial.
class ClientPage extends ConsumerStatefulWidget {
  const ClientPage({super.key, required this.clientId});
  final String clientId;
  @override
  ConsumerState<ClientPage> createState() => _ClientPageState();
}

class _ClientPageState extends ConsumerState<ClientPage> {
  String? _loanId;

  @override
  Widget build(BuildContext context) {
    final client = ref.watch(clientProvider(widget.clientId));
    return RealtimeListener(
      child: AsyncBody<Client>(
        value: client,
        onRetry: () => ref.invalidate(clientProvider(widget.clientId)),
        builder: (c) {
          final loans = c.loans;
          final loan = loans.where((x) => x.id == _loanId).firstOrNull ?? loans.where((x) => x.status == 'active').firstOrNull ?? loans.firstOrNull;
          return DefaultTabController(
            length: 4,
            child: NestedScrollView(
              headerSliverBuilder: (context, _) => [
                SliverToBoxAdapter(child: _Header(client: c, loan: loan, onSelectLoan: (id) => setState(() => _loanId = id))),
                SliverPersistentHeader(pinned: true, delegate: _TabsDelegate()),
              ],
              body: loan == null
                  ? EmptyState(icon: Icons.request_quote_outlined, title: context.l10n.clientNoLoans)
                  : TabBarView(children: [
                      _SummaryTab(client: c, loan: loan),
                      _ScheduleTab(loan: loan),
                      DocumentsTab(client: c, loan: loan),
                      _HistoryTab(loan: loan),
                    ]),
            ),
          );
        },
      ),
    );
  }
}

class _TabsDelegate extends SliverPersistentHeaderDelegate {
  @override
  double get minExtent => 48;
  @override
  double get maxExtent => 48;
  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlapsContent) {
    final l = context.l10n;
    return ColoredBox(
      color: Theme.of(context).scaffoldBackgroundColor,
      child: TabBar(
        isScrollable: true,
        tabAlignment: TabAlignment.start,
        tabs: [Tab(text: l.tabSummary), Tab(text: l.tabSchedule), Tab(text: l.tabDocuments), Tab(text: l.tabHistory)],
      ),
    );
  }

  @override
  bool shouldRebuild(covariant _TabsDelegate oldDelegate) => false;
}

class _Header extends ConsumerWidget {
  const _Header({required this.client, required this.loan, required this.onSelectLoan});
  final Client client;
  final Loan? loan;
  final ValueChanged<String> onSelectLoan;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    final auth = ref.watch(authProvider);
    final user = auth is SignedIn ? auth.user : null;
    final pad = MediaQuery.sizeOf(context).width < CorocBreakpoints.tablet ? CorocSpace.md : CorocSpace.xl;
    final active = loan != null && loan!.status == 'active' && loan!.summary.balance > 0;
    return Padding(
      padding: EdgeInsets.fromLTRB(pad, pad, pad, CorocSpace.md),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        TextButton.icon(onPressed: () => context.go('/clients'), icon: const Icon(Icons.arrow_back), label: Text(l.navClients)),
        const SizedBox(height: CorocSpace.sm),
        Wrap(spacing: CorocSpace.lg, runSpacing: CorocSpace.md, crossAxisAlignment: WrapCrossAlignment.center, children: [
          CircleAvatar(radius: 28, backgroundColor: CorocColors.gold300, child: Text(initials(client.fullName), style: t.titleMedium?.copyWith(color: CorocColors.navy800))),
          Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
            Text(client.fullName, style: t.headlineMedium),
            Text('${client.code} · ${client.phone}', style: t.bodyMedium?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant)),
          ]),
        ]),
        const SizedBox(height: CorocSpace.md),
        Wrap(spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
          if (client.loans.length > 1)
            DropdownMenu<String>(
              initialSelection: loan?.id,
              label: Text(l.contract),
              onSelected: (v) {
                if (v != null) onSelectLoan(v);
              },
              dropdownMenuEntries: [for (final x in client.loans) DropdownMenuEntry(value: x.id, label: '${x.contract} · ${x.status == 'closed' ? l.clientClosed : l.clientCurrent}')],
            )
          else if (loan != null)
            Chip(label: Text('${l.contract} ${loan!.contract}')),
          if (active && (user?.can('payments.register') ?? false))
            GoldButton(
              label: l.actionRegisterPayment,
              icon: Icons.payments_outlined,
              onPressed: () async {
                final r = await showPaymentSheet(context, ref, loanId: loan!.id, currency: loan!.terms.currency, suggested: loan!.summary.next?.outstanding ?? loan!.summary.balance, clientName: client.fullName);
                if (r != null) ref.invalidate(clientProvider(client.id));
              },
            ),
          if (user?.can('loans.create') ?? false)
            OutlinedButton.icon(onPressed: () => context.go('/clients/${client.id}/loans/new'), icon: const Icon(Icons.add_card), label: Text(l.actionNewLoan)),
          if (user?.can('clients.edit') ?? false)
            OutlinedButton.icon(
              onPressed: () async {
                final updated = await showEditClient(context, ref, client);
                if (updated != null) ref.invalidate(clientProvider(client.id));
              },
              icon: const Icon(Icons.edit_outlined),
              label: Text(l.actionEdit),
            ),
        ]),
      ]),
    );
  }
}

class _SummaryTab extends StatelessWidget {
  const _SummaryTab({required this.client, required this.loan});
  final Client client;
  final Loan loan;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    final s = loan.summary;
    String m(int v) => Money.format(v, loan.terms.currency);
    final cards = [
      (l.cardPrincipal, m(loan.terms.principal)),
      (l.cardInterest, m(loan.totalInterest)),
      (l.cardTotalPayable, m(loan.totalPayable)),
      (l.cardCollected, m(s.paidTotal)),
      (l.cardBalance, m(s.balance)),
      (l.cardRealizedProfit, m(loan.realizedProfit)),
      (l.cardEffectiveRate, percent(loan.effectiveAnnualRate, context.lang)),
      (l.cardDaysPastDue, '${s.daysPastDue}'),
    ];
    final pad = MediaQuery.sizeOf(context).width < CorocBreakpoints.tablet ? CorocSpace.md : CorocSpace.xl;
    return ListView(padding: EdgeInsets.fromLTRB(pad, CorocSpace.md, pad, CorocSpace.xxl), children: [
      LayoutBuilder(builder: (context, c) {
        final cols = c.maxWidth >= 1000 ? 4 : (c.maxWidth >= 560 ? 2 : 1);
        final w = (c.maxWidth - (cols - 1) * CorocSpace.md) / cols;
        return Wrap(spacing: CorocSpace.md, runSpacing: CorocSpace.md, children: [
          for (final k in cards)
            SizedBox(
              width: w,
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(CorocSpace.md),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Overline(k.$1),
                    const SizedBox(height: 8),
                    FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerLeft, child: Text(k.$2, style: t.headlineSmall?.copyWith(fontFamily: 'Inter', fontWeight: FontWeight.w400))),
                  ]),
                ),
              ),
            ),
        ]);
      }),
      const SizedBox(height: CorocSpace.md),
      LayoutBuilder(builder: (context, c) {
        final progress = SectionCard(
          title: l.progressTitle,
          child: Row(children: [
            ProgressRing(
              progress: s.progress,
              size: 112,
              center: Text('${(s.progress * 100).round()} %', style: t.titleLarge?.copyWith(fontFamily: 'Inter')),
            ),
            const SizedBox(width: CorocSpace.lg),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                KeyValue(l.installmentsPaidOf(s.paidInstallments, s.totalInstallments), ''),
                KeyValue(l.receiptRemaining, '${s.remainingInstallments}'),
                if (s.next != null) KeyValue(l.receiptNext, '${Dates.medium(s.next!.dueDate, context.lang)} · ${m(s.next!.outstanding)}', emphasize: true),
                if (s.surplus > 0) KeyValue(l.paymentSurplus, m(s.surplus)),
              ]),
            ),
          ]),
        );
        final terms = SectionCard(
          title: l.termsTitle,
          child: Column(children: [
            KeyValue(l.termsMethod, methodLabel(l, loan.terms.method)),
            KeyValue(l.termsRate, loan.terms.method == 'french' ? l.ratePerPeriod(percent(double.parse(loan.terms.rate), context.lang)) : l.rateOnTotal(percent(double.parse(loan.terms.rate), context.lang))),
            KeyValue(l.termsInstallments, '${loan.terms.installments} · ${frequencyLabel(l, loan.terms.frequency)}'),
            KeyValue(l.termsDisbursement, Dates.medium(loan.terms.disbursementDate, context.lang)),
            KeyValue(l.termsFirstDue, Dates.medium(loan.terms.firstDueDate ?? '', context.lang)),
          ]),
        );
        if (c.maxWidth < 900) return Column(children: [progress, const SizedBox(height: CorocSpace.md), terms]);
        return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [Expanded(child: progress), const SizedBox(width: CorocSpace.md), Expanded(child: terms)]);
      }),
      const SizedBox(height: CorocSpace.md),
      UploadLinkCard(loan: loan),
      const SizedBox(height: CorocSpace.md),
      SectionCard(
        title: l.clientData,
        child: Column(children: [
          KeyValue(l.fieldPhone, client.phone),
          if (client.phone2 != null) KeyValue(l.fieldPhone2, client.phone2!),
          if (client.email != null) KeyValue(l.fieldEmail, client.email!),
          if (client.address != null) KeyValue(l.fieldAddress, [client.address, client.city].whereType<String>().join(', ')),
          if (client.idDocNumber != null) KeyValue(l.fieldIdDoc, '${client.idDocType ?? ''} ${client.idDocNumber}'.trim()),
          KeyValue(l.fieldLanguage, languageName(l, client.lang)),
          KeyValue(l.folder, client.folderName),
          if (client.coDebtor != null) KeyValue(l.coDebtor, [client.coDebtor!.name, client.coDebtor!.phone].whereType<String>().join(' · ')),
          KeyValue(l.consentsTitle, client.consents.isEmpty ? l.consentsNone : client.consents.map((c) => consentLabel(l, c.channel)).join(', ')),
          if ((client.notes ?? '').isNotEmpty) KeyValue(l.fieldNotes, client.notes!),
        ]),
      ),
    ]);
  }
}

String consentLabel(AppLocalizations l, String channel) => switch (channel) {
      'whatsapp' => 'WhatsApp',
      'email' => l.fieldEmail,
      _ => l.consentPersonalData,
    };

/// Cuadro de inversión y pagos (§10): plan pactado con lo pagado, estado, recibos y saldo después de cada cuota.
class _ScheduleTab extends ConsumerWidget {
  const _ScheduleTab({required this.loan});
  final Loan loan;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final rows = ref.watch(scheduleProvider(loan.id));
    final pad = MediaQuery.sizeOf(context).width < CorocBreakpoints.tablet ? CorocSpace.md : CorocSpace.xl;
    String m(int v) => Money.format(v, loan.terms.currency);
    return AsyncBody<List<InstallmentState>>(
      value: rows,
      onRetry: () => ref.invalidate(scheduleProvider(loan.id)),
      builder: (items) => ListView(padding: EdgeInsets.fromLTRB(pad, CorocSpace.md, pad, CorocSpace.xxl), children: [
        Card(
          clipBehavior: Clip.antiAlias,
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: DataTable(
              headingTextStyle: Theme.of(context).textTheme.labelMedium,
              columnSpacing: 28,
              columns: [
                DataColumn(label: Text(l.colNumber), numeric: true),
                DataColumn(label: Text(l.colDueDate)),
                DataColumn(label: Text(l.colAmount), numeric: true),
                DataColumn(label: Text(l.colPrincipal), numeric: true),
                DataColumn(label: Text(l.colInterest), numeric: true),
                DataColumn(label: Text(l.colPaid), numeric: true),
                DataColumn(label: Text(l.colPaidOn)),
                DataColumn(label: Text(l.colStatus)),
                DataColumn(label: Text(l.colReceipt)),
                DataColumn(label: Text(l.colBalanceAfter), numeric: true),
              ],
              rows: [
                for (final i in items)
                  DataRow(cells: [
                    DataCell(Text('${i.number}')),
                    DataCell(Text(Dates.medium(i.dueDate, context.lang))),
                    DataCell(Text(m(i.amount))),
                    DataCell(Text(m(i.principal))),
                    DataCell(Text(m(i.interest))),
                    DataCell(Text(i.paid == 0 ? '—' : m(i.paid))),
                    DataCell(Text(i.lastPaymentDate == null ? '—' : Dates.medium(i.lastPaymentDate!, context.lang))),
                    DataCell(Builder(builder: (context) {
                      final (label, tone) = installmentStatus(l, i.status);
                      return StatusDot(label: label, tone: tone);
                    })),
                    DataCell(Text(i.receiptNumbers.isEmpty ? '—' : i.receiptNumbers.join(', '))),
                    DataCell(Text(m(i.balanceAfter))),
                  ]),
              ],
            ),
          ),
        ),
      ]),
    );
  }
}

/// Libro de movimientos (§9.7) con reverso con motivo para Propietario y Administrador.
class _HistoryTab extends ConsumerWidget {
  const _HistoryTab({required this.loan});
  final Loan loan;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    final auth = ref.watch(authProvider);
    final canReverse = auth is SignedIn && auth.user.can('payments.reverse');
    final entries = ref.watch(ledgerProvider(loan.id));
    final pad = MediaQuery.sizeOf(context).width < CorocBreakpoints.tablet ? CorocSpace.md : CorocSpace.xl;
    return AsyncBody<List<LedgerEntry>>(
      value: entries,
      onRetry: () => ref.invalidate(ledgerProvider(loan.id)),
      builder: (list) => ListView(padding: EdgeInsets.fromLTRB(pad, CorocSpace.md, pad, CorocSpace.xxl), children: [
        Card(
          child: Column(children: [
            for (final e in list.reversed) ...[
              ListTile(
                leading: Icon(
                  e.type == 'payment' ? Icons.south_west : (e.type == 'reversal' ? Icons.undo : Icons.north_east),
                  color: e.type == 'reversal' || e.reversedBy != null ? Theme.of(context).colorScheme.error : Theme.of(context).colorScheme.tertiary,
                ),
                title: Text([entryType(l, e.type), if ((e.receiptNumber ?? '').isNotEmpty) e.receiptNumber!].join(' · ')),
                subtitle: Text([
                  Dates.medium(e.entryDate, context.lang),
                  if (e.method.isNotEmpty) e.method,
                  if (e.reference.isNotEmpty) e.reference,
                  if (e.reason.isNotEmpty) '${l.reason}: ${e.reason}',
                  if (e.reversedBy != null) l.receiptVoided,
                ].join(' · ')),
                trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                  Text(Money.format(e.amount, loan.terms.currency), style: t.titleSmall?.copyWith(fontFamily: 'Inter', decoration: e.reversedBy != null ? TextDecoration.lineThrough : null)),
                  if (e.type == 'payment' && (e.receiptNumber ?? '').isNotEmpty)
                    IconButton(
                      tooltip: l.receiptOpenPdf,
                      icon: const Icon(Icons.picture_as_pdf_outlined),
                      onPressed: () async {
                        final id = await waitForReceiptPdf(ref, loan.id, e.id, timeout: const Duration(seconds: 20));
                        if (!context.mounted) return;
                        if (id == null) {
                          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l.receiptPdfPending)));
                        } else {
                          await openDocument(context, id);
                        }
                      },
                    ),
                  if (canReverse && e.type == 'payment' && e.reversedBy == null)
                    IconButton(tooltip: l.actionReverse, icon: const Icon(Icons.undo), onPressed: () => _reverse(context, ref, e)),
                ]),
              ),
              const Divider(),
            ],
          ]),
        ),
      ]),
    );
  }

  Future<void> _reverse(BuildContext context, WidgetRef ref, LedgerEntry e) async {
    final l = context.l10n;
    final reason = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l.reverseTitle),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(l.reverseExplain(Money.format(e.amount, loan.terms.currency), e.receiptNumber ?? '—')),
          const SizedBox(height: CorocSpace.md),
          TextField(controller: reason, autofocus: true, decoration: corocInput(context, label: l.reason), maxLines: 2),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(l.actionCancel)),
          FilledButton(onPressed: () => Navigator.pop(context, reason.text.trim().length >= 3), child: Text(l.actionReverse)),
        ],
      ),
    );
    // El controlador no se libera a mano: el diálogo aún lo usa durante su animación de cierre.
    if (ok != true || !context.mounted) return;
    final container = ProviderScope.containerOf(context, listen: false);
    try {
      await container.read(apiProvider).reversePayment(loan.id, e.id, reason.text.trim());
      container
        ..invalidate(ledgerProvider(loan.id))
        ..invalidate(scheduleProvider(loan.id))
        ..invalidate(clientProvider(loan.clientId))
        ..invalidate(dashboardProvider);
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l.reverseDone)));
    } catch (err) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(context, err))));
    }
  }
}
