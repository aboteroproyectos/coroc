import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../../core/api/api_exception.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/brand.dart';
import '../../design/widgets/common.dart';
import '../documents/documents.dart';
import '../dashboard/dashboard_page.dart';
import 'loan_providers.dart';

/// Registro de pago (§14) en hoja inferior (móvil) o diálogo (escritorio), con vista previa exacta de la cobertura.
Future<PaymentResult?> showPaymentSheet(BuildContext context, WidgetRef ref, {required String loanId, required String currency, required int suggested, String? clientName}) {
  final wide = MediaQuery.sizeOf(context).width >= CorocBreakpoints.tablet;
  final sheet = PaymentForm(loanId: loanId, currency: currency, suggested: suggested, clientName: clientName);
  if (wide) {
    return showDialog<PaymentResult>(
      context: context,
      builder: (_) => Dialog(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 520), child: sheet)),
    );
  }
  return showModalBottomSheet<PaymentResult>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    showDragHandle: true,
    builder: (sheetContext) => Padding(padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(sheetContext).bottom), child: sheet),
  );
}

class PaymentForm extends ConsumerStatefulWidget {
  const PaymentForm({super.key, required this.loanId, required this.currency, required this.suggested, this.clientName});
  final String loanId;
  final String currency;
  final int suggested;
  final String? clientName;

  @override
  ConsumerState<PaymentForm> createState() => _PaymentFormState();
}

class _PaymentFormState extends ConsumerState<PaymentForm> {
  late final TextEditingController _amount;
  final _reference = TextEditingController();
  final _note = TextEditingController();
  final _otherMethod = TextEditingController();
  // Una clave por pago: si la red falla y se reintenta, el servidor no lo registra dos veces.
  final _idempotencyKey = const Uuid().v4();
  String _date = Dates.isoToday();
  String _method = 'cash';
  Timer? _debounce;
  PaymentPreview? _preview;
  String? _previewError;
  bool _busy = false;
  String? _error;
  PaymentResult? _result;

  @override
  void initState() {
    super.initState();
    final digits = Money.digits(widget.currency);
    final v = widget.suggested / (digits == 0 ? 1 : 100);
    _amount = TextEditingController(text: digits == 0 ? '${widget.suggested}' : v.toStringAsFixed(2));
    _schedulePreview();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _amount.dispose();
    _reference.dispose();
    _note.dispose();
    _otherMethod.dispose();
    super.dispose();
  }

  int? get _minor => Money.parse(_amount.text, widget.currency);

