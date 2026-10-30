import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../../design/tokens.dart';
import '../../design/widgets/brand.dart';
import '../../design/widgets/common.dart';
import '../../features/desktop/receipt_prompt.dart';
import '../../features/documents/documents.dart' show fetchDocumentBytes, openDocument;
import '../../features/inbox/inbox_page.dart' show intakeSummaryProvider, pickAndUploadReceipt;
import '../../features/inbox/intake_detail.dart' show IntakeDetailPage, flagText;
import '../data.dart';
import '../ui/bank.dart';
import '../ui/labels.dart';

/// Comprobantes: lo que llega por correo se registra solo; aquí queda lo que COROC no pudo registrar sin preguntar,
/// con una sola pregunta («¿Registramos este pago?»), y lo que registró solo hace poco, que se puede deshacer.
class ReceiptsPage extends ConsumerWidget {
  const ReceiptsPage({super.key, this.focusId});
  final String? focusId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final pending = ref.watch(pendingReceiptsProvider);
    final auto = ref.watch(autoReceiptsProvider);
    return BankPage(
      title: l.pNavReceipts,
      subtitle: l.pReceiptsSubtitle,
      actions: [OutlinedButton.icon(onPressed: () => _upload(context, ref), icon: const Icon(Icons.upload_file_outlined), label: Text(l.pHomeUpload))],
      children: [
        const _DropHint(),
        const SizedBox(height: 28),
        AsyncBody<IntakePage>(
          value: pending,
          onRetry: () => ref.invalidate(pendingReceiptsProvider),
          builder: (p) {
            final items = [...p.items]..sort((a, b) => (b.id == focusId ? 1 : 0).compareTo(a.id == focusId ? 1 : 0));
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SectionHeader(l.pReviewTitle(items.where((i) => i.pending).length)),
                if (items.isEmpty)
                  BankCard(
                    child: BankEmpty(icon: Icons.task_alt, title: l.pReviewEmpty, message: l.pReviewEmptyBody),
                  )
                else
                  for (final item in items) ...[_ReviewCard(item: item, focused: item.id == focusId), const SizedBox(height: 16)],
              ],
            );
          },
        ),
        const SizedBox(height: 20),
        AsyncBody<IntakePage>(
          value: auto,
          onRetry: () => ref.invalidate(autoReceiptsProvider),
          builder: (p) => p.items.isEmpty
              ? const SizedBox.shrink()
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    SectionHeader(l.pAutoTitle, subtitle: l.pAutoSubtitle),
                    BankCard(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                      child: Column(
                        children: [
                          for (final (i, item) in p.items.indexed) ...[if (i > 0) const Divider(height: 1, indent: 62), _AutoRow(item: item)],
                        ],
                      ),
                    ),
                  ],
                ),
        ),
      ],
    );
  }

  Future<void> _upload(BuildContext context, WidgetRef ref) async {
    try {
      final item = await pickAndUploadReceipt(context, ref);
      if (item != null) ref.invalidate(pendingReceiptsProvider);
    } catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(context, e))));
    }
  }
}

