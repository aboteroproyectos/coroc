import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../core/format.dart';
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/common.dart' show StatusTone;

/// Nuevo COROC (Fase 11): la marca con superficies de banca privada. Fondo marfil cálido, tarjetas blancas con
/// sombra suave, el saldo protagonista en azul noche con filetes dorados y cifras con números tabulares.
abstract final class Bank {
  static const canvas = Color(0xFFF4F2EC);
  static const line = Color(0xFFE8E3D6);
  static const ink = CorocColors.navy800;
  static const muted = CorocColors.inkMutedLight;
  static const positive = Color(0xFF1F7A55);
  static const negative = Color(0xFFB3261E);
  static const caution = Color(0xFF8F620F);
  static const radius = 20.0;
  static const maxContent = 1180.0;
  static const shadow = [BoxShadow(color: Color(0x0F0B0826), blurRadius: 32, offset: Offset(0, 14)), BoxShadow(color: Color(0x0A0B0826), blurRadius: 6, offset: Offset(0, 2))];
  static const night = LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [Color(0xFF221B63), CorocColors.navy800, CorocColors.navy900], stops: [0, 0.55, 1]);
  static const sidebar = LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [CorocColors.navy900, Color(0xFF120D3C)]);

  static Color tone(StatusTone t) => switch (t) {
    StatusTone.ok => positive,
    StatusTone.warn => caution,
    StatusTone.error => negative,
    StatusTone.info => CorocColors.info,
    StatusTone.neutral => muted,
  };
}

/// Tema del nuevo COROC: el de la marca (Marfil) con las superficies, botones y diálogos de banca privada.
ThemeData bankTheme() {
  final base = CorocTheme.light();
  final text = base.textTheme;
  final shape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(14));
  return base.copyWith(
    scaffoldBackgroundColor: Bank.canvas,
    cardTheme: base.cardTheme.copyWith(
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Bank.radius),
        side: const BorderSide(color: Bank.line),
      ),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      titleTextStyle: text.headlineSmall,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(minimumSize: const Size(48, 52), shape: shape, textStyle: text.labelLarge, backgroundColor: CorocColors.navy800, foregroundColor: CorocColors.ivory),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(48, 52),
        shape: shape,
        side: const BorderSide(color: Bank.line),
        foregroundColor: Bank.ink,
        backgroundColor: Colors.white,
        textStyle: text.labelLarge,
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(minimumSize: const Size(48, 48), shape: shape, foregroundColor: CorocColors.gold800, textStyle: text.labelLarge),
    ),
    chipTheme: base.chipTheme.copyWith(
      shape: const StadiumBorder(side: BorderSide(color: Bank.line)),
      backgroundColor: Colors.white,
      selectedColor: CorocColors.navy800,
      secondarySelectedColor: CorocColors.navy800,
      labelStyle: text.labelLarge,
      secondaryLabelStyle: text.labelLarge?.copyWith(color: CorocColors.ivory),
      checkmarkColor: CorocColors.gold300,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
    ),
    snackBarTheme: base.snackBarTheme.copyWith(width: 520, insetPadding: const EdgeInsets.all(24)),
    tooltipTheme: TooltipThemeData(
      decoration: BoxDecoration(color: CorocColors.navy800, borderRadius: BorderRadius.circular(8)),
      textStyle: text.bodySmall?.copyWith(color: CorocColors.ivory),
    ),
  );
}

/// Tarjeta blanca de banca privada, con título opcional y toda la tarjeta tocable si se pide.
class BankCard extends StatelessWidget {
  const BankCard({super.key, required this.child, this.title, this.trailing, this.padding = const EdgeInsets.all(24), this.onTap, this.color});
  final Widget child;
  final String? title;
  final Widget? trailing;
  final EdgeInsets padding;
  final VoidCallback? onTap;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final body = Padding(
      padding: padding,
      child: title == null
          ? child
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  children: [
                    Expanded(child: Text(title!, style: Theme.of(context).textTheme.titleMedium)),
                    ?trailing,
                  ],
                ),
                const SizedBox(height: 16),
                child,
              ],
            ),
    );
    return DecoratedBox(
      decoration: BoxDecoration(
        color: color ?? Colors.white,
        borderRadius: BorderRadius.circular(Bank.radius),
        border: Border.all(color: Bank.line),
        boxShadow: Bank.shadow,
      ),
      child: Material(
        type: MaterialType.transparency,
        child: onTap == null ? body : InkWell(borderRadius: BorderRadius.circular(Bank.radius), onTap: onTap, child: body),
      ),
    );
  }
}

