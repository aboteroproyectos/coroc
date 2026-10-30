import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_controller.dart';
import '../../design/tokens.dart';
import '../../design/widgets/brand.dart';
import '../auth/lock_page.dart';

/// Capa de seguridad (§7.1, §7.3): bloqueo por inactividad con desbloqueo biométrico y contenido oculto
/// en el selector de apps del sistema.
class SecurityLayer extends ConsumerStatefulWidget {
  const SecurityLayer({super.key, required this.child});
  final Widget child;
  @override
  ConsumerState<SecurityLayer> createState() => _SecurityLayerState();
}

class _SecurityLayerState extends ConsumerState<SecurityLayer> with WidgetsBindingObserver {
  Timer? _idle;
  bool _obscured = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _arm();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _idle?.cancel();
    super.dispose();
  }

  void _arm() {
    _idle?.cancel();
    final auth = ref.read(authProvider);
    if (auth is! SignedIn || auth.locked) return;
    _idle = Timer(Duration(minutes: auth.user.autoLockMinutes), () => ref.read(authProvider.notifier).lock());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final hide = state == AppLifecycleState.inactive || state == AppLifecycleState.hidden || state == AppLifecycleState.paused;
    if (hide != _obscured) setState(() => _obscured = hide);
    if (state == AppLifecycleState.resumed) _arm();
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<AuthState>(authProvider, (_, _) => _arm());
    final auth = ref.watch(authProvider);
    final locked = auth is SignedIn && auth.locked;
    return Listener(
      behavior: HitTestBehavior.translucent,
      onPointerDown: (_) => _arm(),
      child: Focus(
        onKeyEvent: (_, _) {
          _arm();
          return KeyEventResult.ignored;
        },
        child: Stack(
          children: [
            widget.child,
            if (locked) const Positioned.fill(child: LockPage()),
            if (_obscured)
              Positioned.fill(
                child: ColoredBox(
                  color: CorocColors.navy900,
                  child: Center(
                    child: Theme(data: ThemeData.dark(), child: const CorocLogo(height: 140)),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
