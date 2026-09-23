import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_client.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../../design/tokens.dart';
import '../../design/widgets/brand.dart';
import '../../design/widgets/common.dart';
import '../shell/app_shell.dart';

final dashboardCurrencyProvider = StateProvider<String?>((ref) => null);

final dashboardProvider = FutureProvider.autoDispose<Dashboard>((ref) {
  return ref.watch(apiProvider).dashboard(currency: ref.watch(dashboardCurrencyProvider));
});

final todayProvider = FutureProvider.autoDispose<TodayCollections>((ref) => ref.watch(apiProvider).today());

/// Eventos en tiempo real del servidor (§17), con reconexión progresiva mientras hay sesión.
final eventsProvider = StreamProvider<ServerEvent>((ref) async* {
  if (ref.watch(sessionProvider) == null) return;
  final api = ref.watch(apiProvider);
  var alive = true;
  ref.onDispose(() => alive = false);
  var wait = 2;
  while (alive) {
    try {
      await for (final e in api.events()) {
        wait = 2;
        yield e;
      }
    } catch (_) {
      // Sin conexión o sesión renovándose: se reintenta.
    }
    if (!alive) break;
    await Future<void>.delayed(Duration(seconds: wait));
    wait = math.min(wait * 2, 60);
  }
});

/// Escucha los eventos y refresca lo que cambió. Muestra el aviso discreto de §17: «Pago registrado · María Pérez · $ 60.000».
class RealtimeListener extends ConsumerWidget {
  const RealtimeListener({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.listen<AsyncValue<ServerEvent>>(eventsProvider, (_, next) {
      final e = next.valueOrNull;
      if (e == null) return;
      if (e.type == 'payment.posted' || e.type == 'payment.reversed' || e.type == 'loan.created' || e.type == 'dashboard.changed') {
        ref.invalidate(dashboardProvider);
        ref.invalidate(todayProvider);
      }
      if (e.type == 'payment.posted') {
        final amount = (e.data['amount'] as num?)?.toInt() ?? 0;
        final currency = ref.read(sessionProvider)?.company.currency ?? 'COP';
        ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(
          content: Text(context.l10n.realtimePayment(e.data['clientName'] as String? ?? '', Money.format(amount, currency))),
          duration: const Duration(seconds: 4),
        ));
      }
      if (e.type == 'security.lockout') {
        ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(context.l10n.realtimeLockout(e.data['username'] as String? ?? ''))));
      }
    });
    return child;
  }
}

class DashboardPage extends ConsumerWidget {
  const DashboardPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final auth = ref.watch(authProvider);
    final user = auth is SignedIn ? auth.user : null;
    final data = ref.watch(dashboardProvider);
    final hour = DateTime.now().hour;
    final greeting = hour < 12 ? l.greetingMorning : (hour < 19 ? l.greetingAfternoon : l.greetingEvening);
    final firstName = (user?.name ?? '').split(' ').first;

    return RealtimeListener(
      child: PageScaffold(
        onRefresh: () async {
          ref.invalidate(dashboardProvider);
          ref.invalidate(todayProvider);
          try {
            await ref.read(dashboardProvider.future);
          } catch (_) {
            // AsyncBody ya muestra el error con «Reintentar».
          }
        },
        children: [
          PageHeader(
            overline: Dates.long(Dates.isoToday(), context.lang),
            title: firstName.isEmpty ? greeting : '$greeting, $firstName',
            actions: [
              if (data.valueOrNull != null && data.value!.currencies.length > 1)
                SegmentedButton<String>(
                  showSelectedIcon: false,
                  segments: [for (final c in data.value!.currencies) ButtonSegment(value: c, label: Text(c))],
                  selected: {data.value!.currency},
                  onSelectionChanged: (v) => ref.read(dashboardCurrencyProvider.notifier).state = v.first,
                ),
              if (user?.can('clients.create') ?? false) GoldButton(label: l.newClient, icon: Icons.add, onPressed: () => context.go('/clients/new')),
            ],
          ),
          AsyncBody<Dashboard>(
            value: data,
            onRetry: () => ref.invalidate(dashboardProvider),
            builder: (d) => _DashboardBody(d),
          ),
        ],
      ),
    );
  }
}

