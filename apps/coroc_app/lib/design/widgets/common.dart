import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/l10n.dart';
import '../tokens.dart';
import 'brand.dart';

/// Tarjeta de sección con filete fino y esquinas de 16 px (§5.2).
class SectionCard extends StatelessWidget {
  const SectionCard({super.key, this.title, this.trailing, required this.child, this.padding = const EdgeInsets.all(CorocSpace.lg)});
  final String? title;
  final Widget? trailing;
  final Widget child;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: padding,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            if (title != null) ...[
              Row(children: [Expanded(child: Text(title!, style: Theme.of(context).textTheme.titleMedium)), ?trailing]),
              const SizedBox(height: CorocSpace.md),
            ],
            child,
          ],
        ),
      ),
    );
  }
}

/// Cifra que se anima hasta su valor (900 ms, §5.5); respeta «reducir movimiento».
class CountUp extends StatelessWidget {
  const CountUp({super.key, required this.value, required this.format, this.style});
  final int value;
  final String Function(int) format;
  final TextStyle? style;

  @override
  Widget build(BuildContext context) {
    if (MediaQuery.of(context).disableAnimations) return Text(format(value), style: style, maxLines: 1, overflow: TextOverflow.ellipsis);
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: value.toDouble()),
      duration: CorocMotion.countUp,
      curve: CorocMotion.curve,
      builder: (context, v, _) => Text(format(v.round()), style: style, maxLines: 1, overflow: TextOverflow.ellipsis),
    );
  }
}

/// Anillo de avance con el degradado de marca (§5.2).
class ProgressRing extends StatelessWidget {
  const ProgressRing({super.key, required this.progress, this.size = 120, this.stroke = 10, this.center});
  final double progress;
  final double size;
  final double stroke;
  final Widget? center;

  @override
  Widget build(BuildContext context) {
    final track = Theme.of(context).colorScheme.outlineVariant;
    final p = progress.clamp(0.0, 1.0);
    return Semantics(
      value: '${(p * 100).round()} %',
      child: SizedBox.square(
        dimension: size,
        child: TweenAnimationBuilder<double>(
          tween: Tween(begin: 0, end: p),
          duration: MediaQuery.of(context).disableAnimations ? Duration.zero : CorocMotion.countUp,
          curve: CorocMotion.curve,
          builder: (context, v, child) => CustomPaint(painter: _RingPainter(v, stroke, track), child: Center(child: child)),
          child: center,
        ),
      ),
    );
  }
}

class _RingPainter extends CustomPainter {
  _RingPainter(this.value, this.stroke, this.track);
  final double value;
  final double stroke;
  final Color track;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final arc = rect.deflate(stroke / 2);
    canvas.drawArc(arc, 0, math.pi * 2, false, Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..color = track);
    if (value <= 0) return;
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..strokeCap = StrokeCap.round
      ..shader = const SweepGradient(
        startAngle: -math.pi / 2,
        endAngle: math.pi * 1.5,
        colors: [CorocColors.gold700, CorocColors.gold500, CorocColors.gold300, CorocColors.gold700],
        stops: [0, 0.45, 0.7, 1],
        transform: GradientRotation(-math.pi / 2),
      ).createShader(rect);
    canvas.drawArc(arc, -math.pi / 2, math.pi * 2 * value, false, paint);
  }

  @override
  bool shouldRepaint(_RingPainter old) => old.value != value || old.track != track;
}

enum StatusTone { ok, warn, error, info, neutral }

/// Estado con punto y texto, nunca solo color (§5.2, §10).
class StatusDot extends StatelessWidget {
  const StatusDot({super.key, required this.label, required this.tone});
  final String label;
  final StatusTone tone;

  static Color colorOf(StatusTone t, Brightness b) => switch (t) {
        StatusTone.ok => b == Brightness.dark ? const Color(0xFF7FD1A8) : CorocColors.success,
        StatusTone.warn => b == Brightness.dark ? const Color(0xFFF0C27A) : CorocColors.warning,
        StatusTone.error => b == Brightness.dark ? const Color(0xFFF2B8B5) : CorocColors.error,
        StatusTone.info => b == Brightness.dark ? const Color(0xFFA9C4F5) : CorocColors.info,
        StatusTone.neutral => b == Brightness.dark ? CorocColors.inkMutedDark : CorocColors.inkMutedLight,
      };

