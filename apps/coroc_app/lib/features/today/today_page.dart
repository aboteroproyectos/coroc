import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/models/models.dart';
import '../../design/tokens.dart';
import '../../design/widgets/common.dart';
import '../dashboard/dashboard_page.dart';
import '../loans/payment_sheet.dart';
import '../shell/app_shell.dart';

/// Cobros de hoy (§5.7-4): cuotas que vencen hoy y vencidas, con registro de pago en efectivo en dos toques.
class TodayPage extends ConsumerStatefulWidget {
  const TodayPage({super.key});
  @override
  ConsumerState<TodayPage> createState() => _TodayPageState();
}

class _TodayPageState extends ConsumerState<TodayPage> {
  String _filter = 'all';

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final auth = ref.watch(authProvider);
    final canPay = auth is SignedIn && auth.user.can('payments.register');
    final data = ref.watch(todayProvider);
    return RealtimeListener(
      child: PageScaffold(
        onRefresh: () async {
          ref.invalidate(todayProvider);
          try {
            await ref.read(todayProvider.future);
          } catch (_) {
            // AsyncBody ya muestra el error con «Reintentar».
          }
        },
        children: [
          PageHeader(title: l.navToday, subtitle: l.todaySubtitle),
          Wrap(spacing: 8, children: [
            for (final f in [('all', l.filterAll), ('due_today', l.todayDueToday), ('overdue', l.todayOverdue)])
              ChoiceChip(label: Text(f.$2), selected: _filter == f.$1, onSelected: (_) => setState(() => _filter = f.$1)),
          ]),
          const SizedBox(height: CorocSpace.md),
          AsyncBody<TodayCollections>(
            value: data,
            onRetry: () => ref.invalidate(todayProvider),
            builder: (d) {
              final items = d.items.where((i) => _filter == 'all' || i.status == _filter).toList();
              if (items.isEmpty) return EmptyState(icon: Icons.task_alt, title: l.todayEmpty);
              final total = items.fold<int>(0, (s, i) => s + i.amountToCollect);
              return Card(
                child: Column(children: [
                  ListTile(
                    title: Text(l.todayCount(items.length)),
                    trailing: Text(Money.format(total, items.first.currency), style: Theme.of(context).textTheme.titleMedium?.copyWith(fontFamily: 'Inter')),
                  ),
                  const Divider(),
                  for (final i in items) ...[
                    _TodayRow(item: i, canPay: canPay),
                    const Divider(),
                  ],
                ]),
              );
            },
          ),
        ],
      ),
    );
  }
}

class _TodayRow extends ConsumerWidget {
  const _TodayRow({required this.item, required this.canPay});
  final TodayItem item;
  final bool canPay;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    final overdue = item.status == 'overdue';
    return ListTile(
      onTap: () => context.go('/clients/${item.clientId}'),
      leading: CircleAvatar(backgroundColor: CorocColors.gold300, child: Text(initials(item.clientName), style: const TextStyle(color: CorocColors.navy800, fontWeight: FontWeight.w600))),
      title: Text(item.clientName, overflow: TextOverflow.ellipsis),
      subtitle: Wrap(spacing: 12, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
        Text('${item.contract} · ${l.installmentN(item.installmentNumber ?? 0)}'),
        StatusDot(label: overdue ? l.daysPastDue(item.daysPastDue) : l.todayDueToday, tone: overdue ? StatusTone.error : StatusTone.info),
      ]),
      trailing: Row(mainAxisSize: MainAxisSize.min, children: [
        Text(Money.format(item.amountToCollect, item.currency), style: t.titleSmall?.copyWith(fontFamily: 'Inter')),
        if (canPay) ...[
          const SizedBox(width: 8),
          IconButton.filledTonal(
            tooltip: l.actionRegisterPayment,
            icon: const Icon(Icons.payments_outlined),
            onPressed: () => showPaymentSheet(context, ref, loanId: item.loanId, currency: item.currency, suggested: item.amountToCollect, clientName: item.clientName),
          ),
        ],
      ]),
    );
  }
}
