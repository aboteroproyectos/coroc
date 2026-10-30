import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/desktop/desktop_runtime.dart';
import '../../core/l10n.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../design/widgets/brand.dart';
import '../../design/widgets/common.dart';
import '../ui/bank.dart';
import '../ui/stage.dart';

/// Entrar al nuevo COROC: el nombre del negocio, el usuario ya puesto y solo la contraseña. Con Windows Hello, COROC
/// abre con el rostro, la huella o el PIN sin pasar por aquí (pantalla de bloqueo).
class PersonalLoginPage extends ConsumerStatefulWidget {
  const PersonalLoginPage({super.key});
  @override
  ConsumerState<PersonalLoginPage> createState() => _PersonalLoginPageState();
}

class _PersonalLoginPageState extends ConsumerState<PersonalLoginPage> {
  final _user = TextEditingController();
  final _pass = TextEditingController();

  /// El usuario recordado en este PC; sin él (o con «¿No es usted?») se escribe.
  String? _known;
  bool _obscure = true;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    ref.read(sessionStoreProvider).lastLogin().then((v) {
      if (!mounted) return;
      setState(() {
        _known = v.username;
        _user.text = v.username ?? '';
      });
    });
  }

  @override
  void dispose() {
    _user.dispose();
    _pass.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final l = context.l10n;
    if (_user.text.trim().isEmpty || _pass.text.isEmpty) {
      setState(() => _error = l.pLoginMissing);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    // Una sola empresa por PC: su identificador lo pone COROC, y el usuario queda recordado.
    final company = ref.read(desktopProvider).status?.company;
    try {
      await ref.read(authProvider.notifier).login(tenant: company?.slug ?? '', username: _user.text.trim(), password: _pass.text, remember: true);
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
    final t = Theme.of(context).textTheme;
    final auth = ref.watch(authProvider);
    final expired = auth is SignedOut && auth.expired;
    final company = ref.watch(desktopProvider).status?.company;
    final known = _known;
    return AuthStage(
      maxWidth: 440,
      child: AutofillGroup(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(l.pLoginTitle, style: t.headlineLarge?.copyWith(fontSize: 30)),
            if (company != null) ...[const SizedBox(height: 6), Text(company.name, style: t.titleMedium?.copyWith(color: Bank.muted))],
            const SizedBox(height: 24),
            BankCard(
              padding: const EdgeInsets.all(28),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (expired) ...[InfoNote(l.loginSessionExpired), const SizedBox(height: 16)],
                  if (known != null)
                    Row(
                      children: [
                        Monogram(known, size: 44),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Text(known, style: t.titleMedium, overflow: TextOverflow.ellipsis),
                        ),
                        TextButton(
                          onPressed: () => setState(() {
                            _known = null;
                            _user.clear();
                          }),
                          child: Text(l.pLoginNotYou),
                        ),
                      ],
                    )
                  else
                    TextField(
                      controller: _user,
                      autocorrect: false,
                      autofillHints: const [AutofillHints.username],
                      decoration: corocInput(context, label: l.loginUsername, prefix: const Icon(Icons.person_outline)),
                      textInputAction: TextInputAction.next,
                    ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: _pass,
                    autofocus: true,
                    obscureText: _obscure,
                    autofillHints: const [AutofillHints.password],
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
                    onSubmitted: (_) => _submit(),
                  ),
                  if (_error != null) ...[const SizedBox(height: 16), InfoNote(_error!, icon: Icons.error_outline, tone: StatusTone.error)],
                  const SizedBox(height: 24),
                  GoldButton(label: l.loginSubmit, icon: Icons.login, expand: true, busy: _busy, onPressed: _submit),
                ],
              ),
            ),
            const SizedBox(height: 10),
            Center(
              child: TextButton(onPressed: () => context.go('/ingresar/olvido'), child: Text(l.loginForgot)),
            ),
          ],
        ),
      ),
    );
  }
}
