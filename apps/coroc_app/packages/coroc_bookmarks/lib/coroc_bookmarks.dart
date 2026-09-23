import 'package:flutter/services.dart';

/// Carpeta elegida por el usuario y su marcador de seguridad en base64.
class BookmarkedFolder {
  const BookmarkedFolder({required this.path, required this.bookmark, this.stale = false});
  final String path;
  final String bookmark;
  final bool stale;
}

/// Carpeta COROC en macOS con marcador de seguridad (§16.2). En otras plataformas no se usa.
class CorocBookmarks {
  const CorocBookmarks();
  static const _channel = MethodChannel('co.coroc/bookmarks');

  /// Muestra el selector de carpetas. `null` si el usuario cancela.
  Future<BookmarkedFolder?> pickDirectory({String? message, String? prompt, String? initialPath}) async {
    final r = await _channel.invokeMapMethod<String, Object?>('pickDirectory', {'message': message, 'prompt': prompt, 'initialPath': initialPath});
    if (r == null) return null;
    return BookmarkedFolder(path: r['path']! as String, bookmark: r['bookmark']! as String);
  }

  /// Abre el marcador guardado e inicia el acceso. Si quedó obsoleto, devuelve uno nuevo para guardarlo.
  Future<BookmarkedFolder?> resolve(String bookmark) async {
    final r = await _channel.invokeMapMethod<String, Object?>('resolve', {'bookmark': bookmark});
    if (r == null) return null;
    return BookmarkedFolder(path: r['path']! as String, bookmark: r['bookmark']! as String, stale: r['stale'] == true);
  }

  Future<void> stop(String path) => _channel.invokeMethod<void>('stop', {'path': path});
}
