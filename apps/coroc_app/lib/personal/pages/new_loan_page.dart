import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/brand.dart';
import '../../design/widgets/common.dart';
import '../../features/loans/loan_providers.dart';
import '../../features/loans/loan_terms_form.dart' show percentToRate;
import '../../features/settings/settings_page.dart' show RateCapPolicySwitch;
import '../data.dart';
import '../ui/bank.dart';

/// Interés del préstamo: por cada período de pago (día, semana o mes) o en total.
enum RateUnit { perPeriod, total }

/// Tasa total sobre el capital (la que usa el método de interés simple) a partir de lo que la persona escribe:
/// «5 % por semana» en 8 cuotas semanales es 40 % en total. Decimal exacto, sin binario flotante (ADR-001).
String? totalRate(String input, RateUnit unit, int installments) {
  final rate = percentToRate(input);
  if (rate == null || installments < 1) return null;
  if (unit == RateUnit.total) return rate;
  final parts = rate.split('.');
  final scale = parts.length > 1 ? parts[1].length : 0;
  final digits = BigInt.parse(parts[0] + (parts.length > 1 ? parts[1] : '')) * BigInt.from(installments);
  final text = digits.toString().padLeft(scale + 1, '0');
  if (scale == 0) return text;
  final whole = text.substring(0, text.length - scale);
  final frac = text.substring(text.length - scale).replaceFirst(RegExp(r'0+$'), '');
  return frac.isEmpty ? whole : '$whole.$frac';
}

/// Nuevo préstamo en una sola pantalla: a quién (cliente nuevo o uno que ya está), cuánto, el interés por día, semana
/// o mes, cuántas cuotas y desde cuándo. A la derecha, la vista previa en vivo: la cuota, el total, la tasa efectiva
/// anual y el tope legal como referencia; si lo supera, basta confirmar (ADR-061).
class NewLoanPage extends ConsumerStatefulWidget {
  const NewLoanPage({super.key, this.clientId});
  final String? clientId;
  @override
  ConsumerState<NewLoanPage> createState() => _NewLoanPageState();
}

