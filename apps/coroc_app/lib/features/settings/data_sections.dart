import 'dart:async';
import 'dart:io';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/folder/folder_controller.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/brand.dart';
import '../../design/widgets/common.dart';
import '../dashboard/dashboard_page.dart' show eventsProvider;
import '../documents/documents.dart' show fileSize;

void _toast(BuildContext context, String message) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));

// ─────────────────────────── Carpeta COROC (§16.2) ───────────────────────────

/// Explicación y permiso para crear la carpeta COROC (§16.2). Se muestra una vez por dispositivo y queda en Configuración.
Future<void> askForFolder(BuildContext context, WidgetRef ref) async {
  final l = context.l10n;
  final yes = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (context) => AlertDialog(
      icon: const CorocLogo(layout: LogoLayout.isotype, height: 40),
      title: Text(l.folderAskTitle),
      content: SizedBox(
        width: 460,
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(l.folderAskBody),
          const SizedBox(height: CorocSpace.md),
          Text(Platform.isAndroid ? l.folderAskAndroid : (Platform.isIOS ? l.folderAskIos : l.folderAskDesktop), style: Theme.of(context).textTheme.bodySmall),
        ]),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context, false), child: Text(l.folderAskLater)),
        FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(l.folderAskCreate)),
      ],
    ),
  );
  await ref.read(sessionStoreProvider).saveFolderAsked();
  if (yes == true && context.mounted) await _connect(context, ref);
}

Future<void> _connect(BuildContext context, WidgetRef ref) async {
  final l = context.l10n;
  final ok = await ref.read(folderProvider.notifier).connect(message: l.folderPickerMessage, prompt: l.folderPickerPrompt);
  if (ok) {
    unawaited(ref.read(folderProvider.notifier).sync(full: true));
    if (context.mounted) _toast(context, l.folderConnected);
  }
}

class FolderSection extends ConsumerWidget {
  const FolderSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    final s = ref.watch(folderProvider);
    final c = ref.read(folderProvider.notifier);
    final status = switch (s.status) {
      FolderStatus.ready => StatusDot(label: s.syncing ? l.folderSyncing : l.folderReady, tone: StatusTone.ok),
      FolderStatus.needsPermission => StatusDot(label: l.folderNeedsPermission, tone: StatusTone.warn),
      FolderStatus.notConfigured => StatusDot(label: l.folderNotConfigured, tone: StatusTone.neutral),
      FolderStatus.loading => const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
    };
    return SectionCard(
      title: l.folderTitle,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(l.folderExplain, style: t.bodyMedium),
        const SizedBox(height: CorocSpace.md),
        Align(alignment: AlignmentDirectional.centerStart, child: status),
        if (s.displayPath != null) ...[const SizedBox(height: 8), KeyValue(l.folderLocation, s.displayPath!)],
        if (s.lastSync != null) KeyValue(l.folderLastSync, Dates.dateTime(s.lastSync!.toUtc().toIso8601String(), context.lang)),
        if (s.lastResult != null && (s.lastResult!.written + s.lastResult!.removed + s.lastResult!.renamed) > 0)
          KeyValue(l.folderLastResult, l.folderResult(s.lastResult!.written, s.lastResult!.removed)),
        if (s.error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(errorText(context, s.error!), style: t.bodySmall?.copyWith(color: Theme.of(context).colorScheme.error))),
        const SizedBox(height: CorocSpace.md),
        Wrap(spacing: 8, runSpacing: 8, children: [
          if (s.status == FolderStatus.ready) ...[
            FilledButton.tonalIcon(onPressed: s.syncing ? null : () => c.sync(), icon: const Icon(Icons.sync), label: Text(l.folderSyncNow)),
            if (!Platform.isIOS) OutlinedButton.icon(onPressed: () => _connect(context, ref), icon: const Icon(Icons.drive_file_move_outline), label: Text(l.folderChange)),
            if (!Platform.isIOS) TextButton(onPressed: () => c.disconnect(), child: Text(l.folderDisconnect)),
          ] else
            FilledButton.icon(onPressed: () => _connect(context, ref), icon: const Icon(Icons.create_new_folder_outlined), label: Text(s.status == FolderStatus.needsPermission ? l.folderReauthorize : l.folderAskCreate)),
        ]),
        // Carpeta vigilada (§12.5): en escritorio, las fotos y PDF que se dejen en _Entrada o en la carpeta de un cliente
        // van solos a la Bandeja.
        if (s.status == FolderStatus.ready && FolderController.isDesktop) ...[
          const SizedBox(height: CorocSpace.sm),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            value: s.watching,
            onChanged: (v) => c.setWatching(v),
            title: Text(l.folderWatch),
            subtitle: Text(s.sentToInbox > 0 ? '${l.folderWatchHelp} ${l.folderSentToInbox(s.sentToInbox)}' : l.folderWatchHelp),
          ),
        ],
        if (s.untracked.isNotEmpty) ...[
          const Divider(height: CorocSpace.xl),
          Overline(l.folderUntrackedTitle(s.untracked.length)),
          const SizedBox(height: 4),
          Text(l.folderUntrackedHelp, style: t.bodySmall),
          for (final f in s.untracked.take(20))
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.note_add_outlined),
              title: Text(f.name, overflow: TextOverflow.ellipsis),
              subtitle: Text(f.dir.join(' › '), overflow: TextOverflow.ellipsis),
              trailing: TextButton(
                onPressed: () async {
                  try {
                    await c.import(f);
                    if (context.mounted) _toast(context, l.docUploaded(f.name));
                  } catch (e) {
                    if (context.mounted) _toast(context, errorText(context, e));
                  }
                },
                child: Text(l.folderImport),
              ),
            ),
        ],
      ]),
    );
  }
}

