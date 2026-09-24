import 'dart:convert';

import 'package:coroc/app.dart';
import 'package:coroc/core/api/api_client.dart';
import 'package:coroc/core/offline/offline_store.dart';
import 'package:coroc/core/offline/offline_sync.dart';
import 'package:coroc/core/providers.dart';
import 'package:file_selector_platform_interface/file_selector_platform_interface.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:plugin_platform_interface/plugin_platform_interface.dart';

import 'fake_api.dart';
import 'support.dart';

/// Tamaños de pantalla de las pruebas: escritorio (barra lateral), tableta (riel) y teléfono (barra inferior).
const desktop = Size(1440, 1000);
const tablet = Size(900, 1100);
const phone = Size(400, 860);

/// Selector de archivos del sistema sustituido: devuelve lo que la prueba deja preparado.
class FakeFileSelector extends FileSelectorPlatform with MockPlatformInterfaceMixin {
  XFile? file;
  String? directory;
  FileSaveLocation? saveTo;
  int opened = 0;

  @override
  Future<XFile?> openFile({List<XTypeGroup>? acceptedTypeGroups, String? initialDirectory, String? confirmButtonText}) async {
    opened++;
    return file;
  }

  @override
  Future<String?> getDirectoryPathWithOptions(FileDialogOptions options) async => directory;

  @override
  Future<FileSaveLocation?> getSaveLocation({List<XTypeGroup>? acceptedTypeGroups, SaveDialogOptions options = const SaveDialogOptions()}) async => saveTo;
}

class AppUnderTest {
  AppUnderTest(this.tester, this.api, this.container, this.store, this.files);
  final WidgetTester tester;
  final FakeApi api;
  final ProviderContainer container;
  final MemorySessionStore store;
  final FakeFileSelector files;

  /// Desmonta la app y libera los proveedores (temporizadores de la carpeta y del bloqueo por inactividad).
  Future<void> finish() async {
    await tester.pumpWidget(const SizedBox());
    container.dispose();
    await tester.pump(const Duration(seconds: 1));
  }

  /// Navega como lo haría un enlace de la app y espera a que la pantalla cargue.
  Future<void> go(String location) async {
    container.read(routerProvider).go(location);
    await settle(tester);
  }
}

/// Deja correr animaciones y peticiones sin esperar las animaciones infinitas (indicadores de progreso).
Future<void> settle(WidgetTester tester, {int frames = 12}) async {
  for (var i = 0; i < frames; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

/// La app completa (router, shell, capa de seguridad) contra el servidor de prueba, con una sesión que se restaura
/// sola por `POST /auth/refresh`, igual que al abrir la app con la sesión recordada.
Future<AppUnderTest> bootApp(
  WidgetTester tester, {
  FakeApi? api,
  Size size = desktop,
  String locale = 'es',
  String role = 'owner',
  List<String>? permissions,
  bool signedIn = true,
  bool folderAsked = true,
}) async {
  await initializeDateFormatting('es');
  await initializeDateFormatting('pt_BR');
  await initializeDateFormatting('en_US');
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final server = api ?? FakeApi();
  if (role != 'owner' || permissions != null) {
    final s = jsonDecode(jsonEncode(server.session)) as Json;
    (s['user'] as Json)['role'] = role;
    if (permissions != null) (s['user'] as Json)['permissions'] = permissions;
    server.fixtures['session'] = s;
  }
  ((server.session['user'] as Json))['lang'] = locale == 'pt' ? 'pt-BR' : locale;
  // La carpeta COROC ya se ofreció en este dispositivo: el diálogo de permiso tiene su propia prueba.
  final store = MemorySessionStore(refresh: signedIn ? 'rt1.sesion-de-prueba' : null, savedLocale: locale)..asked = folderAsked;
  final client = ApiClient(baseUrl: 'https://api.test/v1', store: store, language: () => locale, client: server.client());
  final container = ProviderContainer(overrides: [sessionStoreProvider.overrideWithValue(store), apiClientProvider.overrideWithValue(client), offlineVaultProvider.overrideWithValue(MemoryVault())]);
  final files = FakeFileSelector();
  FileSelectorPlatform.instance = files;
  await tester.pumpWidget(UncontrolledProviderScope(container: container, child: const CorocApp()));
  await settle(tester);
  return AppUnderTest(tester, server, container, store, files);
}

/// Desplaza hasta el control (si está en una lista), lo deja en el centro para que no quede bajo un encabezado fijo y
/// lo pulsa.
Future<void> tapOn(WidgetTester tester, Finder finder, {int frames = 12}) async {
  await Scrollable.ensureVisible(tester.element(finder), alignment: 0.5);
  await tester.pump();
  await tester.tap(finder);
  await settle(tester, frames: frames);
}
