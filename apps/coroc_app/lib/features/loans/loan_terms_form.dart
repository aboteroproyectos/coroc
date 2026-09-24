import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/brand.dart';
import '../../design/widgets/common.dart';
import '../../design/widgets/labels.dart';

/// «20» o «1,87» (por ciento) → «0.2» o «0.0187» (fracción decimal exacta, sin binario flotante; ADR-001).
String? percentToRate(String input) {
  final s = input.trim().replaceAll(',', '.');
  final m = RegExp(r'^(\d{1,4})(?:\.(\d{0,6}))?$').firstMatch(s);
  if (m == null) return null;
  final micro = BigInt.parse(m.group(1)!) * BigInt.from(1000000) + BigInt.parse((m.group(2) ?? '').padRight(6, '0'));
  // micro = por ciento × 10^6  →  fracción = micro / 10^8
  final txt = micro.toString().padLeft(9, '0');
  final whole = txt.substring(0, txt.length - 8);
  final frac = txt.substring(txt.length - 8).replaceFirst(RegExp(r'0+$'), '');
  return frac.isEmpty ? whole : '$whole.$frac';
}

/// «0.0187» → «1,87» en el idioma.
String rateToPercentText(String rate, String lang) {
  final parts = rate.split('.');
  final micro = BigInt.parse(parts[0]) * BigInt.from(100000000) + BigInt.parse((parts.length > 1 ? parts[1] : '').padRight(8, '0').substring(0, 8));
  final pct = micro.toDouble() / 1000000;
  final text = pct.toStringAsFixed(4).replaceFirst(RegExp(r'\.?0+$'), '');
  return lang == 'en' ? text : text.replaceAll('.', ',');
}

/// Estado del formulario de condiciones del préstamo (§8.2). El asistente lo lee al guardar.
class LoanTermsController extends ChangeNotifier {
  LoanTermsController({required this.currency}) : disbursementDate = Dates.isoToday();
  String currency;
  final principal = TextEditingController();
  final rate = TextEditingController();
  final installments = TextEditingController();
  final contract = TextEditingController();
  String method = 'simple';
  String frequency = 'daily';
  String disbursementDate;
  String? firstDueDate;
  int? monthlyDay;
  Set<int> collectionDays = {1, 2, 3, 4, 5, 6};
  bool excludeHolidays = true;
  LoanPreview? preview;
  /// El usuario confirmó este préstamo por encima del tope (solo si la empresa lo permite, ADR-061).
  bool acknowledgeCap = false;

  void touch() => notifyListeners();

  Map<String, dynamic>? toTerms() {
    final p = Money.parse(principal.text, currency);
    final r = percentToRate(rate.text);
    final n = int.tryParse(installments.text.trim());
    if (p == null || p <= 0 || r == null || n == null || n < 1) return null;
    return {
      'principal': p,
      'currency': currency,
      'method': method,
      'rate': r,
      'installments': n,
      'frequency': frequency,
      'disbursementDate': disbursementDate,
      'firstDueDate': ?firstDueDate,
      'collectionDays': (collectionDays.toList()..sort()),
      'excludeHolidays': excludeHolidays,
      if (frequency == 'monthly' && monthlyDay != null) 'monthlyDay': monthlyDay,
    };
  }

  Map<String, dynamic>? toLoanInput() {
    final t = toTerms();
    if (t == null) return null;
    return {...t, if (contract.text.trim().isNotEmpty) 'contract': contract.text.trim(), if (overCap) 'acknowledgeRateCap': true};
  }

  /// Guardar solo si la vista previa confirma que la tasa cumple el tope (o no hay tope fuera de Colombia), o si la
  /// empresa permite superarlo y el usuario lo confirmó para este préstamo.
  bool get compliant => preview != null && (preview!.rateCap.ok || overCap);

  /// Por encima del tope (o sin tope en Colombia) con la confirmación del usuario.
  bool get overCap => preview != null && !preview!.rateCap.ok && preview!.rateCap.overridable && acknowledgeCap;

  @override
  void dispose() {
    principal.dispose();
    rate.dispose();
    installments.dispose();
    contract.dispose();
    super.dispose();
  }
}

/// Condiciones del préstamo con vista previa en vivo: cuota, calendario, total, utilidad, tasa efectiva anual y tope (§8.3).
class LoanTermsForm extends ConsumerStatefulWidget {
  const LoanTermsForm({super.key, required this.controller, this.showContract = true});
  final LoanTermsController controller;
  final bool showContract;
  @override
  ConsumerState<LoanTermsForm> createState() => _LoanTermsFormState();
}

class _LoanTermsFormState extends ConsumerState<LoanTermsForm> {
  Timer? _debounce;
  String? _previewError;
  bool _loading = false;
  bool _showAll = false;

