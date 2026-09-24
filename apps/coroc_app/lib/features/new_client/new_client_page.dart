import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/providers.dart';
import '../../design/tokens.dart';
import '../../design/widgets/brand.dart';
import '../../design/widgets/common.dart';
import '../../design/widgets/labels.dart';
import '../clients/client_form.dart';
import '../loans/loan_terms_form.dart';
import '../shell/app_shell.dart';

/// Campos del préstamo que devuelve el servidor en errores de validación: llevan al paso 2.
const _loanFields = {'principal', 'rate', 'installments', 'frequency', 'method', 'disbursementDate', 'firstDueDate', 'monthlyDay', 'collectionDays', 'contract', 'currency'};
const _loanCodes = {'RATE_CAP_EXCEEDED', 'RATE_CAP_MISSING', 'LATE_FEE_EXCEEDS_CAP', 'INVALID_TERMS', 'CONTRACT_TAKEN'};

/// Asistente «Nuevo cliente» (§8.3): datos del cliente → condiciones con vista previa → autorizaciones y confirmación.
/// Crea el cliente y su primer préstamo en una sola operación; si parece duplicado, lo advierte antes de crear.
class NewClientPage extends ConsumerStatefulWidget {
  const NewClientPage({super.key});
  @override
  ConsumerState<NewClientPage> createState() => _NewClientPageState();
}

class _NewClientPageState extends ConsumerState<NewClientPage> {
  final _form = GlobalKey<FormState>();
  final _data = ClientFormData();
  late final LoanTermsController _terms = LoanTermsController(currency: ref.read(sessionProvider)?.company.currency ?? 'COP');
  final Map<String, bool> _consents = {'personal_data': false, 'whatsapp': false, 'email': false};
  String _consentMethod = 'signed';
  int _step = 0;
  bool _busy = false;
  ApiException? _error;

  @override
  void dispose() {
    _data.dispose();
    _terms.dispose();
    super.dispose();
  }

  bool get _dirty => _data.firstName.text.isNotEmpty || _data.lastName.text.isNotEmpty || _data.phone.text.isNotEmpty || _terms.principal.text.isNotEmpty;

  void _next() {
    if (_step == 0 && !(_form.currentState?.validate() ?? false)) return;
    if (_step == 1 && !(_terms.toLoanInput() != null && _terms.compliant)) return;
    setState(() {
      _error = null;
      _step++;
    });
  }

  void _back() => setState(() => _step = (_step - 1).clamp(0, 2));

