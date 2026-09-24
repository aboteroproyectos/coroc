import 'dart:convert';

import 'package:coroc/core/l10n.dart';
import 'package:coroc/design/widgets/brand.dart';
import 'package:coroc/design/widgets/common.dart';
import 'package:coroc/features/loans/payment_sheet.dart';
import 'package:coroc/features/messaging/messaging_common.dart';
import 'package:coroc/app.dart';
import 'package:file_selector_platform_interface/file_selector_platform_interface.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import 'app_harness.dart';
import 'fake_api.dart';

final l = lookupAppLocalizations(const Locale('es'));

/// El documento real del servidor sin vista previa en la prueba (el visor de PDF necesita la biblioteca nativa).
void serveDocumentWithoutPreview(FakeApi api, {bool versions = false}) {
  final doc = jsonDecode(jsonEncode(api.get('/documents/${api.id('document')}'))) as Json;
  doc['mime'] = 'text/plain';
  doc['tags'] = ['pagado'];
  if (versions) {
    final base = {...doc}..remove('versions');
    doc['version'] = 2;
    doc['versions'] = [
      {...base, 'version': 2},
      {...base, 'id': 'aaaaaaaa-0000-4000-8000-0000000000d1', 'version': 1, 'superseded': true, 'meta': {...base['meta'] as Json, 'voided': true}},
    ];
  }
  api.overrides['GET /documents/{id}'] = (_) => FakeApi.json(200, doc);
}

Future<void> openTab(WidgetTester tester, String tab) async {
  await tester.tap(find.widgetWithText(Tab, tab));
  await settle(tester);
}

