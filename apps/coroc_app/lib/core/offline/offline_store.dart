import 'dart:convert';
import 'dart:io';

import 'package:cryptography/cryptography.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

/// Almacén cifrado del modo sin conexión (ADR-055). Guarda documentos JSON con nombre; cada escritura se cifra con
/// AES-256-GCM y una clave aleatoria que vive en el almacén seguro del sistema (Keychain, Keystore, DPAPI).
abstract class OfflineVault {
  Future<String?> read(String name);
  Future<void> write(String name, String value);
  Future<void> delete(String name);
}

/// Para pruebas y plataformas sin almacenamiento: vive en memoria.
class MemoryVault implements OfflineVault {
  final _data = <String, String>{};
  @override
  Future<String?> read(String name) async => _data[name];
  @override
  Future<void> write(String name, String value) async => _data[name] = value;
  @override
  Future<void> delete(String name) async => _data.remove(name);
}

class FileVault implements OfflineVault {
  FileVault({FlutterSecureStorage? storage, Future<Directory> Function()? dir}) : _storage = storage ?? const FlutterSecureStorage(), _dir = dir ?? getApplicationSupportDirectory;

  static const _keyName = 'coroc.offline_key';
  final FlutterSecureStorage _storage;
  final Future<Directory> Function() _dir;
  final _aes = AesGcm.with256bits();
  SecretKey? _key;

  Future<SecretKey> _secret() async {
    if (_key != null) return _key!;
    final stored = await _storage.read(key: _keyName);
    if (stored != null) return _key = SecretKey(base64Decode(stored));
    final k = await _aes.newSecretKey();
    await _storage.write(key: _keyName, value: base64Encode(await k.extractBytes()));
    return _key = k;
  }

  Future<File> _file(String name) async => File(p.join((await _dir()).path, 'coroc-offline', '$name.bin'));

  @override
  Future<String?> read(String name) async {
    final f = await _file(name);
    if (!await f.exists()) return null;
    try {
      final box = SecretBox.fromConcatenation(await f.readAsBytes(), nonceLength: 12, macLength: 16);
      // El nombre del documento va como dato asociado: un archivo no se puede cambiar por otro.
      return utf8.decode(await _aes.decrypt(box, secretKey: await _secret(), aad: utf8.encode(name)));
    } on Object {
      // Clave perdida (reinstalación) o archivo dañado: se descarta y se vuelve a llenar con la red.
      await f.delete();
      return null;
    }
  }

  @override
  Future<void> write(String name, String value) async {
    final f = await _file(name);
    await f.parent.create(recursive: true);
    final box = await _aes.encrypt(utf8.encode(value), secretKey: await _secret(), aad: utf8.encode(name));
    final tmp = File('${f.path}.tmp');
    await tmp.writeAsBytes(box.concatenation(), flush: true);
    await tmp.rename(f.path);
  }

  @override
  Future<void> delete(String name) async {
    final f = await _file(name);
    if (await f.exists()) await f.delete();
  }
}

/// Lecturas guardadas para consultar sin conexión: clientes, préstamos, plan de pagos, cobros de hoy y tablero.
/// Solo se guardan las rutas de la lista; las más antiguas salen cuando se llega al tope.
class OfflineCache {
  OfflineCache(this.vault, {this.maxEntries = 400});
  final OfflineVault vault;
  final int maxEntries;
  static const _name = 'cache';

  static final _allowed = [
    RegExp(r'^/clients(\?.*)?$'),
    RegExp(r'^/clients/[0-9a-f-]{36}$'),
    RegExp(r'^/loans/[0-9a-f-]{36}(/(schedule|ledger|receipts))?$'),
    RegExp(r'^/collections/today(\?.*)?$'),
    RegExp(r'^/dashboard(\?.*)?$'),
    RegExp(r'^/documents\?.*$'),
    RegExp(r'^/(me|company)$'),
  ];
  static bool cacheable(String key) => _allowed.any((r) => r.hasMatch(key));

  Map<String, dynamic>? _entries;

  Future<Map<String, dynamic>> _load() async {
    if (_entries != null) return _entries!;
    final raw = await vault.read(_name);
    return _entries = raw == null ? <String, dynamic>{} : (jsonDecode(raw) as Map<String, dynamic>);
  }

  Future<void> put(String key, Object? body, DateTime at) async {
    if (!cacheable(key)) return;
    final e = await _load();
    e[key] = {'at': at.toUtc().toIso8601String(), 'body': body};
    if (e.length > maxEntries) {
      final oldest = e.entries.toList()..sort((a, b) => (a.value['at'] as String).compareTo(b.value['at'] as String));
      for (final x in oldest.take(e.length - maxEntries)) {
        e.remove(x.key);
      }
    }
    await vault.write(_name, jsonEncode(e));
  }

