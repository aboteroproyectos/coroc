// Fase 10 · COROC Escritorio (ADR-064, E-3): el comprobante llega a la Bandeja soltándolo en la ventana, pegándolo con
// Ctrl+V o aceptando el aviso de Descargas; si COROC lo registra solo, ofrece enviar el recibo.
import 'dart:io';

import 'package:coroc/core/desktop/desktop_platform.dart';
import 'package:coroc/core/desktop/receipt_files.dart';
import 'package:coroc/core/l10n.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'app_harness.dart';
import 'desktop_fakes.dart';
import 'fake_api.dart';
import 'inbox_test.dart' show intakeVariant;

final l = lookupAppLocalizations(const Locale('es'));

/// Lo que haría el complemento de arrastrar y soltar de Windows.
Future<void> dropEvent(WidgetTester tester, String method, Object? args) async {
  await tester.binding.defaultBinaryMessenger.handlePlatformMessage('desktop_drop', const StandardMethodCodec().encodeMethodCall(MethodCall(method, args)), (_) {});
  await settle(tester);
}

/// Arrastrar sobre la ventana (lejos de la barra lateral) y soltar.
Future<void> drop(WidgetTester tester, String path) async {
  await dropEvent(tester, 'entered', [700.0, 400.0]);
  await dropEvent(tester, 'performOperation', [path]);
}

Future<void> ctrlV(WidgetTester tester) async {
  await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
  await tester.sendKeyEvent(LogicalKeyboardKey.keyV);
  await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
  await settle(tester);
}

/// Un comprobante en una carpeta temporal (lectura y escritura sincrónicas: sirven dentro de la prueba).
String receiptFile(String name, {int size = 2048}) {
  final dir = Directory.systemTemp.createTempSync('coroc-comprobante-');
  addTearDown(() => dir.deleteSync(recursive: true));
  return (File('${dir.path}${Platform.pathSeparator}$name')..writeAsBytesSync(List.filled(size, 9))).path;
}

