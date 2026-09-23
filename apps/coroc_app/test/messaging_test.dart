import 'package:coroc/core/l10n.dart';
import 'package:coroc/core/models/models.dart';
import 'package:coroc/features/messaging/messaging_common.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support.dart';
import 'widgets_test.dart' show harness;

/// Mensaje tal como lo devuelve `POST /messages` (contrato 0.5.0): el recordatorio de CA-10, pedido el domingo
/// 11-oct-2026 a las 10:00 y reprogramado al martes 13-oct a las 07:00 porque el 12 es festivo.
const _scheduled = <String, dynamic>{
  'id': '7a2c0000-0000-4000-8000-000000000001',
  'clientId': '7a2c0000-0000-4000-8000-000000000002',
  'clientName': 'María José Pérez Gómez',
  'loanId': '7a2c0000-0000-4000-8000-000000000003',
  'contract': 'CT-000001',
  'event': 'reminder',
  'kind': 'collection',
  'channel': 'whatsapp',
  'lang': 'es',
  'body': 'Hola María José, te recordamos que la cuota 1 de tu préstamo CT-000001 vence el 9 de noviembre de 2026.',
  'subject': 'Recordatorio de cuota · CT-000001',
  'attachmentDocumentId': null,
  'status': 'scheduled',
  'decision': {
    'decision': 'reschedule',
    'at': '2026-10-13T12:00:00.000Z',
    'localAt': '2026-10-13T07:00',
    'timeZone': 'America/Bogota',
    'ruleSet': 'CO_LEY_2300_2023',
    'reasons': [
      {'code': 'OUT_OF_WINDOW'},
      {'code': 'HOLIDAY_SKIPPED', 'detail': '2026-10-12'},
    ],
  },
  'requestedAt': '2026-10-11T15:00:00.000Z',
  'scheduledAt': '2026-10-13T12:00:00.000Z',
  'sentAt': null,
  'deliveredAt': null,
  'readAt': null,
  'failedAt': null,
  'via': null,
  'error': null,
  'createdAt': '2026-10-11T15:00:00.000Z',
  'assisted': {'whatsappUrl': 'https://wa.me/573157778810?text=Hola'},
};

void main() {
  test('lee un mensaje con la decisión del motor de reglas y los enlaces del modo asistido', () {
    final m = CorocMessage.fromJson(_scheduled);
    expect(m.pending, isTrue);
    expect(m.retryable, isFalse);
    expect(m.decision.localAt, '2026-10-13T07:00');
    expect(m.rule, const DecisionReason(code: 'HOLIDAY_SKIPPED', detail: '2026-10-12'));
    expect(m.assisted?.whatsappUrl, startsWith('https://wa.me/573157778810'));
    final page = MessagePage.fromJson({'items': [_scheduled], 'nextCursor': null});
    expect(page.items.single.contract, 'CT-000001');
  });

  testWidgets('CA-10 en pantalla: el recordatorio muestra cuándo sale y por qué se reprogramó', (tester) async {
    final m = CorocMessage.fromJson(_scheduled);
    await tester.pumpWidget(harness(Scaffold(body: ListView(children: [MessageTile(message: m)])), store: MemorySessionStore(savedLocale: 'es')));
    await tester.pumpAndSettle();
    expect(find.textContaining('María José Pérez Gómez · Recordatorio de cuota · CT-000001'), findsOneWidget);
    expect(find.text('Programado'), findsOneWidget);
    expect(find.textContaining('Reprogramado para'), findsOneWidget);
    expect(find.textContaining('07:00: fuera de franja · festivo'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('CA-11 en pantalla: el segundo mensaje del día queda bloqueado con la regla aplicada', (tester) async {
    final m = CorocMessage.fromJson({
      ..._scheduled,
      'event': 'overdue',
      'status': 'blocked',
      'scheduledAt': null,
      'decision': {
        'decision': 'block',
        'ruleSet': 'CO_LEY_2300_2023',
        'reasons': [
          {'code': 'MAX_PER_DAY', 'detail': '2026-10-13'},
        ],
      },
    });
    await tester.pumpWidget(harness(Scaffold(body: ListView(children: [MessageTile(message: m)])), store: MemorySessionStore(savedLocale: 'es')));
    await tester.pumpAndSettle();
    expect(find.text('Bloqueado por regla'), findsOneWidget);
    expect(find.textContaining('Bloqueado: ya hubo un contacto de cobranza el'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('las reglas y el validador también hablan portugués', (tester) async {
    late AppLocalizations l;
    await tester.pumpWidget(harness(Builder(builder: (context) {
      l = context.l10n;
      return const SizedBox.shrink();
    }), store: MemorySessionStore(savedLocale: 'pt')));
    await tester.pumpAndSettle();
    expect(reasonText(l, const DecisionReason(code: 'OPTED_OUT', detail: 'whatsapp'), 'pt'), 'o cliente pediu para não receber mais por WhatsApp');
    expect(issueText(l, const TemplateIssue(code: 'UNKNOWN_VARIABLE', match: 'cedula')), 'A variável {{cedula}} não existe.');
  });
}
