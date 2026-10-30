import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/l10n.dart';
import '../core/providers.dart';
import '../features/desktop/desktop_window.dart';
import '../features/shell/security_layer.dart';
import 'router.dart';
import 'ui/bank.dart';

/// Nuevo COROC (Fase 11): la app de Escritorio para una sola persona, la dueña de los préstamos. Cinco secciones,
/// diseño de banca privada y el mismo motor probado por dentro (servidor de este PC, lectura de comprobantes, recibos,
/// Gmail y copias). La ventana, la bandeja y el bloqueo son los de COROC Escritorio.
class PersonalApp extends ConsumerWidget {
  const PersonalApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(personalRouterProvider);
    return MaterialApp.router(
      title: 'COROC',
      debugShowCheckedModeBanner: false,
      theme: bankTheme(),
      themeMode: ThemeMode.light,
      locale: ref.watch(localeProvider),
      supportedLocales: const [Locale('es'), Locale('pt'), Locale('en')],
      localizationsDelegates: const [AppLocalizations.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
      routerConfig: router,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(ref.watch(textScaleProvider))),
        child: DesktopWindow(
          router: router,
          messagesRoute: '/enviar',
          child: SecurityLayer(child: child ?? const SizedBox.shrink()),
        ),
      ),
    );
  }
}
