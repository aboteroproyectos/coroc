import 'dart:async';
import 'dart:convert';

import 'package:coroc/core/desktop/desktop_platform.dart';
import 'package:coroc/core/desktop/desktop_runtime.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import 'app_harness.dart';
import 'fake_api.dart';
import 'support.dart';

/// El supervisor de prueba: la prueba decide qué eventos manda (una línea JSON por evento, como el real).
class FakeServer implements ServerProcess {
  final _lines = StreamController<String>();
  final _done = Completer<void>();
  final sent = <String>[];
  bool killed = false;

  void emit(Map<String, Object?> event) {
    if (!_lines.isClosed) _lines.add(jsonEncode(event));
  }

  void raw(String line) => _lines.add(line);

  void exit() {
    if (!_done.isCompleted) _done.complete();
    unawaited(_lines.close());
  }

  /// Los cuatro pasos y «listo», como al abrir COROC.
  void ready({String api = 'https://api.test/v1', String key = 'clave-de-esta-ejecucion'}) {
    for (final p in const ['claves', 'base', 'migraciones', 'servidor']) {
      emit({'evento': 'iniciando', 'paso': p});
    }
    emit({'evento': 'listo', 'api': api, 'clave': key, 'version': '0.10.0.7', 'datos': r'C:\Users\ana\AppData\Local\COROC\datos'});
  }

  @override
  Stream<String> get lines => _lines.stream;

  @override
  Future<void> get done => _done.future;

  @override
  void send(String line) {
    sent.add(line);
    if (line == 'detener') {
      emit({'evento': 'detenido', 'motivo': 'app'});
      exit();
    }
  }

  @override
  void kill() {
    killed = true;
    exit();
  }
}

/// Windows de prueba: anota lo que COROC le pide (ventana, bandeja, WhatsApp, portapapeles, Windows Hello).
class FakeDesktopPlatform implements DesktopPlatform {
  FakeDesktopPlatform({this.autoReady = true});

  /// El supervisor nuevo se pone listo solo.
  bool autoReady;
  String? folder = r'C:\Users\ana\AppData\Local\COROC\servidor';
  final servers = <FakeServer>[];
  final opened = <String>[];
  bool canOpen = true;
  final copied = <({String name, int size})>[];
  bool copyWorks = true;
  ClipboardContent? clipboard;
  bool hello = true;
  bool helloAnswer = true;
  final helloReasons = <String>[];
  bool whatsApp = false;
  bool autostart = false;
  int shown = 0;
  int hidden = 0;
  int quits = 0;
  int windowInits = 0;
  List<TrayEntry>? tray;
  String? tooltip;
  final signalsCtl = StreamController<WindowSignal>.broadcast();
  final downloadsCtl = StreamController<String>.broadcast();

  FakeServer get server => servers.last;

  void signal(WindowSignalKind kind, [String? key]) => signalsCtl.add(WindowSignal(kind, key));

  @override
  String? serverFolder() => folder;

  /// Si se fija, encender el supervisor falla con este error.
  Object? startError;

  @override
  Future<ServerProcess> startServer(String folder) async {
    if (startError != null) throw startError!;
    final s = FakeServer();
    servers.add(s);
    if (autoReady) scheduleMicrotask(s.ready);
    return s;
  }

  @override
  Future<void> initWindow() async => windowInits++;

  @override
  Future<void> showWindow() async => shown++;

  @override
  Future<void> hideWindow() async => hidden++;

  @override
  Future<void> quit() async => quits++;

  @override
  Future<void> setTray({required String tooltip, required List<TrayEntry> items}) async {
    this.tooltip = tooltip;
    tray = items;
  }

  @override
  Stream<WindowSignal> get signals => signalsCtl.stream;

  @override
  Future<bool> autostartEnabled() async => autostart;

  @override
  Future<void> setAutostart(bool on) async => autostart = on;

  @override
  Future<bool> whatsAppInstalled() async => whatsApp;

  @override
  Future<bool> openUrl(String url) async {
    opened.add(url);
    return canOpen;
  }

