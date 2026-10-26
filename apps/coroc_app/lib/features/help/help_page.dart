import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/config.dart';
import '../../core/desktop/desktop_runtime.dart';
import '../../core/l10n.dart';
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/common.dart';
import '../shell/app_shell.dart';

typedef _Topic = ({IconData icon, String title, String body});

/// Ayuda integrada (§20): guías breves de lo que ya hace la app en esta fase, con búsqueda.
/// El contenido vive en los ARB, así que siempre está en el idioma de la interfaz.
class HelpPage extends ConsumerStatefulWidget {
  const HelpPage({super.key});
  @override
  ConsumerState<HelpPage> createState() => _HelpPageState();
}

class _HelpPageState extends ConsumerState<HelpPage> {
  final _search = TextEditingController();
  String _q = '';

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  static String _fold(String s) => s
      .toLowerCase()
      .replaceAll(RegExp('[áàâã]'), 'a')
      .replaceAll(RegExp('[éê]'), 'e')
      .replaceAll('í', 'i')
      .replaceAll(RegExp('[óôõ]'), 'o')
      .replaceAll('ú', 'u')
      .replaceAll('ç', 'c')
      .replaceAll('ñ', 'n');

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final List<_Topic> topics = [
      // COROC Escritorio para Windows (Fase 10): primero lo propio de este PC.
      if (ref.watch(desktopModeProvider)) ...[
        (icon: Icons.computer_outlined, title: l.helpDesktopTitle, body: l.helpDesktopBody),
        (icon: Icons.outbox_outlined, title: l.helpTodayMessagesTitle, body: l.helpTodayMessagesBody),
        (icon: Icons.file_download_outlined, title: l.helpReceiptsDesktopTitle, body: l.helpReceiptsDesktopBody),
        (icon: Icons.alternate_email, title: l.helpGmailTitle, body: l.helpGmailBody),
        (icon: Icons.backup_outlined, title: l.helpDesktopBackupTitle, body: l.helpDesktopBackupBody),
        (icon: Icons.shield_outlined, title: l.helpSmartScreenTitle, body: l.helpSmartScreenBody),
      ],
      (icon: Icons.login, title: l.helpLoginTitle, body: l.helpLoginBody),
      (icon: Icons.person_add_alt_1_outlined, title: l.helpNewClientTitle, body: l.helpNewClientBody),
      (icon: Icons.calculate_outlined, title: l.helpMethodsTitle, body: l.helpMethodsBody),
      (icon: Icons.gavel_outlined, title: l.helpRateCapTitle, body: l.helpRateCapBody),
      (icon: Icons.table_rows_outlined, title: l.helpScheduleTitle, body: l.helpScheduleBody),
      (icon: Icons.payments_outlined, title: l.helpPaymentsTitle, body: l.helpPaymentsBody),
      (icon: Icons.undo, title: l.helpReversalTitle, body: l.helpReversalBody),
      (icon: Icons.space_dashboard_outlined, title: l.helpDashboardTitle, body: l.helpDashboardBody),
      (icon: Icons.badge_outlined, title: l.helpRolesTitle, body: l.helpRolesBody),
      (icon: Icons.shield_outlined, title: l.helpSecurityTitle, body: l.helpSecurityBody),
      (icon: Icons.translate, title: l.helpLanguageTitle, body: l.helpLanguageBody),
      (icon: Icons.keyboard_outlined, title: l.helpShortcutsTitle, body: l.helpShortcutsBody),
      (icon: Icons.picture_as_pdf_outlined, title: l.helpDocumentsTitle, body: l.helpDocumentsBody),
      (icon: Icons.folder_outlined, title: l.helpFolderTitle, body: l.helpFolderBody),
      (icon: Icons.insert_chart_outlined, title: l.helpReportsTitle, body: l.helpReportsBody),
      (icon: Icons.backup_outlined, title: l.helpBackupTitle, body: l.helpBackupBody),
      (icon: Icons.inbox_outlined, title: l.helpInboxTitle, body: l.helpInboxBody),
      (icon: Icons.link, title: l.helpUploadLinkTitle, body: l.helpUploadLinkBody),
      (icon: Icons.ios_share, title: l.helpShareTitle, body: l.helpShareBody),
      (icon: Icons.account_balance_outlined, title: l.helpReceivingTitle, body: l.helpReceivingBody),
      (icon: Icons.forum_outlined, title: l.helpMessagingTitle, body: l.helpMessagingBody),
      (icon: Icons.schedule, title: l.helpContactRulesTitle, body: l.helpContactRulesBody),
      (icon: Icons.chat_outlined, title: l.helpWhatsappModesTitle, body: l.helpWhatsappModesBody),
      (icon: Icons.unsubscribe_outlined, title: l.helpOptOutTitle, body: l.helpOptOutBody),
      (icon: Icons.cloud_off_outlined, title: l.helpOfflineTitle, body: l.helpOfflineBody),
      (icon: Icons.support_agent, title: l.helpSupportTitle, body: l.helpSupportBody),
      (icon: Icons.delete_forever_outlined, title: l.helpDeleteAccountTitle, body: l.helpDeleteAccountBody),
    ];
    final q = _fold(_q.trim());
    final shown = q.isEmpty ? topics : topics.where((t) => _fold('${t.title} ${t.body}').contains(q)).toList();

    return PageScaffold(
      maxWidth: 880,
      children: [
        PageHeader(title: l.navHelp, subtitle: l.helpSubtitle),
        TextField(
          controller: _search,
          decoration: corocInput(context, label: l.helpSearch, prefix: const Icon(Icons.search)),
          onChanged: (v) => setState(() => _q = v),
        ),
        const SizedBox(height: CorocSpace.lg),
        if (shown.isEmpty)
          EmptyState(icon: Icons.search_off, title: l.helpNoResults)
        else
          Card(
            clipBehavior: Clip.antiAlias,
            child: Column(
              children: [
                for (final (i, t) in shown.indexed) ...[
                  if (i > 0) const Divider(height: 1),
                  ExpansionTile(
                    key: PageStorageKey(t.title),
                    leading: Icon(t.icon, color: Theme.of(context).colorScheme.tertiary),
                    title: Text(t.title, style: Theme.of(context).textTheme.titleSmall),
                    initiallyExpanded: q.isNotEmpty && shown.length <= 2,
                    childrenPadding: const EdgeInsets.fromLTRB(CorocSpace.lg, 0, CorocSpace.lg, CorocSpace.lg),
                    expandedCrossAxisAlignment: CrossAxisAlignment.start,
                    children: [SelectableText(t.body, style: Theme.of(context).textTheme.bodyMedium?.copyWith(height: 1.55))],
                  ),
                ],
              ],
            ),
          ),
        const SizedBox(height: CorocSpace.lg),
        Text(l.helpFooter(AppConfig.appVersion), style: Theme.of(context).textTheme.bodySmall, textAlign: TextAlign.center),
      ],
    );
  }
}
