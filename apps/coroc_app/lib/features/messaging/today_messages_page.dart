import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/desktop/desktop_platform.dart';
import '../../core/desktop/desktop_runtime.dart';
import '../../core/l10n.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../../design/tokens.dart';
import '../../design/widgets/brand.dart';
import '../../design/widgets/common.dart';
import '../desktop/gmail_connect.dart' show ResultBox;
import '../shell/app_shell.dart';
import 'desktop_send.dart';
import 'messaging_common.dart';

/// «Mensajes de hoy» de COROC Escritorio (ADR-064): los mensajes listos de hoy, uno a la vez, con un botón grande
/// «Enviar». COROC abre el chat del cliente en WhatsApp para Windows con el texto listo y, si hay recibo, lo deja
/// copiado para pegarlo con Ctrl+V. Al volver a COROC pasa solo al siguiente: «3 de 12».
class TodayMessagesPage extends ConsumerStatefulWidget {
  const TodayMessagesPage({super.key});
  @override
  ConsumerState<TodayMessagesPage> createState() => _TodayMessagesPageState();
}

class _TodayMessagesPageState extends ConsumerState<TodayMessagesPage> {
  List<CorocMessage>? _queue;
  int _index = 0;
  int _sent = 0;
  bool _busy = false;

  /// Se abrió WhatsApp: al volver a la ventana de COROC se pasa al siguiente.
  bool _waiting = false;
  bool _pdfCopied = false;
  String? _notice;
  Object? _loadError;
  StreamSubscription<WindowSignal>? _focus;

  @override
  void initState() {
    super.initState();
    _focus = ref.read(desktopPlatformProvider).signals.listen((s) {
      if (s.kind == WindowSignalKind.focused && _waiting) _next(sent: true);
    });
    _load();
  }

  @override
  void dispose() {
    unawaited(_focus?.cancel());
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final page = await ref.read(apiProvider).messages(status: const ['ready'], limit: 100);
      if (mounted) {
        setState(() {
          _queue = page.items;
          _index = 0;
          _loadError = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _loadError = e);
    }
  }

  void _next({bool sent = false}) => setState(() {
    if (sent) _sent++;
    _index++;
    _waiting = false;
    _pdfCopied = false;
    _notice = null;
  });

  Future<void> _send(CorocMessage m) async {
    setState(() {
      _busy = true;
      _notice = null;
    });
    try {
      final r = await sendOnDesktop(ref, m);
      if (!mounted) return;
      setState(() {
        _waiting = true;
        _pdfCopied = r.pdfCopied;
        if (!r.opened) _notice = context.l10n.msgCannotOpen;
      });
    } catch (e) {
      // Una regla de contacto lo impide (franja, cupo del día, festivo, sin consentimiento): se dice cuál y se sigue.
      if (mounted) setState(() => _notice = errorText(context, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _discard(CorocMessage m) async {
    try {
      await ref.read(apiProvider).cancelMessage(m.id);
      ref.invalidate(messagesSummaryProvider);
      if (mounted) _next();
    } catch (e) {
      if (mounted) setState(() => _notice = errorText(context, e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    final auth = ref.watch(authProvider);
    if (auth is! SignedIn || !auth.user.can('messages.view')) return const NoPermission();
    final canSend = auth.user.can('messages.send');
    final queue = _queue;
    final header = PageHeader(title: l.todayMessagesTitle, subtitle: l.todayMessagesSubtitle);
    if (_loadError != null) {
      return PageScaffold(
        maxWidth: 760,
        children: [
          header,
          ErrorState(message: errorText(context, _loadError!), onRetry: _load),
        ],
      );
    }
    if (queue == null) {
      return PageScaffold(
        maxWidth: 760,
        children: [
          header,
          const Center(child: CircularProgressIndicator()),
        ],
      );
    }
    if (_index >= queue.length) {
      return PageScaffold(
        maxWidth: 760,
        children: [
          header,
          EmptyState(icon: Icons.mark_email_read_outlined, title: l.todayMessagesDone, message: _sent > 0 ? l.todayMessagesSentN(_sent) : l.messagesEmptyReadyHelp),
          Center(
            child: TextButton.icon(onPressed: _load, icon: const Icon(Icons.refresh), label: Text(l.todayMessagesReload)),
          ),
        ],
      );
    }
    final m = queue[_index];
    final whatsapp = m.channel == 'whatsapp';
    return PageScaffold(
      maxWidth: 760,
      children: [
        header,
        Row(
          children: [
            Text(l.todayMessagesPosition(_index + 1, queue.length), style: t.headlineSmall),
            const Spacer(),
            if (_sent > 0) StatusDot(label: l.todayMessagesSentN(_sent), tone: StatusTone.ok),
          ],
        ),
        const SizedBox(height: CorocSpace.sm),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(value: _index / queue.length, minHeight: 6),
        ),
        const SizedBox(height: CorocSpace.lg),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(CorocSpace.lg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(whatsapp ? Icons.chat_outlined : Icons.mail_outline, semanticLabel: whatsapp ? l.channelWhatsapp : l.channelEmail),
                    const SizedBox(width: CorocSpace.sm),
                    Expanded(
                      child: Text(m.clientName ?? '—', style: t.titleLarge, overflow: TextOverflow.ellipsis),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text([eventLabel(l, m.event), if (m.contract != null) m.contract!].join(' · '), style: t.bodyMedium?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant)),
                const Divider(height: CorocSpace.xl),
                SelectableText(m.body, style: t.bodyLarge?.copyWith(height: 1.5)),
                if (m.attachmentDocumentId != null) ...[const SizedBox(height: CorocSpace.md), Chip(avatar: const Icon(Icons.picture_as_pdf_outlined, size: 18), label: Text(l.todayMessagesWithPdf))],
              ],
            ),
          ),
        ),
        const SizedBox(height: CorocSpace.md),
        if (_waiting && _pdfCopied) ...[ResultBox(ok: true, text: l.todayMessagesPasteHint), const SizedBox(height: CorocSpace.md)],
        if (_notice != null) ...[ResultBox(ok: false, text: _notice!), const SizedBox(height: CorocSpace.md)],
        if (!canSend)
          Text(l.noPermissionMessage, style: t.bodyMedium)
        else if (!_waiting)
          GoldButton(
            label: whatsapp ? l.todayMessagesSendWhatsapp : l.todayMessagesSendEmail,
            icon: whatsapp ? Icons.send : Icons.forward_to_inbox,
            expand: true,
            busy: _busy,
            onPressed: () => _send(m),
          )
        else ...[
          Text(l.todayMessagesWaiting, style: t.bodyLarge, textAlign: TextAlign.center),
          const SizedBox(height: CorocSpace.md),
          GoldButton(label: l.todayMessagesNext, icon: Icons.arrow_forward, expand: true, onPressed: () => _next(sent: true)),
        ],
        const SizedBox(height: CorocSpace.sm),
        if (canSend && !_waiting)
          Wrap(
            alignment: WrapAlignment.center,
            spacing: CorocSpace.sm,
            children: [
              TextButton(onPressed: _busy ? null : _next, child: Text(l.todayMessagesSkip)),
              TextButton(onPressed: _busy ? null : () => _discard(m), child: Text(l.msgDiscard)),
            ],
          ),
      ],
    );
  }
}
