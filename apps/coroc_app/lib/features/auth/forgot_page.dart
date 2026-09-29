import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/l10n.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/brand.dart';
import '../../design/widgets/common.dart';
import 'login_page.dart';

/// Recuperación de contraseña por correo con enlace de un solo uso (§7.1).
class ForgotPage extends ConsumerStatefulWidget {
  const ForgotPage({super.key});
  @override
  ConsumerState<ForgotPage> createState() => _ForgotPageState();
}

class _ForgotPageState extends ConsumerState<ForgotPage> {
  final _tenant = TextEditingController();
  final _user = TextEditingController();
  bool _busy = false;
  bool _sent = false;
  String? _error;

  @override
  void dispose() {
    _tenant.dispose();
    _user.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    if (_tenant.text.trim().isEmpty || _user.text.trim().isEmpty) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(apiProvider).forgotPassword(_tenant.text.trim().toLowerCase(), _user.text.trim().toLowerCase());
      if (mounted) setState(() => _sent = true);
    } catch (e) {
      if (mounted) setState(() => _error = errorText(context, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return AuthFrame(
      title: l.forgotTitle,
      subtitle: _sent ? l.forgotSent : l.forgotSubtitle,
      children: [
        if (!_sent) ...[
          TextField(
            controller: _tenant,
            decoration: corocInput(context, label: l.loginCompany),
            autocorrect: false,
          ),
          const SizedBox(height: CorocSpace.md),
          TextField(
            controller: _user,
            decoration: corocInput(context, label: l.loginUsername, error: _error),
            autocorrect: false,
            onSubmitted: (_) => _send(),
          ),
          const SizedBox(height: CorocSpace.lg),
          GoldButton(label: l.forgotSubmit, onPressed: _send, busy: _busy, expand: true),
        ],
        const SizedBox(height: CorocSpace.sm),
        TextButton(onPressed: () => context.go('/login'), child: Text(l.forgotBack)),
      ],
    );
  }
}
