import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:coroc_bookmarks/coroc_bookmarks.dart';
import 'package:file_selector/file_selector.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:saf_util/saf_util.dart';

import '../api/api_client.dart';
import '../api/coroc_api.dart';
import '../auth/auth_controller.dart';
import '../models/models.dart';
import '../providers.dart';
import 'folder_store.dart';
import 'folder_sync.dart';

enum FolderStatus { loading, notConfigured, ready, needsPermission }

@immutable
class FolderState {
  const FolderState({this.status = FolderStatus.loading, this.displayPath, this.syncing = false, this.lastSync, this.lastResult, this.error, this.untracked = const [], this.subfolders = const [], this.rootFolders = const []});
  final FolderStatus status;
  final String? displayPath;
  final bool syncing;
  final DateTime? lastSync;
  final SyncResult? lastResult;
  final Object? error;
  final List<UntrackedFile> untracked;
  final List<String> subfolders;
  /// _Sin asignar, _Entrada, _Informes, _Respaldos en el idioma de la empresa.
  final List<String> rootFolders;

  FolderState copyWith({FolderStatus? status, String? displayPath, bool? syncing, DateTime? lastSync, SyncResult? lastResult, Object? error, bool clearError = false, List<UntrackedFile>? untracked, List<String>? subfolders, List<String>? rootFolders}) => FolderState(
        status: status ?? this.status,
        displayPath: displayPath ?? this.displayPath,
        syncing: syncing ?? this.syncing,
        lastSync: lastSync ?? this.lastSync,
        lastResult: lastResult ?? this.lastResult,
        error: clearError ? null : (error ?? this.error),
        untracked: untracked ?? this.untracked,
        subfolders: subfolders ?? this.subfolders,
        rootFolders: rootFolders ?? this.rootFolders,
      );
}

/// Documentos del repositorio para el espejo local, con la sesión de la app.
class ApiFolderSource implements FolderSource {
  ApiFolderSource(this.api, this.client);
  final CorocApi api;
  final ApiClient client;
  List<String> lastSubfolders = const [];
  List<String> lastRootFolders = const [];

  @override
  Future<FolderManifest> manifest({String? since, String? after}) async {
    final m = await api.folderManifest(since: since, after: after);
    if (m.subfolders.isNotEmpty) lastSubfolders = m.subfolders;
    if (m.rootFolders.isNotEmpty) lastRootFolders = m.rootFolders;
    return m;
  }

  @override
  Future<List<int>> content(String documentId) async => client.downloadBytes((await api.documentLink(documentId)).path);
}

/// Carpeta COROC del dispositivo (§16.2): se pide permiso una vez, se recuerda y se mantiene como espejo del
/// repositorio mientras la app está abierta. Si el usuario no da permiso, COROC sigue funcionando con la nube.
class FolderController extends Notifier<FolderState> {
  FolderStore? _store;
  Timer? _timer;
  bool _started = false;
  bool _dirty = false;
  static const _bookmarks = CorocBookmarks();

  @override
  FolderState build() {
    ref.onDispose(() => _timer?.cancel());
    Future.microtask(_restore);
    return const FolderState();
  }

  FolderStore? get store => _store;

  static bool get isDesktop => Platform.isWindows || Platform.isMacOS || Platform.isLinux;

  Future<void> _restore() async {
    final raw = await ref.read(sessionStoreProvider).folderConfig();
    if (raw == null) {
      // En iOS la carpeta vive dentro de la app (Archivos › En mi iPhone › COROC): no hace falta permiso.
      if (Platform.isIOS) {
        await _useIos();
        return;
      }
      state = state.copyWith(status: FolderStatus.notConfigured);
      return;
    }
    final c = jsonDecode(raw) as Map<String, dynamic>;
    try {
      switch (c['type']) {
        case 'path':
          final d = Directory(c['path'] as String);
          if (!await d.exists()) await d.create(recursive: true);
          _set(IoFolderStore(d));
        case 'bookmark':
          final r = await _bookmarks.resolve(c['bookmark'] as String);
          if (r == null) {
            state = state.copyWith(status: FolderStatus.needsPermission, displayPath: c['path'] as String?);
            return;
          }
          if (r.stale) await _saveConfig({...c, 'bookmark': r.bookmark});
          final d = Directory(p.join(r.path, c['sub'] as String? ?? ''));
          await d.create(recursive: true);
          _set(IoFolderStore(d));
        case 'saf':
          final uri = c['uri'] as String;
          if (!await SafUtil().hasPersistedPermission(uri, checkRead: true, checkWrite: true)) {
            state = state.copyWith(status: FolderStatus.needsPermission, displayPath: c['name'] as String?);
            return;
          }
          _set(SafFolderStore(uri, c['name'] as String? ?? 'COROC'));
        case 'ios':
          await _useIos();
        default:
          state = state.copyWith(status: FolderStatus.notConfigured);
      }
    } catch (e) {
      state = state.copyWith(status: FolderStatus.needsPermission, error: e);
    }
  }

  Future<void> _useIos() async {
    final docs = await getApplicationDocumentsDirectory();
    _set(IoFolderStore(docs), display: 'Archivos › En mi iPhone › COROC');
  }

  void _set(FolderStore store, {String? display}) {
    _store = store;
    state = state.copyWith(status: FolderStatus.ready, displayPath: display ?? store.displayPath, clearError: true);
    if (_started) unawaited(sync(full: true));
  }

  Future<void> _saveConfig(Map<String, Object?> c) => ref.read(sessionStoreProvider).saveFolderConfig(jsonEncode(c));