void main() {
  group('archivos de comprobante (Descargas)', () {
    test('qué parece un comprobante', () {
      expect(looksLikeReceipt(r'C:\Users\ana\Downloads\comprobante.JPG'), isTrue);
      expect(looksLikeReceipt('/tmp/pago.pdf'), isTrue);
      expect(looksLikeReceipt('/tmp/foto.heic'), isTrue);
      expect(looksLikeReceipt('/tmp/descarga.crdownload'), isFalse);
      expect(looksLikeReceipt('/tmp/notas.txt'), isFalse);
    });

    test('espera a que el archivo termine de escribirse', () async {
      final dir = Directory.systemTemp.createTempSync('coroc-descargas-');
      addTearDown(() => dir.deleteSync(recursive: true));
      final f = File('${dir.path}/pago.jpg')..writeAsBytesSync(const [1, 2, 3]);
      expect(await waitUntilWritten(f, step: const Duration(milliseconds: 10)), isTrue);
      expect(await waitUntilWritten(File('${dir.path}/no-existe.jpg'), step: const Duration(milliseconds: 10)), isFalse);
      final empty = File('${dir.path}/vacio.png')..writeAsBytesSync(const []);
      expect(await waitUntilWritten(empty, step: const Duration(milliseconds: 5), tries: 3), isFalse);
    });

    test('avisa cada comprobante nuevo una sola vez, también al renombrarse desde .crdownload', () async {
      final dir = Directory.systemTemp.createTempSync('coroc-descargas-');
      addTearDown(() => dir.deleteSync(recursive: true));
      final seen = <String>[];
      final sub = newReceiptFiles(dir, step: const Duration(milliseconds: 20), tries: 50).listen(seen.add);
      await Future<void>.delayed(const Duration(milliseconds: 100));
      File('${dir.path}/notas.txt').writeAsStringSync('no');
      File('${dir.path}/pago.crdownload').writeAsBytesSync(List.filled(300, 1));
      await Future<void>.delayed(const Duration(milliseconds: 50));
      File('${dir.path}/pago.crdownload').renameSync('${dir.path}/pago.jpg');
      File('${dir.path}/captura.png').writeAsBytesSync(List.filled(200, 2));
      for (var i = 0; i < 50 && seen.length < 2; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 50));
      }
      File('${dir.path}/captura.png').writeAsBytesSync(List.filled(250, 3));
      await Future<void>.delayed(const Duration(milliseconds: 300));
      await sub.cancel();
      expect(seen.map((p) => p.split(Platform.pathSeparator).last).toSet(), {'pago.jpg', 'captura.png'});
      expect(seen, hasLength(2));
    });
  });

  testWidgets('E-3 · soltar el comprobante en cualquier parte: «Suelte aquí» y va a la Bandeja', (tester) async {
    final api = FakeApi();
    final app = await bootDesktop(tester, api: api);
    await dropEvent(tester, 'entered', [400.0, 300.0]);
    expect(find.text(l.receiptDropHere), findsOneWidget);
    await dropEvent(tester, 'exited', null);
    expect(find.text(l.receiptDropHere), findsNothing);

    await dropEvent(tester, 'entered', [400.0, 300.0]);
    await dropEvent(tester, 'performOperation', [receiptFile('comprobante-maria.jpg')]);
    expect(find.text(l.receiptDropHere), findsNothing);
    final upload = api.sent('POST', '/intake').single;
    expect(upload.url.queryParameters, containsPair('channel', 'share'));
    expect(upload.url.queryParameters, containsPair('fileName', 'comprobante-maria.jpg'));
    expect(upload.bodyBytes, hasLength(2048));
    expect(location(app), startsWith('/inbox?id='));

    // Lo que no es un comprobante no se sube.
    await drop(tester, receiptFile('notas.txt'));
    expect(find.text(l.receiptNotSupported), findsOneWidget);
    expect(api.sent('POST', '/intake'), hasLength(1));
    await app.finish();
  });

  testWidgets('E-3 · Ctrl+V: una imagen copiada de WhatsApp o archivos copiados en el Explorador', (tester) async {
    final api = FakeApi();
    final platform = FakeDesktopPlatform();
    final app = await bootDesktop(tester, api: api, platform: platform);
    await ctrlV(tester);
    expect(find.text(l.receiptPasteNothing), findsOneWidget);
    expect(api.sent('POST', '/intake'), isEmpty);

    platform.clipboard = ClipboardContent(image: Uint8List.fromList(List.filled(512, 4)));
    await ctrlV(tester);
    var upload = api.sent('POST', '/intake').last;
    expect(upload.url.queryParameters, containsPair('fileName', 'comprobante-pegado.png'));
    expect(upload.bodyBytes, hasLength(512));

    platform.clipboard = ClipboardContent(files: [receiptFile('pago.pdf', size: 900)]);
    await ctrlV(tester);
    upload = api.sent('POST', '/intake').last;
    expect(upload.url.queryParameters, containsPair('fileName', 'pago.pdf'));
    expect(api.sent('POST', '/intake'), hasLength(2));

    // En un campo de texto, Ctrl+V pega texto como siempre.
    await app.go('/clients');
    await tester.tap(find.byType(TextField).first);
    await settle(tester);
    await ctrlV(tester);
    expect(api.sent('POST', '/intake'), hasLength(2));
    await app.finish();
  });

  testWidgets('E-3 · «¿Es un comprobante?» cuando llega uno a Descargas; se puede apagar', (tester) async {
    final api = FakeApi();
    final platform = FakeDesktopPlatform();
    final app = await bootDesktop(tester, api: api, platform: platform);
    platform.downloadsCtl
      ..add(receiptFile('comprobante-1.jpg'))
      ..add(receiptFile('comprobante-2.png'));
    await settle(tester);
    expect(find.text(l.receiptDownloadTitle), findsOneWidget);
    expect(find.text(l.receiptDownloadBody('comprobante-1.jpg')), findsOneWidget);
    expect(find.text(l.receiptDownloadMore(1)), findsOneWidget);
    await tapOn(tester, find.text(l.receiptDownloadNo));
    expect(find.text(l.receiptDownloadBody('comprobante-2.png')), findsOneWidget);
    await tapOn(tester, find.text(l.receiptDownloadYes));
    expect(api.sent('POST', '/intake').single.url.queryParameters, containsPair('fileName', 'comprobante-2.png'));
    expect(find.text(l.receiptDownloadTitle), findsNothing);

    // Configuración › Este PC: apagado, ya no pregunta.
    await app.go('/settings');
    await tapOn(tester, find.text(l.desktopWatchDownloads));
    expect(app.store.downloads, isFalse);
    platform.downloadsCtl.add(receiptFile('comprobante-3.jpg'));
    await settle(tester);
    expect(find.text(l.receiptDownloadTitle), findsNothing);
    await tapOn(tester, find.text(l.desktopWatchDownloads));
    expect(app.store.downloads, isTrue);
    platform.downloadsCtl.add(receiptFile('comprobante-4.jpg'));
    await settle(tester);
    expect(find.text(l.receiptDownloadTitle), findsOneWidget);
    await app.finish();
  });

  testWidgets('E-3 · si COROC registra el pago solo, ofrece el recibo enseguida', (tester) async {
    final api = FakeApi();
    final applied = intakeVariant(api, id: api.id('intake'), status: 'applied_auto', extra: {'receiptNumber': 'RC-000007', 'revertibleUntil': '2099-01-01T00:00:00.000Z'});
    var reads = 0;
    api.overrides['GET /intake/{id}'] = (_) => FakeApi.json(200, reads++ == 0 ? {...applied, 'status': 'processing'} : applied);
    api.overrides['GET /messages'] = (_) => FakeApi.json(200, {'items': <Json>[], 'nextCursor': null});
    final platform = FakeDesktopPlatform();
    final app = await bootDesktop(tester, api: api, platform: platform);
    await drop(tester, receiptFile('comprobante.jpg'));
    await tester.pump(const Duration(seconds: 2));
    await settle(tester);
    await tester.pump(const Duration(seconds: 2));
    await settle(tester);
    expect(find.text(l.receiptPromptTitle('RC-000007')), findsOneWidget);
    await tapOn(tester, find.text(l.receiptPromptLater));
    await app.finish();
  });

  testWidgets('sin permiso para subir documentos no se sube nada', (tester) async {
    final api = FakeApi();
    final app = await bootDesktop(tester, api: api, role: 'auditor', permissions: const ['dashboard.view', 'clients.view']);
    await drop(tester, receiptFile('comprobante.jpg'));
    expect(find.text(l.noPermissionMessage), findsOneWidget);
    expect(api.sent('POST', '/intake'), isEmpty);
    await app.finish();
  });
}
