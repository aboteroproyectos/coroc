// Fase 10 · COROC Escritorio: pantalla de carga, asistente de primer uso en 5 pantallas (E-1), restaurar en otro PC
// (E-7), ingreso sin el campo de empresa, nueva contraseña con Windows Hello (ADR-063), ventana y bandeja.
import 'package:coroc/core/auth/auth_controller.dart';
import 'package:coroc/core/desktop/desktop_platform.dart';
import 'package:coroc/core/l10n.dart';
import 'package:coroc/features/auth/lock_page.dart';
import 'package:coroc/features/desktop/gmail_connect.dart' show gmailAppPasswordsUrl;
import 'package:coroc/features/desktop/welcome_page.dart';
import 'package:coroc/features/settings/settings_page.dart' show RateCapPolicySwitch;
import 'package:file_selector_platform_interface/file_selector_platform_interface.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'app_harness.dart';
import 'desktop_fakes.dart';
import 'fake_api.dart';
import 'support.dart';

final l = lookupAppLocalizations(const Locale('es'));

Json gmailConnected({bool failing = false}) => {
  'connected': true,
  'address': 'cobros.prado@gmail.com',
  'status': failing ? 'error' : 'active',
  'lastError': failing ? 'GMAIL_AUTH_FAILED' : null,
  'lastCheckAt': '2026-10-25T14:00:00.000Z',
  'sentToday': 12,
  'dailyLimit': 400,
  'label': 'COROC/Procesado',
};

