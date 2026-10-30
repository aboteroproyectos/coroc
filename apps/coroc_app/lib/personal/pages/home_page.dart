import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/models/models.dart';
import '../../design/tokens.dart';
import '../../design/widgets/brand.dart';
import '../../design/widgets/common.dart';
import '../../features/dashboard/dashboard_page.dart' show dashboardProvider, todayProvider;
import '../../features/inbox/inbox_page.dart' show intakeSummaryProvider, pickAndUploadReceipt;
import '../../features/messaging/messaging_common.dart' show messagesSummaryProvider;
import '../data.dart';
import '../ui/bank.dart';
import '../ui/labels.dart';

/// Inicio del nuevo COROC, como la portada de un banco: el saldo por cobrar protagonista, lo de hoy, lo que espera a la
/// persona (mensajes para WhatsApp y comprobantes por revisar) y el extracto de los últimos pagos.
class HomePage extends ConsumerWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final auth = ref.watch(authProvider);
    final session = auth is SignedIn ? auth.session : null;
    final now = DateTime.now();
    final dashboard = ref.watch(dashboardProvider);
    return RefreshIndicator(
      onRefresh: () async {
        PersonalRealtime.refreshMoney(ref);
        ref
          ..invalidate(messagesSummaryProvider)
          ..invalidate(intakeSummaryProvider);
        await ref.read(dashboardProvider.future);
      },
      child: BankPage(
        title: '${greeting(l, now)}, ${firstName(session?.user.name ?? '')}',
        subtitle: [Dates.long(Dates.iso(now), context.lang), if (session != null) session.company.name].join(' · '),
        actions: [
          OutlinedButton.icon(onPressed: () => _upload(context, ref), icon: const Icon(Icons.upload_file_outlined), label: Text(l.pHomeUpload)),
          GoldButton(label: l.pNavNewLoan, icon: Icons.add, onPressed: () => context.go('/prestamo')),
        ],
        children: [AsyncBody<Dashboard>(value: dashboard, onRetry: () => ref.invalidate(dashboardProvider), builder: (d) => d.totalLentHistoric == 0 ? const _FirstLoan() : _Overview(d))],
      ),
    );
  }

  Future<void> _upload(BuildContext context, WidgetRef ref) async {
    try {
      final item = await pickAndUploadReceipt(context, ref);
      if (item != null && context.mounted) context.go('/comprobantes?id=${item.id}');
    } catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(context, e))));
    }
  }
}

/// Sin préstamos todavía: una bienvenida con un solo botón.
class _FirstLoan extends StatelessWidget {
  const _FirstLoan();

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    return HeroCard(
      padding: const EdgeInsets.all(40),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(l.pHomeStartTitle.toUpperCase(), style: t.labelMedium?.copyWith(color: CorocColors.gold300)),
          const SizedBox(height: 14),
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: Text(
              l.pHomeStartBody,
              style: t.headlineSmall?.copyWith(color: CorocColors.ivory, fontWeight: FontWeight.w500, height: 1.35),
            ),
          ),
          const SizedBox(height: 28),
          GoldButton(label: l.pHomeStartAction, icon: Icons.add_card, onPressed: () => context.go('/prestamo')),
          const SizedBox(height: 20),
          Text(l.pHomeDropHint, style: t.bodyMedium?.copyWith(color: CorocColors.inkMutedDark)),
        ],
      ),
    );
  }
}

