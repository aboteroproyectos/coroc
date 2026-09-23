import 'dart:convert';

import 'package:crypto/crypto.dart';

import '../models/models.dart';
import 'folder_store.dart';

/// Lo que la sincronización necesita de la API. En la app es [CorocApi]; en las pruebas, un doble.
abstract class FolderSource {
  Future<FolderManifest> manifest({String? since, String? after});
  /// Contenido del documento (vía enlace firmado).
  Future<List<int>> content(String documentId);
}

class SyncResult {
  SyncResult({this.written = 0, this.removed = 0, this.renamed = 0, this.skipped = 0});
  int written;
  int removed;
  int renamed;
  int skipped;
  @override
  String toString() => 'SyncResult(written: $written, removed: $removed, renamed: $renamed, skipped: $skipped)';
}

/// Archivo que alguien puso a mano en la carpeta de un cliente (escritorio, §16.3): se ofrece para importar.
class UntrackedFile {
  const UntrackedFile({required this.clientId, required this.contract, required this.subfolder, required this.dir, required this.name});
  /// Cliente de la carpeta donde se dejó el archivo; null si se dejó en `_Entrada` (§12.5).
  final String? clientId;
  final String? contract;
  /// Índice de la subcarpeta (0–4) o -1 si está directamente en la carpeta del cliente.
  final int subfolder;
  final List<String> dir;
  final String name;
  String get path => [...dir, name].join('/');

  /// Imagen o PDF: puede ser un comprobante y va a la Bandeja (§12.5). Lo demás se ofrece como documento.
  bool get receiptLike => const {'pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic'}.contains(name.split('.').last.toLowerCase());
}

/// Espejo local de la carpeta COROC (§16.2–16.3). La nube es la fuente de verdad: este motor crea la estructura
/// (carpetas de primer nivel, carpeta de cada cliente con su `.coroc-id` y las cinco subcarpetas de cada contrato),
/// descarga los documentos vigentes, retira los reemplazados y renombra la carpeta de un cliente cuando cambia su
/// nombre. Un índice oculto (`.coroc-sync.json`) recuerda qué escribió COROC, así nunca toca archivos del usuario.
class FolderSync {
  FolderSync(this.store, this.source);
  final FolderStore store;
  final FolderSource source;

  static const indexName = '.coroc-sync.json';
  static const markerName = '.coroc-id';

  List<String> _split(String path) => path.split('/');

  Future<_Index> _load() async {
    try {
      final text = await store.readText(const [], indexName);
      if (text == null) return _Index();
      return _Index.fromJson(jsonDecode(text) as Map<String, dynamic>);
    } on FormatException {
      return _Index();
    }
  }

  Future<void> _save(_Index idx) => store.writeBytes(const [], indexName, utf8.encode(jsonEncode(idx.toJson())), mime: 'application/json');

  /// Una pasada de sincronización. `full` fuerza la revisión completa (p. ej. después de cambiar de carpeta).
  Future<SyncResult> run({bool full = false}) async {
    final idx = await _load();
    final since = full ? null : idx.since;
    final r = SyncResult();
    final seen = <String>{};
    String? after;
    String? nextSince;
    var first = true;
    do {
      final m = await source.manifest(since: since, after: after);
      if (first) {
        first = false;
        nextSince = m.nextSince;
        for (final f in m.rootFolders) {
          await store.ensureDir([f]);
        }
        for (final c in m.clients) {
          await _client(idx, c, m.subfolders, r);
        }
      }
      for (final f in m.files) {
        seen.add(f.documentId);
        await _file(idx, f, r);
      }
      for (final id in m.removed) {
        final prev = idx.files.remove(id);
        if (prev != null) {
          final parts = _split(prev.path);
          await store.deleteFile(parts.sublist(0, parts.length - 1), parts.last);
          r.removed++;
        }
      }
      after = m.nextPage;
    } while (after != null);
    // En una revisión completa, lo que COROC escribió antes y ya no está vigente se retira.
    if (since == null) {
      for (final id in idx.files.keys.where((k) => !seen.contains(k)).toList()) {
        final prev = idx.files.remove(id)!;
        final parts = _split(prev.path);
        await store.deleteFile(parts.sublist(0, parts.length - 1), parts.last);
        r.removed++;
      }
    }
    idx.since = nextSince;
    await _save(idx);
    return r;
  }