class _DashboardBody extends ConsumerWidget {
  const _DashboardBody(this.d);
  final Dashboard d;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    String m(int v) => Money.format(v, d.currency);
    final kpis = [
      _Kpi(icon: Icons.people_alt_outlined, label: l.kpiClients, value: d.clientsActive, format: (v) => '$v', sub: l.kpiClientsSub(d.clientsTotal)),
      _Kpi(icon: Icons.account_balance_wallet_outlined, label: l.kpiLent, value: d.totalLent, format: m, sub: l.kpiLentSub(m(d.totalLentHistoric))),
      _Kpi(icon: Icons.today_outlined, label: l.kpiExpectedToday, value: d.expectedToday, format: m, sub: l.kpiExpectedSub(m(d.collectedToday), m(d.overdueTotal))),
      _Kpi(icon: Icons.stacked_line_chart, label: l.kpiReceivable, value: d.totalReceivable, format: m, sub: l.kpiReceivableSub),
    ];
    final pendingToday = d.expectedToday;
    final ratio = (d.collectedToday + pendingToday) == 0 ? 0.0 : d.collectedToday / (d.collectedToday + pendingToday);

    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (d.refreshing) ...[
        Card(child: ListTile(leading: const Icon(Icons.sync), title: Text(l.dashboardRefreshing))),
        const SizedBox(height: CorocSpace.md),
      ],
      LayoutBuilder(builder: (context, c) {
        final cols = c.maxWidth >= 1000 ? 4 : (c.maxWidth >= 560 ? 2 : 1);
        final w = (c.maxWidth - (cols - 1) * CorocSpace.md) / cols;
        return Wrap(spacing: CorocSpace.md, runSpacing: CorocSpace.md, children: [for (final k in kpis) SizedBox(width: w, child: k)]);
      }),
      const SizedBox(height: CorocSpace.md),
      LayoutBuilder(builder: (context, c) {
        final hero = _HeroCard(collected: d.collectedToday, pending: pendingToday, ratio: ratio, currency: d.currency);
        final aging = _AgingCard(d);
        if (c.maxWidth < 900) return Column(children: [hero, const SizedBox(height: CorocSpace.md), aging]);
        return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [Expanded(flex: 3, child: hero), const SizedBox(width: CorocSpace.md), Expanded(flex: 2, child: aging)]);
      }),
      const SizedBox(height: CorocSpace.md),
      LayoutBuilder(builder: (context, c) {
        final trend = SectionCard(
          title: l.trendTitle(d.trend.length),
          trailing: Text(m(d.trend.fold(0, (s, p) => s + p.amount)), style: Theme.of(context).textTheme.titleSmall),
          child: SizedBox(height: 220, child: TrendChart(points: d.trend, currency: d.currency)),
        );
        const today = _TodayCard();
        if (c.maxWidth < 900) return Column(children: [trend, const SizedBox(height: CorocSpace.md), today]);
        return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [Expanded(flex: 3, child: trend), const SizedBox(width: CorocSpace.md), const Expanded(flex: 2, child: today)]);
      }),
    ]);
  }
}

class _Kpi extends StatelessWidget {
  const _Kpi({required this.icon, required this.label, required this.value, required this.format, required this.sub});
  final IconData icon;
  final String label;
  final int value;
  final String Function(int) format;
  final String sub;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(CorocSpace.lg),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [Icon(icon, size: 18, color: scheme.tertiary), const SizedBox(width: 8), Expanded(child: Overline(label))]),
          const SizedBox(height: CorocSpace.md),
          FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerLeft, child: CountUp(value: value, format: format, style: t.displaySmall)),
          const SizedBox(height: 6),
          Text(sub, style: t.bodySmall, maxLines: 2, overflow: TextOverflow.ellipsis),
        ]),
      ),
    );
  }
}

/// Cifra protagonista en dorado sobre azul noche con el anillo «Recaudado hoy frente a esperado hoy» (§17).
class _HeroCard extends StatelessWidget {
  const _HeroCard({required this.collected, required this.pending, required this.ratio, required this.currency});
  final int collected;
  final int pending;
  final double ratio;
  final String currency;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    return Container(
      decoration: BoxDecoration(color: CorocColors.navy800, borderRadius: BorderRadius.circular(CorocRadii.card)),
      padding: const EdgeInsets.all(CorocSpace.xl),
      child: Wrap(
        spacing: CorocSpace.xl,
        runSpacing: CorocSpace.lg,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          ProgressRing(
            progress: ratio,
            size: 132,
            center: Column(mainAxisSize: MainAxisSize.min, children: [
              Text('${(ratio * 100).round()} %', style: t.headlineSmall?.copyWith(color: CorocColors.ivory, fontFamily: 'Inter')),
              Text(l.heroOfToday, style: t.labelSmall?.copyWith(color: CorocColors.inkMutedDark)),
            ]),
          ),
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 360),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
              Overline(l.heroCollectedToday, color: CorocColors.inkMutedDark),
              const SizedBox(height: 8),
              ShaderMask(
                shaderCallback: (r) => CorocColors.brandGradient.createShader(r),
                child: CountUp(value: collected, format: (v) => Money.format(v, currency), style: t.displayMedium?.copyWith(color: Colors.white)),
              ),
              const SizedBox(height: 6),
              Text(l.heroPendingToday(Money.format(pending, currency)), style: t.bodyMedium?.copyWith(color: CorocColors.ivory)),
              const SizedBox(height: CorocSpace.md),
              GoldButton(label: l.heroSeeToday, icon: Icons.arrow_forward, onPressed: () => context.go('/today')),
            ]),
          ),
        ],
      ),
    );
  }
}

