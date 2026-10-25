// Fase 10 · COROC Escritorio (ADR-064, ADR-065): «Mensajes de hoy» uno a la vez por WhatsApp para Windows con el PDF
// copiado (E-5), el recibo con un clic después de aprobar un comprobante (E-3) y el hilo de Gmail en la ficha.
import 'package:coroc/core/desktop/desktop_platform.dart';
import 'package:coroc/core/l10n.dart';
import 'package:coroc/features/messaging/client_messages.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'app_harness.dart';
import 'desktop_fakes.dart';
import 'fake_api.dart';
import 'inbox_test.dart' show intakeVariant, serveIntake;

final l = lookupAppLocalizations(const Locale('es'));

const _m1 = 'c0c0a000-0000-4000-8000-000000000001';
const _m2 = 'c0c0a000-0000-4000-8000-000000000002';
const _m3 = 'c0c0a000-0000-4000-8000-000000000003';

/// Tres listos: un recordatorio, un recibo con PDF y uno que la regla de franja no deja salir.
List<Json> serveReady(FakeApi api) {
  final items = [
    readyWhatsApp(api, id: _m1),
    readyWhatsApp(api, id: _m2, event: 'receipt', attachment: api.id('document'), body: 'Recibimos su pago. Le enviamos el recibo.'),
    readyWhatsApp(api, id: _m3, event: 'overdue', body: 'Su cuota está atrasada.'),
  ];
  final pending = [...items];
  api.overrides['GET /messages'] = (req) => FakeApi.json(200, {'items': req.url.queryParameters['status'] == 'ready' ? pending : <Json>[], 'nextCursor': null});
  api.overrides['GET /messages/summary'] = (_) => FakeApi.json(200, {'ready': pending.length, 'scheduled': 0, 'blocked': 0, 'failed': 0});
  api.overrides['POST /messages/{id}/send'] = (req) {
    final id = req.url.pathSegments[req.url.pathSegments.length - 2];
    if (id == _m3) return FakeApi.problem(409, 'CONTACT_OUT_OF_WINDOW', 'Fuera de la franja permitida: se puede enviar desde las 07:00.');
    final m = items.firstWhere((x) => x['id'] == id);
    pending.removeWhere((x) => x['id'] == id);
    return FakeApi.json(200, sentAssisted(m));
  };
  api.overrides['POST /messages/{id}/cancel'] = (req) {
    final id = req.url.pathSegments[req.url.pathSegments.length - 2];
    final m = items.firstWhere((x) => x['id'] == id);
    pending.removeWhere((x) => x['id'] == id);
    return FakeApi.json(200, {...m, 'status': 'cancelled'});
  };
  return items;
}

Future<void> openMessagesTab(WidgetTester tester) async {
  await tester.tap(find.widgetWithText(Tab, l.tabMessages));
  await settle(tester);
}

final messagesScrollable = find.descendant(of: find.byType(ClientMessagesTab), matching: find.byType(Scrollable)).first;

