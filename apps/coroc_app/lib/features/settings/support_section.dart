import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/models/support.dart';
import '../../core/providers.dart';
import '../../design/tokens.dart';
import '../../design/widgets/common.dart';

final failuresProvider = FutureProvider.autoDispose<Failures>((ref) => ref.watch(apiProvider).failures());
final intakeTraceProvider = FutureProvider.autoDispose.family<IntakeTrace, String>((ref, id) => ref.watch(apiProvider).traceIntake(id));

String taskKindName(AppLocalizations l, String kind) => switch (kind) {
      'schedule' => l.taskKindSchedule,
      'receipt' => l.taskKindReceipt,
      'receipt_void' => l.taskKindReceiptVoid,
      'statement' => l.taskKindStatement,
      'payoff' => l.taskKindPayoff,
      'report' => l.taskKindReport,
      _ => l.taskKindBackup,
    };

/// Cola de fallidos para soporte (Fase 5, ADR-054): documentos que no se generaron, mensajes que no salieron y
/// comprobantes que no se pudieron leer, con reintento. Visible para Propietario, Administrador y Auditor.
class SupportSection extends ConsumerStatefulWidget {
  const SupportSection({super.key, required this.canRetry});
  final bool canRetry;
  @override
  ConsumerState<SupportSection> createState() => _SupportSectionState();
}

class _SupportSectionState extends ConsumerState<SupportSection> {
  final _busy = <String>{};

  Future<void> _retry(String id, Future<void> Function() action) async {
    setState(() => _busy.add(id));
    try {
      await action();
      ref.invalidate(failuresProvider);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(context.l10n.supportRetried)));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(context, e))));
    } finally {
      if (mounted) setState(() => _busy.remove(id));
    }
  }

  Widget _retryButton(String id, Future<void> Function() action) {
    final l = context.l10n;
    // Área táctil de al menos 48 × 48 (WCAG 2.2, 2.5.8) y nombre accesible explícito.
    return TextButton(
      style: TextButton.styleFrom(minimumSize: const Size(48, 48)),
      onPressed: !widget.canRetry || _busy.contains(id) ? null : () => _retry(id, action),
      child: Text(l.supportRetry),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    final api = ref.read(apiProvider);
    return SectionCard(
      title: l.supportTitle,
      child: AsyncBody<Failures>(
        value: ref.watch(failuresProvider),
        onRetry: () => ref.invalidate(failuresProvider),
        builder: (f) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(l.supportHelp, style: t.bodySmall),
          const SizedBox(height: CorocSpace.md),
          if (f.isEmpty) StatusDot(label: l.supportEmpty, tone: StatusTone.ok),
          if (f.tasks.isNotEmpty) ...[
            Semantics(header: true, child: Text(l.supportDocuments, style: t.titleSmall)),
            for (final x in f.tasks)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.description_outlined),
                title: Text([taskKindName(l, x.kind), ?x.contract].join(' · ')),
                subtitle: Text([l.supportAttempts(x.attempts), if (x.finishedAt != null) Dates.dateTime(x.finishedAt!, context.lang), ?x.detail].join(' · ')),
                trailing: x.retryable ? _retryButton(x.id, () => api.retryTask(x.id)) : Text(l.supportNotRetryable, style: t.bodySmall),
              ),
          ],
          if (f.messages.isNotEmpty) ...[
            Semantics(header: true, child: Text(l.supportMessages, style: t.titleSmall)),
            for (final m in f.messages)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Icon(m.channel == 'email' ? Icons.mail_outline : Icons.chat_outlined),
                title: Text(m.clientName),
                subtitle: Text([if (m.failedAt != null) Dates.dateTime(m.failedAt!, context.lang), ?m.detail].join(' · ')),
                trailing: _retryButton(m.id, () => api.retryMessage(m.id)),
              ),
          ],
          if (f.intake.isNotEmpty) ...[
            Semantics(header: true, child: Text(l.supportReceipts, style: t.titleSmall)),
            for (final i in f.intake)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.image_not_supported_outlined),
                title: Text(i.fileName ?? i.channel),
                subtitle: Text([Dates.dateTime(i.createdAt, context.lang), ?i.detail].join(' · ')),
              ),
          ],
        ]),
      ),
    );
  }
}

String traceStepName(AppLocalizations l, String step) => switch (step) {
      'received' => l.traceReceived,
      'read' => l.traceRead,
      'identified' => l.traceIdentified,
      'decided' => l.traceDecided,
      'payment' => l.tracePayment,
      'receipt' => l.traceReceipt,
      _ => l.traceDelivered,
    };

/// Recorrido de un comprobante: cada etapa con su hora, de la llegada al recibo entregado (ADR-054).
class IntakeTraceCard extends ConsumerWidget {
  const IntakeTraceCard({super.key, required this.intakeId});
  final String intakeId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    return SectionCard(
      title: l.traceTitle,
      child: AsyncBody<IntakeTrace>(
        value: ref.watch(intakeTraceProvider(intakeId)),
        onRetry: () => ref.invalidate(intakeTraceProvider(intakeId)),
        builder: (tr) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          for (final s in tr.steps)
            ListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              leading: Icon(switch (s.status) {
                'done' => Icons.check_circle_outline,
                'failed' => Icons.error_outline,
                'skipped' => Icons.remove_circle_outline,
                _ => Icons.schedule,
              }),
              title: Text(traceStepName(l, s.step)),
              // El estado también va en texto: nunca solo con el icono (WCAG 1.4.1).
              subtitle: Text(switch (s.status) {
                'done' => s.at == null ? '' : Dates.dateTime(s.at!, context.lang),
                'failed' => [l.traceFailed, ?s.detail].join(' · '),
                'skipped' => l.traceSkipped,
                _ => l.tracePending,
              }),
            ),
          if (tr.paymentSeconds != null) Text(l.traceSeconds(tr.paymentSeconds!), style: Theme.of(context).textTheme.bodySmall),
        ]),
      ),
    );
  }
}
