import 'dart:async';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pdfrx/pdfrx.dart';
import 'package:uuid/uuid.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/brand.dart';
import '../../design/widgets/common.dart';
import '../documents/documents.dart';
import '../loans/loan_providers.dart';
import 'inbox_page.dart';

final intakeItemProvider = FutureProvider.autoDispose.family<IntakeItem, String>((ref, id) => ref.watch(apiProvider).intakeItem(id));

String fieldName(AppLocalizations l, String? field) => switch (field) {
      'amount' => l.intakeFieldAmount,
      'date' => l.intakeFieldDate,
      'payerName' => l.intakeFieldPayer,
      'receiverName' => l.intakeFieldReceiver,
      'reference' => l.intakeFieldReference,
      'entity' => l.intakeFieldEntity,
      _ => field ?? '',
    };

/// Alerta de validación en palabras del usuario (§13.4).
String flagText(AppLocalizations l, IntakeFlag f) => switch (f.code) {
      'MISSING_FIELD' => l.flagMissingField(fieldName(l, f.field)),
      'LOW_CONFIDENCE' => l.flagLowConfidence(fieldName(l, f.field)),
      'RECEIVER_MISMATCH' => l.flagReceiverMismatch,
      'PAYER_MISMATCH' => l.flagPayerMismatch,
      'PAYER_INFERRED' => l.flagPayerInferred,
      'FUTURE_DATE' => l.flagFutureDate,
      'BEFORE_DISBURSEMENT' => l.flagBeforeDisbursement,
      'TOO_OLD' => l.flagTooOld,
      'NON_POSITIVE_AMOUNT' => l.flagNonPositive,
      'CURRENCY_MISMATCH' => l.flagCurrencyMismatch,
      'TAMPER_SIGNAL' => l.flagTamper,
      'NOT_A_RECEIPT' => l.flagNotReceipt,
      'OCR_UNAVAILABLE' => l.flagUnreadable,
      'EXTRACTION_MISMATCH' => l.flagExtractionMismatch(fieldName(l, f.field)),
      'SENDER_UNKNOWN' => l.flagSenderUnknown,
      'SENDER_AMBIGUOUS' => l.flagSenderAmbiguous,
      'LOAN_AMBIGUOUS' => l.flagLoanAmbiguous,
      _ => f.code,
    };

/// Color por confianza: verde si alcanza el umbral de aplicación automática, ámbar si es dudosa, rojo si es baja.
StatusTone confidenceTone(double c) => c >= 0.95 ? StatusTone.ok : (c >= 0.8 ? StatusTone.warn : StatusTone.error);

class IntakeDetailPage extends StatelessWidget {
  const IntakeDetailPage({super.key, required this.intakeId});
  final String intakeId;

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(context.l10n.navInbox)),
        body: SafeArea(child: Padding(padding: const EdgeInsets.all(CorocSpace.md), child: IntakeDetailView(intakeId: intakeId, onDone: () => Navigator.of(context).maybePop()))),
      );
}

/// Vista dividida de la Bandeja (§13.6): el archivo con los campos resaltados y el formulario precargado con la
/// confianza de cada campo, el cliente y el préstamo, y la vista previa del saldo antes y después.
class IntakeDetailView extends ConsumerStatefulWidget {
  const IntakeDetailView({super.key, required this.intakeId, this.onDone});
  final String intakeId;
  final VoidCallback? onDone;
  @override
  ConsumerState<IntakeDetailView> createState() => _IntakeDetailViewState();
}

