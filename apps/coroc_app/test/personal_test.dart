// Fase 11 · El nuevo COROC de Escritorio (ADR-068): primer uso en cuatro pasos, ingreso con la contraseña, Inicio
// como la portada de un banco, clientes y su ficha, nuevo préstamo en una pantalla, comprobantes con un clic, envío
// por WhatsApp uno a la vez y Configuración.
import 'dart:convert';

import 'package:coroc/core/auth/auth_controller.dart';
import 'package:coroc/core/desktop/desktop_platform.dart';
import 'package:coroc/core/format.dart';
import 'package:coroc/core/l10n.dart';
import 'package:coroc/core/models/models.dart';
import 'package:coroc/design/widgets/brand.dart';
import 'package:coroc/personal/pages/new_loan_page.dart' show RateUnit, totalRate;
import 'package:coroc/personal/ui/bank.dart' show SectionHeader;
import 'package:coroc/personal/ui/labels.dart' show whenText;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:intl/date_symbol_data_local.dart';

import 'app_harness.dart';
import 'desktop_fakes.dart';
import 'desktop_receipts_test.dart' show drop, receiptFile;
import 'fake_api.dart';
import 'inbox_test.dart' show intakeVariant;
import 'support.dart';

final l = lookupAppLocalizations(const Locale('es'));

const _statement = 'c0c0a000-0000-4000-8000-000000000011';

/// Los últimos pagos con la forma de `GET /payments/recent`, armados con los datos de los fixtures: el pago en
/// efectivo de María José (con su recibo ya enviado por WhatsApp) y la transferencia que se anuló.
Json recentPayments(FakeApi api) {
  final pay = api.posts['pay'] as Json;
  final entry = pay['entry'] as Json;
  final receipt = pay['receipt'] as Json;
  final base = <String, dynamic>{
    'loanId': api.id('loan'),
    'contract': receipt['contract'],
    'clientId': api.id('client'),
    'clientName': (receipt['client'] as Json)['fullName'],
    'currency': receipt['currency'],
  };
  return {
    'items': [
      {
        ...base,
        'entryId': entry['id'],
        'amount': entry['amount'],
        'date': entry['entryDate'],
        'recordedAt': entry['recordedAt'],
        'channel': 'cash',
        'auto': false,
        'method': entry['method'],
        'receiptNumber': entry['receiptNumber'],
        'receiptDocumentId': api.id('document'),
        'reversed': false,
        'reply': {'channel': 'whatsapp', 'status': 'sent'},
      },
      {
        ...base,
        'entryId': api.id('entry2'),
        'amount': 50000,
        'date': entry['entryDate'],
        'recordedAt': entry['recordedAt'],
        'channel': 'email',
        'auto': true,
        'method': 'Transferencia',
        'receiptNumber': 'RC-000002',
        'receiptDocumentId': null,
        'reversed': true,
        'reply': null,
      },
    ],
  };
}

/// El nuevo COROC completo contra el servidor de prueba, con los movimientos recientes de Inicio.
Future<AppUnderTest> bootPersonal(
  WidgetTester tester, {
  FakeApi? api,
  FakeDesktopPlatform? platform,
  bool configured = true,
  bool signedIn = true,
  MemorySessionStore? store,
  bool tourDone = true,
  Size size = desktop,
  String locale = 'es',
}) {
  final server = api ?? FakeApi();
  server.overrides.putIfAbsent(
    'GET /payments/recent',
    () =>
        (_) => FakeApi.json(200, recentPayments(server)),
  );
  return bootDesktop(tester, api: server, platform: platform, configured: configured, signedIn: signedIn, store: store, tourDone: tourDone, size: size, locale: locale, personal: true);
}

/// Un control dentro del diálogo abierto (el mismo texto puede estar también en la página de atrás).
Finder inDialog(Finder f) => find.descendant(of: find.byType(Dialog), matching: f);

Json jsonBody(http.Request req) => jsonDecode(req.body) as Json;

