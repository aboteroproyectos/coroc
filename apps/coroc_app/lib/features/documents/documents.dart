import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:pdfrx/pdfrx.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/common.dart';
import '../../design/widgets/brand.dart';

/// Nombre visible de cada tipo de documento (§16.3).
String docKindLabel(AppLocalizations l, String kind) => switch (kind) {
      'plan' || 'schedule' => l.docKindSchedule,
      'receipt_in' => l.docKindReceiptIn,
      'receipt_out' => l.docKindReceiptOut,
      'statement' => l.docKindStatement,
      'payoff' => l.docKindPayoff,
      'report' => l.docKindReport,
      _ => l.docKindOther,
    };

IconData docIcon(CorocDocument d) => d.isImage
    ? Icons.image_outlined
    : switch (d.kind) {
        'receipt_out' => Icons.receipt_long_outlined,
        'receipt_in' => Icons.request_page_outlined,
        'statement' => Icons.account_balance_wallet_outlined,
        'payoff' => Icons.verified_outlined,
        'schedule' || 'plan' => Icons.description_outlined,
        'report' => Icons.insert_chart_outlined,
        _ => Icons.insert_drive_file_outlined,
      };

String fileSize(int bytes) {
  if (bytes < 1024) return '$bytes B';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(0)} KB';
  if (bytes < 1024 * 1024 * 1024) return '${(bytes / 1024 / 1024).toStringAsFixed(1)} MB';
  return '${(bytes / 1024 / 1024 / 1024).toStringAsFixed(2)} GB';
}

/// Espera una tarea en segundo plano (estado de cuenta, informe) y devuelve el documento generado.
Future<String?> waitForTask(WidgetRef ref, String taskId, {Duration timeout = const Duration(minutes: 5), void Function(int progress)? onProgress}) async {
  final api = ref.read(apiProvider);
  final until = DateTime.now().add(timeout);
  var delay = const Duration(milliseconds: 600);
  while (DateTime.now().isBefore(until)) {
    final t = await api.task(taskId);
    onProgress?.call(t.progress);
    if (t.status == 'done') return t.documentId;
    if (t.finished) return null;
    await Future<void>.delayed(delay);
    if (delay < const Duration(seconds: 3)) delay *= 1.5;
  }
  return null;
}

/// El PDF del recibo se genera segundos después del pago (§15): espera a que esté listo.
Future<String?> waitForReceiptPdf(WidgetRef ref, String loanId, String entryId, {Duration timeout = const Duration(seconds: 45)}) async {
  final api = ref.read(apiProvider);
  final until = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(until)) {
    final r = (await api.receipts(loanId)).where((x) => x.entryId == entryId).firstOrNull;
    final id = r == null ? null : (r.voided ? (r.voidDocumentId ?? r.documentId) : r.documentId);
    if (id != null) return id;
    await Future<void>.delayed(const Duration(seconds: 1));
  }
  return null;
}

Future<Uint8List> fetchDocumentBytes(WidgetRef ref, String documentId) async {
  final link = await ref.read(apiProvider).documentLink(documentId);
  return Uint8List.fromList(await ref.read(apiClientProvider).downloadBytes(link.path));
}

/// Compartir (móvil y macOS) o guardar en otra ubicación (escritorio).
Future<void> shareOrSave(BuildContext context, {required String fileName, required Uint8List bytes, required String mime, bool preferSave = false}) async {
  final l = context.l10n;
  final desktop = Platform.isWindows || Platform.isLinux || Platform.isMacOS;
  if (desktop && (preferSave || !Platform.isMacOS)) {
    final loc = await getSaveLocation(suggestedName: fileName, confirmButtonText: l.actionSave);
    if (loc == null) return;
    await File(loc.path).writeAsBytes(bytes, flush: true);
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l.docSaved(loc.path))));
    return;
  }
  final dir = await getTemporaryDirectory();
  final f = File(p.join(dir.path, 'coroc-share', fileName));
  await f.parent.create(recursive: true);
  await f.writeAsBytes(bytes, flush: true);
  if (!context.mounted) return;
  final box = context.findRenderObject() as RenderBox?;
  await SharePlus.instance.share(ShareParams(files: [XFile(f.path, mimeType: mime)], sharePositionOrigin: box == null ? null : box.localToGlobal(Offset.zero) & box.size));
}

