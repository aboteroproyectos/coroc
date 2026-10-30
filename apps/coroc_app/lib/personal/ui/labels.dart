import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/l10n.dart';
import '../../core/models/models.dart';
import '../../design/widgets/common.dart' show StatusTone;
import 'bank.dart';

/// Ícono del canal por el que llegó un pago o un comprobante.
IconData channelIcon(String channel) => switch (channel) {
  'email' => Icons.mail_outline,
  'whatsapp' => Icons.chat_outlined,
  'cash' => Icons.payments_outlined,
  'folder' => Icons.folder_outlined,
  'upload_link' => Icons.link,
  'manual' => Icons.edit_note,
  _ => Icons.upload_file_outlined,
};

/// Nombre del canal en palabras de la persona.
String channelName(AppLocalizations l, String channel) => switch (channel) {
  'email' => l.channelEmail,
  'whatsapp' => l.channelWhatsapp,
  'cash' => l.pChannelCash,
  'manual' => l.pChannelManual,
  'folder' => l.channelFolder,
  'upload_link' => l.channelUploadLink,
  _ => l.pChannelPc,
};

/// Cómo va la respuesta al cliente con su recibo y estado de cuenta.
Widget? replyPill(AppLocalizations l, RecentPayment p) {
  if (p.reversed) return Pill(l.pMoveReversed, tone: StatusTone.error);
  final r = p.reply;
  if (r == null) return null;
  return switch (r.status) {
    'sent' || 'delivered' || 'read' => Pill(r.channel == 'email' ? l.pReplySentEmail : l.pReplySentWhatsapp, tone: StatusTone.ok, icon: Icons.done_all),
    'ready' => Pill(l.pReplyReady, tone: StatusTone.warn, icon: Icons.schedule_send_outlined),
    'scheduled' => Pill(l.pReplyScheduled, tone: StatusTone.info, icon: Icons.schedule),
    'cancelled' => null,
    _ => Pill(l.pReplyFailed, tone: StatusTone.error),
  };
}

/// «Hoy · 10:15», «Ayer · 18:40» o «27 oct · 09:12», en la hora de este PC.
String whenText(AppLocalizations l, String iso, String lang, {DateTime? now}) {
  final at = DateTime.tryParse(iso)?.toLocal();
  if (at == null) return iso;
  final today = now ?? DateTime.now();
  final day = DateTime(at.year, at.month, at.day);
  final diff = DateTime(today.year, today.month, today.day).difference(day).inDays;
  final loc = lang == 'pt' ? 'pt_BR' : (lang == 'en' ? 'en_US' : 'es');
  final time = DateFormat.Hm(loc).format(at);
  final label = diff == 0 ? l.pToday : (diff == 1 ? l.pYesterday : DateFormat.MMMd(loc).format(at));
  return '$label · $time';
}