  Future<({Object? body, DateTime at})?> get(String key) async {
    final hit = (await _load())[key] as Map<String, dynamic>?;
    return hit == null ? null : (body: hit['body'], at: DateTime.parse(hit['at'] as String));
  }

  Future<void> clear() async {
    _entries = {};
    await vault.delete(_name);
  }
}

/// Documentos abiertos recientemente, para verlos sin conexión. Cada versión tiene su propio id y no cambia, así que
/// lo guardado nunca queda desactualizado. Se conservan los últimos [keep] de hasta [maxBytes] cada uno.
class OfflineDocuments {
  OfflineDocuments(this.vault, {this.keep = 30, this.maxBytes = 10 * 1024 * 1024});
  final OfflineVault vault;
  final int keep;
  final int maxBytes;
  static const _index = 'documents';

  Future<List<String>> _ids() async {
    final raw = await vault.read(_index);
    return raw == null ? <String>[] : (jsonDecode(raw) as List).cast<String>();
  }

  Future<void> put(String id, List<int> bytes) async {
    if (bytes.length > maxBytes) return;
    await vault.write('doc-$id', base64Encode(bytes));
    final ids = (await _ids())
      ..remove(id)
      ..insert(0, id);
    for (final old in ids.skip(keep)) {
      await vault.delete('doc-$old');
    }
    await vault.write(_index, jsonEncode(ids.take(keep).toList()));
  }

  Future<List<int>?> get(String id) async {
    final raw = await vault.read('doc-$id');
    return raw == null ? null : base64Decode(raw);
  }

  Future<void> clear() async {
    for (final id in await _ids()) {
      await vault.delete('doc-$id');
    }
    await vault.delete(_index);
  }
}

/// Pago registrado sin conexión: se envía después con la misma clave de idempotencia (nunca se duplica).
class PendingPayment {
  PendingPayment({
    required this.key,
    required this.userId,
    required this.loanId,
    required this.amount,
    required this.date,
    required this.createdAt,
    this.clientName,
    this.currency,
    this.method,
    this.reference,
    this.note,
    this.cash = false,
    this.conflictCode,
    this.conflictMessage,
  });

  factory PendingPayment.fromJson(Map<String, dynamic> j) => PendingPayment(
    key: j['key'] as String,
    userId: j['userId'] as String,
    loanId: j['loanId'] as String,
    amount: (j['amount'] as num).toInt(),
    date: j['date'] as String,
    createdAt: DateTime.parse(j['createdAt'] as String),
    clientName: j['clientName'] as String?,
    currency: j['currency'] as String?,
    method: j['method'] as String?,
    reference: j['reference'] as String?,
    note: j['note'] as String?,
    cash: j['cash'] as bool? ?? false,
    conflictCode: j['conflictCode'] as String?,
    conflictMessage: j['conflictMessage'] as String?,
  );

  final String key;
  final String userId;
  final String loanId;
  final int amount;
  final String date;
  final DateTime createdAt;
  final String? clientName;
  final String? currency;
  final String? method;
  final String? reference;
  final String? note;
  final bool cash;
  String? conflictCode;
  String? conflictMessage;

  bool get inConflict => conflictCode != null;

  Map<String, dynamic> toJson() => {
    'key': key,
    'userId': userId,
    'loanId': loanId,
    'amount': amount,
    'date': date,
    'createdAt': createdAt.toUtc().toIso8601String(),
    'clientName': clientName,
    'currency': currency,
    'method': method,
    'reference': reference,
    'note': note,
    'cash': cash,
    'conflictCode': conflictCode,
    'conflictMessage': conflictMessage,
  };
}

class PaymentQueue {
  PaymentQueue(this.vault);
  final OfflineVault vault;
  static const _name = 'payments';
  List<PendingPayment>? _items;

  Future<List<PendingPayment>> all() async {
    if (_items != null) return _items!;
    final raw = await vault.read(_name);
    return _items = raw == null ? <PendingPayment>[] : (jsonDecode(raw) as List).cast<Map<String, dynamic>>().map(PendingPayment.fromJson).toList();
  }

  Future<void> _save() => vault.write(_name, jsonEncode(_items!.map((e) => e.toJson()).toList()));

  Future<void> add(PendingPayment p) async {
    final items = await all();
    if (items.any((x) => x.key == p.key)) return;
    items.add(p);
    await _save();
  }

  Future<void> remove(String key) async {
    (await all()).removeWhere((x) => x.key == key);
    await _save();
  }

  Future<void> markConflict(String key, String code, String message) async {
    for (final x in await all()) {
      if (x.key == key) {
        x
          ..conflictCode = code
          ..conflictMessage = message;
      }
    }
    await _save();
  }

  Future<void> clear() async {
    _items = [];
    await vault.delete(_name);
  }
}
