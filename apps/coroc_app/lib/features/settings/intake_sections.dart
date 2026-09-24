import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/l10n.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/common.dart';
import '../loans/loan_providers.dart';

final receivingAccountsProvider = FutureProvider.autoDispose<List<ReceivingAccount>>((ref) => ref.watch(apiProvider).receivingAccounts());
final whatsAppAccountProvider = FutureProvider.autoDispose<WhatsAppAccount>((ref) => ref.watch(apiProvider).whatsAppAccount());

void _toast(BuildContext context, String text) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));

/// Cuentas donde los deudores pagan (§13.4). El beneficiario de cada comprobante se compara con ellas: sin cuentas,
/// ningún pago se registra solo.
class ReceivingAccountsSection extends ConsumerWidget {
  const ReceivingAccountsSection({super.key, required this.canEdit});
  final bool canEdit;

  Future<void> _add(BuildContext context, WidgetRef ref) async {
    final l = context.l10n;
    final holder = TextEditingController();
    final entity = TextEditingController();
    final last4 = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(l.receivingAdd),
        content: SizedBox(
          width: 420,
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            TextField(controller: holder, autofocus: true, decoration: corocInput(context, label: l.receivingHolder, helper: l.receivingHolderHelp)),
            const SizedBox(height: CorocSpace.md),
            TextField(controller: entity, decoration: corocInput(context, label: l.receivingInstitution)),
            const SizedBox(height: CorocSpace.md),
            TextField(controller: last4, keyboardType: TextInputType.number, maxLength: 4, inputFormatters: [FilteringTextInputFormatter.digitsOnly], decoration: corocInput(context, label: l.receivingLast4)),
          ]),
        ),
        actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: Text(l.actionCancel)), FilledButton(onPressed: () => Navigator.pop(c, holder.text.trim().isNotEmpty), child: Text(l.actionSave))],
      ),
    );
    if (ok == true) {
      try {
        await ref.read(apiProvider).addReceivingAccount(holderName: holder.text.trim(), institution: entity.text.trim().isEmpty ? null : entity.text.trim(), last4: last4.text.length == 4 ? last4.text : null);
        ref.invalidate(receivingAccountsProvider);
      } catch (e) {
        if (context.mounted) _toast(context, errorText(context, e));
      }
    }
    disposeAfterDialog([holder, entity, last4]);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    return SectionCard(
      title: l.receivingTitle,
      trailing: canEdit ? TextButton.icon(onPressed: () => _add(context, ref), icon: const Icon(Icons.add, size: 18), label: Text(l.receivingAdd)) : null,
      child: AsyncBody<List<ReceivingAccount>>(
        value: ref.watch(receivingAccountsProvider),
        onRetry: () => ref.invalidate(receivingAccountsProvider),
        builder: (list) {
          final active = list.where((a) => a.active).toList();
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(l.receivingHelp, style: t.bodySmall),
            const SizedBox(height: 8),
            if (active.isEmpty) Text(l.receivingEmpty, style: t.bodyMedium?.copyWith(color: Theme.of(context).colorScheme.error)),
            for (final a in active)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.account_balance_outlined),
                title: Text(a.holderName),
                subtitle: Text([a.institution, if (a.last4 != null) '•••• ${a.last4}'].whereType<String>().join(' · ')),
                trailing: canEdit
                    ? IconButton(
                        tooltip: l.actionDelete,
                        icon: const Icon(Icons.delete_outline),
                        onPressed: () async {
                          try {
                            await ref.read(apiProvider).removeReceivingAccount(a.id);
                            ref.invalidate(receivingAccountsProvider);
                          } catch (e) {
                            if (context.mounted) _toast(context, errorText(context, e));
                          }
                        },
                      )
                    : null,
              ),
          ]);
        },
      ),
    );
  }
}