class _IntakeDetailViewState extends ConsumerState<IntakeDetailView> {
  Timer? _poll;

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final value = ref.watch(intakeItemProvider(widget.intakeId));
    return AsyncBody<IntakeItem>(
      value: value,
      onRetry: () => ref.invalidate(intakeItemProvider(widget.intakeId)),
      builder: (item) {
        // Mientras se lee, se consulta cada pocos segundos por si el evento en vivo no llega.
        _poll?.cancel();
        if (item.status == 'processing') _poll = Timer(const Duration(seconds: 3), () => ref.invalidate(intakeItemProvider(widget.intakeId)));
        final wide = MediaQuery.sizeOf(context).width >= CorocBreakpoints.tablet;
        final doc = _DocumentPane(item: item);
        final form = item.status == 'processing'
            ? Center(child: Column(mainAxisSize: MainAxisSize.min, children: [const CircularProgressIndicator(), const SizedBox(height: 16), Text(l.intakeProcessing)]))
            : _IntakeForm(key: ValueKey('${item.id}-${item.updatedAt}'), item: item, onDone: widget.onDone);
        if (wide) {
          return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(child: Card(clipBehavior: Clip.antiAlias, child: doc)),
            const SizedBox(width: CorocSpace.md),
            SizedBox(width: 420, child: SingleChildScrollView(child: form)),
          ]);
        }
        return ListView(children: [SizedBox(height: 360, child: Card(clipBehavior: Clip.antiAlias, child: doc)), const SizedBox(height: CorocSpace.md), form]);
      },
    );
  }
}

/// El comprobante original con un recuadro sobre cada campo leído.
class _DocumentPane extends ConsumerStatefulWidget {
  const _DocumentPane({required this.item});
  final IntakeItem item;
  @override
  ConsumerState<_DocumentPane> createState() => _DocumentPaneState();
}

class _DocumentPaneState extends ConsumerState<_DocumentPane> {
  late final Future<(Uint8List, double?)> _data = _load();

  Future<(Uint8List, double?)> _load() async {
    final bytes = await fetchDocumentBytes(ref, widget.item.documentId);
    if (widget.item.isPdf) return (bytes, null);
    try {
      final codec = await ui.instantiateImageCodec(bytes);
      final frame = await codec.getNextFrame();
      return (bytes, frame.image.width / frame.image.height);
    } catch (_) {
      return (bytes, null); // HEIC y otros formatos que el equipo no decodifica.
    }
  }

  List<(String, FieldRegion)> _regions(int page) {
    final out = <(String, FieldRegion)>[];
    for (final k in const ['amount', 'date', 'payerName', 'receiverName', 'reference', 'entity']) {
      final r = widget.item.field(k).region;
      if (r != null && r.page == page) out.add((k, r));
    }
    return out;
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return FutureBuilder<(Uint8List, double?)>(
      future: _data,
      builder: (context, snap) {
        if (snap.hasError) return ErrorState(message: errorText(context, snap.error!), onRetry: () => setState(() {}));
        if (!snap.hasData) return const Center(child: CircularProgressIndicator());
        final (bytes, ratio) = snap.data!;
        if (widget.item.isPdf) {
          return PdfViewer.data(
            bytes,
            sourceName: '${widget.item.documentId}.pdf',
            params: PdfViewerParams(
              backgroundColor: Theme.of(context).scaffoldBackgroundColor,
              pageOverlaysBuilder: (context, rect, page) => [Positioned.fill(child: IgnorePointer(child: CustomPaint(painter: RegionPainter(_regions(page.pageNumber - 1), Theme.of(context).colorScheme))))],
            ),
          );
        }
        if (ratio == null) return Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(l.intakePreviewUnavailable, textAlign: TextAlign.center)));
        return InteractiveViewer(
          maxScale: 6,
          child: Center(
            child: AspectRatio(
              aspectRatio: ratio,
              child: Stack(fit: StackFit.expand, children: [
                Image.memory(bytes, fit: BoxFit.fill, semanticLabel: widget.item.fileName ?? l.intakeFile),
                IgnorePointer(child: CustomPaint(painter: RegionPainter(_regions(0), Theme.of(context).colorScheme))),
              ]),
            ),
          ),
        );
      },
    );
  }
}

/// Dibuja los recuadros de los campos leídos (coordenadas en fracciones de la página).
class RegionPainter extends CustomPainter {
  RegionPainter(this.regions, this.scheme);
  final List<(String, FieldRegion)> regions;
  final ColorScheme scheme;

