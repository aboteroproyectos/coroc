import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/desktop/desktop_runtime.dart';
import '../../core/l10n.dart';
import '../../core/providers.dart';
import '../../design/tokens.dart';
import '../../design/widgets/brand.dart';

/// Recorrido guiado de COROC Escritorio: la primera vez que se entra en este PC, cuatro tarjetas cortas con lo que
/// más se usa. Se muestra una sola vez.
class GuidedTour extends ConsumerStatefulWidget {
  const GuidedTour({super.key, required this.child});
  final Widget child;
  @override
  ConsumerState<GuidedTour> createState() => _GuidedTourState();
}

class _GuidedTourState extends ConsumerState<GuidedTour> {
  @override
  void initState() {
    super.initState();
    if (ref.read(desktopModeProvider)) unawaited(_maybeShow());
  }

  Future<void> _maybeShow() async {
    final store = ref.read(sessionStoreProvider);
    if (await store.tourDone() || !mounted) return;
    await store.saveTourDone();
    if (mounted) await showDialog<void>(context: context, barrierDismissible: false, builder: (_) => const TourDialog());
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

class TourDialog extends StatefulWidget {
  const TourDialog({super.key});
  @override
  State<TourDialog> createState() => _TourDialogState();
}

class _TourDialogState extends State<TourDialog> {
  int _page = 0;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    final pages = [
      (Icons.space_dashboard_outlined, l.tourDashboardTitle, l.tourDashboardBody),
      (Icons.outbox_outlined, l.tourMessagesTitle, l.tourMessagesBody),
      (Icons.file_download_outlined, l.tourReceiptsTitle, l.tourReceiptsBody),
      (Icons.backup_outlined, l.tourBackupTitle, l.tourBackupBody),
    ];
    final (icon, title, body) = pages[_page];
    final last = _page == pages.length - 1;
    return AlertDialog(
      content: SizedBox(
        width: 460,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircleAvatar(
              radius: 40,
              backgroundColor: CorocColors.navy800,
              child: Icon(icon, size: 40, color: CorocColors.gold300),
            ),
            const SizedBox(height: CorocSpace.lg),
            Text(title, style: t.headlineSmall, textAlign: TextAlign.center),
            const SizedBox(height: CorocSpace.md),
            Text(body, style: t.bodyLarge?.copyWith(height: 1.5), textAlign: TextAlign.center),
            const SizedBox(height: CorocSpace.lg),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                for (var i = 0; i < pages.length; i++)
                  Container(
                    width: i == _page ? 22 : 8,
                    height: 8,
                    margin: const EdgeInsets.symmetric(horizontal: 3),
                    decoration: BoxDecoration(color: i == _page ? CorocColors.gold500 : Theme.of(context).colorScheme.outlineVariant, borderRadius: BorderRadius.circular(4)),
                  ),
              ],
            ),
          ],
        ),
      ),
      actions: [
        if (!last) TextButton(onPressed: () => Navigator.pop(context), child: Text(l.tourSkip)),
        GoldButton(label: last ? l.tourDone : l.actionContinue, onPressed: () => last ? Navigator.pop(context) : setState(() => _page++)),
      ],
    );
  }
}