/// Mantiene la carpeta COROC al día mientras hay sesión (§16.3) y pide permiso la primera vez en cada dispositivo.
class FolderAutoSync extends ConsumerStatefulWidget {
  const FolderAutoSync({super.key, required this.child});
  final Widget child;
  @override
  ConsumerState<FolderAutoSync> createState() => _FolderAutoSyncState();
}

class _FolderAutoSyncState extends ConsumerState<FolderAutoSync> {
  Timer? _debounce;
  bool _asked = false;

  @override
  void initState() {
    super.initState();
    Future.microtask(() async {
      ref.read(folderProvider.notifier).start();
      if (!mounted || _asked) return;
      _asked = true;
      final already = await ref.read(sessionStoreProvider).folderAsked();
      // Espera a saber si ya hay carpeta configurada antes de preguntar.
      for (var i = 0; i < 20 && ref.read(folderProvider).status == FolderStatus.loading; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 100));
      }
      if (!already && mounted && ref.read(folderProvider).status == FolderStatus.notConfigured) await askForFolder(context, ref);
    });
  }

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(eventsProvider, (_, next) {
      final e = next.valueOrNull;
      if (e == null || (e.type != 'document.created' && e.type != 'client.updated' && e.type != 'loan.created')) return;
      _debounce?.cancel();
      _debounce = Timer(const Duration(seconds: 3), () => ref.read(folderProvider.notifier).sync());
    });
    ref.listen<AuthState>(authProvider, (prev, next) {
      if (next is! SignedIn) ref.read(folderProvider.notifier).stop();
    });
    return widget.child;
  }
}

// ─────────────────────────── Respaldo (§19) ───────────────────────────

final backupsProvider = FutureProvider.autoDispose<List<BackupInfo>>((ref) => ref.watch(apiProvider).backups());