/// Tarjeta protagonista en azul noche con filetes dorados: el saldo de la cartera, como la cuenta de un banco.
class HeroCard extends StatelessWidget {
  const HeroCard({super.key, required this.child, this.padding = const EdgeInsets.all(28)});
  final Widget child;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(Bank.radius + 4),
      child: DecoratedBox(
        decoration: const BoxDecoration(gradient: Bank.night, boxShadow: Bank.shadow),
        child: CustomPaint(
          painter: GoldArcs(),
          child: Padding(padding: padding, child: child),
        ),
      ),
    );
  }
}

/// Filetes dorados finos en la esquina, en el espíritu del isotipo (saldo protagonista y pantallas de entrada).
class GoldArcs extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width + 40, -60);
    for (var i = 0; i < 4; i++) {
      final paint = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.2
        ..color = CorocColors.gold500.withValues(alpha: 0.18 - i * 0.035);
      canvas.drawCircle(center, 150.0 + i * 46, paint);
    }
    final glow = Paint()
      ..shader = RadialGradient(colors: [CorocColors.gold500.withValues(alpha: 0.16), CorocColors.gold500.withValues(alpha: 0)]).createShader(Rect.fromCircle(center: center, radius: 260));
    canvas.drawCircle(center, 260, glow);
  }

  @override
  bool shouldRepaint(GoldArcs oldDelegate) => false;
}

/// Monto con el formato de su moneda y cifras tabulares; con signo cuando es un abono.
class MoneyText extends StatelessWidget {
  const MoneyText(this.minor, {super.key, required this.currency, this.style, this.signed = false});
  final int minor;
  final String currency;
  final TextStyle? style;
  final bool signed;

  @override
  Widget build(BuildContext context) {
    final text = Money.format(minor, currency);
    return Text(signed ? '+ $text' : text, style: style, maxLines: 1, overflow: TextOverflow.ellipsis);
  }
}

/// Iniciales del cliente en un círculo con filete dorado.
class Monogram extends StatelessWidget {
  const Monogram(this.name, {super.key, this.size = 44, this.dark = false});
  final String name;
  final double size;
  final bool dark;

  static String initials(String name) {
    final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '·';
    final first = parts.first.characters.first;
    final last = parts.length > 1
        ? parts.length >= 4
              ? parts[2].characters.first
              : parts.last.characters.first
        : '';
    return (first + last).toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      padding: const EdgeInsets.all(1.6),
      decoration: const BoxDecoration(shape: BoxShape.circle, gradient: CorocColors.brandGradient),
      child: Container(
        alignment: Alignment.center,
        decoration: BoxDecoration(shape: BoxShape.circle, color: dark ? CorocColors.navy800 : CorocColors.ivory),
        child: Text(
          initials(name),
          style: Theme.of(context).textTheme.titleSmall?.copyWith(fontSize: size * 0.34, color: dark ? CorocColors.gold300 : CorocColors.navy800, letterSpacing: 0.5),
        ),
      ),
    );
  }
}

/// Estado en una píldora: color suave y texto, nunca solo color.
class Pill extends StatelessWidget {
  const Pill(this.label, {super.key, this.tone = StatusTone.neutral, this.icon});
  final String label;
  final StatusTone tone;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final c = Bank.tone(tone);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: c.withValues(alpha: 0.09),
        borderRadius: BorderRadius.circular(99),
        border: Border.all(color: c.withValues(alpha: 0.22)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 14, color: c),
            const SizedBox(width: 5),
          ] else ...[
            Container(
              width: 6,
              height: 6,
              decoration: BoxDecoration(color: c, shape: BoxShape.circle),
            ),
            const SizedBox(width: 6),
          ],
          Flexible(
            child: Text(
              label,
              style: Theme.of(context).textTheme.labelMedium?.copyWith(color: c, letterSpacing: 0.2, fontWeight: FontWeight.w600),
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}

/// Título de sección con una acción a la derecha («Ver todos →»).
class SectionHeader extends StatelessWidget {
  const SectionHeader(this.title, {super.key, this.action, this.onAction, this.subtitle});
  final String title;
  final String? subtitle;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: t.titleLarge),
                if (subtitle != null) ...[const SizedBox(height: 2), Text(subtitle!, style: t.bodyMedium?.copyWith(color: Bank.muted))],
              ],
            ),
          ),
          if (action != null)
            TextButton(
              onPressed: onAction,
              child: Row(mainAxisSize: MainAxisSize.min, children: [Text(action!), const SizedBox(width: 6), const Icon(Icons.arrow_forward, size: 16)]),
            ),
        ],
      ),
    );
  }
}

/// Línea fina de los cobros de los últimos días, dorada, para la tarjeta protagonista.
class Sparkline extends StatelessWidget {
  const Sparkline(this.values, {super.key, this.height = 64, this.color = CorocColors.gold300});
  final List<int> values;
  final double height;
  final Color color;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: height,
    child: CustomPaint(painter: _SparkPainter(values, color), size: Size.infinite),
  );
}