class _NewLoanPageState extends ConsumerState<NewLoanPage> {
  // Cliente
  late bool _existing = widget.clientId != null;
  String? _clientId;
  String? _clientName;
  final _first = TextEditingController();
  final _last = TextEditingController();
  final _doc = TextEditingController();
  final _phone = TextEditingController();
  final _email = TextEditingController();
  bool _authorized = false;
  String _authMethod = 'signed';
  // Préstamo
  final _amount = TextEditingController();
  final _rate = TextEditingController();
  final _count = TextEditingController();
  String _frequency = 'weekly';
  RateUnit _unit = RateUnit.perPeriod;
  String _date = Dates.isoToday();
  // Vista previa
  Timer? _debounce;
  LoanPreview? _preview;
  String? _previewError;
  bool _previewing = false;
  bool _acknowledge = false;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _clientId = widget.clientId;
    for (final c in [_amount, _rate, _count]) {
      c.addListener(_changed);
    }
  }

  @override
  void dispose() {
    _debounce?.cancel();
    for (final c in [_first, _last, _doc, _phone, _email, _amount, _rate, _count]) {
      c.dispose();
    }
    super.dispose();
  }

  String get _currency => ref.read(sessionProvider)?.company.currency ?? 'COP';
  String get _country => ref.read(sessionProvider)?.company.country ?? 'CO';

  Map<String, dynamic>? _terms() {
    final principal = Money.parse(_amount.text, _currency);
    final n = int.tryParse(_count.text.trim());
    if (principal == null || principal <= 0 || n == null || n < 1 || n > 3660) return null;
    final rate = totalRate(_rate.text, _unit, n);
    if (rate == null) return null;
    return {'principal': principal, 'currency': _currency, 'method': 'simple', 'rate': rate, 'installments': n, 'frequency': _frequency, 'disbursementDate': _date};
  }

  void _changed() {
    _debounce?.cancel();
    // Otras condiciones, otra confirmación: la anterior no vale para una tasa distinta.
    _acknowledge = false;
    final terms = _terms();
    if (terms == null) {
      if (_preview != null || _previewError != null) {
        setState(() {
          _preview = null;
          _previewError = null;
        });
      }
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 350), () => _runPreview(terms));
  }

  Future<void> _runPreview(Map<String, dynamic> terms) async {
    setState(() => _previewing = true);
    try {
      final p = await ref.read(apiProvider).previewLoan(terms);
      if (!mounted) return;
      setState(() {
        _preview = p;
        _previewError = null;
      });
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _preview = null;
          _previewError = errorText(context, e);
        });
      }
    } finally {
      if (mounted) setState(() => _previewing = false);
    }
  }

  /// Para las secciones de esta pantalla, que cambian su estado.
  void update(VoidCallback fn) => setState(fn);

  bool get _overCap => _preview != null && !_preview!.rateCap.ok;
  bool get _canSave {
    final p = _preview;
    if (p == null || _busy) return false;
    if (_overCap && !(p.rateCap.overridable && _acknowledge)) return false;
    if (_existing) return _clientId != null;
    return _authorized && _first.text.trim().isNotEmpty && _last.text.trim().isNotEmpty && _phone.text.trim().length >= 7;
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(context: context, initialDate: DateTime.parse(_date), firstDate: DateTime(now.year - 1), lastDate: DateTime(now.year + 1));
    if (picked == null) return;
    setState(() => _date = Dates.iso(picked));
    _changed();
  }

  Future<void> _save({bool acknowledgeDuplicate = false}) async {
    final terms = _terms();
    if (terms == null || !_canSave) return;
    final l = context.l10n;
    setState(() {
      _busy = true;
      _error = null;
    });
    final loan = {...terms, if (_overCap) 'acknowledgeRateCap': true};
    try {
      final api = ref.read(apiProvider);
      final String clientId;
      final String contract;
      final String name;
      if (_existing) {
        final created = await api.addLoan(_clientId!, loan);
        clientId = _clientId!;
        contract = created.contract;
        name = _clientName ?? '';
      } else {
        final email = _email.text.trim();
        final res = await api.createClient(
          {
            'firstName': _first.text.trim(),
            'lastName': _last.text.trim(),
            'phone': _phone.text.trim(),
            if (email.isNotEmpty) 'email': email,
            if (_doc.text.trim().isNotEmpty) 'idDocType': _docType,
            if (_doc.text.trim().isNotEmpty) 'idDocNumber': _doc.text.trim(),
            'lang': ref.read(localeProvider.notifier).apiCode,
            'consents': [
              {'channel': 'personal_data', 'method': _authMethod},
              {'channel': 'whatsapp', 'method': _authMethod},
              if (email.isNotEmpty) {'channel': 'email', 'method': _authMethod},
            ],
          },
          loan,
          acknowledgeDuplicate: acknowledgeDuplicate,
        );
        clientId = res.client.id;
        contract = res.loan.contract;
        name = res.client.fullName;
      }
      PersonalRealtime.refreshMoney(ref, clientId: clientId);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l.pLoanCreated(contract, name)), duration: const Duration(seconds: 6)));
      context.go('/clientes/$clientId');
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
        if (go == true && mounted) await _save(acknowledgeDuplicate: true);
        return;
      }
      setState(() => _error = errorText(context, e));
    } finally {
      if (mounted && _busy) setState(() => _busy = false);
    }
  }

  /// Tipo de documento según el país de la empresa.
  String get _docType => switch (_country) {
    'BR' => 'CPF',
    'US' => 'ID',
    _ => 'CC',
  };

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    // Si el Propietario permite préstamos por encima del tope desde aquí, la vista previa se vuelve a pedir.
    ref.listen(companyProvider, (_, _) => _changed());
    final form = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _ClientSection(state: this),
        const SizedBox(height: 20),
        _LoanSection(state: this),
      ],
    );
    final summary = _Summary(state: this);
    return BankPage(
      title: l.pNavNewLoan,
      subtitle: l.pNewLoanSubtitle,
      children: [
        LayoutBuilder(
          builder: (context, c) => c.maxWidth >= 980
              ? Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(flex: 3, child: form),
                    const SizedBox(width: 24),
                    Expanded(flex: 2, child: summary),
                  ],
                )
              : Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [form, const SizedBox(height: 20), summary]),
        ),
      ],
    );
  }
}

