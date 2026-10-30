import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/models/models.dart';
import '../../design/theme.dart';
import '../../design/widgets/brand.dart';
import '../../design/widgets/common.dart';
import '../data.dart';
import '../ui/bank.dart';

/// Clientes: las personas a las que se les ha prestado, con su saldo y su estado. Se busca por nombre, documento,
/// celular o contrato, y se filtra por al día, atrasados o pagados.
class ClientsPage extends ConsumerStatefulWidget {
  const ClientsPage({super.key, this.initialQuery = ''});
  final String initialQuery;
  @override
  ConsumerState<ClientsPage> createState() => _ClientsPageState();
}

class _ClientsPageState extends ConsumerState<ClientsPage> {
  late final _search = TextEditingController(text: widget.initialQuery);
  late String _query = widget.initialQuery;
  String? _status;
  Timer? _debounce;

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  void _typed(String v) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () {
      if (mounted) setState(() => _query = v);
    });
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    final page = ref.watch(clientsProvider((q: _query, status: _status)));
    final filters = [(null, l.pFilterAll), ('current', l.clientCurrent), ('overdue', l.pFilterOverdue), ('closed', l.pFilterPaid)];
    return BankPage(
      title: l.navClients,
      subtitle: l.pClientsSubtitle,
      actions: [GoldButton(label: l.pNavNewLoan, icon: Icons.add, onPressed: () => context.go('/prestamo'))],
      children: [
        BankCard(
          padding: EdgeInsets.zero,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 20, 20, 12),
                child: TextField(
                  controller: _search,
                  onChanged: _typed,
                  autofocus: widget.initialQuery.isEmpty,
                  textInputAction: TextInputAction.search,
                  decoration: corocInput(
                    context,
                    label: l.pClientsSearch,
                    prefix: const Icon(Icons.search),
                    suffix: _search.text.isEmpty
                        ? null
                        : IconButton(
                            tooltip: l.pClear,
                            icon: const Icon(Icons.close),
                            onPressed: () {
                              _search.clear();
                              setState(() => _query = '');
                            },
                          ),
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
                child: Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [for (final (value, label) in filters) ChoiceChip(label: Text(label), selected: _status == value, onSelected: (_) => setState(() => _status = value))],
                ),
              ),
              const Divider(height: 1),
              AsyncBody<ClientPage>(
                value: page,
                onRetry: () => ref.invalidate(clientsProvider),
                builder: (p) {
                  if (p.items.isEmpty) {
                    return BankEmpty(
                      icon: Icons.people_alt_outlined,
                      title: _query.isEmpty && _status == null ? l.pClientsEmpty : l.pClientsNoMatch,
                      message: _query.isEmpty && _status == null ? l.pClientsEmptyBody : null,
                      action: _query.isEmpty && _status == null ? GoldButton(label: l.pHomeStartAction, icon: Icons.add_card, onPressed: () => context.go('/prestamo')) : null,
                    );
                  }
                  return Column(
                    children: [
                      for (final (i, c) in p.items.indexed) ...[if (i > 0) const Divider(height: 1, indent: 84), _ClientRow(c)],
                    ],
                  );
                },
              ),
              const SizedBox(height: 8),
            ],
          ),
        ),
        const SizedBox(height: 12),
        Text(l.pClientsHint, style: t.bodySmall, textAlign: TextAlign.center),
      ],
    );
  }
}

/// Estado del cliente en palabras: al día, con días de atraso o pagado.
(String, StatusTone) clientState(AppLocalizations l, String status, int daysPastDue) => switch (status) {
  'overdue' => (l.pDaysLate(daysPastDue), StatusTone.error),
  'closed' => (l.pFilterPaid, StatusTone.neutral),
  _ => (l.clientCurrent, StatusTone.ok),
};

class _ClientRow extends StatelessWidget {
  const _ClientRow(this.c);
  final ClientListItem c;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    final (label, tone) = clientState(l, c.status, c.daysPastDue);
    final next = c.next;
    return InkWell(
      onTap: () => context.go('/clientes/${c.id}'),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
        child: Row(
          children: [
            Monogram(c.fullName, size: 46),
            const SizedBox(width: 18),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(c.fullName, style: t.titleMedium, maxLines: 1, overflow: TextOverflow.ellipsis),
                  const SizedBox(height: 3),
                  Text([c.phone, ...c.contracts.take(2)].join(' · '), style: t.bodySmall, maxLines: 1, overflow: TextOverflow.ellipsis),
                ],
              ),
            ),
            const SizedBox(width: 16),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                MoneyText(
                  c.balance,
                  currency: c.currency,
                  style: t.titleMedium?.copyWith(fontFamily: 'Inter', fontFeatures: const [FontFeature.tabularFigures()]),
                ),
                const SizedBox(height: 4),
                if (next != null && c.status != 'closed')
                  Text(l.pNextInstallment(Dates.dayMonth(next.dueDate, context.lang), Money.format(next.outstanding, c.currency)), style: t.bodySmall)
                else
                  Text(l.pBalance, style: t.bodySmall),
              ],
            ),
            const SizedBox(width: 16),
            SizedBox(
              width: 150,
              child: Align(
                alignment: Alignment.centerRight,
                child: Pill(label, tone: tone),
              ),
            ),
            const SizedBox(width: 8),
            const Icon(Icons.chevron_right, color: Bank.muted),
          ],
        ),
      ),
    );
  }
}