/// Cómo llegan los comprobantes de WhatsApp: soltarlos o pegarlos en cualquier parte de COROC.
class _DropHint extends StatelessWidget {
  const _DropHint();

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 24),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.6),
        borderRadius: BorderRadius.circular(Bank.radius),
        border: Border.all(color: CorocColors.gold500.withValues(alpha: 0.55), width: 1.4),
      ),
      child: Row(
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: const BoxDecoration(shape: BoxShape.circle, gradient: CorocColors.brandGradient),
            child: const Icon(Icons.file_download_outlined, color: CorocColors.navy800, size: 28),
          ),
          const SizedBox(width: 20),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(l.pDropTitle, style: t.titleMedium),
                const SizedBox(height: 4),
                Text(l.pDropBody, style: t.bodyMedium?.copyWith(color: Bank.muted)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Un comprobante por revisar: la imagen, lo que COROC leyó y de quién parece, y la pregunta con sus respuestas.
class _ReviewCard extends ConsumerStatefulWidget {
  const _ReviewCard({required this.item, required this.focused});
  final IntakeItem item;
  final bool focused;
  @override
  ConsumerState<_ReviewCard> createState() => _ReviewCardState();
}

class _ReviewCardState extends ConsumerState<_ReviewCard> {
  // Una clave por comprobante: si la red falla y se reintenta, el pago no se registra dos veces.
  final _key = const Uuid().v4();
  bool _busy = false;

  IntakeItem get item => widget.item;

  /// Se puede registrar con un clic si COROC sabe de quién es, a qué préstamo va, cuánto y cuándo, sin alertas graves.
  bool get _quick => item.status == 'review' && item.clientId != null && item.loanId != null && item.amount != null && item.date != null && !item.hasBlocking;

  Future<void> _approve() async {
    setState(() => _busy = true);
    final l = context.l10n;
    try {
      final r = await ref
          .read(apiProvider)
          .approveIntake(
            item.id,
            clientId: item.clientId!,
            loanId: item.loanId!,
            amount: item.amount!,
            date: item.date!,
            idempotencyKey: _key,
            payerName: item.text('payerName'),
            receiverName: item.text('receiverName'),
            reference: item.text('reference'),
            institution: item.text('entity'),
          );
      _refresh();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l.pReceiptRegistered(r.receipt.number))));
      await offerReceipt(context, ref, clientId: item.clientId!, receiptNumber: r.receipt.number);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(context, e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reject() async {
    final l = context.l10n;
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(l.pNotAPaymentTitle),
        content: SizedBox(width: 420, child: Text(l.pNotAPaymentBody)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(l.actionCancel)),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(l.pNotAPayment)),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _busy = true);
    try {
      await ref.read(apiProvider).rejectIntake(item.id, l.pNotAPaymentReason);
      _refresh();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(context, e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _review() async {
    await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => IntakeDetailPage(intakeId: item.id)));
    _refresh();
  }

  void _refresh() {
    ref
      ..invalidate(pendingReceiptsProvider)
      ..invalidate(autoReceiptsProvider)
      ..invalidate(intakeSummaryProvider);
    PersonalRealtime.refreshMoney(ref, clientId: item.clientId);
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    final cur = item.currency ?? 'COP';
    final reading = item.status == 'processing';
    final blocking = item.flags.where((f) => f.blocking).toList();
    final facts = <(String, String)>[
      if (item.amount != null) (l.pReadAmount, Money.format(item.amount!, cur)),
      if (item.date != null) (l.pReadDate, Dates.medium(item.date!, context.lang)),
      if (item.text('reference') != null) (l.pReadReference, item.text('reference')!),
      if (item.text('entity') != null) (l.pReadBank, item.text('entity')!),
      if (item.text('payerName') != null) (l.pReadPayer, item.text('payerName')!),
    ];
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(Bank.radius + 2),
        border: widget.focused ? Border.all(color: CorocColors.gold500, width: 2) : null,
      ),
      child: BankCard(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _Thumb(item: item),
            const SizedBox(width: 24),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(channelIcon(item.channel), size: 18, color: Bank.muted),
                      const SizedBox(width: 6),
                      Expanded(child: Text('${channelName(l, item.channel)} · ${whenText(l, item.createdAt, context.lang)}', style: t.bodySmall)),
                    ],
                  ),
                  const SizedBox(height: 10),
                  if (reading)
                    Row(
                      children: [
                        const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
                        const SizedBox(width: 12),
                        Text(l.intakeProcessing, style: t.titleMedium),
                      ],
                    )
                  else ...[
                    Text(item.clientName == null ? l.pWhoPaidUnknown : l.pLooksLike(item.clientName!), style: t.titleLarge),
                    if (item.contract != null) Text(l.pLoanTitle(item.contract!), style: t.bodyMedium?.copyWith(color: Bank.muted)),
                    const SizedBox(height: 14),
                    Wrap(
                      spacing: 28,
                      runSpacing: 10,
                      children: [
                        for (final (k, v) in facts)
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(k.toUpperCase(), style: t.labelSmall),
                              const SizedBox(height: 2),
                              Text(v, style: t.titleSmall?.copyWith(fontFamily: 'Inter')),
                            ],
                          ),
                      ],
                    ),
                    if (blocking.isNotEmpty) ...[const SizedBox(height: 14), InfoNote(flagText(l, blocking.first), tone: StatusTone.warn, icon: Icons.warning_amber_rounded)],
                    const SizedBox(height: 18),
                    Wrap(
                      spacing: 12,
                      runSpacing: 10,
                      children: [
                        if (_quick) GoldButton(label: l.pRegisterThisPayment, icon: Icons.check, busy: _busy, onPressed: _approve),
                        _quick
                            ? OutlinedButton(onPressed: _busy ? null : _review, child: Text(l.pReviewDetail))
                            : GoldButton(label: l.pReviewDetail, icon: Icons.fact_check_outlined, onPressed: _busy ? null : _review),
                        TextButton(onPressed: _busy ? null : _reject, child: Text(l.pNotAPayment)),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// La imagen del comprobante, pequeña; un toque la abre completa.
class _Thumb extends ConsumerStatefulWidget {
  const _Thumb({required this.item});
  final IntakeItem item;
  @override
  ConsumerState<_Thumb> createState() => _ThumbState();
}

class _ThumbState extends ConsumerState<_Thumb> {
  Future<Uint8List>? _bytes;

  @override
  void initState() {
    super.initState();
    if (!widget.item.isPdf) _bytes = fetchDocumentBytes(ref, widget.item.documentId);
  }

  @override
  Widget build(BuildContext context) {
    final box = BoxDecoration(
      color: Bank.canvas,
      borderRadius: BorderRadius.circular(14),
      border: Border.all(color: Bank.line),
    );
    Widget icon(IconData i) => Center(child: Icon(i, size: 36, color: Bank.muted));
    return InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: () => openDocument(context, widget.item.documentId),
      child: Container(
        width: 140,
        height: 180,
        clipBehavior: Clip.antiAlias,
        decoration: box,
        child: _bytes == null
            ? icon(Icons.picture_as_pdf_outlined)
            : FutureBuilder<Uint8List>(
                future: _bytes,
                builder: (context, snap) => snap.hasData
                    ? Image.memory(snap.data!, fit: BoxFit.cover, errorBuilder: (_, _, _) => icon(Icons.image_not_supported_outlined))
                    : (snap.hasError ? icon(Icons.image_not_supported_outlined) : const Center(child: CircularProgressIndicator(strokeWidth: 2))),
              ),
      ),
    );
  }
}

/// Un comprobante que COROC registró solo: con su recibo y, durante 72 horas, «Deshacer».
class _AutoRow extends ConsumerStatefulWidget {
  const _AutoRow({required this.item});
  final IntakeItem item;
  @override
  ConsumerState<_AutoRow> createState() => _AutoRowState();
}

class _AutoRowState extends ConsumerState<_AutoRow> {
  bool _busy = false;

  Future<void> _undo() async {
    final l = context.l10n;
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(l.pUndoTitle),
        content: SizedBox(width: 420, child: Text(l.pUndoBody)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(l.actionCancel)),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(l.pUndo)),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _busy = true);
    try {
      await ref.read(apiProvider).revertIntake(widget.item.id, reason: l.pUndoReason);
      ref
        ..invalidate(autoReceiptsProvider)
        ..invalidate(pendingReceiptsProvider);
      PersonalRealtime.refreshMoney(ref, clientId: widget.item.clientId);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(context, e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final item = widget.item;
    return LedgerRow(
      icon: channelIcon(item.channel),
      title: item.clientName ?? '—',
      subtitle: [if (item.receiptNumber != null) l.pMoveReceipt(item.receiptNumber!), channelName(l, item.channel)].join(' · '),
      amount: item.amount == null ? '—' : '+ ${Money.format(item.amount!, item.currency ?? 'COP')}',
      when: whenText(l, item.updatedAt ?? item.createdAt, context.lang),
      trailingNote: item.revertible ? TextButton.icon(onPressed: _busy ? null : _undo, icon: const Icon(Icons.undo, size: 18), label: Text(l.pUndo)) : null,
      onTap: item.receiptDocumentId == null ? null : () => openDocument(context, item.receiptDocumentId!),
    );
  }
}