/// ¿A quién se le presta? Un cliente nuevo (nombre, documento, celular, correo y su autorización) o uno que ya está.
class _ClientSection extends ConsumerWidget {
  const _ClientSection({required this.state});
  final _NewLoanPageState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final s = state;
    Widget field(TextEditingController c, String label, IconData icon, {TextInputType? type, String? helper}) => Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: TextField(
        controller: c,
        keyboardType: type,
        onChanged: (_) => s.update(() {}),
        decoration: corocInput(context, label: label, helper: helper, prefix: Icon(icon)),
      ),
    );
    return BankCard(
      title: l.pWhoTitle,
      trailing: SegmentedButton<bool>(
        segments: [
          ButtonSegment(value: false, label: Text(l.pClientNew)),
          ButtonSegment(value: true, label: Text(l.pClientExisting)),
        ],
        selected: {s._existing},
        showSelectedIcon: false,
        onSelectionChanged: (v) => s.update(() => s._existing = v.first),
      ),
      child: s._existing
          ? _ClientPicker(state: s)
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(child: field(s._first, l.fieldFirstName, Icons.person_outline)),
                    const SizedBox(width: 14),
                    Expanded(child: field(s._last, l.fieldLastName, Icons.person_outline)),
                  ],
                ),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(child: field(s._doc, l.fieldIdDoc, Icons.badge_outlined)),
                    const SizedBox(width: 14),
                    Expanded(child: field(s._phone, l.fieldPhone, Icons.phone_iphone, type: TextInputType.phone)),
                  ],
                ),
                field(s._email, l.pEmailOptional, Icons.mail_outline, type: TextInputType.emailAddress, helper: l.pEmailHelp),
                CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                  value: s._authorized,
                  onChanged: (v) => s.update(() => s._authorized = v ?? false),
                  title: Text(l.pAuthorization),
                  subtitle: Text(l.pAuthorizationHelp),
                ),
                const SizedBox(height: 6),
                Row(
                  children: [
                    Text(l.consentMethod, style: Theme.of(context).textTheme.bodyMedium),
                    const SizedBox(width: 12),
                    SegmentedButton<String>(
                      segments: [
                        ButtonSegment(value: 'signed', label: Text(l.consentMethodSigned)),
                        ButtonSegment(value: 'verbal', label: Text(l.consentMethodVerbal)),
                      ],
                      selected: {s._authMethod},
                      showSelectedIcon: false,
                      onSelectionChanged: (v) => s.update(() => s._authMethod = v.first),
                    ),
                  ],
                ),
              ],
            ),
    );
  }
}

/// Buscar y elegir un cliente que ya está en COROC.
class _ClientPicker extends ConsumerStatefulWidget {
  const _ClientPicker({required this.state});
  final _NewLoanPageState state;
  @override
  ConsumerState<_ClientPicker> createState() => _ClientPickerState();
}

class _ClientPickerState extends ConsumerState<_ClientPicker> {
  final _q = TextEditingController();
  String _query = '';
  Timer? _debounce;

