// Carpeta COROC de punta a punta (§16.2, §12.5): el controlador con la sesión real de la app, el servidor de prueba y
// una carpeta temporal del disco. Son pruebas de unidad (no de pantallas) porque la carpeta hace E/S real.
import 'dart:convert';
import 'dart:io';

import 'package:coroc/core/api/api_client.dart';
import 'package:coroc/core/auth/auth_controller.dart';
import 'package:coroc/core/folder/folder_controller.dart';
import 'package:coroc/core/offline/offline_store.dart';
import 'package:coroc/core/offline/offline_sync.dart';
import 'package:coroc/core/providers.dart';
import 'package:crypto/crypto.dart';
import 'package:flutter/services.dart';
import 'package:file_selector_platform_interface/file_selector_platform_interface.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;

import 'app_harness.dart' show FakeFileSelector;
import 'fake_api.dart';
import 'support.dart';

final pdf = utf8.encode('%PDF');

/// El manifiesto real de la API, con la huella del contenido que sirve el servidor de prueba.
Json manifestFor(FakeApi api) {
  final m = jsonDecode(jsonEncode(api.get('/folder/manifest'))) as Json;
  for (final f in (m['files'] as List).cast<Json>()) {
    f['sha256'] = sha256.convert(pdf).toString();
    f['size'] = pdf.length;
  }
  return m;
}

class Harness {
  Harness(this.api, this.store, this.container, this.root);
  final FakeApi api;
  final MemorySessionStore store;
  final ProviderContainer container;
  final Directory root;
  FolderController get folder => container.read(folderProvider.notifier);
  FolderState get state => container.read(folderProvider);
}

Future<void> until(bool Function() ok, {String what = 'condición'}) async {
  for (var i = 0; i < 200; i++) {
    if (ok()) return;
    await Future<void>.delayed(const Duration(milliseconds: 20));
  }
  fail('No se cumplió: $what');
}

/// Arranca la app sin pantalla: sesión restaurada y carpeta COROC en una carpeta temporal. `config` permite probar
/// una configuración guardada arbitraria (p. ej. una ruta que no se puede crear).
Future<Harness> start({bool configured = true, FakeApi? server, Json? config}) async {
  final api = server ?? FakeApi();
  api.overrides['GET /folder/manifest'] = (_) => FakeApi.json(200, manifestFor(api));
  final root = await Directory.systemTemp.createTemp('coroc-folder-');
  addTearDown(() => root.delete(recursive: true));
  final store = MemorySessionStore(refresh: 'rt1.sesion-de-prueba', savedLocale: 'es')..asked = true;
  if (config != null) {
    store.folder = jsonEncode(config);
  } else if (configured) {
    store.folder = jsonEncode({'type': 'path', 'path': p.join(root.path, 'COROC')});
  }
  final client = ApiClient(baseUrl: 'https://api.test/v1', store: store, language: () => 'es', client: api.client());
  final container = ProviderContainer(overrides: [sessionStoreProvider.overrideWithValue(store), apiClientProvider.overrideWithValue(client), offlineVaultProvider.overrideWithValue(MemoryVault())]);
  addTearDown(container.dispose);
  container.read(authProvider);
  container.listen(folderProvider, (_, _) {});
  final h = Harness(api, store, container, root);
  await until(() => container.read(authProvider) is SignedIn, what: 'sesión');
  await until(() => h.state.status != FolderStatus.loading, what: 'carpeta');
  return h;
}

