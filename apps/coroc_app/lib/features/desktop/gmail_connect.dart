import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../core/desktop/desktop_runtime.dart';
import '../../core/l10n.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/brand.dart';
import '../../design/widgets/common.dart';

/// El Gmail de la empresa conectado (o no) en este PC.
final gmailProvider = FutureProvider.autoDispose<GmailAccount>((ref) => ref.watch(apiProvider).gmail());

/// Página de Google donde se crea la contraseña de aplicación.
const gmailAppPasswordsUrl = 'https://myaccount.google.com/apppasswords';

/// Conectar el Gmail de la empresa con una contraseña de aplicación (ADR-065): guía con imágenes, prueba de conexión
/// y un mensaje claro de éxito o de lo que falta. Lo usan el asistente de primer uso y Configuración.
class GmailConnectForm extends ConsumerStatefulWidget {
  const GmailConnectForm({super.key, this.onConnected, this.showGuide = true});
  final ValueChanged<GmailAccount>? onConnected;
  final bool showGuide;

  @override
  ConsumerState<GmailConnectForm> createState() => _GmailConnectFormState();
}

class _GmailConnectFormState extends ConsumerState<GmailConnectForm> {
  final _address = TextEditingController();
  final _password = TextEditingController();
  bool _obscure = true;
  bool _busy = false;
  String? _error;
  GmailAccount? _ok;

  @override
  void dispose() {
    _address.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _connect() async {
    final l = context.l10n;
    final address = _address.text.trim().toLowerCase();
    final letters = _password.text.replaceAll(RegExp(r'\s'), '');
    if (!RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(address)) {
      setState(() => _error = l.gmailAddressInvalid);
      return;
    }
    if (!RegExp(r'^[a-zA-Z]{16}$').hasMatch(letters)) {
      setState(() => _error = l.gmailPasswordInvalid);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _ok = null;
    });
    try {
      // Guardar ya prueba la conexión: lee la bandeja de entrada (IMAP) y se identifica para enviar (SMTP).
      final account = await ref.read(apiProvider).saveGmail(address, letters);
      ref.invalidate(gmailProvider);
      if (!mounted) return;
      setState(() => _ok = account);
      _password.clear();
      widget.onConnected?.call(account);
    } catch (e) {
      if (mounted) setState(() => _error = errorText(context, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    const gap = SizedBox(height: CorocSpace.md);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (widget.showGuide) ...[const GmailGuide(), const SizedBox(height: CorocSpace.lg)],
        TextField(
          controller: _address,
          keyboardType: TextInputType.emailAddress,
          autocorrect: false,
          decoration: corocInput(context, label: l.gmailAddress, hint: 'cobros@gmail.com', prefix: const Icon(Icons.alternate_email)),
        ),
        gap,
        TextField(
          controller: _password,
          obscureText: _obscure,
          autocorrect: false,
          decoration: corocInput(
            context,
            label: l.gmailAppPassword,
            helper: l.gmailAppPasswordHelp,
            prefix: const Icon(Icons.key_outlined),
            suffix: IconButton(
              tooltip: _obscure ? l.actionShowPassword : l.actionHidePassword,
              icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined),
              onPressed: () => setState(() => _obscure = !_obscure),
            ),
          ),
          onSubmitted: (_) => _connect(),
        ),
        if (_ok != null) ...[gap, ResultBox(ok: true, text: l.gmailConnectedText(_ok!.address ?? ''))],
        if (_error != null) ...[gap, ResultBox(ok: false, text: _error!)],
        const SizedBox(height: CorocSpace.lg),
        GoldButton(label: l.gmailTest, icon: Icons.wifi_tethering, onPressed: _connect, busy: _busy, expand: true),
        if (_ok == null) ...[const SizedBox(height: CorocSpace.sm), Text(l.gmailPrivacy, style: t.bodySmall, textAlign: TextAlign.center)],
      ],
    );
  }
}

/// Los tres pasos en la cuenta de Google, cada uno con su imagen.
class GmailGuide extends ConsumerWidget {
  const GmailGuide({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    final steps = [l.gmailGuideStep1, l.gmailGuideStep2, l.gmailGuideStep3];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        LayoutBuilder(
          builder: (context, c) {
            final wide = c.maxWidth >= 720;
            final cards = [for (final (i, text) in steps.indexed) _GuideStep(number: i + 1, image: 'assets/desktop/gmail-paso-${i + 1}.svg', text: text)];
            return wide
                ? Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      for (final c in cards)
                        Expanded(
                          child: Padding(padding: const EdgeInsets.all(6), child: c),
                        ),
                    ],
                  )
                : Column(
                    children: [for (final c in cards) Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: c)],
                  );
          },
        ),
        const SizedBox(height: CorocSpace.sm),
        Text(l.gmailGuideNote, style: t.bodySmall),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(onPressed: () => ref.read(desktopPlatformProvider).openUrl(gmailAppPasswordsUrl), icon: const Icon(Icons.open_in_new, size: 18), label: Text(l.gmailOpenGoogle)),
        ),
      ],
    );
  }
}

class _GuideStep extends StatelessWidget {
  const _GuideStep({required this.number, required this.image, required this.text});
  final int number;
  final String image;
  final String text;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(CorocSpace.sm),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(CorocRadii.control),
              child: AspectRatio(
                aspectRatio: 16 / 9,
                child: SvgPicture.asset(image, fit: BoxFit.contain),
              ),
            ),
            const SizedBox(height: CorocSpace.sm),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                CircleAvatar(
                  radius: 13,
                  backgroundColor: CorocColors.gold500,
                  child: Text('$number', style: t.labelLarge?.copyWith(color: CorocColors.navy800)),
                ),
                const SizedBox(width: CorocSpace.sm),
                Expanded(child: Text(text, style: t.bodyMedium?.copyWith(height: 1.4))),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Resultado de una prueba: verde con lo que quedó listo o rojo con lo que falta.
class ResultBox extends StatelessWidget {
  const ResultBox({super.key, required this.ok, required this.text});
  final bool ok;
  final String text;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final color = ok ? CorocColors.success : s.error;
    return Semantics(
      liveRegion: true,
      child: Container(
        padding: const EdgeInsets.all(CorocSpace.md),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(CorocRadii.control),
          border: Border.all(color: color.withValues(alpha: 0.5)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(ok ? Icons.check_circle_outline : Icons.error_outline, color: color),
            const SizedBox(width: 12),
            Expanded(child: Text(text, style: Theme.of(context).textTheme.bodyMedium?.copyWith(height: 1.4))),
          ],
        ),
      ),
    );
  }
}