  @override
  void dispose() {
    _debounce?.cancel();
    _q.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    final s = widget.state;
    if (s._clientId != null) {
      final name = s._clientName ?? ref.watch(clientProvider(s._clientId!)).valueOrNull?.fullName;
      return Row(
        children: [
          Monogram(name ?? '', size: 46),
          const SizedBox(width: 14),
          Expanded(child: Text(name ?? '…', style: t.titleMedium)),
          TextButton(onPressed: () => s.update(() => s._clientId = null), child: Text(l.pChange)),
        ],
      );
    }
    final found = ref.watch(clientsProvider((q: _query, status: null)));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: _q,
          autofocus: true,
          onChanged: (v) {
            _debounce?.cancel();
            _debounce = Timer(const Duration(milliseconds: 300), () {
              if (mounted) setState(() => _query = v);
            });
          },
          decoration: corocInput(context, label: l.pClientsSearch, prefix: const Icon(Icons.search)),
        ),
        const SizedBox(height: 8),
        AsyncBody<ClientPage>(
          value: found,
          onRetry: () => ref.invalidate(clientsProvider),
          builder: (p) => p.items.isEmpty
              ? Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(l.pClientsNoMatch, style: t.bodyMedium),
                )
              : Column(
                  children: [
                    for (final c in p.items.take(6))
                      ListTile(
                        contentPadding: const EdgeInsets.symmetric(horizontal: 4),
                        leading: Monogram(c.fullName, size: 38),
                        title: Text(c.fullName),
                        subtitle: Text(c.phone),
                        trailing: MoneyText(c.balance, currency: c.currency, style: t.bodyMedium),
                        onTap: () => s.update(() {
                          s._clientId = c.id;
                          s._clientName = c.fullName;
                        }),
                      ),
                  ],
                ),
        ),
      ],
    );
  }
}

