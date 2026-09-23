import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/common.dart';
import '../messaging/messaging_common.dart' show weekdayName;

final contactRulesProvider = FutureProvider.autoDispose<ContactRules>((ref) => ref.watch(apiProvider).contactRules());
final emailSenderProvider = FutureProvider.autoDispose<EmailSender>((ref) => ref.watch(apiProvider).emailSender());

void _toast(BuildContext context, String text) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));

String presetName(AppLocalizations l, String id) => switch (id) {
      'CO_LEY_2300_2023' => l.presetColombia,
      'BR_CDC_TEMPLATE' => l.presetBrazil,
      'US_FDCPA_REG_F_TEMPLATE' => l.presetUsa,
      _ => id,
    };

/// Franjas agrupadas por horario: «Lun, Mar, Mié, Jue, Vie 07:00–19:00 · Sáb 08:00–15:00».
String windowsText(AppLocalizations l, List<ContactWindow> ws) {
  final groups = <String, List<int>>{};
  for (final w in ws) {
    (groups['${w.start}–${w.end}'] ??= []).add(w.day);
  }
  return groups.entries.map((e) => '${(e.value..sort()).map((d) => weekdayName(l, d)).join(', ')} ${e.key}').join(' · ');
}

/// Motor de reglas de contacto (§11.4): preset por país, revisión legal, envío inmediato de transaccionales y hora de
/// los recordatorios.
class ComplianceSection extends ConsumerStatefulWidget {
  const ComplianceSection({super.key, required this.canEdit, required this.isOwner});
  final bool canEdit;
  final bool isOwner;
  @override
  ConsumerState<ComplianceSection> createState() => _ComplianceSectionState();
}

class _ComplianceSectionState extends ConsumerState<ComplianceSection> {
  bool _busy = false;

  Future<void> _save({String? preset, bool? counselReviewed, bool? transactionalImmediate, String? reminderTime, bool? dailyReminders}) async {
    setState(() => _busy = true);
    try {
      await ref.read(apiProvider).saveContactRules(preset: preset, counselReviewed: counselReviewed, transactionalImmediate: transactionalImmediate, reminderTime: reminderTime, dailyReminders: dailyReminders);
      ref.invalidate(contactRulesProvider);
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
      title: l.complianceTitle,
      child: AsyncBody<ContactRules>(
        value: ref.watch(contactRulesProvider),
        onRetry: () => ref.invalidate(contactRulesProvider),
        builder: (r) {
          final enabled = widget.canEdit && !_busy;
          final chosen = r.presets.where((p) => p.id == r.preset).firstOrNull;
          final pendingReview = chosen != null && chosen.requiresCounselReview && r.counselReviewedAt == null;
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(l.complianceHelp, style: t.bodySmall),
            const SizedBox(height: CorocSpace.md),
            DropdownMenu<String>(
              enabled: enabled,
              initialSelection: r.preset,
              label: Text(l.compliancePreset),
              onSelected: (v) => v == null || v == r.preset ? null : _save(preset: v),
              dropdownMenuEntries: [for (final p in r.presets) DropdownMenuEntry(value: p.id, label: presetName(l, p.id))],
            ),
            const SizedBox(height: 8),
            KeyValue(l.complianceApplied, presetName(l, r.effective.id)),
            KeyValue(l.complianceWindows, windowsText(l, r.effective.windows)),
            KeyValue(l.complianceLimits, [
              if (r.effective.noHolidays) l.complianceNoHolidays,
              l.complianceMaxPerDay(r.effective.maxCollectionPerDay),
              if (r.effective.singleChannelPerWeek) l.complianceSingleChannel,
            ].join(' · ')),
            KeyValue(l.complianceLegal, r.effective.legalReference),
            if (pendingReview) ...[
              const SizedBox(height: 8),
              Text(l.compliancePendingReview, style: t.bodySmall?.copyWith(color: Theme.of(context).colorScheme.error)),
            ],
            if (chosen?.requiresCounselReview ?? false)
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(l.complianceCounselReviewed),
                subtitle: Text(r.counselReviewedAt == null ? l.complianceCounselHelp : Dates.medium(r.counselReviewedAt!, context.lang)),
                value: r.counselReviewedAt != null,
                onChanged: enabled && widget.isOwner ? (v) => _save(counselReviewed: v) : null,
              ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(l.complianceTransactionalImmediate),
              subtitle: Text(l.complianceTransactionalImmediateHelp),
              value: r.transactionalImmediate,
              onChanged: enabled ? (v) => _save(transactionalImmediate: v) : null,
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(l.complianceDailyReminders),
              subtitle: Text(l.complianceDailyRemindersHelp),
              value: r.dailyReminders,
              onChanged: enabled ? (v) => _save(dailyReminders: v) : null,
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(l.complianceReminderTime),
              subtitle: Text(l.complianceReminderTimeHelp),
              trailing: OutlinedButton(
                onPressed: enabled
                    ? () async {
                        final parts = r.reminderTime.split(':');
                        final picked = await showTimePicker(context: context, initialTime: TimeOfDay(hour: int.parse(parts[0]), minute: int.parse(parts[1])));
                        if (picked != null) _save(reminderTime: '${picked.hour.toString().padLeft(2, '0')}:${picked.minute.toString().padLeft(2, '0')}');
                      }
                    : null,
                child: Text(r.reminderTime),
              ),
            ),
          ]);
        },
      ),
    );
  }
}

