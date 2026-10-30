import 'dart:async';
import 'dart:io';

import 'package:desktop_drop/desktop_drop.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:path/path.dart' as p;

import '../../core/auth/auth_controller.dart';
import '../../core/desktop/desktop_runtime.dart';
import '../../core/desktop/receipt_files.dart';
import '../../core/l10n.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../../design/tokens.dart';
import '../../design/widgets/common.dart';
import '../inbox/inbox_page.dart' show inboxProvider, intakeSummaryProvider;
import 'receipt_prompt.dart';

/// «Preguntar por los comprobantes que llegan a Descargas» (Configuración › Este PC). Activado salvo que se apague.
class WatchDownloadsController extends Notifier<bool> {
  @override
  bool build() {
    Future.microtask(() async {
      final on = await ref.read(sessionStoreProvider).watchDownloads();
      if (on != state) state = on;
    });
    return true;
  }

  Future<void> set(bool on) async {
    state = on;
    await ref.read(sessionStoreProvider).saveWatchDownloads(on);
  }
}

final watchDownloadsProvider = NotifierProvider<WatchDownloadsController, bool>(WatchDownloadsController.new);

/// Comprobantes en COROC Escritorio (ADR-064), sin buscar menús: soltar el archivo en cualquier parte de la app
/// («Suelte aquí el comprobante»), pegarlo con Ctrl+V (una imagen copiada de WhatsApp o un archivo copiado en el
/// Explorador) o aceptar «¿Es un comprobante?» cuando llega uno a Descargas. Cada uno va a la Bandeja, donde COROC lo
/// lee e identifica al cliente (Fase 3); si se registra solo, se ofrece enviar el recibo.
class ReceiptCatcher extends ConsumerStatefulWidget {
  const ReceiptCatcher({super.key, required this.child, this.revealRoute = _inbox, this.onUploaded});
  final Widget child;

  /// Dónde se muestra el comprobante recién subido (la Bandeja, o «Comprobantes» en el nuevo COROC).
  final String Function(String intakeId) revealRoute;

  /// Para que la pantalla que lo usa refresque sus listas.
  final VoidCallback? onUploaded;

  static String _inbox(String id) => '/inbox?id=$id';
  @override
  ConsumerState<ReceiptCatcher> createState() => ReceiptCatcherState();
}

class ReceiptCatcherState extends ConsumerState<ReceiptCatcher> {
  bool _dragging = false;
  bool _sending = false;
  final List<String> _downloads = [];
  StreamSubscription<String>? _watch;

  bool get _on => ref.read(desktopModeProvider);

  bool get _allowed {
    final auth = ref.read(authProvider);
    return auth is SignedIn && auth.user.can('documents.upload');
  }

  @override
  void initState() {
    super.initState();
    if (!_on) return;
    watchDownloads();
    // Al cambiar el ajuste en Configuración se vuelve a armar (o se apaga) el aviso de Descargas.
    ref.listenManual<bool>(watchDownloadsProvider, (prev, next) => watchDownloads());
  }

  @override
  void dispose() {
    unawaited(_watch?.cancel());
    super.dispose();
  }

  /// Pregunta por los comprobantes que llegan a Descargas, salvo que se haya apagado en Configuración.
  void watchDownloads() {
    // Dejar de escuchar surte efecto de inmediato; no hace falta esperar a que termine.
    unawaited(_watch?.cancel());
    _watch = null;
    if (!mounted) return;
    // El ajuste guardado lo lee WatchDownloadsController al arrancar; si dice «apagado», avisa y se vuelve a llamar.
    if (!ref.read(watchDownloadsProvider)) {
      setState(_downloads.clear);
      return;
    }
    _watch = ref.read(desktopPlatformProvider).receiptDownloads().listen((path) {
      if (mounted && !_downloads.contains(path)) setState(() => _downloads.add(path));
    });
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent e) {
    if (e is! KeyDownEvent || e.logicalKey != LogicalKeyboardKey.keyV || !HardwareKeyboard.instance.isControlPressed) return KeyEventResult.ignored;
    // En un campo de texto, Ctrl+V pega texto como siempre.
    final focus = FocusManager.instance.primaryFocus?.context;
    if (focus != null && (focus.widget is EditableText || focus.findAncestorWidgetOfExactType<EditableText>() != null)) return KeyEventResult.ignored;
    unawaited(paste());
    return KeyEventResult.handled;
  }

  /// Ctrl+V: archivos copiados en el Explorador o una imagen copiada (de WhatsApp, del navegador o una captura).
  Future<void> paste() async {
    final content = await ref.read(desktopPlatformProvider).readClipboard();
    if (!mounted) return;
    if (content == null) return _toast(context.l10n.receiptPasteNothing);
    if (content.files.isNotEmpty) return sendFiles(content.files);
    final image = content.image;
    if (image != null) await _send([(name: 'comprobante-pegado.png', length: image.length, open: () => Stream<List<int>>.value(image))]);
  }