/// Cartera por estado (§17): al día, 1–7, 8–30 y más de 30 días de mora.
class _AgingCard extends StatelessWidget {
  const _AgingCard(this.d);
  final Dashboard d;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    final rows = [
      (l.agingCurrent, d.aging.current, StatusTone.ok),
      (l.aging1to7, d.aging.days1to7, StatusTone.warn),
      (l.aging8to30, d.aging.days8to30, StatusTone.warn),
      (l.agingOver30, d.aging.over30, StatusTone.error),
    ];
    final max = rows.map((r) => r.$2.amount).fold<int>(0, math.max);
    return SectionCard(
      title: l.agingTitle,
      child: Column(children: [
        for (final r in rows)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Row(children: [
              SizedBox(
                width: 120,
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  StatusDot(label: r.$1, tone: r.$3),
                  Text(l.loansCount(r.$2.loans), style: t.bodySmall),
                ]),
              ),
              Expanded(
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(4),
                  child: LinearProgressIndicator(
                    value: max == 0 ? 0 : r.$2.amount / max,
                    minHeight: 10,
                    backgroundColor: Theme.of(context).colorScheme.outlineVariant,
                    color: CorocColors.gold500,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              SizedBox(width: 96, child: Text(Money.compact(r.$2.amount, d.currency), textAlign: TextAlign.end, style: t.titleSmall?.copyWith(fontFamily: 'Inter'))),
            ]),
          ),
      ]),
    );
  }
}

class _TodayCard extends ConsumerWidget {
  const _TodayCard();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final today = ref.watch(todayProvider);
    return SectionCard(
      title: l.navToday,
      trailing: TextButton(onPressed: () => context.go('/today'), child: Text(l.actionSeeAll)),
      padding: const EdgeInsets.fromLTRB(CorocSpace.lg, CorocSpace.lg, CorocSpace.lg, CorocSpace.sm),
      child: AsyncBody<TodayCollections>(
        value: today,
        onRetry: () => ref.invalidate(todayProvider),
        builder: (d) => d.items.isEmpty
            ? Padding(padding: const EdgeInsets.symmetric(vertical: CorocSpace.lg), child: Text(l.todayEmpty, textAlign: TextAlign.center))
            : Column(children: [
                for (final i in d.items.take(5))
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: CircleAvatar(backgroundColor: CorocColors.gold300, child: Text(initials(i.clientName), style: const TextStyle(color: CorocColors.navy800, fontWeight: FontWeight.w600))),
                    title: Text(i.clientName, overflow: TextOverflow.ellipsis),
                    subtitle: Text('${i.contract} · ${l.installmentN(i.installmentNumber ?? 0)}'),
                    trailing: Text(Money.format(i.amountToCollect, i.currency), style: Theme.of(context).textTheme.titleSmall?.copyWith(fontFamily: 'Inter')),
                    onTap: () => context.go('/clients/${i.clientId}'),
                  ),
              ]),
      ),
    );
  }
}

/// Tendencia de recaudo: una serie, barras finas con extremo redondeado, eje discreto y detalle al pasar el cursor.
class TrendChart extends StatefulWidget {
  const TrendChart({super.key, required this.points, required this.currency});
  final List<TrendPoint> points;
  final String currency;
  @override
  State<TrendChart> createState() => _TrendChartState();
}

class _TrendChartState extends State<TrendChart> {
  int? _hover;