/// Correo saliente (§11.2): remitente con el dominio de la empresa y asistente de SPF, DKIM y DMARC.
class EmailSenderSection extends ConsumerStatefulWidget {
  const EmailSenderSection({super.key, required this.canEdit});
  final bool canEdit;
  @override
  ConsumerState<EmailSenderSection> createState() => _EmailSenderSectionState();
}

class _EmailSenderSectionState extends ConsumerState<EmailSenderSection> {
  bool _busy = false;
  EmailSender? _checked;

  Future<void> _edit(EmailSender s) async {
    final l = context.l10n;
    final email = TextEditingController(text: s.fromEmail);
    final name = TextEditingController(text: s.fromName);
    final selector = TextEditingController(text: s.dkimSelector);
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(l.emailSenderTitle),
        content: SizedBox(
          width: 460,
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            TextField(controller: email, keyboardType: TextInputType.emailAddress, autofocus: true, decoration: corocInput(context, label: l.emailSenderFrom)),
            const SizedBox(height: CorocSpace.md),
            TextField(controller: name, decoration: corocInput(context, label: l.emailSenderName)),
            const SizedBox(height: CorocSpace.md),
            TextField(controller: selector, decoration: corocInput(context, label: l.emailSenderSelector, helper: l.emailSenderSelectorHelp)),
          ]),
        ),
        actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: Text(l.actionCancel)), FilledButton(onPressed: () => Navigator.pop(c, email.text.contains('@')), child: Text(l.actionSave))],
      ),
    );
    if (ok == true) {
      await _run(() => ref.read(apiProvider).saveEmailSender(fromEmail: email.text.trim(), fromName: name.text.trim().isEmpty ? null : name.text.trim(), dkimSelector: selector.text.trim().isEmpty ? null : selector.text.trim()));
    }
    for (final c in [email, name, selector]) {
      c.dispose();
    }
  }

  Future<void> _run(Future<Object?> Function() action, {bool keep = false}) async {
    setState(() => _busy = true);
    try {
      final r = await action();
      if (keep && r is EmailSender) _checked = r;
      ref.invalidate(emailSenderProvider);
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
      title: l.emailSenderTitle,
      child: AsyncBody<EmailSender>(
        value: ref.watch(emailSenderProvider),
        onRetry: () => ref.invalidate(emailSenderProvider),
        builder: (s) {
          final records = (_checked?.fromEmail == s.fromEmail ? _checked?.records : null) ?? s.records;
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(l.emailSenderHelp, style: t.bodySmall),
            const SizedBox(height: 8),
            if (s.provider == 'none')
              Text(l.emailProviderMissing, style: t.bodySmall?.copyWith(color: Theme.of(context).colorScheme.error))
            else
              KeyValue(l.emailProvider, s.provider == 'postmark' ? 'Postmark' : s.provider == 'smtp' ? 'SMTP' : l.emailProviderLocal),
            KeyValue(l.emailSenderCurrent, s.verified ? '${s.fromName ?? ''} <${s.fromEmail}>'.trim() : s.defaultFrom),
            if (s.configured) ...[
              const SizedBox(height: 8),
              if (s.verified) StatusDot(label: l.emailSenderVerified, tone: StatusTone.ok) else StatusDot(label: l.emailSenderPending(s.fromEmail ?? ''), tone: StatusTone.warn),
              const SizedBox(height: 8),
              Wrap(spacing: 12, children: [
                StatusDot(label: 'SPF', tone: s.spf ? StatusTone.ok : StatusTone.error),
                StatusDot(label: 'DKIM', tone: s.dkim ? StatusTone.ok : StatusTone.error),
                StatusDot(label: 'DMARC', tone: s.dmarc ? StatusTone.ok : StatusTone.error),
              ]),
              for (final r in records.where((r) => !r.ok))
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${r.kind.toUpperCase()} · ${r.type} · ${r.host}', style: t.labelMedium),
                    SelectableText(r.expected, style: t.bodySmall?.copyWith(fontFamily: 'monospace')),
                  ]),
                ),
            ],
            if (widget.canEdit) ...[
              const SizedBox(height: CorocSpace.md),
              Wrap(spacing: 8, runSpacing: 8, children: [
                OutlinedButton(onPressed: _busy ? null : () => _edit(s), child: Text(s.configured ? l.actionEdit : l.emailSenderConfigure)),
                if (s.configured) FilledButton.icon(onPressed: _busy ? null : () => _run(() => ref.read(apiProvider).verifyEmailSender(), keep: true), icon: const Icon(Icons.dns_outlined, size: 18), label: Text(l.emailSenderVerify)),
                if (s.configured) TextButton(onPressed: _busy ? null : () => _run(() => ref.read(apiProvider).deleteEmailSender()), child: Text(l.emailSenderUseDefault)),
              ]),
            ],
          ]);
        },
      ),
    );
  }
}
