import 'dart:convert';

class FieldError {
  const FieldError(this.field, this.message);
  final String field;
  final String message;
}

/// Error de la API en formato RFC 9457. El servidor ya lo entrega traducido al idioma de la app (Accept-Language).
class ApiException implements Exception {
  ApiException({required this.status, required this.code, this.title = '', this.detail, this.fieldErrors = const [], this.extra = const {}});

  final int status;
  final String code;
  final String title;
  final String? detail;
  final List<FieldError> fieldErrors;
  final Map<String, Object?> extra;

  bool get isNetwork => code == 'NETWORK';
  bool get isUnauthorized => status == 401;

  /// 401 por una contraseña o un código errado al confirmar una acción (cambiar la contraseña, el segundo factor,
  /// eliminar la cuenta): la sesión sigue siendo válida y no debe cerrarse.
  bool get isCredentialCheck => status == 401 && (code == 'INVALID_CREDENTIALS' || code == 'MFA_INVALID');

  factory ApiException.network() => ApiException(status: 0, code: 'NETWORK');

  factory ApiException.fromBody(int status, String body) {
    try {
      final json = jsonDecode(body);
      if (json is Map<String, dynamic>) {
        final errors = (json['errors'] as List<dynamic>? ?? const [])
            .whereType<Map<String, dynamic>>()
            .map((e) => FieldError(e['field'] as String? ?? '', e['message'] as String? ?? ''))
            .toList();
        return ApiException(
          status: status,
          code: json['code'] as String? ?? 'INTERNAL',
          title: json['title'] as String? ?? '',
          detail: json['detail'] as String?,
          fieldErrors: errors,
          extra: json,
        );
      }
    } on FormatException {
      // Respuesta sin JSON (proxy o servidor caído): se trata como error interno.
    }
    return ApiException(status: status, code: 'INTERNAL');
  }

  /// Mensaje del campo indicado, si el servidor lo marcó.
  String? fieldMessage(String field) {
    for (final e in fieldErrors) {
      if (e.field == field || e.field.endsWith('.$field')) return e.message;
    }
    return null;
  }

  @override
  String toString() => 'ApiException($status, $code)';
}
