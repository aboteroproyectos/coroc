import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

/// Almacenamiento seguro del sistema (Keychain, Keystore, DPAPI). Aquí solo viven el identificador del dispositivo,
/// el token de renovación y preferencias sin datos personales. La app no guarda datos de clientes en el equipo (ADR-023).
class SessionStore {
  SessionStore([FlutterSecureStorage? storage]) : _s = storage ?? const FlutterSecureStorage();
  final FlutterSecureStorage _s;

  static const _device = 'coroc.device_id';
  static const _refresh = 'coroc.refresh_token';
  static const _tenant = 'coroc.last_tenant';
  static const _username = 'coroc.last_username';
  static const _locale = 'coroc.locale';
  static const _theme = 'coroc.theme';
  static const _remember = 'coroc.remember';
  static const _folder = 'coroc.folder';
  static const _folderAsked = 'coroc.folder_asked';

  Future<String> deviceId() async {
    final existing = await _s.read(key: _device);
    if (existing != null && existing.length >= 8) return existing;
    final id = 'coroc-${const Uuid().v4()}';
    await _s.write(key: _device, value: id);
    return id;
  }

  Future<String?> refreshToken() => _s.read(key: _refresh);
  Future<void> saveRefreshToken(String? token) => token == null ? _s.delete(key: _refresh) : _s.write(key: _refresh, value: token);

  Future<({String? tenant, String? username, bool remember})> lastLogin() async {
    final remember = (await _s.read(key: _remember)) == '1';
    return (tenant: await _s.read(key: _tenant), username: remember ? await _s.read(key: _username) : null, remember: remember);
  }

  Future<void> saveLastLogin(String tenant, String username, {required bool remember}) async {
    await _s.write(key: _tenant, value: tenant);
    await _s.write(key: _remember, value: remember ? '1' : '0');
    if (remember) {
      await _s.write(key: _username, value: username);
    } else {
      await _s.delete(key: _username);
    }
  }

  Future<String?> locale() => _s.read(key: _locale);
  Future<void> saveLocale(String code) => _s.write(key: _locale, value: code);
  Future<String?> theme() => _s.read(key: _theme);
  Future<void> saveTheme(String mode) => _s.write(key: _theme, value: mode);

  /// Carpeta COROC de este dispositivo (§16.2): ruta, URI de Android o marcador de macOS. No contiene datos de clientes.
  Future<String?> folderConfig() => _s.read(key: _folder);
  Future<void> saveFolderConfig(String? json) => json == null ? _s.delete(key: _folder) : _s.write(key: _folder, value: json);

  /// Si ya se explicó y se pidió permiso para crear la carpeta en este dispositivo (se pregunta una sola vez).
  Future<bool> folderAsked() async => (await _s.read(key: _folderAsked)) == '1';
  Future<void> saveFolderAsked() => _s.write(key: _folderAsked, value: '1');
}
