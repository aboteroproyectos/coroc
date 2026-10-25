// Fase 10 · Configuración de COROC Escritorio: este PC (iniciar con Windows, Windows Hello), Gmail de la empresa
// (ADR-065), copia diaria automática con aviso a los 7 días (ADR-066, E-7) y tamaño de la letra.
import 'package:coroc/core/l10n.dart';
import 'package:coroc/features/settings/desktop_sections.dart' show autoBackupProvider;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'app_harness.dart';
import 'desktop_fakes.dart';
import 'fake_api.dart';
import 'support.dart';

final l = lookupAppLocalizations(const Locale('es'));

Json gmail({bool connected = true, bool failing = false, String? error}) => {
  'connected': connected,
  'address': connected ? 'cobros.prado@gmail.com' : null,
  'status': connected ? (failing ? 'error' : 'active') : null,
  'lastError': failing ? (error ?? 'GMAIL_AUTH_FAILED') : null,
  'lastCheckAt': connected ? '2026-10-25T14:00:00.000Z' : null,
  'sentToday': 12,
  'dailyLimit': 400,
  'label': 'COROC/Procesado',
};

Json autoBackup({bool configured = true, bool overdue = false, String? error, bool running = false}) => {
  'configured': configured,
  'enabled': configured,
  'folder': configured ? r'C:\Users\ana\OneDrive\COROC' : null,
  'keep': 7,
  'lastRunAt': configured ? '2026-10-25T03:00:00.000Z' : null,
  'lastSuccessAt': configured && !overdue ? '2026-10-25T03:00:00.000Z' : null,
  'lastFile': configured && !overdue ? 'COROC_Respaldo_inversiones-prado_2026-10-25_0300.coroc' : null,
  'lastSize': configured ? 1048576 : null,
  'lastError': error,
  'lastBackupAt': overdue ? '2026-10-10T03:00:00.000Z' : '2026-10-25T03:00:00.000Z',
  'overdue': overdue,
  'running': running,
};

Future<void> scrollTo(WidgetTester tester, Finder f) => tester.scrollUntilVisible(f, 300, scrollable: find.byType(Scrollable).last);