  LoanTermsController get c => widget.controller;

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  void _changed() {
    c.preview = null;
    // Otras condiciones, otra confirmación: la anterior no vale para una tasa distinta.
    c.acknowledgeCap = false;
    c.touch();
    setState(() {});
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), _fetch);
  }

  Future<void> _fetch() async {
    final terms = c.toTerms();
    if (terms == null) return;
    setState(() {
      _loading = true;
      _previewError = null;
    });
    try {
      final p = await ref.read(apiProvider).previewLoan(terms);
      if (!mounted) return;
      c.preview = p;
      c.touch();
    } on ApiException catch (e) {
      if (mounted) _previewError = errorText(context, e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _pick(bool first) async {
    final now = DateTime.now();
    final initial = DateTime.tryParse(first ? (c.firstDueDate ?? c.disbursementDate) : c.disbursementDate) ?? now;
    final d = await showDatePicker(context: context, initialDate: initial, firstDate: DateTime(now.year - 3), lastDate: DateTime(now.year + 3));
    if (d == null) return;
    final iso = '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
    if (first) {
      c.firstDueDate = iso;
    } else {
      c.disbursementDate = iso;
    }
    _changed();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    const gap = SizedBox(height: CorocSpace.md);
    Widget pair(Widget a, Widget b) => LayoutBuilder(builder: (context, cns) {
          if (cns.maxWidth < 560) return Column(children: [a, gap, b]);
          return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [Expanded(child: a), const SizedBox(width: CorocSpace.md), Expanded(child: b)]);
        });
    final days = weekdayShort(l);
    final p = c.preview;
    String m(int v) => Money.format(v, c.currency);

    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      pair(
        TextField(controller: c.principal, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: corocInput(context, label: '${l.fieldPrincipal} *', helper: c.currency), onChanged: (_) => _changed()),
        TextField(controller: c.installments, keyboardType: TextInputType.number, decoration: corocInput(context, label: '${l.fieldInstallments} *'), onChanged: (_) => _changed()),
      ),
      gap,
      Wrap(spacing: CorocSpace.md, runSpacing: CorocSpace.sm, crossAxisAlignment: WrapCrossAlignment.center, children: [
        SegmentedButton<String>(
          showSelectedIcon: false,
          segments: [ButtonSegment(value: 'simple', label: Text(l.methodSimple)), ButtonSegment(value: 'french', label: Text(l.methodFrench))],
          selected: {c.method},
          onSelectionChanged: (v) {
            c.method = v.first;
            _changed();
          },
        ),
        SegmentedButton<String>(
          showSelectedIcon: false,
          segments: [ButtonSegment(value: 'daily', label: Text(l.freqDaily)), ButtonSegment(value: 'weekly', label: Text(l.freqWeekly)), ButtonSegment(value: 'monthly', label: Text(l.freqMonthly))],
          selected: {c.frequency},
          onSelectionChanged: (v) {
            c.frequency = v.first;
            _changed();
          },
        ),
      ]),
      gap,
      TextField(
        controller: c.rate,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        decoration: corocInput(context, label: '${l.fieldRate} *', helper: c.method == 'french' ? l.rateHelpFrench : l.rateHelpSimple, suffix: const Padding(padding: EdgeInsets.all(14), child: Text('%'))),
        onChanged: (_) => _changed(),
      ),
      gap,
      Wrap(spacing: CorocSpace.sm, runSpacing: CorocSpace.sm, children: [
        OutlinedButton.icon(onPressed: () => _pick(false), icon: const Icon(Icons.event), label: Text('${l.fieldDisbursement}: ${Dates.medium(c.disbursementDate, context.lang)}')),
        OutlinedButton.icon(onPressed: () => _pick(true), icon: const Icon(Icons.event_repeat), label: Text('${l.fieldFirstDue}: ${c.firstDueDate == null ? l.automatic : Dates.medium(c.firstDueDate!, context.lang)}')),
        if (c.firstDueDate != null)
          IconButton(
            tooltip: l.automatic,
            onPressed: () {
              c.firstDueDate = null;
              _changed();
            },
            icon: const Icon(Icons.close),
          ),
      ]),
      if (c.frequency == 'daily') ...[
        gap,
        Text(l.fieldCollectionDays, style: t.bodyMedium),
        const SizedBox(height: 8),
        Wrap(spacing: 6, runSpacing: 6, children: [
          for (var d = 1; d <= 7; d++)
            FilterChip(
              label: Text(days[d - 1]),
              selected: c.collectionDays.contains(d),
              onSelected: (on) {
                if (on) {
                  c.collectionDays.add(d);
                } else if (c.collectionDays.length > 1) {
                  c.collectionDays.remove(d);
                }
                _changed();
              },
            ),
        ]),
      ],
      if (c.frequency == 'monthly') ...[
        gap,
        TextField(
          keyboardType: TextInputType.number,
          decoration: corocInput(context, label: l.fieldMonthlyDay, helper: l.fieldMonthlyDayHelp),
          onChanged: (v) {
            final d = int.tryParse(v);
            c.monthlyDay = d != null && d >= 1 && d <= 31 ? d : null;
            _changed();
          },
        ),
      ],
      SwitchListTile(
        contentPadding: EdgeInsets.zero,
        value: c.excludeHolidays,
        onChanged: (v) {
          c.excludeHolidays = v;
          _changed();
        },
        title: Text(l.fieldExcludeHolidays),
      ),
      if (widget.showContract) TextField(controller: c.contract, decoration: corocInput(context, label: l.fieldContract, helper: l.fieldContractHelp), onChanged: (_) => c.touch()),
      const SizedBox(height: CorocSpace.lg),
      // ─── Vista previa en vivo ───
      Container(
        padding: const EdgeInsets.all(CorocSpace.lg),
        decoration: BoxDecoration(border: Border.all(color: Theme.of(context).colorScheme.outline), borderRadius: BorderRadius.circular(CorocRadii.card)),
        child: _loading && p == null
            ? const Center(child: Padding(padding: EdgeInsets.all(CorocSpace.md), child: CircularProgressIndicator()))
            : p == null
                ? Text(_previewError ?? l.previewHint, style: t.bodyMedium?.copyWith(color: _previewError == null ? null : Theme.of(context).colorScheme.error))
                : Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    Overline(l.previewTitle),
                    const SizedBox(height: CorocSpace.md),
                    Wrap(spacing: CorocSpace.xl, runSpacing: CorocSpace.md, children: [
                      _Figure(label: l.previewInstallment, value: m(p.regularInstallment), gold: true),
                      _Figure(label: l.previewTotal, value: m(p.totalPayable)),
                      _Figure(label: l.previewProfit, value: m(p.totalInterest)),
                      _Figure(label: l.previewEffectiveRate, value: percent(p.effectiveAnnualRate, context.lang)),
                    ]),
                    const SizedBox(height: CorocSpace.md),
                    _CapNotice(
                        check: p.rateCap,
                        acknowledged: c.acknowledgeCap,
                        onAcknowledge: (v) {
                          c.acknowledgeCap = v;
                          c.touch();
                          setState(() {});
                        },
                        onUseMax: p.rateCap.maxRate == null
                        ? null
                        : () {
                            c.rate.text = rateToPercentText(p.rateCap.maxRate!, context.lang);
                            _changed();
                          }),
                    const SizedBox(height: CorocSpace.md),
                    for (final i in (_showAll ? p.installments : p.installments.take(5)))
                      KeyValue('${l.installmentN(i.number)} · ${Dates.medium(i.dueDate, context.lang)}', m(i.amount)),
                    if (p.installments.length > 5)
                      TextButton(onPressed: () => setState(() => _showAll = !_showAll), child: Text(_showAll ? l.previewShowLess : l.previewShowAll(p.installments.length))),
                  ]),
      ),
    ]);
  }
}

