import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app.dart' show routerProvider;
import '../../core/desktop/desktop_platform.dart';
import '../../core/desktop/desktop_runtime.dart';
import '../../core/l10n.dart';
import '../../core/providers.dart';
import '../../design/widgets/brand.dart';

/// Ventana y bandeja de COROC Escritorio (ADR-062). Cerrar la ventana deja a COROC trabajando junto al reloj
/// («COROC sigue trabajando»: el correo y los recordatorios no se detienen); «Salir» apaga el servidor de este PC en
/// orden. Si el instalador va a actualizar, la app se cierra sola. Fuera de Escritorio no hace nada.
class DesktopWindow extends ConsumerStatefulWidget {
  const DesktopWindow({super.key, required this.child, this.router, this.messagesRoute = '/messages/today'});
  final Widget child;

  /// Router de la app que la usa (el nuevo COROC tiene el suyo); por defecto, el de la app completa.
  final GoRouter? router;

  /// Adónde lleva «Mensajes de hoy» del menú de la bandeja.
  final String messagesRoute;

  @override
  ConsumerState<DesktopWindow> createState() => DesktopWindowState();
}

class DesktopWindowState extends ConsumerState<DesktopWindow> {
  StreamSubscription<WindowSignal>? _signals;
  String? _trayLang;
  bool _quitting = false;

  bool get _on => ref.read(desktopModeProvider);
  DesktopPlatform get _platform => ref.read(desktopPlatformProvider);
  GoRouter get _router => widget.router ?? ref.read(routerProvider);

  @override
  void initState() {
    super.initState();
    if (!_on) return;
    ref.read(desktopProvider.notifier).onInstallerStop = () => unawaited(_platform.quit());
    _signals = _platform.signals.listen((s) => unawaited(_handle(s)));
    unawaited(_platform.initWindow());
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_on || context.lang == _trayLang) return;
    // El menú de la bandeja sigue el idioma de la interfaz.
    _trayLang = context.lang;
    final l = context.l10n;
    unawaited(_platform.setTray(tooltip: l.trayTooltip, items: [TrayEntry('abrir', l.trayOpen), TrayEntry('mensajes', l.trayTodayMessages), const TrayEntry('-', ''), TrayEntry('salir', l.trayQuit)]));
  }

  @override
  void dispose() {
    unawaited(_signals?.cancel());
    super.dispose();
  }

  Future<void> _handle(WindowSignal s) async {
    switch (s.kind) {
      case WindowSignalKind.closeRequested:
        await _toTray();
      case WindowSignalKind.trayClicked:
        await _platform.showWindow();
      case WindowSignalKind.trayItem:
        if (s.key == 'salir') return quit();
        await _platform.showWindow();
        if (s.key == 'mensajes') _router.go(widget.messagesRoute);
      case WindowSignalKind.focused:
        break;
    }
  }

  /// La primera vez se explica que COROC sigue trabajando junto al reloj, y se ofrece salir del todo.
  Future<void> _toTray() async {
    final store = ref.read(sessionStoreProvider);
    if (!await store.trayHintShown()) {
      final ctx = _router.routerDelegate.navigatorKey.currentContext;
      if (ctx != null && ctx.mounted) {
        final l = ctx.l10n;
        final choice = await showDialog<String>(
          context: ctx,
          builder: (c) => AlertDialog(
            icon: const CorocLogo(layout: LogoLayout.isotype, height: 48),
            title: Text(l.trayHintTitle),
            content: SizedBox(width: 440, child: Text(l.trayHintBody)),
            actions: [
              TextButton(onPressed: () => Navigator.pop(c, 'salir'), child: Text(l.trayQuit)),
              FilledButton(onPressed: () => Navigator.pop(c, 'ok'), child: Text(l.trayHintOk)),
            ],
          ),
        );
        await store.saveTrayHintShown();
        if (choice == 'salir') return quit();
      }
    }
    await _platform.hideWindow();
  }

  /// Apaga el servidor y la base de este PC en orden y cierra la app.
  Future<void> quit() async {
    if (_quitting) return;
    _quitting = true;
    await ref.read(desktopProvider.notifier).stop();
    await _platform.quit();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
