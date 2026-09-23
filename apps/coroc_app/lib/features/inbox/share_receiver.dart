import 'dart:async';
import 'dart:io';

import 'package:coroc_share/coroc_share.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/l10n.dart';
import '../../core/providers.dart';
import '../../design/widgets/common.dart';
import 'inbox_page.dart';

/// «Compartir con COROC» (§12.4): los archivos que llegan desde WhatsApp u otra app se envían a la Bandeja con el
/// canal `share`. Como el sistema no entrega el número del remitente, COROC propone el cliente más probable y el
/// usuario confirma en el detalle, que se abre solo.
class ShareReceiver extends ConsumerStatefulWidget {
  const ShareReceiver({super.key, required this.child});
  final Widget child;
  @override
  ConsumerState<ShareReceiver> createState() => _ShareReceiverState();
}

class _ShareReceiverState extends ConsumerState<ShareReceiver> {
  StreamSubscription<List<String>>? _sub;
  final List<String> _queue = [];
  bool _sending = false;

  static bool get _supported => Platform.isAndroid || Platform.isIOS;

  @override
  void initState() {
    super.initState();
    if (!_supported) return;
    _sub = CorocShare.instance.files.listen(_enqueue);
    CorocShare.instance.take().then(_enqueue);
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  void _enqueue(List<String> paths) {
    if (paths.isEmpty) return;
    _queue.addAll(paths);
    _drain();
  }

  Future<void> _drain() async {
    if (_sending || _queue.isEmpty || !mounted) return;
    final auth = ref.read(authProvider);
    if (auth is! SignedIn || !auth.user.can('documents.upload')) return; // se envía al ingresar
    _sending = true;
    final l = context.l10n;
    final messenger = ScaffoldMessenger.maybeOf(context);
    messenger?.showSnackBar(SnackBar(content: Text(l.intakeSending)));
    String? last;
    try {
      while (_queue.isNotEmpty) {
        final path = _queue.removeAt(0);
        final file = File(path);
        if (!await file.exists()) continue;
        final item = await ref.read(apiProvider).uploadIntake(open: file.openRead, length: await file.length(), channel: 'share', fileName: path.split(Platform.pathSeparator).last);
        last = item.id;
        await file.delete().catchError((_) => file);
      }
      ref.invalidate(inboxProvider);
      ref.invalidate(intakeSummaryProvider);
      if (mounted && last != null) {
        messenger?.showSnackBar(SnackBar(content: Text(l.intakeSent)));
        GoRouter.of(context).go('/inbox?id=$last');
      }
    } catch (e) {
      if (mounted) messenger?.showSnackBar(SnackBar(content: Text(errorText(context, e))));
    } finally {
      _sending = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<AuthState>(authProvider, (_, next) {
      if (next is SignedIn) _drain();
    });
    return widget.child;
  }
}
