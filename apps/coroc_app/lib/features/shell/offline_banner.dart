import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/offline/offline_store.dart';
import '../../core/offline/offline_sync.dart';
import '../../design/tokens.dart';

/// Aviso de modo sin conexión (ADR-055): desde cuándo son los datos que se ven, cuántos pagos esperan la red y
/// cuáles quedaron en conflicto. Se anuncia a los lectores de pantalla como región viva.
class OfflineBanner extends ConsumerWidget {
  const OfflineBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final s = ref.watch(offlineProvider);
    if (s.online && s.pending.isEmpty) return const SizedBox.shrink();
    final scheme = Theme.of(context).colorScheme;
    final conflict = s.conflicts.isNotEmpty;
    final parts = [
      if (!s.online) s.savedAt == null ? l.offlineNoConnection : l.offlineShowingSaved(Dates.dateTime(s.savedAt!.toIso8601String(), context.lang)),
      if (s.waiting.isNotEmpty) l.offlinePending(s.waiting.length),
      if (conflict) l.offlineConflicts(s.conflicts.length),
    ];
    return Semantics(
      liveRegion: true,
      child: Material(
        color: conflict ? scheme.errorContainer : scheme.secondaryContainer,
        child: InkWell(
          onTap: s.pending.isEmpty ? null : () => showDialog<void>(context: context, builder: (_) => const PendingPaymentsDialog()),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 48),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: CorocSpace.lg, vertical: CorocSpace.sm),
              child: Row(
                children: [
                  Icon(s.online ? Icons.sync : Icons.cloud_off_outlined, color: conflict ? scheme.onErrorContainer : scheme.onSecondaryContainer),
                  const SizedBox(width: CorocSpace.md),
                  Expanded(
                    child: Text(parts.join(' · '), style: TextStyle(color: conflict ? scheme.onErrorContainer : scheme.onSecondaryContainer)),
                  ),
                  if (s.pending.isNotEmpty) Icon(Icons.chevron_right, color: conflict ? scheme.onErrorContainer : scheme.onSecondaryContainer),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class PendingPaymentsDialog extends ConsumerWidget {
  const PendingPaymentsDialog({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final s = ref.watch(offlineProvider);
    final ctrl = ref.read(offlineProvider.notifier);
    Widget tile(PendingPayment p) => ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Icon(p.inConflict ? Icons.error_outline : Icons.schedule),
      title: Text([p.clientName ?? l.offlinePaymentLabel, Money.format(p.amount, p.currency ?? 'COP')].join(' · ')),
      subtitle: Text(p.inConflict ? '${l.offlineConflictLabel}: ${p.conflictMessage ?? p.conflictCode}' : '${Dates.medium(p.date, context.lang)} · ${l.offlineWaiting}'),
      trailing: p.inConflict
          ? TextButton(
              style: TextButton.styleFrom(minimumSize: const Size(48, 48)),
              onPressed: () => ctrl.discard(p.key),
              child: Text(l.offlineDiscard),
            )
          : null,
    );
    return AlertDialog(
      title: Text(l.offlineQueueTitle),
      content: SizedBox(
        width: 480,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(l.offlineQueueHelp, style: Theme.of(context).textTheme.bodySmall),
              const SizedBox(height: CorocSpace.md),
              for (final p in s.conflicts) tile(p),
              for (final p in s.waiting) tile(p),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text(l.actionClose)),
        FilledButton.icon(onPressed: s.syncing || s.waiting.isEmpty ? null : () => unawaited(ctrl.flush()), icon: const Icon(Icons.sync), label: Text(l.offlineSyncNow)),
      ],
    );
  }
}
