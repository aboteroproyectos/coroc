// Capturas de COROC Escritorio para docs/GUIA_ESCRITORIO.md. No es parte de la CI: se generan a mano con
//   flutter test tool/capturas_escritorio_test.dart --update-goldens
// con la app real (fuentes Inter y Montserrat, íconos de Material) contra el servidor de prueba y datos de ejemplo.
import 'dart:io';

import 'package:coroc/core/desktop/desktop_platform.dart';
import 'package:coroc/core/l10n.dart';
import 'package:file_selector_platform_interface/file_selector_platform_interface.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import '../test/app_harness.dart';
import '../test/desktop_fakes.dart';
import '../test/desktop_messages_test.dart' show serveReady;
import '../test/fake_api.dart';
import '../test/inbox_test.dart' show intakeVariant, serveIntake;

final l = lookupAppLocalizations(const Locale('es'));
const pc = Size(1280, 800);

Future<void> loadFonts() async {
  Future<void> load(String family, List<String> files) async {
    final loader = FontLoader(family);
    for (final f in files) {
      loader.addFont(Future.value(ByteData.sublistView(File(f).readAsBytesSync())));
    }
    await loader.load();
  }

  final sdk = Platform.environment['FLUTTER_ROOT'] ?? '/opt/sdk/flutter';
  await load('Inter', ['assets/fonts/Inter-Regular.ttf', 'assets/fonts/Inter-SemiBold.ttf']);
  await load('Montserrat', ['assets/fonts/Montserrat-Medium.ttf', 'assets/fonts/Montserrat-SemiBold.ttf']);
  await load('Roboto', ['$sdk/bin/cache/artifacts/material_fonts/Roboto-Regular.ttf', '$sdk/bin/cache/artifacts/material_fonts/Roboto-Medium.ttf']);
  await load('MaterialIcons', ['$sdk/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf']);
}

/// Servidor de prueba con una Propietaria de ejemplo (los fixtures traen el usuario técnico del escaneo).
FakeApi sample() {
  final api = FakeApi();
  (api.session['user'] as Json)['name'] = 'Ana María Prado';
  return api;
}

Future<void> shot(WidgetTester tester, String name) async {
  await settle(tester);
  await expectLater(find.byType(MaterialApp).first, matchesGoldenFile('../../../docs/escritorio/$name.png'));
}

