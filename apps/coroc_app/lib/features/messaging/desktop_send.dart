import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/desktop/desktop_runtime.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../documents/documents.dart' show fetchDocumentBytes;
import 'messaging_common.dart' show messagesProvider, messagesSummaryProvider;

/// Lo que pasó al enviar: el mensaje ya marcado, si se abrió WhatsApp (o el correo) y si el PDF quedó copiado.
class DesktopSendResult {
  const DesktopSendResult(this.message, {required this.opened, required this.pdfCopied});
  final CorocMessage message;
  final bool opened;
  final bool pdfCopied;
}

/// Envío asistido en COROC Escritorio (ADR-064). El servidor vuelve a aplicar las reglas de contacto (Ley 2300) y, si
/// puede salir, lo marca enviado; COROC deja el recibo en PDF en el portapapeles (se pega con Ctrl+V) y abre el chat
/// del cliente en WhatsApp para Windows con el texto listo, o wa.me si la app de escritorio no responde.
/// Si una regla lo impide, llega la ApiException con el motivo en palabras del usuario.
Future<DesktopSendResult> sendOnDesktop(WidgetRef ref, CorocMessage m) async {
  final platform = ref.read(desktopPlatformProvider);
  final sent = await ref.read(apiProvider).sendMessage(m.id);
  ref.invalidate(messagesProvider);
  ref.invalidate(messagesSummaryProvider);
  var pdf = false;
  if (m.channel == 'whatsapp' && m.attachmentDocumentId != null) {
    try {
      final bytes = await fetchDocumentBytes(ref, m.attachmentDocumentId!);
      final name = '${(m.contract ?? 'COROC').replaceAll(RegExp(r'[^A-Za-z0-9-]'), '')}-${m.event}.pdf';
      pdf = await platform.copyPdfToClipboard(name, bytes);
    } on Object {
      // Sin el PDF a mano, el texto igual sale; el recibo sigue en la ficha del cliente.
      pdf = false;
    }
  }
  final links = sent.assisted;
  final urls = m.channel == 'whatsapp' ? [links?.whatsappAppUrl, links?.whatsappUrl] : [links?.mailtoUrl];
  var opened = false;
  for (final url in urls.whereType<String>()) {
    opened = await platform.openUrl(url);
    if (opened) break;
  }
  return DesktopSendResult(sent, opened: opened, pdfCopied: pdf);
}
