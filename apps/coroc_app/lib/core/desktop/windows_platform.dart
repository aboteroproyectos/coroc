import 'dart:async';
import 'dart:convert';
import 'dart:ffi';
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:ffi/ffi.dart';
import 'package:local_auth/local_auth.dart';
import 'package:path/path.dart' as p;
import 'package:tray_manager/tray_manager.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:win32/win32.dart' as w;
import 'package:win32_registry/win32_registry.dart';
import 'package:window_manager/window_manager.dart';

import 'desktop_platform.dart';
import 'receipt_files.dart';

/// COROC Escritorio en Windows 10 y 11 (ADR-062, ADR-064): solo el código que habla con Windows, sin decisiones propias.
/// Las decisiones están en DesktopRuntime y en las pantallas, que se prueban con un DesktopPlatform falso.
class WindowsDesktopPlatform with WindowListener, TrayListener implements DesktopPlatform {
  final _signals = StreamController<WindowSignal>.broadcast();
  final _auth = LocalAuthentication();
  bool _listening = false;

  static const _runKey = r'Software\Microsoft\Windows\CurrentVersion\Run';
  static const _runValue = 'COROC';

  /// WhatsApp para Windows de Microsoft Store.
  static const _whatsAppPackage = '5319275A.WhatsAppDesktop_cv1g1gvanyjgm';

  @override
  String? serverFolder() {
    // %LOCALAPPDATA%\COROC\app\coroc.exe → %LOCALAPPDATA%\COROC\servidor (COROC_SERVIDOR solo para desarrollo).
    final env = Platform.environment['COROC_SERVIDOR'];
    final dir = env != null && env.isNotEmpty ? env : p.join(p.dirname(p.dirname(Platform.resolvedExecutable)), 'servidor');
    return File(p.join(dir, 'node.exe')).existsSync() ? dir : null;
  }

  @override
  Future<ServerProcess> startServer(String folder) async {
    final cli = p.join(folder, 'services', 'api', 'dist', 'desktop', 'supervisor', 'cli.js');
    // Aparte y sin ventana de consola; si la app se cierra de golpe, la entrada estándar se corta y el supervisor apaga
    // todo en orden.
    final proc = await Process.start(p.join(folder, 'node.exe'), [cli, 'iniciar'], workingDirectory: folder, mode: ProcessStartMode.detachedWithStdio);
    return _NodeServer(proc);
  }

  @override
  Future<void> initWindow() async {
    await windowManager.ensureInitialized();
    // Cerrar la ventana la deja en la bandeja: el correo y los recordatorios siguen trabajando.
    await windowManager.setPreventClose(true);
    if (_listening) return;
    _listening = true;
    windowManager.addListener(this);
    trayManager.addListener(this);
  }

  @override
  Future<void> showWindow() async {
    await windowManager.show();
    await windowManager.focus();
  }

  @override
  Future<void> hideWindow() => windowManager.hide();

  @override
  Future<void> quit() async {
    await trayManager.destroy();
    await windowManager.setPreventClose(false);
    await windowManager.destroy();
  }

  @override
  Future<void> setTray({required String tooltip, required List<TrayEntry> items}) async {
    await trayManager.setIcon('assets/desktop/coroc.ico');
    await trayManager.setToolTip(tooltip);
    await trayManager.setContextMenu(
      Menu(
        items: [for (final i in items) i.key == '-' ? MenuItem.separator() : MenuItem(key: i.key, label: i.label)],
      ),
    );
  }

  @override
  Stream<WindowSignal> get signals => _signals.stream;

  @override
  void onWindowClose() => _signals.add(const WindowSignal(WindowSignalKind.closeRequested));

  @override
  void onWindowFocus() => _signals.add(const WindowSignal(WindowSignalKind.focused));

  @override
  void onTrayIconMouseDown() => _signals.add(const WindowSignal(WindowSignalKind.trayClicked));

  @override
  void onTrayIconRightMouseDown() => unawaited(trayManager.popUpContextMenu());

  @override
  void onTrayMenuItemClick(MenuItem menuItem) => _signals.add(WindowSignal(WindowSignalKind.trayItem, menuItem.key));