  void _schedulePreview() {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () async {
      final amount = _minor;
      if (amount == null || amount <= 0) {
        if (mounted) setState(() => _preview = null);
        return;
      }
      try {
        final p = await ref.read(apiProvider).previewPayment(widget.loanId, amount, _date);
        if (mounted) {
          setState(() {
            _preview = p;
            _previewError = null;
          });
        }
      } on ApiException catch (e) {
        if (mounted) {
          setState(() {
            _preview = null;
            _previewError = errorText(context, e);
          });
        }
      }
    });
  }

  String _methodText(AppLocalizations l) => switch (_method) {
        'cash' => l.methodCash,
        'transfer' => l.methodTransfer,
        'nequi' => 'Nequi',
        'daviplata' => 'Daviplata',
        _ => _otherMethod.text.trim(),
      };

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(context: context, initialDate: DateTime.parse(_date), firstDate: DateTime(now.year - 2), lastDate: now);
    if (picked == null) return;
    setState(() => _date = '${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}');
    _schedulePreview();
  }

  Future<void> _submit() async {
    final l = context.l10n;
    final amount = _minor;
    if (amount == null || amount <= 0) {
      setState(() => _error = l.paymentAmountInvalid);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final container = ProviderScope.containerOf(context, listen: false);
    try {
      final r = await container.read(apiProvider).pay(
            widget.loanId,
            amount: amount,
            date: _date,
            idempotencyKey: _idempotencyKey,
            method: _methodText(l).isEmpty ? null : _methodText(l),
            reference: _reference.text.trim().isEmpty ? null : _reference.text.trim(),
            note: _note.text.trim().isEmpty ? null : _note.text.trim(),
            cash: _method == 'cash',
          );
      await HapticFeedback.mediumImpact();
      container
        ..invalidate(loanProvider(widget.loanId))
        ..invalidate(scheduleProvider(widget.loanId))
        ..invalidate(ledgerProvider(widget.loanId))
        ..invalidate(dashboardProvider)
        ..invalidate(todayProvider);
      if (mounted) setState(() => _result = r);
    } catch (e) {
      if (mounted) setState(() => _error = errorText(context, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    if (_result != null) {
      return SingleChildScrollView(
        padding: const EdgeInsets.all(CorocSpace.lg),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          ReceiptSummary(receipt: _result!.receipt, surplus: _result!.surplus),
          const SizedBox(height: CorocSpace.lg),
          _ReceiptPdfButton(loanId: widget.loanId, entryId: _result!.entry.id),
          const SizedBox(height: CorocSpace.sm),
          GoldButton(label: l.actionDone, onPressed: () => Navigator.of(context).pop(_result), expand: true),
        ]),
      );
    }
    return SingleChildScrollView(
      padding: const EdgeInsets.all(CorocSpace.lg),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(l.paymentTitle, style: t.headlineSmall),
        if (widget.clientName != null) Text(widget.clientName!, style: t.bodyMedium?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant)),
        const SizedBox(height: CorocSpace.lg),
        TextField(
          controller: _amount,
          autofocus: true,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          style: t.headlineSmall?.copyWith(fontFamily: 'Inter'),
          decoration: corocInput(context, label: l.paymentAmount, prefix: const Icon(Icons.payments_outlined)),
          onChanged: (_) => _schedulePreview(),
        ),
        const SizedBox(height: CorocSpace.md),
        OutlinedButton.icon(onPressed: _pickDate, icon: const Icon(Icons.event), label: Text('${l.paymentDate}: ${Dates.medium(_date, context.lang)}')),
        const SizedBox(height: CorocSpace.md),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final m in [('cash', l.methodCash), ('transfer', l.methodTransfer), ('nequi', 'Nequi'), ('daviplata', 'Daviplata'), ('other', l.methodOther)])
            ChoiceChip(label: Text(m.$2), selected: _method == m.$1, onSelected: (_) => setState(() => _method = m.$1)),
        ]),
        if (_method == 'other') ...[
          const SizedBox(height: CorocSpace.md),
          TextField(controller: _otherMethod, decoration: corocInput(context, label: l.paymentMethodOther)),
        ],
        if (_method != 'cash') ...[
          const SizedBox(height: CorocSpace.md),
          TextField(controller: _reference, decoration: corocInput(context, label: l.paymentReference)),
        ],
        const SizedBox(height: CorocSpace.md),
        TextField(controller: _note, decoration: corocInput(context, label: l.paymentNote), maxLines: 2),
        const SizedBox(height: CorocSpace.lg),
        if (_preview != null)
          Container(
            padding: const EdgeInsets.all(CorocSpace.md),
            decoration: BoxDecoration(border: Border.all(color: Theme.of(context).colorScheme.outline), borderRadius: BorderRadius.circular(CorocRadii.control)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Overline(l.paymentPreview),
              const SizedBox(height: 8),
              Text(_preview!.coverage, style: t.bodyMedium),
              const SizedBox(height: 8),
              KeyValue(l.receiptPreviousBalance, Money.format(_preview!.previousBalance, widget.currency)),
              KeyValue(l.receiptNewBalance, Money.format(_preview!.newBalance, widget.currency), emphasize: true),
              KeyValue(l.receiptRemaining, '${_preview!.remainingInstallments}'),
              if (_preview!.surplus > 0) KeyValue(l.paymentSurplus, Money.format(_preview!.surplus, widget.currency)),
            ]),
          )
        else if (_previewError != null)
          Text(_previewError!, style: t.bodyMedium?.copyWith(color: Theme.of(context).colorScheme.error)),
        if (_error != null) ...[
          const SizedBox(height: CorocSpace.md),
          Text(_error!, style: t.bodyMedium?.copyWith(color: Theme.of(context).colorScheme.error)),
        ],
        const SizedBox(height: CorocSpace.lg),
        GoldButton(label: l.paymentConfirm, icon: Icons.check, onPressed: _submit, busy: _busy, expand: true),
      ]),
    );
  }
}

