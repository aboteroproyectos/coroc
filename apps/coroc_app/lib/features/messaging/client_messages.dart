import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/common.dart';
import '../loans/loan_providers.dart';
import 'messaging_common.dart';

/// Mensajes de la ficha del cliente (§5.7-7): historial con el estado de cada mensaje, envío manual sujeto a las reglas
/// de contacto y la excepción horaria autorizada por el deudor.
class ClientMessagesTab extends ConsumerWidget {
  const ClientMessagesTab({super.key, required this.client, required this.loan});
  final Client client;
  final Loan loan;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final auth = ref.watch(authProvider);
    final user = auth is SignedIn ? auth.user : null;
    final query = (statuses: '', clientId: client.id);
    final page = ref.watch(messagesProvider(query));
    final pad = MediaQuery.sizeOf(context).width < CorocBreakpoints.tablet ? CorocSpace.md : CorocSpace.xl;
    return ListView(
      padding: EdgeInsets.fromLTRB(pad, CorocSpace.md, pad, CorocSpace.xxl),
      children: [
        if (client.emailStatus != null) ...[
          Card(
            color: Theme.of(context).colorScheme.errorContainer,
            child: ListTile(
              leading: Icon(Icons.mark_email_unread_outlined, color: Theme.of(context).colorScheme.onErrorContainer),
              title: Text(client.emailStatus == 'complained' ? l.emailComplained : l.emailBounced, style: TextStyle(color: Theme.of(context).colorScheme.onErrorContainer)),
            ),
          ),
          const SizedBox(height: CorocSpace.md),
        ],
        if (user?.can('messages.send') ?? false) ...[_Compose(client: client, loan: loan), const SizedBox(height: CorocSpace.md)],
        if (user?.can('compliance.view') ?? false) ...[_ContactException(client: client, canEdit: user!.can('compliance.manage')), const SizedBox(height: CorocSpace.md)],
        Text(l.clientMessagesHistory, style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: CorocSpace.sm),
        AsyncBody<MessagePage>(
          value: page,
          onRetry: () => ref.invalidate(messagesProvider(query)),
          builder: (p) => p.items.isEmpty
              ? EmptyState(icon: Icons.forum_outlined, title: l.messagesEmpty)
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [for (final m in p.items) MessageTile(key: ValueKey(m.id), message: m, showClient: false)],
                ),
        ),
      ],
    );
  }
}

class _Compose extends ConsumerStatefulWidget {
  const _Compose({required this.client, required this.loan});
  final Client client;
  final Loan loan;
  @override
  ConsumerState<_Compose> createState() => _ComposeState();
}

class _ComposeState extends ConsumerState<_Compose> {
  String _event = 'reminder';
  String _channel = 'whatsapp';
  final _text = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    setState(() => _busy = true);
    final l = context.l10n;
    try {
      final m = await ref
          .read(apiProvider)
          .composeMessage(loanId: widget.loan.id, event: _event, channel: _channel, body: _event == 'manual' && _text.text.trim().isNotEmpty ? _text.text.trim() : null);
      ref.invalidate(messagesProvider);
      ref.invalidate(messagesSummaryProvider);
      _text.clear();
      if (!mounted) return;
      final status = messageStatusLabel(l, m.status).$1;
      final why = m.decision.reasons.isEmpty ? '' : ' · ${decisionText(l, m.decision, context.lang)}';
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$status$why'), duration: const Duration(seconds: 6)));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(context, e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return SectionCard(
      title: l.composeTitle,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(l.composeHelp, style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: CorocSpace.md),
          Wrap(
            spacing: CorocSpace.md,
            runSpacing: CorocSpace.sm,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              DropdownMenu<String>(
                initialSelection: _event,
                label: Text(l.composeEvent),
                onSelected: (v) => setState(() => _event = v ?? _event),
                dropdownMenuEntries: [
                  for (final e in const ['reminder', 'overdue', 'statement', 'welcome', 'manual']) DropdownMenuEntry(value: e, label: eventLabel(l, e)),
                ],
              ),
              SegmentedButton<String>(
                showSelectedIcon: false,
                segments: [
                  ButtonSegment(value: 'whatsapp', label: Text(l.channelWhatsapp), icon: const Icon(Icons.chat_outlined)),
                  ButtonSegment(value: 'email', label: Text(l.channelEmail), icon: const Icon(Icons.mail_outline), enabled: widget.client.email != null),
                ],
                selected: {_channel},
                onSelectionChanged: (s) => setState(() => _channel = s.first),
              ),
            ],
          ),
          if (_event == 'manual') ...[
            const SizedBox(height: CorocSpace.md),
            TextField(
              controller: _text,
              minLines: 2,
              maxLines: 6,
              maxLength: 1024,
              decoration: corocInput(context, label: l.composeText, helper: l.composeTextHelp('{{nombre}}', '{{saldo}}')),
            ),
          ],
          const SizedBox(height: CorocSpace.sm),
          Align(
            alignment: Alignment.centerLeft,
            child: FilledButton.icon(onPressed: _busy ? null : _send, icon: const Icon(Icons.outbox_outlined), label: Text(l.composeQueue)),
          ),
        ],
      ),
    );
  }
}