/// El préstamo: cuánto, cada cuánto paga, el interés, cuántas cuotas y cuándo se entrega.
class _LoanSection extends StatelessWidget {
  const _LoanSection({required this.state});
  final _NewLoanPageState state;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final s = state;
    final period = switch (s._frequency) {
      'daily' => l.pPerDay,
      'weekly' => l.pPerWeek,
      _ => l.pPerMonth,
    };
    return BankCard(
      title: l.pLoanSectionTitle,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            controller: s._amount,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontFamily: 'Inter'),
            decoration: corocInput(context, label: l.pAmountLent, prefix: const Icon(Icons.payments_outlined)),
          ),
          const SizedBox(height: 18),
          Text(l.pHowOften, style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 8),
          SegmentedButton<String>(
            segments: [
              ButtonSegment(value: 'daily', label: Text(l.pEveryDay), icon: const Icon(Icons.today_outlined)),
              ButtonSegment(value: 'weekly', label: Text(l.pEveryWeek), icon: const Icon(Icons.date_range_outlined)),
              ButtonSegment(value: 'monthly', label: Text(l.pEveryMonth), icon: const Icon(Icons.calendar_month_outlined)),
            ],
            selected: {s._frequency},
            showSelectedIcon: false,
            onSelectionChanged: (v) {
              s.update(() => s._frequency = v.first);
              s._changed();
            },
          ),
          const SizedBox(height: 18),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: TextField(
                  controller: s._rate,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: corocInput(
                    context,
                    label: l.pInterestRate,
                    suffix: const Padding(padding: EdgeInsets.all(14), child: Text('%')),
                    prefix: const Icon(Icons.percent),
                  ),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: DropdownButtonFormField<RateUnit>(
                  initialValue: s._unit,
                  decoration: corocInput(context, label: l.pInterestUnit),
                  items: [
                    DropdownMenuItem(value: RateUnit.perPeriod, child: Text(period)),
                    DropdownMenuItem(value: RateUnit.total, child: Text(l.pRateTotal)),
                  ],
                  onChanged: (v) {
                    s.update(() => s._unit = v ?? RateUnit.perPeriod);
                    s._changed();
                  },
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: TextField(
                  controller: s._count,
                  keyboardType: TextInputType.number,
                  decoration: corocInput(context, label: l.fieldInstallments, prefix: const Icon(Icons.format_list_numbered)),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: OutlinedButton.icon(onPressed: s._pickDate, icon: const Icon(Icons.event_outlined), label: Text(l.pDeliveredOn(Dates.medium(s._date, context.lang)))),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// La vista previa en vivo: la cuota protagonista, el total, la tasa efectiva anual y el tope legal como referencia.
class _Summary extends ConsumerWidget {
  const _Summary({required this.state});
  final _NewLoanPageState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    final s = state;
    final p = s._preview;
    final cur = s._currency;
    final every = switch (s._frequency) {
      'daily' => l.pEveryDay,
      'weekly' => l.pEveryWeek,
      _ => l.pEveryMonth,
    };
    final dim = CorocColors.ivory.withValues(alpha: 0.72);
    Widget line(String k, String v) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        children: [
          Expanded(
            child: Text(k, style: t.bodyMedium?.copyWith(color: dim)),
          ),
          Text(
            v,
            style: t.titleSmall?.copyWith(color: CorocColors.ivory, fontFamily: 'Inter'),
          ),
        ],
      ),
    );
    final auth = ref.watch(authProvider);
    final isOwner = auth is SignedIn && auth.user.role == 'owner';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        HeroCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(l.pInstallmentOf.toUpperCase(), style: t.labelMedium?.copyWith(color: CorocColors.gold300)),
              const SizedBox(height: 8),
              if (p == null)
                Text(
                  s._previewing ? '…' : l.pPreviewEmpty,
                  style: s._previewing ? t.displaySmall?.copyWith(color: CorocColors.ivory) : t.bodyLarge?.copyWith(color: dim),
                )
              else ...[
                Text(Money.format(p.regularInstallment, cur), style: t.displaySmall?.copyWith(color: CorocColors.ivory, fontSize: 40)),
                Text(every, style: t.bodyLarge?.copyWith(color: dim)),
                const SizedBox(height: 18),
                Container(height: 1, color: CorocColors.gold500.withValues(alpha: 0.25)),
                const SizedBox(height: 10),
                line(l.pAmountLent, Money.format(p.totalPayable - p.totalInterest, cur)),
                line(l.pInterestTotal, Money.format(p.totalInterest, cur)),
                line(l.pTotalToPay, Money.format(p.totalPayable, cur)),
                if (p.installments.isNotEmpty) line(l.pFirstInstallment, Dates.medium(p.installments.first.dueDate, context.lang)),
                if (p.installments.isNotEmpty) line(l.pLastInstallment, Dates.medium(p.installments.last.dueDate, context.lang)),
                line(l.pEffectiveRate, percent(p.effectiveAnnualRate, context.lang)),
              ],
            ],
          ),
        ),
        if (s._previewError != null) ...[const SizedBox(height: 14), InfoNote(s._previewError!, tone: StatusTone.error, icon: Icons.error_outline)],
        if (p != null) ...[const SizedBox(height: 14), _CapNote(state: s, check: p.rateCap, isOwner: isOwner)],
        if (s._error != null) ...[const SizedBox(height: 14), InfoNote(s._error!, tone: StatusTone.error, icon: Icons.error_outline)],
        const SizedBox(height: 18),
        GoldButton(label: l.pCreateLoan, icon: Icons.check, expand: true, busy: s._busy, onPressed: s._canSave ? s._save : null),
        const SizedBox(height: 10),
        Text(l.pCreateLoanHelp, style: t.bodySmall, textAlign: TextAlign.center),
      ],
    );
  }
}

/// El tope legal como referencia: dentro del tope, por encima (con la confirmación de ADR-061) o sin tope registrado.
class _CapNote extends StatelessWidget {
  const _CapNote({required this.state, required this.check, required this.isOwner});
  final _NewLoanPageState state;
  final RateCapCheck check;
  final bool isOwner;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final lang = context.lang;
    if (check.ok) {
      return check.cap == null
          ? InfoNote(l.capMissingOptional, icon: Icons.gavel_outlined, tone: StatusTone.neutral)
          : InfoNote(l.capOk(percent(check.cap!, lang)), icon: Icons.verified_outlined, tone: StatusTone.ok);
    }
    final text = check.missing || check.cap == null ? l.pCapMissing : l.capExceeded(percent(check.effectiveAnnual, lang), percent(check.cap!, lang));
    return BankCard(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InfoNote(text, icon: Icons.gavel_outlined, tone: StatusTone.warn),
          const SizedBox(height: 8),
          if (check.overridable)
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              value: state._acknowledge,
              onChanged: (v) => state.update(() => state._acknowledge = v ?? false),
              title: Text(l.capOverrideAck),
            )
          else
            RateCapPolicySwitch(isOwner: isOwner),
        ],
      ),
    );
  }
}
