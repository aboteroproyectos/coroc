import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../../design/tokens.dart';
import '../../design/widgets/common.dart';

final clientEmailsProvider = FutureProvider.autoDispose.family<List<EmailThreadItem>, String>((ref, id) => ref.watch(apiProvider).clientEmails(id));

/// El hilo de correo con el cliente en el Gmail de la empresa (ADR-065): lo que mandó (con sus comprobantes, que
/// llevan a la Bandeja) y lo que COROC le respondió.
class ClientEmails extends ConsumerWidget {
  const ClientEmails({super.key, required this.clientId});
  final String clientId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(l.clientEmailsTitle, style: t.titleMedium),
        const SizedBox(height: CorocSpace.sm),
        AsyncBody<List<EmailThreadItem>>(
          value: ref.watch(clientEmailsProvider(clientId)),
          onRetry: () => ref.invalidate(clientEmailsProvider(clientId)),
          builder: (items) => items.isEmpty
              ? EmptyState(icon: Icons.mail_outline, title: l.clientEmailsEmpty)
              : Card(
                  clipBehavior: Clip.antiAlias,
                  child: Column(
                    children: [
                      for (final (i, e) in items.indexed) ...[
                        if (i > 0) const Divider(height: 1),
                        ListTile(
                          leading: Icon(
                            e.direction == 'in' ? Icons.call_received : Icons.call_made,
                            semanticLabel: e.direction == 'in' ? l.clientEmailsReceived : l.clientEmailsSent,
                            color: e.direction == 'in' ? CorocColors.info : CorocColors.success,
                          ),
                          title: Text(e.subject ?? '—', maxLines: 1, overflow: TextOverflow.ellipsis),
                          subtitle: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              if (e.snippet != null) Text(e.snippet!, maxLines: 2, overflow: TextOverflow.ellipsis),
                              Text('${e.direction == 'in' ? l.clientEmailsReceived : l.clientEmailsSent} · ${Dates.dateTime(e.at, context.lang)}', style: t.bodySmall?.copyWith(color: muted)),
                              if (e.attachments.isNotEmpty)
                                Wrap(
                                  spacing: 6,
                                  children: [
                                    for (final a in e.attachments)
                                      ActionChip(
                                        avatar: const Icon(Icons.attach_file, size: 16),
                                        label: Text(a.name ?? l.clientEmailsAttachment),
                                        onPressed: a.intakeId == null ? null : () => context.go('/inbox?id=${a.intakeId}'),
                                        tooltip: a.intakeId == null ? null : l.clientEmailsOpenInbox,
                                      ),
                                  ],
                                ),
                            ],
                          ),
                          isThreeLine: true,
                        ),
                      ],
                    ],
                  ),
                ),
        ),
      ],
    );
  }
}