/// Crear respaldo: contraseña (mínimo 10 caracteres) y confirmación. Está en Configuración y en el menú principal.
Future<void> showCreateBackupDialog(BuildContext context, WidgetRef ref) async {
  final l = context.l10n;
  final pw = TextEditingController();
  final pw2 = TextEditingController();
  String? error;
  final ok = await showDialog<bool>(
    context: context,
    builder: (context) => StatefulBuilder(
      builder: (context, setLocal) => AlertDialog(
        title: Text(l.backupCreate),
        content: SizedBox(
          width: 460,
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(l.backupCreateExplain),
            const SizedBox(height: CorocSpace.md),
            TextField(controller: pw, obscureText: true, decoration: corocInput(context, label: l.backupPassword, helper: l.backupPasswordHelp)),
            const SizedBox(height: CorocSpace.md),
            TextField(controller: pw2, obscureText: true, decoration: corocInput(context, label: l.backupPasswordConfirm, error: error)),
          ]),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(l.actionCancel)),
          FilledButton(
            onPressed: () {
              if (pw.text.length < 10) return setLocal(() => error = l.backupPasswordShort);
              if (pw.text != pw2.text) return setLocal(() => error = l.backupPasswordMismatch);
              Navigator.pop(context, true);
            },
            child: Text(l.backupCreate),
          ),
        ],
      ),
    ),
  );
  if (ok != true || !context.mounted) return;
  try {
    await ref.read(apiProvider).createBackup(pw.text);
    ref.invalidate(backupsProvider);
    if (context.mounted) _toast(context, l.backupStarted);
  } catch (e) {
    if (context.mounted) _toast(context, errorText(context, e));
  }
}

class BackupSection extends ConsumerStatefulWidget {
  const BackupSection({super.key});
  @override
  ConsumerState<BackupSection> createState() => _BackupSectionState();
}

