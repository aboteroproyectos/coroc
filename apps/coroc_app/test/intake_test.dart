import 'package:coroc/core/models/models.dart';
import 'package:coroc/features/inbox/inbox_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support.dart';
import 'widgets_test.dart' show harness;

/// Elemento de la Bandeja tal como lo devuelve `GET /intake/{id}` (contrato 0.4.0).
const _json = <String, dynamic>{
  'id': '6f1c2a7e-0000-4000-8000-000000000001',
  'channel': 'whatsapp',
  'senderPhone': '+573201234567',
  'senderEmail': null,
  'documentId': '6f1c2a7e-0000-4000-8000-000000000002',
  'fileName': 'comprobante.png',
  'mime': 'image/png',
  'status': 'review',
  'stage': 'EN_REVISIÓN',
  'engine': 'rules',
  'extraction': {
    'amount': {'value': 60000, 'confidence': 0.96, 'region': {'page': 0, 'x': 0.05, 'y': 0.34, 'w': 0.22, 'h': 0.02}},
    'date': {'value': '2026-10-09', 'confidence': 0.96, 'region': null},
    'payerName': {'value': 'María José Pérez Gómez', 'confidence': 0.96, 'region': null},
    'receiverName': {'value': 'Distribuidora La Esperanza', 'confidence': 0.96, 'region': null},
    'reference': {'value': '0099887766', 'confidence': 0.93, 'region': null},
    'tamperSignals': <String>[],
  },
  'identification': {'status': 'identified', 'clientId': 'c1', 'via': 'phone', 'candidates': <Object>[], 'loanRule': 'single', 'duplicateOf': null},
  'flags': [
    {'code': 'RECEIVER_MISMATCH', 'severity': 'blocking', 'detail': '0.41'},
    {'code': 'PAYER_MISMATCH', 'severity': 'warning'},
  ],
  'receiverMatch': null,
  'clientId': 'c1',
  'clientName': 'María José Pérez Gómez',
  'clientCode': 'C000001',
  'loanId': 'l1',
  'contract': 'CT-000001',
  'currency': 'COP',
  'entryId': null,
  'receiptNumber': null,
  'receiptDocumentId': null,
  'revertibleUntil': null,
  'reason': null,
  'decidedBy': null,
  'decidedAt': null,
  'createdAt': '2026-10-09T15:00:00.000Z',
  'updatedAt': '2026-10-09T15:00:02.000Z',
};

void main() {
  test('lee un elemento de la Bandeja: campos con confianza y región, alertas bloqueantes', () {
    final it = IntakeItem.fromJson(_json);
    expect(it.amount, 60000);
    expect(it.date, '2026-10-09');
    expect(it.text('reference'), '0099887766');
    expect(it.field('amount').region?.w, 0.22);
    expect(it.field('amount').confidence, 0.96);
    expect(it.field('noExiste').value, isNull);
    expect(it.pending, isTrue);
    expect(it.hasBlocking, isTrue);
    expect(it.revertible, isFalse);
    expect(it.identification.via, 'phone');
  });

  testWidgets('fila de la Bandeja: cliente, valor en pesos y la alerta «El pago no se hizo a tus cuentas»', (tester) async {
    final it = IntakeItem.fromJson(_json);
    await tester.pumpWidget(harness(Scaffold(body: ListView(children: [IntakeTile(item: it, onTap: () {})])), store: MemorySessionStore(savedLocale: 'es')));
    await tester.pumpAndSettle();
    expect(find.text('María José Pérez Gómez'), findsOneWidget);
    expect(find.text('\$ 60.000'), findsOneWidget);
    expect(find.text('Por revisar'), findsOneWidget);
    expect(find.text('El pago no se hizo a tus cuentas'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
