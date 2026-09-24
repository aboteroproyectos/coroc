import 'dart:convert';

import 'package:coroc/core/l10n.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'app_harness.dart';
import 'fake_api.dart';

final l = lookupAppLocalizations(const Locale('es'));

String _iso(DateTime d) => d.toIso8601String().substring(0, 10);

Json _field(Object? value, double confidence, [Json? region]) => {'value': value, 'confidence': confidence, 'region': region};

/// Variantes del comprobante real del servidor (misma forma, otro estado y valores leídos).
Json intakeVariant(FakeApi api, {String id = 'a1b2c3d4-0000-4000-8000-000000000001', String status = 'review', String? senderPhone, List<Json>? flags, Json? extra}) {
  final base = jsonDecode(jsonEncode(api.get('/intake/${api.id('intake')}'))) as Json;
  final region = {'page': 0, 'x': 0.1, 'y': 0.2, 'w': 0.3, 'h': 0.05};
  return {
    ...base,
    'id': id,
    'status': status,
    'stage': status == 'review' ? 'REVISION_HUMANA' : 'LEIDO',
    'channel': senderPhone == null ? 'upload' : 'whatsapp',
    'senderPhone': senderPhone,
    'messageText': senderPhone == null ? null : 'Buenas, le envío el pago',
    'mime': 'image/png',
    'engine': 'rules',
    'reason': null,
    'extraction': {
      ...(base['extraction'] as Json),
      'amount': _field(150000, 0.97, region),
      'date': _field(_iso(DateTime.now().subtract(const Duration(days: 3))), 0.85, region),
      'payerName': _field('María José Pérez', 0.6),
      'receiverName': _field('INVERSIONES COROC SAS', 0.99),
      'reference': _field('ABC123', 0.9),
      'entity': _field('Bancolombia', 0.9),
      'tamperSignals': ['Metadatos editados'],
    },
    'identification': {
      ...(base['identification'] as Json),
      'status': senderPhone == null ? 'identified' : 'unknown',
      'clientId': senderPhone == null ? api.id('client') : null,
      'candidates': [
        {'clientId': api.id('client'), 'name': 'María José Pérez Gómez', 'code': 'C000001', 'score': 0.9},
        {'clientId': api.id('client2'), 'name': 'Pedro Luis Ramírez Ortiz', 'code': 'C000002', 'score': 0.5},
      ],
    },
    'flags': flags ??
        [
          {'code': 'LOW_CONFIDENCE', 'field': 'payerName', 'severity': 'warning'},
          {'code': 'PAYER_MISMATCH', 'severity': 'warning'},
          {'code': 'TAMPER_SIGNAL', 'severity': 'warning'},
        ],
    'clientId': senderPhone == null ? api.id('client') : null,
    'clientName': senderPhone == null ? 'María José Pérez Gómez' : null,
    'loanId': senderPhone == null ? api.id('loan') : null,
    ...?extra,
  };
}

/// Sirve [items] como la Bandeja y cada uno como su detalle.
void serveIntake(FakeApi api, List<Json> items) {
  api.overrides['GET /intake'] = (_) => FakeApi.json(200, {'items': items, 'nextCursor': null});
  api.overrides['GET /intake/summary'] = (_) => FakeApi.json(200, {'review': 1, 'unassigned': 1, 'processing': 0, 'revertible': 0, 'pending': 2});
  api.overrides['GET /intake/{id}'] = (req) => FakeApi.json(200, items.firstWhere((i) => req.url.path.endsWith(i['id'] as String)));
}