void main() {
  testWidgets('Este PC: iniciar con Windows y Windows Hello; lo que no aplica en Escritorio no aparece', (tester) async {
    final api = FakeApi();
    api.overrides['GET /company/gmail'] = (_) => FakeApi.json(200, gmail());
    api.overrides['GET /company/auto-backup'] = (_) => FakeApi.json(200, autoBackup());
    final platform = FakeDesktopPlatform();
    final app = await bootDesktop(tester, api: api, platform: platform);
    await app.go('/settings');
    expect(find.text(l.desktopPcTitle), findsOneWidget);
    expect(find.text(l.whatsappTitle), findsNothing);
    expect(find.text(l.emailSenderTitle), findsNothing);
    await tapOn(tester, find.text(l.desktopAutostart));
    expect(platform.autostart, isTrue);
    await tapOn(tester, find.text(l.desktopAutostart));
    expect(platform.autostart, isFalse);
    // Activar Windows Hello pide confirmarlo; si no se confirma, queda apagado.
    platform.helloAnswer = false;
    await tapOn(tester, find.text(l.welcomeHello));
    expect(app.store.hello, isFalse);
    platform.helloAnswer = true;
    await tapOn(tester, find.text(l.welcomeHello));
    expect(app.store.hello, isTrue);
    expect(platform.helloReasons, [l.helloReason, l.helloReason]);
    await tapOn(tester, find.text(l.welcomeHello));
    expect(app.store.hello, isFalse);
    await app.finish();
  });

  testWidgets('tamaño de la letra: normal, grande y más grande, al instante', (tester) async {
    final app = await bootDesktop(tester);
    await app.go('/settings');
    await tapOn(tester, find.text(l.textSizeLarge));
    expect(app.store.scale, 1.15);
    expect(MediaQuery.of(tester.element(find.text(l.settingsTextSize))).textScaler, const TextScaler.linear(1.15));
    await tapOn(tester, find.text(l.textSizeLarger));
    expect(app.store.scale, 1.3);
    await tapOn(tester, find.text(l.textSizeNormal));
    expect(MediaQuery.of(tester.element(find.text(l.settingsTextSize))).textScaler, TextScaler.noScaling);
    await app.finish();
  });

  testWidgets('el tamaño de la letra guardado se aplica al abrir', (tester) async {
    final store = MemorySessionStore(refresh: 'rt1.sesion-de-prueba', savedLocale: 'es')..scale = 1.3;
    final app = await bootDesktop(tester, store: store);
    expect(MediaQuery.of(tester.element(find.byType(Scaffold).first)).textScaler, const TextScaler.linear(1.3));
    await app.finish();
  });

  testWidgets('Gmail: conectar con la guía desde Configuración, probar y desconectar', (tester) async {
    final api = FakeApi();
    var account = gmail(connected: false);
    api.overrides['GET /company/gmail'] = (_) => FakeApi.json(200, account);
    api.overrides['PUT /company/gmail'] = (_) {
      account = gmail();
      return FakeApi.json(200, account);
    };
    api.overrides['POST /company/gmail/test'] = (_) => FakeApi.json(200, account);
    api.overrides['DELETE /company/gmail'] = (_) {
      account = gmail(connected: false);
      return FakeApi.empty();
    };
    final app = await bootDesktop(tester, api: api);
    await app.go('/settings');
    await scrollTo(tester, find.text(l.gmailNotConnected));
    await tapOn(tester, find.text(l.gmailConnect));
    expect(find.text(l.gmailGuideStep1), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, l.gmailAddress), 'cobros.prado@gmail.com');
    await tester.enterText(find.widgetWithText(TextField, l.gmailAppPassword), 'abcdefghijklmnop');
    await tapOn(tester, find.text(l.gmailTest));
    expect(find.byType(AlertDialog), findsNothing);
    expect(find.text('cobros.prado@gmail.com'), findsOneWidget);
    expect(find.text(l.gmailStatusActive), findsOneWidget);
    expect(find.text(l.gmailUsage(12, 400, 'COROC/Procesado')), findsOneWidget);

    await tapOn(tester, find.text(l.gmailTest));
    expect(find.text(l.gmailTestOk), findsOneWidget);
    account = gmail(failing: true, error: 'GMAIL_UNREACHABLE');
    await tapOn(tester, find.text(l.gmailTest));
    expect(find.text(l.gmailProblemNetwork), findsWidgets);

    await tapOn(tester, find.text(l.gmailDisconnect));
    await tapOn(tester, find.text(l.actionCancel));
    expect(api.sent('DELETE', '/company/gmail'), isEmpty);
    await tapOn(tester, find.text(l.gmailDisconnect));
    await tapOn(tester, find.widgetWithText(FilledButton, l.gmailDisconnect));
    expect(api.sent('DELETE', '/company/gmail'), hasLength(1));
    expect(find.text(l.gmailNotConnected), findsOneWidget);
    await app.finish();
  });

  testWidgets('Gmail con problema: qué pasó y cómo arreglarlo', (tester) async {
    final api = FakeApi();
    api.overrides['GET /company/gmail'] = (_) => FakeApi.json(200, gmail(failing: true));
    api.overrides['POST /company/gmail/test'] = (_) => FakeApi.problem(502, 'GMAIL_AUTH_FAILED', 'Google no aceptó la contraseña de aplicación.');
    final app = await bootDesktop(tester, api: api);
    await app.go('/settings');
    await scrollTo(tester, find.text(l.gmailProblemAuth));
    expect(find.text(l.gmailStatusProblem), findsOneWidget);
    await tapOn(tester, find.text(l.gmailTest));
    expect(find.text('Google no aceptó la contraseña de aplicación.'), findsOneWidget);
    await tapOn(tester, find.text(l.gmailReconnect));
    expect(find.text(l.gmailGuideStep3), findsOneWidget);
    await tapOn(tester, find.text(l.actionClose));
    await app.finish();
  });

  testWidgets('E-7 · copia diaria: carpeta, contraseña y cuántas guardar; «Hacer una copia ahora»', (tester) async {
    final api = FakeApi();
    var state = autoBackup(configured: false);
    api.overrides['GET /company/auto-backup'] = (_) => FakeApi.json(200, state);
    api.overrides['PUT /company/auto-backup'] = (_) {
      state = autoBackup();
      return FakeApi.json(200, state);
    };
    api.overrides['POST /company/auto-backup/run'] = (_) {
      state = autoBackup(running: true);
      return FakeApi.json(202, state);
    };
    final app = await bootDesktop(tester, api: api);
    await app.go('/settings');
    await scrollTo(tester, find.text(l.autoBackupTitle));
    await tapOn(tester, find.text(l.actionSave).last);
    expect(find.text(l.autoBackupFolderRequired), findsOneWidget);
    app.files.directory = r'C:\Users\ana\OneDrive\COROC';
    await tapOn(tester, find.text(l.autoBackupChoose));
    expect(find.text(r'C:\Users\ana\OneDrive\COROC'), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, l.autoBackupPassword), 'corta');
    await tapOn(tester, find.text(l.actionSave).last);
    expect(find.text(l.autoBackupPasswordShort), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, l.autoBackupPassword), 'Copias-Seguras-2026');
    await tester.enterText(find.widgetWithText(TextField, l.welcomePasswordAgain), 'Copias-Seguras-2025');
    await tapOn(tester, find.text(l.actionSave).last);
    expect(find.text(l.welcomePasswordMismatch), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, l.welcomePasswordAgain), 'Copias-Seguras-2026');
    await tapOn(tester, find.text(l.actionSave).last);
    expect(api.lastBody('PUT', '/company/auto-backup'), {'folder': r'C:\Users\ana\OneDrive\COROC', 'password': 'Copias-Seguras-2026', 'keep': 7, 'enabled': true});
    expect(find.text('COROC_Respaldo_inversiones-prado_2026-10-25_0300.coroc'), findsOneWidget);

    await tapOn(tester, find.text(l.autoBackupRun));
    expect(api.sent('POST', '/company/auto-backup/run'), hasLength(1));
    expect(find.text(l.autoBackupStarted), findsOneWidget);
    expect(find.text(l.autoBackupRunning), findsOneWidget);

    // Cambiar la carpeta sin cambiar la contraseña.
    await tapOn(tester, find.text(l.autoBackupChange));
    expect(find.text(l.autoBackupPasswordKeep), findsOneWidget);
    await tapOn(tester, find.text(l.actionCancel).last);
    expect(find.text(l.autoBackupChange), findsOneWidget);
    await tapOn(tester, find.text(l.autoBackupChange));
    await tapOn(tester, find.text(l.actionSave).last);
    expect(api.lastBody('PUT', '/company/auto-backup'), {'folder': r'C:\Users\ana\OneDrive\COROC', 'keep': 7, 'enabled': true});
    await app.finish();
  });

  testWidgets('copia diaria con problema: la memoria USB no está y el aviso de 7 días arriba', (tester) async {
    final api = FakeApi();
    api.overrides['GET /company/auto-backup'] = (_) => FakeApi.json(200, autoBackup(overdue: true, error: 'AUTO_BACKUP_FOLDER_UNAVAILABLE'));
    api.overrides['POST /company/auto-backup/run'] = (_) => FakeApi.problem(409, 'AUTO_BACKUP_FOLDER_UNAVAILABLE', 'No se encontró la carpeta de las copias.');
    final app = await bootDesktop(tester, api: api);
    // El aviso de 7 días sin copia, arriba en todas las pantallas.
    expect(find.text(l.backupOverdue), findsOneWidget);
    await tapOn(tester, find.text(l.autoBackupRun));
    expect(find.text('No se encontró la carpeta de las copias.'), findsOneWidget);
    await app.go('/settings');
    await scrollTo(tester, find.text(l.autoBackupProblemFolder));
    expect(find.text(l.autoBackupNever), findsOneWidget);
    await app.finish();
  });

  testWidgets('aviso de 7 días sin copia configurada: lleva a Configuración; con copia, la hace', (tester) async {
    final api = FakeApi();
    var state = autoBackup(configured: false, overdue: true);
    api.overrides['GET /company/auto-backup'] = (_) => FakeApi.json(200, state);
    api.overrides['POST /company/auto-backup/run'] = (_) => FakeApi.json(202, autoBackup(running: true));
    final app = await bootDesktop(tester, api: api);
    await tapOn(tester, find.text(l.autoBackupConfigure));
    expect(location(app), '/settings');

    // Ya configurada pero con una copia fallida: el aviso se actualiza solo y ofrece hacerla ahora.
    state = autoBackup(overdue: true, error: 'BACKUP_FAILED');
    await app.go('/dashboard');
    app.container.invalidate(autoBackupProvider);
    await settle(tester);
    await tapOn(tester, find.text(l.autoBackupRun));
    expect(api.sent('POST', '/company/auto-backup/run'), hasLength(1));
    expect(find.text(l.autoBackupStarted), findsOneWidget);
    await app.go('/settings');
    await scrollTo(tester, find.text(l.autoBackupProblemOther));
    await app.finish();
  });
}
