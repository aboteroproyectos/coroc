import 'dart:async';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/desktop/desktop_runtime.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/brand.dart';
import '../../design/widgets/common.dart';
import '../desktop/gmail_connect.dart';
import '../desktop/receipt_catcher.dart' show watchDownloadsProvider;

/// Copia automática diaria de COROC Escritorio (ADR-066).
final autoBackupProvider = FutureProvider.autoDispose<AutoBackup>((ref) => ref.watch(apiProvider).autoBackup());

void _toast(BuildContext context, String text) => ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(text)));

String gmailProblem(AppLocalizations l, String? code) => switch (code) {
  'GMAIL_AUTH_FAILED' => l.gmailProblemAuth,
  'GMAIL_UNREACHABLE' => l.gmailProblemNetwork,
  _ => l.gmailProblemOther,
};

String autoBackupProblem(AppLocalizations l, String? code) => switch (code) {
  'AUTO_BACKUP_FOLDER_UNAVAILABLE' => l.autoBackupProblemFolder,
  _ => l.autoBackupProblemOther,
};

/// Este PC (COROC Escritorio): iniciar con Windows, Windows Hello y el aviso de comprobantes en Descargas.
class DesktopPcSection extends ConsumerStatefulWidget {
  const DesktopPcSection({super.key});
  @override
  ConsumerState<DesktopPcSection> createState() => _DesktopPcSectionState();
}

class _DesktopPcSectionState extends ConsumerState<DesktopPcSection> {
  bool? _autostart;
  bool? _hello;
  bool _helloAvailable = false;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    final platform = ref.read(desktopPlatformProvider);
    final autostart = await platform.autostartEnabled();
    final available = await platform.helloAvailable();
    final hello = await ref.read(sessionStoreProvider).helloEnabled();
    if (mounted) {
      setState(() {
        _autostart = autostart;
        _helloAvailable = available;
        _hello = hello;
      });
    }
  }

  Future<void> _setAutostart(bool on) async {
    try {
      await ref.read(desktopPlatformProvider).setAutostart(on);
      if (mounted) setState(() => _autostart = on);
    } catch (_) {
      if (mounted) _toast(context, context.l10n.desktopAutostartFailed);
    }
  }

  Future<void> _setHello(bool on) async {
    // Activarlo pide confirmar con Windows Hello una vez.
    if (on && !await ref.read(desktopPlatformProvider).verifyUser(context.l10n.helloReason)) return;
    await ref.read(sessionStoreProvider).saveHelloEnabled(on);
    if (mounted) setState(() => _hello = on);
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return SectionCard(
      title: l.desktopPcTitle,
      child: Column(
        children: [
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            value: _autostart ?? false,
            onChanged: _autostart == null ? null : _setAutostart,
            title: Text(l.desktopAutostart),
            subtitle: Text(l.desktopAutostartHelp),
          ),
          if (_helloAvailable)
            SwitchListTile(contentPadding: EdgeInsets.zero, value: _hello ?? false, onChanged: _hello == null ? null : _setHello, title: Text(l.welcomeHello), subtitle: Text(l.welcomeHelloHelp)),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            value: ref.watch(watchDownloadsProvider),
            onChanged: (v) => ref.read(watchDownloadsProvider.notifier).set(v),
            title: Text(l.desktopWatchDownloads),
            subtitle: Text(l.desktopWatchDownloadsHelp),
          ),
        ],
      ),
    );
  }
}

/// Gmail de la empresa (ADR-065): estado, prueba y conexión con la guía.
class GmailSection extends ConsumerWidget {
  const GmailSection({super.key, required this.canEdit});
  final bool canEdit;

  Future<void> _connect(BuildContext context) => showDialog<void>(
    context: context,
    builder: (c) => AlertDialog(
      title: Text(c.l10n.welcomeGmailTitle),
      content: SizedBox(
        width: 880,
        child: SingleChildScrollView(child: GmailConnectForm(onConnected: (_) => Navigator.pop(c))),
      ),
      actions: [TextButton(onPressed: () => Navigator.pop(c), child: Text(c.l10n.actionClose))],
    ),
  );

  Future<void> _test(BuildContext context, WidgetRef ref) async {
    final l = context.l10n;
    try {
      final a = await ref.read(apiProvider).testGmail();
      ref.invalidate(gmailProvider);
      if (context.mounted) _toast(context, a.failing ? gmailProblem(l, a.lastError) : l.gmailTestOk);
    } catch (e) {
      if (context.mounted) _toast(context, errorText(context, e));
    }
  }

