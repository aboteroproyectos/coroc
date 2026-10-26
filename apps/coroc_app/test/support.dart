import 'package:coroc/core/auth/session_store.dart';

/// Almacén de sesión en memoria para las pruebas (sin canales de plataforma).
class MemorySessionStore implements SessionStore {
  MemorySessionStore({this.refresh, this.savedLocale});
  String? refresh;
  String? savedLocale;
  String? savedTheme;
  String? tenant;
  String? username;
  bool remember = false;
  String? folder;
  bool asked = false;
  int refreshWrites = 0;
  bool hello = false;
  double? scale;
  bool tour = false;
  bool trayHint = false;
  bool downloads = true;

  @override
  Future<String> deviceId() async => 'coroc-test-device-0001';

  @override
  Future<String?> refreshToken() async => refresh;

  @override
  Future<void> saveRefreshToken(String? token) async {
    refreshWrites++;
    refresh = token;
  }

  @override
  Future<({String? tenant, String? username, bool remember})> lastLogin() async => (tenant: tenant, username: remember ? username : null, remember: remember);

  @override
  Future<void> saveLastLogin(String tenant, String username, {required bool remember}) async {
    this.tenant = tenant;
    this.username = username;
    this.remember = remember;
  }

  @override
  Future<String?> locale() async => savedLocale;

  @override
  Future<void> saveLocale(String code) async => savedLocale = code;

  @override
  Future<String?> theme() async => savedTheme;

  @override
  Future<void> saveTheme(String mode) async => savedTheme = mode;

  @override
  Future<String?> folderConfig() async => folder;

  @override
  Future<void> saveFolderConfig(String? json) async => folder = json;

  @override
  Future<bool> folderAsked() async => asked;

  @override
  Future<void> saveFolderAsked() async => asked = true;

  @override
  Future<bool> helloEnabled() async => hello;

  @override
  Future<void> saveHelloEnabled(bool on) async => hello = on;

  @override
  Future<double?> textScale() async => scale;

  @override
  Future<void> saveTextScale(double value) async => scale = value;

  @override
  Future<bool> tourDone() async => tour;

  @override
  Future<void> saveTourDone() async => tour = true;

  @override
  Future<bool> trayHintShown() async => trayHint;

  @override
  Future<void> saveTrayHintShown() async => trayHint = true;

  @override
  Future<bool> watchDownloads() async => downloads;

  @override
  Future<void> saveWatchDownloads(bool on) async => downloads = on;
}
