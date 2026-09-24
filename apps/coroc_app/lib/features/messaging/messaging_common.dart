import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api/api_client.dart' show ServerEvent;
import '../../core/auth/auth_controller.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../../design/tokens.dart';
import '../../design/widgets/common.dart';
import '../../design/widgets/labels.dart' show weekdayShort;
import '../dashboard/dashboard_page.dart' show eventsProvider;
import '../documents/documents.dart' show fetchDocumentBytes;
import '../settings/intake_sections.dart' show whatsAppAccountProvider;

/// Contadores de la mensajería: la insignia de «Por enviar hoy» en la navegación.
final messagesSummaryProvider = FutureProvider.autoDispose<MessagesSummary>((ref) async {
  final auth = ref.watch(authProvider);
  if (auth is! SignedIn || !auth.user.can('messages.view')) return const MessagesSummary();
  return ref.watch(apiProvider).messagesSummary();
});

/// Mensajes por estados y, si se pide, de un cliente.
typedef MessageQuery = ({String statuses, String? clientId});
final messagesProvider = FutureProvider.autoDispose.family<MessagePage, MessageQuery>(
  (ref, q) => ref.watch(apiProvider).messages(status: q.statuses.isEmpty ? const [] : q.statuses.split(','), clientId: q.clientId, limit: 100),
);

/// Mantiene la mensajería al día con `message.updated` y avisa si Meta suspendió la cuenta (`whatsapp.suspended`).
class MessagesRealtime extends ConsumerWidget {
  const MessagesRealtime({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.listen<AsyncValue<ServerEvent>>(eventsProvider, (_, next) {
      final e = next.valueOrNull;
      if (e == null) return;
      if (e.type == 'message.updated' || e.type == 'payment.posted' || e.type == 'loan.created') {
        ref.invalidate(messagesSummaryProvider);
        ref.invalidate(messagesProvider);
      }
      if (e.type == 'whatsapp.suspended') {
        ref.invalidate(whatsAppAccountProvider);
        ref.invalidate(messagesProvider);
        ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(context.l10n.whatsappSuspendedBanner), duration: const Duration(seconds: 8)));
      }
    });
    return child;
  }
}

String eventLabel(AppLocalizations l, String e) => switch (e) {
  'welcome' => l.msgEventWelcome,
  'reminder' => l.msgEventReminder,
  'overdue' => l.msgEventOverdue,
  'receipt' => l.msgEventReceipt,
  'statement' => l.msgEventStatement,
  'payoff' => l.msgEventPayoff,
  _ => l.msgEventManual,
};

/// Estado del mensaje (§11.3): programado · por enviar · enviado · entregado · leído · fallido · bloqueado · descartado.
(String, StatusTone) messageStatusLabel(AppLocalizations l, String s) => switch (s) {
  'scheduled' => (l.msgStatusScheduled, StatusTone.info),
  'ready' => (l.msgStatusReady, StatusTone.warn),
  'sent' => (l.msgStatusSent, StatusTone.ok),
  'delivered' => (l.msgStatusDelivered, StatusTone.ok),
  'read' => (l.msgStatusRead, StatusTone.ok),
  'failed' => (l.msgStatusFailed, StatusTone.error),
  'blocked' => (l.msgStatusBlocked, StatusTone.error),
  _ => (l.msgStatusCancelled, StatusTone.neutral),
};

/// Día ISO (1 = lunes … 7 = domingo) en su forma corta.
String weekdayName(AppLocalizations l, int day) => weekdayShort(l)[(day - 1).clamp(0, 6)];

/// La regla aplicada, en palabras del usuario (§11.4: «Reprogramado… festivo»).
String reasonText(AppLocalizations l, DecisionReason r, String lang) {
  String day(String? iso) => iso == null ? '' : Dates.medium(iso, lang);
  return switch (r.code) {
    'OUT_OF_WINDOW' => l.ruleOutOfWindow,
    'HOLIDAY_SKIPPED' => l.ruleHoliday(day(r.detail)),
    'MAX_PER_DAY' => l.ruleMaxPerDay(day(r.detail)),
    'CHANNEL_WEEK' => l.ruleChannelWeek(r.detail == 'email' ? l.channelEmail : l.channelWhatsapp),
    'TRANSACTIONAL_IMMEDIATE' => l.ruleTransactionalImmediate,
    'DEBTOR_EXCEPTION' => l.ruleDebtorException,
    'NO_CONSENT' => l.ruleNoConsent(r.detail == 'email' ? l.channelEmail : l.channelWhatsapp),
    'OPTED_OUT' => l.ruleOptedOut(r.detail == 'email' ? l.channelEmail : l.channelWhatsapp),
    'NO_ADDRESS' => l.ruleNoAddress,
    'ADDRESS_INVALID' => l.ruleAddressInvalid,
    'CONTENT_BLOCKED' => l.ruleContentBlocked,
    'LOAN_CLOSED' => l.ruleLoanClosed,
    _ => r.code,
  };
}