/// Registro automático de pagos (§13.5): modo de supervisión, confianza mínima, antigüedad máxima y plazo para revertir.
class AutoRegistrationSection extends ConsumerStatefulWidget {
  const AutoRegistrationSection({super.key, required this.canEdit});
  final bool canEdit;
  @override
  ConsumerState<AutoRegistrationSection> createState() => _AutoRegistrationSectionState();
}

class _AutoRegistrationSectionState extends ConsumerState<AutoRegistrationSection> {
  bool _busy = false;
  double? _dragging;

  Future<void> _save(Company c, Map<String, dynamic> patch) async {
    setState(() => _busy = true);
    try {
      await ref.read(apiProvider).updateCompany({'settings': patch}, c.version);
      ref.invalidate(companyProvider);
      if (mounted) _toast(context, context.l10n.saved);
    } catch (e) {
      if (mounted) _toast(context, errorText(context, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    return SectionCard(
      title: l.autoTitle,
      child: AsyncBody<Company>(
        value: ref.watch(companyProvider),
        onRetry: () => ref.invalidate(companyProvider),
        builder: (c) {
          final s = c.settings;
          final mode = s['supervisionMode'] as String? ?? 'auto_with_audit';
          final threshold = (s['confidenceThreshold'] as num?)?.toDouble() ?? 0.95;
          final maxAge = (s['maxReceiptAgeDays'] as num?)?.toInt() ?? 30;
          final hours = (s['autoRevertHours'] as num?)?.toInt() ?? 72;
          final enabled = widget.canEdit && !_busy;
          Widget number(String label, int value, List<int> options, String key) => Padding(
                padding: const EdgeInsets.only(top: CorocSpace.md),
                child: DropdownMenu<int>(
                  enabled: enabled,
                  label: Text(label),
                  initialSelection: value,
                  onSelected: (v) => v == null || v == value ? null : _save(c, {key: v}),
                  dropdownMenuEntries: [for (final o in {...options, value}.toList()..sort()) DropdownMenuEntry(value: o, label: '$o')],
                ),
              );
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            SegmentedButton<String>(
              segments: [ButtonSegment(value: 'auto_with_audit', label: Text(l.autoModeAudit)), ButtonSegment(value: 'prior_approval', label: Text(l.autoModePrior))],
              selected: {mode},
              onSelectionChanged: enabled ? (v) => _save(c, {'supervisionMode': v.first}) : null,
            ),
            const SizedBox(height: 8),
            Text(mode == 'prior_approval' ? l.autoModePriorHelp : l.autoModeAuditHelp(hours), style: t.bodySmall),
            const SizedBox(height: CorocSpace.md),
            Text('${l.autoThreshold}: ${((_dragging ?? threshold) * 100).round()} %', style: t.bodyMedium),
            Slider(
              value: (_dragging ?? threshold).clamp(0.8, 0.99),
              min: 0.8,
              max: 0.99,
              divisions: 19,
              label: '${((_dragging ?? threshold) * 100).round()} %',
              onChanged: enabled ? (v) => setState(() => _dragging = v) : null,
              onChangeEnd: enabled
                  ? (v) {
                      _dragging = null;
                      _save(c, {'confidenceThreshold': double.parse(v.toStringAsFixed(2))});
                    }
                  : null,
            ),
            Text(l.autoThresholdHelp, style: t.bodySmall),
            Wrap(spacing: CorocSpace.md, children: [
              number(l.autoMaxAge, maxAge, const [7, 15, 30, 60, 90], 'maxReceiptAgeDays'),
              number(l.autoRevertHours, hours, const [24, 48, 72, 96, 168], 'autoRevertHours'),
            ]),
          ]);
        },
      ),
    );
  }
}

/// Número de WhatsApp Business (§12.1) y modo de envío (§11.1). El token se guarda cifrado y nunca vuelve a mostrarse. El
/// modo automático (Cloud API) solo se activa con la lista de verificación completa y la aceptación del Propietario.
class WhatsAppSection extends ConsumerWidget {
  const WhatsAppSection({super.key, required this.canEdit, this.isOwner = false});
  final bool canEdit;
  final bool isOwner;

