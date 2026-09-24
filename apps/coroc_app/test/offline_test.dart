import 'dart:convert';
import 'dart:io';

import 'package:coroc/core/api/api_client.dart';
import 'package:coroc/core/api/api_exception.dart';
import 'package:coroc/core/offline/offline_store.dart';
import 'package:coroc/core/offline/offline_sync.dart';
import 'package:coroc/core/providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'support.dart';

http.Response _json(int status, Object body) => http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json; charset=utf-8'});

const _loan = '7a2c0000-0000-4000-8000-000000000003';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('sin red, una lectura guardada se muestra con su hora y se avisa que se está sin conexión', () async {
    var online = true;
    final events = <(bool, DateTime?)>[];
    final api =
        ApiClient(
            baseUrl: 'https://api.test/v1',
            store: MemorySessionStore(),
            language: () => 'es',
            client: MockClient((req) async {
              if (!online) throw http.ClientException('sin red');
              return _json(200, {
                'items': [
                  {'id': 'c1'},
                ],
                'path': req.url.path,
              });
            }),
          )
          ..cache = OfflineCache(MemoryVault())
          ..onConnectivity = (on, at) => events.add((on, at));
    final first = await api.get('/clients', query: {'q': 'ana', 'limit': 50});
    await api.get('/support/failures');
    online = false;
    expect(await api.get('/clients', query: {'limit': 50, 'q': 'ana'}), first);
    expect(events.last.$1, isFalse);
    expect(events.last.$2, isNotNull);
    // Lo que no está en la lista no se guarda en el equipo.
    await expectLater(api.get('/support/failures'), throwsA(isA<ApiException>().having((e) => e.isNetwork, 'red', isTrue)));
    await expectLater(api.get('/clients', query: {'q': 'otra'}), throwsA(isA<ApiException>()));
  });

  test('el almacén cifra con AES-GCM: el archivo no contiene el texto y se lee de vuelta', () async {
    FlutterSecureStorage.setMockInitialValues({});
    final dir = await Directory.systemTemp.createTemp('coroc-vault-');
    final vault = FileVault(dir: () async => dir);
    await vault.write('cache', '{"nombre":"María José Pérez"}');
    final raw = await File('${dir.path}/coroc-offline/cache.bin').readAsBytes();
    expect(utf8.decode(raw, allowMalformed: true).contains('María'), isFalse);
    expect(await vault.read('cache'), '{"nombre":"María José Pérez"}');
    // Un archivo movido a otro nombre no se acepta (el nombre es dato autenticado).
    await File('${dir.path}/coroc-offline/cache.bin').copy('${dir.path}/coroc-offline/payments.bin');
    expect(await vault.read('payments'), isNull);
    await dir.delete(recursive: true);
  });

  test('la cola reenvía con la misma clave, deja en conflicto lo que el servidor rechaza y espera la red para el resto', () async {
    final seen = <String>[];
    var networkUp = true;
    final client = ApiClient(
      baseUrl: 'https://api.test/v1',
      store: MemorySessionStore(),
      language: () => 'es',
      client: MockClient((req) async {
        if (!networkUp) throw http.ClientException('sin red');
        final key = req.headers['Idempotency-Key']!;
        seen.add(key);
        if (key == 'pago-2') return _json(409, {'code': 'LOAN_CLOSED', 'title': 'Préstamo cerrado', 'detail': 'El préstamo ya está pagado.', 'status': 409});
        return _json(201, {
          'entry': {'id': key},
        });
      }),
    );
    final c = ProviderContainer(
      overrides: [sessionStoreProvider.overrideWithValue(MemorySessionStore()), offlineVaultProvider.overrideWithValue(MemoryVault()), apiClientProvider.overrideWithValue(client)],
    );
    addTearDown(c.dispose);
    final ctrl = c.read(offlineProvider.notifier);
    PendingPayment p(String key, {String user = 'u1'}) => PendingPayment(key: key, userId: user, loanId: _loan, amount: 60000, date: '2026-10-09', createdAt: DateTime(2026, 10, 9), cash: true);
    for (final x in [p('pago-1'), p('pago-2'), p('pago-3'), p('pago-otro', user: 'u2')]) {
      await ctrl.enqueue(x);
    }
    expect(await ctrl.flush(asUser: 'u1'), 2);
    expect(seen, ['pago-1', 'pago-2', 'pago-3']);
    final s = c.read(offlineProvider);
    expect(s.conflicts.single.key, 'pago-2');
    expect(s.conflicts.single.conflictMessage, 'El préstamo ya está pagado.');
    // El pago de otro usuario espera a que ese usuario ingrese.
    expect(s.waiting.single.key, 'pago-otro');
    // Sin red, nada se pierde.
    networkUp = false;
    await ctrl.enqueue(p('pago-4'));
    expect(await ctrl.flush(asUser: 'u1'), 0);
    expect(c.read(offlineProvider).waiting.map((e) => e.key), containsAll(['pago-4', 'pago-otro']));
    await ctrl.discard('pago-2');
    expect(c.read(offlineProvider).conflicts, isEmpty);
  });

  test('documentos abiertos: se guardan los últimos y se leen sin conexión', () async {
    final docs = OfflineDocuments(MemoryVault(), keep: 2);
    await docs.put('a', [1, 2, 3]);
    await docs.put('b', [4]);
    await docs.put('c', [5]);
    expect(await docs.get('a'), isNull);
    expect(await docs.get('c'), [5]);
    await docs.put('grande', List.filled(docs.maxBytes + 1, 0));
    expect(await docs.get('grande'), isNull);
  });
}
