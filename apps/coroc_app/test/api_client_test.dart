import 'dart:async';
import 'dart:convert';

import 'package:coroc/core/api/api_client.dart';
import 'package:coroc/core/api/api_exception.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'support.dart';

http.Response _json(int status, Object body, {String type = 'application/json'}) => http.Response(jsonEncode(body), status, headers: {'content-type': '$type; charset=utf-8'});

void main() {
  test('envía el idioma (pt → pt-BR), el dispositivo y el token', () async {
    late http.Request seen;
    final api = ApiClient(
      baseUrl: 'https://api.test/v1',
      store: MemorySessionStore(),
      language: () => 'pt',
      client: MockClient((req) async {
        seen = req;
        return _json(200, {'ok': true});
      }),
    )..setAccessToken('tok-1');
    final res = await api.get('/me', query: {'q': 'ana', 'empty': '', 'none': null});
    expect(res, {'ok': true});
    expect(seen.headers['Accept-Language'], 'pt-BR');
    expect(seen.headers['X-Coroc-Device'], 'coroc-test-device-0001');
    expect(seen.headers['Authorization'], 'Bearer tok-1');
    expect(seen.url.queryParameters, {'q': 'ana'});
  });

  test('los errores RFC 9457 llegan como ApiException con el campo marcado', () async {
    final api = ApiClient(
      baseUrl: 'https://api.test/v1',
      store: MemorySessionStore(),
      language: () => 'es',
      client: MockClient(
        (_) async => _json(422, {
          'type': 'https://coroc.app/problems/validation_failed',
          'title': 'Datos no válidos',
          'status': 422,
          'code': 'VALIDATION_FAILED',
          'errors': [
            {'field': 'client.phone', 'message': 'Formato no válido'},
          ],
        }, type: 'application/problem+json'),
      ),
    );
    await expectLater(
      api.post('/clients', body: {}),
      throwsA(
        isA<ApiException>().having((e) => e.code, 'code', 'VALIDATION_FAILED').having((e) => e.title, 'title', 'Datos no válidos').having((e) => e.fieldMessage('phone'), 'phone', 'Formato no válido'),
      ),
    );
  });

  test('sin red → ApiException.network', () async {
    final api = ApiClient(baseUrl: 'https://api.test/v1', store: MemorySessionStore(), language: () => 'en', client: MockClient((_) async => throw http.ClientException('offline')));
    await expectLater(api.get('/dashboard'), throwsA(isA<ApiException>().having((e) => e.isNetwork, 'isNetwork', isTrue)));
  });

  test('token vencido: una sola renovación para peticiones simultáneas y reintento transparente', () async {
    var refreshCalls = 0;
    final store = MemorySessionStore(refresh: 'rt1.old');
    Map<String, dynamic>? refreshed;
    final api =
        ApiClient(
            baseUrl: 'https://api.test/v1',
            store: store,
            language: () => 'es',
            client: MockClient((req) async {
              if (req.url.path.endsWith('/auth/refresh')) {
                refreshCalls++;
                final body = jsonDecode(req.body) as Map<String, dynamic>;
                expect(body['refreshToken'], 'rt1.old');
                expect(body['deviceId'], 'coroc-test-device-0001');
                await Future<void>.delayed(const Duration(milliseconds: 20));
                return _json(200, {'accessToken': 'new', 'refreshToken': 'rt1.new', 'expiresIn': 900});
              }
              return req.headers['Authorization'] == 'Bearer new' ? _json(200, {'path': req.url.path}) : _json(401, {'code': 'SESSION_EXPIRED', 'status': 401});
            }),
          )
          ..setAccessToken('old')
          ..onSessionRefreshed = (s) => refreshed = s;
    final results = await Future.wait([api.get('/dashboard'), api.get('/collections/today'), api.get('/me')]);
    expect(results.map((r) => (r as Map<String, dynamic>)['path']), ['/v1/dashboard', '/v1/collections/today', '/v1/me']);
    expect(refreshCalls, 1);
    expect(store.refresh, 'rt1.new');
    expect(api.accessToken, 'new');
    expect(refreshed?['refreshToken'], 'rt1.new');
  });

  test('si la renovación falla se avisa que la sesión terminó', () async {
    var lost = 0;
    final api =
        ApiClient(
            baseUrl: 'https://api.test/v1',
            store: MemorySessionStore(refresh: 'rt1.revoked'),
            language: () => 'es',
            client: MockClient((req) async => _json(401, {'code': req.url.path.endsWith('/auth/refresh') ? 'SESSION_EXPIRED' : 'UNAUTHENTICATED', 'status': 401})),
          )
          ..setAccessToken('old')
          ..onSessionLost = () => lost++;
    await expectLater(api.get('/me'), throwsA(isA<ApiException>().having((e) => e.isUnauthorized, 'isUnauthorized', isTrue)));
    expect(lost, 1);
  });

  test('una contraseña o un código errado al confirmar una acción no cierra la sesión ni la renueva', () async {
    var lost = 0;
    final paths = <String>[];
    final api =
        ApiClient(
            baseUrl: 'https://api.test/v1',
            store: MemorySessionStore(refresh: 'rt1.valid'),
            language: () => 'es',
            client: MockClient((req) async {
              paths.add(req.url.path);
              return _json(401, {'code': req.url.path.endsWith('/me/mfa') ? 'MFA_INVALID' : 'INVALID_CREDENTIALS', 'status': 401, 'detail': 'No coincide.'});
            }),
          )
          ..setAccessToken('tok')
          ..onSessionLost = () => lost++;
    await expectLater(api.post('/me/password', body: {'currentPassword': 'x', 'newPassword': 'y'}), throwsA(isA<ApiException>().having((e) => e.isCredentialCheck, 'isCredentialCheck', isTrue)));
    await expectLater(api.delete('/me/mfa', body: {'code': '000000'}), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'MFA_INVALID')));
    expect(paths, ['/v1/me/password', '/v1/me/mfa']);
    expect(lost, 0);
  });

  test('eventos en vivo (SSE): tipo y datos', () async {
    final api = ApiClient(
      baseUrl: 'https://api.test/v1',
      store: MemorySessionStore(),
      language: () => 'es',
      client: MockClient.streaming((req, _) async {
        expect(req.headers['Accept'], 'text/event-stream');
        const text = ': ping\n\nevent: payment.recorded\ndata: {"clientName":"Ana","amount":40000}\n\nevent: ping\ndata: \n\n';
        return http.StreamedResponse(Stream.value(utf8.encode(text)), 200, headers: {'content-type': 'text/event-stream'});
      }),
    );
    final events = await api.events().toList();
    expect(events.first.type, 'payment.recorded');
    expect(events.first.data['clientName'], 'Ana');
    expect(events.map((e) => e.type), containsAll(['payment.recorded', 'ping']));
  });
}
