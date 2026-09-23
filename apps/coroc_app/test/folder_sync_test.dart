import 'dart:convert';

import 'package:coroc/core/folder/folder_store.dart';
import 'package:coroc/core/folder/folder_sync.dart';
import 'package:coroc/core/models/models.dart';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';

const subs = ['01 Contrato y plan de pagos', '02 Comprobantes recibidos', '03 Recibos emitidos', '04 Estados de cuenta', '05 Otros documentos'];
const roots = ['_Sin asignar', '_Entrada', '_Informes', '_Respaldos'];

/// Servidor de mentira: guarda documentos y responde el manifiesto como la API (completo o por cambios).
class FakeSource implements FolderSource {
  final Map<String, ({String path, List<int> bytes, String? clientId, int t})> docs = {};
  final Set<String> removedIds = {};
  final Map<String, int> removedAt = {};
  List<ManifestClient> clients = [];
  int clock = 1;
  int downloads = 0;

  void put(String id, String path, String text, {String? clientId}) => docs[id] = (path: path, bytes: utf8.encode(text), clientId: clientId, t: clock++);
  void supersede(String id) {
    docs.remove(id);
    removedAt[id] = clock++;
  }

  @override
  Future<FolderManifest> manifest({String? since, String? after}) async {
    final s = since == null ? null : int.parse(since);
    return FolderManifest(
      lang: 'es', full: s == null, generatedAt: '$clock', nextSince: '$clock', rootFolders: roots, subfolders: subs, clients: clients,
      files: [
        for (final e in docs.entries)
          if (s == null || e.value.t >= s) ManifestFile(documentId: e.key, clientId: e.value.clientId, path: e.value.path, size: e.value.bytes.length, sha256: sha256.convert(e.value.bytes).toString(), updatedAt: '${e.value.t}'),
      ],
      removed: [for (final e in removedAt.entries) if (s != null && e.value >= s) e.key],
    );
  }

  @override
  Future<List<int>> content(String documentId) async {
    downloads++;
    return docs[documentId]!.bytes;
  }
}

void main() {
  const folder = 'Maria Jose Perez Gomez - C000042';
  late MemoryFolderStore store;
  late FakeSource api;
  late FolderSync sync;

  setUp(() {
    store = MemoryFolderStore();
    api = FakeSource()
      ..clients = [const ManifestClient(id: 'c1', code: 'C000042', folderName: folder, marker: '$folder/.coroc-id', contracts: ['CT-000125'])]
      ..put('plan1', '$folder/CT-000125/01 Contrato y plan de pagos/2026-10-08_0930_PLAN_DE_PAGOS_CT-000125.pdf', '%PDF plan v1', clientId: 'c1');
    sync = FolderSync(store, api);
  });

  test('CA-15: crea la carpeta del cliente con sus 5 subcarpetas, el .coroc-id y el PDF del plan', () async {
    final r = await sync.run();
    expect(r.written, 1);
    for (final f in roots) {
      expect(store.dirs, contains(f));
    }
    for (final s in subs) {
      expect(store.dirs, contains('$folder/CT-000125/$s'));
    }
    expect(jsonDecode(utf8.decode(store.files['$folder/.coroc-id']!)), {'id': 'c1', 'code': 'C000042'});
    expect(utf8.decode(store.files['$folder/CT-000125/01 Contrato y plan de pagos/2026-10-08_0930_PLAN_DE_PAGOS_CT-000125.pdf']!), '%PDF plan v1');
  });

  test('por cambios: descarga solo lo nuevo, retira lo reemplazado (recibo ANULADO) y no toca archivos del usuario', () async {
    await sync.run();
    api.put('rc1', '$folder/CT-000125/03 Recibos emitidos/2026-10-09_1435_RECIBO_RC-000001_CT-000125.pdf', '%PDF recibo', clientId: 'c1');
    await store.writeBytes([folder, 'CT-000125', subs[4]], 'foto-cedula.jpg', [1, 2, 3]);
    final r1 = await sync.run();
    expect(r1.written, 1);
    expect(api.downloads, 2);
    api
      ..supersede('rc1')
      ..put('rc1v', '$folder/CT-000125/03 Recibos emitidos/2026-10-09_1500_RECIBO_RC-000001_CT-000125_ANULADO.pdf', '%PDF anulado', clientId: 'c1');
    final r2 = await sync.run();
    expect(r2.removed, 1);
    expect(store.files.keys.where((k) => k.contains('03 Recibos emitidos')), ['$folder/CT-000125/03 Recibos emitidos/2026-10-09_1500_RECIBO_RC-000001_CT-000125_ANULADO.pdf']);
    expect(store.files['$folder/CT-000125/05 Otros documentos/foto-cedula.jpg'], isNotNull);
    final untracked = await sync.untracked(subs);
    expect(untracked.map((u) => (u.clientId, u.contract, u.subfolder, u.name)), [('c1', 'CT-000125', 4, 'foto-cedula.jpg')]);
  });

  test('si el cliente cambia de nombre, su carpeta se renombra sin perder archivos (.coroc-id)', () async {
    await sync.run();
    const renamed = 'Maria Jose Perez de Lopez - C000042';
    api.clients = [const ManifestClient(id: 'c1', code: 'C000042', folderName: renamed, marker: '$renamed/.coroc-id', contracts: ['CT-000125'])];
    final plan = api.docs['plan1']!;
    api.docs['plan1'] = (path: plan.path.replaceFirst(folder, renamed), bytes: plan.bytes, clientId: 'c1', t: api.clock++);
    final r = await sync.run();
    expect(r.renamed, 1);
    expect(store.dirs.any((d) => d.startsWith(folder)), isFalse);
    expect(store.files.keys, contains('$renamed/CT-000125/01 Contrato y plan de pagos/2026-10-08_0930_PLAN_DE_PAGOS_CT-000125.pdf'));
    expect(api.downloads, 1, reason: 'el archivo ya estaba: se movió con la carpeta, no se descargó de nuevo');
  });

  test('rechaza un archivo cuya huella no coincide con el repositorio', () async {
    final bad = _Tampered(api);
    await expectLater(FolderSync(store, bad).run(), throwsStateError);
    expect(store.files.keys.where((k) => k.endsWith('.pdf')), isEmpty);
  });
}

class _Tampered implements FolderSource {
  _Tampered(this.inner);
  final FakeSource inner;
  @override
  Future<FolderManifest> manifest({String? since, String? after}) => inner.manifest(since: since, after: after);
  @override
  Future<List<int>> content(String documentId) async => utf8.encode('otra cosa');
}
