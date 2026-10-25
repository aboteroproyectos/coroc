import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/desktop/desktop_runtime.dart';
import '../../core/l10n.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../../design/tokens.dart';
import '../../design/widgets/common.dart';
import '../messaging/desktop_send.dart';

/// COROC Escritorio, después de registrar un pago desde un comprobante (E-3): el recibo sale por WhatsApp con un clic.
/// El servidor prepara el mensaje del recibo con su PDF en unos segundos; aquí se espera a que esté listo y se envía
/// asistido (texto listo en el chat y el PDF copiado para pegarlo con Ctrl+V).
Future<void> offerReceipt(BuildContext context, WidgetRef ref, {required String clientId, required String receiptNumber, Duration pollStep = const Duration(milliseconds: 1500)}) async {
  if (!ref.read(desktopModeProvider)) return;
  final l = context.l10n;
  final go = await showDialog<bool>(
    context: context,
    builder: (c) => AlertDialog(
      icon: const Icon(Icons.receipt_long_outlined, color: CorocColors.gold700, size: 36),
      title: Text(l.receiptPromptTitle(receiptNumber)),
      content: SizedBox(width: 440, child: Text(l.receiptPromptBody)),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(l.receiptPromptLater)),
        FilledButton.icon(onPressed: () => Navigator.pop(c, true), icon: const Icon(Icons.send, size: 18), label: Text(l.receiptPromptSend)),
      ],
    ),
  );
  if (go != true || !context.mounted) return;
  final messenger = ScaffoldMessenger.maybeOf(context);
  // Cada aviso reemplaza al anterior: «pegue con Ctrl+V» no espera en la fila detrás de «Preparando el recibo…».
  void say(String text) => messenger
    ?..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(text), duration: const Duration(seconds: 8)));
  say(l.receiptPromptPreparing);
  try {
    CorocMessage? m;
    for (var i = 0; i < 20 && m == null; i++) {
      if (i > 0) await Future<void>.delayed(pollStep);
      final page = await ref.read(apiProvider).messages(status: const ['ready'], clientId: clientId, event: 'receipt', limit: 10);
      m = page.items.where((x) => x.channel == 'whatsapp').firstOrNull;
    }
    if (m == null) return say(l.receiptPromptNone);
    final r = await sendOnDesktop(ref, m);
    say(r.pdfCopied ? l.todayMessagesPasteHint : (r.opened ? l.receiptPromptOpened : l.msgCannotOpen));
  } catch (e) {
    if (context.mounted) say(errorText(context, e));
  }
}
