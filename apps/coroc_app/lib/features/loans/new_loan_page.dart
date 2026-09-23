import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/l10n.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../../design/tokens.dart';
import '../../design/widgets/brand.dart';
import '../../design/widgets/common.dart';
import '../shell/app_shell.dart';
import 'loan_providers.dart';
import 'loan_terms_form.dart';

/// Nuevo préstamo para un cliente existente (§8.4): mismas condiciones, vista previa y control del tope que el asistente.
class NewLoanPage extends ConsumerWidget {
  const NewLoanPage({super.key, required this.clientId});
  final String clientId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authProvider);
    if (auth is SignedIn && !auth.user.can('loans.create')) return const NoPermission();
    final client = ref.watch(clientProvider(clientId));
    return AsyncBody<Client>(
      value: client,
      onRetry: () => ref.invalidate(clientProvider(clientId)),
      builder: (c) => _NewLoanForm(client: c),
    );
  }
}

class _NewLoanForm extends ConsumerStatefulWidget {
  const _NewLoanForm({required this.client});
  final Client client;
  @override
  ConsumerState<_NewLoanForm> createState() => _NewLoanFormState();
}

class _NewLoanFormState extends ConsumerState<_NewLoanForm> {
  late final LoanTermsController _terms = LoanTermsController(currency: ref.read(sessionProvider)?.company.currency ?? 'COP');
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _terms.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final input = _terms.toLoanInput();
    if (input == null || !_terms.compliant || _busy) return;
    final l = context.l10n;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final loan = await ref.read(apiProvider).addLoan(widget.client.id, input);
      if (!mounted) return;
      ref.invalidate(clientProvider(widget.client.id));
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l.newLoanCreated(loan.contract))));
      context.go('/clients/${widget.client.id}');
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = errorText(context, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final active = widget.client.loans.where((x) => x.status == 'active').length;
    return PageScaffold(maxWidth: 920, children: [
      PageHeader(
        overline: widget.client.fullName,
        title: l.actionNewLoan,
        subtitle: active == 0 ? widget.client.code : '${widget.client.code} · ${l.loansCount(active)}',
        actions: [TextButton.icon(onPressed: () => context.go('/clients/${widget.client.id}'), icon: const Icon(Icons.close), label: Text(l.actionCancel))],
      ),
      SectionCard(child: LoanTermsForm(controller: _terms)),
      if (_error != null) ...[
        const SizedBox(height: CorocSpace.md),
        Semantics(liveRegion: true, child: StatusDot(label: _error!, tone: StatusTone.error)),
      ],
      const SizedBox(height: CorocSpace.lg),
      ListenableBuilder(
        listenable: _terms,
        builder: (context, _) => Align(
          alignment: Alignment.centerRight,
          child: GoldButton(label: l.newLoanCreate, icon: Icons.check, busy: _busy, onPressed: _terms.toLoanInput() != null && _terms.compliant ? _save : null),
        ),
      ),
    ]);
  }
}
