import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/l10n.dart';
import '../core/providers.dart';
import '../design/tokens.dart';
import '../design/widgets/brand.dart';

/// Recorrido del nuevo COROC: la primera vez que se entra en este PC, cuatro tarjetas cortas con lo esencial. Se
/// muestra una sola vez y se puede saltar.
class PersonalTour extends ConsumerStatefulWidget {
  const PersonalTour({super.key, required this.child});
  final Widget child;
  @override
  ConsumerState<PersonalTour> createState() => _PersonalTourState();
}

class _PersonalTourState extends ConsumerState<PersonalTour> {
  @override
  void initState() {
    super.initState();
    unawaited(_maybeShow());
  }

  Future<void> _maybeShow() async {
    final store = ref.read(sessionStoreProvider);
    if (await store.tourDone() || !mounted) return;
    await store.saveTourDone();
    if (mounted) await showDialog<void>(context: context, barrierDismissible: false, builder: (_) => const PersonalTourDialog());
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

class PersonalTourDialog extends StatefulWidget {
  const PersonalTourDialog({super.key});
  @override
  State<PersonalTourDialog> createState() => _PersonalTourDialogState();
}

class _PersonalTourDialogState extends State<PersonalTourDialog> {
  int _page = 0;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    final pages = [
      (Icons.account_balance_outlined, l.pTourHomeTitle, l.pTourHomeBody),
      (Icons.add_card_outlined, l.pTourLoanTitle, l.pTourLoanBody),
      (Icons.mark_email_read_outlined, l.pTourAutoTitle, l.pTourAutoBody),
      (Icons.verified_user_outlined, l.tourBackupTitle, l.tourBackupBody),
    ];
    final (icon, title, body) = pages[_page];
    final last = _page == pages.length - 1;
    return AlertDialog(
      content: SizedBox(
        width: 480,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 84,
              height: 84,
              decoration: const BoxDecoration(
                shape: BoxShape.circle,
                gradient: LinearGradient(colors: [Color(0xFF221B63), CorocColors.navy900]),
              ),
              child: Icon(icon, size: 38, color: CorocColors.gold300),
            ),
            const SizedBox(height: CorocSpace.lg),
            Text(title, style: t.headlineSmall, textAlign: TextAlign.center),
            const SizedBox(height: CorocSpace.md),
            Text(body, style: t.bodyLarge?.copyWith(height: 1.55), textAlign: TextAlign.center),
            const SizedBox(height: CorocSpace.lg),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                for (var i = 0; i < pages.length; i++)
                  AnimatedContainer(
                    duration: CorocMotion.fast,
                    width: i == _page ? 24 : 8,
                    height: 8,
                    margin: const EdgeInsets.symmetric(horizontal: 3),
                    decoration: BoxDecoration(color: i == _page ? CorocColors.gold500 : const Color(0xFFE8E3D6), borderRadius: BorderRadius.circular(4)),
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
