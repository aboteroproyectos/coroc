import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/desktop/desktop_runtime.dart';
import '../../core/l10n.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/brand.dart';
import '../../design/widgets/common.dart';
import '../../features/desktop/gmail_connect.dart';
import '../../features/desktop/welcome_page.dart' show RestorePanel, suggestUsername, whatsAppStoreUrl;
import '../../features/settings/settings_page.dart' show countryName;
import '../ui/bank.dart';
import '../ui/stage.dart';

/// Primer uso del nuevo COROC en este PC: cuatro pasos cortos con una sola acción cada uno. 1 Su negocio · 2 Usted
/// (contraseña y Windows Hello) · 3 Gmail (opcional) · 4 WhatsApp. Desde el primero también se restaura la copia de
/// otro PC. El tope de la tasa queda en Configuración: el primer préstamo avisa si hace falta.
class PersonalWelcomePage extends ConsumerStatefulWidget {
  const PersonalWelcomePage({super.key});
  @override
  ConsumerState<PersonalWelcomePage> createState() => _PersonalWelcomePageState();
}

class _PersonalWelcomePageState extends ConsumerState<PersonalWelcomePage> {
  static const steps = 4;
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

  /// El usuario se sugiere solo a partir del nombre; la persona lo cambia si quiere.
  bool _editUser = false;
  bool _obscure = true;
  bool _helloAvailable = false;
  bool _hello = false;
  bool _gmailOk = false;
  bool? _whatsApp;

  @override
  void initState() {
    super.initState();
    _name.addListener(() {
      if (!_editUser) setState(() => _user.text = suggestUsername(_name.text));
    });
    ref.read(desktopPlatformProvider).helloAvailable().then((ok) {
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

  Future<void> _create() async {
    final l = context.l10n;
    final user = _user.text.trim().toLowerCase();
    String? problem;
    if (_name.text.trim().isEmpty) {
      problem = l.welcomeNameRequired;
    } else if (!RegExp(r'^[a-z0-9._-]{3,32}$').hasMatch(user)) {
      problem = l.welcomeUsernameInvalid;
      _editUser = true;
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
      final email = _email.text.trim();
      final session = await ref
          .read(apiProvider)
          .desktopSetup(
            companyName: _company.text.trim(),
            country: _country,
            lang: ref.read(localeProvider.notifier).apiCode,
            ownerName: _name.text.trim(),
            username: user,
            password: _pass.text,
            email: email.isEmpty ? null : email,
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

  /// Fin: con el negocio ya creado, COROC pasa a Inicio (y al recorrido de bienvenida).
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
    if (_restoring) {
      return AuthStage(
        child: BankCard(
          padding: const EdgeInsets.all(28),
          child: RestorePanel(onBack: () => setState(() => _restoring = false)),
        ),
      );
    }
    return switch (_step) {
      0 => _Step(
        step: 0,
        title: l.welcomeTitle,
        subtitle: l.pWelcomeSubtitle,
        error: _error,
        primary: GoldButton(
          label: l.actionContinue,
          icon: Icons.arrow_forward,
          expand: true,
          onPressed: () {
            if (_company.text.trim().length < 2) return setState(() => _error = l.pWelcomeBusinessRequired);
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
              decoration: corocInput(context, label: l.pWelcomeBusinessName, hint: l.welcomeCompanyHint, helper: l.pWelcomeBusinessHelp, prefix: const Icon(Icons.storefront_outlined)),
              onSubmitted: (_) {
                if (_company.text.trim().length >= 2) _go(1);
              },
            ),
            const SizedBox(height: 22),
            Text(l.pWelcomeCountry, style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final (code, money) in const [('CO', 'COP'), ('BR', 'BRL'), ('US', 'USD')])
                  ChoiceChip(
                    label: Text('${countryName(l, code)} · $money', style: _country == code ? const TextStyle(color: CorocColors.ivory) : null),
                    selected: _country == code,
                    onSelected: (_) => setState(() => _country = code),
                  ),
              ],
            ),
          ],
        ),
      ),
      1 => _Step(
        step: 1,
        title: l.pWelcomeYouTitle,
        subtitle: l.pWelcomeYouSubtitle,
        error: _error,
        primary: GoldButton(label: l.pWelcomeCreate, icon: Icons.check, expand: true, busy: _busy, onPressed: _create),
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
              const SizedBox(height: 12),
              if (_editUser)
                TextField(
                  controller: _user,
                  autocorrect: false,
                  autofillHints: const [AutofillHints.newUsername],
                  decoration: corocInput(context, label: l.loginUsername, helper: l.welcomeUsernameHelp, prefix: const Icon(Icons.badge_outlined)),
                )
              else if (_user.text.isNotEmpty)
                Row(
                  children: [
                    const Icon(Icons.badge_outlined, size: 20, color: Bank.muted),
                    const SizedBox(width: 10),
                    Expanded(child: Text(l.pWelcomeUserWillBe(_user.text), style: Theme.of(context).textTheme.bodyMedium)),
                    TextButton(onPressed: () => setState(() => _editUser = true), child: Text(l.pChange)),
                  ],
                ),
              const SizedBox(height: 12),
              TextField(
                controller: _pass,
                obscureText: _obscure,
                autofillHints: const [AutofillHints.newPassword],
                decoration: corocInput(
                  context,
                  label: l.loginPassword,
                  helper: l.welcomePasswordHelp,
                  prefix: const Icon(Icons.lock_outline),
                  suffix: IconButton(
                    tooltip: _obscure ? l.actionShowPassword : l.actionHidePassword,
                    icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                    onPressed: () => setState(() => _obscure = !_obscure),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _pass2,
                obscureText: _obscure,
                decoration: corocInput(context, label: l.welcomePasswordAgain, prefix: const Icon(Icons.lock_outline)),
                onSubmitted: (_) => _create(),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _email,
                keyboardType: TextInputType.emailAddress,
                decoration: corocInput(context, label: l.welcomeEmailOptional, prefix: const Icon(Icons.mail_outline)),
              ),
              if (_helloAvailable) ...[
                const SizedBox(height: 8),
                CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                  value: _hello,
                  onChanged: (v) => setState(() => _hello = v ?? false),
                  title: Text(l.welcomeHello),
                  subtitle: Text(l.welcomeHelloHelp),
                ),
              ],
            ],
          ),
        ),
      ),
      2 => _Step(
        step: 2,
        wide: true,
        title: l.pWelcomeGmailTitle,
        subtitle: l.pWelcomeGmailSubtitle,
        error: _error,
        primary: _gmailOk ? GoldButton(label: l.actionContinue, icon: Icons.arrow_forward, expand: true, onPressed: () => _go(3)) : null,
        secondary: [if (!_gmailOk) TextButton(onPressed: () => _go(3), child: Text(l.welcomeSkip))],
        child: GmailConnectForm(onConnected: (_) => setState(() => _gmailOk = true)),
      ),
      _ => _Step(
        step: 3,
        title: l.welcomeWhatsappTitle,
        subtitle: l.pWelcomeWhatsappSubtitle,
        error: _error,
        primary: GoldButton(label: l.welcomeStart, icon: Icons.rocket_launch_outlined, expand: true, busy: _busy, onPressed: _finish),
        child: _WhatsApp(installed: _whatsApp, onCheck: _checkWhatsApp),
      ),
    };
  }
}