void main() {
  test('interés por día, semana o mes: la tasa total sobre el capital, exacta', () {
    expect(totalRate('5', RateUnit.perPeriod, 8), '0.4');
    expect(totalRate('2,5', RateUnit.perPeriod, 12), '0.3');
    expect(totalRate('1,5', RateUnit.perPeriod, 30), '0.45');
    expect(totalRate('10', RateUnit.perPeriod, 12), '1.2');
    expect(totalRate('20', RateUnit.total, 10), '0.2');
    expect(totalRate('abc', RateUnit.perPeriod, 4), isNull);
    expect(totalRate('5', RateUnit.perPeriod, 0), isNull);
  });

  test('fecha de un movimiento: hoy, ayer o el día, con la hora de este PC', () async {
    await initializeDateFormatting('es');
    final now = DateTime(2026, 10, 29, 18);
    String at(DateTime d) => whenText(l, d.toUtc().toIso8601String(), 'es', now: now);
    expect(at(DateTime(2026, 10, 29, 9, 5)), '${l.pToday} · 9:05');
    expect(at(DateTime(2026, 10, 28, 22, 40)), '${l.pYesterday} · 22:40');
    expect(at(DateTime(2026, 10, 2, 7, 0)), startsWith('2 oct'));
    expect(whenText(l, 'no es una fecha', 'es'), 'no es una fecha');
  });

  testWidgets('primer uso: su negocio, usted, Gmail (opcional) y WhatsApp; luego Inicio y el recorrido', (tester) async {
    final api = FakeApi();
    api.overrides['GET /company/gmail'] = (_) =>
        FakeApi.json(200, {'connected': false, 'address': null, 'status': null, 'lastError': null, 'lastCheckAt': null, 'sentToday': 0, 'dailyLimit': 400, 'label': 'COROC/Procesado'});
    final platform = FakeDesktopPlatform()..whatsApp = true;
    final app = await bootPersonal(tester, api: api, platform: platform, configured: false, signedIn: false, tourDone: false);
    expect(app.location, '/bienvenida');
    expect(find.text(l.welcomeTitle), findsOneWidget);
    expect(find.text(l.welcomeStepOf(1, 4)), findsOneWidget);
    // La marca y lo que COROC hace, a la izquierda.
    expect(find.text(l.pStageTitle), findsOneWidget);
    expect(find.text(l.pStagePromiseEmail), findsOneWidget);

    // 1 · Su negocio.
    await tapOn(tester, find.text(l.actionContinue));
    expect(find.text(l.pWelcomeBusinessRequired), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, l.pWelcomeBusinessName), 'Inversiones Prado');
    await tapOn(tester, find.textContaining(l.countryBR));
    await tapOn(tester, find.textContaining(l.countryCO));
    await tapOn(tester, find.text(l.actionContinue));

    // 2 · Usted: el usuario sale del nombre y se puede cambiar.
    expect(find.text(l.welcomeStepOf(2, 4)), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, l.welcomeOwnerName), 'Ana María Pérez');
    await settle(tester);
    expect(find.text(l.pWelcomeUserWillBe('ana.perez')), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, l.loginPassword), 'corta');
    await tapOn(tester, find.text(l.pWelcomeCreate));
    expect(find.text(l.welcomePasswordShort), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, l.loginPassword), 'Mi-Clave-Segura-2026');
    await tester.enterText(find.widgetWithText(TextField, l.welcomePasswordAgain), 'Mi-Clave-Segura-2027');
    await tapOn(tester, find.text(l.pWelcomeCreate));
    expect(find.text(l.welcomePasswordMismatch), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, l.welcomePasswordAgain), 'Mi-Clave-Segura-2026');
    await tapOn(tester, find.text(l.pChange));
    await tester.enterText(find.widgetWithText(TextField, l.loginUsername), 'ana');
    await tapOn(tester, find.text(l.pWelcomeCreate));
    final setup = api.lastBody('POST', '/desktop/setup')!;
    expect(setup['company'], {'name': 'Inversiones Prado', 'country': 'CO', 'lang': 'es'});
    expect(setup['owner'], {'name': 'Ana María Pérez', 'username': 'ana', 'password': 'Mi-Clave-Segura-2026'});
    expect(platform.helloReasons, [l.helloReason]);
    expect(app.store.hello, isTrue);
    expect(app.container.read(authProvider), isA<SignedIn>());

    // 3 · Gmail: se puede dejar para después.
    expect(find.text(l.welcomeStepOf(3, 4)), findsOneWidget);
    expect(find.text(l.pWelcomeGmailTitle), findsOneWidget);
    await tapOn(tester, find.text(l.welcomeSkip));

    // 4 · WhatsApp para Windows ya está.
    expect(find.text(l.welcomeStepOf(4, 4)), findsOneWidget);
    expect(find.text(l.welcomeWhatsappReady), findsOneWidget);
    await tapOn(tester, find.text(l.welcomeStart));
    await settle(tester);
    expect(app.location, '/inicio');

    // Primera vez en este PC: el recorrido, una sola vez.
    expect(find.text(l.pTourHomeTitle), findsOneWidget);
    await tapOn(tester, find.text(l.actionContinue));
    expect(find.text(l.pTourLoanTitle), findsOneWidget);
    await tapOn(tester, find.text(l.actionContinue));
    expect(find.text(l.pTourAutoTitle), findsOneWidget);
    await tapOn(tester, find.text(l.actionContinue));
    await tapOn(tester, find.text(l.tourDone));
    expect(find.byType(AlertDialog), findsNothing);
    expect(app.store.tour, isTrue);
    await app.finish();
  });

  testWidgets('primer uso: sin WhatsApp lleva a Microsoft Store; el error de la API se muestra tal cual', (tester) async {
    final api = FakeApi();
    var attempt = 0;
    api.overrides['POST /desktop/setup'] = (_) =>
        attempt++ == 0 ? FakeApi.problem(422, 'PASSWORD_BREACHED', 'Esa contraseña aparece en filtraciones conocidas. Elija otra.') : FakeApi.json(201, api.session);
    final platform = FakeDesktopPlatform()..hello = false;
    final app = await bootPersonal(tester, api: api, platform: platform, configured: false, signedIn: false);
    await tester.enterText(find.widgetWithText(TextField, l.pWelcomeBusinessName), 'Inversiones Prado');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await settle(tester);
    expect(find.text(l.welcomeHello), findsNothing);
    await tester.enterText(find.widgetWithText(TextField, l.welcomeOwnerName), 'Ana Prado');
    await tester.enterText(find.widgetWithText(TextField, l.loginPassword), 'Contraseña-Larga-1');
    await tester.enterText(find.widgetWithText(TextField, l.welcomePasswordAgain), 'Contraseña-Larga-1');
    await tapOn(tester, find.text(l.pWelcomeCreate));
    expect(find.text('Esa contraseña aparece en filtraciones conocidas. Elija otra.'), findsOneWidget);
    expect(platform.helloReasons, isEmpty);
    await tapOn(tester, find.text(l.pWelcomeCreate));
    expect(app.store.hello, isFalse);
    await tapOn(tester, find.text(l.welcomeSkip));
    expect(find.text(l.welcomeWhatsappMissing), findsOneWidget);
    await tapOn(tester, find.text(l.welcomeWhatsappStore));
    expect(platform.opened.last, startsWith('ms-windows-store://'));
    platform.whatsApp = true;
    await tapOn(tester, find.text(l.welcomeWhatsappCheck));
    expect(find.text(l.welcomeWhatsappReady), findsOneWidget);
    await app.finish();
  });

  testWidgets('primer uso: restaurar la copia de otro PC desde el primer paso', (tester) async {
    final api = FakeApi();
    final app = await bootPersonal(tester, api: api, configured: false, signedIn: false);
    await tapOn(tester, find.text(l.welcomeRestoreLink));
    expect(find.text(l.welcomeRestoreTitle), findsOneWidget);
    expect(find.text(l.welcomeRestorePick), findsOneWidget);
    await tapOn(tester, find.text(l.actionBack));
    expect(find.text(l.welcomeTitle), findsOneWidget);
    await app.finish();
  });

  testWidgets('ingreso: el negocio y el usuario de este PC; solo se escribe la contraseña', (tester) async {
    final api = FakeApi();
    final store = MemorySessionStore(savedLocale: 'es')
      ..tenant = 'inversiones-prado'
      ..username = 'propietario'
      ..remember = true;
    final app = await bootPersonal(tester, api: api, signedIn: false, store: store);
    expect(app.location, '/ingresar');
    expect(find.text(l.pLoginTitle), findsOneWidget);
    expect(find.text('Inversiones Prado'), findsOneWidget);
    expect(find.text('propietario'), findsOneWidget);
    expect(find.widgetWithText(TextField, l.loginUsername), findsNothing);

    await tapOn(tester, find.text(l.loginSubmit));
    expect(find.text(l.pLoginMissing), findsOneWidget);
    expect(api.sent('POST', '/auth/login'), isEmpty);

    // ¿No es usted? Aparece el campo del usuario.
    await tapOn(tester, find.text(l.pLoginNotYou));
    expect(find.widgetWithText(TextField, l.loginUsername), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, l.loginUsername), 'propietario');
    await tester.enterText(find.widgetWithText(TextField, l.loginPassword), 'Escaneo-Dinamico-2026');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await settle(tester);
    final body = api.lastBody('POST', '/auth/login')!;
    expect(body, containsPair('tenant', 'inversiones-prado'));
    expect(body, containsPair('username', 'propietario'));
    expect(app.store.remember, isTrue);
    await settle(tester);
    expect(app.location, '/inicio');
    await app.finish();
  });

  testWidgets('ingreso: «¿Olvidó su contraseña?» con Windows Hello y vuelta al ingreso', (tester) async {
    final app = await bootPersonal(tester, signedIn: false);
    await tapOn(tester, find.text(l.loginForgot));
    expect(app.location, '/ingresar/olvido');
    expect(find.text(l.desktopResetSubtitle), findsOneWidget);
    await tapOn(tester, find.text(l.forgotBack));
    expect(app.location, '/ingresar');
    await app.finish();
  });

  testWidgets('Inicio: el saldo por cobrar, lo de hoy, lo que espera, los movimientos y los cobros del día', (tester) async {
    final api = FakeApi();
    final d = Dashboard.fromJson(api.get('/dashboard'));
    final app = await bootPersonal(tester, api: api);
    expect(app.location, '/inicio');
    expect(find.textContaining(', Propietario'), findsOneWidget);
    expect(find.text(l.pHomeReceivable.toUpperCase()), findsOneWidget);
    expect(find.text(Money.format(d.totalReceivable, d.currency)), findsOneWidget);
    expect(find.text('${l.pHomeActiveClients(2)} · ${l.pHomeLent(Money.format(d.totalLent, d.currency))}'), findsOneWidget);
    expect(find.text(Money.format(d.overdueTotal, d.currency)), findsOneWidget);
    expect(find.text(l.pHomeTodayProgress(0)), findsOneWidget);

    // Nada por enviar ni por revisar: lo dice en palabras.
    expect(find.text(l.pHomeToSendIdle), findsOneWidget);
    expect(find.text(l.pHomeReviewIdle), findsOneWidget);

    // El extracto: el recibo ya salió por WhatsApp; la transferencia anulada se ve tachada.
    expect(api.sent('GET', '/payments/recent').single.url.queryParameters, containsPair('limit', '12'));
    expect(find.text('${l.pMoveReceipt('RC-000001')} · ${l.pChannelCash}'), findsOneWidget);
    expect(find.text(l.pReplySentWhatsapp), findsOneWidget);
    expect(find.text('${l.pMoveReceipt('RC-000002')} · ${l.channelEmail} · ${l.pMoveAuto}'), findsOneWidget);
    expect(find.text(l.pMoveReversed), findsOneWidget);

    // Los cobros de hoy, con los días de atraso.
    expect(find.text(l.pHomeDueList), findsOneWidget);
    expect(find.text(l.pDaysLate(15)), findsOneWidget);
    expect(find.text(l.pDaysLate(8)), findsOneWidget);

    // Un pago en vivo: aviso discreto y todo se vuelve a leer.
    final before = api.sent('GET', '/payments/recent').length;
    api.emit('payment.posted', {'clientName': 'María José Pérez Gómez', 'amount': 60000, 'clientId': api.id('client')});
    await settle(tester);
    expect(find.text(l.realtimePayment('María José Pérez Gómez', Money.format(60000, 'USD'))), findsOneWidget);
    expect(api.sent('GET', '/payments/recent').length, greaterThan(before));

    // Un toque en el movimiento lleva a la ficha del cliente.
    await tapOn(tester, find.text('${l.pMoveReceipt('RC-000001')} · ${l.pChannelCash}'));
    expect(app.location, '/clientes/${api.id('client')}');
    await app.finish();
  });

  testWidgets('Inicio sin préstamos todavía: un solo botón para el primero', (tester) async {
    final api = FakeApi();
    api.overrides['GET /dashboard'] = (_) => FakeApi.json(200, {...api.get('/dashboard'), 'totalLentHistoric': 0, 'totalLent': 0, 'totalReceivable': 0, 'clientsActive': 0});
    final app = await bootPersonal(tester, api: api);
    expect(find.text(l.pHomeStartTitle.toUpperCase()), findsOneWidget);
    await tapOn(tester, find.text(l.pHomeStartAction));
    expect(app.location, '/prestamo');
    await app.finish();
  });

  testWidgets('Inicio: mensajes por enviar y comprobantes por revisar llevan a su sección; el menú muestra cuántos', (tester) async {
    final api = FakeApi();
    api.overrides['GET /messages/summary'] = (_) => FakeApi.json(200, {'ready': 3, 'scheduled': 0, 'blocked': 0, 'failed': 0, 'sentToday': 0});
    api.overrides['GET /intake/summary'] = (_) => FakeApi.json(200, {'review': 2, 'unassigned': 1, 'processing': 0, 'revertible': 0, 'pending': 3});
    api.overrides['GET /messages'] = (_) => FakeApi.json(200, {'items': <Json>[], 'nextCursor': null});
    api.overrides['GET /intake'] = (_) => FakeApi.json(200, {'items': <Json>[], 'nextCursor': null});
    final app = await bootPersonal(tester, api: api);
    expect(find.text(l.pHomeToSendBody(3)), findsOneWidget);
    expect(find.text(l.pHomeReviewBody(3)), findsOneWidget);
    expect(find.text('3'), findsWidgets);
    await tapOn(tester, find.text(l.pHomeToSendAction));
    expect(app.location, '/enviar');
    await app.go('/inicio');
    await tapOn(tester, find.text(l.pHomeReviewAction));
    expect(app.location, '/comprobantes');
    await app.finish();
  });

  testWidgets('Clientes: buscar, filtrar y abrir la ficha con sus cifras, cuotas y pagos', (tester) async {
    final api = FakeApi();
    final app = await bootPersonal(tester, api: api);
    await tapOn(tester, find.text(l.navClients).first);
    expect(app.location, '/clientes');
    expect(find.text('María José Pérez Gómez'), findsOneWidget);
    expect(find.text('Pedro Luis Ramírez Ortiz'), findsOneWidget);

    await tester.enterText(find.widgetWithText(TextField, l.pClientsSearch), 'Pedro');
    await tester.pump(const Duration(milliseconds: 500));
    await settle(tester);
    expect(api.sent('GET', '/clients').last.url.queryParameters, containsPair('q', 'Pedro'));
    await tapOn(tester, find.byTooltip(l.pClear));
    await tapOn(tester, find.widgetWithText(ChoiceChip, l.pFilterOverdue));
    expect(api.sent('GET', '/clients').last.url.queryParameters, containsPair('status', 'overdue'));
    await tapOn(tester, find.widgetWithText(ChoiceChip, l.pFilterAll));

    await tapOn(tester, find.text('María José Pérez Gómez'));
    expect(app.location, '/clientes/${api.id('client')}');
    final c = Client.fromJson(api.get('/clients/${api.id('client')}'));
    final loan = c.loans.last;
    expect(find.text(c.fullName), findsWidgets);
    expect(find.text(l.pClientBalance), findsOneWidget);
    expect(find.text(l.pLoanTitle(loan.contract)), findsOneWidget);
    expect(find.text(l.pInstallmentsPaid(loan.summary.paidInstallments, loan.summary.totalInstallments)), findsOneWidget);
    expect(find.textContaining(l.pTermsWeekly(loan.terms.installments)), findsOneWidget);

    await tapOn(tester, find.widgetWithText(ChoiceChip, l.pShowInstallments));
    expect(api.sent('GET', '/loans/{id}/schedule'), isNotEmpty);
    await tapOn(tester, find.widgetWithText(ChoiceChip, l.pShowPayments));
    expect(api.sent('GET', '/loans/{id}/receipts'), isNotEmpty);
    expect(find.textContaining('RC-000001'), findsWidgets);

    // «Nuevo préstamo» desde la ficha lleva el cliente ya elegido.
    await tapOn(tester, find.descendant(of: find.byType(SectionHeader), matching: find.text(l.pNewLoanForClient)));
    expect(app.location, '/prestamo?cliente=${c.id}');
    expect(find.text(c.fullName), findsOneWidget);
    await app.finish();
  });

  testWidgets('ficha: enviar el estado de cuenta por WhatsApp con el PDF copiado, o por correo', (tester) async {
    final api = FakeApi();
    final platform = FakeDesktopPlatform();
    final ready = {...readyWhatsApp(api, id: _statement, event: 'statement', attachment: api.id('document'), body: 'Hola María José, le enviamos su estado de cuenta.')};
    api.overrides['POST /messages'] = (req) {
      final body = jsonBody(req);
      if (body['channel'] == 'email') return FakeApi.json(201, {...ready, 'channel': 'email', 'status': 'scheduled'});
      return FakeApi.json(201, {...ready, 'status': 'scheduled'});
    };
    api.overrides['GET /messages'] = (req) => FakeApi.json(200, {
      'items': req.url.queryParameters['event'] == 'statement' ? [ready] : <Json>[],
      'nextCursor': null,
    });
    api.overrides['POST /messages/{id}/send'] = (_) => FakeApi.json(200, sentAssisted(ready));
    final app = await bootPersonal(tester, api: api, platform: platform);
    await app.go('/clientes/${api.id('client')}');

    await tapOn(tester, find.text(l.pSendStatement));
    expect(find.text(l.pStatementHow), findsOneWidget);
    expect(find.text(l.pStatementEmailHelp('maria.perez@example.com')), findsOneWidget);
    await tapOn(tester, inDialog(find.text(l.channelWhatsapp)));
    expect(api.lastBody('POST', '/messages'), {'loanId': api.id('loan'), 'event': 'statement', 'channel': 'whatsapp'});
    expect(platform.copied.single.name, endsWith('.pdf'));
    expect(platform.opened.single, startsWith('whatsapp://send?phone=573157778899'));
    expect(find.text(l.todayMessagesPasteHint), findsOneWidget);

    await tapOn(tester, find.text(l.pSendStatement));
    await tapOn(tester, inDialog(find.text(l.channelEmail)));
    expect(api.lastBody('POST', '/messages'), containsPair('channel', 'email'));
    expect(find.text(l.pStatementEmailSent), findsOneWidget);
    expect(platform.opened, hasLength(1));
    await app.finish();
  });

  testWidgets('ficha: registrar un pago en efectivo y ofrecer el recibo por WhatsApp', (tester) async {
    final api = FakeApi();
    api.overrides['GET /messages'] = (_) => FakeApi.json(200, {'items': <Json>[], 'nextCursor': null});
    final app = await bootPersonal(tester, api: api);
    await app.go('/clientes/${api.id('client')}');
    await tapOn(tester, find.text(l.pRegisterPayment));
    expect(find.text(l.paymentConfirm), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, l.paymentAmount), '600');
    await settle(tester);
    await tapOn(tester, find.text(l.paymentConfirm));
    expect(api.lastBody('POST', '/loans/{id}/payments'), containsPair('amount', 60000));
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
    await settle(tester);
    await tapOn(tester, find.text(l.actionDone));
    expect(find.text(l.receiptPromptTitle('RC-000001')), findsOneWidget);
    await tapOn(tester, find.text(l.receiptPromptLater));
    expect(find.byType(AlertDialog), findsNothing);
    await app.finish();
  });

  testWidgets('nuevo préstamo: cliente nuevo con su autorización, 5 % por semana y la vista previa en vivo', (tester) async {
    final api = FakeApi();
    final app = await bootPersonal(tester, api: api);
    await tapOn(tester, find.text(l.pNavNewLoan).first);
    expect(app.location, '/prestamo');
    expect(find.text(l.pPreviewEmpty), findsOneWidget);

    await tester.enterText(find.widgetWithText(TextField, l.fieldFirstName), 'Lucía');
    await tester.enterText(find.widgetWithText(TextField, l.fieldLastName), 'Gómez Arango');
    await tester.enterText(find.widgetWithText(TextField, l.fieldIdDoc), '43123456');
    await tester.enterText(find.widgetWithText(TextField, l.fieldPhone), '3001234567');
    await tester.enterText(find.widgetWithText(TextField, l.pEmailOptional), 'lucia@example.com');
    await tester.enterText(find.widgetWithText(TextField, l.pAmountLent), '1000');
    await tester.enterText(find.widgetWithText(TextField, l.pInterestRate), '5');
    await tester.enterText(find.widgetWithText(TextField, l.fieldInstallments), '8');
    await tester.pump(const Duration(milliseconds: 400));
    await settle(tester);
    final preview = api.lastBody('POST', '/loans/preview')!;
    expect(preview, containsPair('rate', '0.4'));
    expect(preview, containsPair('installments', 8));
    expect(preview, containsPair('frequency', 'weekly'));
    expect(preview, containsPair('principal', 100000));
    final p = LoanPreview.fromJson(api.posts['previewLoan'] as Json);
    expect(find.text(Money.format(p.regularInstallment, 'USD')), findsOneWidget);
    expect(find.text(l.pEveryWeek), findsWidgets);

    // Sin la autorización del cliente no se puede guardar.
    final create = find.widgetWithText(GoldButton, l.pCreateLoan);
    expect(tester.widget<GoldButton>(create).onPressed, isNull);
    await tapOn(tester, find.text(l.pAuthorization));
    expect(tester.widget<GoldButton>(create).onPressed, isNotNull);

    // El interés en total también sirve.
    await tapOn(tester, find.text(l.pPerWeek).last);
    await tapOn(tester, find.text(l.pRateTotal).last);
    await tester.pump(const Duration(milliseconds: 400));
    await settle(tester);
    expect(api.lastBody('POST', '/loans/preview'), containsPair('rate', '0.05'));

    await tapOn(tester, create);
    final body = api.lastBody('POST', '/clients')!;
    final client = body['client'] as Json;
    expect(client['firstName'], 'Lucía');
    expect(client['idDocType'], 'ID');
    expect(client['idDocNumber'], '43123456');
    expect(client['email'], 'lucia@example.com');
    expect((client['consents'] as List).map((c) => (c as Json)['channel']), ['personal_data', 'whatsapp', 'email']);
    expect((body['loan'] as Json)['rate'], '0.05');
    final created = api.posts['createClient'] as Json;
    expect(app.location, '/clientes/${(created['client'] as Json)['id']}');
    expect(find.text(l.pLoanCreated((created['loan'] as Json)['contract'] as String, (created['client'] as Json)['fullName'] as String)), findsOneWidget);
    await app.finish();
  });

  testWidgets('nuevo préstamo para un cliente que ya está: se busca, se elige y se presta cada mes', (tester) async {
    final api = FakeApi();
    final app = await bootPersonal(tester, api: api);
    await app.go('/prestamo');
    await tapOn(tester, find.text(l.pClientExisting));
    await tapOn(tester, find.text('Pedro Luis Ramírez Ortiz'));
    expect(find.text(l.pChange), findsOneWidget);
    await tapOn(tester, find.text(l.pEveryMonth));
    await tester.enterText(find.widgetWithText(TextField, l.pAmountLent), '500');
    await tester.enterText(find.widgetWithText(TextField, l.pInterestRate), '10');
    await tester.enterText(find.widgetWithText(TextField, l.fieldInstallments), '12');
    await tester.pump(const Duration(milliseconds: 400));
    await settle(tester);
    expect(api.lastBody('POST', '/loans/preview'), containsPair('rate', '1.2'));
    await tapOn(tester, find.widgetWithText(GoldButton, l.pCreateLoan));
    final body = api.lastBody('POST', '/clients/{id}/loans')!;
    expect(body, containsPair('frequency', 'monthly'));
    expect(body, containsPair('installments', 12));
    expect(api.sent('POST', '/clients/{id}/loans').single.url.path, contains(api.id('client2')));
    expect(app.location, '/clientes/${api.id('client2')}');
    await app.finish();
  });

  testWidgets('comprobantes: registrar con un clic lo que COROC ya leyó, descartar lo que no es un pago y deshacer', (tester) async {
    final api = FakeApi();
    final quick = intakeVariant(api, flags: const []);
    final unknown = intakeVariant(api, id: 'a1b2c3d4-0000-4000-8000-000000000002', senderPhone: '+573001112233');
    final applied = intakeVariant(api, id: 'a1b2c3d4-0000-4000-8000-000000000003', status: 'applied_auto', extra: {'receiptNumber': 'RC-000007', 'revertibleUntil': '2099-01-01T00:00:00.000Z'});
    final pending = [quick, unknown];
    api.overrides['GET /intake'] = (req) {
      final status = req.url.queryParametersAll['status'] ?? req.url.queryParameters['status']?.split(',') ?? const <String>[];
      return FakeApi.json(200, {
        'items': status.contains('applied_auto') ? [applied] : pending,
        'nextCursor': null,
      });
    };
    api.overrides['GET /messages'] = (_) => FakeApi.json(200, {'items': <Json>[], 'nextCursor': null});
    api.overrides['POST /intake/{id}/approve'] = (req) {
      pending.remove(quick);
      return FakeApi.json(201, api.posts['pay']);
    };
    api.overrides['POST /intake/{id}/reject'] = (req) {
      pending.removeWhere((x) => req.url.path.contains(x['id'] as String));
      return FakeApi.json(200, {...unknown, 'status': 'rejected'});
    };
    final app = await bootPersonal(tester, api: api);
    await tapOn(tester, find.text(l.pNavReceipts).first);
    expect(app.location, '/comprobantes');
    expect(find.text(l.pDropTitle), findsOneWidget);
    expect(find.text(l.pReviewTitle(2)), findsOneWidget);
    expect(find.text(l.pLooksLike('María José Pérez Gómez')), findsOneWidget);
    expect(find.text(l.pWhoPaidUnknown), findsOneWidget);

    // 1 · Lo leyó todo y sabe de quién es: un clic.
    await tapOn(tester, find.text(l.pRegisterThisPayment));
    final approve = api.lastBody('POST', '/intake/{id}/approve')!;
    expect(approve, containsPair('clientId', api.id('client')));
    expect(approve, containsPair('amount', 150000));
    expect(find.text(l.receiptPromptTitle('RC-000001')), findsOneWidget);
    await tapOn(tester, find.text(l.receiptPromptLater));

    // 2 · No es un pago.
    await tapOn(tester, find.text(l.pNotAPayment).last);
    await tapOn(tester, inDialog(find.text(l.pNotAPayment)));
    expect(api.lastBody('POST', '/intake/{id}/reject'), containsPair('reason', l.pNotAPaymentReason));

    // 3 · Lo que registró solo se puede deshacer.
    expect(find.text(l.pAutoTitle), findsOneWidget);
    await tapOn(tester, find.text(l.pUndo).first);
    await tapOn(tester, inDialog(find.text(l.pUndo)));
    expect(api.sent('POST', '/intake/{id}/revert'), hasLength(1));
    await app.finish();
  });

  testWidgets('enviar: uno a la vez por WhatsApp; al volver a COROC pasa al siguiente', (tester) async {
    final api = FakeApi();
    final items = [
      readyWhatsApp(api, id: 'c0c0a000-0000-4000-8000-000000000021', event: 'receipt', attachment: api.id('document'), body: 'Recibimos su pago. Le enviamos el recibo.'),
      readyWhatsApp(api, id: 'c0c0a000-0000-4000-8000-000000000022'),
    ];
    final pending = [...items];
    api.overrides['GET /messages'] = (req) => FakeApi.json(200, {'items': req.url.queryParameters['status'] == 'ready' ? pending : <Json>[], 'nextCursor': null});
    api.overrides['POST /messages/{id}/send'] = (req) {
      final m = items.firstWhere((x) => req.url.path.contains(x['id'] as String));
      pending.remove(m);
      return FakeApi.json(200, sentAssisted(m));
    };
    final platform = FakeDesktopPlatform();
    final app = await bootPersonal(tester, api: api, platform: platform);
    await app.go('/enviar');
    expect(find.text(l.todayMessagesPosition(1, 2)), findsOneWidget);
    expect(find.text(l.pWithPdf), findsOneWidget);
    await tapOn(tester, find.text(l.todayMessagesSendWhatsapp));
    expect(platform.copied.single.name, endsWith('.pdf'));
    expect(find.text(l.todayMessagesPasteHint), findsOneWidget);
    platform.signal(WindowSignalKind.focused);
    await settle(tester);
    expect(find.text(l.todayMessagesPosition(2, 2)), findsOneWidget);
    expect(find.text(l.todayMessagesSentN(1)), findsOneWidget);
    await tapOn(tester, find.text(l.todayMessagesSkip));
    expect(find.text(l.todayMessagesDone), findsOneWidget);
    await tapOn(tester, find.text(l.todayMessagesReload));
    expect(find.text(l.todayMessagesPosition(1, 1)), findsOneWidget);
    await app.finish();
  });

  testWidgets('Configuración: el nombre del negocio, Gmail, copias, tasas, seguridad, este PC y la letra', (tester) async {
    final api = FakeApi();
    api.overrides['GET /company/gmail'] = (_) =>
        FakeApi.json(200, {'connected': false, 'address': null, 'status': null, 'lastError': null, 'lastCheckAt': null, 'sentToday': 0, 'dailyLimit': 400, 'label': 'COROC/Procesado'});
    final app = await bootPersonal(tester, api: api);
    await tapOn(tester, find.text(l.navSettings).first);
    expect(app.location, '/configuracion');
    expect(find.text(l.pBusinessTitle), findsOneWidget);
    expect(find.text(l.pYourUser('propietario')), findsOneWidget);

    await tapOn(tester, find.text(l.pChange));
    await tester.enterText(inDialog(find.byType(TextField)), 'Inversiones Prado');
    await tapOn(tester, inDialog(find.text(l.actionSave)));
    expect(api.lastBody('PATCH', '/company'), {'name': 'Inversiones Prado'});

    await tapOn(tester, find.text(l.textSizeLarge));
    expect(app.store.scale, 1.15);
    await tapOn(tester, find.text(l.pLockNow).last);
    final auth = app.container.read(authProvider);
    expect(auth is SignedIn && auth.locked, isTrue);
    await app.finish();
  });

  testWidgets('menú lateral: las cinco secciones, la Ayuda y bloquear', (tester) async {
    final app = await bootPersonal(tester);
    for (final (label, route) in [(l.navClients, '/clientes'), (l.pNavNewLoan, '/prestamo'), (l.pNavReceipts, '/comprobantes'), (l.navSettings, '/configuracion'), (l.navDashboard, '/inicio')]) {
      await tapOn(tester, find.text(label).first);
      expect(app.location, route, reason: label);
    }
    await tapOn(tester, find.text(l.navHelp).first);
    expect(app.location, '/ayuda');
    await tapOn(tester, find.byTooltip(l.pLockNow));
    final auth = app.container.read(authProvider);
    expect(auth is SignedIn && auth.locked, isTrue);
    await app.finish();
  });

  testWidgets('ventana angosta: el menú queda en íconos y el contenido no se desborda', (tester) async {
    final app = await bootPersonal(tester, size: const Size(1000, 800));
    expect(find.text(l.navClients), findsNothing);
    await app.go('/clientes/${app.api.id('client')}');
    await app.go('/prestamo');
    await app.go('/comprobantes');
    await app.go('/configuracion');
    expect(tester.takeException(), isNull);
    await app.finish();
  });

  testWidgets('soltar un comprobante en la ventana lo lleva a Comprobantes', (tester) async {
    final api = FakeApi();
    final app = await bootPersonal(tester, api: api);
    await drop(tester, receiptFile('comprobante-lucia.jpg'));
    expect(api.sent('POST', '/intake'), hasLength(1));
    expect(app.location, startsWith('/comprobantes?id='));
    await app.finish();
  });
}