class _SparkPainter extends CustomPainter {
  _SparkPainter(this.values, this.color);
  final List<int> values;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    if (values.length < 2) return;
    final top = values.reduce(math.max).toDouble();
    final max = top <= 0 ? 1.0 : top;
    final dx = size.width / (values.length - 1);
    Offset at(int i) => Offset(i * dx, size.height - 4 - (values[i] / max) * (size.height - 10));
    final path = Path()..moveTo(0, at(0).dy);
    for (var i = 1; i < values.length; i++) {
      final a = at(i - 1);
      final b = at(i);
      path.cubicTo(a.dx + dx / 2, a.dy, b.dx - dx / 2, b.dy, b.dx, b.dy);
    }
    final fill = Path.from(path)
      ..lineTo(size.width, size.height)
      ..lineTo(0, size.height)
      ..close();
    canvas.drawPath(
      fill,
      Paint()..shader = LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [color.withValues(alpha: 0.28), color.withValues(alpha: 0)]).createShader(Offset.zero & size),
    );
    canvas.drawPath(
      path,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..strokeCap = StrokeCap.round
        ..color = color,
    );
    canvas.drawCircle(at(values.length - 1), 3.5, Paint()..color = color);
  }

  @override
  bool shouldRepaint(_SparkPainter old) => old.values != values || old.color != color;
}

/// Indicador de la cartera: etiqueta, cifra y una nota; con tono para lo que pide atención.
class KpiTile extends StatelessWidget {
  const KpiTile({super.key, required this.icon, required this.label, required this.value, this.caption, this.tone, this.onTap});
  final IconData icon;
  final String label;
  final String value;
  final String? caption;
  final StatusTone? tone;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final accent = tone == null ? CorocColors.gold700 : Bank.tone(tone!);
    return BankCard(
      onTap: onTap,
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(color: accent.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(10)),
                child: Icon(icon, size: 19, color: accent),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(label, style: t.labelMedium, maxLines: 2, overflow: TextOverflow.ellipsis),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Text(
            value,
            style: t.headlineMedium?.copyWith(fontFamily: 'Inter', fontWeight: FontWeight.w600, fontSize: 26, color: tone == StatusTone.error ? Bank.negative : Bank.ink),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          if (caption != null) ...[const SizedBox(height: 4), Text(caption!, style: t.bodySmall, maxLines: 2, overflow: TextOverflow.ellipsis)],
        ],
      ),
    );
  }
}

/// Tarea que espera a la persona («Para enviar por WhatsApp · 4»), con su botón grande.
class ActionTile extends StatelessWidget {
  const ActionTile({super.key, required this.icon, required this.title, required this.message, required this.count, required this.action, required this.onAction, this.idle});
  final IconData icon;
  final String title;
  final String message;
  final int count;
  final String action;
  final VoidCallback onAction;

  /// Texto cuando no hay nada pendiente («Todo al día»).
  final String? idle;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final pending = count > 0;
    return BankCard(
      padding: const EdgeInsets.all(20),
      child: Row(
        children: [
          Stack(
            clipBehavior: Clip.none,
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(gradient: pending ? CorocColors.brandGradient : null, color: pending ? null : Bank.canvas, borderRadius: BorderRadius.circular(14)),
                child: Icon(icon, color: pending ? CorocColors.navy800 : Bank.muted),
              ),
              if (pending)
                Positioned(
                  right: -6,
                  top: -6,
                  child: Container(
                    constraints: const BoxConstraints(minWidth: 22),
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: CorocColors.navy800,
                      borderRadius: BorderRadius.circular(99),
                      border: Border.all(color: Colors.white, width: 2),
                    ),
                    child: Text(
                      '$count',
                      textAlign: TextAlign.center,
                      style: t.labelSmall?.copyWith(color: CorocColors.ivory, letterSpacing: 0),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: t.titleMedium),
                const SizedBox(height: 2),
                Text(pending ? message : (idle ?? message), style: t.bodyMedium?.copyWith(color: Bank.muted)),
              ],
            ),
          ),
          if (pending) ...[const SizedBox(width: 12), FilledButton(onPressed: onAction, child: Text(action))],
        ],
      ),
    );
  }
}

/// Aviso suave con ícono (ayudas cortas, sin alarmar).
class InfoNote extends StatelessWidget {
  const InfoNote(this.text, {super.key, this.icon = Icons.info_outline, this.tone = StatusTone.info, this.action});
  final String text;
  final IconData icon;
  final StatusTone tone;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final c = tone == StatusTone.neutral ? CorocColors.gold800 : Bank.tone(tone);
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: c.withValues(alpha: 0.07),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: c.withValues(alpha: 0.2)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 20, color: c),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(text, style: Theme.of(context).textTheme.bodyMedium),
                if (action != null) ...[const SizedBox(height: 8), action!],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Estado vacío con el ícono en un círculo dorado suave.
