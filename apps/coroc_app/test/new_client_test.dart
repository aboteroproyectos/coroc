import 'dart:convert';

import 'package:coroc/app.dart';
import 'package:coroc/core/l10n.dart';
import 'package:coroc/design/widgets/brand.dart';
import 'package:coroc/design/widgets/labels.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import 'app_harness.dart';
import 'fake_api.dart';

final l = lookupAppLocalizations(const Locale('es'));

String location(AppUnderTest app) => app.container.read(routerProvider).routerDelegate.currentConfiguration.uri.path;

Future<void> fillClient(WidgetTester tester) async {
  await tester.enterText(find.widgetWithText(TextFormField, '${l.fieldFirstName} *'), 'Laura');
  await tester.enterText(find.widgetWithText(TextFormField, '${l.fieldLastName} *'), 'Gómez Ríos');
  await tester.enterText(find.widgetWithText(TextFormField, '${l.fieldPhone} *'), '3001234567');
  await tester.enterText(find.widgetWithText(TextFormField, l.fieldEmail).first, 'laura@example.com');
  await tester.enterText(find.widgetWithText(TextFormField, l.fieldIdDoc), '43123456');
}

Future<void> fillTerms(WidgetTester tester, {String principal = '1000', String installments = '10', String rate = '20'}) async {
  await tester.enterText(find.widgetWithText(TextField, '${l.fieldPrincipal} *'), principal);
  await tester.enterText(find.widgetWithText(TextField, '${l.fieldInstallments} *'), installments);
  await tester.enterText(find.widgetWithText(TextField, '${l.fieldRate} *'), rate);
  await settle(tester, frames: 6);
}