class _Figure extends StatelessWidget {
  const _Figure({required this.label, required this.value, this.gold = false});
  final String label;
  final String value;
  final bool gold;
  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
      Overline(label),
      const SizedBox(height: 4),
      Text(value, style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontFamily: 'Inter', fontWeight: FontWeight.w400, color: gold ? (dark ? CorocColors.gold300 : CorocColors.gold800) : null)),
    ]);
  }
}

/// Resultado del control del tope legal (§9.6).
class _CapNotice extends StatelessWidget {
  const _CapNotice({required this.check, required this.onUseMax, required this.acknowledged, required this.onAcknowledge});
  final RateCapCheck check;
  final VoidCallback? onUseMax;
  final bool acknowledged;
  final ValueChanged<bool> onAcknowledge;
  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    // Por encima del tope (o sin tope en Colombia), si la empresa lo permite: confirmación expresa (ADR-061).
    final ack = !check.ok && check.overridable
        ? CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            value: acknowledged,
            onChanged: (v) => onAcknowledge(v ?? false),
            title: Text(l.capOverrideAck),
          )
        : null;
    if (check.missing) {
      final dot = StatusDot(label: check.ok ? l.capMissingOptional : l.capMissing, tone: check.ok ? StatusTone.info : StatusTone.error);
      return ack == null ? dot : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [dot, const SizedBox(height: 8), ack]);
    }
    if (check.ok) return StatusDot(label: l.capOk(percent(check.cap ?? 0, context.lang)), tone: StatusTone.ok);
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      StatusDot(label: l.capExceeded(percent(check.effectiveAnnual, context.lang), percent(check.cap ?? 0, context.lang)), tone: StatusTone.error),
      if (onUseMax != null) ...[
        const SizedBox(height: 8),
        OutlinedButton(onPressed: onUseMax, child: Text(l.capUseMax(rateToPercentText(check.maxRate!, context.lang)))),
      ],
      if (ack != null) ...[const SizedBox(height: 8), ack],
    ]);
  }
}
