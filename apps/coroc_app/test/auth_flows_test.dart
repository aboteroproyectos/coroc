import 'package:coroc/core/auth/auth_controller.dart';
import 'package:coroc/core/l10n.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'app_harness.dart';
import 'fake_api.dart';

final l = lookupAppLocalizations(const Locale('es'));

Future<void> fillLogin(WidgetTester tester, {String tenant = 'dast', String user = 'propietario', String password = 'Clave-De-Prueba-2026'}) async {
  final fields = find.byType(TextFormField);
  await tester.enterText(fields.at(0), tenant);
  await tester.enterText(fields.at(1), user);
  await tester.enterText(fields.at(2), password);
}

void main() {
  testWidgets('ingreso: valida los campos, envía empresa, usuario y dispositivo, y abre el tablero', (tester) async {
    final app = await bootApp(tester, signedIn: false);
    expect(find.text(l.loginSubmit), findsOneWidget);
    await tester.tap(find.text(l.loginSubmit));
    await settle(tester);
    expect(find.text(l.validationRequired), findsWidgets);
    await fillLogin(tester, tenant: ' DAST ', user: 'Propietario');
    await tester.tap(find.byTooltip(l.actionShowPassword));
    await tester.tap(find.text(l.loginRemember));
    await tester.tap(find.text(l.loginSubmit));
    await settle(tester);
    expect(app.api.lastBody('POST', '/auth/login'), containsPair('tenant', 'dast'));
    expect(app.api.lastBody('POST', '/auth/login'), containsPair('username', 'propietario'));
    expect(app.store.tenant, 'dast');
    expect(app.container.read(authProvider), isA<SignedIn>());
    await app.finish();
  });

  testWidgets('ingreso: un error del servidor se muestra traducido y el idioma cambia al instante', (tester) async {
    final api = FakeApi()..overrides['POST /auth/login'] = (_) => FakeApi.problem(401, 'INVALID_CREDENTIALS', 'La empresa, el usuario o la contraseña no coinciden.');
    final app = await bootApp(tester, api: api, signedIn: false);
    await fillLogin(tester);
    await tester.tap(find.text(l.loginSubmit));
    await settle(tester);
    expect(find.textContaining('no coinciden'), findsOneWidget);
    await tester.tap(find.text('EN'));
    await settle(tester);
    expect(find.text(lookupAppLocalizations(const Locale('en')).loginSubmit), findsOneWidget);
    await app.finish();
  });

  testWidgets('segundo factor: el código se verifica con el desafío y se puede cancelar', (tester) async {
    final api = FakeApi()..overrides['POST /auth/login'] = (_) => FakeApi.json(200, {'mfa_required': true, 'challengeId': 'reto-1'});
    final app = await bootApp(tester, api: api, signedIn: false);
    await fillLogin(tester);
    await tester.tap(find.text(l.loginSubmit));
    await settle(tester);
    expect(find.text(l.mfaTitle), findsOneWidget);
    await tester.tap(find.text(l.mfaVerify));
    await settle(tester);
    await tester.enterText(find.byType(TextField).first, '123456');
    await tester.tap(find.text(l.mfaVerify));
    await settle(tester);
    expect(api.lastBody('POST', '/auth/mfa'), {'challengeId': 'reto-1', 'code': '123456'});
    expect(app.container.read(authProvider), isA<SignedIn>());
    await app.finish();
  });

  testWidgets('segundo factor: cancelar vuelve al ingreso; un código errado muestra el error', (tester) async {
    final api = FakeApi()
      ..overrides['POST /auth/login'] = ((_) => FakeApi.json(200, {'mfa_required': true, 'challengeId': 'reto-1'}))
      ..overrides['POST /auth/mfa'] = (_) => FakeApi.problem(401, 'MFA_INVALID', 'El código no es válido.');
    final app = await bootApp(tester, api: api, signedIn: false);
    await fillLogin(tester);
    await tester.tap(find.text(l.loginSubmit));
    await settle(tester);
    await tester.enterText(find.byType(TextField).first, '000000');
    await tester.tap(find.text(l.mfaVerify));
    await settle(tester);
    expect(find.textContaining('no es válido'), findsOneWidget);
    await tester.tap(find.text(l.actionCancel));
    await settle(tester);
    expect(find.text(l.loginSubmit), findsOneWidget);
    await app.finish();
  });

  testWidgets('activación obligatoria del segundo factor del Propietario: secreto, copia y confirmación', (tester) async {
    final api = FakeApi();
    api.overrides['POST /auth/login'] = (_) => FakeApi.json(200, {...api.session, 'mfaEnrollmentRequired': true});
    api.overrides['POST /me/mfa/enroll'] = (_) => FakeApi.json(200, {'secret': 'JBSWY3DPEHPK3PXP', 'otpauthUri': 'otpauth://totp/COROC:propietario@dast?secret=JBSWY3DPEHPK3PXP&issuer=COROC'});
    final app = await bootApp(tester, api: api, signedIn: false);
    await fillLogin(tester);
    await tester.tap(find.text(l.loginSubmit));
    await settle(tester);
    expect(find.text(l.enrollTitle), findsOneWidget);
    expect(find.byType(SelectableText), findsOneWidget);
    await tester.tap(find.text(l.actionCopy));
    await settle(tester);
    await tester.enterText(find.byType(TextField).last, '654321');
    await tester.tap(find.text(l.enrollConfirm));
    await settle(tester);
    expect(api.lastBody('POST', '/me/mfa/confirm'), {'code': '654321'});
    expect(app.container.read(authProvider), isA<SignedIn>());
    await app.finish();
  });

  testWidgets('recuperación de contraseña: pide empresa y usuario y confirma el envío', (tester) async {
    final app = await bootApp(tester, signedIn: false);
    await tester.tap(find.text(l.loginForgot));
    await settle(tester);
    expect(find.text(l.forgotTitle), findsOneWidget);
    await tester.tap(find.text(l.forgotSubmit));
    await settle(tester);
    final fields = find.byType(TextField);
    await tester.enterText(fields.at(0), 'dast');
    await tester.enterText(fields.at(1), 'propietario');
    await tester.tap(find.text(l.forgotSubmit));
    await settle(tester);
    expect(app.api.lastBody('POST', '/auth/password/forgot'), {'tenant': 'dast', 'username': 'propietario'});
    expect(find.text(l.forgotSent), findsOneWidget);
    await tester.tap(find.text(l.forgotBack));
    await settle(tester);
    expect(find.text(l.loginSubmit), findsOneWidget);
    await app.finish();
  });

  testWidgets('bloqueo por inactividad: oculta los datos y «Cerrar sesión» vuelve al ingreso', (tester) async {
    final app = await bootApp(tester);
    app.container.read(authProvider.notifier).lock();
    await settle(tester);
    expect(find.text(l.lockTitle), findsOneWidget);
    await tester.tap(find.text(l.actionLogout));
    await settle(tester);
    expect(app.container.read(authProvider), isA<SignedOut>());
    expect(app.api.sent('POST', '/auth/logout'), hasLength(1));
    expect(find.text(l.loginSubmit), findsOneWidget);
    await app.finish();
  });

  testWidgets('sesión vencida en el servidor: la app vuelve al ingreso con el aviso', (tester) async {
    final app = await bootApp(tester);
    app.api.overrides['GET /dashboard'] = (_) => FakeApi.problem(401, 'SESSION_EXPIRED');
    app.api.overrides['POST /auth/refresh'] = (_) => FakeApi.problem(401, 'SESSION_EXPIRED');
    await app.go('/today');
    await app.go('/dashboard');
    expect(app.container.read(authProvider), isA<SignedOut>());
    expect(find.text(l.loginSessionExpired), findsOneWidget);
    await app.finish();
  });
}
