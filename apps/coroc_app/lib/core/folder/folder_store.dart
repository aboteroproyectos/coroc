import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:path/path.dart' as p;
import 'package:saf_stream/saf_stream.dart';
import 'package:saf_util/saf_util.dart';

/// Acceso a la carpeta COROC del dispositivo (§16.2). Las rutas son listas de nombres relativas a la raíz COROC/.
/// Cada plataforma tiene su implementación: disco en Windows, macOS e iOS; Storage Access Framework en Android.
abstract class FolderStore {
  /// Ruta visible para el usuario.
  String get displayPath;
  Future<void> ensureDir(List<String> dir);
  Future<void> writeBytes(List<String> dir, String name, List<int> bytes, {String mime = 'application/octet-stream'});
  /// Copia un archivo local grande (p. ej. un respaldo de varios GB) sin cargarlo en memoria.
  Future<void> copyFile(List<String> dir, String name, File source, {String mime = 'application/octet-stream'});
  Future<bool> exists(List<String> dir, String name);
  Future<void> deleteFile(List<String> dir, String name);
  Future<Uint8List?> readBytes(List<String> dir, String name);
  /// Renombra una carpeta de primer nivel (carpeta de un cliente que cambió de nombre, §16.3). Devuelve si pudo.
  Future<bool> renameDir(String from, String to);
  Future<List<String>> listFiles(List<String> dir);
  Future<List<String>> listDirs(List<String> dir);

  Future<String?> readText(List<String> dir, String name) async {
    final b = await readBytes(dir, name);
    return b == null ? null : utf8.decode(b);
  }
}

/// Windows, macOS (con el acceso que da el marcador de seguridad) e iOS (Archivos › En mi iPhone › COROC).
class IoFolderStore extends FolderStore {
  IoFolderStore(this.root);
  final Directory root;

  @override
  String get displayPath => root.path;

  String _path(List<String> dir, [String? name]) => p.joinAll([root.path, ...dir, ?name]);

  @override
  Future<void> ensureDir(List<String> dir) => Directory(_path(dir)).create(recursive: true);

  @override
  Future<void> writeBytes(List<String> dir, String name, List<int> bytes, {String mime = 'application/octet-stream'}) async {
    await ensureDir(dir);
    // Se escribe en un temporal y se renombra: nunca queda un archivo a medias en la carpeta.
    final tmp = File(_path(dir, '.$name.part'));
    await tmp.writeAsBytes(bytes, flush: true);
    await tmp.rename(_path(dir, name));
  }

  @override
  Future<void> copyFile(List<String> dir, String name, File source, {String mime = 'application/octet-stream'}) async {
    await ensureDir(dir);
    final tmp = _path(dir, '.$name.part');
    await source.copy(tmp);
    await File(tmp).rename(_path(dir, name));
  }

  @override
  Future<bool> exists(List<String> dir, String name) => File(_path(dir, name)).exists();

  @override
  Future<void> deleteFile(List<String> dir, String name) async {
    final f = File(_path(dir, name));
    if (await f.exists()) await f.delete();
  }

  @override
  Future<Uint8List?> readBytes(List<String> dir, String name) async {
    final f = File(_path(dir, name));
    return await f.exists() ? f.readAsBytes() : null;
  }

  @override
  Future<bool> renameDir(String from, String to) async {
    final src = Directory(_path([from]));
    if (!await src.exists() || await Directory(_path([to])).exists()) return false;
    await src.rename(_path([to]));
    return true;
  }

  @override
  Future<List<String>> listFiles(List<String> dir) async {
    final d = Directory(_path(dir));
    if (!await d.exists()) return const [];
    return [await for (final e in d.list()) if (e is File) p.basename(e.path)];
  }

  @override
  Future<List<String>> listDirs(List<String> dir) async {
    final d = Directory(_path(dir));
    if (!await d.exists()) return const [];
    return [await for (final e in d.list()) if (e is Directory) p.basename(e.path)];
  }
}

/// Android: Storage Access Framework sobre la carpeta que eligió el usuario, con permiso persistente
/// (`takePersistableUriPermission`). Nunca se pide `MANAGE_EXTERNAL_STORAGE` (§16.2).
class SafFolderStore extends FolderStore {
  SafFolderStore(this.treeUri, this.displayPath);
  final String treeUri;
  @override
  final String displayPath;
  final _util = SafUtil();
  final _stream = SafStream();

  Future<String> _dirUri(List<String> dir) async => dir.isEmpty ? treeUri : (await _util.mkdirp(treeUri, dir)).uri;

