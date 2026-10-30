import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/config.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/brand.dart';
import '../../design/widgets/common.dart';
import '../../features/auth/login_page.dart' show LanguageSelector;
import '../../features/loans/loan_providers.dart' show companyProvider, rateCapsProvider;
import '../../features/settings/desktop_sections.dart' show AutoBackupSection, DesktopPcSection, GmailSection;
import '../../features/settings/settings_page.dart' show ChangePasswordDialog, RateCapDialog, RateCapPolicySwitch;
import '../ui/bank.dart';

/// Configuración del nuevo COROC, en tarjetas cortas: su negocio, el correo de Gmail, la copia diaria, las tasas, la
/// seguridad, este PC y cómo se ve COROC. Nada técnico.
class PersonalSettingsPage extends ConsumerWidget {
  const PersonalSettingsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final auth = ref.watch(authProvider);
    final user = auth is SignedIn ? auth.user : null;
    final isOwner = user?.role == 'owner';
    return BankPage(
      maxWidth: 900,
      title: l.navSettings,
      subtitle: l.pSettingsSubtitle,
      children: [
        const _Business(),
        const SizedBox(height: 20),
        GmailSection(canEdit: isOwner || user?.role == 'admin'),
        const SizedBox(height: 20),
        const AutoBackupSection(),
        const SizedBox(height: 20),
        _Rates(isOwner: isOwner),
        const SizedBox(height: 20),
        BankCard(
          title: l.pSecurityTitle,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.password),
                title: Text(l.passwordChangeTitle),
                subtitle: Text(user == null ? '' : l.pYourUser(user.username)),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => showDialog<void>(context: context, builder: (_) => const ChangePasswordDialog()),
              ),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.lock_clock_outlined),
                title: Text(l.pLockNow),
                subtitle: Text(l.pLockNowHelp),
                onTap: () => ref.read(authProvider.notifier).lock(),
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),
        const DesktopPcSection(),
        const SizedBox(height: 20),
        const _Looks(),
        const SizedBox(height: 20),
        Center(child: Text(l.pVersion(AppConfig.appVersion), style: Theme.of(context).textTheme.bodySmall)),
      ],
    );
  }
}

/// El nombre del negocio, que va en los recibos, los contratos y los correos.
class _Business extends ConsumerWidget {
  const _Business();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final company = ref.watch(companyProvider);
    return BankCard(
      title: l.pBusinessTitle,
      child: AsyncBody<Company>(
        value: company,
        onRetry: () => ref.invalidate(companyProvider),
        builder: (c) => ListTile(
          contentPadding: EdgeInsets.zero,
          leading: Monogram(c.name, size: 44),
          title: Text(c.name),
          subtitle: Text([l.pBusinessHelp, c.currency].join(' · ')),
          trailing: OutlinedButton(onPressed: () => _rename(context, ref, c), child: Text(l.pChange)),
        ),
      ),
    );
  }

  Future<void> _rename(BuildContext context, WidgetRef ref, Company c) async {
    final l = context.l10n;
    final name = TextEditingController(text: c.name);
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(l.pBusinessTitle),
        content: SizedBox(
          width: 440,
          child: TextField(
            controller: name,
            autofocus: true,
            decoration: corocInput(ctx, label: l.welcomeCompanyName),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(l.actionCancel)),
          GoldButton(label: l.actionSave, onPressed: () => Navigator.pop(ctx, true)),
        ],
      ),
    );
    final value = name.text.trim();
    disposeAfterDialog([name]);
    if (ok != true || value.isEmpty || value == c.name) return;
    try {
      await ref.read(apiProvider).updateCompany({'name': value}, c.version);
      ref.invalidate(companyProvider);
    } catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(context, e))));
    }
  }
}

/// El tope legal de la tasa (opcional) y si se permiten préstamos por encima confirmando cada uno (ADR-061).
class _Rates extends ConsumerWidget {
  const _Rates({required this.isOwner});
  final bool isOwner;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    final caps = ref.watch(rateCapsProvider);
    final country = ref.watch(sessionProvider)?.company.country ?? 'CO';
    final today = DateTime.now().toIso8601String().substring(0, 10);
    return BankCard(
      title: l.welcomeRatesTitle,
      trailing: OutlinedButton.icon(
        onPressed: () async {
          final saved = await showDialog<bool>(
            context: context,
            builder: (_) => RateCapDialog(country: country),
          );
          if (saved == true) ref.invalidate(rateCapsProvider);
        },
        icon: const Icon(Icons.add),
        label: Text(l.rateCapAdd),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(country == 'CO' ? l.welcomeRatesSubtitleCO : l.welcomeRatesSubtitle, style: t.bodyMedium?.copyWith(color: Bank.muted)),
          const SizedBox(height: 12),
          AsyncBody<List<RateCap>>(
            value: caps,
            onRetry: () => ref.invalidate(rateCapsProvider),
            builder: (list) {
              final current = list.where((c) => c.country == country && c.validFrom.compareTo(today) <= 0 && c.validTo.compareTo(today) >= 0).toList();
              return ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.gavel_outlined),
                title: Text(current.isEmpty ? l.welcomeRatesNone : l.welcomeRatesCurrent(percent(current.first.effectiveAnnual, context.lang))),
                subtitle: current.isEmpty ? null : Text(current.first.source),
              );
            },
          ),
          const Divider(height: 24),
          RateCapPolicySwitch(isOwner: isOwner),
        ],
      ),
    );
  }
}

/// Cómo se ve COROC: el tamaño de la letra y el idioma, solo en este PC.
class _Looks extends ConsumerWidget {
  const _Looks();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    final scale = ref.watch(textScaleProvider);
    return BankCard(
      title: l.pLooksTitle,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(l.settingsTextSize, style: t.titleSmall),
          const SizedBox(height: 8),
          SegmentedButton<double>(
            showSelectedIcon: false,
            segments: [
              ButtonSegment(value: 1.0, label: Text(l.textSizeNormal)),
              ButtonSegment(value: 1.15, label: Text(l.textSizeLarge)),
              ButtonSegment(value: 1.3, label: Text(l.textSizeLarger)),
            ],
            selected: {scale},
            onSelectionChanged: (v) => ref.read(textScaleProvider.notifier).set(v.first),
          ),
          const SizedBox(height: CorocSpace.lg),
          Text(l.pLanguage, style: t.titleSmall),
          const SizedBox(height: 8),
          const LanguageSelector(),
        ],
      ),
    );
  }
}