void main() {
  setUpAll(loadFonts);

  testWidgets('pantalla de carga', (tester) async {
    final platform = FakeDesktopPlatform(autoReady: false);
    final app = await bootDesktop(tester, api: sample(), platform: platform, size: pc);
    platform.server.emit({'evento': 'iniciando', 'paso': 'base'});
    await shot(tester, '01-cargando');
    await app.finish();
  });

  testWidgets('asistente', (tester) async {
    final api = sample();
    api.overrides['PUT /company/gmail'] = (_) => FakeApi.json(200, {
      'connected': true,
      'address': 'cobros.prado@gmail.com',
      'status': 'active',
      'lastError': null,
      'lastCheckAt': '2026-10-25T14:00:00.000Z',
      'sentToday': 0,
      'dailyLimit': 400,
      'label': 'COROC/Procesado',
    });
    final platform = FakeDesktopPlatform()..whatsApp = true;
    final app = await bootDesktop(tester, api: api, platform: platform, configured: false, signedIn: false, size: pc);
    await tester.enterText(find.widgetWithText(TextField, l.welcomeCompanyName), 'Inversiones Prado');
    await shot(tester, '02-asistente-empresa');
    await tapOn(tester, find.text(l.actionContinue));
    await tester.enterText(find.widgetWithText(TextField, l.welcomeOwnerName), 'Ana María Prado');
    await tester.enterText(find.widgetWithText(TextField, l.loginPassword), 'Mi-Clave-Segura-2026');
    await tester.enterText(find.widgetWithText(TextField, l.welcomePasswordAgain), 'Mi-Clave-Segura-2026');
    await shot(tester, '03-asistente-propietario');
    await tapOn(tester, find.text(l.welcomeCreate));
    await shot(tester, '04-asistente-tasas');
    await tapOn(tester, find.text(l.actionContinue));
    await shot(tester, '05-asistente-gmail');
    await tester.enterText(find.widgetWithText(TextField, l.gmailAddress), 'cobros.prado@gmail.com');
    await tester.enterText(find.widgetWithText(TextField, l.gmailAppPassword), 'abcd efgh ijkl mnop');
    await tapOn(tester, find.text(l.gmailTest));
    await tapOn(tester, find.text(l.actionContinue));
    await shot(tester, '06-asistente-whatsapp');
    await app.finish();
  });

  testWidgets('restaurar en otro PC', (tester) async {
    final api = sample();
    api.overrides['POST /desktop/restore'] = (_) =>
        FakeApi.json(201, {'id': 'd3500000-0000-4000-8000-000000000001', 'status': 'uploaded', 'company': 'Inversiones Prado', 'backupCreatedAt': '2026-10-24T22:00:00.000Z'});
    final app = await bootDesktop(tester, api: api, configured: false, signedIn: false, size: pc);
    await tapOn(tester, find.text(l.welcomeRestoreLink));
    app.files.file = XFile.fromData(Uint8List.fromList(List.filled(256, 7)), name: 'COROC_Respaldo_inversiones-prado_2026-10-24_2200.coroc');
    await tapOn(tester, find.text(l.welcomeRestorePick));
    await shot(tester, '07-restaurar');
    await app.finish();
  });

  testWidgets('mensajes de hoy', (tester) async {
    final api = sample();
    serveReady(api);
    final platform = FakeDesktopPlatform();
    final app = await bootDesktop(tester, api: api, platform: platform, size: pc);
    await app.go('/messages/today');
    await shot(tester, '08-mensajes-de-hoy');
    await tapOn(tester, find.text(l.todayMessagesSendWhatsapp));
    platform.signal(WindowSignalKind.focused);
    await settle(tester);
    await tapOn(tester, find.text(l.todayMessagesSendWhatsapp));
    await shot(tester, '09-mensajes-pegar-recibo');
    await app.finish();
  });

  testWidgets('soltar el comprobante y enviar el recibo', (tester) async {
    final api = sample();
    final item = intakeVariant(api);
    serveIntake(api, [item]);
    final app = await bootDesktop(tester, api: api, size: pc);
    await tester.binding.defaultBinaryMessenger.handlePlatformMessage('desktop_drop', const StandardMethodCodec().encodeMethodCall(const MethodCall('entered', [700.0, 400.0])), (_) {});
    await shot(tester, '10-suelte-el-comprobante');
    await tester.binding.defaultBinaryMessenger.handlePlatformMessage('desktop_drop', const StandardMethodCodec().encodeMethodCall(const MethodCall('exited')), (_) {});
    await app.go('/inbox?id=${item['id']}');
    await tapOn(tester, find.text(l.intakeApprove));
    await shot(tester, '11-enviar-el-recibo');
    await app.finish();
  });

  testWidgets('bandeja y copia diaria', (tester) async {
    final api = sample();
    api.overrides['GET /company/auto-backup'] = (_) => FakeApi.json(200, {
      'configured': true,
      'enabled': true,
      'folder': r'C:\Users\ana\OneDrive\COROC',
      'keep': 7,
      'lastRunAt': '2026-10-25T03:00:00.000Z',
      'lastSuccessAt': '2026-10-25T03:00:00.000Z',
      'lastFile': 'COROC_Respaldo_inversiones-prado_2026-10-25_0300.coroc',
      'lastSize': 1048576,
      'lastError': null,
      'lastBackupAt': '2026-10-25T03:00:00.000Z',
      'overdue': false,
      'running': false,
    });
    final platform = FakeDesktopPlatform();
    final app = await bootDesktop(tester, api: api, platform: platform, size: pc);
    platform.signal(WindowSignalKind.closeRequested);
    await shot(tester, '12-sigue-trabajando');
    await tapOn(tester, find.text(l.trayHintOk));
    await app.go('/settings');
    await tester.scrollUntilVisible(find.text(l.autoBackupTitle), 300, scrollable: find.byType(Scrollable).last);
    await tester.drag(find.byType(Scrollable).last, const Offset(0, -200));
    await shot(tester, '13-copia-diaria');
    await app.finish();
  });
}
