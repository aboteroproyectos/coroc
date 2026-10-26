import 'dart:async';
import 'dart:io';

import 'package:path/path.dart' as p;

/// Tipos de archivo que pueden ser un comprobante de pago: fotos, capturas y PDF.
const receiptExtensions = {'.jpg', '.jpeg', '.png', '.webp', '.heic', '.pdf'};

bool looksLikeReceipt(String path) => receiptExtensions.contains(p.extension(path).toLowerCase());

/// Espera a que el archivo termine de escribirse (el navegador lo guarda por partes): tamaño mayor que cero y sin
/// cambios entre dos miradas. False si desaparece o no se estabiliza a tiempo.
Future<bool> waitUntilWritten(File file, {Duration step = const Duration(seconds: 1), int tries = 30}) async {
  var last = -1;
  for (var i = 0; i < tries; i++) {
    await Future<void>.delayed(step);
    if (!await file.exists()) return false;
    final size = await file.length();
    if (size > 0 && size == last) return true;
    last = size;
  }
  return false;
}

/// Comprobantes nuevos en una carpeta (Descargas): archivos creados o renombrados (`.crdownload` → `.jpg`) que parecen
/// comprobantes, cada uno una sola vez y ya completo.
Stream<String> newReceiptFiles(Directory dir, {Duration step = const Duration(seconds: 1), int tries = 30}) {
  final seen = <String>{};
  StreamSubscription<FileSystemEvent>? sub;
  late final StreamController<String> out;
  out = StreamController<String>(
    onListen: () {
      sub = dir.watch(events: FileSystemEvent.create | FileSystemEvent.move).listen((e) async {
        final path = e is FileSystemMoveEvent ? (e.destination ?? e.path) : e.path;
        if (!looksLikeReceipt(path) || !seen.add(path)) return;
        if (await waitUntilWritten(File(path), step: step, tries: tries) && !out.isClosed) out.add(path);
      }, onError: (Object _) {});
    },
    onCancel: () => sub?.cancel(),
  );
  return out.stream;
}