  Future<void> _remove(BuildContext context, WidgetRef ref) async {
    final l = context.l10n;
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(l.gmailDisconnect),
        content: Text(l.gmailDisconnectConfirm),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(l.actionCancel)),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(l.gmailDisconnect)),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(apiProvider).deleteGmail();
      ref.invalidate(gmailProvider);
    } catch (e) {
      if (context.mounted) _toast(context, errorText(context, e));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    return SectionCard(
      title: l.welcomeGmailTitle,
      child: AsyncBody<GmailAccount>(
        value: ref.watch(gmailProvider),
        onRetry: () => ref.invalidate(gmailProvider),
        builder: (a) {
          if (!a.connected) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(l.gmailNotConnected),
                if (canEdit) ...[
                  const SizedBox(height: CorocSpace.md),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: GoldButton(label: l.gmailConnect, icon: Icons.alternate_email, onPressed: () => _connect(context)),
                  ),
                ],
              ],
            );
          }
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(child: Text(a.address ?? '—', style: Theme.of(context).textTheme.titleMedium)),
                  StatusDot(label: a.failing ? l.gmailStatusProblem : l.gmailStatusActive, tone: a.failing ? StatusTone.error : StatusTone.ok),
                ],
              ),
              const SizedBox(height: CorocSpace.sm),
              Text(l.gmailUsage(a.sentToday, a.dailyLimit, a.label), style: Theme.of(context).textTheme.bodySmall),
              if (a.lastCheckAt != null) Text(l.gmailLastCheck(Dates.dateTime(a.lastCheckAt!, context.lang)), style: Theme.of(context).textTheme.bodySmall),
              if (a.failing) ...[const SizedBox(height: CorocSpace.md), ResultBox(ok: false, text: gmailProblem(l, a.lastError))],
              if (canEdit) ...[
                const SizedBox(height: CorocSpace.md),
                Wrap(
                  spacing: CorocSpace.sm,
                  runSpacing: CorocSpace.sm,
                  children: [
                    OutlinedButton.icon(onPressed: () => _test(context, ref), icon: const Icon(Icons.wifi_tethering, size: 18), label: Text(l.gmailTest)),
                    if (a.failing) OutlinedButton.icon(onPressed: () => _connect(context), icon: const Icon(Icons.key_outlined, size: 18), label: Text(l.gmailReconnect)),
                    TextButton(onPressed: () => _remove(context, ref), child: Text(l.gmailDisconnect)),
                  ],
                ),
              ],
            ],
          );
        },
      ),
    );
  }
}

/// Copia diaria automática y cifrada en una carpeta de este PC: OneDrive, Google Drive para escritorio o una memoria
/// USB (ADR-066). Aviso si pasan 7 días sin copia.
class AutoBackupSection extends ConsumerStatefulWidget {
  const AutoBackupSection({super.key});
  @override
  ConsumerState<AutoBackupSection> createState() => _AutoBackupSectionState();
}