void main() {
  testWidgets('detalle en revisión: campos con confianza, vista previa del saldo y aprobación con la clave de idempotencia', (tester) async {
    final api = FakeApi();
    final item = intakeVariant(api);
    serveIntake(api, [item]);
    final app = await bootApp(tester, api: api);
    await app.go('/inbox?id=${item['id']}');
    await settle(tester);
    expect(find.text(l.intakeStatusReview), findsWidgets);
    expect(find.text(l.flagPayerMismatch), findsOneWidget);
    expect(find.text('97 %'), findsOneWidget);
    expect(find.text(l.intakePreview), findsOneWidget);
    expect(api.lastBody('POST', '/loans/{id}/payments/preview'), containsPair('amount', 150000));

    // Otro cliente sugerido y vuelta al primero: el préstamo se vuelve a elegir.
    await tapOn(tester, find.widgetWithText(ChoiceChip, 'Pedro Luis Ramírez Ortiz'));
    await tapOn(tester, find.widgetWithText(ChoiceChip, 'María José Pérez Gómez'));

    await tapOn(tester, find.text(l.intakeApprove));
    final body = api.lastBody('POST', '/intake/{id}/approve')!;
    expect(body, containsPair('clientId', api.id('client')));
    expect(body, containsPair('amount', 150000));
    expect(body, containsPair('reference', 'ABC123'));
    expect(body, containsPair('saveSenderAsSecondaryNumber', false));
    expect(api.sent('POST', '/intake/{id}/approve').single.headers['Idempotency-Key'], isNotEmpty);
    expect(find.text(l.intakeApproved('RC-000001')), findsOneWidget);
    await app.finish();
  });

  testWidgets('detalle en revisión: se corrige el monto y la fecha, se busca otro cliente, se rechaza y se archiva', (tester) async {
    final api = FakeApi();
    final item = intakeVariant(api);
    serveIntake(api, [item]);
    final app = await bootApp(tester, api: api);
    await app.go('/inbox?id=${item['id']}');
    await settle(tester);

    await tester.enterText(find.widgetWithText(TextField, '${l.intakeFieldAmount} (USD)'), '120000');
    await settle(tester, frames: 6);
    expect(api.lastBody('POST', '/loans/{id}/payments/preview'), containsPair('amount', 12000000));

    await tapOn(tester, find.byIcon(Icons.event_outlined));
    final ctx = tester.element(find.byType(DatePickerDialog));
    await tapOn(tester, find.text(MaterialLocalizations.of(ctx).okButtonLabel));

    await tapOn(tester, find.text(l.intakeChooseClient));
    await tester.enterText(find.widgetWithText(TextField, l.intakeSearchClient), 'Pedro');
    await settle(tester, frames: 5);
    expect(api.sent('GET', '/clients').last.url.queryParameters['q'], 'Pedro');
    await tapOn(tester, find.widgetWithText(ListTile, 'María José Pérez Gómez').last);

    await tapOn(tester, find.widgetWithText(OutlinedButton, l.intakeReject));
    await tester.enterText(find.widgetWithText(TextField, l.intakeRejectReason), 'No corresponde a este préstamo');
    await tapOn(tester, find.widgetWithText(FilledButton, l.intakeReject));
    expect(api.lastBody('POST', '/intake/{id}/reject'), {'reason': 'No corresponde a este préstamo'});

    await tapOn(tester, find.text(l.intakeArchive));
    expect(api.sent('POST', '/intake/{id}/archive'), hasLength(1));

    // Enter aprueba desde el teclado.
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await settle(tester);
    expect(api.sent('POST', '/intake/{id}/approve'), hasLength(1));
    await app.finish();
  });

  testWidgets('WhatsApp sin cliente: se asigna, se guarda el número como secundario y el error del servidor se muestra', (tester) async {
    final api = FakeApi();
    final item = intakeVariant(api, status: 'unassigned', senderPhone: '+573001112233', flags: [
      {'code': 'SENDER_UNKNOWN', 'severity': 'blocking'},
      {'code': 'MISSING_FIELD', 'field': 'reference', 'severity': 'warning'},
    ]);
    serveIntake(api, [item]);
    api.overrides['POST /intake/{id}/approve'] = (_) => FakeApi.problem(409, 'LOAN_NOT_ACTIVE', 'El préstamo ya no está activo.');
    final app = await bootApp(tester, api: api);
    await app.go('/inbox?id=${item['id']}');
    await settle(tester);
    expect(find.text(l.inboxUnassignedClient), findsWidgets);
    expect(find.textContaining('Buenas, le envío el pago'), findsOneWidget);

    await tapOn(tester, find.widgetWithText(ChoiceChip, 'María José Pérez Gómez'));
    expect(find.text(l.intakeSaveSender('+573001112233')), findsOneWidget);
    await tapOn(tester, find.text(l.intakeSaveSender('+573001112233')));
    await tapOn(tester, find.text(l.intakeSaveSender('+573001112233')));
    await tapOn(tester, find.text(l.intakeApprove));
    expect(api.lastBody('POST', '/intake/{id}/approve'), containsPair('saveSenderAsSecondaryNumber', true));
    expect(find.text('El préstamo ya no está activo.'), findsOneWidget);
    await app.finish();
  });

  testWidgets('aplicado automáticamente: muestra el recibo, abre el archivo y se puede revertir', (tester) async {
    final api = FakeApi();
    final item = intakeVariant(api, status: 'applied_auto', flags: const [], extra: {
      'receiptNumber': 'RC-000009',
      'receiptDocumentId': api.id('document'),
      'entryId': api.id('entry'),
      'revertibleUntil': DateTime.now().toUtc().add(const Duration(hours: 20)).toIso8601String(),
      'reason': 'Aplicado por coincidencia exacta',
    });
    serveIntake(api, [item]);
    final app = await bootApp(tester, api: api);
    await app.go('/inbox?id=${item['id']}');
    await settle(tester);
    expect(find.text(l.intakeApproved('RC-000009')), findsOneWidget);
    expect(find.text('Aplicado por coincidencia exacta'), findsOneWidget);

    await tapOn(tester, find.text(l.intakeRevert));
    await tapOn(tester, find.text(l.actionCancel));
    expect(api.sent('POST', '/intake/{id}/revert'), isEmpty);
    await tapOn(tester, find.text(l.intakeRevert));
    await tapOn(tester, find.widgetWithText(FilledButton, l.intakeRevert));
    expect(api.sent('POST', '/intake/{id}/revert'), hasLength(1));

    await tapOn(tester, find.text(l.intakeOpenReceipt));
    expect(api.sent('GET', '/documents/{id}'), isNotEmpty);
    await app.finish();
  });

  testWidgets('lista: filtros, aprobación en lote y un comprobante que aún se lee', (tester) async {
    final api = FakeApi();
    final review = intakeVariant(api, flags: const []);
    final processing = intakeVariant(api, id: 'a1b2c3d4-0000-4000-8000-000000000002', status: 'processing', flags: const []);
    serveIntake(api, [review, processing, api.get('/intake/${api.id('intake')}')]);
    final app = await bootApp(tester, api: api);
    await app.go('/inbox');
    expect(find.text(l.inboxSelect), findsOneWidget);
    expect(find.text('${l.inboxFilterPending} · 2'), findsOneWidget);

    await tapOn(tester, find.byType(Checkbox).first);
    await tapOn(tester, find.text(l.inboxApproveSelected(1)));
    expect(api.lastBody('POST', '/intake/approve-batch'), {'ids': [review['id']]});
    expect(find.text(l.inboxBatchResult(1, 0)), findsOneWidget);

    await tapOn(tester, find.text(l.intakeStatusProcessing).first);
    expect(find.text(l.intakeProcessing), findsOneWidget);
    // El evento en vivo actualiza la lista y el detalle.
    api.emit('intake.updated', {'intakeId': processing['id']});
    await settle(tester, frames: 35);

    for (final f in [l.inboxFilterUnassigned, l.inboxFilterAuto, l.inboxFilterAll]) {
      await tester.tap(find.text(f));
      await settle(tester);
    }
    expect(api.sent('GET', '/intake').map((r) => r.url.queryParametersAll['status'] ?? const []), contains(equals(['applied_auto'])));
    await app.finish();
  });

  testWidgets('teléfono: el comprobante se abre en su propia pantalla y vuelve a la lista', (tester) async {
    final api = FakeApi();
    final item = intakeVariant(api);
    serveIntake(api, [item]);
    final app = await bootApp(tester, api: api, size: phone);
    await app.go('/inbox');
    await tapOn(tester, find.text('María José Pérez Gómez').first);
    expect(find.text(l.intakeFields), findsOneWidget);
    await tapOn(tester, find.byType(BackButton));
    expect(find.text(l.intakeFields), findsNothing);
    await app.finish();
  });

  testWidgets('sin permiso de pagos: el comprobante se ve en solo lectura', (tester) async {
    final api = FakeApi();
    final item = intakeVariant(api);
    serveIntake(api, [item]);
    final app = await bootApp(tester, api: api, role: 'viewer', permissions: const ['intake.view', 'clients.view']);
    await app.go('/inbox?id=${item['id']}');
    expect(find.text(l.intakeApprove), findsNothing);
    expect(find.text(l.intakeOpenFile), findsOneWidget);
    await app.finish();
  });
}