  @override
  Future<bool> autostartEnabled() async {
    try {
      final k = Registry.openPath(RegistryHive.currentUser, path: _runKey);
      try {
        return k.getStringValue(_runValue) != null;
      } finally {
        k.close();
      }
    } on Object {
      return false;
    }
  }

  @override
  Future<void> setAutostart(bool on) async {
    final k = Registry.openPath(RegistryHive.currentUser, path: _runKey, desiredAccessRights: AccessRights.allAccess);
    try {
      if (on) {
        k.createValue(RegistryValue.string(_runValue, '"${Platform.resolvedExecutable}" --minimizado'));
      } else if (k.getStringValue(_runValue) != null) {
        k.deleteValue(_runValue);
      }
    } finally {
      k.close();
    }
  }

  @override
  Future<bool> whatsAppInstalled() async {
    final local = Platform.environment['LOCALAPPDATA'];
    if (local != null && Directory(p.join(local, 'Packages', _whatsAppPackage)).existsSync()) return true;
    // La versión anterior (fuera de la tienda) registra el protocolo whatsapp:.
    try {
      Registry.openPath(RegistryHive.classesRoot, path: 'whatsapp').close();
      return true;
    } on Object {
      return false;
    }
  }

  @override
  Future<bool> openUrl(String url) async {
    try {
      return await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    } on Object {
      return false;
    }
  }

  @override
  Future<bool> copyPdfToClipboard(String fileName, List<int> bytes) async {
    final dir = Directory(p.join(Directory.systemTemp.path, 'COROC'))..createSync(recursive: true);
    final file = File(p.join(dir.path, fileName));
    await file.writeAsBytes(bytes, flush: true);
    return _copyFile(file.absolute.path);
  }

  bool _copyFile(String path) {
    final units = path.codeUnits;
    // DROPFILES seguido de la ruta en UTF-16 y dos ceros: el mismo formato que usa el Explorador al copiar un archivo.
    final header = sizeOf<w.DROPFILES>();
    final mem = w.GlobalAlloc(w.GHND, header + (units.length + 2) * 2);
    if (mem.address == 0) return false;
    final ptr = w.GlobalLock(mem);
    final drop = ptr.cast<w.DROPFILES>().ref
      ..pFiles = header
      ..fWide = 1;
    drop.pt
      ..x = 0
      ..y = 0;
    final chars = Pointer<Uint16>.fromAddress(ptr.address + header).asTypedList(units.length + 2);
    chars.setAll(0, units);
    w.GlobalUnlock(mem);
    if (w.OpenClipboard(w.NULL) == 0) {
      _globalFree(mem.address);
      return false;
    }
    try {
      w.EmptyClipboard();
      if (w.SetClipboardData(w.CF_HDROP, mem.address) == 0) {
        _globalFree(mem.address);
        return false;
      }
      return true;
    } finally {
      w.CloseClipboard();
    }
  }

  @override
  Future<ClipboardContent?> readClipboard() async {
    final name = 'PNG'.toNativeUtf16();
    final pngFormat = w.RegisterClipboardFormat(name);
    calloc.free(name);
    if (w.OpenClipboard(w.NULL) == 0) return null;
    List<String> files = const [];
    Uint8List? png;
    Uint8List? dib;
    try {
      if (w.IsClipboardFormatAvailable(w.CF_HDROP) != 0) {
        files = _droppedFiles(w.GetClipboardData(w.CF_HDROP));
      } else if (w.IsClipboardFormatAvailable(pngFormat) != 0) {
        png = _bytes(w.GetClipboardData(pngFormat));
      } else if (w.IsClipboardFormatAvailable(w.CF_DIB) != 0) {
        dib = _bytes(w.GetClipboardData(w.CF_DIB));
      }
    } finally {
      w.CloseClipboard();
    }
    if (dib != null) png = await _dibToPng(dib);
    final content = ClipboardContent(files: files, image: png);
    return content.isEmpty ? null : content;
  }

  List<String> _droppedFiles(int handle) {
    if (handle == 0) return const [];
    final count = w.DragQueryFile(handle, 0xFFFFFFFF, nullptr, 0);
    final out = <String>[];
    for (var i = 0; i < count; i++) {
      final len = w.DragQueryFile(handle, i, nullptr, 0);
      final buf = w.wsalloc(len + 1);
      try {
        w.DragQueryFile(handle, i, buf, len + 1);
        out.add(buf.toDartString());
      } finally {
        calloc.free(buf);
      }
    }
    return out;
  }