  Future<void> _client(_Index idx, ManifestClient c, List<String> subfolders, SyncResult r) async {
    final old = idx.clients[c.id];
    if (old != null && old != c.folderName) {
      // El cliente cambió de nombre (§16.3): se renombra su carpeta y se actualizan las rutas conocidas.
      if (await store.renameDir(old, c.folderName)) {
        r.renamed++;
        for (final e in idx.files.entries) {
          if (e.value.path.startsWith('$old/')) e.value.path = '${c.folderName}${e.value.path.substring(old.length)}';
        }
      }
    }
    idx.clients[c.id] = c.folderName;
    await store.ensureDir([c.folderName]);
    for (final contract in c.contracts) {
      for (final s in subfolders) {
        await store.ensureDir([c.folderName, contract, s]);
      }
    }
    final marker = utf8.encode(jsonEncode({'id': c.id, 'code': c.code}));
    final current = await store.readBytes([c.folderName], markerName);
    if (current == null || utf8.decode(current) != utf8.decode(marker)) {
      await store.writeBytes([c.folderName], markerName, marker, mime: 'application/json');
    }
  }

  Future<void> _file(_Index idx, ManifestFile f, SyncResult r) async {
    final prev = idx.files[f.documentId];
    final parts = _split(f.path);
    final dir = parts.sublist(0, parts.length - 1);
    final name = parts.last;
    if (prev != null && prev.sha256 == f.sha256 && prev.path == f.path && await store.exists(dir, name)) {
      r.skipped++;
      return;
    }
    final bytes = await source.content(f.documentId);
    // Se verifica la huella antes de escribir: el espejo nunca guarda un archivo distinto al del repositorio.
    if (sha256.convert(bytes).toString() != f.sha256) throw StateError('Huella distinta en ${f.documentId}');
    await store.writeBytes(dir, name, bytes, mime: _mime(name));
    if (prev != null && prev.path != f.path) {
      final old = _split(prev.path);
      await store.deleteFile(old.sublist(0, old.length - 1), old.last);
    }
    idx.files[f.documentId] = _Entry(f.path, f.sha256);
    r.written++;
  }

  /// Archivos que el usuario agregó a mano en las carpetas de sus clientes y que COROC no conoce (§16.3).
  Future<List<UntrackedFile>> untracked(List<String> subfolders, {String? inbox}) async {
    final idx = await _load();
    final known = idx.files.values.map((e) => e.path).toSet();
    final out = <UntrackedFile>[];
    bool candidate(String n) => !n.startsWith('.') && !n.endsWith('.part') && !n.startsWith('~\$');
    // `_Entrada`: lo que el usuario deja ahí sigue el flujo de un comprobante recibido, sin cliente todavía.
    if (inbox != null) {
      for (final n in await store.listFiles([inbox])) {
        if (candidate(n)) out.add(UntrackedFile(clientId: null, contract: null, subfolder: -1, dir: [inbox], name: n));
      }
    }
    for (final entry in idx.clients.entries) {
      final folder = entry.value;
      for (final n in await store.listFiles([folder])) {
        if (candidate(n) && n != markerName) out.add(UntrackedFile(clientId: entry.key, contract: null, subfolder: -1, dir: [folder], name: n));
      }
      for (final contract in await store.listDirs([folder])) {
        for (var i = 0; i < subfolders.length; i++) {
          final dir = [folder, contract, subfolders[i]];
          for (final n in await store.listFiles(dir)) {
            if (candidate(n) && !known.contains([...dir, n].join('/'))) out.add(UntrackedFile(clientId: entry.key, contract: contract, subfolder: i, dir: dir, name: n));
          }
        }
      }
    }
    return out;
  }

  static String _mime(String name) {
    final ext = name.split('.').last.toLowerCase();
    return switch (ext) {
      'pdf' => 'application/pdf',
      'jpg' || 'jpeg' => 'image/jpeg',
      'png' => 'image/png',
      'webp' => 'image/webp',
      'heic' => 'image/heic',
      'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'csv' => 'text/csv',
      _ => 'application/octet-stream',
    };
  }
}

class _Entry {
  _Entry(this.path, this.sha256);
  String path;
  final String sha256;
}

class _Index {
  String? since;
  final Map<String, _Entry> files = {};
  final Map<String, String> clients = {};

  _Index();

  factory _Index.fromJson(Map<String, dynamic> j) {
    final i = _Index()..since = j['since'] as String?;
    for (final e in ((j['files'] as Map<String, dynamic>?) ?? const {}).entries) {
      final v = e.value as Map<String, dynamic>;
      i.files[e.key] = _Entry(v['path'] as String, v['sha256'] as String);
    }
    for (final e in ((j['clients'] as Map<String, dynamic>?) ?? const {}).entries) {
      i.clients[e.key] = e.value as String;
    }
    return i;
  }

  Map<String, dynamic> toJson() => {
        'version': 1,
        'since': since,
        'files': {for (final e in files.entries) e.key: {'path': e.value.path, 'sha256': e.value.sha256}},
        'clients': clients,
      };
}