  Future<void> _cancel() async {
    final l = context.l10n;
    if (_dirty) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(l.discardTitle),
          content: Text(l.discardMessage),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: Text(l.actionKeepEditing)),
            FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(l.actionDiscard)),
          ],
        ),
      );
      if (ok != true) return;
    }
    if (mounted) context.go('/clients');
  }

  Future<void> _submit({bool acknowledgeDuplicate = false}) async {
    final loan = _terms.toLoanInput();
    if (loan == null || _busy || _consents['personal_data'] != true) return;
    final l = context.l10n;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final client = {
        ..._data.toJson(defaultLang: ref.read(localeProvider.notifier).apiCode),
        'consents': [
          for (final e in _consents.entries)
            if (e.value && (e.key != 'email' || _data.email.text.trim().isNotEmpty)) {'channel': e.key, 'method': _consentMethod},
        ],
      };
      final res = await ref.read(apiProvider).createClient(client, loan, acknowledgeDuplicate: acknowledgeDuplicate);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l.newClientCreated(res.client.fullName, res.loan.contract))));
      context.go('/clients/${res.client.id}');
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.code == 'DUPLICATE_CLIENT' && !acknowledgeDuplicate) {
        setState(() => _busy = false);
        final go = await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            icon: const Icon(Icons.people_alt_outlined),
            title: Text(e.title.isEmpty ? l.duplicateTitle : e.title),
            content: Text(e.detail ?? l.duplicateTitle),
            actions: [
              TextButton(onPressed: () => Navigator.pop(context, false), child: Text(l.actionCancel)),
              FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(l.duplicateCreateAnyway)),
            ],
          ),
        );
        if (go == true && mounted) await _submit(acknowledgeDuplicate: true);
        return;
      }
      final loanError = _loanCodes.contains(e.code) || e.fieldErrors.any((f) => f.field.startsWith('loan') || _loanFields.contains(f.field));
      final clientError = e.code == 'INVALID_PHONE' || e.fieldErrors.any((f) => f.field.startsWith('client') || (!_loanFields.contains(f.field) && f.field != '(body)'));
      setState(() {
        _error = e;
        if (loanError) {
          _step = 1;
        } else if (clientError) {
          _step = 0;
        }
      });
    } finally {
      if (mounted && _busy) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final auth = ref.watch(authProvider);
    if (auth is SignedIn && !auth.user.can('clients.create')) return const NoPermission();
    final steps = [l.wizardStepClient, l.wizardStepLoan, l.wizardStepConfirm];

    // Un solo Form para toda la página: evita claves globales duplicadas durante la transición entre pasos.
    return Form(
      key: _form,
      child: PageScaffold(
        maxWidth: 920,
        children: [
          PageHeader(
            overline: l.newClient,
            title: steps[_step],
            subtitle: l.wizardStepOf(_step + 1, steps.length),
            actions: [TextButton.icon(onPressed: _cancel, icon: const Icon(Icons.close), label: Text(l.actionCancel))],
          ),
          _StepIndicator(labels: steps, current: _step),
          const SizedBox(height: CorocSpace.lg),
          AnimatedSwitcher(
            duration: MediaQuery.of(context).disableAnimations ? Duration.zero : CorocMotion.normal,
            child: KeyedSubtree(
              key: ValueKey(_step),
              child: switch (_step) {
                0 => SectionCard(
                  child: ClientFields(data: _data, error: _error, onChanged: () => setState(() {})),
                ),
                1 => SectionCard(child: LoanTermsForm(controller: _terms)),
                _ => _ConfirmStep(
                  data: _data,
                  terms: _terms,
                  consents: _consents,
                  method: _consentMethod,
                  onConsent: (k, v) => setState(() => _consents[k] = v),
                  onMethod: (m) => setState(() => _consentMethod = m),
                ),
              },
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: CorocSpace.md),
            Semantics(
              liveRegion: true,
              child: StatusDot(label: errorText(context, _error!), tone: StatusTone.error),
            ),
          ],
          const SizedBox(height: CorocSpace.lg),
          ListenableBuilder(
            listenable: _terms,
            builder: (context, _) {
              final canNext = switch (_step) {
                0 => true,
                1 => _terms.toLoanInput() != null && _terms.compliant,
                _ => _consents['personal_data'] == true,
              };
              return Row(
                children: [
                  if (_step > 0) OutlinedButton.icon(onPressed: _busy ? null : _back, icon: const Icon(Icons.arrow_back), label: Text(l.actionBack)),
                  const Spacer(),
                  if (_step < 2)
                    GoldButton(label: l.actionNext, icon: Icons.arrow_forward, onPressed: canNext ? _next : null)
                  else
                    GoldButton(label: l.newClientCreate, icon: Icons.check, busy: _busy, onPressed: canNext ? () => _submit() : null),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}

class _StepIndicator extends StatelessWidget {
  const _StepIndicator({required this.labels, required this.current});
  final List<String> labels;
  final int current;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    Widget dot(int i) {
      final done = i < current;
      final active = i == current;
      return AnimatedContainer(
        duration: CorocMotion.fast,
        width: 32,
        height: 32,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: active || done ? CorocColors.brandGradient : null,
          border: active || done ? null : Border.all(color: scheme.outline),
        ),
        child: done
            ? const Icon(Icons.check, size: 18, color: CorocColors.navy800)
            : Text(
                '${i + 1}',
                style: TextStyle(fontWeight: FontWeight.w600, color: active ? CorocColors.navy800 : scheme.onSurfaceVariant),
              ),
      );
    }

    return Semantics(
      label: labels[current],
      // El ancho disponible (no el de la pantalla) decide si caben los nombres de los pasos: junto a la barra lateral
      // el contenido es más angosto que la ventana.
      child: LayoutBuilder(
        builder: (context, constraints) {
          final narrow = constraints.maxWidth < CorocBreakpoints.tablet;
          return Row(
            children: [
              for (var i = 0; i < labels.length; i++) ...[
                dot(i),
                if (!narrow || i == current) ...[
                  const SizedBox(width: 8),
                  Flexible(
                    flex: 2,
                    child: Text(
                      labels[i],
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.labelLarge?.copyWith(color: i == current ? (dark ? CorocColors.gold300 : CorocColors.gold800) : scheme.onSurfaceVariant),
                    ),
                  ),
                ],
                if (i < labels.length - 1)
                  Expanded(
                    child: Container(height: 1, margin: const EdgeInsets.symmetric(horizontal: 12), color: i < current ? CorocColors.gold500 : scheme.outlineVariant),
                  ),
              ],
            ],
          );
        },
      ),
    );
  }
}

/// Paso 3: autorizaciones (Ley 1581 de 2012 en Colombia, LGPD en Brasil) y resumen antes de crear.
class _ConfirmStep extends StatelessWidget {
  const _ConfirmStep({required this.data, required this.terms, required this.consents, required this.method, required this.onConsent, required this.onMethod});
  final ClientFormData data;
  final LoanTermsController terms;
  final Map<String, bool> consents;
  final String method;
  final void Function(String channel, bool value) onConsent;
  final ValueChanged<String> onMethod;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final p = terms.preview;
    String m(int v) => Money.format(v, terms.currency);
    final hasEmail = data.email.text.trim().isNotEmpty;
    final n = int.tryParse(terms.installments.text.trim()) ?? 0;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SectionCard(
          title: l.consentsTitle,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                value: consents['personal_data'],
                onChanged: (v) => onConsent('personal_data', v ?? false),
                title: Text('${l.consentPersonalData} *'),
                subtitle: Text(l.consentPersonalDataHelp),
              ),
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                value: consents['whatsapp'],
                onChanged: (v) => onConsent('whatsapp', v ?? false),
                title: Text(l.consentWhatsapp),
                subtitle: Text(l.consentChannelHelp),
              ),
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                value: hasEmail && consents['email'] == true,
                onChanged: hasEmail ? (v) => onConsent('email', v ?? false) : null,
                title: Text(l.consentEmail),
                subtitle: Text(hasEmail ? l.consentChannelHelp : l.consentEmailMissing),
              ),
              const SizedBox(height: CorocSpace.sm),
              Wrap(
                spacing: CorocSpace.md,
                runSpacing: CorocSpace.sm,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text(l.consentMethod),
                  SegmentedButton<String>(
                    showSelectedIcon: false,
                    segments: [
                      ButtonSegment(value: 'signed', label: Text(l.consentMethodSigned)),
                      ButtonSegment(value: 'verbal', label: Text(l.consentMethodVerbal)),
                    ],
                    selected: {method},
                    onSelectionChanged: (v) => onMethod(v.first),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: CorocSpace.md),
        SectionCard(
          title: l.wizardSummary,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              KeyValue(l.fieldName, '${data.firstName.text.trim()} ${data.lastName.text.trim()}', emphasize: true),
              KeyValue(l.fieldPhone, data.phone.text.trim()),
              if (data.idDocNumber.text.trim().isNotEmpty) KeyValue(l.fieldIdDoc, '${data.idDocType.text.trim()} ${data.idDocNumber.text.trim()}'),
              const Divider(height: CorocSpace.lg),
              if (Money.parse(terms.principal.text, terms.currency) case final principal?) KeyValue(l.cardPrincipal, m(principal)),
              KeyValue(l.termsInstallments, '$n · ${frequencyLabel(l, terms.frequency)}'),
              KeyValue(l.termsMethod, methodLabel(l, terms.method)),
              if (p != null) ...[
                KeyValue(l.previewInstallment, m(p.regularInstallment), emphasize: true),
                KeyValue(l.previewTotal, m(p.totalPayable)),
                KeyValue(l.previewProfit, m(p.totalInterest)),
                KeyValue(l.previewEffectiveRate, percent(p.effectiveAnnualRate, context.lang)),
                if (p.installments.isNotEmpty) KeyValue(l.termsFirstDue, Dates.medium(p.installments.first.dueDate, context.lang)),
              ],
              const SizedBox(height: CorocSpace.sm),
              Row(
                children: [
                  Icon(Icons.folder_outlined, size: 18, color: Theme.of(context).colorScheme.tertiary),
                  const SizedBox(width: 8),
                  Expanded(child: Text(l.wizardFolderNote, style: Theme.of(context).textTheme.bodySmall)),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }
}
