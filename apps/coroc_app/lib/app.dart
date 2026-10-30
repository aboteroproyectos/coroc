import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'core/auth/auth_controller.dart';
import 'core/desktop/desktop_runtime.dart';
import 'core/l10n.dart';
import 'core/providers.dart';
import 'design/theme.dart';
import 'design/tokens.dart';
import 'design/widgets/brand.dart';
import 'features/auth/enroll_page.dart';
import 'features/auth/forgot_page.dart';
import 'features/auth/login_page.dart';
import 'features/auth/mfa_page.dart';
import 'features/clients/client_page.dart';
import 'features/clients/clients_page.dart';
import 'features/dashboard/dashboard_page.dart';
import 'features/desktop/desktop_splash.dart';
import 'features/desktop/desktop_window.dart';
import 'features/desktop/welcome_page.dart';
import 'features/help/help_page.dart';
import 'features/inbox/inbox_page.dart';
import 'features/loans/new_loan_page.dart';
import 'features/messaging/messages_page.dart';
import 'features/messaging/templates_page.dart';
import 'features/messaging/today_messages_page.dart';
import 'features/new_client/new_client_page.dart';
import 'features/reports/reports_page.dart';
import 'features/settings/settings_page.dart';
import 'features/shell/app_shell.dart';
import 'features/shell/security_layer.dart';
import 'features/today/today_page.dart';

final routerProvider = Provider<GoRouter>((ref) {
  final auth = ValueNotifier<AuthState>(ref.read(authProvider));
  ref.listen<AuthState>(authProvider, (_, next) => auth.value = next);
  final desktopMode = ref.read(desktopModeProvider);
  final desktop = ValueNotifier<DesktopState>(ref.read(desktopProvider));
  ref.listen<DesktopState>(desktopProvider, (_, next) => desktop.value = next);

  String? guard(BuildContext context, GoRouterState state) {
    final a = auth.value;
    final loc = state.matchedLocation;
    final public = loc == '/login' || loc == '/forgot';
    // COROC Escritorio (ADR-062): primero el servidor de este PC; sin empresa todavía, el asistente de primer uso.
    if (desktopMode) {
      final d = desktop.value;
      if (!d.ready) return loc == '/splash' ? null : '/splash';
      if (!d.configured) return loc == '/bienvenida' ? null : '/bienvenida';
      if (loc == '/bienvenida') return '/splash';
    }
    return switch (a) {
      AuthLoading() => loc == '/splash' ? null : '/splash',
      SignedOut() => public ? null : '/login',
      MfaChallenge() => loc == '/login/mfa' ? null : '/login/mfa',
      EnrollRequired() => loc == '/login/enroll' ? null : '/login/enroll',
      SignedIn(:final session) =>
        (public || loc.startsWith('/login') || loc == '/splash')
            ? '/dashboard'
            : (loc == '/clients/new' && !session.user.can('clients.create'))
            ? '/clients'
            : null,
    };
  }

  final router = GoRouter(
    initialLocation: '/splash',
    refreshListenable: Listenable.merge([auth, desktop]),
    redirect: guard,
    routes: [
      GoRoute(path: '/splash', builder: (_, _) => desktopMode ? const DesktopSplash() : const _Splash()),
      GoRoute(path: '/bienvenida', builder: (_, _) => const WelcomePage()),
      GoRoute(path: '/login', builder: (_, _) => const LoginPage()),
      GoRoute(path: '/login/mfa', builder: (_, _) => const MfaPage()),
      GoRoute(path: '/login/enroll', builder: (_, _) => const EnrollPage()),
      GoRoute(path: '/forgot', builder: (_, _) => const ForgotPage()),
      ShellRoute(
        builder: (context, state, child) => AppShell(location: state.matchedLocation, child: child),
        routes: [
          GoRoute(path: '/dashboard', pageBuilder: (_, s) => _fade(s, const DashboardPage())),
          GoRoute(path: '/today', pageBuilder: (_, s) => _fade(s, const TodayPage())),
          GoRoute(
            path: '/clients',
            pageBuilder: (_, s) => _fade(s, ClientsPage(focusSearch: s.uri.queryParameters['focus'] == '1')),
            routes: [
              GoRoute(path: 'new', pageBuilder: (_, s) => _fade(s, const NewClientPage())),
              GoRoute(
                path: ':id',
                pageBuilder: (_, s) => _fade(s, ClientPage(clientId: s.pathParameters['id']!)),
              ),
              GoRoute(
                path: ':id/loans/new',
                pageBuilder: (_, s) => _fade(s, NewLoanPage(clientId: s.pathParameters['id']!)),
              ),
            ],
          ),
          GoRoute(
            path: '/inbox',
            pageBuilder: (_, s) => _fade(s, InboxPage(focusId: s.uri.queryParameters['id'])),
          ),
          GoRoute(
            path: '/messages',
            pageBuilder: (_, s) => _fade(s, const MessagesPage()),
            routes: [
              GoRoute(path: 'templates', pageBuilder: (_, s) => _fade(s, const TemplatesPage())),
              GoRoute(path: 'today', pageBuilder: (_, s) => _fade(s, const TodayMessagesPage())),
            ],
          ),
          GoRoute(path: '/reports', pageBuilder: (_, s) => _fade(s, const ReportsPage())),
          GoRoute(path: '/settings', pageBuilder: (_, s) => _fade(s, const SettingsPage())),
          GoRoute(path: '/help', pageBuilder: (_, s) => _fade(s, const HelpPage())),
        ],
      ),
    ],
  );
  ref.onDispose(() {
    auth.dispose();
    desktop.dispose();
    router.dispose();
  });
  return router;
});

CustomTransitionPage<void> _fade(GoRouterState state, Widget child) => CustomTransitionPage<void>(
  key: state.pageKey,
  child: child,
  transitionDuration: CorocMotion.normal,
  transitionsBuilder: (context, animation, _, child) => FadeTransition(
    opacity: CurvedAnimation(parent: animation, curve: CorocMotion.curve),
    child: child,
  ),
);

class CorocApp extends ConsumerWidget {
  const CorocApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp.router(
      title: 'COROC',
      debugShowCheckedModeBanner: false,
      theme: CorocTheme.light(),
      darkTheme: CorocTheme.dark(),
      themeMode: ref.watch(themeModeProvider),
      locale: ref.watch(localeProvider),
      supportedLocales: const [Locale('es'), Locale('pt'), Locale('en')],
      localizationsDelegates: const [AppLocalizations.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
      routerConfig: ref.watch(routerProvider),
      // Tamaño de la letra elegido en este equipo (Fase 10) y, en Escritorio, la ventana y la bandeja.
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(ref.watch(textScaleProvider))),
        child: DesktopWindow(
          router: ref.watch(routerProvider),
          child: SecurityLayer(child: child ?? const SizedBox.shrink()),
        ),
      ),
    );
  }
}

class _Splash extends StatelessWidget {
  const _Splash();
  @override
  Widget build(BuildContext context) => const Scaffold(body: Center(child: CorocLogo(height: 160)));
}
