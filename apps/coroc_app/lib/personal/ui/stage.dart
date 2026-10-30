import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../core/l10n.dart';
import '../../design/tokens.dart';
import '../../design/widgets/brand.dart';
import '../../features/auth/login_page.dart' show LanguageSelector;
import 'bank.dart';

/// Escenario de las pantallas de entrada del nuevo COROC: a la izquierda la marca en azul noche con tres promesas
/// cortas; a la derecha, sobre marfil, una sola tarea a la vez. En una ventana angosta queda solo la tarea.
class AuthStage extends StatelessWidget {
  const AuthStage({super.key, required this.child, this.maxWidth = 520});
  final Widget child;
  final double maxWidth;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Bank.canvas,
      body: LayoutBuilder(
        builder: (context, c) {
          final wide = c.maxWidth >= 980;
          final task = SafeArea(
            child: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(24, 20, 24, 0),
                  child: Row(
                    children: [
                      if (!wide) const CorocLogo(layout: LogoLayout.horizontal, height: 34),
                      const Spacer(),
                      const LanguageSelector(),
                    ],
                  ),
                ),
                Expanded(
                  child: Center(
                    child: SingleChildScrollView(
                      padding: const EdgeInsets.fromLTRB(24, 24, 24, 40),
                      child: ConstrainedBox(
                        constraints: BoxConstraints(maxWidth: maxWidth),
                        child: child,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          );
          if (!wide) return task;
          return Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SizedBox(width: math.min(500, c.maxWidth * 0.38), child: const _Brand()),
              Expanded(child: task),
            ],
          );
        },
      ),
    );
  }
}

/// La marca: el logo, una frase y lo que COROC hace por la persona.
class _Brand extends StatelessWidget {
  const _Brand();

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    const ivory = CorocColors.ivory;
    return DecoratedBox(
      decoration: const BoxDecoration(gradient: Bank.night),
      child: CustomPaint(
        painter: GoldArcs(),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(48, 52, 48, 36),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Theme(
                data: ThemeData(brightness: Brightness.dark),
                child: const CorocLogo(layout: LogoLayout.horizontal, height: 44),
              ),
              const Spacer(),
              Text(l.pStageTitle, style: t.displaySmall?.copyWith(color: ivory, height: 1.15)),
              const SizedBox(height: 14),
              Text(l.pStageBody, style: t.bodyLarge?.copyWith(color: ivory.withValues(alpha: 0.78), height: 1.5)),
              const SizedBox(height: 32),
              _Promise(icon: Icons.edit_note, text: l.pStagePromiseLoans),
              _Promise(icon: Icons.mark_email_read_outlined, text: l.pStagePromiseEmail),
              _Promise(icon: Icons.chat_outlined, text: l.pStagePromiseWhatsapp),
              const Spacer(),
              Text(l.pStageFoot, style: t.bodySmall?.copyWith(color: ivory.withValues(alpha: 0.55))),
            ],
          ),
        ),
      ),
    );
  }
}

class _Promise extends StatelessWidget {
  const _Promise({required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(color: CorocColors.gold500.withValues(alpha: 0.5)),
            ),
            child: Icon(icon, size: 18, color: CorocColors.gold300),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(top: 7),
              child: Text(text, style: Theme.of(context).textTheme.bodyLarge?.copyWith(color: CorocColors.ivory)),
            ),
          ),
        ],
      ),
    );
  }
}

/// «Paso 2 de 4» con sus barras doradas.
class StepBar extends StatelessWidget {
  const StepBar({super.key, required this.step, required this.total});
  final int step;
  final int total;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(context.l10n.welcomeStepOf(step + 1, total), style: Theme.of(context).textTheme.labelLarge?.copyWith(color: CorocColors.gold800)),
        const SizedBox(height: 8),
        Row(
          children: [
            for (var i = 0; i < total; i++)
              Expanded(
                child: AnimatedContainer(
                  duration: CorocMotion.normal,
                  height: 5,
                  margin: EdgeInsets.only(right: i == total - 1 ? 0 : 6),
                  decoration: BoxDecoration(color: i <= step ? CorocColors.gold500 : Bank.line, borderRadius: BorderRadius.circular(3)),
                ),
              ),
          ],
        ),
      ],
    );
  }
}