class _Overview extends ConsumerWidget {
  const _Overview(this.d);
  final Dashboard d;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final ready = ref.watch(messagesSummaryProvider).valueOrNull?.ready ?? 0;
    final review = ref.watch(intakeSummaryProvider).valueOrNull;
    final toReview = (review?.review ?? 0) + (review?.unassigned ?? 0);
    final tiles = [
      ActionTile(
        icon: Icons.send_outlined,
        title: l.pHomeToSendTitle,
        message: l.pHomeToSendBody(ready),
        idle: l.pHomeToSendIdle,
        count: ready,
        action: l.pHomeToSendAction,
        onAction: () => context.go('/enviar'),
      ),
      ActionTile(
        icon: Icons.fact_check_outlined,
        title: l.pHomeReviewTitle,
        message: l.pHomeReviewBody(toReview),
        idle: l.pHomeReviewIdle,
        count: toReview,
        action: l.pHomeReviewAction,
        onAction: () => context.go('/comprobantes'),
      ),
    ];
    return LayoutBuilder(
      builder: (context, c) {
        final wide = c.maxWidth >= 980;
        Widget pair(Widget a, Widget b, {int fa = 3, int fb = 2}) => wide
            ? IntrinsicHeight(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Expanded(flex: fa, child: a),
                    const SizedBox(width: 20),
                    Expanded(flex: fb, child: b),
                  ],
                ),
              )
            : Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [a, const SizedBox(height: 20), b]);
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            pair(_Balance(d), _Today(d)),
            const SizedBox(height: 20),
            pair(tiles[0], tiles[1], fa: 1, fb: 1),
            const SizedBox(height: 28),
            if (wide)
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Expanded(flex: 3, child: _Movements()),
                  const SizedBox(width: 20),
                  Expanded(flex: 2, child: _DueToday(currency: d.currency)),
                ],
              )
            else ...[
              const _Movements(),
              const SizedBox(height: 20),
              _DueToday(currency: d.currency),
            ],
          ],
        );
      },
    );
  }
}

/// El saldo por cobrar, protagonista, con los cobros de los últimos 30 días.
class _Balance extends StatelessWidget {
  const _Balance(this.d);
  final Dashboard d;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    final collected = d.trend.fold<int>(0, (a, p) => a + p.amount);
    final dim = CorocColors.ivory.withValues(alpha: 0.72);
    return HeroCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(l.pHomeReceivable.toUpperCase(), style: t.labelMedium?.copyWith(color: CorocColors.gold300)),
          const SizedBox(height: 10),
          CountUp(
            value: d.totalReceivable,
            format: (v) => Money.format(v, d.currency),
            style: t.displayMedium?.copyWith(color: CorocColors.ivory, fontSize: 46, letterSpacing: -0.5),
          ),
          const SizedBox(height: 6),
          Text('${l.pHomeActiveClients(d.clientsActive)} · ${l.pHomeLent(Money.format(d.totalLent, d.currency))}', style: t.bodyMedium?.copyWith(color: dim)),
          const SizedBox(height: 22),
          Container(height: 1, color: CorocColors.gold500.withValues(alpha: 0.25)),
          const SizedBox(height: 18),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: Wrap(
                  spacing: 36,
                  runSpacing: 14,
                  children: [
                    _HeroStat(label: l.pHomeCollected30, value: Money.format(collected, d.currency)),
                    _HeroStat(label: l.pHomeOverdue, value: Money.format(d.overdueTotal, d.currency), alert: d.overdueTotal > 0),
                  ],
                ),
              ),
              const SizedBox(width: 20),
              SizedBox(
                width: 200,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Semantics(label: l.pHomeTrend, child: Sparkline([for (final p in d.trend) p.amount], height: 56)),
                    const SizedBox(height: 6),
                    Text(l.pHomeTrend, style: t.bodySmall?.copyWith(color: dim)),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _HeroStat extends StatelessWidget {
  const _HeroStat({required this.label, required this.value, this.alert = false});
  final String label;
  final String value;
  final bool alert;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label.toUpperCase(), style: t.labelSmall?.copyWith(color: CorocColors.inkMutedDark)),
        const SizedBox(height: 4),
        Text(
          value,
          style: t.titleLarge?.copyWith(fontFamily: 'Inter', color: alert ? const Color(0xFFF5B8B3) : CorocColors.ivory, fontFeatures: const [FontFeature.tabularFigures()]),
        ),
      ],
    );
  }
}