Future<void> openDocument(BuildContext context, String documentId) =>
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => DocumentViewerPage(documentId: documentId)));

final documentProvider = FutureProvider.autoDispose.family<CorocDocument, String>((ref, id) => ref.watch(apiProvider).document(id));

/// Visor integrado (§16.1): PDF con zoom y desplazamiento, imágenes con zoom, versiones, etiquetas, descargar y compartir.
class DocumentViewerPage extends ConsumerStatefulWidget {
  const DocumentViewerPage({super.key, required this.documentId});
  final String documentId;
  @override
  ConsumerState<DocumentViewerPage> createState() => _DocumentViewerPageState();
}

class _DocumentViewerPageState extends ConsumerState<DocumentViewerPage> {
  late String _id = widget.documentId;
  Future<Uint8List>? _bytes;

  @override
  void initState() {
    super.initState();
    _bytes = fetchDocumentBytes(ref, _id);
  }

  void _select(String id) => setState(() {
        _id = id;
        _bytes = fetchDocumentBytes(ref, id);
      });

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final doc = ref.watch(documentProvider(_id));
    final auth = ref.watch(authProvider);
    final canTag = auth is SignedIn && auth.user.can('documents.upload');
    return Scaffold(
      appBar: AppBar(
        title: Text(doc.valueOrNull?.name ?? l.docViewer, overflow: TextOverflow.ellipsis),
        actions: [
          if (doc.valueOrNull case final d?) ...[
            if (d.versions.length > 1)
              IconButton(tooltip: l.docVersions, icon: const Icon(Icons.history), onPressed: () => _versions(context, d)),
            IconButton(tooltip: l.docInfo, icon: const Icon(Icons.info_outline), onPressed: () => _info(context, d, canTag)),
            Builder(
              builder: (btn) => IconButton(
                tooltip: Platform.isWindows || Platform.isLinux ? l.actionSave : l.actionShare,
                icon: Icon(Platform.isWindows || Platform.isLinux ? Icons.download_outlined : Icons.ios_share),
                onPressed: () async {
                  final bytes = await _bytes;
                  if (bytes != null && btn.mounted) await shareOrSave(btn, fileName: d.fileName, bytes: bytes, mime: d.mime);
                },
              ),
            ),
            if (Platform.isMacOS)
              IconButton(
                tooltip: l.actionSaveAs,
                icon: const Icon(Icons.download_outlined),
                onPressed: () async {
                  final bytes = await _bytes;
                  if (bytes != null && context.mounted) await shareOrSave(context, fileName: d.fileName, bytes: bytes, mime: d.mime, preferSave: true);
                },
              ),
          ],
        ],
      ),
      body: AsyncBody<CorocDocument>(
        value: doc,
        onRetry: () => ref.invalidate(documentProvider(_id)),
        builder: (d) => FutureBuilder<Uint8List>(
          key: ValueKey(_id),
          future: _bytes,
          builder: (context, snap) {
            if (snap.hasError) return ErrorState(message: errorText(context, snap.error!), onRetry: () => _select(_id));
            if (!snap.hasData) return const Center(child: CircularProgressIndicator());
            final bytes = snap.data!;
            if (d.isPdf) {
              return PdfViewer.data(bytes, sourceName: '${d.id}.pdf', params: PdfViewerParams(backgroundColor: Theme.of(context).scaffoldBackgroundColor));
            }
            if (d.isImage && d.mime != 'image/heic') {
              return InteractiveViewer(maxScale: 8, child: Center(child: Image.memory(bytes, fit: BoxFit.contain, semanticLabel: d.name)));
            }
            return EmptyState(icon: docIcon(d), title: d.name, message: l.docNoPreview);
          },
        ),
      ),
    );
  }

  Future<void> _versions(BuildContext context, CorocDocument d) async {
    final l = context.l10n;
    final pick = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: ListView(shrinkWrap: true, children: [
          ListTile(title: Text(l.docVersions, style: Theme.of(context).textTheme.titleMedium)),
          for (final v in d.versions)
            ListTile(
              leading: Icon(v.id == _id ? Icons.radio_button_checked : Icons.radio_button_unchecked),
              title: Text(l.docVersionN(v.version)),
              subtitle: Text([Dates.dateTime(v.createdAt, context.lang), if (!v.superseded) l.docCurrent, if (v.voided) l.receiptVoided].join(' · ')),
              onTap: () => Navigator.pop(context, v.id),
            ),
        ]),
      ),
    );
    if (pick != null && pick != _id) _select(pick);
  }

  Future<void> _info(BuildContext context, CorocDocument d, bool canTag) async {
    final l = context.l10n;
    final tags = TextEditingController(text: d.tags.join(', '));
    final save = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(d.name),
        content: SizedBox(
          width: 460,
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            KeyValue(l.docType, docKindLabel(l, d.kind)),
            if (d.contract != null) KeyValue(l.contract, d.contract!),
            KeyValue(l.docCreated, Dates.dateTime(d.createdAt, context.lang)),
            KeyValue(l.docSize, fileSize(d.size)),
            KeyValue(l.docVersion, '${d.version}'),
            const SizedBox(height: 8),
            Overline(l.docFolderPath),
            SelectableText('${d.folderPath}/${d.fileName}', style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 8),
            Overline(l.docFingerprint),
            SelectableText(d.sha256, style: Theme.of(context).textTheme.bodySmall?.copyWith(fontFamily: 'monospace')),
            if (canTag) ...[
              const SizedBox(height: CorocSpace.md),
              TextField(controller: tags, decoration: corocInput(context, label: l.docTags, helper: l.docTagsHelp)),
            ] else if (d.tags.isNotEmpty) ...[
              const SizedBox(height: 8),
              Wrap(spacing: 6, children: [for (final t in d.tags) Chip(label: Text(t))]),
            ],
          ]),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(l.actionClose)),
          if (canTag) FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(l.actionSave)),
        ],
      ),
    );
    if (save != true) return;
    try {
      await ref.read(apiProvider).setDocumentTags(d.id, tags.text.split(',').map((t) => t.trim()).where((t) => t.isNotEmpty).toList());
      ref.invalidate(documentProvider(_id));
    } catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(context, e))));
    }
  }
}