class _BackupSectionState extends ConsumerState<BackupSection> {
  Timer? _poll;
  final Map<String, double> _downloading = {};

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    final list = ref.watch(backupsProvider);
    // Mientras haya un respaldo en curso se consulta su avance cada 1,5 s.
    final running = list.valueOrNull?.any((b) => b.running) ?? false;
    if (running && _poll == null) {
      _poll = Timer.periodic(const Duration(milliseconds: 1500), (_) => ref.invalidate(backupsProvider));
    } else if (!running && _poll != null) {
      _poll!.cancel();
      _poll = null;
    }
    return SectionCard(
      title: l.backupTitle,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(l.backupExplain, style: t.bodyMedium),
        const SizedBox(height: CorocSpace.md),
        Align(
          alignment: Alignment.centerLeft,
          child: GoldButton(label: l.backupCreate, icon: Icons.backup_outlined, onPressed: running ? null : () => showCreateBackupDialog(context, ref)),
        ),
        const SizedBox(height: CorocSpace.md),
        AsyncBody<List<BackupInfo>>(
          value: list,
          onRetry: () => ref.invalidate(backupsProvider),
          builder: (items) => items.isEmpty
              ? Text(l.backupNone, style: t.bodySmall)
              : Column(children: [for (final b in items.take(10)) _tile(context, b)]),
        ),
      ]),
    );
  }

  Widget _tile(BuildContext context, BackupInfo b) {
    final l = context.l10n;
    final dl = _downloading[b.id];
    final (label, tone) = switch (b.status) {
      'done' => (l.backupDone, StatusTone.ok),
      'failed' => (l.backupFailed, StatusTone.error),
      'cancelled' => (l.backupCancelled, StatusTone.neutral),
      _ => (l.backupRunning(b.progress), StatusTone.info),
    };
    final counts = b.counts;
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: const Icon(Icons.inventory_2_outlined),
      title: Text(b.fileName ?? Dates.dateTime(b.createdAt, context.lang), overflow: TextOverflow.ellipsis),
      subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Wrap(spacing: 8, children: [
          StatusDot(label: label, tone: tone),
          if (b.size != null) Text(fileSize(b.size!)),
          if (counts.isNotEmpty) Text(l.backupCounts(counts['clients'] ?? 0, counts['loans'] ?? 0, counts['documents'] ?? 0)),
        ]),
        if (b.running) Padding(padding: const EdgeInsets.only(top: 6), child: LinearProgressIndicator(value: b.progress / 100)),
        if (dl != null) Padding(padding: const EdgeInsets.only(top: 6), child: LinearProgressIndicator(value: dl < 0 ? null : dl)),
      ]),
      trailing: b.running
          ? TextButton(onPressed: () => _cancel(b), child: Text(l.actionCancel))
          : b.status == 'done' && dl == null
              ? Builder(builder: (btn) => IconButton(tooltip: l.backupDownload, icon: const Icon(Icons.download_outlined), onPressed: () => _download(btn, b)))
              : null,
    );
  }

  Future<void> _cancel(BackupInfo b) async {
    try {
      await ref.read(apiProvider).cancelBackup(b.id);
      ref.invalidate(backupsProvider);
    } catch (e) {
      if (mounted) _toast(context, errorText(context, e));
    }
  }

  /// Descarga reanudable (§19). Se guarda en COROC/_Respaldos si la carpeta está conectada y, además, se puede
  /// guardar en otra ubicación o compartir.
  Future<void> _download(BuildContext btn, BackupInfo b) async {
    final l = context.l10n;
    setState(() => _downloading[b.id] = -1);
    try {
      final link = await ref.read(apiProvider).backupLink(b.id);
      final tmp = File(p.join((await getTemporaryDirectory()).path, 'coroc-backups', b.fileName ?? '${b.id}.coroc'));
      if (await tmp.exists()) await tmp.delete();
      await ref.read(apiClientProvider).download(link.path, tmp, onProgress: (r, total) {
        if (mounted && total > 0) setState(() => _downloading[b.id] = r / total);
      });
      final saved = await ref.read(folderProvider.notifier).saveToRoot(3, b.fileName ?? p.basename(tmp.path), tmp);
      if (!mounted) return;
      if (saved != null) _toast(context, l.docSaved(saved));
      if (Platform.isWindows || Platform.isLinux || Platform.isMacOS) {
        if (saved == null || await _askAlsoSave()) {
          final loc = await getSaveLocation(suggestedName: b.fileName, confirmButtonText: l.actionSave);
          if (loc != null) {
            await tmp.copy(loc.path);
            if (mounted) _toast(context, l.docSaved(loc.path));
          }
        }
      } else if (btn.mounted) {
        final box = btn.findRenderObject() as RenderBox?;
        await SharePlus.instance.share(ShareParams(files: [XFile(tmp.path, mimeType: 'application/octet-stream')], sharePositionOrigin: box == null ? null : box.localToGlobal(Offset.zero) & box.size));
      }
      await tmp.delete().catchError((_) => tmp);
    } catch (e) {
      if (mounted) _toast(context, errorText(context, e));
    } finally {
      if (mounted) setState(() => _downloading.remove(b.id));
    }
  }

  Future<bool> _askAlsoSave() async {
    final l = context.l10n;
    return await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            content: Text(l.backupAlsoSave),
            actions: [
              TextButton(onPressed: () => Navigator.pop(context, false), child: Text(l.actionNo)),
              FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(l.actionYes)),
            ],
          ),
        ) ??
        false;
  }
}

// ─────────────────────────── Restauración (§19, solo Propietario) ───────────────────────────

class RestoreSection extends ConsumerStatefulWidget {
  const RestoreSection({super.key});
  @override
  ConsumerState<RestoreSection> createState() => _RestoreSectionState();
}

