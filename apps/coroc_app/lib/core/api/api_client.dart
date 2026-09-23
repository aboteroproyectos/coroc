import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import '../auth/session_store.dart';
import '../offline/offline_store.dart';
import 'api_exception.dart';

typedef LanguageGetter = String Function();

/// Cliente HTTP de la API de COROC.
/// - Envía el idioma de la app en Accept-Language: los errores llegan traducidos (§6).
/// - Renueva el token de acceso una sola vez cuando vence (token rotativo ligado al dispositivo, §7.1).
/// - Si la renovación falla, avisa para volver a la pantalla de ingreso.
class ApiClient {
  ApiClient({required this.baseUrl, required this.store, required this.language, http.Client? client}) : _http = client ?? http.Client();

  final String baseUrl;
  final SessionStore store;
  final LanguageGetter language;
  final http.Client _http;

  String? _accessToken;
  Future<bool>? _refreshing;

  /// Modo sin conexión (ADR-055): lecturas guardadas cifradas y aviso del estado de la red.
  OfflineCache? cache;
  void Function(bool online, DateTime? savedAt)? onConnectivity;

  /// La capa de sesión recibe los tokens nuevos después de cada renovación.
  void Function(Map<String, dynamic> session)? onSessionRefreshed;
  void Function()? onSessionLost;

  String? get accessToken => _accessToken;
  void setAccessToken(String? token) => _accessToken = token;

  Uri uri(String path, [Map<String, Object?>? query]) {
    final q = <String, String>{};
    query?.forEach((k, v) {
      if (v != null && '$v'.isNotEmpty) q[k] = '$v';
    });
    final base = Uri.parse('$baseUrl$path');
    return q.isEmpty ? base : base.replace(queryParameters: q);
  }

  Future<Map<String, String>> _headers({bool auth = true, Map<String, String>? extra}) async {
    final lang = language();
    return {
      'Accept': 'application/json',
      'Content-Type': 'application/json; charset=utf-8',
      'Accept-Language': lang == 'pt' ? 'pt-BR' : lang,
      'X-Coroc-Device': await store.deviceId(),
      if (auth && _accessToken != null) 'Authorization': 'Bearer $_accessToken',
      ...?extra,
    };
  }

  Future<dynamic> get(String path, {Map<String, Object?>? query}) => send('GET', path, query: query);
  Future<dynamic> post(String path, {Object? body, Map<String, String>? headers, bool auth = true}) => send('POST', path, body: body, headers: headers, auth: auth);
  Future<dynamic> patch(String path, {Object? body, Map<String, String>? headers}) => send('PATCH', path, body: body, headers: headers);
  Future<dynamic> delete(String path, {Object? body}) => send('DELETE', path, body: body);
  Future<dynamic> put(String path, {Object? body, Map<String, String>? headers}) => send('PUT', path, body: body, headers: headers);

  /// Clave de la lectura en el caché: la ruta con la consulta en orden estable.
  static String cacheKey(String path, Map<String, Object?>? query) {
    final q = (query ?? const {}).entries.where((e) => e.value != null && '${e.value}'.isNotEmpty).map((e) => '${e.key}=${e.value}').toList()..sort();
    return q.isEmpty ? path : '$path?${q.join('&')}';
  }

  Future<dynamic> send(String method, String path, {Object? body, Map<String, Object?>? query, Map<String, String>? headers, bool auth = true, bool retry = true}) async {
    final req = http.Request(method, uri(path, query))..headers.addAll(await _headers(auth: auth, extra: headers));
    if (body != null) req.body = jsonEncode(body);
    final key = method == 'GET' && cache != null && OfflineCache.cacheable(cacheKey(path, query)) ? cacheKey(path, query) : null;
    http.Response res;
    try {
      res = await http.Response.fromStream(await _http.send(req).timeout(const Duration(seconds: 30)));
    } on Object catch (e) {
      if (e is! TimeoutException && e is! http.ClientException && e is! SocketException) rethrow;
      // Sin red: se responde con la última lectura guardada, si la hay, y se avisa que se está sin conexión.
      final hit = key == null ? null : await _cached(key);
      onConnectivity?.call(false, hit?.at);
      if (hit != null) return hit.body;
      throw ApiException.network();
    }
    onConnectivity?.call(true, null);
    final text = utf8.decode(res.bodyBytes);
    if (res.statusCode == 401 && auth && retry && await _refresh()) {
      return send(method, path, body: body, query: query, headers: headers, auth: auth, retry: false);
    }
    if (res.statusCode >= 400) {
      final err = ApiException.fromBody(res.statusCode, text);
      if (res.statusCode == 401 && auth) onSessionLost?.call();
      throw err;
    }
    if (text.isEmpty) return null;
    final decoded = jsonDecode(text);
    if (key != null) {
      try {
        await cache!.put(key, decoded, DateTime.now());
      } on Object {
        // El caché es una ayuda: si el almacén falla, la app sigue funcionando en línea.
      }
    }
    return decoded;
  }

  Future<({Object? body, DateTime at})?> _cached(String key) async {
    try {
      return await cache!.get(key);
    } on Object {
      return null;
    }
  }

  /// Renovación con el token rotativo; varias peticiones simultáneas comparten una sola renovación.
  Future<bool> _refresh() {
    return _refreshing ??= () async {
      try {
        final token = await store.refreshToken();
        if (token == null) return false;
        final res = await send('POST', '/auth/refresh', body: {'refreshToken': token, 'deviceId': await store.deviceId()}, auth: false, retry: false);
        final session = res as Map<String, dynamic>;
        _accessToken = session['accessToken'] as String?;
        await store.saveRefreshToken(session['refreshToken'] as String?);
        onSessionRefreshed?.call(session);
        return _accessToken != null;
      } on ApiException {
        return false;
      } finally {
        _refreshing = null;
      }
    }();
  }