  /// Archivos soltados, pegados o aceptados desde Descargas.
  Future<void> sendFiles(List<String> paths) async {
    final files = paths.where(looksLikeReceipt).toList();
    if (files.isEmpty) return _toast(context.l10n.receiptNotSupported);
    // Un comprobante pesa poco: se lee de una vez y la subida no depende de que el archivo siga en su lugar.
    final read = [for (final f in files) (name: p.basename(f), bytes: File(f).readAsBytesSync())];
    await _send([for (final f in read) (name: f.name, length: f.bytes.length, open: () => Stream<List<int>>.value(f.bytes))]);
  }

  Future<void> _send(List<({String name, int length, Stream<List<int>> Function() open})> files) async {
    if (_sending || !mounted) return;
    final l = context.l10n;
    if (!_allowed) return _toast(l.noPermissionMessage);
    setState(() => _sending = true);
    _toast(l.intakeSending);
    IntakeItem? last;
    try {
      for (final f in files) {
        last = await ref.read(apiProvider).uploadIntake(open: f.open, length: f.length, channel: 'share', fileName: f.name);
      }
      ref.invalidate(inboxProvider);
      ref.invalidate(intakeSummaryProvider);
      widget.onUploaded?.call();
      if (!mounted || last == null) return;
      _toast(l.intakeSent);
      GoRouter.of(context).go(widget.revealRoute(last.id));
      if (files.length == 1) unawaited(_watchResult(last.id));
    } catch (e) {
      if (mounted) _toast(errorText(context, e));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  /// Si COROC lo registra solo (alta confianza), se ofrece enviar el recibo enseguida.
  Future<void> _watchResult(String id) async {
    for (var i = 0; i < 40; i++) {
      await Future<void>.delayed(const Duration(seconds: 2));
      if (!mounted) return;
      final IntakeItem item;
      try {
        item = await ref.read(apiProvider).intakeItem(id);
      } on Object {
        return;
      }
      if (item.status == 'processing') continue;
      if (item.status == 'applied_auto' && item.clientId != null && item.receiptNumber != null && mounted) {
        await offerReceipt(context, ref, clientId: item.clientId!, receiptNumber: item.receiptNumber!);
      }
      return;
    }
  }

  /// Cada aviso reemplaza al anterior: lo último que pasó se ve enseguida.
  void _toast(String text) => ScaffoldMessenger.maybeOf(context)
    ?..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(text)));

  Future<void> _answerDownload(String path, bool yes) async {
    setState(() => _downloads.remove(path));
    if (yes && File(path).existsSync()) await sendFiles([path]);
  }

  @override
  Widget build(BuildContext context) {
    if (!_on) return widget.child;
    return DropTarget(
      onDragEntered: (_) => setState(() => _dragging = true),
      onDragExited: (_) => setState(() => _dragging = false),
      onDragDone: (d) {
        setState(() => _dragging = false);
        unawaited(sendFiles([for (final f in d.files) f.path]));
      },
      child: Focus(
        onKeyEvent: _onKey,
        child: Stack(
          children: [
            widget.child,
            if (_dragging) const Positioned.fill(child: IgnorePointer(child: _DropHint())),
            if (_downloads.isNotEmpty)
              Positioned(
                right: CorocSpace.lg,
                bottom: CorocSpace.lg,
                child: _DownloadPrompt(
                  name: p.basename(_downloads.first),
                  more: _downloads.length - 1,
                  onYes: () => _answerDownload(_downloads.first, true),
                  onNo: () => _answerDownload(_downloads.first, false),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// «Suelte aquí el comprobante»: cubre la ventana mientras se arrastra un archivo encima.
class _DropHint extends StatelessWidget {
  const _DropHint();
  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Container(
      color: CorocColors.navy900.withValues(alpha: 0.86),
      padding: const EdgeInsets.all(CorocSpace.xl),
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(CorocRadii.card * 2),
          border: Border.all(color: CorocColors.gold500, width: 3),
        ),
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.file_download_outlined, size: 72, color: CorocColors.gold300),
              const SizedBox(height: CorocSpace.md),
              Text(
                context.l10n.receiptDropHere,
                style: t.headlineMedium?.copyWith(color: CorocColors.ivory),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: CorocSpace.sm),
              Text(
                context.l10n.receiptDropHelp,
                style: t.bodyLarge?.copyWith(color: CorocColors.inkMutedDark),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// «¿Es un comprobante?» para un archivo que acaba de llegar a Descargas.
class _DownloadPrompt extends StatelessWidget {
  const _DownloadPrompt({required this.name, required this.more, required this.onYes, required this.onNo});
  final String name;
  final int more;
  final VoidCallback onYes;
  final VoidCallback onNo;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 380),
      child: Card(
        elevation: 6,
        child: Padding(
          padding: const EdgeInsets.all(CorocSpace.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  const Icon(Icons.download_done, color: CorocColors.gold700),
                  const SizedBox(width: CorocSpace.sm),
                  Expanded(child: Text(l.receiptDownloadTitle, style: t.titleMedium)),
                ],
              ),
              const SizedBox(height: CorocSpace.sm),
              Text(l.receiptDownloadBody(name), style: t.bodyMedium),
              if (more > 0) Text(l.receiptDownloadMore(more), style: t.bodySmall),
              const SizedBox(height: CorocSpace.sm),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(onPressed: onNo, child: Text(l.receiptDownloadNo)),
                  const SizedBox(width: CorocSpace.sm),
                  FilledButton(onPressed: onYes, child: Text(l.receiptDownloadYes)),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
