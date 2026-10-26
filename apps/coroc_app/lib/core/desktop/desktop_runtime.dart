import 'dart:async';
import 'dart:convert';
import 'dart:io' show Platform;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_exception.dart';
import '../auth/auth_controller.dart';
import '../config.dart';
import '../models/models.dart';
import '../providers.dart';
import 'desktop_platform.dart';
import 'windows_platform.dart';

/// COROC Escritorio (se activa al compilar con COROC_DESKTOP=true; las pruebas lo encienden aquí).
final desktopModeProvider = Provider<bool>((ref) => AppConfig.desktop);

final desktopPlatformProvider = Provider<DesktopPlatform>((ref) => Platform.isWindows ? WindowsDesktopPlatform() : const UnsupportedDesktopPlatform());

/// Abierto por «Iniciar COROC con Windows» (`--minimizado`): la ventana queda en la bandeja.
final launchMinimizedProvider = Provider<bool>((ref) => false);

/// Cerrar la ventana, volver a ella y los toques en la bandeja (la página «Mensajes de hoy» avanza al volver).
final windowSignalsProvider = StreamProvider<WindowSignal>((ref) => ref.watch(desktopPlatformProvider).signals);

enum DesktopPhase { off, starting, ready, failed }

/// Estado del servidor de este PC. Los pasos y códigos vienen del supervisor (ADR-062).
class DesktopState {
  const DesktopState({required this.phase, this.step, this.code, this.detail, this.status, this.version, this.restarting = false});
  static const off = DesktopState(phase: DesktopPhase.off);
  final DesktopPhase phase;

  /// claves · base · migraciones · servidor
  final String? step;

  /// Código del problema (BASE_NO_INICIA, SIN_SERVIDOR, …) y su detalle técnico para soporte.
  final String? code;
  final String? detail;
  final DesktopStatus? status;
  final String? version;

  /// El supervisor se volvió a encender y aún no está listo: la app sigue en la misma pantalla.
  final bool restarting;

  bool get ready => phase == DesktopPhase.ready;
  bool get configured => status?.configured ?? false;

  DesktopState copyWith({DesktopPhase? phase, String? step, DesktopStatus? status, bool? restarting}) =>
      DesktopState(phase: phase ?? this.phase, step: step ?? this.step, code: code, detail: detail, status: status ?? this.status, version: version, restarting: restarting ?? this.restarting);
}

/// Enciende el servidor de este PC, lo vigila y lo apaga en orden. Si el supervisor se cierra sin que nadie lo pida,
/// lo vuelve a encender (1 s, 2 s, 5 s, 10 s y 30 s); si sigue cayendo, explica qué pasó y ofrece intentar de nuevo.
class DesktopRuntime extends Notifier<DesktopState> {
  static const backoff = [Duration(seconds: 1), Duration(seconds: 2), Duration(seconds: 5), Duration(seconds: 10), Duration(seconds: 30)];

  ServerProcess? _proc;
  Timer? _restart;
  bool _stopping = false;
  int _deaths = 0;
  DateTime? _lastDeath;

  /// Lo fija la ventana: el instalador va a actualizar o desinstalar y la app se cierra sola.
  void Function()? onInstallerStop;

  @override
  DesktopState build() {
    if (!ref.watch(desktopModeProvider)) return DesktopState.off;
    ref.onDispose(() {
      _stopping = true;
      _restart?.cancel();
      _proc?.kill();
    });
    Future.microtask(start);
    return const DesktopState(phase: DesktopPhase.starting, step: 'claves');
  }

  Future<void> start() async {
    _stopping = false;
    _restart?.cancel();
    final platform = ref.read(desktopPlatformProvider);
    final folder = platform.serverFolder();
    if (folder == null) {
      state = const DesktopState(phase: DesktopPhase.failed, code: 'SIN_SERVIDOR');
      return;
    }
    // Un reinicio con COROC ya abierto no saca a la persona de la pantalla en que está.
    if (!state.ready) state = const DesktopState(phase: DesktopPhase.starting, step: 'claves');
    try {
      final proc = await platform.startServer(folder);
      _proc = proc;
      proc.lines.listen(_line);
      unawaited(proc.done.then((_) => _ended(proc)));
    } on Object catch (e) {
      state = DesktopState(phase: DesktopPhase.failed, code: 'NO_INICIA', detail: '$e');
    }
  }

