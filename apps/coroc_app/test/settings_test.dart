import 'package:coroc/app.dart';
import 'package:coroc/core/auth/auth_controller.dart';
import 'package:coroc/core/l10n.dart';
import 'package:coroc/design/widgets/brand.dart';
import 'package:coroc/design/widgets/common.dart';
import 'package:coroc/features/shell/app_shell.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'app_harness.dart';
import 'fake_api.dart';

final l = lookupAppLocalizations(const Locale('es'));

/// Un control dentro de la tarjeta de Configuración con ese título.
Finder inSection(String title, Finder f) => find.descendant(of: find.ancestor(of: find.text(title), matching: find.byType(SectionCard)).first, matching: f);

Future<void> pickMenu<T>(WidgetTester tester, Finder menu, String entry) async {
  await tapOn(tester, menu);
  await tester.tap(find.text(entry).last);
  await settle(tester);
}

Future<void> tapOk(WidgetTester tester, Type dialog) async {
  final ctx = tester.element(find.byType(dialog));
  await tapOn(tester, find.text(MaterialLocalizations.of(ctx).okButtonLabel));
}

void main() {
  testWidgets('preferencias: idioma, tema, bloqueo y nombre visible se guardan en el perfil', (tester) async {
    final app = await bootApp(tester);
    final api = app.api;
    await app.go('/settings');
    await tapOn(tester, find.text('English'));
    expect(api.lastBody('PATCH', '/me'), containsPair('lang', 'en'));
    await tapOn(tester, find.text('Español'));
    await tapOn(tester, find.text(l.themeDark));
    expect(api.lastBody('PATCH', '/me'), containsPair('theme', 'dark'));
    await pickMenu<int>(tester, find.byType(DropdownMenu<int>).first, l.minutesN(10));
    expect(api.lastBody('PATCH', '/me'), containsPair('autoLockMinutes', 10));
    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Propietario DAST'));
    await tester.enterText(find.widgetWithText(TextField, l.fieldName), 'Dueña de DAST');
    await tapOn(tester, find.widgetWithText(FilledButton, l.actionSave));
    expect(api.lastBody('PATCH', '/me'), containsPair('name', 'Dueña de DAST'));
    await app.finish();
  });

  testWidgets('seguridad: cambio de contraseña validado y cierre de sesión en otro equipo', (tester) async {
    final api = FakeApi();
    api.overrides['GET /me/sessions'] = (_) => FakeApi.json(200, [
          ...(api.gets['/me/sessions'] as List<dynamic>),
          {'id': 'aaaaaaaa-0000-4000-8000-000000000001', 'deviceId': 'tableta-1', 'deviceName': 'Tableta de la oficina', 'createdAt': '2026-09-01T10:00:00.000Z', 'lastUsedAt': '2026-09-20T10:00:00.000Z', 'current': false},
        ]);
    final app = await bootApp(tester, api: api);
    await app.go('/settings');
    expect(find.text(l.mfaOwnerRequired), findsOneWidget);

    await tapOn(tester, find.text(l.actionSignOutDevice));
    expect(api.sent('DELETE', '/me/sessions/{id}'), hasLength(1));

    await tapOn(tester, find.text(l.passwordChangeTitle));
    final fields = find.descendant(of: find.byType(AlertDialog), matching: find.byType(TextField));
    await tester.enterText(fields.at(0), 'Clave-Actual-2026');
    await tester.enterText(fields.at(1), 'corta');
    await tapOn(tester, find.text(l.actionSave));
    expect(find.text(l.passwordTooShort), findsOneWidget);
    await tester.enterText(fields.at(1), 'Clave-Nueva-Segura-2026');
    await tester.enterText(fields.at(2), 'Otra-Distinta-2026');
    await tapOn(tester, find.text(l.actionSave));
    expect(find.text(l.passwordMismatch), findsOneWidget);
    await tapOn(tester, find.text(l.actionShowPassword));
    await tester.enterText(fields.at(2), 'Clave-Nueva-Segura-2026');
    await tapOn(tester, find.text(l.actionSave));
    expect(api.lastBody('POST', '/me/password'), {'currentPassword': 'Clave-Actual-2026', 'newPassword': 'Clave-Nueva-Segura-2026'});
    expect(find.text(l.passwordChanged), findsOneWidget);
    await app.finish();
  });

  testWidgets('seguridad: la contraseña actual errada se muestra en el diálogo', (tester) async {
    final api = FakeApi()..overrides['POST /me/password'] = (_) => FakeApi.problem(401, 'INVALID_CREDENTIALS', 'La contraseña actual no coincide.');
    final app = await bootApp(tester, api: api);
    await app.go('/settings');
    await tapOn(tester, find.text(l.passwordChangeTitle));
    final fields = find.descendant(of: find.byType(AlertDialog), matching: find.byType(TextField));
    await tester.enterText(fields.at(0), 'errada');
    await tester.enterText(fields.at(1), 'Clave-Nueva-Segura-2026');
    await tester.enterText(fields.at(2), 'Clave-Nueva-Segura-2026');
    await tapOn(tester, find.text(l.actionSave));
    expect(find.text('La contraseña actual no coincide.'), findsOneWidget);
    await tapOn(tester, find.text(l.actionCancel));
    await app.finish();
  });

  testWidgets('segundo factor voluntario: se activa desde Configuración con el código', (tester) async {
    final api = FakeApi();
    (api.session['user'] as Json)['mfaEnabled'] = false;
    var attempts = 0;
    api.overrides['POST /me/mfa/enroll'] = (_) => ++attempts == 1
        ? FakeApi.problem(503, 'UNAVAILABLE')
        : FakeApi.json(200, {'secret': 'JBSWY3DPEHPK3PXP', 'otpauthUri': 'otpauth://totp/COROC:admin?secret=JBSWY3DPEHPK3PXP&issuer=COROC'});
    final app = await bootApp(tester, api: api, role: 'admin');
    await app.go('/settings');
    await tapOn(tester, find.text(l.actionEnable));
    await tapOn(tester, find.text(l.actionRetry));
    expect(find.byType(SelectableText), findsWidgets);
    await tapOn(tester, find.descendant(of: find.byType(AlertDialog), matching: find.text(l.actionCopy)));
    // Con el sexto dígito el código se envía solo.
    await tester.enterText(find.descendant(of: find.byType(AlertDialog), matching: find.byType(TextField)), '123456');
    await settle(tester);
    expect(api.lastBody('POST', '/me/mfa/confirm'), {'code': '123456'});
    await settle(tester, frames: 50); // Los avisos se muestran en fila: primero termina «Copiado».
    expect(find.text(l.mfaEnabledDone), findsOneWidget);
    await app.finish();
  });

  testWidgets('segundo factor: un Administrador lo desactiva con un código válido', (tester) async {
    final api = FakeApi();
    var attempts = 0;
    api.overrides['DELETE /me/mfa'] = (_) => ++attempts == 1 ? FakeApi.problem(401, 'MFA_INVALID', 'El código no es válido.') : FakeApi.empty();
    final app = await bootApp(tester, api: api, role: 'admin');
    await app.go('/settings');
    await tapOn(tester, find.text(l.actionDisable));
    final code = find.descendant(of: find.byType(AlertDialog), matching: find.byType(TextField));
    await tester.enterText(code, '12345');
    await tapOn(tester, find.widgetWithText(FilledButton, l.actionDisable));
    expect(api.sent('DELETE', '/me/mfa'), isEmpty);
    // Con el sexto dígito el código se envía solo.
    await tester.enterText(code, '000000');
    await settle(tester);
    expect(find.text('El código no es válido.'), findsOneWidget);
    await tester.enterText(code, '654321');
    await settle(tester);
    expect(api.lastBody('DELETE', '/me/mfa'), {'code': '654321'});
    expect(find.text(l.mfaDisabledDone), findsOneWidget);
    await app.finish();
  });

  testWidgets('empresa: se editan los datos con la versión y el error de un campo se muestra junto a él', (tester) async {
    final api = FakeApi();
    var attempts = 0;
    api.overrides['PATCH /company'] = (_) => ++attempts == 1
        ? FakeApi.json(422, {'type': 'about:blank', 'title': 'Datos no válidos', 'status': 422, 'code': 'VALIDATION', 'detail': 'Revise el correo.', 'errors': [{'field': 'email', 'message': 'Correo no válido'}]})
        : FakeApi.json(200, api.get('/company'));
    final app = await bootApp(tester, api: api);
    await app.go('/settings');
    await tapOn(tester, inSection(l.settingsCompany, find.text(l.actionEdit)));
    await tester.enterText(find.widgetWithText(TextField, l.companyTaxId), '900123456-7');
    await tester.enterText(find.widgetWithText(TextField, l.fieldEmail), 'no-es-correo');
    await tapOn(tester, find.text(l.actionSave));
    expect(find.text('Revise el correo.'), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, l.fieldEmail), 'hola@dast.co');
    await tapOn(tester, find.text(l.actionSave));
    expect(api.sent('PATCH', '/company').last.headers['If-Match'], '1');
    expect(api.lastBody('PATCH', '/company'), allOf(containsPair('taxId', '900123456-7'), containsPair('email', 'hola@dast.co')));
    await app.finish();
  });

  testWidgets('cuentas receptoras y registro automático de pagos', (tester) async {
    final app = await bootApp(tester);
    final api = app.api;
    await app.go('/settings');
    await tapOn(tester, find.text(l.receivingAdd));
    await tester.enterText(find.widgetWithText(TextField, l.receivingHolder), 'COROC SAS');
    await tester.enterText(find.widgetWithText(TextField, l.receivingInstitution), 'Davivienda');
    await tester.enterText(find.widgetWithText(TextField, l.receivingLast4), '1234');
    await tapOn(tester, find.widgetWithText(FilledButton, l.actionSave));
    expect(api.lastBody('POST', '/receiving-accounts'), {'holderName': 'COROC SAS', 'institution': 'Davivienda', 'last4': '1234'});
    await tapOn(tester, inSection(l.receivingTitle, find.byTooltip(l.actionDelete)));
    expect(api.sent('DELETE', '/receiving-accounts/{id}'), hasLength(1));

    await tapOn(tester, find.text(l.autoModePrior));
    expect(api.lastBody('PATCH', '/company'), {'settings': {'supervisionMode': 'prior_approval'}});
    await tester.ensureVisible(find.byType(Slider));
    await tester.drag(find.byType(Slider), const Offset(-120, 0));
    await settle(tester);
    expect((api.lastBody('PATCH', '/company')!['settings'] as Json)['confidenceThreshold'], lessThan(0.95));
    await pickMenu<int>(tester, inSection(l.autoTitle, find.byType(DropdownMenu<int>)).first, '60');
    expect(api.lastBody('PATCH', '/company'), {'settings': {'maxReceiptAgeDays': 60}});
    await app.finish();
  });

  testWidgets('usuarios: alta con contraseña generada, cambio de rol, desactivar, cerrar sesiones y eliminar', (tester) async {
    final app = await bootApp(tester);
    final api = app.api;
    await app.go('/settings');
    await tapOn(tester, find.text(l.userNew));
    await tapOn(tester, find.text(l.userCreate));
    expect(find.text(l.validationRequired), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextFormField, '${l.fieldName} *'), 'Ana Cobradora');
    await tester.enterText(find.widgetWithText(TextFormField, '${l.fieldUsername} *'), 'Ana.Cobra');
    await tester.enterText(find.widgetWithText(TextFormField, l.fieldEmail), 'ana@dast.co');
    await tapOn(tester, find.byTooltip(l.actionGenerate));
    await tapOn(tester, find.descendant(of: find.byType(AlertDialog), matching: find.byTooltip(l.actionCopy)));
    await pickMenu<String>(tester, find.descendant(of: find.byType(AlertDialog), matching: find.byType(DropdownMenu<String>)), roleLabel(l, 'auditor'));
    await tapOn(tester, find.text(l.userCreate));
    final body = api.lastBody('POST', '/users')!;
    expect(body, allOf(containsPair('username', 'ana.cobra'), containsPair('role', 'auditor'), containsPair('email', 'ana@dast.co')));
    expect((body['password'] as String).length, 19);

    Future<void> menu(String action) async {
      await tapOn(tester, inSection(l.settingsUsers, find.byTooltip(l.actionMore)));
      await tapOn(tester, find.text(action).last);
    }

    await menu(l.userChangeRole);
    await tapOn(tester, find.text(roleLabel(l, 'admin')).last);
    expect(api.lastBody('PATCH', '/users/{id}'), {'role': 'admin'});
    await menu(l.userDeactivate);
    expect(api.lastBody('PATCH', '/users/{id}'), {'active': false});
    await menu(l.userRevokeSessions);
    expect(api.sent('DELETE', '/users/{id}/sessions'), hasLength(1));
    expect(find.text(l.userSessionsRevoked), findsOneWidget);
    await menu(l.userDelete);
    await tapOn(tester, find.widgetWithText(FilledButton, l.userDelete));
    expect(api.sent('DELETE', '/users/{id}'), hasLength(1));
    await app.finish();
  });

  testWidgets('WhatsApp: conectar, modo automático con la lista de verificación y desconectar', (tester) async {
    final api = FakeApi();
    final wa = {...api.get('/company/whatsapp'), 'configured': true, 'phoneNumberId': '1234567890', 'displayNumber': '+57 300 000 0000', 'wabaId': '99887766', 'serverReady': true};
    api.overrides['GET /company/whatsapp'] = (_) => FakeApi.json(200, wa);
    final app = await bootApp(tester, api: api);
    await app.go('/settings');
    expect(find.text(l.whatsappConnected('+57 300 000 0000')), findsOneWidget);
    await tapOn(tester, inSection(l.whatsappTitle, find.text(l.actionEdit)));
    await tester.enterText(find.widgetWithText(TextField, l.whatsappToken), 'EAAB-token-de-acceso-largo-0001');
    await tapOn(tester, find.widgetWithText(FilledButton, l.actionSave));
    expect(api.lastBody('PUT', '/company/whatsapp'), allOf(containsPair('phoneNumberId', '1234567890'), containsPair('wabaId', '99887766')));

    await tapOn(tester, find.text(l.whatsappModeCloud));
    for (final item in [l.whatsappCheckBusiness, l.whatsappCheckNumber, l.whatsappCheckTemplates, l.whatsappCheckLegal, l.whatsappCheckPolicy]) {
      await tapOn(tester, find.text(item), frames: 2);
    }
    await tapOn(tester, find.text(l.whatsappActivateCloud));
    expect(api.lastBody('PUT', '/company/whatsapp/mode'), containsPair('mode', 'cloud_api'));
    await tapOn(tester, find.text(l.whatsappDisconnect));
    expect(api.sent('DELETE', '/company/whatsapp'), hasLength(1));
    await app.finish();
  });

  testWidgets('correo saliente: remitente propio, verificación de DNS y volver al remitente de COROC', (tester) async {
    final api = FakeApi();
    final sender = {
      ...api.get('/company/email-sender'),
      'configured': true, 'provider': 'postmark', 'fromEmail': 'cobros@dast.co', 'fromName': 'Cobros DAST', 'domain': 'dast.co', 'dkimSelector': 'coroc', 'spf': true,
      'records': [
        {'kind': 'spf', 'type': 'TXT', 'host': 'dast.co', 'expected': 'v=spf1 include:spf.mtasv.net ~all', 'ok': true},
        {'kind': 'dkim', 'type': 'TXT', 'host': 'coroc._domainkey.dast.co', 'expected': 'k=rsa; p=MIGf', 'ok': false},
      ],
    };
    api.overrides['GET /company/email-sender'] = (_) => FakeApi.json(200, sender);
    final app = await bootApp(tester, api: api);
    await app.go('/settings');
    expect(find.text(l.emailSenderPending('cobros@dast.co')), findsOneWidget);
    expect(find.text('k=rsa; p=MIGf'), findsOneWidget);
    await tapOn(tester, inSection(l.emailSenderTitle, find.text(l.actionEdit)));
    await tester.enterText(find.widgetWithText(TextField, l.emailSenderFrom), 'pagos@dast.co');
    await tapOn(tester, find.widgetWithText(FilledButton, l.actionSave));
    expect(api.lastBody('PUT', '/company/email-sender'), {'fromEmail': 'pagos@dast.co', 'fromName': 'Cobros DAST', 'dkimSelector': 'coroc'});
    await tapOn(tester, find.text(l.emailSenderVerify));
    expect(api.sent('POST', '/company/email-sender/verify'), hasLength(1));
    await tapOn(tester, find.text(l.emailSenderUseDefault));
    expect(api.sent('DELETE', '/company/email-sender'), hasLength(1));
    await app.finish();
  });

  testWidgets('reglas de contacto: preset, revisión legal, transaccionales, recordatorios y hora', (tester) async {
    final app = await bootApp(tester);
    final api = app.api;
    await app.go('/settings');
    await pickMenu<String>(tester, inSection(l.complianceTitle, find.byType(DropdownMenu<String>)), l.presetUsa);
    expect(api.lastBody('PUT', '/compliance/contact-rules'), {'preset': 'US_FDCPA_REG_F_TEMPLATE'});
    await tapOn(tester, find.text(l.complianceTransactionalImmediate));
    expect(api.lastBody('PUT', '/compliance/contact-rules'), {'transactionalImmediate': true});
    await tapOn(tester, find.text(l.complianceDailyReminders));
    expect(api.lastBody('PUT', '/compliance/contact-rules'), {'dailyReminders': true});
    await tapOn(tester, find.widgetWithText(OutlinedButton, '08:00'));
    await tapOk(tester, TimePickerDialog);
    expect(api.lastBody('PUT', '/compliance/contact-rules'), {'reminderTime': '08:00'});
    await app.finish();
  });

  testWidgets('reglas de contacto: un preset que exige revisión legal la pide al Propietario', (tester) async {
    final api = FakeApi();
    final rules = {...api.get('/compliance/contact-rules'), 'preset': 'US_FDCPA_REG_F_TEMPLATE'};
    api.overrides['GET /compliance/contact-rules'] = (_) => FakeApi.json(200, rules);
    final app = await bootApp(tester, api: api);
    await app.go('/settings');
    expect(find.text(l.compliancePendingReview), findsOneWidget);
    await tapOn(tester, find.text(l.complianceCounselReviewed));
    expect(api.lastBody('PUT', '/compliance/contact-rules'), {'counselReviewed': true});
    await app.finish();
  });

  testWidgets('topes de tasa: el formulario valida y guarda el tope vigente del país', (tester) async {
    final api = FakeApi();
    final now = DateTime.now();
    String iso(DateTime d) => d.toIso8601String().substring(0, 10);
    api.overrides['GET /compliance/rate-caps'] = (_) => FakeApi.json(200, [
          {'id': 'aaaaaaaa-0000-4000-8000-00000000000c', 'country': 'US', 'effectiveAnnual': 0.25, 'validFrom': iso(DateTime(now.year, now.month, 1)), 'validTo': iso(DateTime(now.year, now.month + 1, 0)), 'source': 'Ley estatal'},
          {'id': 'aaaaaaaa-0000-4000-8000-00000000000d', 'country': 'US', 'effectiveAnnual': 0.24, 'validFrom': '2025-01-01', 'validTo': '2025-01-31', 'source': 'Ley estatal'},
        ]);
    final app = await bootApp(tester, api: api);
    await app.go('/settings');
    expect(find.text(l.rateCapCurrent), findsOneWidget);
    await tapOn(tester, find.text(l.rateCapAdd));
    await tapOn(tester, find.widgetWithText(GoldButton, l.actionSave));
    expect(find.text(l.rateCapInvalid), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, '${l.rateCapRate} *'), '26,5');
    await tester.enterText(find.widgetWithText(TextField, '${l.rateCapSource} *'), 'Resolución 0001');
    await tapOn(tester, find.byIcon(Icons.event));
    await tapOk(tester, DatePickerDialog);
    await tapOn(tester, find.byIcon(Icons.event_busy));
    await tapOk(tester, DatePickerDialog);
    await tapOn(tester, find.widgetWithText(GoldButton, l.actionSave));
    expect(api.lastBody('POST', '/compliance/rate-caps'), allOf(containsPair('country', 'US'), containsPair('effectiveAnnual', 0.265), containsPair('source', 'Resolución 0001')));
    await app.finish();
  });

  testWidgets('respaldo: la contraseña se valida, el respaldo en curso se consulta y se puede cancelar', (tester) async {
    final api = FakeApi();
    final running = {...(api.gets['/backups'] as List<dynamic>).first as Json, 'id': 'aaaaaaaa-0000-4000-8000-00000000000b', 'status': 'running', 'progress': 40, 'fileName': null, 'size': null};
    api.overrides['GET /backups'] = (_) => FakeApi.json(200, [running, ...(api.gets['/backups'] as List<dynamic>)]);
    final app = await bootApp(tester, api: api);
    await app.go('/settings');
    expect(find.text(l.backupRunning(40)), findsOneWidget);
    await settle(tester, frames: 16);
    expect(api.sent('GET', '/backups').length, greaterThan(1));
    await tapOn(tester, inSection(l.backupTitle, find.text(l.actionCancel)));
    expect(api.sent('POST', '/backups/{id}/cancel'), hasLength(1));
    // La descarga necesita el disco del equipo: sin él se informa el error sin romper la pantalla.
    await tapOn(tester, find.byTooltip(l.backupDownload));
    expect(tester.takeException(), isNull);
    await app.finish();
  });

  testWidgets('respaldo: nuevo respaldo con contraseña confirmada', (tester) async {
    final app = await bootApp(tester);
    final api = app.api;
    await app.go('/settings');
    await tapOn(tester, find.widgetWithText(GoldButton, l.backupCreate));
    final fields = find.descendant(of: find.byType(AlertDialog), matching: find.byType(TextField));
    await tester.enterText(fields.at(0), 'corta');
    await tapOn(tester, find.widgetWithText(FilledButton, l.backupCreate));
    expect(find.text(l.backupPasswordShort), findsOneWidget);
    await tester.enterText(fields.at(0), 'Respaldo-Seguro-2026');
    await tester.enterText(fields.at(1), 'Otra-Cosa-2026');
    await tapOn(tester, find.widgetWithText(FilledButton, l.backupCreate));
    expect(find.text(l.backupPasswordMismatch), findsOneWidget);
    await tester.enterText(fields.at(1), 'Respaldo-Seguro-2026');
    await tapOn(tester, find.widgetWithText(FilledButton, l.backupCreate));
    expect(api.lastBody('POST', '/backups'), {'password': 'Respaldo-Seguro-2026'});
    expect(find.text(l.backupStarted), findsOneWidget);
    await app.finish();
  });

  testWidgets('cerrar la empresa: exige contraseña e identificador y cierra la sesión', (tester) async {
    final app = await bootApp(tester);
    final api = app.api;
    await app.go('/settings');
    await tapOn(tester, find.widgetWithText(OutlinedButton, l.closeCompanyAction));
    final action = find.widgetWithText(FilledButton, l.closeCompanyAction);
    expect(tester.widget<FilledButton>(action).onPressed, isNull);
    final fields = find.descendant(of: find.byType(AlertDialog), matching: find.byType(TextField));
    await tester.enterText(fields.at(0), 'Clave-Actual-2026');
    await tester.enterText(fields.at(1), 'DAST');
    await settle(tester, frames: 2);
    await tapOn(tester, action);
    expect(api.lastBody('POST', '/company/closure'), {'password': 'Clave-Actual-2026', 'confirmSlug': 'DAST'});
    expect(app.container.read(authProvider), isA<SignedOut>());
    await app.finish();
  });

  testWidgets('eliminar la cuenta propia (Cobrador) y en teléfono los Informes quedan en Configuración', (tester) async {
    final api = FakeApi()..overrides['DELETE /me'] = (_) => FakeApi.problem(401, 'INVALID_CREDENTIALS', 'La contraseña no coincide.');
    final app = await bootApp(tester, api: api, role: 'collector', permissions: const ['company.view', 'clients.view', 'reports.view', 'intake.view'], size: phone);
    await app.go('/settings');
    expect(find.text(l.navReports), findsWidgets);
    await tapOn(tester, find.widgetWithText(OutlinedButton, l.deleteAccountAction));
    await tester.enterText(find.descendant(of: find.byType(AlertDialog), matching: find.byType(TextField)), 'errada');
    await settle(tester, frames: 2);
    await tapOn(tester, find.widgetWithText(FilledButton, l.deleteAccountAction));
    expect(api.lastBody('DELETE', '/me'), {'password': 'errada'});
    expect(find.text('La contraseña no coincide.'), findsOneWidget);
    expect(app.container.read(authProvider), isA<SignedIn>());
    await tapOn(tester, find.text(l.navHelp));
    expect(app.container.read(routerProvider).routerDelegate.currentConfiguration.uri.path, '/help');
    await app.finish();
  });
}
