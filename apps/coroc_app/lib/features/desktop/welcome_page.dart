import 'dart:io';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/desktop/desktop_runtime.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/brand.dart';
import '../../design/widgets/common.dart';
import '../auth/login_page.dart' show LanguageSelector;
import '../loans/loan_providers.dart' show rateCapsProvider;
import '../settings/settings_page.dart' show RateCapDialog, RateCapPolicySwitch, countryName;
import 'gmail_connect.dart';

/// WhatsApp para Windows en Microsoft Store.
const whatsAppStoreUrl = 'ms-windows-store://pdp/?productid=9NKSQGP7F2NH';

/// Usuario sugerido a partir del nombre: «Ana María Pérez» → «ana.perez».
String suggestUsername(String name) {
  const from = 'áàâãäéèêëíìîïóòôõöúùûüñç';
  const to = 'aaaaaeeeeiiiiooooouuuunc';
  final folded = name.toLowerCase().split('').map((c) {
    final i = from.indexOf(c);
    return i < 0 ? c : to[i];
  }).join();
  final parts = folded.split(RegExp(r'[^a-z0-9]+')).where((p) => p.isNotEmpty).toList();
  if (parts.isEmpty) return '';
  final base = parts.length == 1 ? parts.first : '${parts.first}.${parts.last}';
  return base.length > 32 ? base.substring(0, 32) : base;
}

/// Asistente de primer uso de COROC Escritorio (ADR-062): cinco pantallas cortas, una acción principal en cada una y
/// nada técnico. 1 Empresa y país · 2 Propietario y contraseña (Windows Hello) · 3 Tasas (tope y política, ADR-061) ·
/// 4 Gmail · 5 WhatsApp. Desde la primera también se restaura una copia de otro PC (E-7).
class WelcomePage extends ConsumerStatefulWidget {
  const WelcomePage({super.key});
  @override
  ConsumerState<WelcomePage> createState() => _WelcomePageState();
}

class _WelcomePageState extends ConsumerState<WelcomePage> {
  static const steps = 5;
  int _step = 0;
  bool _restoring = false;
  bool _busy = false;
  String? _error;

  final _company = TextEditingController();
  String _country = 'CO';
  final _name = TextEditingController();
  final _user = TextEditingController();
  final _pass = TextEditingController();
  final _pass2 = TextEditingController();
  final _email = TextEditingController();
  bool _userEdited = false;
  bool _helloAvailable = false;
  bool _hello = false;
  bool _gmailOk = false;
  bool? _whatsApp;

  @override
  void initState() {
    super.initState();
    _name.addListener(() {
      if (!_userEdited) _user.text = suggestUsername(_name.text);
    });
    final platform = ref.read(desktopPlatformProvider);
    platform.helloAvailable().then((ok) {
      if (mounted) setState(() => _helloAvailable = _hello = ok);
    });
    // Una copia que quedó subida sin aplicar (se cerró COROC a mitad de camino): se retoma.
    if (ref.read(desktopProvider).status?.restore != null) _restoring = true;
  }

  @override
  void dispose() {
    for (final c in [_company, _name, _user, _pass, _pass2, _email]) {
      c.dispose();
    }
    super.dispose();
  }

  void _go(int step) => setState(() {
    _step = step;
    _error = null;
  });

