import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/desktop/desktop_platform.dart';
import '../../core/desktop/desktop_runtime.dart';
import '../../core/l10n.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../../design/widgets/brand.dart';
import '../../design/widgets/common.dart';
import '../../features/messaging/desktop_send.dart';
import '../../features/messaging/messaging_common.dart' show eventLabel, messagesSummaryProvider;
import '../data.dart';
import '../ui/bank.dart';

/// Para enviar por WhatsApp: recibos con su estado de cuenta, recordatorios y estados de cuenta, uno a la vez. COROC
/// abre el chat del cliente en WhatsApp para Windows con el texto listo y, si hay PDF, lo deja copiado para pegarlo con
/// Ctrl+V. Al volver a COROC pasa solo al siguiente («3 de 12»). Su número no se conecta a nada (ADR-064).
class SendPage extends ConsumerStatefulWidget {
  const SendPage({super.key});
  @override
  ConsumerState<SendPage> createState() => _SendPageState();
}

class _SendPageState extends ConsumerState<SendPage> {
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

  void _next({bool sent = false}) {
    setState(() {
      if (sent) _sent++;
      _index++;
      _waiting = false;
      _pdfCopied = false;
      _notice = null;
    });
    ref
      ..invalidate(readyMessagesProvider)
      ..invalidate(recentPaymentsProvider);
  }

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
      // Una regla de contacto lo impide (franja, cupo del día, festivo, sin autorización): se dice cuál y se sigue.
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
    final queue = _queue;
    List<Widget> body;
    if (_loadError != null) {
      body = [ErrorState(message: errorText(context, _loadError!), onRetry: _load)];
    } else if (queue == null) {
      body = [
        const Padding(
          padding: EdgeInsets.all(48),
          child: Center(child: CircularProgressIndicator()),
        ),
      ];
    } else if (_index >= queue.length) {
      body = [
        BankCard(
          child: BankEmpty(
            icon: Icons.mark_chat_read_outlined,
            title: l.todayMessagesDone,
            message: _sent > 0 ? l.todayMessagesSentN(_sent) : l.pSendNothing,
            action: OutlinedButton.icon(onPressed: _load, icon: const Icon(Icons.refresh), label: Text(l.todayMessagesReload)),
          ),
        ),
      ];
    } else {
      final m = queue[_index];
      final whatsapp = m.channel == 'whatsapp';
      body = [
        Row(
          children: [
            Text(l.todayMessagesPosition(_index + 1, queue.length), style: t.headlineSmall),
            const Spacer(),
            if (_sent > 0) Pill(l.todayMessagesSentN(_sent), tone: StatusTone.ok, icon: Icons.done_all),
          ],
        ),
        const SizedBox(height: 10),
        LoanProgress(_index / queue.length),
        const SizedBox(height: 24),
        BankCard(
          padding: const EdgeInsets.all(28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Monogram(m.clientName ?? '—', size: 52),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(m.clientName ?? '—', style: t.titleLarge, overflow: TextOverflow.ellipsis),
                        Text([eventLabel(l, m.event), if (m.contract != null) m.contract!].join(' · '), style: t.bodyMedium?.copyWith(color: Bank.muted)),
                      ],
                    ),
                  ),
                  Pill(whatsapp ? l.channelWhatsapp : l.channelEmail, icon: whatsapp ? Icons.chat_outlined : Icons.mail_outline),
                ],
              ),
              const SizedBox(height: 22),
              // El mensaje como se verá en el chat.
              Container(
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  color: const Color(0xFFF1F7EE),
                  borderRadius: const BorderRadius.only(topLeft: Radius.circular(18), topRight: Radius.circular(18), bottomLeft: Radius.circular(18), bottomRight: Radius.circular(4)),
                  border: Border.all(color: const Color(0xFFDDEBD5)),
                ),
                child: SelectableText(m.body, style: t.bodyLarge?.copyWith(height: 1.5)),
              ),
              if (m.attachmentDocumentId != null) ...[const SizedBox(height: 14), Pill(l.pWithPdf, icon: Icons.picture_as_pdf_outlined, tone: StatusTone.info)],
            ],
          ),
        ),
        const SizedBox(height: 18),
        if (_waiting && _pdfCopied) ...[InfoNote(l.todayMessagesPasteHint, icon: Icons.content_paste, tone: StatusTone.ok), const SizedBox(height: 14)],
        if (_notice != null) ...[InfoNote(_notice!, icon: Icons.info_outline, tone: StatusTone.warn), const SizedBox(height: 14)],
        if (!_waiting)
          GoldButton(
            label: whatsapp ? l.todayMessagesSendWhatsapp : l.todayMessagesSendEmail,
            icon: whatsapp ? Icons.send : Icons.forward_to_inbox,
            expand: true,
            busy: _busy,
            onPressed: () => _send(m),
          )
        else ...[
          Text(l.todayMessagesWaiting, style: t.bodyLarge, textAlign: TextAlign.center),
          const SizedBox(height: 14),
          GoldButton(label: l.todayMessagesNext, icon: Icons.arrow_forward, expand: true, onPressed: () => _next(sent: true)),
        ],
        const SizedBox(height: 8),
        if (!_waiting)
          Wrap(
            alignment: WrapAlignment.center,
            spacing: 8,
            children: [
              TextButton(onPressed: _busy ? null : _next, child: Text(l.todayMessagesSkip)),
              TextButton(onPressed: _busy ? null : () => _discard(m), child: Text(l.msgDiscard)),
            ],
          ),
      ];
    }
    return BankPage(maxWidth: 780, title: l.pHomeToSendTitle, subtitle: l.todayMessagesSubtitle, children: body);
  }
}
