import 'dart:async';

import 'package:flutter/services.dart';

/// Archivos que otra app compartió con COROC (§12.4). Cada ruta es una copia en la caché de la app, lista para subir.
class CorocShare {
  CorocShare._() {
    _channel.setMethodCallHandler((call) async {
      if (call.method == 'files') _controller.add(((call.arguments as List<dynamic>?) ?? const []).cast<String>());
    });
  }
  static final CorocShare instance = CorocShare._();

  static const _channel = MethodChannel('co.coroc/share');
  final _controller = StreamController<List<String>>.broadcast();

  /// Archivos que llegan mientras la app está abierta.
  Stream<List<String>> get files => _controller.stream;

  /// Archivos con los que se abrió la app (o que llegaron antes de escuchar). Se entregan una sola vez.
  Future<List<String>> take() async {
    try {
      return ((await _channel.invokeMethod<List<dynamic>>('take')) ?? const []).cast<String>();
    } on MissingPluginException {
      return const []; // Windows y macOS: la carga es por la carpeta vigilada o el botón «Subir comprobante».
    }
  }
}