/// Lo de hoy: lo que vence y lo que ya se cobró, con la barra de avance.
class _Today extends StatelessWidget {
  const _Today(this.d);
  final Dashboard d;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    final goal = d.expectedToday;
    final progress = goal <= 0 ? (d.collectedToday > 0 ? 1.0 : 0.0) : math.min(1.0, d.collectedToday / goal);
    Widget line(String label, int amount, {bool strong = false}) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Expanded(
            child: Text(label, style: t.bodyLarge?.copyWith(color: Bank.muted)),
          ),
          MoneyText(
            amount,
            currency: d.currency,
            style: (strong ? t.headlineSmall : t.titleMedium)?.copyWith(fontFamily: 'Inter'),
          ),
        ],
      ),
    );
    return BankCard(
      title: l.pHomeToday,
      trailing: Text(Dates.dayMonth(d.asOf, context.lang), style: t.bodyMedium?.copyWith(color: Bank.muted)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          line(l.pHomeDueToday, d.expectedToday, strong: true),
          line(l.pHomeCollectedToday, d.collectedToday),
          const SizedBox(height: 14),
          LoanProgress(progress, height: 10),
          const SizedBox(height: 8),
          Text(l.pHomeTodayProgress((progress * 100).round()), style: t.bodySmall),
        ],
      ),
    );
  }
}

/// El extracto: los últimos pagos con su recibo y cómo va la respuesta al cliente.
class _Movements extends ConsumerWidget {
  const _Movements();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final items = ref.watch(recentPaymentsProvider);
    return BankCard(
      title: l.pHomeMovements,
      padding: const EdgeInsets.fromLTRB(16, 22, 16, 12),
      child: AsyncBody<List<RecentPayment>>(
        value: items,
        onRetry: () => ref.invalidate(recentPaymentsProvider),
        builder: (list) => list.isEmpty
            ? BankEmpty(icon: Icons.receipt_long_outlined, title: l.pHomeMovementsEmpty)
            : Column(
                children: [
                  for (final (i, p) in list.indexed) ...[
                    if (i > 0) const Divider(height: 1, indent: 62),
                    LedgerRow(
                      icon: channelIcon(p.channel),
                      title: p.clientName,
                      subtitle: [if (p.receiptNumber != null) l.pMoveReceipt(p.receiptNumber!), channelName(l, p.channel), if (p.auto) l.pMoveAuto].join(' · '),
                      amount: '+ ${Money.format(p.amount, p.currency)}',
                      when: whenText(l, p.recordedAt, context.lang),
                      trailingNote: replyPill(l, p),
                      struck: p.reversed,
                      onTap: () => context.go('/clientes/${p.clientId}'),
                    ),
                  ],
                ],
              ),
      ),
    );
  }
}

/// Quién debe pagar hoy (y quién está atrasado), con un toque a su ficha.
class _DueToday extends ConsumerWidget {
  const _DueToday({required this.currency});
  final String currency;
  static const shown = 7;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    final today = ref.watch(todayProvider);
    return BankCard(
      title: l.pHomeDueList,
      padding: const EdgeInsets.fromLTRB(16, 22, 16, 12),
      child: AsyncBody<TodayCollections>(
        value: today,
        onRetry: () => ref.invalidate(todayProvider),
        builder: (data) {
          if (data.items.isEmpty) return BankEmpty(icon: Icons.event_available_outlined, title: l.pHomeDueEmpty);
          final rest = data.items.length - shown;
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final (i, item) in data.items.take(shown).indexed) ...[
                if (i > 0) const Divider(height: 1, indent: 62),
                InkWell(
                  borderRadius: BorderRadius.circular(14),
                  onTap: () => context.go('/clientes/${item.clientId}'),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
                    child: Row(
                      children: [
                        Monogram(item.clientName, size: 40),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(item.clientName, style: t.titleSmall, maxLines: 1, overflow: TextOverflow.ellipsis),
                              const SizedBox(height: 4),
                              item.daysPastDue > 0
                                  ? Pill(l.pDaysLate(item.daysPastDue), tone: StatusTone.error)
                                  : Pill(item.installmentNumber == null ? l.pDueTodayShort : l.pInstallmentDueToday(item.installmentNumber!), tone: StatusTone.info),
                            ],
                          ),
                        ),
                        MoneyText(
                          item.amountToCollect,
                          currency: item.currency,
                          style: t.titleSmall?.copyWith(fontFamily: 'Inter'),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
              if (rest > 0)
                Padding(
                  padding: const EdgeInsets.fromLTRB(8, 12, 8, 4),
                  child: Text(l.pHomeDueMore(rest), style: t.bodySmall),
                ),
            ],
          );
        },
      ),
    );
  }
}