  Future<void> _mode(BuildContext context, WidgetRef ref, WhatsAppAccount a, String mode) async {
    final l = context.l10n;
    WhatsAppChecklist? checklist;
    if (mode == 'cloud_api') {
      checklist = await showDialog<WhatsAppChecklist>(context: context, builder: (_) => _ChecklistDialog(initial: a.checklist));
      if (checklist == null) return;
    }
    try {
      await ref.read(apiProvider).setWhatsAppMode(mode, checklist: checklist);
      ref.invalidate(whatsAppAccountProvider);
      ref.invalidate(companyProvider);
      if (context.mounted) _toast(context, l.saved);
    } catch (e) {
      if (context.mounted) _toast(context, errorText(context, e));
    }
  }

  Future<void> _edit(BuildContext context, WidgetRef ref, WhatsAppAccount a) async {
    final l = context.l10n;
    final id = TextEditingController(text: a.phoneNumberId);
    final token = TextEditingController();
    final number = TextEditingController(text: a.displayNumber);
    final waba = TextEditingController(text: a.wabaId);
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(l.whatsappTitle),
        content: SizedBox(
          width: 460,
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            TextField(controller: number, decoration: corocInput(context, label: l.whatsappDisplay)),
            const SizedBox(height: CorocSpace.md),
            TextField(controller: id, keyboardType: TextInputType.number, decoration: corocInput(context, label: l.whatsappPhoneId)),
            const SizedBox(height: CorocSpace.md),
            TextField(controller: waba, keyboardType: TextInputType.number, decoration: corocInput(context, label: l.whatsappWabaId, helper: l.whatsappWabaIdHelp)),
            const SizedBox(height: CorocSpace.md),
            TextField(controller: token, obscureText: true, decoration: corocInput(context, label: l.whatsappToken, helper: l.whatsappTokenHelp)),
          ]),
        ),
        actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: Text(l.actionCancel)), FilledButton(onPressed: () => Navigator.pop(c, id.text.trim().isNotEmpty && token.text.trim().length >= 20), child: Text(l.actionSave))],
      ),
    );
    if (ok == true) {
      try {
        await ref.read(apiProvider).saveWhatsAppAccount(
          phoneNumberId: id.text.trim(),
          accessToken: token.text.trim(),
          displayNumber: number.text.trim().isEmpty ? null : number.text.trim(),
          wabaId: waba.text.trim().isEmpty ? null : waba.text.trim(),
        );
        ref.invalidate(whatsAppAccountProvider);
      } catch (e) {
        if (context.mounted) _toast(context, errorText(context, e));
      }
    }
    disposeAfterDialog([id, token, number, waba]);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    return SectionCard(
      title: l.whatsappTitle,
      child: AsyncBody<WhatsAppAccount>(
        value: ref.watch(whatsAppAccountProvider),
        onRetry: () => ref.invalidate(whatsAppAccountProvider),
        builder: (a) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(l.whatsappHelp, style: t.bodySmall),
          const SizedBox(height: 8),
          if (a.suspended)
            StatusDot(label: l.whatsappSuspended, tone: StatusTone.error)
          else if (a.configured)
            StatusDot(label: l.whatsappConnected(a.displayNumber ?? a.phoneNumberId ?? ''), tone: StatusTone.ok)
          else
            StatusDot(label: l.whatsappNotConnected, tone: StatusTone.neutral),
          if (a.suspended) ...[const SizedBox(height: 8), Text(l.whatsappSuspendedBanner, style: t.bodySmall?.copyWith(color: Theme.of(context).colorScheme.error))],
          if (!a.serverReady) ...[const SizedBox(height: 8), Text(l.whatsappServerMissing, style: t.bodySmall?.copyWith(color: Theme.of(context).colorScheme.error))],
          const SizedBox(height: 8),
          KeyValue(l.whatsappWebhook, a.webhookUrl),
          const SizedBox(height: CorocSpace.md),
          Text(l.whatsappModeTitle, style: t.labelLarge),
          const SizedBox(height: 6),
          SegmentedButton<String>(
            showSelectedIcon: false,
            segments: [
              ButtonSegment(value: 'assisted', label: Text(l.whatsappModeAssisted), icon: const Icon(Icons.touch_app_outlined)),
              ButtonSegment(value: 'cloud_api', label: Text(l.whatsappModeCloud), icon: const Icon(Icons.cloud_outlined), enabled: a.configured && a.wabaId != null && a.serverReady && isOwner),
            ],
            selected: {a.mode},
            onSelectionChanged: canEdit ? (v) => _mode(context, ref, a, v.first) : null,
          ),
          const SizedBox(height: 6),
          Text(a.cloud ? l.whatsappModeCloudHelp : l.whatsappModeAssistedHelp, style: t.bodySmall),
          if (!isOwner) Text(l.whatsappModeOwnerOnly, style: t.bodySmall),
          const SizedBox(height: CorocSpace.md),
          if (canEdit)
            Wrap(spacing: 8, children: [
              OutlinedButton(onPressed: () => _edit(context, ref, a), child: Text(a.configured ? l.actionEdit : l.whatsappConnect)),
              if (a.configured)
                TextButton(
                  onPressed: () async {
                    try {
                      await ref.read(apiProvider).removeWhatsAppAccount();
                      ref.invalidate(whatsAppAccountProvider);
                    } catch (e) {
                      if (context.mounted) _toast(context, errorText(context, e));
                    }
                  },
                  child: Text(l.whatsappDisconnect),
                ),
            ]),
        ]),
      ),
    );
  }
}

