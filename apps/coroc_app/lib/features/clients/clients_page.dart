import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/brand.dart';
import '../../design/widgets/common.dart';
import '../../design/widgets/labels.dart';
import '../shell/app_shell.dart';

/// Clientes (§5.7-5): búsqueda instantánea sin tildes, filtros y lista paginada que carga al desplazarse.
class ClientsPage extends ConsumerStatefulWidget {
  const ClientsPage({super.key, this.focusSearch = false});
  final bool focusSearch;
  @override
  ConsumerState<ClientsPage> createState() => _ClientsPageState();
}

class _ClientsPageState extends ConsumerState<ClientsPage> {
  final _search = TextEditingController();
  final _focus = FocusNode();
  final _scroll = ScrollController();
  Timer? _debounce;
  String? _status;
  String? _frequency;
  final List<ClientListItem> _items = [];
  String? _cursor;
  bool _loading = false;
  bool _end = false;
  Object? _error;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(() {
      if (_scroll.position.pixels > _scroll.position.maxScrollExtent - 400) _load();
    });
    if (widget.focusSearch) WidgetsBinding.instance.addPostFrameCallback((_) => _focus.requestFocus());
    _reload();
  }

  @override
  void didUpdateWidget(ClientsPage old) {
    super.didUpdateWidget(old);
    if (widget.focusSearch) _focus.requestFocus();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    _focus.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _reload() {
    _generation++;
    setState(() {
      _items.clear();
      _cursor = null;
      _end = false;
      _error = null;
      _loading = false;
    });
    _load();
  }

  Future<void> _load() async {
    if (_loading || _end) return;
    final gen = _generation;
    setState(() => _loading = true);
    try {
      final page = await ref.read(apiProvider).clients(q: _search.text.trim(), status: _status, frequency: _frequency, cursor: _cursor);
      if (!mounted || gen != _generation) return;
      setState(() {
        _items.addAll(page.items);
        _cursor = page.nextCursor;
        _end = page.nextCursor == null;
      });
    } catch (e) {
      if (mounted && gen == _generation) setState(() => _error = e);
    } finally {
      if (mounted && gen == _generation) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final auth = ref.watch(authProvider);
    final canCreate = auth is SignedIn && auth.user.can('clients.create');
    final pad = MediaQuery.sizeOf(context).width < CorocBreakpoints.tablet ? CorocSpace.md : CorocSpace.xl;
    return RefreshIndicator(
      onRefresh: () async => _reload(),
      child: CustomScrollView(
        controller: _scroll,
        slivers: [
          SliverPadding(
            padding: EdgeInsets.fromLTRB(pad, pad, pad, 0),
            sliver: SliverToBoxAdapter(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  PageHeader(
                    title: l.navClients,
                    subtitle: l.clientsSubtitle,
                    actions: [if (canCreate) GoldButton(label: l.newClient, icon: Icons.add, onPressed: () => context.go('/clients/new'))],
                  ),
                  TextField(
                    controller: _search,
                    focusNode: _focus,
                    decoration: corocInput(context, label: l.clientsSearch, hint: l.clientsSearchHint, prefix: const Icon(Icons.search)),
                    onChanged: (_) {
                      _debounce?.cancel();
                      _debounce = Timer(const Duration(milliseconds: 250), _reload);
                    },
                  ),
                  const SizedBox(height: CorocSpace.md),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final f in [(null, l.filterAll), ('current', l.clientCurrent), ('overdue', l.clientOverdue), ('closed', l.clientClosed)])
                        ChoiceChip(
                          label: Text(f.$2),
                          selected: _status == f.$1,
                          onSelected: (_) {
                            _status = f.$1;
                            _reload();
                          },
                        ),
                      const SizedBox(width: 8),
                      for (final f in [('daily', l.freqDaily), ('weekly', l.freqWeekly), ('monthly', l.freqMonthly)])
                        FilterChip(
                          label: Text(f.$2),
                          selected: _frequency == f.$1,
                          onSelected: (on) {
                            _frequency = on ? f.$1 : null;
                            _reload();
                          },
                        ),
                    ],
                  ),
                  const SizedBox(height: CorocSpace.md),
                ],
              ),
            ),
          ),
          if (_error != null && _items.isEmpty)
            SliverFillRemaining(
              hasScrollBody: false,
              child: ErrorState(message: errorText(context, _error!), onRetry: _reload),
            )
          else if (_items.isEmpty && !_loading)
            SliverFillRemaining(
              hasScrollBody: false,
              child: EmptyState(
                icon: Icons.people_outline,
                title: _search.text.isEmpty ? l.clientsEmpty : l.clientsNoMatch,
                action: canCreate && _search.text.isEmpty ? GoldButton(label: l.newClient, icon: Icons.add, onPressed: () => context.go('/clients/new')) : null,
              ),
            )
          else
            SliverPadding(
              padding: EdgeInsets.fromLTRB(pad, 0, pad, CorocSpace.xxl),
              sliver: SliverList.separated(
                itemCount: _items.length + (_loading ? 1 : 0),
                separatorBuilder: (_, _) => const SizedBox(height: 8),
                itemBuilder: (context, i) => i >= _items.length
                    ? const Padding(
                        padding: EdgeInsets.all(CorocSpace.lg),
                        child: Center(child: CircularProgressIndicator()),
                      )
                    : _ClientTile(item: _items[i]),
              ),
            ),
        ],
      ),
    );
  }
}

class _ClientTile extends StatelessWidget {
  const _ClientTile({required this.item});
  final ClientListItem item;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    final (label, tone) = clientStatus(l, item.status);
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(CorocRadii.card),
        onTap: () => context.go('/clients/${item.id}'),
        child: Padding(
          padding: const EdgeInsets.all(CorocSpace.md),
          child: Row(
            children: [
              CircleAvatar(
                radius: 22,
                backgroundColor: CorocColors.gold300,
                child: Text(
                  initials(item.fullName),
                  style: const TextStyle(color: CorocColors.navy800, fontWeight: FontWeight.w600),
                ),
              ),
              const SizedBox(width: CorocSpace.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(item.fullName, style: t.titleSmall, overflow: TextOverflow.ellipsis),
                    const SizedBox(height: 2),
                    Text([item.code, ...item.contracts, frequencyLabel(l, item.frequency)].where((s) => s != '—').join(' · '), style: t.bodySmall, overflow: TextOverflow.ellipsis),
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 12,
                      runSpacing: 4,
                      children: [
                        StatusDot(label: item.status == 'overdue' ? '$label · ${l.daysPastDue(item.daysPastDue)}' : label, tone: tone),
                        if (item.next != null) Text(l.nextInstallmentShort(Dates.dayMonth(item.next!.dueDate, context.lang), Money.format(item.next!.outstanding, item.currency)), style: t.bodySmall),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(width: CorocSpace.md),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Overline(l.balance),
                  const SizedBox(height: 4),
                  Text(Money.format(item.balance, item.currency), style: t.titleMedium?.copyWith(fontFamily: 'Inter')),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