void main() {
  testWidgets('ficha: resumen, plan de pagos e historial con reverso y recibo', (tester) async {
    final api = FakeApi();
    serveDocumentWithoutPreview(api, versions: true);
    final app = await bootApp(tester, api: api);
    await app.go('/clients/${api.id('client')}');
    expect(find.text('María José Pérez Gómez'), findsWidgets);
    expect(find.text(l.progressTitle), findsOneWidget);

    await openTab(tester, l.tabSchedule);
    expect(find.byType(DataTable), findsOneWidget);

    await openTab(tester, l.tabHistory);
    await tapOn(tester, find.byTooltip(l.actionReverse).first);
    await tester.enterText(find.descendant(of: find.byType(AlertDialog), matching: find.byType(TextField)), 'no');
    await tapOn(tester, find.widgetWithText(FilledButton, l.actionReverse));
    expect(api.sent('POST', '/loans/{id}/payments/{id}/reversal'), isEmpty);
    await tapOn(tester, find.byTooltip(l.actionReverse).first);
    await tester.enterText(find.descendant(of: find.byType(AlertDialog), matching: find.byType(TextField)), 'Consignación rechazada');
    await tapOn(tester, find.widgetWithText(FilledButton, l.actionReverse));
    expect(api.lastBody('POST', '/loans/{id}/payments/{id}/reversal'), {'reason': 'Consignación rechazada'});
    expect(find.text(l.reverseDone), findsOneWidget);

    // El recibo del pago se abre en el visor: información, etiquetas y versiones.
    await tapOn(tester, find.byTooltip(l.receiptOpenPdf).first);
    expect(find.text(l.docNoPreview), findsOneWidget);
    await tapOn(tester, find.byTooltip(l.docInfo));
    await tester.enterText(find.widgetWithText(TextField, l.docTags), 'pagado, revisado');
    await tapOn(tester, find.widgetWithText(FilledButton, l.actionSave));
    expect(api.lastBody('PATCH', '/documents/{id}'), {'tags': ['pagado', 'revisado']});
    await tapOn(tester, find.byTooltip(l.docVersions));
    await tapOn(tester, find.text(l.docVersionN(1)));
    expect(api.sent('POST', '/documents/{id}/link').last.url.path, contains('aaaaaaaa-0000-4000-8000-0000000000d1'));
    await tapOn(tester, find.byType(BackButton));
    await app.finish();
  });

  testWidgets('registrar pago en escritorio: vista previa, medio, referencia, fecha y recibo', (tester) async {
    final app = await bootApp(tester);
    final api = app.api;
    await app.go('/clients/${api.id('client')}');
    await tapOn(tester, find.widgetWithText(GoldButton, l.actionRegisterPayment));
    expect(find.byType(PaymentForm), findsOneWidget);
    expect(api.sent('POST', '/loans/{id}/payments/preview'), isNotEmpty);
    expect(find.text(l.receiptNewBalance), findsOneWidget);

    await tester.enterText(find.widgetWithText(TextField, l.paymentAmount), '');
    await settle(tester, frames: 5);
    await tapOn(tester, find.text(l.paymentConfirm));
    expect(find.text(l.paymentAmountInvalid), findsOneWidget);

    await tester.enterText(find.widgetWithText(TextField, l.paymentAmount), '1500');
    await tapOn(tester, find.text(l.methodOther));
    await tester.enterText(find.widgetWithText(TextField, l.paymentMethodOther), 'Consignación');
    await tapOn(tester, find.text(l.methodTransfer));
    await tester.enterText(find.widgetWithText(TextField, l.paymentReference), 'REF-77');
    await tester.enterText(find.widgetWithText(TextField, l.paymentNote), 'Pago de la cuota 2');
    await tapOn(tester, find.byIcon(Icons.event));
    final ctx = tester.element(find.byType(DatePickerDialog));
    await tapOn(tester, find.text(MaterialLocalizations.of(ctx).okButtonLabel));
    await tapOn(tester, find.text(l.paymentConfirm));

    final body = api.lastBody('POST', '/loans/{id}/payments')!;
    expect(body, allOf(containsPair('amount', 150000), containsPair('method', l.methodTransfer), containsPair('reference', 'REF-77'), containsPair('note', 'Pago de la cuota 2')));
    expect(api.sent('POST', '/loans/{id}/payments').single.headers['Idempotency-Key'], isNotEmpty);
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
    await settle(tester);
    expect(find.text(l.receiptThanks), findsOneWidget);
    await settle(tester, frames: 15);
    expect(find.text(l.receiptOpenPdf), findsOneWidget);
    await tapOn(tester, find.text(l.actionDone));
    expect(find.text(l.receiptThanks), findsNothing);
    await app.finish();
  });

  testWidgets('registrar pago: la vista previa rechazada y el error del servidor se muestran en el formulario', (tester) async {
    final api = FakeApi()
      ..overrides['POST /loans/{id}/payments/preview'] = ((_) => FakeApi.problem(422, 'PAYMENT_DATE_INVALID', 'La fecha no puede ser futura.'))
      ..overrides['POST /loans/{id}/payments'] = (_) => FakeApi.problem(409, 'LOAN_CLOSED', 'El préstamo ya está cerrado.');
    final app = await bootApp(tester, api: api);
    await app.go('/clients/${api.id('client')}');
    await tapOn(tester, find.widgetWithText(GoldButton, l.actionRegisterPayment));
    expect(find.text('La fecha no puede ser futura.'), findsOneWidget);
    await tapOn(tester, find.text(l.paymentConfirm));
    expect(find.text('El préstamo ya está cerrado.'), findsOneWidget);
    await app.finish();
  });

  testWidgets('registrar pago sin conexión en el teléfono: queda en la cola del equipo', (tester) async {
    final api = FakeApi()..overrides['POST /loans/{id}/payments'] = (_) => throw http.ClientException('sin red');
    final app = await bootApp(tester, api: api, size: phone);
    await app.go('/clients/${api.id('client')}');
    await tapOn(tester, find.widgetWithText(GoldButton, l.actionRegisterPayment));
    expect(find.byType(BottomSheet), findsOneWidget);
    await tapOn(tester, find.text(l.paymentConfirm));
    expect(find.text(l.offlinePaymentQueued), findsOneWidget);
    await tapOn(tester, find.text(l.actionDone));
    expect(find.byType(BottomSheet), findsNothing);
    await app.finish();
  });

  testWidgets('documentos: búsqueda, filtros, etiqueta, estado de cuenta y carga de archivos', (tester) async {
    final api = FakeApi();
    serveDocumentWithoutPreview(api);
    final docs = jsonDecode(jsonEncode(api.gets['/documents?clientId=${api.id('client')}'])) as Json;
    ((docs['items'] as List).first as Json)['tags'] = ['urgente'];
    api.overrides['GET /documents'] = (_) => FakeApi.json(200, docs);
    api.overrides['POST /clients/{id}/documents'] = (_) => FakeApi.json(201, api.get('/documents/${api.id('document')}'));
    final app = await bootApp(tester, api: api);
    await app.go('/clients/${api.id('client')}');
    await openTab(tester, l.tabDocuments);

    await tester.enterText(find.widgetWithText(TextField, l.docSearch), 'recibo');
    await settle(tester, frames: 5);
    expect(api.sent('GET', '/documents').last.url.queryParameters['q'], 'recibo');
    await tapOn(tester, find.widgetWithText(ChoiceChip, l.docKindStatement));
    expect(api.sent('GET', '/documents').last.url.queryParameters['kind'], 'statement');
    await tapOn(tester, find.widgetWithText(ChoiceChip, l.docAll));
    await tapOn(tester, find.text('#urgente').first);
    expect(api.sent('GET', '/documents').last.url.queryParameters['tag'], 'urgente');
    await tapOn(tester, find.byType(InputChip).hitTestable().first);

    // Carga de un documento cualquiera.
    app.files.file = XFile.fromData(utf8.encode('contrato firmado'), name: 'contrato.pdf', mimeType: 'application/pdf', length: 16);
    await tapOn(tester, find.widgetWithText(OutlinedButton, l.docUpload));
    await tester.enterText(find.widgetWithText(TextField, l.docName), 'Contrato firmado');
    await tapOn(tester, find.widgetWithText(FilledButton, l.docUpload));
    final upload = api.sent('POST', '/clients/{id}/documents').single;
    expect(upload.url.queryParameters, allOf(containsPair('kind', 'other'), containsPair('name', 'Contrato firmado')));
    expect(utf8.decode(upload.bodyBytes), 'contrato firmado');

    // Estado de cuenta bajo demanda: se espera la tarea y se abre el documento.
    await tapOn(tester, find.widgetWithText(OutlinedButton, l.docRequestStatement));
    await settle(tester, frames: 10);
    expect(api.sent('POST', '/loans/{id}/statements'), hasLength(1));
    expect(find.text(l.docNoPreview), findsOneWidget);
    await tapOn(tester, find.byType(BackButton));

    // Un comprobante subido desde la ficha va a la Bandeja.
    app.files.file = XFile.fromData(utf8.encode('%PDF-1.4'), name: 'pago.pdf', mimeType: 'application/pdf', length: 8);
    await tapOn(tester, find.widgetWithText(OutlinedButton, l.docUpload));
    await tapOn(tester, find.descendant(of: find.byType(AlertDialog), matching: find.text(l.docKindReceiptIn)));
    expect(find.text(l.docUploadReceiptHelp), findsOneWidget);
    await tapOn(tester, find.widgetWithText(FilledButton, l.docUpload));
    expect(api.sent('POST', '/intake').single.url.queryParameters, containsPair('clientId', api.id('client')));
    expect(app.container.read(routerProvider).routerDelegate.currentConfiguration.uri.path, '/inbox');
    await app.finish();
  });

  testWidgets('mensajes del cliente: envío manual por correo y excepción horaria con su soporte', (tester) async {
    final api = FakeApi();
    final docs = jsonDecode(jsonEncode(api.gets['/documents?clientId=${api.id('client')}'])) as Json;
    api.overrides['GET /documents'] = (_) => FakeApi.json(200, docs);
    api.overrides['PUT /clients/{id}/contact-exception'] = (req) => FakeApi.json(200, {...jsonDecode(req.body) as Json, 'grantedAt': '2026-09-24T10:00:00.000Z'});
    final app = await bootApp(tester, api: api);
    await app.go('/clients/${api.id('client')}');
    await openTab(tester, l.tabMessages);
    expect(find.text(l.clientMessagesHistory), findsOneWidget);

    await tapOn(tester, find.byType(DropdownMenu<String>).first);
    await tester.tap(find.text(eventLabel(l, 'manual')).last);
    await settle(tester);
    await tester.enterText(find.widgetWithText(TextField, l.composeText), 'Hola {{nombre}}, su saldo es {{saldo}}.');
    await tapOn(tester, find.text(l.channelEmail).first);
    await tapOn(tester, find.text(l.composeQueue));
    expect(api.lastBody('POST', '/messages'), {'loanId': api.id('loan'), 'event': 'manual', 'channel': 'email', 'body': 'Hola {{nombre}}, su saldo es {{saldo}}.'});

    await tapOn(tester, find.text(l.exceptionAdd));
    await tapOn(tester, find.widgetWithText(FilterChip, weekdayName(l, 1)));
    await tapOn(tester, find.textContaining(l.exceptionFrom));
    final ctx = tester.element(find.byType(TimePickerDialog));
    await tapOn(tester, find.text(MaterialLocalizations.of(ctx).okButtonLabel));
    await tapOn(tester, find.widgetWithText(FilledButton, l.actionSave));
    final body = api.lastBody('PUT', '/clients/{id}/contact-exception')!;
    expect((body['windows'] as List).map((w) => (w as Json)['day']), [1, 7]);
    expect(body['documentId'], isNotEmpty);
    await app.finish();
  });

  testWidgets('excepción horaria sin documento de soporte: se pide cargarlo primero; y se puede quitar la vigente', (tester) async {
    final api = FakeApi();
    api.overrides['GET /documents'] = (_) => FakeApi.json(200, {'items': <Object>[], 'nextCursor': null});
    final client = jsonDecode(jsonEncode(api.get('/clients/${api.id('client')}'))) as Json;
    client['contactException'] = {'windows': [{'day': 6, 'start': '09:00', 'end': '12:00'}], 'documentId': api.id('document'), 'grantedAt': '2026-09-20T10:00:00.000Z'};
    client['emailStatus'] = 'bounced';
    api.overrides['GET /clients/{id}'] = (_) => FakeApi.json(200, client);
    final app = await bootApp(tester, api: api);
    await app.go('/clients/${api.id('client')}');
    await openTab(tester, l.tabMessages);
    expect(find.text(l.emailBounced), findsOneWidget);
    await tapOn(tester, find.descendant(of: find.ancestor(of: find.text(l.exceptionTitle), matching: find.byType(SectionCard)), matching: find.text(l.actionEdit)));
    expect(find.text(l.exceptionNeedsDocument), findsOneWidget);
    await tapOn(tester, find.descendant(of: find.ancestor(of: find.text(l.exceptionTitle), matching: find.byType(SectionCard)), matching: find.text(l.actionDelete)));
    expect(api.sent('DELETE', '/clients/{id}/contact-exception'), hasLength(1));
    await app.finish();
  });

  testWidgets('editar el cliente: se guarda con la versión y vuelve a la ficha', (tester) async {
    final app = await bootApp(tester);
    final api = app.api;
    await app.go('/clients/${api.id('client')}');
    await tapOn(tester, find.widgetWithText(OutlinedButton, l.actionEdit));
    await tester.enterText(find.widgetWithText(TextFormField, l.fieldCity), 'Envigado');
    await tapOn(tester, find.widgetWithText(GoldButton, l.actionSave));
    expect(api.sent('PATCH', '/clients/{id}').single.headers['If-Match'], '1');
    expect(api.lastBody('PATCH', '/clients/{id}'), containsPair('city', 'Envigado'));
    await app.finish();
  });
}