  @override
  Widget build(BuildContext context) {
    final c = colorOf(tone, Theme.of(context).brightness);
    return Row(mainAxisSize: MainAxisSize.min, children: [
      Container(width: 8, height: 8, decoration: BoxDecoration(color: c, shape: BoxShape.circle)),
      const SizedBox(width: 8),
      Flexible(child: Text(label, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: c, fontWeight: FontWeight.w600), overflow: TextOverflow.ellipsis)),
    ]);
  }
}

/// Mensaje de error traducido para cualquier falla de la API.
String errorText(BuildContext context, Object error) {
  final l = context.l10n;
  if (error is ApiException) {
    if (error.isNetwork) return l.errorNetwork;
    if (error.detail != null && error.detail!.isNotEmpty) return error.detail!;
    if (error.title.isNotEmpty) return error.title;
  }
  return l.errorUnexpected;
}

/// Vista para datos asíncronos: carga, error con reintento, o contenido.
class AsyncBody<T> extends StatelessWidget {
  const AsyncBody({super.key, required this.value, required this.builder, required this.onRetry});
  final AsyncValue<T> value;
  final Widget Function(T data) builder;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return value.when(
      data: builder,
      loading: () => const Center(child: Padding(padding: EdgeInsets.all(CorocSpace.xl), child: CircularProgressIndicator())),
      error: (e, _) => ErrorState(message: errorText(context, e), onRetry: onRetry),
    );
  }
}

class ErrorState extends StatelessWidget {
  const ErrorState({super.key, required this.message, this.onRetry});
  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(CorocSpace.xl),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(Icons.cloud_off_outlined, size: 40, color: Theme.of(context).colorScheme.onSurfaceVariant),
          const SizedBox(height: CorocSpace.md),
          Text(message, textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodyMedium),
          if (onRetry != null) ...[
            const SizedBox(height: CorocSpace.md),
            OutlinedButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: Text(context.l10n.actionRetry)),
          ],
        ]),
      ),
    );
  }
}

class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.icon, required this.title, this.message, this.action});
  final IconData icon;
  final String title;
  final String? message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(CorocSpace.xl),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 40, color: Theme.of(context).colorScheme.tertiary),
          const SizedBox(height: CorocSpace.md),
          Text(title, style: t.titleMedium, textAlign: TextAlign.center),
          if (message != null) ...[const SizedBox(height: CorocSpace.sm), Text(message!, style: t.bodyMedium, textAlign: TextAlign.center)],
          if (action != null) ...[const SizedBox(height: CorocSpace.lg), action!],
        ]),
      ),
    );
  }
}

/// Encabezado de página con título, subtítulo y acciones.
class PageHeader extends StatelessWidget {
  const PageHeader({super.key, required this.title, this.subtitle, this.overline, this.actions = const []});
  final String title;
  final String? subtitle;
  final String? overline;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final head = Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      if (overline != null) ...[Overline(overline!), const SizedBox(height: 6)],
      Text(title, style: t.headlineMedium),
      if (subtitle != null) ...[const SizedBox(height: 4), Text(subtitle!, style: t.bodyMedium?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant))],
    ]);
    return Padding(
      padding: const EdgeInsets.only(bottom: CorocSpace.lg),
      child: LayoutBuilder(builder: (context, c) {
        if (actions.isEmpty) return head;
        if (c.maxWidth < 560) return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [head, const SizedBox(height: CorocSpace.md), Wrap(spacing: 8, runSpacing: 8, children: actions)]);
        return Row(crossAxisAlignment: CrossAxisAlignment.end, children: [Expanded(child: head), Wrap(spacing: 8, runSpacing: 8, children: actions)]);
      }),
    );
  }
}

/// Fila etiqueta-valor para resúmenes.
class KeyValue extends StatelessWidget {
  const KeyValue(this.label, this.value, {super.key, this.emphasize = false});
  final String label;
  final String value;
  final bool emphasize;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(child: Text(label, style: t.bodyMedium?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant))),
        const SizedBox(width: 12),
        Flexible(child: Text(value, textAlign: TextAlign.end, style: emphasize ? t.titleSmall : t.bodyMedium)),
      ]),
    );
  }
}

/// Libera los controladores de un diálogo cuando terminó su animación de salida: al volver `showDialog` el campo
/// todavía se dibuja durante la transición y un controlador liberado antes de tiempo lo rompe.
void disposeAfterDialog(Iterable<ChangeNotifier> controllers) {
  Future<void>.delayed(const Duration(milliseconds: 600), () {
    for (final c in controllers) {
      c.dispose();
    }
  });
}
