// Fase 10 · COROC Escritorio (ADR-062): la app enciende el servidor de este PC, apunta la API a él con la clave de la
// ejecución, retoma la sesión (con Windows Hello si se eligió), lo vuelve a encender si se cae y lo apaga en orden.
import 'package:coroc/core/api/api_client.dart';
import 'package:coroc/core/auth/auth_controller.dart';
import 'package:coroc/core/desktop/desktop_platform.dart';
import 'package:coroc/core/desktop/desktop_runtime.dart';
import 'package:coroc/core/offline/offline_store.dart';
import 'package:coroc/core/offline/offline_sync.dart';
import 'package:coroc/core/providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'app_harness.dart';
import 'desktop_fakes.dart';
import 'fake_api.dart';
import 'support.dart';

class _Setup {
  _Setup({bool configured = true, bool autoReady = true, bool hello = false}) {
    api.overrides['GET /desktop/status'] = (_) => FakeApi.json(200, desktopStatus(configured: configured));
    platform.autoReady = autoReady;
    store.hello = hello;
    final client = ApiClient(baseUrl: 'http://pendiente', store: store, language: () => 'es', client: api.client());
    container = ProviderContainer(
      overrides: [
        desktopModeProvider.overrideWithValue(true),
        desktopPlatformProvider.overrideWithValue(platform),
        sessionStoreProvider.overrideWithValue(store),
        apiClientProvider.overrideWithValue(client),
        offlineVaultProvider.overrideWithValue(MemoryVault()),
      ],
    );
    container.listen<DesktopState>(desktopProvider, (_, s) => states.add(s), fireImmediately: true);
    container.read(authProvider);
  }

  final api = FakeApi();
  final platform = FakeDesktopPlatform();
  final store = MemorySessionStore(refresh: 'rt1.sesion-de-prueba');
  late final ProviderContainer container;
  final states = <DesktopState>[];

  DesktopState get state => container.read(desktopProvider);
  AuthState get auth => container.read(authProvider);
}