  Future<void> _createCompany() async {
    final l = context.l10n;
    final user = _user.text.trim().toLowerCase();
    String? problem;
    if (_name.text.trim().isEmpty) {
      problem = l.welcomeNameRequired;
    } else if (!RegExp(r'^[a-z0-9._-]{3,32}$').hasMatch(user)) {
      problem = l.welcomeUsernameInvalid;
    } else if (_pass.text.length < 12) {
      problem = l.welcomePasswordShort;
    } else if (_pass.text != _pass2.text) {
      problem = l.welcomePasswordMismatch;
    }
    if (problem != null) {
      setState(() => _error = problem);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      var hello = _hello && _helloAvailable;
      // Windows Hello se confirma una vez aquí: si no responde, COROC se abre con la contraseña.
      if (hello) hello = await ref.read(desktopPlatformProvider).verifyUser(l.helloReason);
      final store = ref.read(sessionStoreProvider);
      final session = await ref
          .read(apiProvider)
          .desktopSetup(
            companyName: _company.text.trim(),
            country: _country,
            lang: ref.read(localeProvider.notifier).apiCode,
            ownerName: _name.text.trim(),
            username: user,
            password: _pass.text,
            email: _email.text.trim().isEmpty ? null : _email.text.trim(),
            deviceId: await store.deviceId(),
            deviceName: 'COROC · ${Platform.operatingSystem}',
          );
      await store.saveHelloEnabled(hello);
      await ref.read(authProvider.notifier).acceptSession(session);
      _pass.clear();
      _pass2.clear();
      if (mounted) _go(2);
    } catch (e) {
      if (mounted) setState(() => _error = errorText(context, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _checkWhatsApp() async {
    final ok = await ref.read(desktopPlatformProvider).whatsAppInstalled();
    if (mounted) setState(() => _whatsApp = ok);
  }

  /// Fin del asistente: con la empresa ya creada, COROC pasa al tablero (y al recorrido guiado).
  Future<void> _finish() async {
    setState(() => _busy = true);
    try {
      await ref.read(desktopProvider.notifier).refreshStatus();
    } catch (e) {
      if (mounted) setState(() => _error = errorText(context, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    if (_restoring) return _Frame(step: null, child: _RestorePanel(onBack: () => setState(() => _restoring = false)));
    return switch (_step) {
      0 => _Frame(
        step: 0,
        title: l.welcomeTitle,
        subtitle: l.welcomeCompanySubtitle,
        error: _error,
        primary: GoldButton(
          label: l.actionContinue,
          expand: true,
          onPressed: () {
            if (_company.text.trim().length < 2) return setState(() => _error = l.welcomeCompanyRequired);
            _go(1);
          },
        ),
        secondary: [TextButton.icon(onPressed: () => setState(() => _restoring = true), icon: const Icon(Icons.settings_backup_restore), label: Text(l.welcomeRestoreLink))],
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              controller: _company,
              autofocus: true,
              textCapitalization: TextCapitalization.words,
              decoration: corocInput(context, label: l.welcomeCompanyName, hint: l.welcomeCompanyHint, prefix: const Icon(Icons.apartment_outlined)),
            ),
            const SizedBox(height: CorocSpace.lg),
            Text(l.companyCountry, style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: CorocSpace.sm),
            Wrap(
              spacing: CorocSpace.sm,
              runSpacing: CorocSpace.sm,
              children: [
                for (final (code, money) in const [('CO', 'COP'), ('BR', 'BRL'), ('US', 'USD')])
                  ChoiceChip(
                    label: Padding(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6), child: Text('${countryName(l, code)} · $money')),
                    selected: _country == code,
                    onSelected: (_) => setState(() => _country = code),
                  ),
              ],
            ),
          ],
        ),
      ),
      1 => _Frame(
        step: 1,
        title: l.welcomeOwnerTitle,
        subtitle: l.welcomeOwnerSubtitle,
        error: _error,
        primary: GoldButton(label: l.welcomeCreate, icon: Icons.check, expand: true, busy: _busy, onPressed: _createCompany),
        secondary: [TextButton(onPressed: _busy ? null : () => _go(0), child: Text(l.actionBack))],
        child: AutofillGroup(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                controller: _name,
                autofocus: true,
                textCapitalization: TextCapitalization.words,
                decoration: corocInput(context, label: l.welcomeOwnerName, prefix: const Icon(Icons.person_outline)),
              ),
              const SizedBox(height: CorocSpace.md),
              TextField(
                controller: _user,
                autocorrect: false,
                onChanged: (_) => _userEdited = true,
                autofillHints: const [AutofillHints.newUsername],
                decoration: corocInput(context, label: l.loginUsername, helper: l.welcomeUsernameHelp, prefix: const Icon(Icons.badge_outlined)),
              ),
              const SizedBox(height: CorocSpace.md),
              TextField(
                controller: _pass,
                obscureText: true,
                autofillHints: const [AutofillHints.newPassword],
                decoration: corocInput(context, label: l.loginPassword, helper: l.welcomePasswordHelp, prefix: const Icon(Icons.lock_outline)),
              ),
              const SizedBox(height: CorocSpace.md),
              TextField(
                controller: _pass2,
                obscureText: true,
                decoration: corocInput(context, label: l.welcomePasswordAgain, prefix: const Icon(Icons.lock_outline)),
              ),
              const SizedBox(height: CorocSpace.md),
              TextField(
                controller: _email,
                keyboardType: TextInputType.emailAddress,
                decoration: corocInput(context, label: l.welcomeEmailOptional, prefix: const Icon(Icons.mail_outline)),
              ),
              if (_helloAvailable)
                CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                  value: _hello,
                  onChanged: (v) => setState(() => _hello = v ?? false),
                  title: Text(l.welcomeHello),
                  subtitle: Text(l.welcomeHelloHelp),
                ),
              const SizedBox(height: CorocSpace.sm),
              Text(l.welcomeMfaNote, style: Theme.of(context).textTheme.bodySmall),
            ],
          ),
        ),
      ),
      2 => _Frame(
        step: 2,
        title: l.welcomeRatesTitle,
        subtitle: _country == 'CO' ? l.welcomeRatesSubtitleCO : l.welcomeRatesSubtitle,
        error: _error,
        primary: GoldButton(label: l.actionContinue, expand: true, onPressed: () => _go(3)),
        child: _RatesStep(country: _country),
      ),
      3 => _Frame(
        step: 3,
        wide: true,
        title: l.welcomeGmailTitle,
        subtitle: l.welcomeGmailSubtitle,
        error: _error,
        primary: _gmailOk ? GoldButton(label: l.actionContinue, expand: true, onPressed: () => _go(4)) : null,
        secondary: [if (!_gmailOk) TextButton(onPressed: () => _go(4), child: Text(l.welcomeSkip))],
        child: GmailConnectForm(onConnected: (_) => setState(() => _gmailOk = true)),
      ),
      _ => _Frame(
        step: 4,
        title: l.welcomeWhatsappTitle,
        subtitle: l.welcomeWhatsappSubtitle,
        error: _error,
        primary: GoldButton(label: l.welcomeStart, icon: Icons.rocket_launch_outlined, expand: true, busy: _busy, onPressed: _finish),
        child: _WhatsAppStep(installed: _whatsApp, onCheck: _checkWhatsApp),
      ),
    };
  }
}

