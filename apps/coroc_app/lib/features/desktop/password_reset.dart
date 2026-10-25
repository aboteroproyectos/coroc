import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/desktop/desktop_runtime.dart';
import '../../core/l10n.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/brand.dart';
import '../../design/widgets/common.dart';
import '../auth/login_page.dart' show AuthFrame;
import 'gmail_connect.dart' show ResultBox;

/// «¿Olvidó su contraseña?» en COROC Escritorio (ADR-063): sin correo de por medio. La persona confirma que es ella con
/// Windows Hello (rostro, huella o PIN) en este PC y elige una contraseña nueva; sus sesiones abiertas se cierran.
class DesktopPasswordReset extends ConsumerStatefulWidget {
  const DesktopPasswordReset({super.key});
  @override
  ConsumerState<DesktopPasswordReset> createState() => _DesktopPasswordResetState();
}

class _DesktopPasswordResetState extends ConsumerState<DesktopPasswordReset> {
  final _user = TextEditingController();
  final _pass = TextEditingController();
  final _pass2 = TextEditingController();
  bool? _hello;
  bool _busy = false;
  bool _done = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    ref.read(desktopPlatformProvider).helloAvailable().then((ok) {
      if (mounted) setState(() => _hello = ok);
    });
    ref.read(sessionStoreProvider).lastLogin().then((v) {
      if (mounted && _user.text.isEmpty) _user.text = v.username ?? '';
    });
  }

  @override
  void dispose() {
    _user.dispose();
    _pass.dispose();
    _pass2.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final l = context.l10n;
    final user = _user.text.trim().toLowerCase();
    String? problem;
    if (!RegExp(r'^[a-z0-9._-]{3,32}$').hasMatch(user)) {
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
      if (!await ref.read(desktopPlatformProvider).verifyUser(l.helloResetReason)) {
        if (mounted) setState(() => _error = l.helloNotConfirmed);
        return;
      }
      await ref.read(apiProvider).desktopResetPassword(user, _pass.text);
      _pass.clear();
      _pass2.clear();
      if (mounted) setState(() => _done = true);
    } catch (e) {
      if (mounted) setState(() => _error = errorText(context, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final back = TextButton(onPressed: () => context.go('/login'), child: Text(l.forgotBack));
    if (_done) {
      return AuthFrame(
        title: l.forgotTitle,
        children: [
          ResultBox(ok: true, text: l.desktopResetDone),
          const SizedBox(height: CorocSpace.md),
          back,
        ],
      );
    }
    if (_hello == false) {
      return AuthFrame(
        title: l.forgotTitle,
        children: [
          ResultBox(ok: false, text: l.desktopResetNoHello),
          const SizedBox(height: CorocSpace.md),
          back,
        ],
      );
    }
    return AuthFrame(
      title: l.forgotTitle,
      subtitle: l.desktopResetSubtitle,
      children: [
        TextField(
          controller: _user,
          autocorrect: false,
          decoration: corocInput(context, label: l.loginUsername, prefix: const Icon(Icons.person_outline)),
        ),
        const SizedBox(height: CorocSpace.md),
        TextField(
          controller: _pass,
          obscureText: true,
          decoration: corocInput(context, label: l.desktopResetNewPassword, helper: l.welcomePasswordHelp, prefix: const Icon(Icons.lock_outline)),
        ),
        const SizedBox(height: CorocSpace.md),
        TextField(
          controller: _pass2,
          obscureText: true,
          decoration: corocInput(context, label: l.welcomePasswordAgain, prefix: const Icon(Icons.lock_outline)),
          onSubmitted: (_) => _save(),
        ),
        if (_error != null) ...[const SizedBox(height: CorocSpace.md), ResultBox(ok: false, text: _error!)],
        const SizedBox(height: CorocSpace.lg),
        GoldButton(label: l.desktopResetSubmit, icon: Icons.fingerprint, onPressed: _save, busy: _busy, expand: true),
        const SizedBox(height: CorocSpace.sm),
        back,
      ],
    );
  }
}