void main() {
  test('sin carpeta configurada queda «no configurada» y sincronizar no hace nada', () async {
    final h = await start(configured: false);
    expect(h.state.status, FolderStatus.notConfigured);
    await h.folder.sync();
    expect(h.api.sent('GET', '/folder/manifest'), isEmpty);
  });

  test('la sincronización completa deja cada documento en la carpeta del cliente y del contrato', () async {
    final h = await start();
    expect(h.state.status, FolderStatus.ready);
    expect(h.state.displayPath, p.join(h.root.path, 'COROC'));
    await h.folder.sync(full: true);
    expect(h.state.error, isNull);
    expect(h.state.lastResult!.written, greaterThan(0));
    final files = (h.api.get('/folder/manifest')['files'] as List).cast<Json>();
    for (final f in files) {
      expect(File(p.join(h.root.path, 'COROC', f['path'] as String)).existsSync(), isTrue, reason: f['path'] as String);
    }
    expect(h.state.subfolders, contains('03 Recibos emitidos'));
    expect(h.state.rootFolders, contains('_Entrada'));
  });

  test('carpeta vigilada: un PDF dejado en el cliente va a la Bandeja; otro archivo se ofrece e importa como documento', () async {
    final h = await start();
    h.api.overrides['POST /clients/{id}/documents'] = (_) => FakeApi.json(201, h.api.get('/documents/${h.api.id('document')}'));
    await h.folder.sync(full: true);
    final contract = p.join(h.root.path, 'COROC', 'Maria Jose Perez Gomez - C000001', 'CT-000001');
    final receipt = File(p.join(contract, '02 Comprobantes recibidos', 'pago-nequi.pdf'))..writeAsBytesSync(pdf);
    // Ya terminó de copiarse (más de 10 s): se envía solo.
    receipt.setLastModifiedSync(DateTime.now().subtract(const Duration(minutes: 1)));
    final note = File(p.join(contract, '05 Otros documentos', 'cedula.txt'))..writeAsStringSync('copia de la cédula');

    await h.folder.sync();
    final sent = h.api.sent('POST', '/intake');
    expect(sent, hasLength(1));
    expect(sent.single.url.queryParameters, allOf(containsPair('channel', 'folder'), containsPair('clientId', h.api.id('client')), containsPair('loanId', h.api.id('loan'))));
    expect(receipt.existsSync(), isFalse);
    expect(h.state.sentToInbox, 1);
    expect(h.state.untracked.map((f) => f.name), ['cedula.txt']);

    await h.folder.import(h.state.untracked.single);
    final upload = h.api.sent('POST', '/clients/{id}/documents').single;
    expect(upload.url.queryParameters, allOf(containsPair('name', 'cedula'), containsPair('kind', 'other')));
    expect(note.existsSync(), isFalse);
  });

  test('sin vigilancia los comprobantes se ofrecen para importar a mano; la preferencia se recuerda', () async {
    final h = await start();
    await h.folder.sync(full: true);
    await h.folder.setWatching(false);
    expect((jsonDecode(h.store.folder!) as Json)['watch'], isFalse);
    final inbox = Directory(p.join(h.root.path, 'COROC', '_Entrada'))..createSync(recursive: true);
    File(p.join(inbox.path, 'transferencia.jpg'))
      ..writeAsBytesSync(pdf)
      ..setLastModifiedSync(DateTime.now().subtract(const Duration(minutes: 1)));
    await h.folder.sync();
    expect(h.api.sent('POST', '/intake'), isEmpty);
    final f = h.state.untracked.single;
    expect((f.clientId, f.receiptLike), (null, true));
    await h.folder.import(f);
    expect(h.api.sent('POST', '/intake').single.url.queryParameters, containsPair('channel', 'folder'));
    expect(h.state.sentToInbox, 1);
  });

  test('guarda copias en _Respaldos y se desconecta sin borrar lo copiado', () async {
    final h = await start();
    await h.folder.sync(full: true);
    final src = File(p.join(h.root.path, 'respaldo.coroc'))..writeAsStringSync('respaldo cifrado');
    final shown = await h.folder.saveToRoot(3, 'COROC_Respaldo.coroc', src);
    expect(shown, endsWith('_Respaldos/COROC_Respaldo.coroc'));
    expect(File(p.join(h.root.path, 'COROC', '_Respaldos', 'COROC_Respaldo.coroc')).readAsStringSync(), 'respaldo cifrado');

    await h.folder.disconnect();
    expect(h.state.status, FolderStatus.notConfigured);
    expect(h.store.folder, isNull);
    expect(Directory(p.join(h.root.path, 'COROC', '_Respaldos')).existsSync(), isTrue);
    expect(await h.folder.saveToRoot(3, 'otro.coroc', src), isNull);
  });

  test('un error del servidor queda en el estado y la siguiente sincronización lo limpia', () async {
    final h = await start();
    h.api.overrides['GET /folder/manifest'] = (_) => FakeApi.problem(503, 'UNAVAILABLE');
    await h.folder.sync();
    expect(h.state.error, isNotNull);
    expect(h.state.syncing, isFalse);
    h.api.overrides['GET /folder/manifest'] = (_) => FakeApi.json(200, manifestFor(h.api));
    await h.folder.sync(full: true);
    expect(h.state.error, isNull);
  });

  test('conectar en escritorio crea COROC dentro de la carpeta elegida; cancelar no cambia nada', () async {
    final h = await start(configured: false);
    final files = FakeFileSelector();
    FileSelectorPlatform.instance = files;
    PathProviderStub.install(h.root.path);
    expect(await h.folder.connect(message: 'Elija dónde crear la carpeta COROC', prompt: 'Elegir'), isFalse);
    expect(h.state.status, FolderStatus.notConfigured);

    files.directory = h.root.path;
    expect(await h.folder.connect(), isTrue);
    expect(h.state.status, FolderStatus.ready);
    expect(Directory(p.join(h.root.path, 'COROC')).existsSync(), isTrue);
    expect((jsonDecode(h.store.folder!) as Json)['path'], p.join(h.root.path, 'COROC'));
    expect(h.store.asked, isTrue);
    h.folder.start();
    await until(() => h.api.sent('GET', '/folder/manifest').isNotEmpty, what: 'primera sincronización');
    h.folder.stop();
  });

  test('una carpeta configurada que ya no se puede crear pide permiso de nuevo', () async {
    final blocker = File(p.join(Directory.systemTemp.path, 'coroc-no-es-carpeta-${DateTime.now().microsecondsSinceEpoch}'))..writeAsStringSync('x');
    addTearDown(() => blocker.deleteSync());
    final h = await start(config: {'type': 'path', 'path': p.join(blocker.path, 'COROC')});
    expect(h.state.status, FolderStatus.needsPermission);
    expect(h.state.error, isNotNull);
  });
}

/// Carpeta de documentos del sistema (path_provider) apuntando a la carpeta temporal de la prueba.
class PathProviderStub {
  static void install(String documents) {
    TestWidgetsFlutterBinding.ensureInitialized();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(const MethodChannel('plugins.flutter.io/path_provider'), (call) async => documents);
  }
}
