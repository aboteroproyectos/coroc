import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/desktop/desktop_runtime.dart';
import '../../core/l10n.dart';
import '../../design/tokens.dart';
import '../../design/widgets/brand.dart';

/// Pantalla de carga de COROC Escritorio (ADR-062): azul noche, el logo y un paso a la vez en palabras sencillas. Si
/// algo falla, dice qué hacer y ofrece intentar de nuevo; el detalle técnico queda para soporte.
class DesktopSplash extends ConsumerWidget {
  const DesktopSplash({super.key});

  static String stepText(AppLocalizations l, String? step) => switch (step) {
    'base' => l.desktopStepDatabase,
    'migraciones' => l.desktopStepUpdates,
    'servidor' => l.desktopStepServer,
    _ => l.desktopStepKeys,
  };

  static String errorText(AppLocalizations l, String? code) => switch (code) {
    'SIN_SERVIDOR' => l.desktopErrorMissing,
    'BASE_NO_INICIA' => l.desktopErrorDatabase,
    'YA_INICIADO' => l.desktopErrorBusy,
    _ => l.desktopErrorGeneric,
  };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    final d = ref.watch(desktopProvider);
    final failed = d.phase == DesktopPhase.failed;
    final text = failed ? errorText(l, d.code) : (d.ready ? l.desktopStepSession : stepText(l, d.step));
    return Scaffold(
      backgroundColor: CorocColors.navy900,
      body: Theme(
        data: ThemeData.dark(),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 460),
            child: Padding(
              padding: const EdgeInsets.all(CorocSpace.xl),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const CorocLogo(height: 150),
                  const SizedBox(height: CorocSpace.xl),
                  if (!failed) ...[
                    ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: const LinearProgressIndicator(minHeight: 4, color: CorocColors.gold500, backgroundColor: CorocColors.navy700),
                    ),
                    const SizedBox(height: CorocSpace.lg),
                  ] else ...[
                    const Icon(Icons.info_outline, color: CorocColors.gold300, size: 40),
                    const SizedBox(height: CorocSpace.md),
                    Text(
                      l.desktopErrorTitle,
                      style: t.headlineSmall?.copyWith(color: CorocColors.ivory),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: CorocSpace.sm),
                  ],
                  Semantics(
                    liveRegion: true,
                    child: Text(
                      text,
                      style: t.titleMedium?.copyWith(color: CorocColors.ivory, height: 1.4),
                      textAlign: TextAlign.center,
                    ),
                  ),
                  if (failed) ...[
                    const SizedBox(height: CorocSpace.xl),
                    GoldButton(label: l.actionRetry, icon: Icons.refresh, onPressed: () => ref.read(desktopProvider.notifier).retry()),
                    const SizedBox(height: CorocSpace.sm),
                    TextButton(
                      onPressed: () async {
                        await Clipboard.setData(ClipboardData(text: '${d.code ?? ''} ${d.detail ?? ''}'.trim()));
                        if (context.mounted) ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(l.desktopErrorCopied)));
                      },
                      child: Text(l.desktopErrorCopy(d.code ?? '—'), style: const TextStyle(color: CorocColors.inkMutedDark)),
                    ),
                  ],
                  if (d.version != null && !failed) ...[const SizedBox(height: CorocSpace.lg), Text('COROC ${d.version}', style: t.bodySmall?.copyWith(color: CorocColors.inkMutedDark))],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
