// WCAG 2.2 AA (§5.2, §10): contraste de texto (1.4.3), área táctil mínima (2.5.8), nombre accesible de cada control
// (4.1.2) y texto al 200 % sin pérdida de contenido (1.4.4), en las pantallas clave, en modo claro y oscuro.
import 'package:coroc/core/offline/offline_store.dart';
import 'package:coroc/core/offline/offline_sync.dart';
import 'package:coroc/features/auth/login_page.dart';
import 'package:coroc/features/loans/payment_sheet.dart';
import 'package:coroc/features/shell/offline_banner.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support.dart';
import 'widgets_test.dart' show harness;

Future<void> _meetsAll(WidgetTester tester) async {
  await expectLater(tester, meetsGuideline(textContrastGuideline));
  await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
  await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
  await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
}

Widget _scaled(Widget child, double scale) => Builder(builder: (context) => MediaQuery(data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(scale)), child: child));

void main() {
  for (final mode in [ThemeMode.light, ThemeMode.dark]) {
    testWidgets('ingreso (${mode.name}): contraste, áreas táctiles y etiquetas', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(harness(const LoginPage(), store: MemorySessionStore(savedLocale: 'es'), mode: mode));
      await tester.pumpAndSettle();
      await _meetsAll(tester);
      handle.dispose();
    });

    testWidgets('registro de pago (${mode.name}): contraste, áreas táctiles y etiquetas', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(harness(
        const Scaffold(body: PaymentForm(loanId: '7a2c0000-0000-4000-8000-000000000003', currency: 'COP', suggested: 60000, clientName: 'María José Pérez Gómez')),
        store: MemorySessionStore(savedLocale: 'es'),
        mode: mode,
      ));
      await tester.pump(const Duration(milliseconds: 50));
      await _meetsAll(tester);
      handle.dispose();
    });
  }

  testWidgets('texto al 200 %: ingreso y registro de pago no pierden contenido ni se desbordan', (tester) async {
    tester.view.physicalSize = const Size(1080, 2340);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(harness(_scaled(const LoginPage(), 2), store: MemorySessionStore(savedLocale: 'es')));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.text('Ingresar'), findsWidgets);
    await tester.pumpWidget(harness(
      _scaled(const Scaffold(body: PaymentForm(loanId: '7a2c0000-0000-4000-8000-000000000003', currency: 'COP', suggested: 60000, clientName: 'María José Pérez Gómez')), 2),
      store: MemorySessionStore(savedLocale: 'es'),
    ));
    await tester.pump(const Duration(milliseconds: 50));
    expect(tester.takeException(), isNull);
  });

  testWidgets('aviso sin conexión: región viva, contraste y área táctil', (tester) async {
    final handle = tester.ensureSemantics();
    final vault = MemoryVault();
    await PaymentQueue(vault).add(PendingPayment(key: 'k1', userId: 'u1', loanId: 'l1', amount: 60000, date: '2026-10-09', createdAt: DateTime(2026, 10, 9), clientName: 'María José Pérez Gómez', currency: 'COP'));
    await tester.pumpWidget(harness(
      const Scaffold(body: Column(children: [OfflineBanner()])),
      store: MemorySessionStore(savedLocale: 'es'),
      overrides: [offlineVaultProvider.overrideWithValue(vault)],
    ));
    await tester.pumpAndSettle();
    expect(find.textContaining('1 pago por enviar'), findsOneWidget);
    final node = tester.getSemantics(find.byType(OfflineBanner));
    expect(node.flagsCollection.isLiveRegion, isTrue);
    await _meetsAll(tester);
    handle.dispose();
  });
}