void main() {
  test('usuario sugerido a partir del nombre', () {
    expect(suggestUsername('Ana María Pérez'), 'ana.perez');
    expect(suggestUsername('  Joaquín  '), 'joaquin');
    expect(suggestUsername('João da Conceição Ñuñez'), 'joao.nunez');
    expect(suggestUsername('!!'), '');
    expect(suggestUsername('${'a' * 20} ${'b' * 20}').length, 32);
  });

  testWidgets('pantalla de carga: cada paso en palabras sencillas; si falla, qué hacer y «Reintentar»', (tester) async {
    final platform = FakeDesktopPlatform(autoReady: false);
    String? copied;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
      if (call.method == 'Clipboard.setData') copied = (call.arguments as Map)['text'] as String?;
      return null;
    });
    addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));
    final app = await bootDesktop(tester, platform: platform);
    expect(find.text(l.desktopStepKeys), findsOneWidget);
    platform.server.emit({'evento': 'iniciando', 'paso': 'base'});
    await settle(tester);
    expect(find.text(l.desktopStepDatabase), findsOneWidget);
    platform.server.emit({'evento': 'iniciando', 'paso': 'migraciones'});
    await settle(tester);
    expect(find.text(l.desktopStepUpdates), findsOneWidget);
    platform.server.emit({'evento': 'error', 'codigo': 'BASE_NO_INICIA', 'detalle': 'pg_ctl: no se pudo iniciar'});
    await settle(tester);
    expect(find.text(l.desktopErrorTitle), findsOneWidget);
    expect(find.text(l.desktopErrorDatabase), findsOneWidget);
    await tapOn(tester, find.text(l.desktopErrorCopy('BASE_NO_INICIA')));
    expect(copied, 'BASE_NO_INICIA pg_ctl: no se pudo iniciar');
    platform.autoReady = true;
    await tapOn(tester, find.text(l.actionRetry));
    await settle(tester);
    expect(location(app), '/dashboard');
    await app.finish();
  });

  testWidgets('textos de error de la pantalla de carga', (tester) async {
    for (final (code, text) in [('SIN_SERVIDOR', l.desktopErrorMissing), ('YA_INICIADO', l.desktopErrorBusy), ('SE_DETUVO', l.desktopErrorGeneric)]) {
      final platform = FakeDesktopPlatform(autoReady: false);
      final app = await bootDesktop(tester, platform: platform);
      platform.server.emit({'evento': 'error', 'codigo': code});
      await settle(tester);
      expect(find.text(text), findsOneWidget, reason: code);
      await app.finish();
    }
  });

  testWidgets('E-1 · asistente: empresa, Propietario con Windows Hello, tasas, Gmail y WhatsApp, sin preguntas técnicas', (tester) async {
    final api = FakeApi();
    var gmail = <String, Object?>{'connected': false, 'address': null, 'status': null, 'lastError': null, 'lastCheckAt': null, 'sentToday': 0, 'dailyLimit': 400, 'label': 'COROC/Procesado'};
    api.overrides['GET /company/gmail'] = (_) => FakeApi.json(200, gmail);
    api.overrides['PUT /company/gmail'] = (_) {
      gmail = gmailConnected();
      return FakeApi.json(200, gmail);
    };
    final platform = FakeDesktopPlatform();
    final app = await bootDesktop(tester, api: api, platform: platform, configured: false, signedIn: false, tourDone: false);
    expect(location(app), '/bienvenida');
    expect(find.text(l.welcomeTitle), findsOneWidget);
    expect(find.text(l.welcomeStepOf(1, 5)), findsOneWidget);

    // 1 · Empresa y país.
    await tapOn(tester, find.text(l.actionContinue));
    expect(find.text(l.welcomeCompanyRequired), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, l.welcomeCompanyName), 'Inversiones Prado');
    await tapOn(tester, find.textContaining(l.countryBR));
    await tapOn(tester, find.textContaining(l.countryCO));
    await tapOn(tester, find.text(l.actionContinue));

    // 2 · Propietario: el usuario se sugiere, la contraseña se valida y Windows Hello se confirma una vez.
    expect(find.text(l.welcomeStepOf(2, 5)), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, l.welcomeOwnerName), 'Ana María Pérez');
    await tester.pump();
    expect(find.widgetWithText(TextField, 'ana.perez'), findsOneWidget);
    await tapOn(tester, find.text(l.actionBack));
    expect(find.text(l.welcomeStepOf(1, 5)), findsOneWidget);
    await tapOn(tester, find.text(l.actionContinue));
    await tester.enterText(find.widgetWithText(TextField, l.welcomeOwnerName), '');
    await tapOn(tester, find.text(l.welcomeCreate));
    expect(find.text(l.welcomeNameRequired), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, l.welcomeOwnerName), 'Ana María Pérez');
    await tester.enterText(find.widgetWithText(TextField, l.loginUsername), 'A');
    await tapOn(tester, find.text(l.welcomeCreate));
    expect(find.text(l.welcomeUsernameInvalid), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, l.loginUsername), 'ana');
    await tester.enterText(find.widgetWithText(TextField, l.loginPassword), 'corta');
    await tapOn(tester, find.text(l.welcomeCreate));
    expect(find.text(l.welcomePasswordShort), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, l.loginPassword), 'Mi-Clave-Segura-2026');
    await tester.enterText(find.widgetWithText(TextField, l.welcomePasswordAgain), 'Mi-Clave-Segura-2027');
    await tapOn(tester, find.text(l.welcomeCreate));
    expect(find.text(l.welcomePasswordMismatch), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, l.welcomePasswordAgain), 'Mi-Clave-Segura-2026');
    await tester.enterText(find.widgetWithText(TextField, l.welcomeEmailOptional), 'ana@prado.co');
    expect(find.text(l.welcomeMfaNote), findsOneWidget);
    await tapOn(tester, find.text(l.welcomeCreate));
    final setup = api.lastBody('POST', '/desktop/setup')!;
    expect(setup['company'], {'name': 'Inversiones Prado', 'country': 'CO', 'lang': 'es'});
    expect(setup['owner'], {'name': 'Ana María Pérez', 'username': 'ana', 'password': 'Mi-Clave-Segura-2026', 'email': 'ana@prado.co'});
    expect(setup['deviceId'], 'coroc-test-device-0001');
    expect(platform.helloReasons, [l.helloReason]);
    expect(app.store.hello, isTrue);
    expect(app.store.username, api.session['user']['username']);
    expect(app.container.read(authProvider), isA<SignedIn>());

    // 3 · Tasas: el tope es opcional y la política de ADR-061 está a mano.
    expect(find.text(l.welcomeStepOf(3, 5)), findsOneWidget);
    expect(find.text(l.welcomeRatesSubtitleCO), findsOneWidget);
    expect(find.byType(RateCapPolicySwitch), findsOneWidget);
    await tapOn(tester, find.text(l.rateCapAdd));
    expect(find.byType(AlertDialog), findsOneWidget);
    await tapOn(tester, find.text(l.actionCancel));
    await tapOn(tester, find.text(l.actionContinue));

    // 4 · Gmail: guía con imágenes, validaciones claras y prueba de conexión.
    expect(find.text(l.welcomeStepOf(4, 5)), findsOneWidget);
    expect(find.text(l.gmailGuideStep2), findsOneWidget);
    await tapOn(tester, find.text(l.gmailOpenGoogle));
    expect(platform.opened.last, gmailAppPasswordsUrl);
    await tapOn(tester, find.text(l.gmailTest));
    expect(find.text(l.gmailAddressInvalid), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, l.gmailAddress), 'Cobros.Prado@gmail.com');
    await tester.enterText(find.widgetWithText(TextField, l.gmailAppPassword), 'abcd efgh');
    await tapOn(tester, find.text(l.gmailTest));
    expect(find.text(l.gmailPasswordInvalid), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, l.gmailAppPassword), 'abcd efgh ijkl mnop');
    await tapOn(tester, find.byTooltip(l.actionShowPassword));
    await tapOn(tester, find.text(l.gmailTest));
    expect(api.lastBody('PUT', '/company/gmail'), {'address': 'cobros.prado@gmail.com', 'appPassword': 'abcdefghijklmnop'});
    expect(find.text(l.gmailConnectedText('cobros.prado@gmail.com')), findsOneWidget);
    await tapOn(tester, find.text(l.actionContinue));

    // 5 · WhatsApp para Windows: si falta, Microsoft Store; al instalarlo, listo.
    expect(find.text(l.welcomeStepOf(5, 5)), findsOneWidget);
    expect(find.text(l.welcomeWhatsappMissing), findsOneWidget);
    await tapOn(tester, find.text(l.welcomeWhatsappStore));
    expect(platform.opened.last, whatsAppStoreUrl);
    platform.whatsApp = true;
    await tapOn(tester, find.text(l.welcomeWhatsappCheck));
    expect(find.text(l.welcomeWhatsappReady), findsOneWidget);
    await tapOn(tester, find.text(l.welcomeStart));
    await settle(tester);
    expect(location(app), '/dashboard');

    // Primera vez en este PC: el recorrido guiado, una sola vez.
    expect(find.text(l.tourDashboardTitle), findsOneWidget);
    await tapOn(tester, find.text(l.actionContinue));
    expect(find.descendant(of: find.byType(AlertDialog), matching: find.text(l.tourMessagesTitle)), findsOneWidget);
    await tapOn(tester, find.text(l.actionContinue));
    await tapOn(tester, find.text(l.actionContinue));
    expect(find.text(l.tourBackupTitle), findsOneWidget);
    await tapOn(tester, find.text(l.tourDone));
    expect(find.byType(AlertDialog), findsNothing);
    expect(app.store.tour, isTrue);
    await app.finish();
  });

  testWidgets('asistente: Gmail se puede omitir y el error de la API se muestra tal cual', (tester) async {
    final api = FakeApi();
    api.overrides['POST /desktop/setup'] = (_) => FakeApi.problem(422, 'PASSWORD_BREACHED', 'Esa contraseña aparece en filtraciones conocidas. Elija otra.');
    final platform = FakeDesktopPlatform()..hello = false;
    final app = await bootDesktop(tester, api: api, platform: platform, configured: false, signedIn: false);
    await tester.enterText(find.widgetWithText(TextField, l.welcomeCompanyName), 'Inversiones Prado');
    await tapOn(tester, find.text(l.actionContinue));
    expect(find.text(l.welcomeHello), findsNothing);
    await tester.enterText(find.widgetWithText(TextField, l.welcomeOwnerName), 'Ana Prado');
    await tester.enterText(find.widgetWithText(TextField, l.loginPassword), 'Contraseña123');
    await tester.enterText(find.widgetWithText(TextField, l.welcomePasswordAgain), 'Contraseña123');
    await tapOn(tester, find.text(l.welcomeCreate));
    expect(find.text('Esa contraseña aparece en filtraciones conocidas. Elija otra.'), findsOneWidget);
    expect(platform.helloReasons, isEmpty);
    await app.finish();
  });

  testWidgets('asistente: si Windows Hello no confirma, COROC se abrirá con la contraseña', (tester) async {
    final api = FakeApi();
    final platform = FakeDesktopPlatform()..helloAnswer = false;
    final app = await bootDesktop(tester, api: api, platform: platform, configured: false, signedIn: false);
    await tester.enterText(find.widgetWithText(TextField, l.welcomeCompanyName), 'Inversiones Prado');
    await tapOn(tester, find.text(l.actionContinue));
    await tester.enterText(find.widgetWithText(TextField, l.welcomeOwnerName), 'Ana Prado');
    await tester.enterText(find.widgetWithText(TextField, l.loginPassword), 'Mi-Clave-Segura-2026');
    await tester.enterText(find.widgetWithText(TextField, l.welcomePasswordAgain), 'Mi-Clave-Segura-2026');
    await tapOn(tester, find.text(l.welcomeCreate));
    expect(app.store.hello, isFalse);
    expect(find.text(l.welcomeStepOf(3, 5)), findsOneWidget);
    await tapOn(tester, find.text(l.actionContinue));
    await tapOn(tester, find.text(l.welcomeSkip));
    expect(find.text(l.welcomeStepOf(5, 5)), findsOneWidget);
    await app.finish();
  });

  testWidgets('E-7 · restaurar en este PC la copia de otro e ingresar con el usuario de siempre', (tester) async {
    final api = FakeApi();
    var status = desktopStatus(configured: false);
    api.overrides['GET /desktop/status'] = (_) => FakeApi.json(200, status);
    api.overrides['POST /desktop/restore'] = (_) =>
        FakeApi.json(201, {'id': 'd3500000-0000-4000-8000-000000000001', 'status': 'uploaded', 'company': 'Inversiones Prado', 'backupCreatedAt': '2026-10-24T22:00:00.000Z'});
    var attempt = 0;
    api.overrides['POST /desktop/restore/{id}/apply'] = (_) {
      if (attempt++ == 0) return FakeApi.problem(422, 'BACKUP_PASSWORD', 'La contraseña de la copia no es correcta.');
      status = desktopStatus();
      return FakeApi.json(200, {
        'company': status['company'],
        'owners': ['ana'],
      });
    };
    final app = await bootDesktop(tester, api: api, configured: false, signedIn: false);
    await tapOn(tester, find.text(l.welcomeRestoreLink));
    expect(find.text(l.welcomeRestoreTitle), findsOneWidget);
    await tapOn(tester, find.text(l.actionBack));
    expect(find.text(l.welcomeTitle), findsOneWidget);
    await tapOn(tester, find.text(l.welcomeRestoreLink));
    // Sin archivo elegido no pasa nada.
    await tapOn(tester, find.text(l.welcomeRestorePick));
    expect(api.sent('POST', '/desktop/restore'), isEmpty);
    app.files.file = XFile.fromData(Uint8List.fromList(List.filled(256, 7)), name: 'COROC_Respaldo_inversiones-prado_2026-10-24_2200.coroc');
    await tapOn(tester, find.text(l.welcomeRestorePick));
    expect(api.sent('POST', '/desktop/restore').single.bodyBytes, hasLength(256));
    expect(find.textContaining('Inversiones Prado'), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, l.welcomeRestorePassword), 'Clave-Equivocada');
    await tapOn(tester, find.text(l.welcomeRestoreApply));
    expect(find.text('La contraseña de la copia no es correcta.'), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, l.welcomeRestorePassword), 'Respaldo-Seguro-2026');
    await tapOn(tester, find.text(l.welcomeRestoreApply));
    expect(api.lastBody('POST', '/desktop/restore/{id}/apply'), {'password': 'Respaldo-Seguro-2026'});
    await settle(tester);
    expect(location(app), '/login');
    expect(app.store.tenant, 'inversiones-prado');
    expect(app.store.username, 'ana');

    // Ingreso sin el campo de empresa: el identificador lo completa COROC.
    expect(find.text('Inversiones Prado'), findsOneWidget);
    expect(find.widgetWithText(TextFormField, l.loginCompany), findsNothing);
    expect(find.widgetWithText(TextFormField, 'ana'), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextFormField, l.loginPassword), 'Mi-Clave-Segura-2026');
    await tapOn(tester, find.text(l.loginSubmit));
    expect(api.lastBody('POST', '/auth/login'), containsPair('tenant', 'inversiones-prado'));
    await settle(tester);
    expect(location(app), '/dashboard');
    await app.finish();
  });

  testWidgets('una restauración que quedó a medias se retoma con la contraseña', (tester) async {
    final api = FakeApi();
    api.overrides['GET /desktop/status'] = (_) =>
        FakeApi.json(200, desktopStatus(configured: false, restore: {'id': 'd3500000-0000-4000-8000-000000000002', 'status': 'uploaded', 'company': 'Inversiones Prado', 'backupCreatedAt': null}));
    final app = await bootDesktop(tester, api: api, configured: false, signedIn: false);
    expect(find.text(l.welcomeRestoreTitle), findsOneWidget);
    expect(find.text(l.welcomeRestoreFile('Inversiones Prado', '—')), findsOneWidget);
    await app.finish();
  });

  testWidgets('¿Olvidó su contraseña? en Escritorio: Windows Hello y una contraseña nueva, sin correo', (tester) async {
    final api = FakeApi();
    final platform = FakeDesktopPlatform();
    final store = MemorySessionStore(savedLocale: 'es')
      ..tenant = 'inversiones-prado'
      ..username = 'ana'
      ..remember = true;
    final app = await bootDesktop(tester, api: api, platform: platform, signedIn: false, store: store);
    await tapOn(tester, find.text(l.loginForgot));
    expect(find.text(l.desktopResetSubtitle), findsOneWidget);
    expect(find.widgetWithText(TextField, 'ana'), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, l.desktopResetNewPassword), 'Otra-Clave-Segura-2026');
    await tester.enterText(find.widgetWithText(TextField, l.welcomePasswordAgain), 'Otra-Clave-Segura-2026');
    platform.helloAnswer = false;
    await tapOn(tester, find.text(l.desktopResetSubmit));
    expect(find.text(l.helloNotConfirmed), findsOneWidget);
    expect(api.sent('POST', '/desktop/password'), isEmpty);
    platform.helloAnswer = true;
    await tapOn(tester, find.text(l.desktopResetSubmit));
    expect(platform.helloReasons.last, l.helloResetReason);
    expect(api.lastBody('POST', '/desktop/password'), {'username': 'ana', 'password': 'Otra-Clave-Segura-2026'});
    expect(find.text(l.desktopResetDone), findsOneWidget);
    await tapOn(tester, find.text(l.forgotBack));
    expect(location(app), '/login');
    await app.finish();
  });

  testWidgets('sin Windows Hello en el PC, dice cómo activarlo', (tester) async {
    final platform = FakeDesktopPlatform()..hello = false;
    final app = await bootDesktop(tester, platform: platform, signedIn: false);
    await app.go('/forgot');
    expect(find.text(l.desktopResetNoHello), findsOneWidget);
    await app.finish();
  });

  testWidgets('nueva contraseña: validaciones antes de pedir Windows Hello', (tester) async {
    final platform = FakeDesktopPlatform();
    final app = await bootDesktop(tester, platform: platform, signedIn: false);
    await app.go('/forgot');
    await tester.enterText(find.widgetWithText(TextField, l.loginUsername), 'X');
    await tapOn(tester, find.text(l.desktopResetSubmit));
    expect(find.text(l.welcomeUsernameInvalid), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, l.loginUsername), 'ana');
    await tester.enterText(find.widgetWithText(TextField, l.desktopResetNewPassword), 'corta');
    await tapOn(tester, find.text(l.desktopResetSubmit));
    expect(find.text(l.welcomePasswordShort), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, l.desktopResetNewPassword), 'Otra-Clave-Segura-2026');
    await tapOn(tester, find.text(l.desktopResetSubmit));
    expect(find.text(l.welcomePasswordMismatch), findsOneWidget);
    expect(platform.helloReasons, isEmpty);
    await app.finish();
  });

  testWidgets('con Windows Hello elegido, COROC abre bloqueado', (tester) async {
    final store = MemorySessionStore(refresh: 'rt1.sesion-de-prueba', savedLocale: 'es')..hello = true;
    final app = await bootDesktop(tester, store: store, minimized: true);
    expect(find.byType(LockPage), findsOneWidget);
    await app.finish();
  });

  testWidgets('ventana y bandeja: cerrar deja a COROC trabajando; «Salir» apaga todo en orden', (tester) async {
    final platform = FakeDesktopPlatform();
    final app = await bootDesktop(tester, platform: platform);
    expect(platform.windowInits, 1);
    expect(platform.tooltip, l.trayTooltip);
    expect(platform.tray!.map((e) => e.label), [l.trayOpen, l.trayTodayMessages, '', l.trayQuit]);

    // La primera vez se explica; después se oculta sin preguntar.
    platform.signal(WindowSignalKind.closeRequested);
    await settle(tester);
    expect(find.text(l.trayHintBody), findsOneWidget);
    await tapOn(tester, find.text(l.trayHintOk));
    expect(platform.hidden, 1);
    expect(app.store.trayHint, isTrue);
    platform.signal(WindowSignalKind.closeRequested);
    await settle(tester);
    expect(find.text(l.trayHintBody), findsNothing);
    expect(platform.hidden, 2);

    platform.signal(WindowSignalKind.trayClicked);
    await settle(tester);
    expect(platform.shown, 1);
    platform.signal(WindowSignalKind.trayItem, 'abrir');
    await settle(tester);
    expect(platform.shown, 2);
    platform.signal(WindowSignalKind.trayItem, 'mensajes');
    await settle(tester);
    expect(platform.shown, 3);
    expect(location(app), '/messages/today');
    platform.signal(WindowSignalKind.focused);
    await settle(tester);

    platform.signal(WindowSignalKind.trayItem, 'salir');
    await settle(tester);
    expect(platform.servers.single.sent, ['detener']);
    expect(platform.quits, 1);
    await app.finish();
  });

  testWidgets('al cerrar la ventana la primera vez también se puede salir del todo', (tester) async {
    final platform = FakeDesktopPlatform();
    final app = await bootDesktop(tester, platform: platform);
    platform.signal(WindowSignalKind.closeRequested);
    await settle(tester);
    await tapOn(tester, find.text(l.trayQuit));
    expect(platform.quits, 1);
    expect(platform.hidden, 0);
    await app.finish();
  });

  testWidgets('el instalador va a actualizar: la app se cierra sola', (tester) async {
    final platform = FakeDesktopPlatform();
    final app = await bootDesktop(tester, platform: platform);
    platform.server.emit({'evento': 'detenido', 'motivo': 'instalador'});
    platform.server.exit();
    await settle(tester);
    expect(platform.quits, 1);
    expect(platform.servers, hasLength(1));
    await app.finish();
  });

  testWidgets('el menú de la bandeja sigue el idioma', (tester) async {
    final platform = FakeDesktopPlatform();
    final app = await bootDesktop(tester, platform: platform, locale: 'pt');
    final pt = lookupAppLocalizations(const Locale('pt'));
    expect(platform.tray!.first.label, pt.trayOpen);
    await app.finish();
  });

  testWidgets('la ayuda de Escritorio aparece primero', (tester) async {
    final app = await bootDesktop(tester);
    await app.go('/help');
    expect(find.text(l.helpDesktopTitle), findsOneWidget);
    expect(find.text(l.helpSmartScreenTitle), findsOneWidget);
    await app.finish();
  });
}
