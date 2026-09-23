import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/l10n.dart';
import '../../design/tokens.dart';
import '../../design/widgets/brand.dart';
import '../../design/widgets/common.dart';
import '../settings/data_sections.dart' show FolderAutoSync, showCreateBackupDialog;

class _Dest {
  const _Dest(this.path, this.icon, this.selectedIcon, this.label, [this.permission]);
  final String path;
  final IconData icon;
  final IconData selectedIcon;
  final String Function(AppLocalizations) label;
  final String? permission;
}

final _destinations = <_Dest>[
  _Dest('/dashboard', Icons.space_dashboard_outlined, Icons.space_dashboard, (l) => l.navDashboard),
  _Dest('/today', Icons.event_available_outlined, Icons.event_available, (l) => l.navToday),
  _Dest('/clients', Icons.people_alt_outlined, Icons.people_alt, (l) => l.navClients),
  _Dest('/reports', Icons.insert_chart_outlined, Icons.insert_chart, (l) => l.navReports, 'reports.view'),
  _Dest('/settings', Icons.tune_outlined, Icons.tune, (l) => l.navSettings),
  _Dest('/help', Icons.help_outline, Icons.help, (l) => l.navHelp),
];

class NewClientIntent extends Intent {
  const NewClientIntent();
}

class SearchIntent extends Intent {
  const SearchIntent();
}

/// Estructura adaptable (§5.6): barra lateral fija en escritorio, riel en tableta y barra inferior de 5 destinos en móvil.
/// Atajos de escritorio: Ctrl/Cmd + K para buscar y N para nuevo cliente.
class AppShell extends ConsumerWidget {
  const AppShell({super.key, required this.location, required this.child});
  final String location;
  final Widget child;

  /// Destinos que el rol puede ver. En teléfonos la barra inferior tiene 5 (§5.6): si aparecen Informes, la Ayuda
  /// pasa a Configuración.
  static List<_Dest> _visible(bool Function(String) can, {bool compact = false}) {
    final list = _destinations.where((d) => d.permission == null || can(d.permission!)).toList();
    if (compact && list.length > 5) list.removeWhere((d) => d.path == '/help');
    return list;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final auth = ref.watch(authProvider);
    final session = auth is SignedIn ? auth.session : null;
    final canCreate = session?.user.can('clients.create') ?? false;
    final width = MediaQuery.sizeOf(context).width;
    bool can(String p) => session?.user.can(p) ?? false;
    final dests = _visible(can, compact: width < CorocBreakpoints.tablet);
    final found = dests.indexWhere((d) => location.startsWith(d.path));
    final index = found < 0 ? 0 : found;
    void go(int i) => context.go(dests[i].path);

    final shortcuts = <ShortcutActivator, Intent>{
      const SingleActivator(LogicalKeyboardKey.keyK, control: true): const SearchIntent(),
      const SingleActivator(LogicalKeyboardKey.keyK, meta: true): const SearchIntent(),
      if (canCreate) ...{
        const SingleActivator(LogicalKeyboardKey.keyN, control: true): const NewClientIntent(),
        const SingleActivator(LogicalKeyboardKey.keyN, meta: true): const NewClientIntent(),
      },
    };
    final actions = <Type, Action<Intent>>{
      SearchIntent: CallbackAction<SearchIntent>(onInvoke: (_) {
        context.go('/clients?focus=1');
        return null;
      }),
      NewClientIntent: CallbackAction<NewClientIntent>(onInvoke: (_) {
        context.go('/clients/new');
        return null;
      }),
    };

    final body = FolderAutoSync(child: Shortcuts(shortcuts: shortcuts, child: Actions(actions: actions, child: Focus(autofocus: true, child: child))));

    if (width >= CorocBreakpoints.desktop) {
      return Scaffold(
        body: Row(children: [
          _Sidebar(dests: dests, index: index, onSelect: go),
          Expanded(child: body),
        ]),
      );
    }
    if (width >= CorocBreakpoints.tablet) {
      return Scaffold(
        body: Row(children: [
          NavigationRail(
            selectedIndex: index,
            onDestinationSelected: go,
            labelType: NavigationRailLabelType.all,
            leading: const Padding(padding: EdgeInsets.symmetric(vertical: CorocSpace.md), child: CorocLogo(layout: LogoLayout.isotype, height: 36)),
            destinations: [for (final d in dests) NavigationRailDestination(icon: Icon(d.icon), selectedIcon: Icon(d.selectedIcon), label: Text(d.label(l)))],
          ),
          const VerticalDivider(width: 1),
          Expanded(child: body),
        ]),
      );
    }
    return Scaffold(
      body: SafeArea(bottom: false, child: body),
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: go,
        destinations: [for (final d in dests) NavigationDestination(icon: Icon(d.icon), selectedIcon: Icon(d.selectedIcon), label: d.label(l))],
      ),
    );
  }
}

