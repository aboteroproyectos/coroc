import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/auth/auth_controller.dart';
import '../core/l10n.dart';
import '../design/tokens.dart';
import '../design/widgets/brand.dart';
import '../features/desktop/receipt_catcher.dart';
import '../features/inbox/inbox_page.dart' show intakeSummaryProvider;
import '../features/settings/desktop_sections.dart' show BackupReminder;
import 'data.dart';
import 'tour.dart';
import 'ui/bank.dart';

/// Una sección del menú lateral.
typedef NavEntry = ({String route, IconData icon, IconData selected, String label, int badge});

/// Marco del nuevo COROC: el menú lateral en azul noche con las cinco secciones y, a la derecha, la página. En toda la
/// ventana se puede soltar o pegar un comprobante; arriba aparece el aviso si pasan 7 días sin copia.
class PersonalShell extends ConsumerWidget {
  const PersonalShell({super.key, required this.location, required this.child});
  final String location;
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final pending = ref.watch(intakeSummaryProvider).valueOrNull?.pending ?? 0;
    final items = <NavEntry>[
      (route: '/inicio', icon: Icons.space_dashboard_outlined, selected: Icons.space_dashboard, label: l.navDashboard, badge: 0),
      (route: '/clientes', icon: Icons.people_alt_outlined, selected: Icons.people_alt, label: l.navClients, badge: 0),
      (route: '/prestamo', icon: Icons.add_card_outlined, selected: Icons.add_card, label: l.pNavNewLoan, badge: 0),
      (route: '/comprobantes', icon: Icons.receipt_long_outlined, selected: Icons.receipt_long, label: l.pNavReceipts, badge: pending),
      (route: '/configuracion', icon: Icons.tune_outlined, selected: Icons.tune, label: l.navSettings, badge: 0),
    ];
    return Scaffold(
      body: PersonalRealtime(
        child: ReceiptCatcher(
          revealRoute: (id) => '/comprobantes?id=$id',
          onUploaded: () => ref.invalidate(pendingReceiptsProvider),
          child: PersonalTour(
            child: LayoutBuilder(
              builder: (context, c) => Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Sidebar(items: items, location: location, expanded: c.maxWidth >= 1180),
                  Expanded(
                    child: Column(
                      children: [
                        const BackupReminder(settingsRoute: '/configuracion'),
                        Expanded(child: child),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Menú lateral: logo, secciones y, abajo, la Ayuda y quien usa COROC con su botón para bloquear.
class Sidebar extends ConsumerWidget {
  const Sidebar({super.key, required this.items, required this.location, required this.expanded});
  final List<NavEntry> items;
  final String location;
  final bool expanded;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final auth = ref.watch(authProvider);
    final user = auth is SignedIn ? auth.user : null;
    final company = auth is SignedIn ? auth.session.company.name : '';
    final lock = IconButton(
      tooltip: l.pLockNow,
      onPressed: () => ref.read(authProvider.notifier).lock(),
      icon: const Icon(Icons.lock_outline, color: CorocColors.gold300),
    );
    return Container(
      width: expanded ? 256 : 88,
      decoration: const BoxDecoration(gradient: Bank.sidebar),
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: EdgeInsets.fromLTRB(expanded ? 24 : 16, 28, expanded ? 24 : 16, 32),
              child: Theme(
                data: ThemeData(brightness: Brightness.dark),
                child: Align(
                  alignment: expanded ? Alignment.centerLeft : Alignment.center,
                  child: expanded ? const CorocLogo(layout: LogoLayout.horizontal, height: 40) : const CorocLogo(layout: LogoLayout.isotype, height: 34),
                ),
              ),
            ),
            for (final item in items) _NavButton(item: item, selected: location == item.route || location.startsWith('${item.route}/'), expanded: expanded),
            const Spacer(),
            _NavButton(item: (route: '/ayuda', icon: Icons.help_outline, selected: Icons.help, label: l.navHelp, badge: 0), selected: location == '/ayuda', expanded: expanded),
            if (user != null)
              Padding(
                padding: EdgeInsets.fromLTRB(expanded ? 16 : 12, 12, expanded ? 16 : 12, 20),
                child: Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.06), borderRadius: BorderRadius.circular(16)),
                  child: Row(
                    children: [
                      if (expanded) ...[
                        Monogram(user.name, size: 38, dark: true),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                user.name,
                                style: Theme.of(context).textTheme.titleSmall?.copyWith(color: CorocColors.ivory),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                              Text(
                                company,
                                style: Theme.of(context).textTheme.bodySmall?.copyWith(color: CorocColors.inkMutedDark),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ],
                          ),
                        ),
                      ],
                      if (expanded) lock else Expanded(child: lock),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _NavButton extends StatelessWidget {
  const _NavButton({required this.item, required this.selected, required this.expanded});
  final NavEntry item;
  final bool selected;
  final bool expanded;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final color = selected ? CorocColors.ivory : CorocColors.ivory.withValues(alpha: 0.72);
    final icon = Badge(
      isLabelVisible: item.badge > 0,
      backgroundColor: CorocColors.gold500,
      textColor: CorocColors.navy900,
      label: Text('${item.badge}'),
      child: Icon(selected ? item.selected : item.icon, color: selected ? CorocColors.gold300 : color, size: 22),
    );
    final button = Padding(
      padding: EdgeInsets.symmetric(horizontal: expanded ? 14 : 12, vertical: 3),
      child: Material(
        color: selected ? Colors.white.withValues(alpha: 0.09) : Colors.transparent,
        borderRadius: BorderRadius.circular(14),
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: () => GoRouter.of(context).go(item.route),
          child: Container(
            height: 52,
            padding: EdgeInsets.symmetric(horizontal: expanded ? 14 : 0),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(14),
              border: Border(left: BorderSide(color: selected ? CorocColors.gold500 : Colors.transparent, width: 3)),
            ),
            child: Row(
              mainAxisAlignment: expanded ? MainAxisAlignment.start : MainAxisAlignment.center,
              children: [
                icon,
                if (expanded) ...[
                  const SizedBox(width: 14),
                  Expanded(
                    child: Text(
                      item.label,
                      style: t.titleSmall?.copyWith(color: color, fontWeight: selected ? FontWeight.w600 : FontWeight.w500),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
    return Semantics(
      selected: selected,
      button: true,
      label: item.label,
      child: expanded ? button : Tooltip(message: item.label, child: button),
    );
  }
}