/// Resumen de la decisión: «Reprogramado para 13 oct 2026 07:00: fuera de franja · festivo 12 oct».
String decisionText(AppLocalizations l, ContactDecision d, String lang) {
  final reasons = d.reasons.map((r) => reasonText(l, r, lang)).join(' · ');
  if (d.decision == 'reschedule' && d.localAt != null) {
    final at = d.localAt!;
    return l.decisionRescheduled('${Dates.medium(at.substring(0, 10), lang)} ${at.substring(11)}', reasons);
  }
  if (d.decision == 'block') return l.decisionBlocked(reasons);
  return reasons;
}

String issueText(AppLocalizations l, TemplateIssue i) => switch (i.code) {
  'EMPTY' => l.issueEmpty,
  'TOO_LONG' => l.issueTooLong,
  'UNKNOWN_VARIABLE' => l.issueUnknownVariable('{{${i.match ?? ''}}}'),
  'UNBALANCED_BRACES' => l.issueBraces('{{nombre}}'),
  'THREAT' => l.issueThreat(i.match ?? ''),
  'ASKS_CAUSE' => l.issueAsksCause(i.match ?? ''),
  'THIRD_PARTY' => l.issueThirdParty(i.match ?? ''),
  'SENSITIVE_DATA' => l.issueSensitive(i.match ?? ''),
  _ => i.code,
};

void _toast(BuildContext context, String text) => ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(text)));

/// Modo asistido (§11.1 modo B): el servidor vuelve a aplicar las reglas y, si puede salir, la app abre WhatsApp o el
/// programa de correo con el texto listo. El usuario solo toca «Enviar» en WhatsApp.
Future<void> sendAssisted(BuildContext context, WidgetRef ref, CorocMessage m) async {
  final l = context.l10n;
  try {
    final r = await ref.read(apiProvider).sendMessage(m.id);
    ref.invalidate(messagesProvider);
    ref.invalidate(messagesSummaryProvider);
    final url = m.channel == 'whatsapp' ? r.assisted?.whatsappUrl : r.assisted?.mailtoUrl;
    if (url != null) {
      final ok = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
      if (!ok && context.mounted) _toast(context, l.msgCannotOpen);
    } else if (context.mounted) {
      _toast(context, messageStatusLabel(l, r.status).$1);
    }
  } catch (e) {
    if (context.mounted) _toast(context, errorText(context, e));
  }
}

/// En el celular, el PDF del recibo se puede compartir directo al chat con la hoja de compartir (§11.1).
Future<void> sharePdf(BuildContext context, WidgetRef ref, CorocMessage m) async {
  final box = context.findRenderObject() as RenderBox?;
  try {
    final bytes = await fetchDocumentBytes(ref, m.attachmentDocumentId!);
    await SharePlus.instance.share(
      ShareParams(
        files: [XFile.fromData(bytes, mimeType: 'application/pdf', name: '${m.contract ?? 'COROC'}.pdf')],
        text: m.body,
        sharePositionOrigin: box == null ? null : box.localToGlobal(Offset.zero) & box.size,
      ),
    );
  } catch (e) {
    if (context.mounted) _toast(context, errorText(context, e));
  }
}

bool get _mobile => Platform.isAndroid || Platform.isIOS;

/// Un mensaje con su estado, la regla aplicada y las acciones que permite.
class MessageTile extends ConsumerWidget {
  const MessageTile({super.key, required this.message, this.showClient = true});
  final CorocMessage message;
  final bool showClient;

