import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../../design/widgets/common.dart';

final uploadLinkProvider = FutureProvider.autoDispose.family<UploadLink?, String>((ref, loanId) => ref.watch(apiProvider).uploadLink(loanId));

/// Enlace personal de carga del préstamo (§12.3): el deudor ve su plan y sube el comprobante desde el celular, y el
/// enlace lo identifica. Se puede copiar, compartir, cambiar (el anterior deja de funcionar) o desactivar.
class UploadLinkCard extends ConsumerStatefulWidget {
  const UploadLinkCard({super.key, required this.loan});
  final Loan loan;
  @override
  ConsumerState<UploadLinkCard> createState() => _UploadLinkCardState();
}

class _UploadLinkCardState extends ConsumerState<UploadLinkCard> {
  bool _busy = false;

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
      ref.invalidate(uploadLinkProvider(widget.loan.id));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(context, e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<bool> _confirm(String text) async =>
      await showDialog<bool>(
        context: context,
        builder: (c) => AlertDialog(
          content: Text(text),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: Text(context.l10n.actionCancel)),
            FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(context.l10n.actionConfirm)),
          ],
        ),
      ) ??
      false;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    final auth = ref.watch(authProvider);
    final canManage = auth is SignedIn && auth.user.can('payments.register');
    final link = ref.watch(uploadLinkProvider(widget.loan.id));
    final api = ref.read(apiProvider);
    return SectionCard(
      title: l.uploadLinkTitle,
      child: AsyncBody<UploadLink?>(
        value: link,
        onRetry: () => ref.invalidate(uploadLinkProvider(widget.loan.id)),
        builder: (u) => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(l.uploadLinkHelp, style: t.bodySmall),
            const SizedBox(height: 12),
            if (u == null)
              Text(l.uploadLinkNone, style: t.bodyMedium)
            else ...[
              SelectableText(u.url, style: t.bodyMedium?.copyWith(fontFamily: 'monospace')),
              const SizedBox(height: 4),
              Text('${l.uploadLinkExpires(Dates.medium(u.expiresAt.substring(0, 10), context.lang))} · ${l.uploadLinkUses(u.uses)}', style: t.bodySmall),
            ],
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (u != null) ...[
                  OutlinedButton.icon(
                    onPressed: () async {
                      await Clipboard.setData(ClipboardData(text: u.url));
                      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l.uploadLinkCopied)));
                    },
                    icon: const Icon(Icons.copy, size: 18),
                    label: Text(l.uploadLinkCopy),
                  ),
                  OutlinedButton.icon(
                    onPressed: () {
                      final box = context.findRenderObject() as RenderBox?;
                      SharePlus.instance.share(ShareParams(text: l.uploadLinkShareText(u.url), sharePositionOrigin: box == null ? null : box.localToGlobal(Offset.zero) & box.size));
                    },
                    icon: const Icon(Icons.ios_share, size: 18),
                    label: Text(l.uploadLinkShare),
                  ),
                ],
                if (canManage && widget.loan.status == 'active')
                  TextButton(
                    onPressed: _busy
                        ? null
                        : () async {
                            if (u != null && !await _confirm(l.uploadLinkRotateConfirm)) return;
                            await _run(() => api.rotateUploadLink(widget.loan.id));
                          },
                    child: Text(u == null ? l.uploadLinkCreate : l.uploadLinkRotate),
                  ),
                if (canManage && u != null) TextButton(onPressed: _busy ? null : () => _run(() => api.revokeUploadLink(widget.loan.id)), child: Text(l.uploadLinkRevoke)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
