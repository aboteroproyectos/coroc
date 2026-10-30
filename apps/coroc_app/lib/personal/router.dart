import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/auth/auth_controller.dart';
import '../core/desktop/desktop_runtime.dart';
import '../design/tokens.dart';
import '../features/auth/enroll_page.dart';
import '../features/auth/mfa_page.dart';
import '../features/desktop/desktop_splash.dart';
import '../features/desktop/password_reset.dart';
import '../features/help/help_page.dart';
import 'pages/client_page.dart';
import 'pages/clients_page.dart';
import 'pages/home_page.dart';
import 'pages/login_page.dart';
import 'pages/new_loan_page.dart';
import 'pages/receipts_page.dart';
import 'pages/send_page.dart';
import 'pages/settings_page.dart';
import 'pages/welcome_page.dart';
import 'shell.dart';

/// Rutas del nuevo COROC (Fase 11). Primero el servidor de este PC; sin empresa todavía, el primer uso; sin sesión,
/// el ingreso. Adentro, cinco secciones: Inicio, Clientes, Nuevo préstamo, Comprobantes y Configuración.
final personalRouterProvider = Provider<GoRouter>((ref) {
  final auth = ValueNotifier<AuthState>(ref.read(authProvider));
  ref.listen<AuthState>(authProvider, (_, next) => auth.value = next);
  final desktop = ValueNotifier<DesktopState>(ref.read(desktopProvider));
  ref.listen<DesktopState>(desktopProvider, (_, next) => desktop.value = next);

  String? guard(BuildContext context, GoRouterState state) {
    final loc = state.matchedLocation;
    final d = desktop.value;
    if (!d.ready) return loc == '/splash' ? null : '/splash';
    if (!d.configured) return loc == '/bienvenida' ? null : '/bienvenida';
    if (loc == '/bienvenida') return '/splash';
    final public = loc == '/ingresar' || loc == '/ingresar/olvido';
    return switch (auth.value) {
      AuthLoading() => loc == '/splash' ? null : '/splash',
      SignedOut() => public ? null : '/ingresar',
      MfaChallenge() => loc == '/ingresar/codigo' ? null : '/ingresar/codigo',
      EnrollRequired() => loc == '/ingresar/activar' ? null : '/ingresar/activar',
      SignedIn() => (public || loc.startsWith('/ingresar') || loc == '/splash') ? '/inicio' : null,
    };
  }

  final router = GoRouter(
    initialLocation: '/splash',
    refreshListenable: Listenable.merge([auth, desktop]),
    redirect: guard,
    routes: [
      GoRoute(path: '/splash', builder: (_, _) => const DesktopSplash()),
      GoRoute(path: '/bienvenida', builder: (_, _) => const PersonalWelcomePage()),
      GoRoute(path: '/ingresar', builder: (_, _) => const PersonalLoginPage()),
      GoRoute(
        path: '/ingresar/olvido',
        builder: (_, _) => const DesktopPasswordReset(backRoute: '/ingresar'),
      ),
      GoRoute(path: '/ingresar/codigo', builder: (_, _) => const MfaPage()),
      GoRoute(path: '/ingresar/activar', builder: (_, _) => const EnrollPage()),
      ShellRoute(
        builder: (context, state, child) => PersonalShell(location: state.matchedLocation, child: child),
        routes: [
          GoRoute(path: '/inicio', pageBuilder: (_, s) => _fade(s, const HomePage())),
          GoRoute(
            path: '/clientes',
            pageBuilder: (_, s) => _fade(s, ClientsPage(initialQuery: s.uri.queryParameters['q'] ?? '')),
            routes: [
              GoRoute(
                path: ':id',
                pageBuilder: (_, s) => _fade(s, PersonalClientPage(clientId: s.pathParameters['id']!)),
              ),
            ],
          ),
          GoRoute(
            path: '/prestamo',
            pageBuilder: (_, s) => _fade(s, NewLoanPage(clientId: s.uri.queryParameters['cliente'])),
          ),
          GoRoute(
            path: '/comprobantes',
            pageBuilder: (_, s) => _fade(s, ReceiptsPage(focusId: s.uri.queryParameters['id'])),
          ),
          GoRoute(path: '/enviar', pageBuilder: (_, s) => _fade(s, const SendPage())),
          GoRoute(path: '/configuracion', pageBuilder: (_, s) => _fade(s, const PersonalSettingsPage())),
          GoRoute(path: '/ayuda', pageBuilder: (_, s) => _fade(s, const HelpPage())),
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