/// Lista de verificación del modo automático (§11.1): la Política de Mensajería de WhatsApp Business prohíbe la cobranza
/// de deudas y los préstamos entre pares; el Propietario la acepta expresamente.
class _ChecklistDialog extends StatefulWidget {
  const _ChecklistDialog({required this.initial});
  final WhatsAppChecklist initial;
  @override
  State<_ChecklistDialog> createState() => _ChecklistDialogState();
}

class _ChecklistDialogState extends State<_ChecklistDialog> {
  late var _c = widget.initial;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final done = _c.businessVerified && _c.dedicatedNumber && _c.templatesApproved && _c.legalReview && _c.policyAccepted;
    Widget item(String title, bool value, WhatsAppChecklist Function(bool) set) =>
        CheckboxListTile(contentPadding: EdgeInsets.zero, controlAffinity: ListTileControlAffinity.leading, title: Text(title), value: value, onChanged: (v) => setState(() => _c = set(v ?? false)));
    return AlertDialog(
      title: Text(l.whatsappChecklistTitle),
      content: SizedBox(
        width: 520,
        child: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(l.whatsappPolicyWarning, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: Theme.of(context).colorScheme.error)),
            const SizedBox(height: CorocSpace.md),
            item(l.whatsappCheckBusiness, _c.businessVerified, (v) => _c.copyWith(businessVerified: v)),
            item(l.whatsappCheckNumber, _c.dedicatedNumber, (v) => _c.copyWith(dedicatedNumber: v)),
            item(l.whatsappCheckTemplates, _c.templatesApproved, (v) => _c.copyWith(templatesApproved: v)),
            item(l.whatsappCheckLegal, _c.legalReview, (v) => _c.copyWith(legalReview: v)),
            item(l.whatsappCheckPolicy, _c.policyAccepted, (v) => _c.copyWith(policyAccepted: v)),
          ]),
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text(l.actionCancel)),
        FilledButton(onPressed: done ? () => Navigator.pop(context, _c) : null, child: Text(l.whatsappActivateCloud)),
      ],
    );
  }
}