class _AutoBackupSectionState extends ConsumerState<AutoBackupSection> {
  String? _folder;
  final _password = TextEditingController();
  final _password2 = TextEditingController();
  int _keep = 7;
  bool _editing = false;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _password.dispose();
    _password2.dispose();
    super.dispose();
  }

  Future<void> _pick() async {
    final dir = await getDirectoryPath(confirmButtonText: context.l10n.autoBackupChoose);
    if (dir != null && mounted) setState(() => _folder = dir);
  }

  Future<void> _save(AutoBackup current) async {
    final l = context.l10n;
    final folder = _folder ?? current.folder;
    if (folder == null) return setState(() => _error = l.autoBackupFolderRequired);
    final newPassword = !current.configured || _password.text.isNotEmpty;
    if (newPassword && _password.text.length < 10) return setState(() => _error = l.autoBackupPasswordShort);
    if (newPassword && _password.text != _password2.text) return setState(() => _error = l.welcomePasswordMismatch);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(apiProvider).saveAutoBackup(folder: folder, password: newPassword ? _password.text : null, keep: _keep, enabled: true);
      _password.clear();
      _password2.clear();
      ref.invalidate(autoBackupProvider);
      if (mounted) setState(() => _editing = false);
    } catch (e) {
      if (mounted) setState(() => _error = errorText(context, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _run() async {
    try {
      await ref.read(apiProvider).runAutoBackup();
      ref.invalidate(autoBackupProvider);
      if (mounted) _toast(context, context.l10n.autoBackupStarted);
    } catch (e) {
      if (mounted) _toast(context, errorText(context, e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    return SectionCard(
      title: l.autoBackupTitle,
      child: AsyncBody<AutoBackup>(
        value: ref.watch(autoBackupProvider),
        onRetry: () => ref.invalidate(autoBackupProvider),
        builder: (a) {
          final editing = _editing || !a.configured;
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(l.autoBackupHelp, style: t.bodyMedium),
              const SizedBox(height: CorocSpace.md),
              if (a.overdue) ...[ResultBox(ok: false, text: l.backupOverdue), const SizedBox(height: CorocSpace.md)],
              if (a.configured && a.lastError != null) ...[ResultBox(ok: false, text: autoBackupProblem(l, a.lastError)), const SizedBox(height: CorocSpace.md)],
              if (a.configured && !editing) ...[
                KeyValue(l.autoBackupFolder, a.folder ?? '—'),
                KeyValue(l.autoBackupLast, a.lastSuccessAt == null ? l.autoBackupNever : Dates.dateTime(a.lastSuccessAt!, context.lang)),
                if (a.lastFile != null) KeyValue(l.autoBackupFile, a.lastFile!),
                KeyValue(l.autoBackupKeep, '${a.keep}'),
                const SizedBox(height: CorocSpace.md),
                Wrap(
                  spacing: CorocSpace.sm,
                  runSpacing: CorocSpace.sm,
                  children: [
                    GoldButton(label: a.running ? l.autoBackupRunning : l.autoBackupRun, icon: Icons.backup_outlined, busy: a.running, onPressed: a.running ? null : _run),
                    OutlinedButton(onPressed: () => setState(() => _editing = true), child: Text(l.autoBackupChange)),
                  ],
                ),
              ] else ...[
                OutlinedButton.icon(onPressed: _pick, icon: const Icon(Icons.folder_open), label: Text(_folder ?? a.folder ?? l.autoBackupChoose)),
                const SizedBox(height: CorocSpace.sm),
                Text(l.autoBackupFolderHelp, style: t.bodySmall),
                const SizedBox(height: CorocSpace.md),
                TextField(
                  controller: _password,
                  obscureText: true,
                  decoration: corocInput(context, label: l.autoBackupPassword, helper: a.configured ? l.autoBackupPasswordKeep : l.autoBackupPasswordHelp),
                ),
                const SizedBox(height: CorocSpace.md),
                TextField(
                  controller: _password2,
                  obscureText: true,
                  decoration: corocInput(context, label: l.welcomePasswordAgain),
                ),
                const SizedBox(height: CorocSpace.md),
                DropdownMenu<int>(
                  initialSelection: a.configured ? a.keep : _keep,
                  label: Text(l.autoBackupKeep),
                  dropdownMenuEntries: [
                    for (final n in const [3, 7, 14, 30]) DropdownMenuEntry(value: n, label: '$n'),
                  ],
                  onSelected: (v) => _keep = v ?? _keep,
                ),
                if (_error != null) ...[const SizedBox(height: CorocSpace.md), ResultBox(ok: false, text: _error!)],
                const SizedBox(height: CorocSpace.md),
                Wrap(
                  spacing: CorocSpace.sm,
                  children: [
                    GoldButton(label: l.actionSave, onPressed: () => _save(a), busy: _busy),
                    if (a.configured) TextButton(onPressed: () => setState(() => _editing = false), child: Text(l.actionCancel)),
                  ],
                ),
              ],
            ],
          );
        },
      ),
    );
  }
}

/// Aviso en la parte de arriba de COROC Escritorio cuando pasan 7 días sin copia (ADR-066). Se vuelve a consultar cada
/// 10 minutos: la copia diaria la hace el servidor por su cuenta y el aviso se quita solo cuando termina.
class BackupReminder extends ConsumerStatefulWidget {
  const BackupReminder({super.key, this.settingsRoute = '/settings'});

  /// Dónde se configura la copia diaria.
  final String settingsRoute;
  @override
  ConsumerState<BackupReminder> createState() => _BackupReminderState();
}

class _BackupReminderState extends ConsumerState<BackupReminder> {
  Timer? _refresh;

  @override
  void initState() {
    super.initState();
    _refresh = Timer.periodic(const Duration(minutes: 10), (_) => ref.invalidate(autoBackupProvider));
  }

  @override
  void dispose() {
    _refresh?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final a = ref.watch(autoBackupProvider).valueOrNull;
    if (a == null || !a.overdue) return const SizedBox.shrink();
    final l = context.l10n;
    final s = Theme.of(context).colorScheme;
    return Material(
      color: s.errorContainer,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: CorocSpace.lg, vertical: CorocSpace.sm),
        child: Row(
          children: [
            Icon(Icons.backup_outlined, color: s.onErrorContainer),
            const SizedBox(width: CorocSpace.md),
            Expanded(
              child: Text(l.backupOverdue, style: TextStyle(color: s.onErrorContainer)),
            ),
            TextButton(
              onPressed: () async {
                if (!a.configured) return GoRouter.of(context).go(widget.settingsRoute);
                try {
                  await ref.read(apiProvider).runAutoBackup();
                  ref.invalidate(autoBackupProvider);
                  if (context.mounted) _toast(context, l.autoBackupStarted);
                } catch (e) {
                  if (context.mounted) _toast(context, errorText(context, e));
                }
              },
              child: Text(a.configured ? l.autoBackupRun : l.autoBackupConfigure),
            ),
          ],
        ),
      ),
    );
  }
}