  int? _hit(Offset p, Size size) {
    if (widget.points.isEmpty) return null;
    const left = 56.0;
    final slot = (size.width - left) / widget.points.length;
    final i = ((p.dx - left) / slot).floor();
    return i < 0 || i >= widget.points.length ? null : i;
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final t = Theme.of(context).textTheme;
    return LayoutBuilder(builder: (context, c) {
      final size = Size(c.maxWidth, c.maxHeight);
      final h = _hover;
      return MouseRegion(
        onHover: (e) => setState(() => _hover = _hit(e.localPosition, size)),
        onExit: (_) => setState(() => _hover = null),
        child: GestureDetector(
          onTapDown: (e) => setState(() => _hover = _hit(e.localPosition, size)),
          child: Stack(children: [
            CustomPaint(
              size: size,
              painter: _TrendPainter(
                points: widget.points,
                currency: widget.currency,
                lang: context.lang,
                grid: scheme.outlineVariant,
                label: scheme.onSurfaceVariant,
                bar: CorocColors.gold500,
                barToday: CorocColors.gold700,
                hover: h,
                labelStyle: t.bodySmall!,
              ),
            ),
            if (h != null)
              Positioned(
                top: 0,
                right: 0,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(color: scheme.surfaceContainerHighest, borderRadius: BorderRadius.circular(8)),
                  child: Text('${Dates.dayMonth(widget.points[h].date, context.lang)} · ${Money.format(widget.points[h].amount, widget.currency)}', style: t.bodySmall?.copyWith(color: scheme.onSurface)),
                ),
              ),
          ]),
        ),
      );
    });
  }
}

class _TrendPainter extends CustomPainter {
  _TrendPainter({required this.points, required this.currency, required this.lang, required this.grid, required this.label, required this.bar, required this.barToday, required this.hover, required this.labelStyle});
  final List<TrendPoint> points;
  final String currency;
  final String lang;
  final Color grid;
  final Color label;
  final Color bar;
  final Color barToday;
  final int? hover;
  final TextStyle labelStyle;

  void _text(Canvas canvas, String s, Offset at, {TextAlign align = TextAlign.left, double width = 80}) {
    final tp = TextPainter(text: TextSpan(text: s, style: labelStyle.copyWith(color: label)), textDirection: TextDirection.ltr, textAlign: align)..layout(minWidth: width, maxWidth: width);
    tp.paint(canvas, at);
  }

  @override
  void paint(Canvas canvas, Size size) {
    const left = 56.0;
    const bottom = 22.0;
    final chartH = size.height - bottom - 8;
    final maxV = points.fold<int>(0, (m, p) => math.max(m, p.amount));
    final top = maxV == 0 ? 1 : _niceCeil(maxV);
    final gridPaint = Paint()
      ..color = grid
      ..strokeWidth = 1;
    for (var k = 0; k <= 2; k++) {
      final y = 8 + chartH - chartH * k / 2;
      canvas.drawLine(Offset(left, y), Offset(size.width, y), gridPaint);
      _text(canvas, Money.compact(top * k ~/ 2, currency), Offset(0, y - 8), align: TextAlign.right, width: left - 8);
    }
    if (points.isEmpty) return;
    final slot = (size.width - left) / points.length;
    final w = math.max(2.0, math.min(14.0, slot * 0.6));
    for (var i = 0; i < points.length; i++) {
      final v = points[i].amount;
      if (v <= 0) continue;
      final hBar = math.max(2.0, chartH * v / top);
      final x = left + i * slot + (slot - w) / 2;
      final r = RRect.fromRectAndCorners(Rect.fromLTWH(x, 8 + chartH - hBar, w, hBar), topLeft: const Radius.circular(4), topRight: const Radius.circular(4));
      canvas.drawRRect(r, Paint()..color = (i == points.length - 1 || i == hover) ? barToday : bar);
    }
    for (final i in {0, points.length ~/ 2, points.length - 1}) {
      final x = left + i * slot + slot / 2;
      final align = i == 0 ? TextAlign.left : (i == points.length - 1 ? TextAlign.right : TextAlign.center);
      final dx = align == TextAlign.left ? x - slot / 2 : (align == TextAlign.right ? x + slot / 2 - 80 : x - 40);
      _text(canvas, Dates.dayMonth(points[i].date, lang), Offset(dx, size.height - bottom + 4), align: align);
    }
  }

  static int _niceCeil(int v) {
    final p = math.pow(10, (math.log(v) / math.ln10).floor()).toInt();
    final m = (v / p).ceil();
    final step = m <= 1 ? 1 : (m <= 2 ? 2 : (m <= 5 ? 5 : 10));
    return step * p;
  }

  @override
  bool shouldRepaint(_TrendPainter old) => old.points != points || old.hover != hover || old.grid != grid;
}

