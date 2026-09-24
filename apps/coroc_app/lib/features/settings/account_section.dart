import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/l10n.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../../design/tokens.dart';
import '../../design/widgets/common.dart';

/// Eliminar la cuenta desde la app (App Store 5.1.1(v), Google Play; ADR-056). El usuario se anonimiza; el Propietario,
/// en cambio, cierra la empresa escribiendo su identificador para confirmar.
class DeleteAccountSection extends ConsumerWidget {
  const DeleteAccountSection({super.key, required this.user, required this.companySlug});
  final User user;
  final String companySlug;

  bool get _owner => user.role == 'owner';

  Future<void> _start(BuildContext context, WidgetRef ref) async {
    final l = context.l10n;
    final password = TextEditingController();
    final slug = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setState) => AlertDialog(
          icon: const Icon(Icons.warning_amber_rounded),
          title: Text(_owner ? l.closeCompanyTitle : l.deleteAccountTitle),
          content: SizedBox(
            width: 460,
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text(_owner ? l.closeCompanyBody : l.deleteAccountBody),
              const SizedBox(height: CorocSpace.md),
              TextField(controller: password, obscureText: true, autofillHints: const [AutofillHints.password], decoration: InputDecoration(labelText: l.deleteAccountPassword), onChanged: (_) => setState(() {})),
              if (_owner) ...[
                const SizedBox(height: CorocSpace.sm),
                TextField(controller: slug, decoration: InputDecoration(labelText: l.closeCompanyConfirm(companySlug)), onChanged: (_) => setState(() {})),
              ],
            ]),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: Text(l.actionCancel)),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: Theme.of(context).colorScheme.error, foregroundColor: Theme.of(context).colorScheme.onError),
              onPressed: password.text.isEmpty || (_owner && slug.text.trim().toLowerCase() != companySlug) ? null : () => Navigator.pop(context, true),
              child: Text(_owner ? l.closeCompanyAction : l.deleteAccountAction),
            ),
          ],
        ),
      ),
    );
    if (ok != true || !context.mounted) return;
    try {
      final api = ref.read(apiProvider);
      if (_owner) {
        await api.closeCompany(password.text, slug.text.trim());
      } else {
        await api.deleteMyAccount(password.text);
      }
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(_owner ? l.closeCompanyDone : l.deleteAccountDone)));
      await ref.read(authProvider.notifier).forgetSession();
    } catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(context, e))));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    return SectionCard(
      title: _owner ? l.closeCompanyTitle : l.deleteAccountTitle,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(_owner ? l.closeCompanyHelp : l.deleteAccountHelp, style: Theme.of(context).textTheme.bodySmall),
        const SizedBox(height: CorocSpace.md),
        Align(
          alignment: Alignment.centerLeft,
          child: OutlinedButton.icon(
            style: OutlinedButton.styleFrom(foregroundColor: Theme.of(context).colorScheme.error, minimumSize: const Size(48, 48)),
            onPressed: () => _start(context, ref),
            icon: const Icon(Icons.delete_forever_outlined),
            label: Text(_owner ? l.closeCompanyAction : l.deleteAccountAction),
          ),
        ),
      ]),
    );
  }
}
