import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/l10n.dart';
import '../../core/models/models.dart';
import '../../design/tokens.dart';
import '../../design/widgets/common.dart';
import '../settings/intake_sections.dart' show whatsAppAccountProvider;
import '../shell/app_shell.dart';
import 'messaging_common.dart';

enum MessagesTab { ready, scheduled, blocked, history }

String _statuses(MessagesTab t) => switch (t) {
      MessagesTab.ready => 'ready',
      MessagesTab.scheduled => 'scheduled',
      MessagesTab.blocked => 'blocked',
      MessagesTab.history => 'sent,delivered,read,failed,cancelled',
    };

/// Mensajería (§11, pantalla 9): «Por enviar hoy» del modo asistido, programados, bloqueados con la regla aplicada e
/// historial con los estados de entrega.
class MessagesPage extends ConsumerStatefulWidget {
  const MessagesPage({super.key});
  @override
  ConsumerState<MessagesPage> createState() => _MessagesPageState();
}

class _MessagesPageState extends ConsumerState<MessagesPage> {
  MessagesTab _tab = MessagesTab.ready;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final auth = ref.watch(authProvider);
    if (auth is! SignedIn || !auth.user.can('messages.view')) return const NoPermission();
    final summary = ref.watch(messagesSummaryProvider).valueOrNull ?? const MessagesSummary();
    final account = auth.user.can('company.view') ? ref.watch(whatsAppAccountProvider).valueOrNull : null;
    final query = (statuses: _statuses(_tab), clientId: null);
    final page = ref.watch(messagesProvider(query));
    Future<void> refresh() async {
      ref.invalidate(messagesSummaryProvider);
      ref.invalidate(messagesProvider(query));
    }

    return PageScaffold(
        maxWidth: 1000,
        onRefresh: refresh,
        children: [
          PageHeader(
            title: l.navMessages,
            subtitle: l.messagesSubtitle,
            actions: [OutlinedButton.icon(onPressed: () => context.go('/messages/templates'), icon: const Icon(Icons.edit_note), label: Text(l.templatesTitle))],
          ),
          if (account != null && account.suspended) ...[
            _Banner(icon: Icons.warning_amber_rounded, text: l.whatsappSuspendedBanner, tone: StatusTone.error),
            const SizedBox(height: CorocSpace.md),
          ] else if (account != null && !account.cloud) ...[
            _Banner(icon: Icons.touch_app_outlined, text: l.messagesAssistedHelp, tone: StatusTone.info),
            const SizedBox(height: CorocSpace.md),
          ],
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: SegmentedButton<MessagesTab>(
              showSelectedIcon: false,
              segments: [
                ButtonSegment(value: MessagesTab.ready, label: Text('${l.messagesTabReady} (${summary.ready})'), icon: const Icon(Icons.outbox_outlined)),
                ButtonSegment(value: MessagesTab.scheduled, label: Text('${l.messagesTabScheduled} (${summary.scheduled})'), icon: const Icon(Icons.schedule)),
                ButtonSegment(value: MessagesTab.blocked, label: Text('${l.messagesTabBlocked} (${summary.blocked})'), icon: const Icon(Icons.block)),
                ButtonSegment(value: MessagesTab.history, label: Text(l.messagesTabHistory), icon: const Icon(Icons.history)),
              ],
              selected: {_tab},
              onSelectionChanged: (s) => setState(() => _tab = s.first),
            ),
          ),
          const SizedBox(height: CorocSpace.md),
          AsyncBody<MessagePage>(
            value: page,
            onRetry: refresh,
            builder: (p) => p.items.isEmpty
                ? EmptyState(
                    icon: _tab == MessagesTab.ready ? Icons.mark_email_read_outlined : Icons.forum_outlined,
                    title: _tab == MessagesTab.ready ? l.messagesEmptyReady : l.messagesEmpty,
                    message: _tab == MessagesTab.ready ? l.messagesEmptyReadyHelp : null,
                  )
                : Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [for (final m in p.items) MessageTile(key: ValueKey(m.id), message: m)]),
          ),
        ],
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.icon, required this.text, required this.tone});
  final IconData icon;
  final String text;
  final StatusTone tone;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final bg = tone == StatusTone.error ? s.errorContainer : s.secondaryContainer;
    final fg = tone == StatusTone.error ? s.onErrorContainer : s.onSecondaryContainer;
    return Semantics(
      liveRegion: tone == StatusTone.error,
      child: Container(
        padding: const EdgeInsets.all(CorocSpace.md),
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(CorocRadii.card)),
        child: Row(children: [Icon(icon, color: fg), const SizedBox(width: 12), Expanded(child: Text(text, style: TextStyle(color: fg)))]),
      ),
    );
  }
}
