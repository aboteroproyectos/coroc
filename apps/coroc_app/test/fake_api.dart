import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

typedef Json = Map<String, dynamic>;

final _uuid = RegExp(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}');
String _shape(String path) => path.replaceAll(_uuid, '{id}');

/// Servidor de prueba para las pantallas: responde con lo que devolvió la API real (test/fixtures/api.json, generado por
/// services/api/scripts/app-fixtures.mjs) y anota cada petición para que las pruebas verifiquen lo que la app envió.
class FakeApi {
  FakeApi() : fixtures = jsonDecode(File('test/fixtures/api.json').readAsStringSync()) as Json {
    for (final e in gets.entries) {
      _byShape.putIfAbsent(_shape(e.key.split('?').first), () => e.value);
    }
  }

  final Json fixtures;
  Json get ids => (fixtures['ids'] as Json);
  Json get gets => (fixtures['get'] as Json);
  Json get posts => (fixtures['post'] as Json);
  Json get session => fixtures['session'] as Json;
  final _byShape = <String, Object?>{};

  /// Respuestas a medida por «MÉTODO /ruta» (con {id} para cualquier identificador).
  final overrides = <String, http.Response Function(http.Request req)>{};
  final requests = <http.Request>[];

  /// Flujo de eventos en vivo (`GET /events`): las pruebas publican con [emit].
  final events = StreamController<List<int>>.broadcast();
  void emit(String type, Json data) => events.add(utf8.encode('event: $type\ndata: ${jsonEncode(data)}\n\n'));

  String id(String name) => ids[name] as String;
  Json get(String path) => gets[path] as Json;

  /// Peticiones enviadas con ese método y forma de ruta, p. ej. `sent('POST', '/loans/{id}/payments')`.
  List<http.Request> sent(String method, String shape) => requests.where((r) => r.method == method && _shape(r.url.path.replaceFirst('/v1', '')) == shape).toList();
  Json? lastBody(String method, String shape) {
    final r = sent(method, shape);
    return r.isEmpty || r.last.body.isEmpty ? null : jsonDecode(r.last.body) as Json;
  }

  static http.Response json(int status, Object? body) => http.Response.bytes(utf8.encode(body == null ? '' : jsonEncode(body)), status, headers: {'content-type': 'application/json; charset=utf-8'});
  static http.Response problem(int status, String code, [String detail = 'Detalle del error']) =>
      json(status, {'type': 'about:blank', 'title': 'Error $code', 'status': status, 'detail': detail, 'code': code});

  static http.Response empty() => http.Response('', 204);

  static const _writes = <String, String>{
    'POST /auth/login': 'session',
    'POST /auth/refresh': 'session',
    'POST /auth/mfa': 'session',
    'POST /me/mfa/confirm': 'session',
    'POST /clients': 'createClient',
    'POST /clients/{id}/loans': 'createClient.loan',
    'POST /loans/preview': 'previewLoan',
    'POST /loans/{id}/payments/preview': 'previewPayment',
    'POST /loans/{id}/payments': 'pay',
    'POST /loans/{id}/payments/{id}/reversal': 'reversal',
    'POST /loans/{id}/upload-link': 'uploadLink',
    'POST /reports': 'report',
    'POST /intake': 'uploadIntake',
    'POST /messages': 'composeMessage',
    'POST /message-templates/preview': 'previewTemplate',
    'POST /backups': 'createBackup',
    'POST /intake/{id}/approve': 'pay',
  };

  Object? _post(String key) {
    if (key == 'session') return session;
    final parts = key.split('.');
    Object? v = posts[parts.first];
    for (final p in parts.skip(1)) {
      v = (v as Json)[p];
    }
    return v;
  }

