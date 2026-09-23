import 'dart:io';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_client.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../../design/tokens.dart';
import '../../design/widgets/common.dart';
import '../dashboard/dashboard_page.dart' show eventsProvider;
import '../shell/app_shell.dart';
import 'intake_detail.dart';

enum InboxFilter { pending, unassigned, auto, all }

List<String> _statuses(InboxFilter f) => switch (f) {
      InboxFilter.pending => const ['review', 'unassigned', 'processing'],
      InboxFilter.unassigned => const ['unassigned'],
      InboxFilter.auto => const ['applied_auto'],
      InboxFilter.all => const [],
    };

/// Contador de la navegación (§13.6): lo que espera revisión.
final intakeSummaryProvider = FutureProvider.autoDispose<IntakeSummary>((ref) async {
  final auth = ref.watch(authProvider);
  if (auth is! SignedIn || !auth.user.can('intake.view')) return const IntakeSummary();
  return ref.watch(apiProvider).intakeSummary();
});

final inboxProvider = FutureProvider.autoDispose.family<IntakePage, InboxFilter>((ref, f) => ref.watch(apiProvider).intake(status: _statuses(f), limit: 100));

/// Mantiene la Bandeja al día con el evento `intake.updated` (llega un comprobante o cambia de estado).
class InboxRealtime extends ConsumerWidget {
  const InboxRealtime({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.listen<AsyncValue<ServerEvent>>(eventsProvider, (_, next) {
      final e = next.valueOrNull;
      if (e == null || (e.type != 'intake.updated' && e.type != 'payment.reversed')) return;
      ref.invalidate(intakeSummaryProvider);
      ref.invalidate(inboxProvider);
      final id = e.data['intakeId'] as String?;
      if (id != null) ref.invalidate(intakeItemProvider(id));
    });
    return child;
  }
}

/// Etiqueta y tono de cada estado de un comprobante.
(String, StatusTone) intakeStatusLabel(AppLocalizations l, String status) => switch (status) {
      'processing' => (l.intakeStatusProcessing, StatusTone.info),
      'review' => (l.intakeStatusReview, StatusTone.warn),
      'unassigned' => (l.intakeStatusUnassigned, StatusTone.warn),
      'applied_auto' => (l.intakeStatusAuto, StatusTone.ok),
      'approved' => (l.intakeStatusApproved, StatusTone.ok),
      'duplicate' => (l.intakeStatusDuplicate, StatusTone.neutral),
      'rejected' => (l.intakeStatusRejected, StatusTone.error),
      'archived' => (l.intakeStatusArchived, StatusTone.neutral),
      _ => (l.intakeStatusFailed, StatusTone.error),
    };

(String, IconData) channelLabel(AppLocalizations l, String channel) => switch (channel) {
      'whatsapp' => (l.channelWhatsapp, Icons.chat_outlined),
      'email' => (l.channelEmail, Icons.mail_outline),
      'upload_link' => (l.channelUploadLink, Icons.link),
      'share' => (l.channelShare, Icons.ios_share),
      'folder' => (l.channelFolder, Icons.folder_outlined),
      _ => (l.channelUpload, Icons.upload_file),
    };

/// Sube un comprobante desde la app (§12.6). Devuelve el elemento creado, o null si el usuario canceló.
Future<IntakeItem?> pickAndUploadReceipt(BuildContext context, WidgetRef ref, {String? clientId, String? loanId}) async {
  final l = context.l10n;
  final f = await openFile(acceptedTypeGroups: [XTypeGroup(label: l.inboxUpload, extensions: const ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic'], mimeTypes: const ['application/pdf', 'image/*'], uniformTypeIdentifiers: const ['com.adobe.pdf', 'public.image'])]);
  if (f == null) return null;
  final file = File(f.path);
  final length = await file.length();
  final item = await ref.read(apiProvider).uploadIntake(open: file.openRead, length: length, channel: 'upload', clientId: clientId, loanId: loanId, fileName: f.name);
  ref.invalidate(inboxProvider);
  ref.invalidate(intakeSummaryProvider);
  return item;
}

/// Bandeja de validación (§13.6): lista con filtros y, en pantallas anchas, el detalle al lado.
class InboxPage extends ConsumerStatefulWidget {
  const InboxPage({super.key, this.focusId});
  final String? focusId;
  @override
  ConsumerState<InboxPage> createState() => _InboxPageState();
}

class _InboxPageState extends ConsumerState<InboxPage> {
  InboxFilter _filter = InboxFilter.pending;
  late String? _selected = widget.focusId;
  final Set<String> _batch = {};
  bool _busy = false;

  @override
  void didUpdateWidget(InboxPage old) {
    super.didUpdateWidget(old);
    if (widget.focusId != null && widget.focusId != old.focusId) setState(() => _selected = widget.focusId);
  }

  void _open(BuildContext context, String id, bool wide) {
    if (wide) {
      setState(() => _selected = id);
    } else {
      Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => IntakeDetailPage(intakeId: id)));
    }
  }

  Future<void> _approveBatch() async {
    final l = context.l10n;
    setState(() => _busy = true);
    try {
      final r = await ref.read(apiProvider).approveIntakeBatch(_batch.toList());
      _batch.clear();
      ref.invalidate(inboxProvider);
      ref.invalidate(intakeSummaryProvider);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l.inboxBatchResult(r.approved.length, r.skipped.length))));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(context, e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _upload() async {
    try {
      final item = await pickAndUploadReceipt(context, ref);
      if (item != null && mounted) {
        setState(() => _selected = item.id);
        if (MediaQuery.sizeOf(context).width < CorocBreakpoints.desktop) _open(context, item.id, false);
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(context, e))));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final auth = ref.watch(authProvider);
    if (auth is! SignedIn || !auth.user.can('intake.view')) return const NoPermission();
    final canUpload = auth.user.can('documents.upload');
    final canApprove = auth.user.can('payments.register');
    final summary = ref.watch(intakeSummaryProvider).valueOrNull;
    final page = ref.watch(inboxProvider(_filter));
    final wide = MediaQuery.sizeOf(context).width >= CorocBreakpoints.desktop;

    final header = PageHeader(
      title: l.navInbox,
      subtitle: l.inboxSubtitle,
      actions: [
        if (canApprove && _batch.isNotEmpty) FilledButton.icon(onPressed: _busy ? null : _approveBatch, icon: const Icon(Icons.done_all), label: Text(l.inboxApproveSelected(_batch.length))),
        if (canUpload) OutlinedButton.icon(onPressed: _upload, icon: const Icon(Icons.upload_file), label: Text(l.inboxUpload)),
      ],
    );
    final filters = SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: SegmentedButton<InboxFilter>(
        segments: [
          ButtonSegment(value: InboxFilter.pending, label: Text(summary == null || summary.pending == 0 ? l.inboxFilterPending : '${l.inboxFilterPending} · ${summary.pending}')),
          ButtonSegment(value: InboxFilter.unassigned, label: Text(l.inboxFilterUnassigned)),
          ButtonSegment(value: InboxFilter.auto, label: Text(l.inboxFilterAuto)),
          ButtonSegment(value: InboxFilter.all, label: Text(l.inboxFilterAll)),
        ],
        selected: {_filter},
        showSelectedIcon: false,
        onSelectionChanged: (s) => setState(() {
          _filter = s.first;
          _batch.clear();
        }),
      ),
    );
    final list = AsyncBody<IntakePage>(
      value: page,
      onRetry: () => ref.invalidate(inboxProvider(_filter)),
      builder: (p) => p.items.isEmpty
          ? EmptyState(icon: Icons.inbox_outlined, title: l.inboxEmpty, message: l.inboxEmptyHelp)
          : Card(
              clipBehavior: Clip.antiAlias,
              child: Column(children: [
                for (final it in p.items)
                  IntakeTile(
                    item: it,
                    selected: wide && it.id == _selected,
                    checked: _batch.contains(it.id),
                    onCheck: canApprove && it.status == 'review' && !it.hasBlocking ? (v) => setState(() => v ? _batch.add(it.id) : _batch.remove(it.id)) : null,
                    onTap: () => _open(context, it.id, wide),
                  ),
              ]),
            ),
    );

    if (!wide) {
      return PageScaffold(onRefresh: () async => ref.invalidate(inboxProvider(_filter)), children: [header, filters, const SizedBox(height: CorocSpace.md), list]);
    }
    return Padding(
      padding: const EdgeInsets.all(CorocSpace.xl),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        header,
        filters,
        const SizedBox(height: CorocSpace.md),
        Expanded(
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SizedBox(width: 400, child: SingleChildScrollView(child: list)),
            const SizedBox(width: CorocSpace.lg),
            Expanded(
              child: _selected == null
                  ? EmptyState(icon: Icons.receipt_long_outlined, title: l.inboxSelect, message: l.inboxSelectHelp)
                  : IntakeDetailView(key: ValueKey(_selected), intakeId: _selected!, onDone: () => setState(() => _selected = null)),
            ),
          ]),
        ),
      ]),
    );
  }
}

class IntakeTile extends StatelessWidget {
  const IntakeTile({super.key, required this.item, required this.onTap, this.selected = false, this.checked = false, this.onCheck});
  final IntakeItem item;
  final VoidCallback onTap;
  final bool selected;
  final bool checked;
  final ValueChanged<bool>? onCheck;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    final (status, tone) = intakeStatusLabel(l, item.status);
    final (channel, icon) = channelLabel(l, item.channel);
    final amount = item.amount;
    final blocking = item.flags.where((f) => f.blocking).toList();
    return ListTile(
      selected: selected,
      onTap: onTap,
      leading: onCheck != null ? Checkbox(value: checked, onChanged: (v) => onCheck!(v ?? false)) : Icon(icon, semanticLabel: channel),
      title: Row(children: [
        Expanded(child: Text(item.clientName ?? l.inboxUnassignedClient, overflow: TextOverflow.ellipsis, style: t.titleSmall)),
        if (amount != null) Text(Money.format(amount, item.currency ?? 'COP'), style: t.titleSmall?.copyWith(fontFeatures: const [FontFeature.tabularFigures()])),
      ]),
      subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const SizedBox(height: 2),
        Text('$channel · ${Dates.dateTime(item.createdAt, context.lang)}', style: t.bodySmall),
        const SizedBox(height: 4),
        Row(children: [
          Flexible(child: StatusDot(label: status, tone: tone)),
          if (blocking.isNotEmpty && item.pending) ...[
            const SizedBox(width: 12),
            Flexible(child: Text(flagText(l, blocking.first), overflow: TextOverflow.ellipsis, style: t.bodySmall?.copyWith(color: Theme.of(context).colorScheme.error))),
          ],
        ]),
      ]),
      isThreeLine: true,
    );
  }
}

/// Abre la Bandeja con un comprobante elegido (p. ej. después de «Compartir con COROC»).
void openIntake(BuildContext context, String id) => GoRouter.of(context).go('/inbox?id=$id');
