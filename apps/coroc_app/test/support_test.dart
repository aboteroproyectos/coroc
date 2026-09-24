import 'package:coroc/core/models/support.dart';
import 'package:coroc/features/settings/support_section.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support.dart';
import 'widgets_test.dart' show harness;

/// Respuestas tal como las devuelve la API (contrato 0.6.0).
final _failures = Failures.fromJson({
  'days': 30,
  'documentTasks': [
    {
      'id': '7a2c0000-0000-4000-8000-000000000010',
      'kind': 'statement',
      'status': 'failed',
      'progress': 0,
      'documentId': null,
      'error': 'TASK_FAILED',
      'createdAt': '2026-10-09T15:00:00.000Z',
      'finishedAt': '2026-10-09T15:05:00.000Z',
      'loanId': null,
      'contract': 'CT-000001',
      'attempts': 5,
      'detail': 'Chromium no respondió',
      'retryable': true,
    },
    {
      'id': '7a2c0000-0000-4000-8000-000000000011',
      'kind': 'backup',
      'status': 'failed',
      'progress': 0,
      'documentId': null,
      'error': 'TASK_FAILED',
      'createdAt': '2026-10-09T15:00:00.000Z',
      'finishedAt': null,
      'loanId': null,
      'contract': null,
      'attempts': 5,
      'detail': null,
      'retryable': false,
    },
  ],
  'messages': [
    {
      'id': '7a2c0000-0000-4000-8000-000000000012',
      'clientId': '7a2c0000-0000-4000-8000-000000000002',
      'clientName': 'María José Pérez Gómez',
      'event': 'receipt',
      'channel': 'email',
      'attempts': 3,
      'detail': 'SMTP 421',
      'failedAt': '2026-10-09T16:00:00.000Z',
    },
  ],
  'intake': <Map<String, dynamic>>[],
});

final _trace = IntakeTrace.fromJson({
  'intakeId': '7a2c0000-0000-4000-8000-000000000020',
  'status': 'applied_auto',
  'steps': [
    {'step': 'received', 'at': '2026-10-09T15:00:00.000Z', 'status': 'done', 'detail': 'upload_link'},
    {'step': 'read', 'at': '2026-10-09T15:00:02.000Z', 'status': 'done', 'detail': 'ocr'},
    {'step': 'identified', 'at': '2026-10-09T15:00:02.000Z', 'status': 'done', 'detail': 'upload_link'},
    {'step': 'decided', 'at': '2026-10-09T15:00:03.000Z', 'status': 'done', 'detail': 'auto'},
    {'step': 'payment', 'at': '2026-10-09T15:00:03.000Z', 'status': 'done', 'detail': null},
    {'step': 'receipt', 'at': '2026-10-09T15:00:05.000Z', 'status': 'done', 'detail': null},
    {'step': 'delivered', 'at': null, 'status': 'failed', 'detail': 'email:failed'},
  ],
  'paymentSeconds': 3,
  'deliveredSeconds': null,
});

void main() {
  testWidgets('soporte: la cola de fallidos muestra cada caso con su reintento, y el respaldo pide volver a crearse', (tester) async {
    await tester.pumpWidget(
      harness(
        const Scaffold(body: SingleChildScrollView(child: SupportSection(canRetry: true))),
        store: MemorySessionStore(savedLocale: 'es'),
        overrides: [failuresProvider.overrideWith((ref) async => _failures)],
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Estado de cuenta · CT-000001'), findsOneWidget);
    expect(find.textContaining('Chromium no respondió'), findsOneWidget);
    expect(find.text('María José Pérez Gómez'), findsOneWidget);
    expect(find.text('Reintentar'), findsNWidgets(2));
    expect(find.text('Pida el respaldo otra vez'), findsOneWidget);
    await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
    await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
    await expectLater(tester, meetsGuideline(textContrastGuideline));
  });

  testWidgets('traza del comprobante: cada etapa con su estado en texto, no solo con el icono', (tester) async {
    await tester.pumpWidget(
      harness(
        const Scaffold(
          body: SingleChildScrollView(child: IntakeTraceCard(intakeId: '7a2c0000-0000-4000-8000-000000000020')),
        ),
        store: MemorySessionStore(savedLocale: 'es'),
        overrides: [intakeTraceProvider.overrideWith((ref, id) async => _trace)],
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Recibido'), findsOneWidget);
    expect(find.text('Pago registrado'), findsOneWidget);
    expect(find.textContaining('Falló · email:failed'), findsOneWidget);
    expect(find.text('Pago registrado 3 s después de llegar'), findsOneWidget);
    await expectLater(tester, meetsGuideline(textContrastGuideline));
  });
}
