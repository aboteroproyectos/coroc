/// Configuración de compilación. La URL del servidor se fija al compilar:
///   flutter build apk --dart-define=COROC_API=https://api.coroc.app/v1
abstract final class AppConfig {
  static const apiBaseUrl = String.fromEnvironment('COROC_API', defaultValue: 'http://localhost:3000/v1');
  static const appVersion = String.fromEnvironment('COROC_VERSION', defaultValue: '0.5.0');
}