/// Un paso: «Paso 2 de 4», título, la tarea en una tarjeta blanca, una acción principal y las secundarias debajo.
class _Step extends StatelessWidget {
  const _Step({required this.step, required this.title, required this.child, this.subtitle, this.error, this.primary, this.secondary = const [], this.wide = false});
  final int step;
  final String title;
  final String? subtitle;
  final String? error;
  final Widget child;
  final Widget? primary;
  final List<Widget> secondary;
  final bool wide;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return AuthStage(
      maxWidth: wide ? 760 : 520,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          StepBar(step: step, total: _PersonalWelcomePageState.steps),
          const SizedBox(height: 24),
          Text(title, style: t.headlineLarge?.copyWith(fontSize: 30)),
          if (subtitle != null) ...[const SizedBox(height: 8), Text(subtitle!, style: t.bodyLarge?.copyWith(color: Bank.muted, height: 1.45))],
          const SizedBox(height: 24),
          BankCard(
            padding: const EdgeInsets.all(28),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                child,
                if (error != null) ...[const SizedBox(height: 16), InfoNote(error!, icon: Icons.error_outline, tone: StatusTone.error)],
                if (primary != null) ...[const SizedBox(height: 24), primary!],
              ],
            ),
          ),
          for (final s in secondary)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: Center(child: s),
            ),
        ],
      ),
    );
  }
}

/// ¿Está WhatsApp para Windows en este PC? Si no, el botón lleva a Microsoft Store.
class _WhatsApp extends ConsumerStatefulWidget {
  const _WhatsApp({required this.installed, required this.onCheck});
  final bool? installed;
  final Future<void> Function() onCheck;
  @override
  ConsumerState<_WhatsApp> createState() => _WhatsAppState();
}

class _WhatsAppState extends ConsumerState<_WhatsApp> {
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
    if (installed) return InfoNote(l.welcomeWhatsappReady, icon: Icons.check_circle_outline, tone: StatusTone.ok);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        InfoNote(l.welcomeWhatsappMissing, icon: Icons.download_outlined, tone: StatusTone.warn),
        const SizedBox(height: 14),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            OutlinedButton.icon(onPressed: () => ref.read(desktopPlatformProvider).openUrl(whatsAppStoreUrl), icon: const Icon(Icons.storefront_outlined), label: Text(l.welcomeWhatsappStore)),
            TextButton.icon(onPressed: widget.onCheck, icon: const Icon(Icons.refresh), label: Text(l.welcomeWhatsappCheck)),
          ],
        ),
      ],
    );
  }
}