  Future<bool> refreshNow() => _refresh();

  /// Dirección completa de una ruta relativa a la base de la API (p. ej. un enlace firmado `/files/…`).
  Uri fileUri(String path) => Uri.parse('$baseUrl$path');

  /// Descarga un enlace firmado a un archivo local. Si la conexión se corta, continúa desde donde quedó con `Range`
  /// (§19: descargas reanudables) hasta 5 veces. No envía la sesión: el enlace firmado es la autorización.
  Future<File> download(String path, File target, {void Function(int received, int total)? onProgress, int attempts = 5}) async {
    await target.parent.create(recursive: true);
    var received = await target.exists() ? await target.length() : 0;
    var total = -1;
    for (var attempt = 1; ; attempt++) {
      final req = http.Request('GET', fileUri(path));
      if (received > 0) req.headers['Range'] = 'bytes=$received-';
      try {
        final res = await _http.send(req).timeout(const Duration(seconds: 60));
        if (res.statusCode == 416 && received > 0) return target;
        if (res.statusCode != 200 && res.statusCode != 206) {
          throw ApiException.fromBody(res.statusCode, await res.stream.bytesToString());
        }
        if (res.statusCode == 200) received = 0;
        final range = res.headers['content-range'];
        total = range != null ? int.parse(range.split('/').last) : (res.contentLength ?? -1) + received;
        final sink = target.openWrite(mode: received > 0 ? FileMode.append : FileMode.write);
        try {
          await for (final chunk in res.stream.timeout(const Duration(seconds: 60))) {
            sink.add(chunk);
            received += chunk.length;
            onProgress?.call(received, total);
          }
        } finally {
          await sink.close();
        }
        if (total < 0 || received >= total) return target;
      } on ApiException {
        rethrow;
      } on Exception {
        if (attempt >= attempts) throw ApiException.network();
        await Future<void>.delayed(Duration(seconds: attempt * 2));
      }
    }
  }

  /// Descarga en memoria (documentos pequeños para el visor).
  Future<List<int>> downloadBytes(String path) async {
    final res = await _http.get(fileUri(path)).timeout(const Duration(seconds: 60));
    if (res.statusCode != 200) throw ApiException.fromBody(res.statusCode, utf8.decode(res.bodyBytes));
    return res.bodyBytes;
  }

  /// Envía un archivo por flujo (`application/octet-stream`), con avance. `open` se vuelve a llamar si hay que reintentar
  /// tras renovar la sesión.
  Future<dynamic> upload(String path, {required Stream<List<int>> Function() open, required int length, Map<String, Object?>? query, void Function(int sent, int total)? onProgress, bool retry = true}) async {
    final req = http.StreamedRequest('POST', uri(path, query))
      ..headers.addAll(await _headers())
      ..headers['Content-Type'] = 'application/octet-stream'
      ..contentLength = length;
    var sent = 0;
    // El cuerpo se cierra siempre al terminar el archivo (o al fallar su lectura), para que la petición concluya.
    unawaited(() async {
      try {
        await for (final chunk in open()) {
          req.sink.add(chunk);
          sent += chunk.length;
          onProgress?.call(sent, length);
        }
      } on Object catch (e) {
        req.sink.addError(e);
      } finally {
        await req.sink.close();
      }
    }());
    http.Response res;
    try {
      res = await http.Response.fromStream(await _http.send(req).timeout(const Duration(minutes: 30)));
    } on TimeoutException {
      throw ApiException.network();
    } on http.ClientException {
      throw ApiException.network();
    }
    final text = utf8.decode(res.bodyBytes);
    if (res.statusCode == 401 && retry && await _refresh()) return upload(path, open: open, length: length, query: query, onProgress: onProgress, retry: false);
    if (res.statusCode >= 400) throw ApiException.fromBody(res.statusCode, text);
    return text.isEmpty ? null : jsonDecode(text);
  }

  /// Server-Sent Events (§17): el dashboard se actualiza en tiempo real al registrar un pago.
  Stream<ServerEvent> events() async* {
    final req = http.Request('GET', uri('/events'))..headers.addAll(await _headers());
    req.headers['Accept'] = 'text/event-stream';
    final res = await _http.send(req);
    if (res.statusCode != 200) {
      throw ApiException.fromBody(res.statusCode, await res.stream.bytesToString());
    }
    String? type;
    final data = StringBuffer();
    await for (final line in res.stream.transform(utf8.decoder).transform(const LineSplitter())) {
      if (line.isEmpty) {
        if (type != null || data.isNotEmpty) {
          Map<String, dynamic> payload = const {};
          try {
            final decoded = jsonDecode(data.toString());
            if (decoded is Map<String, dynamic>) payload = decoded;
          } on FormatException {
            payload = const {};
          }
          yield ServerEvent(type ?? 'message', payload);
        }
        type = null;
        data.clear();
      } else if (line.startsWith('event:')) {
        type = line.substring(6).trim();
      } else if (line.startsWith('data:')) {
        data.write(line.substring(5).trim());
      }
    }
  }

  void close() => _http.close();
}

class ServerEvent {
  const ServerEvent(this.type, this.data);
  final String type;
  final Map<String, dynamic> data;
}