/// Marco de cada pantalla: logo, idioma, «Paso 2 de 5», título, una acción principal y las secundarias.
class _Frame extends StatelessWidget {
  const _Frame({required this.step, required this.child, this.title, this.subtitle, this.error, this.primary, this.secondary = const [], this.wide = false});
  final int? step;
  final String? title;
  final String? subtitle;
  final String? error;
  final Widget child;
  final Widget? primary;
  final List<Widget> secondary;
  final bool wide;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(CorocSpace.lg),
            child: ConstrainedBox(
              constraints: BoxConstraints(maxWidth: wide ? 960 : 620),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Row(
                    children: [
                      CorocLogo(layout: LogoLayout.isotype, height: 44),
                      Spacer(),
                      LanguageSelector(),
                    ],
                  ),
                  const SizedBox(height: CorocSpace.lg),
                  if (step != null) ...[
                    Text(l.welcomeStepOf(step! + 1, _WelcomePageState.steps), style: t.labelLarge?.copyWith(color: Theme.of(context).colorScheme.tertiary)),
                    const SizedBox(height: CorocSpace.sm),
                    Row(
                      children: [
                        for (var i = 0; i < _WelcomePageState.steps; i++)
                          Expanded(
                            child: Container(
                              height: 5,
                              margin: const EdgeInsets.symmetric(horizontal: 3),
                              decoration: BoxDecoration(color: i <= step! ? CorocColors.gold500 : Theme.of(context).colorScheme.outlineVariant, borderRadius: BorderRadius.circular(3)),
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: CorocSpace.lg),
                  ],
                  if (title != null) Text(title!, style: t.headlineMedium),
                  if (subtitle != null) ...[const SizedBox(height: CorocSpace.sm), Text(subtitle!, style: t.bodyLarge?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant, height: 1.45))],
                  const SizedBox(height: CorocSpace.lg),
                  child,
                  if (error != null) ...[const SizedBox(height: CorocSpace.md), ResultBox(ok: false, text: error!)],
                  const SizedBox(height: CorocSpace.lg),
                  ?primary,
                  for (final s in secondary)
                    Padding(
                      padding: const EdgeInsets.only(top: CorocSpace.sm),
                      child: Center(child: s),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Tope legal de la tasa (opcional) y préstamos por encima del tope con la casilla de confirmación (ADR-061).
class _RatesStep extends ConsumerWidget {
  const _RatesStep({required this.country});
  final String country;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final caps = ref.watch(rateCapsProvider).valueOrNull ?? const <RateCap>[];
    final today = Dates.isoToday();
    final current = caps.where((c) => c.validFrom.compareTo(today) <= 0 && c.validTo.compareTo(today) >= 0).toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(CorocSpace.md),
            child: Row(
              children: [
                const Icon(Icons.gavel_outlined),
                const SizedBox(width: CorocSpace.md),
                Expanded(
                  child: Text(current.isEmpty ? l.welcomeRatesNone : l.welcomeRatesCurrent(percent(current.first.effectiveAnnual, context.lang)), style: Theme.of(context).textTheme.titleSmall),
                ),
                OutlinedButton(
                  onPressed: () => showDialog<void>(
                    context: context,
                    builder: (_) => RateCapDialog(country: country),
                  ),
                  child: Text(l.rateCapAdd),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: CorocSpace.md),
        const RateCapPolicySwitch(isOwner: true),
      ],
    );
  }
}

/// ¿Está WhatsApp para Windows? Si no, el botón lleva a Microsoft Store.
class _WhatsAppStep extends ConsumerStatefulWidget {
  const _WhatsAppStep({required this.installed, required this.onCheck});
  final bool? installed;
  final Future<void> Function() onCheck;
  @override
  ConsumerState<_WhatsAppStep> createState() => _WhatsAppStepState();
}

class _WhatsAppStepState extends ConsumerState<_WhatsAppStep> {
  @override
  void initState() {
    super.initState();
    widget.onCheck();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final installed = widget.installed;
    if (installed == null) return const Center(child: CircularProgressIndicator());
    if (installed) return ResultBox(ok: true, text: l.welcomeWhatsappReady);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(l.welcomeWhatsappMissing, style: Theme.of(context).textTheme.bodyLarge?.copyWith(height: 1.45)),
        const SizedBox(height: CorocSpace.md),
        Wrap(
          spacing: CorocSpace.sm,
          runSpacing: CorocSpace.sm,
          children: [
            OutlinedButton.icon(onPressed: () => ref.read(desktopPlatformProvider).openUrl(whatsAppStoreUrl), icon: const Icon(Icons.storefront_outlined), label: Text(l.welcomeWhatsappStore)),
            TextButton.icon(onPressed: widget.onCheck, icon: const Icon(Icons.refresh), label: Text(l.welcomeWhatsappCheck)),
          ],
        ),
      ],
    );
  }
}

/// Restaurar en este PC la copia `.coroc` de otro (E-7): se elige el archivo, se escribe la contraseña de la copia y
/// se ingresa con el usuario de siempre.
class _RestorePanel extends ConsumerStatefulWidget {
  const _RestorePanel({required this.onBack});
  final VoidCallback onBack;
  @override
  ConsumerState<_RestorePanel> createState() => _RestorePanelState();
}

class _RestorePanelState extends ConsumerState<_RestorePanel> {
  final _password = TextEditingController();
  DesktopRestore? _upload;
  double? _progress;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _upload = ref.read(desktopProvider).status?.restore;
  }

  @override
  void dispose() {
    _password.dispose();
    super.dispose();
  }

  Future<void> _pick() async {
    final file = await openFile(
      acceptedTypeGroups: const [
        XTypeGroup(label: 'COROC', extensions: ['coroc']),
      ],
    );
    if (file == null || !mounted) return;
    setState(() {
      _busy = true;
      _error = null;
      _progress = 0;
    });
    try {
      final length = await file.length();
      final r = await ref
          .read(apiProvider)
          .desktopRestoreUpload(
            open: file.openRead,
            length: length,
            onProgress: (sent, total) {
              if (mounted) setState(() => _progress = total <= 0 ? null : sent / total);
            },
          );
      if (mounted) setState(() => _upload = r);
    } catch (e) {
      if (mounted) setState(() => _error = errorText(context, e));
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _progress = null;
        });
      }
    }
  }

  Future<void> _apply() async {
    final upload = _upload;
    if (upload == null || _password.text.isEmpty) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final done = await ref.read(apiProvider).desktopRestoreApply(upload.id, _password.text);
      // El ingreso queda listo con la empresa y el Propietario de la copia.
      if (done.owners.isNotEmpty) await ref.read(sessionStoreProvider).saveLastLogin(done.company.slug, done.owners.first, remember: true);
      await ref.read(desktopProvider.notifier).refreshStatus();
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
    final upload = _upload;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(l.welcomeRestoreTitle, style: t.headlineMedium),
        const SizedBox(height: CorocSpace.sm),
        Text(l.welcomeRestoreSubtitle, style: t.bodyLarge?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant, height: 1.45)),
        const SizedBox(height: CorocSpace.lg),
        if (upload == null) ...[
          if (_progress != null) ...[LinearProgressIndicator(value: _progress), const SizedBox(height: CorocSpace.md)],
          GoldButton(label: l.welcomeRestorePick, icon: Icons.folder_open, expand: true, busy: _busy, onPressed: _pick),
        ] else ...[
          ResultBox(ok: true, text: l.welcomeRestoreFile(upload.company, upload.backupCreatedAt == null ? '—' : Dates.dateTime(upload.backupCreatedAt!, context.lang))),
          const SizedBox(height: CorocSpace.md),
          TextField(
            controller: _password,
            obscureText: true,
            autofocus: true,
            decoration: corocInput(context, label: l.welcomeRestorePassword, prefix: const Icon(Icons.key_outlined)),
            onSubmitted: (_) => _apply(),
          ),
          const SizedBox(height: CorocSpace.lg),
          GoldButton(label: l.welcomeRestoreApply, icon: Icons.settings_backup_restore, expand: true, busy: _busy, onPressed: _apply),
        ],
        if (_error != null) ...[const SizedBox(height: CorocSpace.md), ResultBox(ok: false, text: _error!)],
        const SizedBox(height: CorocSpace.sm),
        Center(
          child: TextButton(onPressed: _busy ? null : widget.onBack, child: Text(l.actionBack)),
        ),
      ],
    );
  }
}
