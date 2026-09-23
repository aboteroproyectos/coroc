import 'package:coroc/core/l10n.dart';
import 'package:coroc/core/providers.dart';
import 'package:coroc/design/theme.dart';
import 'package:coroc/design/widgets/brand.dart';
import 'package:coroc/design/widgets/common.dart';
import 'package:coroc/features/auth/login_page.dart';
import 'package:coroc/features/help/help_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support.dart';

/// App mínima con los tres idiomas y el tema de COROC, sin red ni almacenamiento de plataforma.
Widget harness(Widget home, {MemorySessionStore? store, ThemeMode mode = ThemeMode.light}) => ProviderScope(
      overrides: [sessionStoreProvider.overrideWithValue(store ?? MemorySessionStore())],
      child: Consumer(
        builder: (context, ref, _) => MaterialApp(
          theme: CorocTheme.light(),
          darkTheme: CorocTheme.dark(),
          themeMode: mode,
          locale: ref.watch(localeProvider),
          supportedLocales: const [Locale('es'), Locale('pt'), Locale('en')],
          localizationsDelegates: const [AppLocalizations.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
          home: home,
        ),
      ),
    );

void main() {
  testWidgets('CA-14: el idioma cambia al instante desde la pantalla de ingreso, sin reiniciar', (tester) async {
    final store = MemorySessionStore(savedLocale: 'es');
    await tester.pumpWidget(harness(const LoginPage(), store: store));
    await tester.pumpAndSettle();
    expect(find.text('Ingresar'), findsOneWidget);
    expect(find.text('Código de la empresa'), findsOneWidget);

    await tester.tap(find.text('PT'));
    await tester.pumpAndSettle();
    expect(find.text('Entrar'), findsOneWidget);
    expect(find.text('Código da empresa'), findsOneWidget);
    expect(store.savedLocale, 'pt');

    await tester.tap(find.text('EN'));
    await tester.pumpAndSettle();
    expect(find.text('Sign in'), findsOneWidget);
    expect(find.text('Company code'), findsOneWidget);
    expect(store.savedLocale, 'en');
  });

  testWidgets('ingreso: valida campos vacíos sin llamar al servidor', (tester) async {
    await tester.pumpWidget(harness(const LoginPage(), store: MemorySessionStore(savedLocale: 'es')));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Ingresar'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Ingresar'));
    await tester.pumpAndSettle();
    expect(find.text('Obligatorio'), findsNWidgets(3));
  });

  testWidgets('ingreso en modo Medianoche y pantalla de teléfono sin desbordes', (tester) async {
    tester.view.physicalSize = const Size(360, 740);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(harness(const LoginPage(), store: MemorySessionStore(savedLocale: 'pt'), mode: ThemeMode.dark));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.text('Entrar'), findsOneWidget);
  });

  testWidgets('botón dorado y estados dentro de filas (sin restricciones de ancho)', (tester) async {
    var taps = 0;
    await tester.pumpWidget(harness(Scaffold(
      body: Column(children: [
        Row(children: [
          GoldButton(label: 'Confirmar pago', icon: Icons.check, onPressed: () => taps++),
          const Spacer(),
          const StatusDot(label: 'Vencida', tone: StatusTone.error),
        ]),
        const Row(children: [GoldButton(label: 'Guardando', onPressed: null, busy: true)]),
      ]),
    )));
    await tester.pump();
    expect(tester.takeException(), isNull);
    await tester.tap(find.text('Confirmar pago'));
    expect(taps, 1);
    await tester.tap(find.text('Guardando'), warnIfMissed: false);
    expect(taps, 1);
  });

  testWidgets('ayuda: búsqueda sin tildes encuentra el tema y cambia de idioma', (tester) async {
    await tester.pumpWidget(harness(const Scaffold(body: HelpPage()), store: MemorySessionStore(savedLocale: 'es')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'usura');
    await tester.pumpAndSettle();
    expect(find.text('Topes legales y tasa de usura'), findsOneWidget);
    expect(find.text('Registrar un pago'), findsNothing);
    await tester.enterText(find.byType(TextField), 'reversar');
    await tester.pumpAndSettle();
    expect(find.text('Reversar un pago'), findsOneWidget);
    // Temas de la Fase 2.
    await tester.enterText(find.byType(TextField), 'anulado');
    await tester.pumpAndSettle();
    expect(find.text('Documentos y recibos en PDF'), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'renombra');
    await tester.pumpAndSettle();
    expect(find.text('Carpeta COROC'), findsOneWidget);
  });
}