typedef _DocQuery = ({String clientId, String? kind, String q, String? tag});

final clientDocumentsProvider = FutureProvider.autoDispose.family<List<CorocDocument>, _DocQuery>((ref, q) async {
  final api = ref.watch(apiProvider);
  final out = <CorocDocument>[];
  String? cursor;
  do {
    final page = await api.documents(clientId: q.clientId, kind: q.kind, q: q.q.isEmpty ? null : q.q, tag: q.tag, cursor: cursor, limit: 200);
    out.addAll(page.items);
    cursor = page.nextCursor;
  } while (cursor != null && out.length < 2000);
  return out;
});

/// Pestaña «Documentos» de la ficha (§5.7-7, §16.1): el repositorio del cliente agrupado como en la carpeta COROC,
/// con búsqueda por texto, filtros por tipo y etiqueta, carga manual y estado de cuenta bajo demanda.
class DocumentsTab extends ConsumerStatefulWidget {
  const DocumentsTab({super.key, required this.client, required this.loan});
  final Client client;
  final Loan? loan;
  @override
  ConsumerState<DocumentsTab> createState() => _DocumentsTabState();
}

class _DocumentsTabState extends ConsumerState<DocumentsTab> {
  final _search = TextEditingController();
  Timer? _debounce;
  String _q = '';
  String? _kind;
  String? _tag;
  bool _busy = false;
  String? _busyLabel;

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  _DocQuery get _query => (clientId: widget.client.id, kind: _kind, q: _q, tag: _tag);

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    final auth = ref.watch(authProvider);
    final canUpload = auth is SignedIn && auth.user.can('documents.upload');
    final docs = ref.watch(clientDocumentsProvider(_query));
    final pad = MediaQuery.sizeOf(context).width < CorocBreakpoints.tablet ? CorocSpace.md : CorocSpace.xl;
    const kinds = ['schedule', 'receipt_out', 'receipt_in', 'statement', 'payoff', 'other'];
    return ListView(padding: EdgeInsets.fromLTRB(pad, CorocSpace.md, pad, CorocSpace.xxl), children: [
      Wrap(spacing: CorocSpace.sm, runSpacing: CorocSpace.sm, crossAxisAlignment: WrapCrossAlignment.center, children: [
        SizedBox(
          width: 320,
          child: TextField(
            controller: _search,
            decoration: corocInput(context, label: l.docSearch, prefix: const Icon(Icons.search)),
            onChanged: (v) {
              _debounce?.cancel();
              _debounce = Timer(const Duration(milliseconds: 350), () => setState(() => _q = v.trim()));
            },
          ),
        ),
        if (canUpload)
          OutlinedButton.icon(onPressed: _busy ? null : () => _upload(context), icon: const Icon(Icons.upload_file), label: Text(l.docUpload)),
        if (canUpload && widget.loan != null)
          OutlinedButton.icon(onPressed: _busy ? null : () => _statement(context), icon: const Icon(Icons.account_balance_wallet_outlined), label: Text(l.docRequestStatement)),
        if (_busy) ...[
          const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
          if (_busyLabel != null) Text(_busyLabel!, style: t.bodySmall),
        ],
      ]),
      const SizedBox(height: CorocSpace.sm),
      Wrap(spacing: 6, runSpacing: 6, children: [
        ChoiceChip(label: Text(l.docAll), selected: _kind == null, onSelected: (_) => setState(() => _kind = null)),
        for (final k in kinds) ChoiceChip(label: Text(docKindLabel(l, k)), selected: _kind == k, onSelected: (s) => setState(() => _kind = s ? k : null)),
        if (_tag != null) InputChip(label: Text('#$_tag'), onDeleted: () => setState(() => _tag = null)),
      ]),
      const SizedBox(height: CorocSpace.md),
      AsyncBody<List<CorocDocument>>(
        value: docs,
        onRetry: () => ref.invalidate(clientDocumentsProvider(_query)),
        builder: (list) {
          if (list.isEmpty) return EmptyState(icon: Icons.folder_open, title: l.docEmpty, message: l.docEmptyHelp);
          // Agrupado por carpeta, igual que en la carpeta COROC (§16.3).
          final groups = <String, List<CorocDocument>>{};
          for (final d in list) {
            (groups[d.folderPath] ??= []).add(d);
          }
          final keys = groups.keys.toList()..sort();
          return Column(children: [
            for (final k in keys)
              Padding(
                padding: const EdgeInsets.only(bottom: CorocSpace.md),
                child: Card(
                  clipBehavior: Clip.antiAlias,
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(CorocSpace.md, CorocSpace.md, CorocSpace.md, 4),
                      child: Row(children: [
                        Icon(Icons.folder_outlined, size: 18, color: Theme.of(context).colorScheme.tertiary),
                        const SizedBox(width: 8),
                        Expanded(child: Overline(k.split('/').skip(1).join(' › '))),
                      ]),
                    ),
                    for (final d in groups[k]!) _DocTile(doc: d, onTag: (tag) => setState(() => _tag = tag)),
                  ]),
                ),
              ),
          ]);
        },
      ),
    ]);
  }

  void _refresh() => ref.invalidate(clientDocumentsProvider);

  Future<void> _upload(BuildContext context) async {
    final l = context.l10n;
    final file = await openFile(acceptedTypeGroups: [
      XTypeGroup(label: l.docUploadTypes, extensions: const ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic'], mimeTypes: const ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'], uniformTypeIdentifiers: const ['com.adobe.pdf', 'public.image']),
    ]);
    if (file == null || !context.mounted) return;
    final name = TextEditingController(text: p.basenameWithoutExtension(file.name));
    var kind = 'other';
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setLocal) => AlertDialog(
          title: Text(l.docUpload),
          content: SizedBox(
            width: 420,
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              TextField(controller: name, decoration: corocInput(context, label: l.docName)),
              const SizedBox(height: CorocSpace.md),
              SegmentedButton<String>(
                segments: [ButtonSegment(value: 'other', label: Text(l.docKindOther)), ButtonSegment(value: 'receipt_in', label: Text(l.docKindReceiptIn))],
                selected: {kind},
                onSelectionChanged: (s) => setLocal(() => kind = s.first),
              ),
              const SizedBox(height: 8),
              Text(kind == 'receipt_in' ? l.docUploadReceiptHelp : l.docUploadOtherHelp, style: Theme.of(context).textTheme.bodySmall),
            ]),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: Text(l.actionCancel)),
            FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(l.docUpload)),
          ],
        ),
      ),
    );
    if (ok != true || !context.mounted) return;
    setState(() {
      _busy = true;
      _busyLabel = l.docUploading;
    });
    try {
      final length = await file.length();
      if (kind == 'receipt_in') {
        // Un comprobante sigue el flujo de la Bandeja (§12.6): se lee, se valida y, si todo cuadra, registra el pago.
        final item = await ref.read(apiProvider).uploadIntake(open: file.openRead, length: length, channel: 'upload', clientId: widget.client.id, loanId: widget.loan?.id, fileName: file.name);
        _refresh();
        if (context.mounted) GoRouter.of(context).go('/inbox?id=${item.id}');
        return;
      }
      final doc = await ref.read(apiProvider).uploadDocument(widget.client.id, open: file.openRead, length: length, loanId: widget.loan?.id, kind: kind, name: name.text.trim());
      _refresh();
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l.docUploaded(doc.name))));
    } catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(context, e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _statement(BuildContext context) async {
    final l = context.l10n;
    setState(() {
      _busy = true;
      _busyLabel = l.docGenerating;
    });
    try {
      final task = await ref.read(apiProvider).requestStatement(widget.loan!.id);
      final id = await waitForTask(ref, task.id);
      _refresh();
      if (!context.mounted) return;
      if (id == null) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l.docTaskFailed)));
      } else {
        await openDocument(context, id);
      }
    } catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(context, e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}

class _DocTile extends StatelessWidget {
  const _DocTile({required this.doc, required this.onTag});
  final CorocDocument doc;
  final ValueChanged<String> onTag;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    return ListTile(
      leading: Icon(docIcon(doc), color: doc.voided ? Theme.of(context).colorScheme.error : Theme.of(context).colorScheme.tertiary),
      title: Text(doc.name, overflow: TextOverflow.ellipsis),
      subtitle: Wrap(spacing: 8, runSpacing: 2, crossAxisAlignment: WrapCrossAlignment.center, children: [
        Text([docKindLabel(l, doc.kind), Dates.dateTime(doc.createdAt, context.lang), fileSize(doc.size), if (doc.version > 1) l.docVersionN(doc.version)].join(' · '), style: TextStyle(color: muted)),
        if (doc.voided) StatusDot(label: l.receiptVoided, tone: StatusTone.error),
        for (final t in doc.tags)
          InkWell(onTap: () => onTag(t), child: Text('#$t', style: TextStyle(color: Theme.of(context).colorScheme.tertiary))),
      ]),
      trailing: const Icon(Icons.chevron_right),
      onTap: () => openDocument(context, doc.id),
    );
  }
}
