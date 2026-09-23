import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../tokens.dart';

enum LogoLayout { vertical, horizontal, isotype }

/// Logo oficial vectorizado (§5.1): nunca se redibuja. En modo oscuro usa la variante con la palabra en marfil.
class CorocLogo extends StatelessWidget {
  const CorocLogo({super.key, this.layout = LogoLayout.vertical, this.height = 120});
  final LogoLayout layout;
  final double height;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final file = switch (layout) {
      LogoLayout.isotype => 'coroc-isotipo.svg',
      LogoLayout.horizontal => dark ? 'coroc-logo-horizontal-dark.svg' : 'coroc-logo-horizontal.svg',
      LogoLayout.vertical => dark ? 'coroc-logo-vertical-dark.svg' : 'coroc-logo-vertical.svg',
    };
    return SvgPicture.asset('assets/brand/$file', height: height, semanticsLabel: 'COROC Personal Loans');
  }
}

/// Botón primario con el degradado de marca y texto azul noche (§5.2).
class GoldButton extends StatelessWidget {
  const GoldButton({super.key, required this.label, required this.onPressed, this.icon, this.busy = false, this.expand = false});
  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool busy;
  final bool expand;

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null && !busy;
    final text = Theme.of(context).textTheme.labelLarge?.copyWith(color: CorocColors.navy800);
    final child = Row(
      mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        if (busy)
          const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: CorocColors.navy800))
        else if (icon != null)
          Icon(icon, size: 20, color: CorocColors.navy800),
        if (busy || icon != null) const SizedBox(width: 10),
        Flexible(child: Text(label, style: text, overflow: TextOverflow.ellipsis)),
      ],
    );
    return Semantics(
      button: true,
      enabled: enabled,
      label: label,
      child: Opacity(
        opacity: enabled ? 1 : 0.55,
        child: Material(
          color: Colors.transparent,
          child: Ink(
            decoration: BoxDecoration(gradient: CorocColors.brandGradient, borderRadius: BorderRadius.circular(CorocRadii.control)),
            child: InkWell(
              borderRadius: BorderRadius.circular(CorocRadii.control),
              onTap: enabled ? onPressed : null,
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 48, minWidth: 44),
                child: Padding(padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12), child: child),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Etiqueta en mayúsculas con tracking amplio, como «PERSONAL LOANS».
class Overline extends StatelessWidget {
  const Overline(this.text, {super.key, this.color});
  final String text;
  final Color? color;
  @override
  Widget build(BuildContext context) => Text(text.toUpperCase(), style: Theme.of(context).textTheme.labelMedium?.copyWith(color: color));
}