void main() {
  testWidgets('E-5 · Mensajes de hoy: uno a la vez, WhatsApp para Windows, el PDF copiado y «3 de 3»', (tester) async {
    final api = FakeApi();
    serveReady(api);
    final platform = FakeDesktopPlatform();
    final app = await bootDesktop(tester, api: api, platform: platform);
    // El menú lleva a la cola del día con su contador.
    await tapOn(tester, find.text(l.todayMessagesTitle).first);
    expect(location(app), '/messages/today');
    expect(find.text(l.todayMessagesPosition(1, 3)), findsOneWidget);
    expect(find.text('Hola María José, le recordamos su cuota de hoy.'), findsOneWidget);

    // 1 · Recordatorio: se abre el chat del cliente con el texto listo; al volver a COROC pasa al siguiente.
    await tapOn(tester, find.text(l.todayMessagesSendWhatsapp));
    expect(platform.opened.single, startsWith('whatsapp://send?phone=573157778899'));
    expect(platform.copied, isEmpty);
    expect(find.text(l.todayMessagesWaiting), findsOneWidget);
    platform.signal(WindowSignalKind.focused);
    await settle(tester);
    expect(find.text(l.todayMessagesPosition(2, 3)), findsOneWidget);
    expect(find.text(l.todayMessagesSentN(1)), findsOneWidget);

    // 2 · Recibo: el PDF queda copiado para pegarlo con Ctrl+V.
    expect(find.text(l.todayMessagesWithPdf), findsOneWidget);
    await tapOn(tester, find.text(l.todayMessagesSendWhatsapp));
    expect(platform.copied.single.name, 'CT-000001-receipt.pdf');
    expect(platform.copied.single.size, greaterThan(0));
    expect(find.text(l.todayMessagesPasteHint), findsOneWidget);
    await tapOn(tester, find.text(l.todayMessagesNext));
    expect(find.text(l.todayMessagesPosition(3, 3)), findsOneWidget);

    // 3 · Fuera de franja (Ley 2300): no sale, se dice por qué y queda para después.
    await tapOn(tester, find.text(l.todayMessagesSendWhatsapp));
    expect(find.text('Fuera de la franja permitida: se puede enviar desde las 07:00.'), findsOneWidget);
    expect(platform.opened, hasLength(2));
    await tapOn(tester, find.text(l.todayMessagesSkip));
    expect(find.text(l.todayMessagesDone), findsOneWidget);
    expect(find.text(l.todayMessagesSentN(2)), findsOneWidget);
    expect(api.sent('POST', '/messages/{id}/send'), hasLength(3));

    // «Volver a revisar» trae lo que quedó listo.
    await tapOn(tester, find.text(l.todayMessagesReload));
    expect(find.text(l.todayMessagesPosition(1, 1)), findsOneWidget);
    await tapOn(tester, find.text(l.msgDiscard));
    expect(api.sent('POST', '/messages/{id}/cancel'), hasLength(1));
    expect(find.text(l.todayMessagesDone), findsOneWidget);
    await app.finish();
  });

  testWidgets('si WhatsApp para Windows no abre, se prueba wa.me y si tampoco, se avisa', (tester) async {
    final api = FakeApi();
    serveReady(api);
    final platform = FakeDesktopPlatform()..canOpen = false;
    final app = await bootDesktop(tester, api: api, platform: platform);
    await app.go('/messages/today');
    await tapOn(tester, find.text(l.todayMessagesSendWhatsapp));
    expect(platform.opened, ['whatsapp://send?phone=573157778899&text=Hola', 'https://wa.me/573157778899?text=Hola']);
    expect(find.text(l.msgCannotOpen), findsOneWidget);
    await app.finish();
  });

  testWidgets('Mensajes de hoy: sin mensajes, con error de red y sin permiso de enviar', (tester) async {
    final api = FakeApi();
    var fail = true;
    api.overrides['GET /messages'] = (_) => fail ? FakeApi.problem(500, 'INTERNAL', 'El servidor no respondió.') : FakeApi.json(200, {'items': <Json>[], 'nextCursor': null});
    final app = await bootDesktop(tester, api: api);
    await app.go('/messages/today');
    expect(find.text('El servidor no respondió.'), findsOneWidget);
    fail = false;
    await tapOn(tester, find.text(l.actionRetry));
    expect(find.text(l.todayMessagesDone), findsOneWidget);
    expect(find.text(l.messagesEmptyReadyHelp), findsOneWidget);
    await app.finish();

    final api2 = FakeApi();
    serveReady(api2);
    final viewer = await bootDesktop(tester, api: api2, role: 'auditor', permissions: const ['messages.view', 'dashboard.view']);
    await viewer.go('/messages/today');
    expect(find.text(l.noPermissionMessage), findsOneWidget);
    expect(find.text(l.todayMessagesSendWhatsapp), findsNothing);
    await viewer.finish();
  });

  testWidgets('en la Mensajería de Escritorio, «Enviar» también usa WhatsApp para Windows y el botón grande lleva a la cola', (tester) async {
    final api = FakeApi();
    serveReady(api);
    final platform = FakeDesktopPlatform();
    final app = await bootDesktop(tester, api: api, platform: platform);
    await app.go('/messages');
    expect(find.text(l.todayMessagesStart(3)), findsOneWidget);
    await tapOn(tester, find.text(l.msgSendWhatsapp).at(1));
    expect(platform.opened.single, startsWith('whatsapp://send'));
    expect(find.text(l.todayMessagesPasteHint), findsOneWidget);
    await tapOn(tester, find.text(l.todayMessagesStart(2)));
    expect(location(app), '/messages/today');
    await app.finish();
  });

  testWidgets('E-3 · al aprobar un comprobante, el recibo sale por WhatsApp con un clic', (tester) async {
    final api = FakeApi();
    final item = intakeVariant(api);
    serveIntake(api, [item]);
    final receipt = readyWhatsApp(api, id: _m2, event: 'receipt', attachment: api.id('document'), body: 'Recibimos su pago. Le enviamos el recibo.');
    var polls = 0;
    api.overrides['GET /messages'] = (req) {
      final q = req.url.queryParameters;
      if (q['event'] != 'receipt') return FakeApi.json(200, {'items': <Json>[], 'nextCursor': null});
      // El servidor tarda un momento en preparar el mensaje del recibo con su PDF.
      return FakeApi.json(200, {
        'items': polls++ < 1 ? <Json>[] : [receipt],
        'nextCursor': null,
      });
    };
    api.overrides['POST /messages/{id}/send'] = (_) => FakeApi.json(200, sentAssisted(receipt));
    final platform = FakeDesktopPlatform();
    final app = await bootDesktop(tester, api: api, platform: platform);
    await app.go('/inbox?id=${item['id']}');
    await tapOn(tester, find.text(l.intakeApprove));
    expect(find.text(l.receiptPromptTitle('RC-000001')), findsOneWidget);
    await tapOn(tester, find.text(l.receiptPromptSend));
    await tester.pump(const Duration(seconds: 2));
    await settle(tester);
    final query = api.sent('GET', '/messages').last.url.queryParameters;
    expect(query, containsPair('event', 'receipt'));
    expect(query, containsPair('clientId', api.id('client')));
    expect(platform.opened.single, startsWith('whatsapp://send'));
    expect(platform.copied.single.name, 'CT-000001-receipt.pdf');
    expect(find.text(l.todayMessagesPasteHint), findsOneWidget);
    await app.finish();
  });

  testWidgets('E-3 · «Ahora no» no envía nada; sin mensaje de recibo se explica por qué', (tester) async {
    final api = FakeApi();
    final item = intakeVariant(api);
    serveIntake(api, [item]);
    api.overrides['GET /messages'] = (_) => FakeApi.json(200, {'items': <Json>[], 'nextCursor': null});
    final platform = FakeDesktopPlatform();
    final app = await bootDesktop(tester, api: api, platform: platform);
    await app.go('/inbox?id=${item['id']}');
    await tapOn(tester, find.text(l.intakeApprove));
    await tapOn(tester, find.text(l.receiptPromptLater));
    expect(api.sent('GET', '/messages').where((r) => r.url.queryParameters['event'] == 'receipt'), isEmpty);

    // Otra aprobación: esta vez se pide el recibo, pero el cliente no autorizó WhatsApp.
    api.overrides['POST /intake/{id}/approve'] = (_) => FakeApi.json(201, api.posts['pay']);
    await app.go('/inbox?id=${item['id']}');
    await tapOn(tester, find.text(l.intakeApprove));
    await tapOn(tester, find.text(l.receiptPromptSend));
    // 20 consultas cada 1,5 s: a los 30 s se da por vencido y lo explica.
    for (var i = 0; i < 15; i++) {
      await tester.pump(const Duration(seconds: 2));
    }
    await settle(tester);
    expect(find.text(l.receiptPromptNone), findsOneWidget);
    expect(platform.opened, isEmpty);
    await app.finish();
  });

  testWidgets('el hilo de Gmail con el cliente en su ficha, con el comprobante a un clic', (tester) async {
    final api = FakeApi();
    final intake = api.id('intake');
    api.overrides['GET /clients/{id}/emails'] = (_) => FakeApi.json(200, {
      'items': [
        {
          'id': 'e0000000-0000-4000-8000-000000000001',
          'direction': 'in',
          'subject': 'Pago cuota 3',
          'snippet': 'Buenos días, adjunto el comprobante.',
          'from': 'maria.perez@example.com',
          'to': 'cobros.prado@gmail.com',
          'attachments': [
            {'name': 'comprobante.jpg', 'size': 84211, 'intakeId': intake},
          ],
          'messageId': null,
          'at': '2026-10-24T15:10:00.000Z',
        },
        {
          'id': 'e0000000-0000-4000-8000-000000000002',
          'direction': 'out',
          'subject': 'Re: Pago cuota 3',
          'snippet': 'Recibimos su pago. Le enviamos el recibo.',
          'from': 'cobros.prado@gmail.com',
          'to': 'maria.perez@example.com',
          'attachments': [
            {'name': null, 'size': 48211, 'intakeId': null},
          ],
          'messageId': _m2,
          'at': '2026-10-24T15:12:00.000Z',
        },
      ],
    });
    final app = await bootDesktop(tester, api: api);
    await app.go('/clients/${api.id('client')}');
    await openMessagesTab(tester);
    await tester.scrollUntilVisible(find.text(l.clientEmailsTitle), 200, scrollable: messagesScrollable);
    expect(find.text('Pago cuota 3'), findsOneWidget);
    expect(find.text('Re: Pago cuota 3'), findsOneWidget);
    expect(find.textContaining(l.clientEmailsSent), findsOneWidget);
    expect(find.text(l.clientEmailsAttachment), findsOneWidget);
    await tapOn(tester, find.text('comprobante.jpg'));
    expect(location(app), '/inbox?id=$intake');
    await app.finish();
  });

  testWidgets('sin correos con el cliente todavía', (tester) async {
    final api = FakeApi();
    api.overrides['GET /clients/{id}/emails'] = (_) => FakeApi.json(200, {'items': <Json>[]});
    final app = await bootDesktop(tester, api: api);
    await app.go('/clients/${api.id('client')}');
    await openMessagesTab(tester);
    await tester.scrollUntilVisible(find.text(l.clientEmailsEmpty), 200, scrollable: messagesScrollable);
    expect(find.text(l.clientEmailsEmpty), findsOneWidget);
    await app.finish();
  });
}