  Uint8List? _bytes(int handle) {
    if (handle == 0) return null;
    final mem = Pointer.fromAddress(handle);
    final size = w.GlobalSize(mem);
    final ptr = w.GlobalLock(mem);
    if (ptr.address == 0) return null;
    try {
      return Uint8List.fromList(ptr.cast<Uint8>().asTypedList(size));
    } finally {
      w.GlobalUnlock(mem);
    }
  }

  /// Una imagen copiada de WhatsApp o del navegador llega como DIB: se arma un BMP y se convierte a PNG.
  Future<Uint8List?> _dibToPng(Uint8List dib) async {
    if (dib.length < 40) return null;
    final info = ByteData.sublistView(dib);
    final headerSize = info.getUint32(0, Endian.little);
    final bits = info.getUint16(14, Endian.little);
    final compression = info.getUint32(16, Endian.little);
    final colors = info.getUint32(32, Endian.little);
    final palette = bits <= 8 ? (colors == 0 ? 1 << bits : colors) * 4 : 0;
    final masks = compression == 3 && headerSize == 40 ? 12 : 0;
    final bmp = BytesBuilder()
      ..add(const [0x42, 0x4D])
      ..add(
        (ByteData(12)
              ..setUint32(0, 14 + dib.length, Endian.little)
              ..setUint32(8, 14 + headerSize + palette + masks, Endian.little))
            .buffer
            .asUint8List(),
      )
      ..add(dib);
    try {
      final codec = await ui.instantiateImageCodec(bmp.toBytes());
      final frame = await codec.getNextFrame();
      final data = await frame.image.toByteData(format: ui.ImageByteFormat.png);
      return data?.buffer.asUint8List();
    } on Object {
      return null;
    }
  }

  @override
  String? downloadsFolder() {
    final id = w.GUIDFromString(w.FOLDERID_Downloads);
    final out = calloc<Pointer<Utf16>>();
    try {
      if (w.SHGetKnownFolderPath(id, w.KF_FLAG_DEFAULT, w.NULL, out) == w.S_OK) {
        final path = out.value.toDartString();
        w.CoTaskMemFree(out.value);
        return path;
      }
    } finally {
      calloc.free(id);
      calloc.free(out);
    }
    final home = Platform.environment['USERPROFILE'];
    return home == null ? null : p.join(home, 'Downloads');
  }

  @override
  Stream<String> receiptDownloads() {
    final folder = downloadsFolder();
    return folder == null || !Directory(folder).existsSync() ? const Stream.empty() : newReceiptFiles(Directory(folder));
  }

  @override
  Future<bool> helloAvailable() async {
    try {
      return await _auth.isDeviceSupported();
    } on Object {
      return false;
    }
  }

  @override
  Future<bool> verifyUser(String reason) async {
    try {
      return await _auth.authenticate(localizedReason: reason);
    } on Object {
      return false;
    }
  }
}

final _globalFree = DynamicLibrary.open('kernel32.dll').lookupFunction<IntPtr Function(IntPtr), int Function(int)>('GlobalFree');

class _NodeServer implements ServerProcess {
  _NodeServer(this._p) {
    // Las advertencias de Node van por la salida de errores: se leen y se descartan para que el canal no se llene.
    _p.stderr.listen((_) {}, onError: (Object _) {});
    _p.stdin.done.then((_) {}, onError: (Object _) {});
    _p.stdout
        .transform(utf8.decoder)
        .transform(const LineSplitter())
        .listen(
          _lines.add,
          onError: (Object _) {},
          onDone: () {
            unawaited(_lines.close());
            if (!_done.isCompleted) _done.complete();
          },
        );
  }

  final Process _p;
  final _lines = StreamController<String>();
  final _done = Completer<void>();

  @override
  Stream<String> get lines => _lines.stream;

  @override
  Future<void> get done => _done.future;

  @override
  void send(String line) {
    try {
      _p.stdin.writeln(line);
    } on Object {
      // El supervisor ya se cerró.
    }
  }

  @override
  void kill() => _p.kill();
}