/// Excepción horaria (§11.4): el deudor autorizó otros horarios por escrito, en un documento distinto y posterior al contrato.
class _ContactException extends ConsumerWidget {
  const _ContactException({required this.client, required this.canEdit});
  final Client client;
  final bool canEdit;

  String _windows(AppLocalizations l, List<ContactWindow> ws) => ws.map((w) => '${weekdayName(l, w.day)} ${w.start}–${w.end}').join(' · ');

  Future<void> _edit(BuildContext context, WidgetRef ref) async {
    final l = context.l10n;
    final docs = (await ref.read(apiProvider).documents(clientId: client.id, kind: 'other')).items;
    if (!context.mounted) return;
    if (docs.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l.exceptionNeedsDocument)));
      return;
    }
    final r = await showDialog<({List<ContactWindow> windows, String documentId})>(
      context: context,
      builder: (_) => _ExceptionDialog(docs: docs),
    );
    if (r == null) return;
    try {
      await ref.read(apiProvider).setContactException(client.id, r.windows, r.documentId);
      ref.invalidate(clientProvider(client.id));
    } catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(context, e))));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final ex = client.contactException;
    return SectionCard(
      title: l.exceptionTitle,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(l.exceptionHelp, style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 8),
          if (ex == null) Text(l.exceptionNone) else KeyValue(l.exceptionWindows, _windows(l, ex.windows)),
          if (ex?.grantedAt != null) KeyValue(l.exceptionGranted, Dates.medium(ex!.grantedAt!, context.lang)),
          if (canEdit)
            Wrap(
              spacing: 8,
              children: [
                OutlinedButton(onPressed: () => _edit(context, ref), child: Text(ex == null ? l.exceptionAdd : l.actionEdit)),
                if (ex != null)
                  TextButton(
                    onPressed: () async {
                      try {
                        await ref.read(apiProvider).removeContactException(client.id);
                        ref.invalidate(clientProvider(client.id));
                      } catch (e) {
                        if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(context, e))));
                      }
                    },
                    child: Text(l.actionDelete),
                  ),
              ],
            ),
        ],
      ),
    );
  }
}

class _ExceptionDialog extends StatefulWidget {
  const _ExceptionDialog({required this.docs});
  final List<CorocDocument> docs;
  @override
  State<_ExceptionDialog> createState() => _ExceptionDialogState();
}

class _ExceptionDialogState extends State<_ExceptionDialog> {
  final Set<int> _days = {7};
  TimeOfDay _start = const TimeOfDay(hour: 9, minute: 0);
  TimeOfDay _end = const TimeOfDay(hour: 12, minute: 0);
  late String _doc = widget.docs.first.id;

  String _fmt(TimeOfDay t) => '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final valid = _days.isNotEmpty && _fmt(_start).compareTo(_fmt(_end)) < 0;
    Future<void> pick(bool start) async {
      final t = await showTimePicker(context: context, initialTime: start ? _start : _end);
      if (t != null) setState(() => start ? _start = t : _end = t);
    }

    return AlertDialog(
      title: Text(l.exceptionTitle),
      content: SizedBox(
        width: 460,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(l.exceptionDays, style: Theme.of(context).textTheme.labelLarge),
            const SizedBox(height: 6),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [for (var d = 1; d <= 7; d++) FilterChip(label: Text(weekdayName(l, d)), selected: _days.contains(d), onSelected: (v) => setState(() => v ? _days.add(d) : _days.remove(d)))],
            ),
            const SizedBox(height: CorocSpace.md),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(onPressed: () => pick(true), child: Text('${l.exceptionFrom} ${_fmt(_start)}')),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton(onPressed: () => pick(false), child: Text('${l.exceptionTo} ${_fmt(_end)}')),
                ),
              ],
            ),
            const SizedBox(height: CorocSpace.md),
            DropdownMenu<String>(
              initialSelection: _doc,
              expandedInsets: EdgeInsets.zero,
              label: Text(l.exceptionEvidence),
              helperText: l.exceptionEvidenceHelp,
              onSelected: (v) => setState(() => _doc = v ?? _doc),
              dropdownMenuEntries: [for (final d in widget.docs) DropdownMenuEntry(value: d.id, label: d.name)],
            ),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text(l.actionCancel)),
        FilledButton(
          onPressed: valid ? () => Navigator.pop(context, (windows: [for (final d in (_days.toList()..sort())) ContactWindow(day: d, start: _fmt(_start), end: _fmt(_end))], documentId: _doc)) : null,
          child: Text(l.actionSave),
        ),
      ],
    );
  }
}
