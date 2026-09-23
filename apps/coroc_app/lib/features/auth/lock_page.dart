import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:local_auth/local_auth.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/l10n.dart';
import '../../design/tokens.dart';
import '../../design/widgets/brand.dart';

/// Bloqueo por inactividad (§7.1): se desbloquea con huella, Face ID, Windows Hello o Touch ID. Sin biometría
/// disponible, se cierra la sesión y se vuelve a ingresar con contraseña.
class LockPage extends ConsumerStatefulWidget {
  const LockPage({super.key});
  @override
  ConsumerState<LockPage> createState() => _LockPageState();
}

class _LockPageState extends ConsumerState<LockPage> {
  final _auth = LocalAuthentication();
  bool _available = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _check();
  }

  Future<void> _check() async {
    bool ok = false;
    try {
      ok = await _auth.isDeviceSupported() && await _auth.canCheckBiometrics;
    } catch (_) {
      ok = false;
    }
    if (!mounted) return;
    setState(() => _available = ok);
    if (ok) await _unlock();
  }

  Future<void> _unlock() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final reason = context.l10n.lockReason;
      final ok = await _auth.authenticate(localizedReason: reason, options: const AuthenticationOptions(stickyAuth: true));
      if (ok) ref.read(authProvider.notifier).unlock();
    } catch (_) {
      // El usuario canceló o el sistema no respondió: la pantalla sigue bloqueada.
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    return Material(
      color: Theme.of(context).scaffoldBackgroundColor,
      child: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(CorocSpace.xl),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              const CorocLogo(height: 120),
              const SizedBox(height: CorocSpace.xl),
              Text(l.lockTitle, style: t.headlineSmall, textAlign: TextAlign.center),
              const SizedBox(height: CorocSpace.sm),
              Text(_available ? l.lockSubtitle : l.lockNoBiometrics, style: t.bodyMedium, textAlign: TextAlign.center),
              const SizedBox(height: CorocSpace.xl),
              if (_available) GoldButton(label: l.lockUnlock, icon: Icons.fingerprint, onPressed: _unlock, busy: _busy),
              const SizedBox(height: CorocSpace.sm),
              TextButton(onPressed: () => ref.read(authProvider.notifier).logout(), child: Text(l.actionLogout)),
            ]),
          ),
        ),
      ),
    );
  }
}