  Future<void> _run(BuildContext context, WidgetRef ref, Future<CorocMessage> Function() action) async {
    try {
      final r = await action();
      ref.invalidate(messagesProvider);
      ref.invalidate(messagesSummaryProvider);
      if (context.mounted) _toast(context, messageStatusLabel(context.l10n, r.status).$1);
    } catch (e) {
      if (context.mounted) _toast(context, errorText(context, e));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    final m = message;
    final auth = ref.watch(authProvider);
    final canSend = auth is SignedIn && auth.user.can('messages.send');
    final api = ref.read(apiProvider);
    final (statusText, tone) = messageStatusLabel(l, m.status);
    final when = m.sentAt ?? m.scheduledAt ?? m.createdAt;
    final ruleLine = (m.status == 'blocked' || m.status == 'scheduled') && m.decision.reasons.isNotEmpty ? decisionText(l, m.decision, context.lang) : null;
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(CorocRadii.card),
        onTap: () => showMessageDetail(context, ref, m),
        child: Padding(
          padding: const EdgeInsets.all(CorocSpace.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(m.channel == 'whatsapp' ? Icons.chat_outlined : Icons.mail_outline, size: 20, semanticLabel: m.channel == 'whatsapp' ? l.channelWhatsapp : l.channelEmail),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      [if (showClient && m.clientName != null) m.clientName!, eventLabel(l, m.event), if (m.contract != null) m.contract!].join(' · '),
                      style: t.titleSmall,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const SizedBox(width: 8),
                  StatusDot(label: statusText, tone: tone),
                ],
              ),
              const SizedBox(height: 6),
              Text(m.body, maxLines: 2, overflow: TextOverflow.ellipsis, style: t.bodyMedium),
              const SizedBox(height: 6),
              Text(Dates.dateTime(when, context.lang), style: t.bodySmall?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant)),
              if (ruleLine != null) ...[const SizedBox(height: 4), Text(ruleLine, style: t.bodySmall?.copyWith(color: m.status == 'blocked' ? Theme.of(context).colorScheme.error : null))],
              if (m.error != null && m.status == 'failed') ...[const SizedBox(height: 4), Text(m.error!, style: t.bodySmall?.copyWith(color: Theme.of(context).colorScheme.error))],
              if (canSend && (m.pending || m.retryable)) ...[
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    if (m.status == 'ready')
                      FilledButton.icon(
                        onPressed: () => sendAssisted(context, ref, m),
                        icon: Icon(m.channel == 'whatsapp' ? Icons.send : Icons.forward_to_inbox, size: 18),
                        label: Text(m.channel == 'whatsapp' ? l.msgSendWhatsapp : l.msgSendEmail),
                      ),
                    if (m.status == 'ready' && m.attachmentDocumentId != null && _mobile)
                      OutlinedButton.icon(onPressed: () => sharePdf(context, ref, m), icon: const Icon(Icons.picture_as_pdf_outlined, size: 18), label: Text(l.msgSharePdf)),
                    if (m.status == 'scheduled') OutlinedButton(onPressed: () => _run(context, ref, () => api.sendMessage(m.id)), child: Text(l.msgSendNow)),
                    if (m.pending) TextButton(onPressed: () => _run(context, ref, () => api.cancelMessage(m.id)), child: Text(l.msgDiscard)),
                    if (m.retryable) OutlinedButton(onPressed: () => _run(context, ref, () => api.retryMessage(m.id)), child: Text(l.actionRetry)),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Detalle: el texto completo, la decisión del motor con cada regla y el recorrido del mensaje.
Future<void> showMessageDetail(BuildContext context, WidgetRef ref, CorocMessage m) {
  final l = context.l10n;
  final lang = context.lang;
  String? at(String? iso) => iso == null ? null : Dates.dateTime(iso, lang);
  return showDialog<void>(
    context: context,
    builder: (c) => AlertDialog(
      title: Text('${eventLabel(l, m.event)} · ${m.channel == 'whatsapp' ? l.channelWhatsapp : l.channelEmail}'),
      content: SizedBox(
        width: 520,
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              if (m.subject != null && m.channel == 'email') ...[Text(m.subject!, style: Theme.of(c).textTheme.titleSmall), const SizedBox(height: 8)],
              SelectableText(m.body),
              const Divider(height: 24),
              KeyValue(l.msgStatus, messageStatusLabel(l, m.status).$1),
              if (m.clientName != null) KeyValue(l.navClients, m.clientName!),
              KeyValue(l.msgKind, m.kind == 'collection' ? l.msgKindCollection : l.msgKindTransactional),
              if (m.decision.reasons.isNotEmpty) KeyValue(l.msgRule, decisionText(l, m.decision, lang)),
              KeyValue(l.msgRuleSet, m.decision.ruleSet),
              if (at(m.scheduledAt) != null) KeyValue(l.msgScheduledAt, at(m.scheduledAt)!),
              if (at(m.sentAt) != null) KeyValue(l.msgSentAt, at(m.sentAt)!),
              if (at(m.deliveredAt) != null) KeyValue(l.msgDeliveredAt, at(m.deliveredAt)!),
              if (at(m.readAt) != null) KeyValue(l.msgReadAt, at(m.readAt)!),
              if (m.via != null)
                KeyValue(
                  l.msgVia,
                  m.via == 'cloud_api'
                      ? l.msgViaCloud
                      : m.via == 'email'
                      ? l.channelEmail
                      : l.msgViaAssisted,
                ),
            ],
          ),
        ),
      ),
      actions: [TextButton(onPressed: () => Navigator.pop(c), child: Text(l.actionClose))],
    ),
  );
}