  http.Client client() => MockClient.streaming((req, body) async {
    final bytes = await body.toBytes();
    final copy = http.Request(req.method, req.url)
      ..headers.addAll(req.headers)
      ..bodyBytes = bytes;
    requests.add(copy);
    // Eventos en vivo: la conexión queda abierta como en el servidor real (sin reconexiones durante la prueba).
    if (req.url.path.endsWith('/events')) {
      return http.StreamedResponse(events.stream, 200, headers: {'content-type': 'text/event-stream'});
    }
    final res = handle(copy);
    return http.StreamedResponse(Stream.value(res.bodyBytes), res.statusCode, headers: res.headers);
  });

  http.Response handle(http.Request req) {
    final path = req.url.path.replaceFirst('/v1', '');
    final shape = _shape(path);
    final key = '${req.method} $shape';
    final custom = overrides[key] ?? overrides['${req.method} $path'];
    if (custom != null) return custom(req);
    if (path == '/events') return http.Response('', 200, headers: {'content-type': 'text/event-stream'});
    if (shape == '/documents/{id}/link' || shape == '/backups/{id}/link') {
      return json(200, {'url': 'https://api.test/v1/files/token', 'path': '/files/token', 'expiresAt': '2030-01-01T00:00:00.000Z', 'fileName': 'documento.pdf', 'mime': 'application/pdf', 'size': 4});
    }
    if (req.method == 'GET') {
      final full = req.url.hasQuery ? '$path?${req.url.query}' : path;
      if (gets.containsKey(full)) return json(200, gets[full]);
      if (gets.containsKey(path)) return json(200, gets[path]);
      if (_byShape.containsKey(shape)) return json(200, _byShape[shape]);
      if (shape.startsWith('/files/')) return http.Response('%PDF', 200, headers: {'content-type': 'application/pdf'});
      return problem(404, 'NOT_FOUND');
    }
    if (_writes.containsKey(key)) return json(key.endsWith('/statements') || key == 'POST /intake' || key == 'POST /reports' || key == 'POST /backups' ? 202 : 201, _post(_writes[key]!));
    if (key == 'POST /intake/approve-batch') return json(200, {'approved': jsonDecode(req.body)['ids'], 'skipped': <Object>[]});
    if (key == 'POST /loans/{id}/statements' || key == 'POST /tasks/{id}/retry') return json(202, gets.entries.firstWhere((e) => e.key.startsWith('/tasks/')).value);
    // Cualquier otra escritura devuelve el recurso que la app vuelve a leer, o nada.
    if (req.method == 'DELETE') return http.Response('', 204);
    final read = _readBack(path, shape, req);
    return read == null ? http.Response('', 204) : json(req.method == 'POST' ? 201 : 200, read);
  }

  /// El recurso escrito: el mismo (`PATCH /company`), el elemento de la lista (`PATCH /users/{id}`, `POST /users`) o
  /// el recurso del que cuelga la acción (`POST /backups/{id}/cancel`, `PUT /company/whatsapp/mode`).
  Object? _readBack(String path, String shape, http.Request req) {
    Object? pick(Object? list, String? id) {
      final items = list is List ? list : (list is Json && list['items'] is List ? list['items'] as List : null);
      if (items == null) return list;
      final found = items.cast<Json>().where((e) => e['id'] == id).firstOrNull;
      if (found != null) return found;
      if (items.isNotEmpty) return items.first;
      // Colección vacía: se devuelve lo enviado con un identificador, como lo guardaría el servidor.
      return {...req.body.isEmpty ? const <String, dynamic>{} : jsonDecode(req.body) as Json, 'id': '00000000-0000-4000-8000-00000000000a'};
    }

    final segments = path.split('/');
    final last = segments.last;
    if (_byShape.containsKey(shape)) return _byShape[shape] is List ? pick(_byShape[shape], null) : _byShape[shape];
    final parentPath = segments.sublist(0, segments.length - 1).join('/');
    final parent = _shape(parentPath);
    if (_byShape.containsKey(parent)) return pick(_byShape[parent], _uuid.hasMatch(last) ? last : null);
    return null;
  }
}
