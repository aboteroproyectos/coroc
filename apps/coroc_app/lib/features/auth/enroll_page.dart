import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/l10n.dart';
import '../../core/models/models.dart';
import '../../design/tokens.dart';
import '../../design/widgets/brand.dart';
import '../../design/widgets/common.dart';
import 'login_page.dart';

/// Activación obligatoria del segundo factor para el Propietario (§7.1): código QR para la app autenticadora
/// y confirmación con el primer código.
class EnrollPage extends ConsumerStatefulWidget {
  const EnrollPage({super.key});
  @override
  ConsumerState<EnrollPage> createState() => _EnrollPageState();
}

class _EnrollPageState extends ConsumerState<EnrollPage> {
  final _code = TextEditingController();
  Future<MfaEnrollment>? _enrollment;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _enrollment = ref.read(authProvider.notifier).startEnrollment();
  }

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _confirm() async {
    if (_busy || _code.text.length != 6) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(authProvider.notifier).confirmEnrollment(_code.text);
    } catch (e) {
      if (mounted) setState(() => _error = errorText(context, e));
      _code.clear();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return AuthFrame(
      title: l.enrollTitle,
      subtitle: l.enrollSubtitle,
      children: [
        FutureBuilder<MfaEnrollment>(
          future: _enrollment,
          builder: (context, snap) {
            if (snap.hasError) {
              return ErrorState(
                message: errorText(context, snap.error!),
                onRetry: () => setState(() {
                  _enrollment = ref.read(authProvider.notifier).startEnrollment();
                }),
              );
            }
            if (!snap.hasData) {
              return const Center(
                child: Padding(padding: EdgeInsets.all(CorocSpace.xl), child: CircularProgressIndicator()),
              );
            }
            final e = snap.data!;
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Center(
                  child: Container(
                    padding: const EdgeInsets.all(CorocSpace.md),
                    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(CorocRadii.card)),
                    child: QrImageView(data: e.otpauthUri, size: 200, backgroundColor: Colors.white),
                  ),
                ),
                const SizedBox(height: CorocSpace.md),
                Text(l.enrollManual, style: Theme.of(context).textTheme.bodySmall, textAlign: TextAlign.center),
                const SizedBox(height: 4),
                SelectableText(
                  _group(e.secret),
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(fontFamily: 'Inter', letterSpacing: 1.5),
                ),
                TextButton.icon(
                  onPressed: () {
                    Clipboard.setData(ClipboardData(text: e.secret));
                    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l.copied)));
                  },
                  icon: const Icon(Icons.copy, size: 18),
                  label: Text(l.actionCopy),
                ),
                const SizedBox(height: CorocSpace.md),
                CodeField(controller: _code, onSubmit: _confirm, error: _error),
                const SizedBox(height: CorocSpace.lg),
                GoldButton(label: l.enrollConfirm, onPressed: _confirm, busy: _busy, expand: true),
              ],
            );
          },
        ),
        const SizedBox(height: CorocSpace.sm),
        TextButton(onPressed: () => ref.read(authProvider.notifier).logout(), child: Text(l.actionLogout)),
      ],
    );
  }

  static String _group(String s) => [for (var i = 0; i < s.length; i += 4) s.substring(i, i + 4 > s.length ? s.length : i + 4)].join(' ');
}
