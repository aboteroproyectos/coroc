import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/l10n.dart';
import '../../design/tokens.dart';
import '../../design/widgets/brand.dart';
import '../../design/widgets/common.dart';
import 'login_page.dart';

/// Segundo factor (TOTP) en el ingreso (§7.1).
class MfaPage extends ConsumerStatefulWidget {
  const MfaPage({super.key});
  @override
  ConsumerState<MfaPage> createState() => _MfaPageState();
}

class _MfaPageState extends ConsumerState<MfaPage> {
  final _code = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _verify() async {
    if (_busy || _code.text.length != 6) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(authProvider.notifier).verifyMfa(_code.text);
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
    return AuthFrame(title: l.mfaTitle, subtitle: l.mfaSubtitle, children: [
      CodeField(controller: _code, onSubmit: _verify, error: _error),
      const SizedBox(height: CorocSpace.lg),
      GoldButton(label: l.mfaVerify, onPressed: _verify, busy: _busy, expand: true),
      const SizedBox(height: CorocSpace.sm),
      TextButton(onPressed: () => ref.read(authProvider.notifier).cancelChallenge(), child: Text(l.actionCancel)),
    ]);
  }
}
