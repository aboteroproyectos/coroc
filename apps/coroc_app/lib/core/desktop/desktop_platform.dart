import 'dart:async';
import 'dart:typed_data';

/// Lo que COROC Escritorio necesita de Windows (ADR-062, ADR-064): el servidor de este PC, la ventana y la bandeja,
/// el inicio con Windows, WhatsApp para Windows, el portapapeles, la carpeta Descargas y Windows Hello.
/// La implementación real está en `windows_platform.dart`; las pruebas usan una falsa.
abstract class DesktopPlatform {
  /// Carpeta `servidor` de la instalación (node.exe, la API, PostgreSQL, Tesseract), o null si falta.
  String? serverFolder();

  /// Enciende el supervisor (`node cli.js iniciar`), que avisa cada paso con una línea JSON.
  Future<ServerProcess> startServer(String folder);

  Future<void> initWindow();
  Future<void> showWindow();
  Future<void> hideWindow();

  /// Cierra la app del todo (después de apagar el servidor).
  Future<void> quit();

  /// Ícono «COROC sigue trabajando» junto al reloj, con su menú.
  Future<void> setTray({required String tooltip, required List<TrayEntry> items});

  /// Cerrar la ventana, volver a ella y los toques en la bandeja.
  Stream<WindowSignal> get signals;

  Future<bool> autostartEnabled();

  /// «Iniciar COROC con Windows»: abre COROC en la bandeja al entrar a Windows.
  Future<void> setAutostart(bool on);

  Future<bool> whatsAppInstalled();
  Future<bool> openUrl(String url);

  /// Guarda el PDF en la carpeta temporal de COROC y lo deja en el portapapeles como si se copiara en el Explorador:
  /// en WhatsApp se pega con Ctrl+V.
  Future<bool> copyPdfToClipboard(String fileName, List<int> bytes);

  /// Imagen o archivos copiados (Ctrl+V dentro de COROC).
  Future<ClipboardContent?> readClipboard();

  String? downloadsFolder();

  /// Comprobantes que van llegando a Descargas, ya completos («¿Es un comprobante?»).
  Stream<String> receiptDownloads();

  Future<bool> helloAvailable();

  /// Pide Windows Hello (rostro, huella o PIN); true si la persona lo confirmó.
  Future<bool> verifyUser(String reason);
}

/// Línea del menú de la bandeja.
class TrayEntry {
  const TrayEntry(this.key, this.label);
  final String key;
  final String label;
}

enum WindowSignalKind { closeRequested, focused, trayClicked, trayItem }

class WindowSignal {
  const WindowSignal(this.kind, [this.key]);
  final WindowSignalKind kind;

  /// Elemento del menú de la bandeja que se tocó.
  final String? key;
}

/// Lo que había en el portapapeles: archivos copiados en el Explorador o una imagen (PNG).
class ClipboardContent {
  const ClipboardContent({this.files = const [], this.image});
  final List<String> files;
  final Uint8List? image;
  bool get isEmpty => files.isEmpty && image == null;
}

/// El supervisor en marcha: sus eventos (una línea JSON por evento) y su entrada estándar.
abstract class ServerProcess {
  Stream<String> get lines;
  void send(String line);

  /// Termina cuando el supervisor se cierra (su salida estándar llega al final).
  Future<void> get done;
  void kill();
}

/// Fuera de Windows (pruebas, móviles): nada que hacer; COROC Escritorio solo existe para Windows.
class UnsupportedDesktopPlatform implements DesktopPlatform {
  const UnsupportedDesktopPlatform();
  @override
  String? serverFolder() => null;
  @override
  Future<ServerProcess> startServer(String folder) => Future.error(UnsupportedError('COROC Escritorio es para Windows'));
  @override
  Future<void> initWindow() async {}
  @override
  Future<void> showWindow() async {}
  @override
  Future<void> hideWindow() async {}
  @override
  Future<void> quit() async {}
  @override
  Future<void> setTray({required String tooltip, required List<TrayEntry> items}) async {}
  @override
  Stream<WindowSignal> get signals => const Stream.empty();
  @override
  Future<bool> autostartEnabled() async => false;
  @override
  Future<void> setAutostart(bool on) async {}
  @override
  Future<bool> whatsAppInstalled() async => false;
  @override
  Future<bool> openUrl(String url) async => false;
  @override
  Future<bool> copyPdfToClipboard(String fileName, List<int> bytes) async => false;
  @override
  Future<ClipboardContent?> readClipboard() async => null;
  @override
  String? downloadsFolder() => null;
  @override
  Stream<String> receiptDownloads() => const Stream.empty();
  @override
  Future<bool> helloAvailable() async => false;
  @override
  Future<bool> verifyUser(String reason) async => false;
}