class _Sidebar extends ConsumerWidget {
  const _Sidebar({required this.dests, required this.index, required this.onSelect});
  final List<_Dest> dests;
  final int index;
  final ValueChanged<int> onSelect;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    final auth = ref.watch(authProvider);
    final user = auth is SignedIn ? auth.user : null;
    // Barra lateral azul noche en ambos modos (§5.2): el dorado se reserva para el elemento activo.
    return Container(
      width: 264,
      color: Theme.of(context).brightness == Brightness.light ? CorocColors.navy800 : CorocColors.navy900,
      child: SafeArea(
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(CorocSpace.lg, CorocSpace.lg, CorocSpace.lg, CorocSpace.xl),
            child: Align(alignment: Alignment.centerLeft, child: Theme(data: ThemeData.dark(), child: const CorocLogo(layout: LogoLayout.horizontal, height: 40))),
          ),
          for (var i = 0; i < dests.length; i++)
            _SideItem(
              icon: i == index ? dests[i].selectedIcon : dests[i].icon,
              label: dests[i].label(l),
              selected: i == index,
              onTap: () => onSelect(i),
            ),
          const Spacer(),
          // «Crear respaldo» visible en el menú principal (§19).
          if (user != null && user.can('backup.create'))
            _SideItem(icon: Icons.backup_outlined, label: l.backupCreate, selected: false, onTap: () => showCreateBackupDialog(context, ref)),
          if (user != null)
            Padding(
              padding: const EdgeInsets.all(CorocSpace.md),
              child: Row(children: [
                CircleAvatar(
                  radius: 18,
                  backgroundColor: CorocColors.gold500,
                  child: Text(initials(user.name), style: t.labelLarge?.copyWith(color: CorocColors.navy800)),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(user.name, style: t.bodyMedium?.copyWith(color: CorocColors.ivory), overflow: TextOverflow.ellipsis),
                    Text(roleLabel(l, user.role), style: t.bodySmall?.copyWith(color: CorocColors.inkMutedDark)),
                  ]),
                ),
                IconButton(
                  tooltip: l.actionLogout,
                  icon: const Icon(Icons.logout, color: CorocColors.ivory),
                  onPressed: () => ref.read(authProvider.notifier).logout(),
                ),
              ]),
            ),
        ]),
      ),
    );
  }
}

class _SideItem extends StatelessWidget {
  const _SideItem({required this.icon, required this.label, required this.selected, required this.onTap});
  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: CorocSpace.md, vertical: 2),
      child: Material(
        color: selected ? const Color(0x1FFFFDE7) : Colors.transparent,
        borderRadius: BorderRadius.circular(CorocRadii.control),
        child: InkWell(
          borderRadius: BorderRadius.circular(CorocRadii.control),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            child: Row(children: [
              Icon(icon, size: 22, color: selected ? CorocColors.gold300 : CorocColors.ivory),
              const SizedBox(width: 14),
              Expanded(child: Text(label, style: t.bodyLarge?.copyWith(color: CorocColors.ivory, fontWeight: selected ? FontWeight.w600 : FontWeight.w400))),
            ]),
          ),
        ),
      ),
    );
  }
}

String initials(String name) {
  final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
  if (parts.isEmpty) return '·';
  final first = parts.first[0];
  final second = parts.length > 1 ? parts[1][0] : '';
  return (first + second).toUpperCase();
}

String roleLabel(AppLocalizations l, String role) => switch (role) {
      'owner' => l.roleOwner,
      'admin' => l.roleAdmin,
      'collector' => l.roleCollector,
      'auditor' => l.roleAuditor,
      _ => role,
    };

/// Página con desplazamiento y márgenes consistentes.
class PageScaffold extends StatelessWidget {
  const PageScaffold({super.key, required this.children, this.maxWidth = 1280, this.onRefresh});
  final List<Widget> children;
  final double maxWidth;
  final Future<void> Function()? onRefresh;

  @override
  Widget build(BuildContext context) {
    final pad = MediaQuery.sizeOf(context).width < CorocBreakpoints.tablet ? CorocSpace.md : CorocSpace.xl;
    final list = ListView(
      padding: EdgeInsets.fromLTRB(pad, pad, pad, CorocSpace.xxl),
      children: [
        Center(
          child: ConstrainedBox(
            constraints: BoxConstraints(maxWidth: maxWidth),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
          ),
        ),
      ],
    );
    return onRefresh == null ? list : RefreshIndicator(onRefresh: onRefresh!, child: list);
  }
}

/// Pequeño marcador para vistas que requieren un permiso que el rol no tiene.
class NoPermission extends StatelessWidget {
  const NoPermission({super.key});
  @override
  Widget build(BuildContext context) => EmptyState(icon: Icons.lock_outline, title: context.l10n.noPermissionTitle, message: context.l10n.noPermissionMessage);
}