void main() {
  testWidgets('enciende el servidor del PC paso a paso, usa la clave de la ejecución y retoma la sesión', (tester) async {
    final s = _Setup();
    await settle(tester);
    expect(s.states.first.phase, DesktopPhase.starting);
    expect(s.states.map((x) => x.step), containsAllInOrder(['claves', 'base', 'migraciones', 'servidor']));
    expect(s.state.ready, isTrue);
    expect(s.state.configured, isTrue);
    expect(s.state.version, '0.10.0.7');
    final status = s.api.sent('GET', '/desktop/status').single;
    expect(status.url.toString(), 'https://api.test/v1/desktop/status');
    expect(status.headers['X-Coroc-Desktop'], 'clave-de-esta-ejecucion');
    // La sesión recordada se retoma sin bloqueo (Windows Hello no elegido).
    expect(s.auth, isA<SignedIn>());
    expect((s.auth as SignedIn).locked, isFalse);
    expect(s.api.sent('POST', '/auth/refresh').single.headers['X-Coroc-Desktop'], 'clave-de-esta-ejecucion');
    s.container.dispose();
  });

  testWidgets('con Windows Hello elegido, la sesión se abre bloqueada hasta confirmar', (tester) async {
    final s = _Setup(hello: true);
    await settle(tester);
    expect((s.auth as SignedIn).locked, isTrue);
    s.container.dispose();
  });

  testWidgets('sin empresa todavía: queda listo para el asistente y sin sesión', (tester) async {
    final s = _Setup(configured: false);
    await settle(tester);
    expect(s.state.ready, isTrue);
    expect(s.state.configured, isFalse);
    expect(s.auth, isA<SignedOut>());
    expect(s.api.sent('POST', '/auth/refresh'), isEmpty);
    // Al terminar el asistente se vuelve a leer el estado.
    s.api.overrides['GET /desktop/status'] = (_) => FakeApi.json(200, desktopStatus());
    await s.container.read(desktopProvider.notifier).refreshStatus();
    expect(s.state.configured, isTrue);
    s.container.dispose();
  });

  testWidgets('un error del supervisor se explica; «Reintentar» enciende otro', (tester) async {
    final s = _Setup(autoReady: false);
    await settle(tester);
    s.platform.server
      ..raw('no es JSON')
      ..raw('[1, 2]')
      ..emit({'evento': 'iniciando', 'paso': 'base'});
    await settle(tester);
    expect(s.state.step, 'base');
    s.platform.server.emit({'evento': 'error', 'codigo': 'BASE_NO_INICIA', 'detalle': 'pg_ctl start terminó con 1'});
    await settle(tester);
    expect(s.state.phase, DesktopPhase.failed);
    expect(s.state.code, 'BASE_NO_INICIA');
    expect(s.state.detail, contains('pg_ctl'));
    s.platform.server.exit();
    await settle(tester);
    // Con el error a la vista no se reintenta solo: lo decide la persona.
    expect(s.platform.servers, hasLength(1));
    s.platform.autoReady = true;
    await s.container.read(desktopProvider.notifier).retry();
    await settle(tester);
    expect(s.platform.servers, hasLength(2));
    expect(s.state.ready, isTrue);
    s.container.dispose();
  });

  testWidgets('sin la carpeta del servidor o si no se puede encender, dice qué pasó', (tester) async {
    final s = _Setup();
    s.platform.folder = null;
    await settle(tester);
    expect(s.state.code, 'SIN_SERVIDOR');
    s.platform
      ..folder = r'C:\COROC\servidor'
      ..startError = StateError('node.exe no responde');
    await s.container.read(desktopProvider.notifier).retry();
    await settle(tester);
    expect(s.state.code, 'NO_INICIA');
    expect(s.state.detail, contains('node.exe'));
    s.container.dispose();
  });

  testWidgets('si el supervisor se cierra solo, se vuelve a encender sin sacar a la persona de su pantalla', (tester) async {
    final s = _Setup();
    await settle(tester);
    expect(s.state.ready, isTrue);
    s.platform.server.emit({'evento': 'reiniciando', 'motivo': 'servidor'});
    await settle(tester);
    expect(s.state.restarting, isTrue);
    s.platform.server.exit();
    await tester.pump();
    expect(s.state.ready, isTrue);
    expect(s.state.restarting, isTrue);
    await tester.pump(const Duration(seconds: 1));
    await settle(tester);
    expect(s.platform.servers, hasLength(2));
    expect(s.state.ready, isTrue);
    expect(s.state.restarting, isFalse);
    // El nuevo supervisor trae otra clave: la API la usa desde ya, con la misma sesión.
    s.platform.server.emit({'evento': 'iniciando', 'paso': 'claves'});
    s.platform.server.emit({'evento': 'listo', 'api': 'https://api.test/v1', 'clave': 'otra-clave', 'version': '0.10.0.7', 'datos': 'C:'});
    await settle(tester);
    expect(s.api.requests.last.headers['X-Coroc-Desktop'], 'otra-clave');
    expect(s.api.sent('POST', '/auth/refresh'), hasLength(1));
    s.container.dispose();
  });

  testWidgets('si sigue cayendo, deja de insistir y explica el problema', (tester) async {
    final s = _Setup(autoReady: false);
    await settle(tester);
    for (final wait in DesktopRuntime.backoff) {
      s.platform.server.exit();
      await tester.pump();
      await tester.pump(wait);
      await settle(tester, frames: 2);
    }
    expect(s.platform.servers, hasLength(DesktopRuntime.backoff.length + 1));
    s.platform.server.exit();
    await settle(tester);
    expect(s.state.phase, DesktopPhase.failed);
    expect(s.state.code, 'SE_DETUVO');
    s.container.dispose();
  });

  testWidgets('si el servidor no contesta el estado de la instalación, lo dice', (tester) async {
    final s = _Setup();
    s.api.overrides['GET /desktop/status'] = (_) => FakeApi.problem(500, 'INTERNAL');
    await settle(tester);
    await tester.pump(const Duration(seconds: 12));
    await settle(tester);
    expect(s.state.code, 'SIN_RESPUESTA');
    expect(s.api.sent('GET', '/desktop/status'), hasLength(5));
    s.container.dispose();
  });

  testWidgets('«Salir» apaga en orden; el instalador también puede pedirlo', (tester) async {
    final s = _Setup();
    await settle(tester);
    final first = s.platform.server;
    await s.container.read(desktopProvider.notifier).stop();
    expect(first.sent, ['detener']);
    await settle(tester);
    expect(s.platform.servers, hasLength(1));

    final t = _Setup();
    var closed = 0;
    await settle(tester);
    t.container.read(desktopProvider.notifier).onInstallerStop = () => closed++;
    t.platform.server.emit({'evento': 'detenido', 'motivo': 'instalador'});
    t.platform.server.exit();
    await settle(tester);
    expect(closed, 1);
    expect(t.platform.servers, hasLength(1));
    s.container.dispose();
    t.container.dispose();
  });

  testWidgets('fuera de Escritorio no hace nada', (tester) async {
    final c = ProviderContainer();
    expect(c.read(desktopProvider), same(DesktopState.off));
    c.dispose();
  });

  test('fuera de Windows, la plataforma de Escritorio no hace nada ni falla', () async {
    const p = UnsupportedDesktopPlatform();
    expect(p.serverFolder(), isNull);
    await expectLater(p.startServer('x'), throwsUnsupportedError);
    await p.initWindow();
    await p.showWindow();
    await p.hideWindow();
    await p.quit();
    await p.setTray(tooltip: 'COROC', items: const [TrayEntry('abrir', 'Abrir')]);
    expect(await p.signals.isEmpty, isTrue);
    expect(await p.autostartEnabled(), isFalse);
    await p.setAutostart(true);
    expect(await p.whatsAppInstalled(), isFalse);
    expect(await p.openUrl('whatsapp://send'), isFalse);
    expect(await p.copyPdfToClipboard('recibo.pdf', const [1]), isFalse);
    expect(await p.readClipboard(), isNull);
    expect(p.downloadsFolder(), isNull);
    expect(await p.receiptDownloads().isEmpty, isTrue);
    expect(await p.helloAvailable(), isFalse);
    expect(await p.verifyUser('motivo'), isFalse);
    expect(const ClipboardContent().isEmpty, isTrue);
  });
}
