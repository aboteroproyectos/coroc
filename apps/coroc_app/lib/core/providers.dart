import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api/api_client.dart';
import 'api/coroc_api.dart';
import 'auth/session_store.dart';
import 'config.dart';

final sessionStoreProvider = Provider<SessionStore>((ref) => SessionStore());

/// Idiomas soportados (§6): español (base), portugués de Brasil e inglés.
const supportedLanguages = ['es', 'pt', 'en'];

/// Idioma de la interfaz: cambia al instante, sin reiniciar la app (CA-14), y se guarda por usuario.
class LocaleController extends Notifier<Locale> {
  @override
  Locale build() {
    Future.microtask(_restore);
    final device = ui.PlatformDispatcher.instance.locale.languageCode;
    return Locale(supportedLanguages.contains(device) ? device : 'es');
  }

  Future<void> _restore() async {
    final saved = await ref.read(sessionStoreProvider).locale();
    if (saved != null && supportedLanguages.contains(saved) && saved != state.languageCode) state = Locale(saved);
  }

  Future<void> set(String code) async {
    final c = code == 'pt-BR' ? 'pt' : code;
    if (!supportedLanguages.contains(c)) return;
    state = Locale(c);
    await ref.read(sessionStoreProvider).saveLocale(c);
  }

  /// Código que usa la API: es, pt-BR, en.
  String get apiCode => state.languageCode == 'pt' ? 'pt-BR' : state.languageCode;
}

final localeProvider = NotifierProvider<LocaleController, Locale>(LocaleController.new);

/// Modos «Marfil» y «Medianoche» (§5.4): por defecto sigue al sistema operativo.
class ThemeController extends Notifier<ThemeMode> {
  @override
  ThemeMode build() {
    Future.microtask(() async {
      final saved = await ref.read(sessionStoreProvider).theme();
      if (saved != null) state = parse(saved);
    });
    return ThemeMode.system;
  }

  static ThemeMode parse(String v) => v == 'light' ? ThemeMode.light : (v == 'dark' ? ThemeMode.dark : ThemeMode.system);
  static String name(ThemeMode m) => m == ThemeMode.light ? 'light' : (m == ThemeMode.dark ? 'dark' : 'system');

  Future<void> set(ThemeMode mode) async {
    state = mode;
    await ref.read(sessionStoreProvider).saveTheme(name(mode));
  }
}

final themeModeProvider = NotifierProvider<ThemeController, ThemeMode>(ThemeController.new);

final apiClientProvider = Provider<ApiClient>((ref) {
  final client = ApiClient(
    baseUrl: AppConfig.apiBaseUrl,
    store: ref.watch(sessionStoreProvider),
    language: () => ref.read(localeProvider).languageCode,
  );
  ref.onDispose(client.close);
  return client;
});

final apiProvider = Provider<CorocApi>((ref) => CorocApi(ref.watch(apiClientProvider)));