  @override
  void paint(Canvas canvas, Size size) {
    final stroke = Paint()
      ..color = CorocColors.gold500
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2;
    final fill = Paint()..color = CorocColors.gold500.withValues(alpha: 0.16);
    for (final (_, r) in regions) {
      final rect = Rect.fromLTWH(r.x * size.width - 3, r.y * size.height - 3, r.w * size.width + 6, r.h * size.height + 6);
      final rr = RRect.fromRectAndRadius(rect, const Radius.circular(4));
      canvas.drawRRect(rr, fill);
      canvas.drawRRect(rr, stroke);
    }
  }

  @override
  bool shouldRepaint(RegionPainter old) => old.regions != regions;
}

class _IntakeForm extends ConsumerStatefulWidget {
  const _IntakeForm({super.key, required this.item, this.onDone});
  final IntakeItem item;
  final VoidCallback? onDone;
  @override
  ConsumerState<_IntakeForm> createState() => _IntakeFormState();
}

class _IntakeFormState extends ConsumerState<_IntakeForm> {
  IntakeItem get it => widget.item;
  late final String _currency = it.currency ?? ref.read(sessionProvider)?.company.currency ?? 'COP';
  late final _amount = TextEditingController(text: it.amount == null ? '' : Money.format(it.amount!, _currency));
  late String? _date = it.date;
  late final _payer = TextEditingController(text: it.text('payerName') ?? '');
  late final _receiver = TextEditingController(text: it.text('receiverName') ?? '');
  late final _reference = TextEditingController(text: it.text('reference') ?? '');
  late final _entity = TextEditingController(text: it.text('entity') ?? '');
  late String? _clientId = it.clientId ?? it.identification.clientId;
  late String? _clientName = it.clientName;
  late String? _loanId = it.loanId;
  bool _saveSender = true;
  bool _busy = false;
  final _key = const Uuid().v4();
  PaymentPreview? _preview;
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    _amount.addListener(_schedulePreview);
    WidgetsBinding.instance.addPostFrameCallback((_) => _schedulePreview());
  }

  @override
  void dispose() {
    _debounce?.cancel();
    for (final c in [_amount, _payer, _receiver, _reference, _entity]) {
      c.dispose();
    }
    super.dispose();
  }

  int? get _amountValue => Money.parse(_amount.text, _currency);

  void _schedulePreview() {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), () async {
      final amount = _amountValue;
      if (!it.pending || _loanId == null || amount == null || amount <= 0 || _date == null) {
        if (mounted && _preview != null) setState(() => _preview = null);
        return;
      }
      try {
        final p = await ref.read(apiProvider).previewPayment(_loanId!, amount, _date!);
        if (mounted) setState(() => _preview = p);
      } catch (_) {
        if (mounted) setState(() => _preview = null);
      }
    });
  }

  Future<void> _act(Future<void> Function() action, {String? done}) async {
    setState(() => _busy = true);
    try {
      await action();
      ref.invalidate(intakeItemProvider(it.id));
      ref.invalidate(inboxProvider);
      ref.invalidate(intakeSummaryProvider);
      if (mounted && done != null) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(done)));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(context, e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  bool get _canApprove => it.pending && _clientId != null && _loanId != null && (_amountValue ?? 0) > 0 && _date != null && !_busy;

  Future<void> _approve() async {
    if (!_canApprove) return;
    final l = context.l10n;
    String? v(TextEditingController c) => c.text.trim().isEmpty ? null : c.text.trim();
    await _act(() async {
      final r = await ref.read(apiProvider).approveIntake(it.id,
          clientId: _clientId!, loanId: _loanId!, amount: _amountValue!, date: _date!, idempotencyKey: _key,
          payerName: v(_payer), receiverName: v(_receiver), reference: v(_reference), institution: v(_entity),
          saveSenderAsSecondaryNumber: it.senderPhone != null && it.status == 'unassigned' && _saveSender);
      ref.invalidate(clientProvider(_clientId!));
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l.intakeApproved(r.receipt.number))));
    });
  }

  Future<void> _reject() async {
    final l = context.l10n;
    final reason = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(l.intakeReject),
        content: TextField(controller: reason, autofocus: true, maxLength: 500, decoration: corocInput(context, label: l.intakeRejectReason)),
        actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: Text(l.actionCancel)), FilledButton(onPressed: () => Navigator.pop(c, reason.text.trim().isNotEmpty), child: Text(l.intakeReject))],
      ),
    );
    if (ok == true) await _act(() => ref.read(apiProvider).rejectIntake(it.id, reason.text.trim()), done: l.intakeStatusRejected);
    reason.dispose();
  }

  Future<void> _revert() async {
    final l = context.l10n;
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(l.intakeRevert),
        content: Text(l.intakeRevertConfirm),
        actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: Text(l.actionCancel)), FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(l.intakeRevert))],
      ),
    );
    if (ok == true) await _act(() => ref.read(apiProvider).revertIntake(it.id), done: l.intakeStatusReview);
  }

  Future<void> _pickClient() async {
    final picked = await showDialog<ClientListItem>(context: context, builder: (_) => const _ClientSearchDialog());
    if (picked != null) {
      setState(() {
        _clientId = picked.id;
        _clientName = picked.fullName;
        _loanId = null;
      });
    }
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final d = await showDatePicker(context: context, initialDate: _date == null ? now : DateTime.parse(_date!), firstDate: DateTime(now.year - 2), lastDate: now);
    if (d != null) {
      setState(() => _date = Dates.iso(d));
      _schedulePreview();
    }
  }

  Widget _confidence(String field) {
    final f = it.field(field);
    if (f.value == null) return const SizedBox.shrink();
    final pct = '${(f.confidence * 100).round()} %';
    return Tooltip(message: context.l10n.intakeConfidence(pct), child: StatusDot(label: pct, tone: confidenceTone(f.confidence)));
  }

  Widget _text(TextEditingController c, String label, String field, {bool enabled = true}) => Padding(
        padding: const EdgeInsets.only(bottom: CorocSpace.sm),
        child: TextField(controller: c, enabled: enabled, onSubmitted: (_) => _approve(), decoration: corocInput(context, label: label, suffix: Padding(padding: const EdgeInsets.only(right: 8), child: _confidence(field)))),
      );

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    final auth = ref.watch(authProvider);
    final user = auth is SignedIn ? auth.user : null;
    final canApprove = user?.can('payments.register') ?? false;
    final canRevert = user?.can('payments.reverse') ?? false;
    final editable = it.pending && canApprove;
    final (status, tone) = intakeStatusLabel(l, it.status);
    final (channel, channelIcon) = channelLabel(l, it.channel);
    final loans = _clientId == null ? null : ref.watch(clientProvider(_clientId!));
    final active = loans?.valueOrNull?.loans.where((x) => x.status == 'active').toList() ?? const <Loan>[];
    if (_loanId == null && active.length == 1 && editable) {
      _loanId = active.first.id;
      _schedulePreview();
    }

    return CallbackShortcuts(
      bindings: {const SingleActivator(LogicalKeyboardKey.enter): _approve, const SingleActivator(LogicalKeyboardKey.numpadEnter): _approve},
      child: Focus(
        autofocus: true,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          SectionCard(
            title: status,
            trailing: StatusDot(label: it.stage.replaceAll('_', ' '), tone: tone),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Icon(channelIcon, size: 18),
                const SizedBox(width: 8),
                Expanded(child: Text([channel, ?it.senderPhone, ?it.senderEmail].join(' · '), style: t.bodyMedium)),
              ]),
              const SizedBox(height: 4),
              Text(Dates.dateTime(it.createdAt, context.lang), style: t.bodySmall),
              if (it.messageText != null) ...[const SizedBox(height: 8), Text('«${it.messageText}»', style: t.bodyMedium?.copyWith(fontStyle: FontStyle.italic))],
              if (it.identification.duplicateOf != null) ...[const SizedBox(height: 8), Text(l.intakeDuplicateOf, style: t.bodyMedium)],
              if (it.reason != null) ...[const SizedBox(height: 8), Text(it.reason!, style: t.bodyMedium)],
              for (final f in it.flags) ...[
                const SizedBox(height: 8),
                Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Icon(f.blocking ? Icons.error_outline : Icons.info_outline, size: 18, color: f.blocking ? Theme.of(context).colorScheme.error : Theme.of(context).colorScheme.tertiary),
                  const SizedBox(width: 8),
                  Expanded(child: Text(flagText(l, f), style: t.bodyMedium)),
                ]),
              ],
              for (final s in it.tamperSignals) Text('· $s', style: t.bodySmall),
              if (it.engine != null) ...[const SizedBox(height: 8), Text(l.intakeReadBy(it.engine == 'rules' ? l.intakeEngineRules : it.engine!), style: t.bodySmall)],
            ]),
          ),
          const SizedBox(height: CorocSpace.md),
          SectionCard(
            title: l.intakeFields,
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              _text(_amount, '${l.intakeFieldAmount} ($_currency)', 'amount', enabled: editable),
              Padding(
                padding: const EdgeInsets.only(bottom: CorocSpace.sm),
                child: InkWell(
                  onTap: editable ? _pickDate : null,
                  borderRadius: BorderRadius.circular(CorocRadii.control),
                  child: InputDecorator(
                    decoration: corocInput(context, label: l.intakeFieldDate, suffix: Row(mainAxisSize: MainAxisSize.min, children: [_confidence('date'), const SizedBox(width: 8), const Icon(Icons.event_outlined)])),
                    child: Text(_date == null ? '—' : Dates.medium(_date!, context.lang)),
                  ),
                ),
              ),
              _text(_payer, l.intakeFieldPayer, 'payerName', enabled: editable),
              _text(_receiver, l.intakeFieldReceiver, 'receiverName', enabled: editable),
              _text(_reference, l.intakeFieldReference, 'reference', enabled: editable),
              _text(_entity, l.intakeFieldEntity, 'entity', enabled: editable),
            ]),
          ),
          const SizedBox(height: CorocSpace.md),
          SectionCard(
            title: l.intakeClient,
            trailing: editable ? TextButton.icon(onPressed: _pickClient, icon: const Icon(Icons.person_search_outlined, size: 18), label: Text(l.intakeChooseClient)) : null,
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text(_clientName ?? l.inboxUnassignedClient, style: t.titleMedium),
              if (editable && it.identification.candidates.isNotEmpty) ...[
                const SizedBox(height: 8),
                Overline(l.intakeSuggested),
                const SizedBox(height: 4),
                Wrap(spacing: 8, runSpacing: 8, children: [
                  for (final c in it.identification.candidates.take(5))
                    ChoiceChip(
                      label: Text(c.name ?? c.code ?? c.clientId.substring(0, 8)),
                      selected: c.clientId == _clientId,
                      onSelected: (_) => setState(() {
                        _clientId = c.clientId;
                        _clientName = c.name;
                        _loanId = null;
                      }),
                    ),
                ]),
              ],
              if (_clientId != null) ...[
                const SizedBox(height: CorocSpace.md),
                if (loans?.isLoading ?? false)
                  const LinearProgressIndicator()
                else if (active.isEmpty && editable)
                  Text(l.intakeNoLoans, style: t.bodyMedium?.copyWith(color: Theme.of(context).colorScheme.error))
                else
                  DropdownMenu<String>(
                    key: ValueKey('$_clientId-$_loanId'),
                    enabled: editable,
                    expandedInsets: EdgeInsets.zero,
                    label: Text(l.intakeLoan),
                    initialSelection: _loanId,
                    onSelected: (v) {
                      setState(() => _loanId = v);
                      _schedulePreview();
                    },
                    dropdownMenuEntries: [
                      for (final x in active) DropdownMenuEntry(value: x.id, label: '${x.contract} · ${Money.format(x.summary.balance, x.terms.currency)}'),
                      if (it.loanId != null && active.every((x) => x.id != it.loanId)) DropdownMenuEntry(value: it.loanId!, label: it.contract ?? it.loanId!),
                    ],
                  ),
              ],
              if (editable && it.senderPhone != null && it.status == 'unassigned' && _clientId != null)
                CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  value: _saveSender,
                  onChanged: (v) => setState(() => _saveSender = v ?? false),
                  title: Text(l.intakeSaveSender(it.senderPhone!)),
                ),
            ]),
          ),
          if (_preview case final p?) ...[
            const SizedBox(height: CorocSpace.md),
            SectionCard(
              title: l.intakePreview,
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Text(p.coverage, style: t.bodyMedium),
                KeyValue(l.intakeBalanceBefore, Money.format(p.previousBalance, _currency)),
                KeyValue(l.intakeBalanceAfter, Money.format(p.newBalance, _currency), emphasize: true),
              ]),
            ),
          ],
          const SizedBox(height: CorocSpace.md),
          if (editable)
            Wrap(spacing: 8, runSpacing: 8, alignment: WrapAlignment.end, children: [
              TextButton(onPressed: _busy ? null : () => _act(() => ref.read(apiProvider).archiveIntake(it.id), done: l.intakeStatusArchived), child: Text(l.intakeArchive)),
              OutlinedButton(onPressed: _busy ? null : _reject, child: Text(l.intakeReject)),
              GoldButton(label: l.intakeApprove, icon: Icons.check, busy: _busy, onPressed: _canApprove ? _approve : null),
            ]),
          if (it.receiptNumber != null)
            Card(
              child: ListTile(
                leading: const Icon(Icons.receipt_long_outlined),
                title: Text(l.intakeApproved(it.receiptNumber!)),
                subtitle: it.revertible ? Text(l.intakeRevertUntil(Dates.dateTime(it.revertibleUntil!, context.lang))) : null,
                trailing: it.receiptDocumentId == null ? null : TextButton(onPressed: () => openDocument(context, it.receiptDocumentId!), child: Text(l.intakeOpenReceipt)),
              ),
            ),
          if (it.revertible && canRevert)
            Align(alignment: Alignment.centerRight, child: OutlinedButton.icon(onPressed: _busy ? null : _revert, icon: const Icon(Icons.undo), label: Text(l.intakeRevert))),
          Align(alignment: Alignment.centerRight, child: TextButton.icon(onPressed: () => openDocument(context, it.documentId), icon: const Icon(Icons.open_in_new, size: 18), label: Text(l.intakeOpenFile))),
        ]),
      ),
    );
  }
}

