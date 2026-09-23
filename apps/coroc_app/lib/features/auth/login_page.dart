import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/l10n.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/brand.dart';
import '../../design/widgets/common.dart';

/// Selector de idioma visible desde la pantalla de ingreso (§5.7-1, §6).
class LanguageSelector extends ConsumerWidget {
  const LanguageSelector({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final code = ref.watch(localeProvider).languageCode;
    return SegmentedButton<String>(
      showSelectedIcon: false,
      segments: const [
        ButtonSegment(value: 'es', label: Text('ES'), tooltip: 'Español'),
        ButtonSegment(value: 'pt', label: Text('PT'), tooltip: 'Português (Brasil)'),
        ButtonSegment(value: 'en', label: Text('EN'), tooltip: 'English'),
      ],
      selected: {code},
      onSelectionChanged: (v) => ref.read(localeProvider.notifier).set(v.first),
    );
  }
}

/// Pantalla de ingreso: logotipo completo, grande y centrado; empresa, usuario, contraseña y «Recordarme» (§5.7-1, §7.1).
class LoginPage extends ConsumerStatefulWidget {
  const LoginPage({super.key});
  @override
  ConsumerState<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends ConsumerState<LoginPage> {
  final _form = GlobalKey<FormState>();
  final _tenant = TextEditingController();
  final _user = TextEditingController();
  final _pass = TextEditingController();
  bool _remember = false;
  bool _obscure = true;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    ref.read(sessionStoreProvider).lastLogin().then((v) {
      if (!mounted) return;
      setState(() {
        _tenant.text = v.tenant ?? '';
        _user.text = v.username ?? '';
        _remember = v.remember;
      });
    });
  }

  @override
  void dispose() {
    _tenant.dispose();
    _user.dispose();
    _pass.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_form.currentState?.validate() ?? false)) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(authProvider.notifier).login(tenant: _tenant.text, username: _user.text, password: _pass.text, remember: _remember);
    } catch (e) {
      if (mounted) setState(() => _error = errorText(context, e));
    } finally {
      _pass.clear();
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final expired = ref.watch(authProvider) is SignedOut && (ref.watch(authProvider) as SignedOut).expired;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(CorocSpace.lg),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: AutofillGroup(
                child: Form(
                  key: _form,
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    const Align(alignment: Alignment.centerRight, child: LanguageSelector()),
                    const SizedBox(height: CorocSpace.lg),
                    const Center(child: CorocLogo(height: 170)),
                    const SizedBox(height: CorocSpace.xl),
                    if (expired) ...[
                      _Notice(text: l.loginSessionExpired),
                      const SizedBox(height: CorocSpace.md),
                    ],
                    TextFormField(
                      controller: _tenant,
                      decoration: corocInput(context, label: l.loginCompany, hint: l.loginCompanyHint, prefix: const Icon(Icons.apartment_outlined)),
                      textInputAction: TextInputAction.next,
                      autocorrect: false,
                      validator: (v) => (v ?? '').trim().length < 3 ? l.validationRequired : null,
                    ),
                    const SizedBox(height: CorocSpace.md),
                    TextFormField(
                      controller: _user,
                      decoration: corocInput(context, label: l.loginUsername, prefix: const Icon(Icons.person_outline)),
                      textInputAction: TextInputAction.next,
                      autocorrect: false,
                      autofillHints: const [AutofillHints.username],
                      validator: (v) => (v ?? '').trim().isEmpty ? l.validationRequired : null,
                    ),
                    const SizedBox(height: CorocSpace.md),
                    TextFormField(
                      controller: _pass,
                      obscureText: _obscure,
                      decoration: corocInput(
                        context,
                        label: l.loginPassword,
                        prefix: const Icon(Icons.lock_outline),
                        suffix: IconButton(
                          tooltip: _obscure ? l.actionShowPassword : l.actionHidePassword,
                          icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                          onPressed: () => setState(() => _obscure = !_obscure),
                        ),
                      ),
                      autofillHints: const [AutofillHints.password],
                      onFieldSubmitted: (_) => _submit(),
                      validator: (v) => (v ?? '').isEmpty ? l.validationRequired : null,
                    ),
                    const SizedBox(height: CorocSpace.sm),
                    CheckboxListTile(
                      value: _remember,
                      onChanged: (v) => setState(() => _remember = v ?? false),
                      title: Text(l.loginRemember),
                      controlAffinity: ListTileControlAffinity.leading,
                      contentPadding: EdgeInsets.zero,
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: CorocSpace.sm),
                      _Notice(text: _error!, error: true),
                    ],
                    const SizedBox(height: CorocSpace.md),
                    GoldButton(label: l.loginSubmit, onPressed: _submit, busy: _busy, expand: true),
                    const SizedBox(height: CorocSpace.sm),
                    TextButton(onPressed: () => context.go('/forgot'), child: Text(l.loginForgot)),
                  ]),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({required this.text, this.error = false});
  final String text;
  final bool error;
  @override
  Widget build(BuildContext context) {
    final c = error ? Theme.of(context).colorScheme.error : Theme.of(context).colorScheme.secondary;
    return Container(
      padding: const EdgeInsets.all(CorocSpace.md),
      decoration: BoxDecoration(borderRadius: BorderRadius.circular(CorocRadii.control), border: Border.all(color: c.withValues(alpha: 0.5))),
      child: Row(children: [
        Icon(error ? Icons.error_outline : Icons.info_outline, color: c),
        const SizedBox(width: 12),
        Expanded(child: Text(text, style: Theme.of(context).textTheme.bodyMedium)),
      ]),
    );
  }
}

/// Fondo sobrio para las pantallas de ingreso secundarias.
class AuthFrame extends StatelessWidget {
  const AuthFrame({super.key, required this.title, required this.children, this.subtitle});
  final String title;
  final String? subtitle;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(CorocSpace.lg),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                const Center(child: CorocLogo(layout: LogoLayout.isotype, height: 64)),
                const SizedBox(height: CorocSpace.lg),
                Text(title, style: t.headlineMedium, textAlign: TextAlign.center),
                if (subtitle != null) ...[
                  const SizedBox(height: CorocSpace.sm),
                  Text(subtitle!, style: t.bodyMedium?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant), textAlign: TextAlign.center),
                ],
                const SizedBox(height: CorocSpace.lg),
                ...children,
              ]),
            ),
          ),
        ),
      ),
    );
  }
}

/// Campo de 6 dígitos para el código TOTP.
class CodeField extends StatelessWidget {
  const CodeField({super.key, required this.controller, required this.onSubmit, this.error});
  final TextEditingController controller;
  final VoidCallback onSubmit;
  final String? error;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      autofocus: true,
      keyboardType: TextInputType.number,
      maxLength: 6,
      textAlign: TextAlign.center,
      autofillHints: const [AutofillHints.oneTimeCode],
      style: Theme.of(context).textTheme.headlineMedium?.copyWith(letterSpacing: 12, fontFamily: 'Inter'),
      decoration: corocInput(context, label: context.l10n.mfaCode, error: error).copyWith(counterText: ''),
      onChanged: (v) {
        if (v.length == 6) onSubmit();
      },
      onSubmitted: (_) => onSubmit(),
    );
  }
}