void main() {
  testWidgets('nuevo cliente: tres pasos con validación, condiciones con vista previa y autorizaciones', (tester) async {
    final app = await bootApp(tester);
    final api = app.api;
    await app.go('/clients/new');
    await tapOn(tester, find.widgetWithText(GoldButton, l.actionNext));
    expect(find.text(l.validationRequired), findsWidgets);

    await fillClient(tester);
    await tapOn(tester, find.text(languageName(l, 'en')));
    await tapOn(tester, find.text(l.coDebtor));
    await tester.enterText(find.widgetWithText(TextFormField, l.fieldName), 'Jorge Gómez');
    await pickCollector(tester, 'Carlos Cobrador');
    await tapOn(tester, find.widgetWithText(GoldButton, l.actionNext));
    expect(find.text(l.wizardStepLoan), findsWidgets);

    await fillTerms(tester);
    expect(api.lastBody('POST', '/loans/preview'), allOf(containsPair('principal', 100000), containsPair('rate', '0.2'), containsPair('installments', 10)));
    expect(find.text(l.capMissingOptional), findsOneWidget);
    await tapOn(tester, find.text(l.methodFrench));
    await tapOn(tester, find.text(l.freqMonthly));
    await tester.enterText(find.widgetWithText(TextField, l.fieldMonthlyDay), '15');
    await settle(tester, frames: 6);
    expect(api.lastBody('POST', '/loans/preview'), allOf(containsPair('method', 'french'), containsPair('frequency', 'monthly'), containsPair('monthlyDay', 15)));
    await tapOn(tester, find.text(l.freqDaily));
    await tapOn(tester, find.widgetWithText(FilterChip, weekdayShort(l)[6]));
    await tapOn(tester, find.text(l.fieldExcludeHolidays));
    await tapOn(tester, find.byIcon(Icons.event_repeat));
    final ctx = tester.element(find.byType(DatePickerDialog));
    await tapOn(tester, find.text(MaterialLocalizations.of(ctx).okButtonLabel));
    await tapOn(tester, find.byTooltip(l.automatic));
    await tester.enterText(find.widgetWithText(TextField, l.fieldContract), 'CT-LAURA-1');
    await settle(tester, frames: 6);
    final showAll = find.textContaining(l.previewShowAll(10).split('10').first);
    if (showAll.evaluate().isNotEmpty) await tapOn(tester, showAll.first);
    final terms = api.lastBody('POST', '/loans/preview')!;
    expect(terms, allOf(containsPair('frequency', 'daily'), containsPair('excludeHolidays', false)));
    expect(terms['collectionDays'], [1, 2, 3, 4, 5, 6, 7]);

    await tapOn(tester, find.widgetWithText(GoldButton, l.actionNext));
    expect(find.text(l.wizardSummary), findsOneWidget);
    final create = find.widgetWithText(GoldButton, l.newClientCreate);
    expect(tester.widget<GoldButton>(create).onPressed, isNull);
    await tapOn(tester, find.text('${l.consentPersonalData} *'));
    await tapOn(tester, find.text(l.consentWhatsapp));
    await tapOn(tester, find.text(l.consentEmail));
    await tapOn(tester, find.text(l.consentMethodVerbal));
    await tapOn(tester, create);

    final body = api.lastBody('POST', '/clients')!;
    final client = body['client'] as Json;
    expect(client, allOf(containsPair('firstName', 'Laura'), containsPair('lang', 'en'), containsPair('collectorId', api.id('collector'))));
    expect((client['consents'] as List).map((c) => (c as Json)['channel']), ['personal_data', 'whatsapp', 'email']);
    expect((client['consents'] as List).map((c) => (c as Json)['method']).toSet(), {'verbal'});
    expect(body['loan'], allOf(containsPair('contract', 'CT-LAURA-1'), containsPair('method', 'french')));
    expect(location(app), '/clients/${api.id('client')}');
    await app.finish();
  });

  testWidgets('nuevo cliente: posible duplicado se confirma; un error del préstamo vuelve al paso 2', (tester) async {
    final api = FakeApi();
    var attempts = 0;
    api.overrides['POST /clients'] = (req) => switch (++attempts) {
          1 => FakeApi.json(409, {'type': 'about:blank', 'status': 409, 'code': 'DUPLICATE_CLIENT', 'title': 'Posible cliente repetido', 'detail': 'Ya existe un cliente con ese teléfono.'}),
          2 => FakeApi.json(422, {'type': 'about:blank', 'status': 422, 'code': 'RATE_CAP_EXCEEDED', 'title': 'Tasa por encima del tope', 'detail': 'La tasa supera el tope legal.'}),
          _ => FakeApi.json(201, api.posts['createClient']),
        };
    final app = await bootApp(tester, api: api);
    await app.go('/clients/new');
    await fillClient(tester);
    await tapOn(tester, find.widgetWithText(GoldButton, l.actionNext));
    await fillTerms(tester);
    await tapOn(tester, find.widgetWithText(GoldButton, l.actionNext));
    await tapOn(tester, find.text('${l.consentPersonalData} *'));
    await tapOn(tester, find.widgetWithText(GoldButton, l.newClientCreate));
    expect(find.text('Ya existe un cliente con ese teléfono.'), findsOneWidget);
    await tapOn(tester, find.text(l.duplicateCreateAnyway));
    expect(api.sent('POST', '/clients'), hasLength(2));
    expect(find.textContaining('La tasa supera el tope legal.'), findsOneWidget);
    expect(find.text(l.wizardStepLoan), findsWidgets);

    await tapOn(tester, find.widgetWithText(OutlinedButton, l.actionBack));
    expect(find.text(l.wizardStepClient), findsWidgets);
    await app.finish();
  });

  testWidgets('nuevo cliente: la tasa sobre el tope ofrece la máxima y cancelar pide confirmación', (tester) async {
    final api = FakeApi();
    api.overrides['POST /loans/preview'] = (req) {
      final p = {...api.posts['previewLoan'] as Json};
      final over = (jsonBody(req)['rate'] as String) == '0.3';
      p['rateCap'] = over
          ? {'ok': false, 'effectiveAnnual': 0.8, 'cap': 0.25, 'missing': false, 'maxRate': '0.0187'}
          : {'ok': true, 'effectiveAnnual': 0.24, 'cap': 0.25, 'missing': false};
      return FakeApi.json(200, p);
    };
    final app = await bootApp(tester, api: api);
    await app.go('/clients/new');
    await fillClient(tester);
    await tapOn(tester, find.widgetWithText(GoldButton, l.actionNext));
    await fillTerms(tester, rate: '30');
    final next = find.widgetWithText(GoldButton, l.actionNext);
    expect(tester.widget<GoldButton>(next).onPressed, isNull);
    await tapOn(tester, find.text(l.capUseMax('1,87')));
    await settle(tester, frames: 6);
    expect(api.lastBody('POST', '/loans/preview'), containsPair('rate', '0.0187'));

    await tapOn(tester, find.text(l.actionCancel));
    await tapOn(tester, find.text(l.actionKeepEditing));
    expect(location(app), '/clients/new');
    await tapOn(tester, find.text(l.actionCancel));
    await tapOn(tester, find.text(l.actionDiscard));
    expect(location(app), '/clients');
    await app.finish();
  });

  testWidgets('nuevo cliente por encima del tope: si la empresa lo permite, se confirma el préstamo y se envía la confirmación', (tester) async {
    final api = FakeApi();
    api.overrides['POST /loans/preview'] = (req) => FakeApi.json(200, {
          ...api.posts['previewLoan'] as Json,
          'rateCap': {'ok': false, 'effectiveAnnual': 4.89, 'cap': 0.2493, 'missing': false, 'maxRate': '0.0187', 'overridable': true},
        });
    final app = await bootApp(tester, api: api);
    await app.go('/clients/new');
    await fillClient(tester);
    await tapOn(tester, find.widgetWithText(GoldButton, l.actionNext));
    await fillTerms(tester);
    final next = find.widgetWithText(GoldButton, l.actionNext);
    expect(tester.widget<GoldButton>(next).onPressed, isNull);
    await tapOn(tester, find.text(l.capOverrideAck));
    expect(tester.widget<GoldButton>(next).onPressed, isNotNull);
    // Cambiar las condiciones anula la confirmación anterior.
    await tester.enterText(find.widgetWithText(TextField, '${l.fieldInstallments} *'), '12');
    await settle(tester, frames: 6);
    expect(tester.widget<GoldButton>(next).onPressed, isNull);
    await tapOn(tester, find.text(l.capOverrideAck));
    await tapOn(tester, next);
    await tapOn(tester, find.text('${l.consentPersonalData} *'));
    await tapOn(tester, find.widgetWithText(GoldButton, l.newClientCreate));
    expect(api.lastBody('POST', '/clients')!['loan'], containsPair('acknowledgeRateCap', true));
    await app.finish();
  });

  testWidgets('nuevo cliente por encima del tope sin permiso de la empresa: no se puede continuar', (tester) async {
    final api = FakeApi();
    api.overrides['POST /loans/preview'] = (req) => FakeApi.json(200, {
          ...api.posts['previewLoan'] as Json,
          'rateCap': {'ok': false, 'effectiveAnnual': 4.89, 'cap': 0.2493, 'missing': false, 'overridable': false},
        });
    final app = await bootApp(tester, api: api);
    await app.go('/clients/new');
    await fillClient(tester);
    await tapOn(tester, find.widgetWithText(GoldButton, l.actionNext));
    await fillTerms(tester);
    expect(find.text(l.capOverrideAck), findsNothing);
    expect(tester.widget<GoldButton>(find.widgetWithText(GoldButton, l.actionNext)).onPressed, isNull);
    await app.finish();
  });

  testWidgets('nuevo préstamo para un cliente existente: vista previa, error del servidor y creación', (tester) async {
    final api = FakeApi();
    var attempts = 0;
    api.overrides['POST /clients/{id}/loans'] = (_) => ++attempts == 1
        ? FakeApi.problem(409, 'CONTRACT_TAKEN', 'Ese número de contrato ya existe.')
        : FakeApi.json(201, (api.posts['createClient'] as Json)['loan']);
    final app = await bootApp(tester, api: api);
    await app.go('/clients/${api.id('client')}/loans/new');
    expect(find.text(l.actionNewLoan), findsWidgets);
    await fillTerms(tester, principal: '500', installments: '4');
    await tapOn(tester, find.text(l.freqWeekly));
    await settle(tester, frames: 6);
    await tapOn(tester, find.widgetWithText(GoldButton, l.newLoanCreate));
    expect(find.text('Ese número de contrato ya existe.'), findsOneWidget);
    await tapOn(tester, find.widgetWithText(GoldButton, l.newLoanCreate));
    expect(api.lastBody('POST', '/clients/{id}/loans'), allOf(containsPair('principal', 50000), containsPair('frequency', 'weekly')));
    expect(location(app), '/clients/${api.id('client')}');
    await app.finish();
  });
}

Json jsonBody(http.Request req) => req.body.isEmpty ? <String, dynamic>{} : jsonDecode(req.body) as Json;

Future<void> pickCollector(WidgetTester tester, String name) async {
  await tapOn(tester, find.byType(DropdownMenu<String?>));
  await tester.tap(find.text(name).last);
  await settle(tester);
}
