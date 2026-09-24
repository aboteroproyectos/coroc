import 'dart:async';
import 'dart:io' show Platform;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_exception.dart';
import '../models/models.dart';
import '../providers.dart';
import '../offline/offline_sync.dart';

sealed class AuthState {
  const AuthState();
}

class AuthLoading extends AuthState {
  const AuthLoading();
}

class SignedOut extends AuthState {
  const SignedOut({this.expired = false});
  final bool expired;
}

class MfaChallenge extends AuthState {
  const MfaChallenge(this.challengeId);
  final String challengeId;
}

/// El Propietario debe activar el segundo factor antes de usar la app (§7.1).
class EnrollRequired extends AuthState {
  const EnrollRequired(this.session);
  final Session session;
}

class SignedIn extends AuthState {
  const SignedIn(this.session, {this.locked = false});
  final Session session;

  /// Bloqueo por inactividad: los datos quedan ocultos hasta desbloquear (§7.1).
  final bool locked;
  User get user => session.user;
  CompanyBrief get company => session.company;
}

class AuthController extends Notifier<AuthState> {
  @override
  AuthState build() {
    final client = ref.read(apiClientProvider);
    client.onSessionLost = () {
      if (state is SignedIn || state is EnrollRequired) state = const SignedOut(expired: true);
    };
    client.onSessionRefreshed = (json) {
      final s = Session.fromJson(json);
      final current = state;
      if (current is SignedIn) state = SignedIn(s, locked: current.locked);
    };
    Future.microtask(_restore);
    return const AuthLoading();
  }

  Future<void> _restore() async {
    final store = ref.read(sessionStoreProvider);
    final token = await store.refreshToken();
    if (token == null) {
      state = const SignedOut();
      return;
    }
    try {
      await _accept(await ref.read(apiProvider).refresh(token, await store.deviceId()));
    } on ApiException catch (e) {
      // Solo un rechazo del servidor invalida la sesión; sin red se conserva para el próximo intento.
      if (e.status == 401 || e.status == 403) await store.saveRefreshToken(null);
      state = const SignedOut();
    }
  }

  Future<void> _accept(Session s) async {
    ref.read(apiClientProvider).setAccessToken(s.accessToken);
    await ref.read(sessionStoreProvider).saveRefreshToken(s.refreshToken);
    await ref.read(localeProvider.notifier).set(s.user.lang);
    await ref.read(themeModeProvider.notifier).set(ThemeController.parse(s.user.theme));
    state = s.mfaEnrollmentRequired ? EnrollRequired(s) : SignedIn(s);
  }

  /// Devuelve normalmente; los errores (credenciales, bloqueo) llegan como ApiException ya traducida.
  Future<void> login({required String tenant, required String username, required String password, required bool remember}) async {
    final store = ref.read(sessionStoreProvider);
    final res = await ref.read(apiProvider).login(tenant: tenant.trim().toLowerCase(), username: username.trim().toLowerCase(), password: password, deviceId: await store.deviceId(), deviceName: _deviceName());
    await store.saveLastLogin(tenant.trim().toLowerCase(), username.trim().toLowerCase(), remember: remember);
    if (res['mfa_required'] == true) {
      state = MfaChallenge(res['challengeId'] as String);
      return;
    }
    await _accept(Session.fromJson(res));
  }

  Future<void> verifyMfa(String code) async {
    final s = state;
    if (s is! MfaChallenge) return;
    await _accept(await ref.read(apiProvider).verifyMfa(s.challengeId, code));
  }

  Future<MfaEnrollment> startEnrollment() => ref.read(apiProvider).enrollMfa();

  Future<void> confirmEnrollment(String code) async => _accept(await ref.read(apiProvider).confirmMfa(code));

  void cancelChallenge() => state = const SignedOut();

  Future<void> logout() async {
    try {
      await ref.read(apiProvider).logout();
    } on ApiException {
      // Sin conexión: la sesión igual se cierra en este dispositivo.
    }
    await ref.read(sessionStoreProvider).saveRefreshToken(null);
    ref.read(apiClientProvider).setAccessToken(null);
    // Las lecturas guardadas se borran al salir; los pagos pendientes se conservan para enviarlos al volver a ingresar.
    await _clearOffline(queue: false);
    state = const SignedOut();
  }

  Future<void> _clearOffline({required bool queue}) async {
    try {
      await ref.read(offlineCacheProvider).clear();
      await ref.read(offlineDocumentsProvider).clear();
      if (queue) await ref.read(paymentQueueProvider).clear();
    } on Object {
      // Sin almacén en esta plataforma: no hay nada que borrar.
    }
  }

  /// Tras eliminar la cuenta o cerrar la empresa: el servidor ya cerró las sesiones; aquí solo se olvidan los tokens.
  Future<void> forgetSession() async {
    await _clearOffline(queue: true);
    await ref.read(sessionStoreProvider).saveRefreshToken(null);
    ref.read(apiClientProvider).setAccessToken(null);
    state = const SignedOut();
  }

  void lock() {
    final s = state;
    if (s is SignedIn && !s.locked) state = SignedIn(s.session, locked: true);
  }

  void unlock() {
    final s = state;
    if (s is SignedIn && s.locked) state = SignedIn(s.session);
  }

  void updateUser(User user) {
    final s = state;
    if (s is SignedIn) state = SignedIn(s.session.copyWith(user: user), locked: s.locked);
  }

  /// Relee los datos de la empresa (p. ej. después de una restauración, §19, que puede cambiar su nombre).
  Future<void> refreshCompany() async {
    final s = state;
    if (s is! SignedIn) return;
    final c = await ref.read(apiProvider).company();
    state = SignedIn(
      s.session.copyWith(company: s.session.company.copyWith(name: c.name, currency: c.currency, country: c.country, timezone: c.timezone, lang: c.lang)),
      locked: s.locked,
    );
  }

  /// Nombre legible del equipo para la lista de sesiones abiertas (sin datos personales).
  String _deviceName() => 'COROC · ${Platform.operatingSystem}';
}

final authProvider = NotifierProvider<AuthController, AuthState>(AuthController.new);

/// Sesión vigente (solo cuando hay usuario conectado).
final sessionProvider = Provider<Session?>((ref) {
  final s = ref.watch(authProvider);
  return s is SignedIn ? s.session : (s is EnrollRequired ? s.session : null);
});