  void _line(String line) {
    final Object? decoded;
    try {
      decoded = jsonDecode(line);
    } on FormatException {
      return;
    }
    if (decoded is! Map<String, dynamic>) return;
    switch (decoded['evento']) {
      case 'iniciando':
        state = state.ready ? state.copyWith(restarting: true) : DesktopState(phase: DesktopPhase.starting, step: decoded['paso'] as String?);
      case 'listo':
        unawaited(_ready(decoded));
      case 'reiniciando':
        if (state.ready) state = state.copyWith(restarting: true);
      case 'error':
        state = DesktopState(phase: DesktopPhase.failed, code: decoded['codigo'] as String? ?? 'ERROR', detail: decoded['detalle'] as String?);
      case 'detenido':
        if (decoded['motivo'] == 'instalador') {
          _stopping = true;
          onInstallerStop?.call();
        }
    }
  }

  Future<void> _ready(Map<String, dynamic> e) async {
    ref.read(apiClientProvider).useDesktopServer(e['api'] as String, e['clave'] as String);
    final first = !state.ready;
    for (var i = 0; ; i++) {
      try {
        final status = await ref.read(apiProvider).desktopStatus();
        state = DesktopState(phase: DesktopPhase.ready, status: status, version: e['version'] as String?);
        _deaths = 0;
        if (first) await _openSession(status);
        return;
      } on ApiException {
        if (i >= 4) {
          state = const DesktopState(phase: DesktopPhase.failed, code: 'SIN_RESPUESTA');
          return;
        }
        await Future<void>.delayed(Duration(seconds: i + 1));
      }
    }
  }

  /// Con empresa: se retoma la sesión recordada (bloqueada si la persona eligió Windows Hello). Sin empresa: asistente.
  Future<void> _openSession(DesktopStatus status) async {
    final auth = ref.read(authProvider.notifier);
    if (!status.configured) {
      auth.signedOut();
      return;
    }
    await auth.restore(locked: await ref.read(sessionStoreProvider).helloEnabled());
  }

  /// Vuelve a leer el estado (al terminar el asistente o una restauración).
  Future<void> refreshStatus() async {
    final status = await ref.read(apiProvider).desktopStatus();
    state = state.copyWith(status: status);
  }

  void _ended(ServerProcess proc) {
    if (_proc != proc) return;
    _proc = null;
    if (_stopping || state.phase == DesktopPhase.failed) return;
    final now = DateTime.now();
    if (_lastDeath == null || now.difference(_lastDeath!) > const Duration(minutes: 5)) _deaths = 0;
    _lastDeath = now;
    if (_deaths >= backoff.length) {
      state = const DesktopState(phase: DesktopPhase.failed, code: 'SE_DETUVO');
      return;
    }
    final wait = backoff[_deaths++];
    if (state.ready) state = state.copyWith(restarting: true);
    _restart = Timer(wait, () => unawaited(start()));
  }

  /// Desde la pantalla de error: «Intentar de nuevo».
  Future<void> retry() async {
    _deaths = 0;
    state = const DesktopState(phase: DesktopPhase.starting, step: 'claves');
    await start();
  }

  /// «Salir» de la bandeja: el supervisor apaga el servidor y la base en orden antes de cerrar la app.
  Future<void> stop() async {
    _stopping = true;
    _restart?.cancel();
    final proc = _proc;
    if (proc == null) return;
    proc.send('detener');
    await proc.done.timeout(const Duration(seconds: 45), onTimeout: proc.kill);
  }
}

final desktopProvider = NotifierProvider<DesktopRuntime, DesktopState>(DesktopRuntime.new);