/// Resumen del recibo «Gracias por tu pago» (§15). El PDF con el mismo contenido se genera en el servidor segundos después.
class ReceiptSummary extends StatelessWidget {
  const ReceiptSummary({super.key, required this.receipt, this.surplus = 0});
  final ReceiptData receipt;
  final int surplus;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    String m(int v) => Money.format(v, receipt.currency);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Container(height: 4, decoration: const BoxDecoration(gradient: CorocColors.brandGradient, borderRadius: BorderRadius.all(Radius.circular(2)))),
      const SizedBox(height: CorocSpace.lg),
      Row(children: [
        const CorocLogo(layout: LogoLayout.isotype, height: 36),
        const SizedBox(width: 12),
        Expanded(child: Text(l.receiptThanks, style: t.headlineSmall)),
        if (receipt.voided) StatusDot(label: l.receiptVoided, tone: StatusTone.error),
      ]),
      const SizedBox(height: CorocSpace.md),
      Row(children: [
        Expanded(child: _Big(label: l.receiptPaid, value: m(receipt.payment.amount), gold: true)),
        const SizedBox(width: CorocSpace.md),
        Expanded(child: _Big(label: l.receiptNewBalance, value: m(receipt.newBalance))),
      ]),
      const SizedBox(height: CorocSpace.md),
      KeyValue(l.receiptNumber, receipt.number),
      KeyValue(l.receiptIssued, receipt.issuedAt),
      KeyValue(l.receiptContract, receipt.contract),
      KeyValue(l.receiptPaymentDate, Dates.medium(receipt.payment.date, context.lang)),
      if ((receipt.payment.method ?? '').isNotEmpty) KeyValue(l.receiptMethod, [receipt.payment.method, receipt.payment.reference].whereType<String>().where((s) => s.isNotEmpty).join(' · ')),
      KeyValue(l.receiptTotalInstallments, '${receipt.totalInstallments}'),
      KeyValue(l.receiptCoverage, receipt.coverage),
      KeyValue(l.receiptRemaining, '${receipt.remainingInstallments}'),
      KeyValue(l.receiptAccumulated, m(receipt.accumulatedPaid)),
      KeyValue(l.receiptPreviousBalance, m(receipt.previousBalance)),
      if (receipt.next != null) KeyValue(l.receiptNext, '${Dates.medium(receipt.next!.dueDate, context.lang)} · ${m(receipt.next!.amount)}'),
      if (surplus > 0) KeyValue(l.paymentSurplus, m(surplus)),
      KeyValue(l.receiptVerification, receipt.verificationCode),
    ]);
  }
}

class _Big extends StatelessWidget {
  const _Big({required this.label, required this.value, this.gold = false});
  final String label;
  final String value;
  final bool gold;
  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      padding: const EdgeInsets.all(CorocSpace.md),
      decoration: BoxDecoration(border: Border.all(color: Theme.of(context).colorScheme.outline), borderRadius: BorderRadius.circular(CorocRadii.control)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Overline(label),
        const SizedBox(height: 6),
        FittedBox(
          fit: BoxFit.scaleDown,
          alignment: Alignment.centerLeft,
          child: Text(value, style: t.headlineMedium?.copyWith(fontFamily: 'Inter', fontWeight: FontWeight.w400, color: gold ? (dark ? CorocColors.gold300 : CorocColors.gold800) : null)),
        ),
      ]),
    );
  }
}

/// Abre el PDF del recibo (§15) cuando el servidor termina de generarlo, para verlo o compartirlo con el deudor.
class _ReceiptPdfButton extends ConsumerStatefulWidget {
  const _ReceiptPdfButton({required this.loanId, required this.entryId});
  final String loanId;
  final String entryId;
  @override
  ConsumerState<_ReceiptPdfButton> createState() => _ReceiptPdfButtonState();
}

class _ReceiptPdfButtonState extends ConsumerState<_ReceiptPdfButton> {
  late final Future<String?> _doc = waitForReceiptPdf(ref, widget.loanId, widget.entryId);

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return FutureBuilder<String?>(
      future: _doc,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return OutlinedButton.icon(onPressed: null, icon: const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)), label: Text(l.receiptPdfPreparing));
        }
        final id = snap.data;
        if (id == null) return Text(l.receiptPdfPending, textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodySmall);
        return OutlinedButton.icon(onPressed: () => openDocument(context, id), icon: const Icon(Icons.picture_as_pdf_outlined), label: Text(l.receiptOpenPdf));
      },
    );
  }
}