  @override
  Future<void> ensureDir(List<String> dir) async {
    if (dir.isNotEmpty) await _util.mkdirp(treeUri, dir);
  }

  @override
  Future<void> writeBytes(List<String> dir, String name, List<int> bytes, {String mime = 'application/octet-stream'}) async {
    final parent = await _dirUri(dir);
    await _stream.writeFileBytes(parent, name, mime, Uint8List.fromList(bytes), overwrite: true);
  }

  @override
  Future<void> copyFile(List<String> dir, String name, File source, {String mime = 'application/octet-stream'}) async {
    await _stream.pasteLocalFile(source.path, await _dirUri(dir), name, mime, overwrite: true);
  }

  @override
  Future<bool> exists(List<String> dir, String name) async => (await _util.child(treeUri, [...dir, name])) != null;

  @override
  Future<void> deleteFile(List<String> dir, String name) async {
    final f = await _util.child(treeUri, [...dir, name]);
    if (f != null) await _util.delete(f.uri, false);
  }

  @override
  Future<Uint8List?> readBytes(List<String> dir, String name) async {
    final f = await _util.child(treeUri, [...dir, name]);
    return f == null ? null : _stream.readFileBytes(f.uri);
  }

  @override
  Future<bool> renameDir(String from, String to) async {
    final d = await _util.child(treeUri, [from]);
    if (d == null || await _util.child(treeUri, [to]) != null) return false;
    await _util.rename(d.uri, true, to);
    return true;
  }

  @override
  Future<List<String>> listFiles(List<String> dir) async {
    final d = await _util.child(treeUri, dir);
    if (d == null) return const [];
    return [for (final f in await _util.list(d.uri)) if (!f.isDir) f.name];
  }

  @override
  Future<List<String>> listDirs(List<String> dir) async {
    final d = dir.isEmpty ? null : await _util.child(treeUri, dir);
    if (dir.isNotEmpty && d == null) return const [];
    return [for (final f in await _util.list(d?.uri ?? treeUri)) if (f.isDir) f.name];
  }
}

/// En memoria, para pruebas.
class MemoryFolderStore extends FolderStore {
  final Map<String, Uint8List> files = {};
  final Set<String> dirs = {};
  @override
  String get displayPath => 'COROC';

  String _k(List<String> dir, [String? name]) => [...dir, ?name].join('/');

  @override
  Future<void> ensureDir(List<String> dir) async {
    for (var i = 1; i <= dir.length; i++) {
      dirs.add(_k(dir.sublist(0, i)));
    }
  }

  @override
  Future<void> writeBytes(List<String> dir, String name, List<int> bytes, {String mime = 'application/octet-stream'}) async {
    await ensureDir(dir);
    files[_k(dir, name)] = Uint8List.fromList(bytes);
  }

  @override
  Future<void> copyFile(List<String> dir, String name, File source, {String mime = 'application/octet-stream'}) async => writeBytes(dir, name, await source.readAsBytes());

  @override
  Future<bool> exists(List<String> dir, String name) async => files.containsKey(_k(dir, name));
  @override
  Future<void> deleteFile(List<String> dir, String name) async => files.remove(_k(dir, name));
  @override
  Future<Uint8List?> readBytes(List<String> dir, String name) async => files[_k(dir, name)];

  @override
  Future<bool> renameDir(String from, String to) async {
    if (!dirs.contains(from) || dirs.contains(to)) return false;
    String move(String k) => k == from ? to : (k.startsWith('$from/') ? '$to${k.substring(from.length)}' : k);
    final moved = {for (final e in files.entries) move(e.key): e.value};
    files
      ..clear()
      ..addAll(moved);
    final ds = dirs.map(move).toSet();
    dirs
      ..clear()
      ..addAll(ds);
    return true;
  }

  @override
  Future<List<String>> listFiles(List<String> dir) async {
    final prefix = dir.isEmpty ? '' : '${_k(dir)}/';
    return [for (final k in files.keys) if (k.startsWith(prefix) && !k.substring(prefix.length).contains('/')) k.substring(prefix.length)];
  }

  @override
  Future<List<String>> listDirs(List<String> dir) async {
    final prefix = dir.isEmpty ? '' : '${_k(dir)}/';
    return [for (final k in dirs) if (k.startsWith(prefix) && k.length > prefix.length && !k.substring(prefix.length).contains('/')) k.substring(prefix.length)];
  }
}