class _RestoreSectionState extends ConsumerState<RestoreSection> {
  double? _upload;
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    return SectionCard(
      title: l.restoreTitle,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(l.restoreExplain, style: t.bodyMedium),
        const SizedBox(height: CorocSpace.md),
        Align(
          alignment: Alignment.centerLeft,
          child: OutlinedButton.icon(onPressed: _busy ? null : _start, icon: const Icon(Icons.settings_backup_restore), label: Text(l.restoreStart)),
        ),
        if (_upload != null) ...[
          const SizedBox(height: CorocSpace.md),
          Text(l.restoreUploading((_upload! * 100).round())),
          const SizedBox(height: 6),
          LinearProgressIndicator(value: _upload),
        ] else if (_busy) ...[
          const SizedBox(height: CorocSpace.md),
          const LinearProgressIndicator(),
        ],
      ]),
    );
  }

  Future<void> _start() async {
    final l = context.l10n;
    final file = await openFile(acceptedTypeGroups: [XTypeGroup(label: l.restoreFileType, extensions: const ['coroc'], uniformTypeIdentifiers: const ['public.data'])]);
    if (file == null || !mounted) return;
    setState(() {
      _busy = true;
      _upload = 0;
    });
    final api = ref.read(apiProvider);
    try {
      final length = await file.length();
      final up = await api.uploadRestore(open: file.openRead, length: length, onProgress: (s, total) {
        if (mounted) setState(() => _upload = total == 0 ? null : s / total);
      });
      if (!mounted) return;
      setState(() => _upload = null);
      // 1) Contraseña → verificación de integridad y simulación.
      final pw = await _ask(l.restorePasswordTitle, l.backupPassword, obscure: true);
      if (pw == null || !mounted) return;
      final verified = await api.verifyRestore(up.id, pw);
      if (!mounted) return;
      // 2) Resumen y confirmación escribiendo el nombre de la empresa.
      final company = (ref.read(authProvider) as SignedIn).company.name;
      final name = await _confirm(verified.summary!, company);
      if (name == null || !mounted) return;
      await api.applyRestore(up.id, pw, name);
      await ref.read(authProvider.notifier).refreshCompany();
      ref.invalidate(backupsProvider);
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          icon: const Icon(Icons.check_circle_outline, size: 40),
          title: Text(l.restoreDoneTitle),
          content: Text(l.restoreDoneBody),
          actions: [FilledButton(onPressed: () => Navigator.pop(context), child: Text(l.actionDone))],
        ),
      );
      unawaited(ref.read(folderProvider.notifier).sync(full: true));
    } catch (e) {
      if (mounted) _toast(context, errorText(context, e));
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _upload = null;
        });
      }
    }
  }

  Future<String?> _ask(String title, String label, {bool obscure = false}) {
    final l = context.l10n;
    final c = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: SizedBox(width: 420, child: TextField(controller: c, obscureText: obscure, autofocus: true, decoration: corocInput(context, label: label))),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: Text(l.actionCancel)),
          FilledButton(onPressed: () => Navigator.pop(context, c.text), child: Text(l.actionContinue)),
        ],
      ),
    );
  }

  Future<String?> _confirm(RestoreSummary s, String company) {
    final l = context.l10n;
    final c = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setLocal) => AlertDialog(
          icon: Icon(Icons.warning_amber_rounded, size: 40, color: Theme.of(context).colorScheme.error),
          title: Text(l.restoreConfirmTitle),
          content: SizedBox(
            width: 480,
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text(l.restoreSummary(s.counts['clients'] ?? 0, s.counts['loans'] ?? 0, s.documents), style: Theme.of(context).textTheme.titleSmall),
              const SizedBox(height: 8),
              KeyValue(l.restoreFrom, s.company),
              KeyValue(l.restoreCreatedAt, s.createdAt),
              KeyValue(l.docSize, fileSize(s.bytes)),
              const SizedBox(height: CorocSpace.md),
              Text(l.restoreWarning(company)),
              const SizedBox(height: CorocSpace.md),
              TextField(controller: c, autofocus: true, onChanged: (_) => setLocal(() {}), decoration: corocInput(context, label: l.restoreTypeName)),
            ]),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context), child: Text(l.actionCancel)),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: Theme.of(context).colorScheme.error, foregroundColor: Theme.of(context).colorScheme.onError),
              onPressed: c.text.trim().toLowerCase() == company.trim().toLowerCase() ? () => Navigator.pop(context, c.text) : null,
              child: Text(l.restoreApply),
            ),
          ],
        ),
      ),
    );
  }
}