class BankEmpty extends StatelessWidget {
  const BankEmpty({super.key, required this.icon, required this.title, this.message, this.action});
  final IconData icon;
  final String title;
  final String? message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 36, horizontal: 24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 64,
            height: 64,
            decoration: BoxDecoration(shape: BoxShape.circle, color: CorocColors.gold500.withValues(alpha: 0.12)),
            child: Icon(icon, size: 30, color: CorocColors.gold700),
          ),
          const SizedBox(height: 16),
          Text(title, style: t.titleMedium, textAlign: TextAlign.center),
          if (message != null) ...[
            const SizedBox(height: 6),
            Text(
              message!,
              style: t.bodyMedium?.copyWith(color: Bank.muted),
              textAlign: TextAlign.center,
            ),
          ],
          if (action != null) ...[const SizedBox(height: 20), action!],
        ],
      ),
    );
  }
}

/// Página del nuevo COROC: título, subtítulo, acciones y el contenido centrado con un ancho cómodo de leer.
class BankPage extends StatelessWidget {
  const BankPage({super.key, required this.title, this.subtitle, this.actions = const [], required this.children, this.maxWidth = Bank.maxContent, this.leading});
  final String title;
  final String? subtitle;
  final List<Widget> actions;
  final List<Widget> children;
  final double maxWidth;
  final Widget? leading;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return LayoutBuilder(
      builder: (context, c) {
        final pad = c.maxWidth < 760 ? 20.0 : 36.0;
        return SingleChildScrollView(
          padding: EdgeInsets.fromLTRB(pad, 28, pad, 48),
          child: Center(
            child: ConstrainedBox(
              constraints: BoxConstraints(maxWidth: maxWidth),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Wrap(
                    spacing: 16,
                    runSpacing: 12,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    alignment: WrapAlignment.spaceBetween,
                    children: [
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          if (leading != null) ...[leading!, const SizedBox(width: 12)],
                          // El título y el subtítulo se parten en renglones dentro del ancho de la página.
                          Flexible(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(title, style: t.headlineLarge?.copyWith(fontSize: 30)),
                                if (subtitle != null) ...[const SizedBox(height: 4), Text(subtitle!, style: t.bodyLarge?.copyWith(color: Bank.muted))],
                              ],
                            ),
                          ),
                        ],
                      ),
                      if (actions.isNotEmpty) Wrap(spacing: 12, runSpacing: 8, children: actions),
                    ],
                  ),
                  const SizedBox(height: 28),
                  ...children,
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

/// Fila de un extracto: ícono del canal, quién y qué, y el valor con su hora.
class LedgerRow extends StatelessWidget {
  const LedgerRow({super.key, required this.icon, required this.title, required this.subtitle, required this.amount, required this.when, this.trailingNote, this.onTap, this.struck = false});
  final IconData icon;
  final String title;
  final String subtitle;
  final String amount;
  final String when;
  final Widget? trailingNote;
  final VoidCallback? onTap;

  /// Pago reversado: el valor tachado.
  final bool struck;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
        child: Row(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(color: Bank.canvas, borderRadius: BorderRadius.circular(12)),
              child: Icon(icon, size: 20, color: CorocColors.navy700),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: t.titleSmall, maxLines: 1, overflow: TextOverflow.ellipsis),
                  const SizedBox(height: 2),
                  Text(subtitle, style: t.bodySmall, maxLines: 1, overflow: TextOverflow.ellipsis),
                  if (trailingNote != null) ...[const SizedBox(height: 6), trailingNote!],
                ],
              ),
            ),
            const SizedBox(width: 12),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  amount,
                  style: t.titleSmall?.copyWith(
                    fontFamily: 'Inter',
                    color: struck ? Bank.muted : Bank.positive,
                    decoration: struck ? TextDecoration.lineThrough : null,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
                const SizedBox(height: 2),
                Text(when, style: t.bodySmall),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Barra de avance de un préstamo con el degradado de marca.
class LoanProgress extends StatelessWidget {
  const LoanProgress(this.value, {super.key, this.height = 8});
  final double value;
  final double height;

  @override
  Widget build(BuildContext context) {
    final v = value.clamp(0.0, 1.0);
    return ClipRRect(
      borderRadius: BorderRadius.circular(99),
      child: SizedBox(
        height: height,
        child: Stack(
          children: [
            const Positioned.fill(child: ColoredBox(color: Color(0xFFEFEBE1))),
            FractionallySizedBox(
              widthFactor: v,
              child: const DecoratedBox(decoration: BoxDecoration(gradient: CorocColors.brandGradient)),
            ),
          ],
        ),
      ),
    );
  }
}