  @override
  Future<bool> copyPdfToClipboard(String fileName, List<int> bytes) async {
    copied.add((name: fileName, size: bytes.length));
    return copyWorks;
  }

  @override
  Future<ClipboardContent?> readClipboard() async => clipboard;

  @override
  String? downloadsFolder() => null;

  @override
  Stream<String> receiptDownloads() => downloadsCtl.stream;

  @override
  Future<bool> helloAvailable() async => hello;

  @override
  Future<bool> verifyUser(String reason) async {
    helloReasons.add(reason);
    return helloAnswer;
  }
}

/// Empresa de esta instalación según `GET /desktop/status` (DesktopStatus del contrato).
Json desktopStatus({bool configured = true, Json? restore}) => {
  'configured': configured,
  'company': configured ? {'slug': 'inversiones-prado', 'name': 'Inversiones Prado', 'country': 'CO', 'lang': 'es'} : null,
  'restore': restore,
};

/// COROC Escritorio completo contra el servidor de prueba: el supervisor de mentira se pone listo solo y la sesión
/// recordada se retoma (salvo `signedIn: false`).
Future<AppUnderTest> bootDesktop(
  WidgetTester tester, {
  FakeApi? api,
  FakeDesktopPlatform? platform,
  bool configured = true,
  bool signedIn = true,
  Size size = desktop,
  String locale = 'es',
  String role = 'owner',
  List<String>? permissions,
  MemorySessionStore? store,
  bool tourDone = true,
  bool minimized = false,
  bool personal = false,
}) async {
  final server = api ?? FakeApi();
  final fake = platform ?? FakeDesktopPlatform();
  var status = desktopStatus(configured: configured);
  server.overrides.putIfAbsent(
    'GET /desktop/status',
    () =>
        (_) => FakeApi.json(200, status),
  );
  // Al terminar el asistente o una restauración, la instalación ya tiene empresa.
  server.overrides.putIfAbsent(
    'POST /desktop/setup',
    () => (http.Request req) {
      status = desktopStatus();
      return FakeApi.json(201, server.session);
    },
  );
  final memory = (store ?? MemorySessionStore(refresh: signedIn ? 'rt1.sesion-de-prueba' : null, savedLocale: locale))..tour = tourDone;
  final app = await bootApp(
    tester,
    api: server,
    size: size,
    locale: locale,
    role: role,
    permissions: permissions,
    signedIn: signedIn,
    store: memory,
    overrides: [desktopModeProvider.overrideWithValue(true), desktopPlatformProvider.overrideWithValue(fake), launchMinimizedProvider.overrideWithValue(minimized)],
    personal: personal,
  );
  await settle(tester);
  return app;
}

/// Un mensaje listo por WhatsApp con la forma exacta que devuelve la API (tomado de los fixtures).
Json readyWhatsApp(FakeApi api, {required String id, String event = 'reminder', String? attachment, String body = 'Hola María José, le recordamos su cuota de hoy.'}) {
  final base = Map<String, dynamic>.from(((api.get('/messages')['items'] as List).first) as Json);
  return {
    ...base,
    'id': id,
    'event': event,
    'kind': event == 'receipt' ? 'transactional' : 'collection',
    'channel': 'whatsapp',
    'status': 'ready',
    'body': body,
    'subject': null,
    'attachmentDocumentId': attachment,
    'scheduledAt': null,
    'decision': {'reasons': <Object>[], 'ruleSet': 'CO_LEY_2300_2023', 'decision': 'send'},
  };
}

/// Respuesta de `POST /messages/{id}/send` en Escritorio: marcado enviado y con el chat de WhatsApp para Windows.
Json sentAssisted(Json message) => {
  ...message,
  'status': 'sent',
  'via': 'assisted',
  'sentAt': '2026-10-25T14:00:00.000Z',
  'assisted': {'whatsappUrl': 'https://wa.me/573157778899?text=Hola', 'mailtoUrl': null, 'whatsappAppUrl': 'whatsapp://send?phone=573157778899&text=Hola'},
};

/// Ruta en la que quedó la app (con su consulta).
String location(AppUnderTest app) => app.location;