  /// Pide permiso y crea (o reutiliza) la carpeta COROC en la ubicación que elija el usuario (§16.2).
  /// `message` es el texto del selector del sistema (en el idioma de la app).
  Future<bool> connect({String? message, String? prompt}) async {
    await ref.read(sessionStoreProvider).saveFolderAsked();
    if (Platform.isIOS) {
      await _saveConfig({'type': 'ios'});
      await _useIos();
      return true;
    }
    if (Platform.isAndroid) {
      final dir = await SafUtil().pickDirectory(writePermission: true, persistablePermission: true);
      if (dir == null) return false;
      var target = dir;
      if (dir.name != 'COROC') target = await SafUtil().mkdirp(dir.uri, ['COROC']);
      await _saveConfig({'type': 'saf', 'uri': target.uri, 'name': dir.name == 'COROC' ? dir.name : '${dir.name}/COROC'});
      _set(SafFolderStore(target.uri, dir.name == 'COROC' ? dir.name : '${dir.name}/COROC'));
      return true;
    }
    final docs = await getApplicationDocumentsDirectory();
    if (Platform.isMacOS) {
      final picked = await _bookmarks.pickDirectory(message: message, prompt: prompt, initialPath: docs.path);
      if (picked == null) return false;
      final sub = p.basename(picked.path) == 'COROC' ? '' : 'COROC';
      await _saveConfig({'type': 'bookmark', 'bookmark': picked.bookmark, 'path': picked.path, 'sub': sub});
      await _restore();
      return state.status == FolderStatus.ready;
    }
    final chosen = await getDirectoryPath(initialDirectory: docs.path, confirmButtonText: prompt);
    if (chosen == null) return false;
    final root = p.basename(chosen) == 'COROC' ? chosen : p.join(chosen, 'COROC');
    await Directory(root).create(recursive: true);
    await _saveConfig({'type': 'path', 'path': root});
    _set(IoFolderStore(Directory(root)));
    return true;
  }

  /// Deja de usar la carpeta en este dispositivo. Los archivos ya copiados se quedan donde están.
  Future<void> disconnect() async {
    _store = null;
    await ref.read(sessionStoreProvider).saveFolderConfig(null);
    state = const FolderState(status: FolderStatus.notConfigured);
  }

  /// Arranca la sincronización en segundo plano mientras hay sesión: al abrir, cada 2 minutos y cuando llega un
  /// documento nuevo (evento en tiempo real).
  void start() {
    if (_started) return;
    _started = true;
    _timer = Timer.periodic(const Duration(minutes: 2), (_) => unawaited(sync()));
    unawaited(sync());
  }

  void stop() {
    _started = false;
    _timer?.cancel();
    _timer = null;
  }

  Future<void> sync({bool full = false}) async {
    final store = _store;
    if (store == null || ref.read(authProvider) is! SignedIn) return;
    if (state.syncing) {
      _dirty = true;
      return;
    }
    state = state.copyWith(syncing: true, clearError: true);
    try {
      final source = ApiFolderSource(ref.read(apiProvider), ref.read(apiClientProvider));
      final engine = FolderSync(store, source);
      final r = await engine.run(full: full);
      final subs = source.lastSubfolders.isNotEmpty ? source.lastSubfolders : state.subfolders;
      final untracked = isDesktop && subs.isNotEmpty ? await engine.untracked(subs) : const <UntrackedFile>[];
      state = state.copyWith(syncing: false, lastSync: DateTime.now(), lastResult: r, untracked: untracked, subfolders: subs, rootFolders: source.lastRootFolders.isNotEmpty ? source.lastRootFolders : state.rootFolders);
    } catch (e) {
      state = state.copyWith(syncing: false, error: e);
    }
    if (_dirty) {
      _dirty = false;
      unawaited(sync());
    }
  }

  /// Sube al repositorio un archivo que el usuario puso en la carpeta de un cliente (§16.3). Después la
  /// sincronización lo deja con su nombre estándar, así que el original se retira.
  Future<void> import(UntrackedFile f) async {
    final store = _store;
    if (store == null) return;
    final bytes = await store.readBytes(f.dir, f.name);
    if (bytes == null) return;
    final api = ref.read(apiProvider);
    String? loanId;
    if (f.contract != null) {
      final client = await api.clientById(f.clientId);
      loanId = client.loans.where((l) => l.contract == f.contract).firstOrNull?.id;
    }
    final base = f.name.contains('.') ? f.name.substring(0, f.name.lastIndexOf('.')) : f.name;
    await api.uploadDocument(f.clientId, open: () => Stream.value(bytes), length: bytes.length, loanId: loanId, kind: f.subfolder == 1 ? 'receipt_in' : 'other', name: base);
    await store.deleteFile(f.dir, f.name);
    await sync();
  }

  /// Guarda una copia en `_Respaldos` o `_Informes` de la carpeta COROC (§19). Devuelve la ruta visible o null.
  Future<String?> saveToRoot(int rootIndex, String name, File source, {String mime = 'application/octet-stream'}) async {
    final store = _store;
    if (store == null) return null;
    final roots = state.rootFolders.isNotEmpty ? state.rootFolders : _defaultRoots(ref.read(sessionProvider)?.company.lang ?? 'es');
    await store.copyFile([roots[rootIndex]], name, source, mime: mime);
    return '${state.displayPath}/${roots[rootIndex]}/$name';
  }

  static List<String> _defaultRoots(String lang) => switch (lang) {
        'en' => const ['_Unassigned', '_Inbox', '_Reports', '_Backups'],
        'pt-BR' => const ['_Sem atribuicao', '_Entrada', '_Relatorios', '_Backups'],
        _ => const ['_Sin asignar', '_Entrada', '_Informes', '_Respaldos'],
      };
}

final folderProvider = NotifierProvider<FolderController, FolderState>(FolderController.new);