/// Búsqueda de cliente para asignar o reasignar un comprobante.
class _ClientSearchDialog extends ConsumerStatefulWidget {
  const _ClientSearchDialog();
  @override
  ConsumerState<_ClientSearchDialog> createState() => _ClientSearchDialogState();
}

class _ClientSearchDialogState extends ConsumerState<_ClientSearchDialog> {
  final _q = TextEditingController();
  Timer? _debounce;
  List<ClientListItem> _items = const [];

  @override
  void initState() {
    super.initState();
    _search('');
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _q.dispose();
    super.dispose();
  }

  void _search(String q) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () async {
      try {
        final page = await ref.read(apiProvider).clients(q: q.trim().isEmpty ? null : q.trim(), status: 'active', limit: 20);
        if (mounted) setState(() => _items = page.items);
      } catch (_) {}
    });
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return AlertDialog(
      title: Text(l.intakeChooseClient),
      content: SizedBox(
        width: 420,
        height: 420,
        child: Column(children: [
          TextField(controller: _q, autofocus: true, onChanged: _search, decoration: corocInput(context, label: l.intakeSearchClient, prefix: const Icon(Icons.search))),
          const SizedBox(height: 8),
          Expanded(
            child: ListView(children: [
              for (final c in _items) ListTile(title: Text(c.fullName), subtitle: Text(c.code), onTap: () => Navigator.pop(context, c)),
            ]),
          ),
        ]),
      ),
      actions: [TextButton(onPressed: () => Navigator.pop(context), child: Text(l.actionCancel))],
    );
  }
}
