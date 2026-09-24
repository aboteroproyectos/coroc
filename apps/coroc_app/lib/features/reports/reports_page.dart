import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/common.dart';
import '../../design/widgets/labels.dart';
import '../documents/documents.dart';
import '../loans/loan_providers.dart';
import '../shell/app_shell.dart';

typedef _Report = ({String type, IconData icon, String title, String body, bool period, bool pdf});

final recentReportsProvider = FutureProvider.autoDispose<List<CorocDocument>>((ref) async => (await ref.watch(apiProvider).documents(kind: 'report', limit: 20)).items);

/// Informes (§18) en PDF, XLSX o CSV y en el idioma elegido. Se generan en el servidor, quedan en la carpeta
/// `_Informes` y se abren en el visor o se comparten. El estado de cuenta de un préstamo está en la ficha del cliente.
class ReportsPage extends ConsumerStatefulWidget {
  const ReportsPage({super.key});
  @override
  ConsumerState<ReportsPage> createState() => _ReportsPageState();
}

class _ReportsPageState extends ConsumerState<ReportsPage> {
  late String _from = _iso(DateTime.now().subtract(const Duration(days: 30)));
  late String _to = _iso(DateTime.now());
  String? _lang;
  String? _collectorId;
  String? _currency;
  String? _running;
  int _progress = 0;

  static String _iso(DateTime d) => '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    final auth = ref.watch(authProvider);
    if (auth is! SignedIn || !auth.user.can('reports.view')) return const NoPermission();
    final lang = _lang ?? context.lang;
    final currency = _currency ?? auth.company.currency;
    final users = auth.user.can('users.view') ? ref.watch(usersProvider).valueOrNull ?? const <User>[] : const <User>[];
    final collectors = users.where((u) => u.role == 'collector').toList();
    final List<_Report> reports = [
      (type: 'portfolio', icon: Icons.pie_chart_outline, title: l.reportPortfolio, body: l.reportPortfolioBody, period: false, pdf: true),
      (type: 'portfolio_by_collector', icon: Icons.groups_outlined, title: l.reportPortfolioByCollector, body: l.reportPortfolioByCollectorBody, period: false, pdf: true),
      (type: 'collections', icon: Icons.payments_outlined, title: l.reportCollections, body: l.reportCollectionsBody, period: true, pdf: true),
      (type: 'aging', icon: Icons.warning_amber_outlined, title: l.reportAging, body: l.reportAgingBody, period: false, pdf: true),
      (type: 'closed', icon: Icons.verified_outlined, title: l.reportClosed, body: l.reportClosedBody, period: true, pdf: true),
      (type: 'cashflow', icon: Icons.trending_up, title: l.reportCashflow, body: l.reportCashflowBody, period: false, pdf: true),
      (type: 'ledger', icon: Icons.menu_book_outlined, title: l.reportLedger, body: l.reportLedgerBody, period: true, pdf: true),
      (type: 'messages', icon: Icons.forum_outlined, title: l.reportMessages, body: l.reportMessagesBody, period: true, pdf: true),
    ];

    return PageScaffold(
      maxWidth: 1100,
      onRefresh: () async => ref.invalidate(recentReportsProvider),
      children: [
        PageHeader(title: l.navReports, subtitle: l.reportsSubtitle),
        SectionCard(
          title: l.reportFilters,
          child: Wrap(
            spacing: CorocSpace.md,
            runSpacing: CorocSpace.md,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              _DateField(label: l.reportFrom, value: _from, onChanged: (v) => setState(() => _from = v)),
              _DateField(label: l.reportTo, value: _to, onChanged: (v) => setState(() => _to = v)),
              DropdownMenu<String>(
                label: Text(l.fieldLanguage),
                initialSelection: lang,
                onSelected: (v) => setState(() => _lang = v),
                dropdownMenuEntries: [for (final c in supportedLanguages) DropdownMenuEntry(value: c, label: languageName(l, c))],
              ),
              DropdownMenu<String>(
                label: Text(l.reportCurrency),
                initialSelection: currency,
                onSelected: (v) => setState(() => _currency = v),
                dropdownMenuEntries: const [
                  DropdownMenuEntry(value: 'COP', label: 'COP'),
                  DropdownMenuEntry(value: 'BRL', label: 'BRL'),
                  DropdownMenuEntry(value: 'USD', label: 'USD'),
                ],
              ),
              if (collectors.isNotEmpty)
                DropdownMenu<String>(
                  label: Text(l.reportCollector),
                  initialSelection: _collectorId ?? '',
                  onSelected: (v) => setState(() => _collectorId = (v == null || v.isEmpty) ? null : v),
                  dropdownMenuEntries: [
                    DropdownMenuEntry(value: '', label: l.reportAllCollectors),
                    for (final c in collectors) DropdownMenuEntry(value: c.id, label: c.name),
                  ],
                ),
            ],
          ),
        ),
        const SizedBox(height: CorocSpace.lg),
        LayoutBuilder(
          builder: (context, c) {
            final cols = c.maxWidth >= 900 ? 2 : 1;
            final w = (c.maxWidth - (cols - 1) * CorocSpace.md) / cols;
            return Wrap(
              spacing: CorocSpace.md,
              runSpacing: CorocSpace.md,
              children: [
                for (final r in reports)
                  SizedBox(
                    width: w,
                    child: Card(
                      child: Padding(
                        padding: const EdgeInsets.all(CorocSpace.lg),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Icon(r.icon, color: Theme.of(context).colorScheme.tertiary),
                                const SizedBox(width: CorocSpace.md),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(r.title, style: t.titleMedium),
                                      const SizedBox(height: 4),
                                      Text(r.body, style: t.bodySmall),
                                      if (r.period) Text(l.reportUsesPeriod, style: t.bodySmall?.copyWith(color: Theme.of(context).colorScheme.tertiary)),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: CorocSpace.md),
                            if (_running == r.type)
                              Row(
                                children: [
                                  const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
                                  const SizedBox(width: 12),
                                  Text(l.reportGenerating(_progress)),
                                ],
                              )
                            else
                              Wrap(
                                spacing: 8,
                                runSpacing: 8,
                                children: [
                                  if (r.pdf) FilledButton.tonal(onPressed: _running != null ? null : () => _generate(r, 'pdf', lang, currency), child: const Text('PDF')),
                                  OutlinedButton(onPressed: _running != null ? null : () => _generate(r, 'xlsx', lang, currency), child: const Text('XLSX')),
                                  OutlinedButton(onPressed: _running != null ? null : () => _generate(r, 'csv', lang, currency), child: const Text('CSV')),
                                ],
                              ),
                          ],
                        ),
                      ),
                    ),
                  ),
              ],
            );
          },
        ),
        const SizedBox(height: CorocSpace.lg),
        SectionCard(
          title: l.reportRecent,
          child: AsyncBody<List<CorocDocument>>(
            value: ref.watch(recentReportsProvider),
            onRetry: () => ref.invalidate(recentReportsProvider),
            builder: (list) => list.isEmpty
                ? Padding(
                    padding: const EdgeInsets.all(CorocSpace.md),
                    child: Text(l.reportNoneYet, style: t.bodyMedium),
                  )
                : Column(
                    children: [
                      for (final d in list)
                        ListTile(
                          leading: Icon(docIcon(d), color: Theme.of(context).colorScheme.tertiary),
                          title: Text(d.name, overflow: TextOverflow.ellipsis),
                          subtitle: Text('${d.fileName.split('.').last.toUpperCase()} · ${Dates.dateTime(d.createdAt, context.lang)} · ${fileSize(d.size)}'),
                          trailing: const Icon(Icons.chevron_right),
                          onTap: () => _open(context, d),
                        ),
                    ],
                  ),
          ),
        ),
      ],
    );
  }

  Future<void> _open(BuildContext context, CorocDocument d) async {
    if (d.isPdf) return openDocument(context, d.id);
    // XLSX y CSV se abren en la hoja de cálculo del equipo: se comparten o se guardan.
    final bytes = await fetchDocumentBytes(ref, d.id);
    if (context.mounted) await shareOrSave(context, fileName: d.fileName, bytes: bytes, mime: d.mime);
  }

  Future<void> _generate(_Report r, String format, String lang, String currency) async {
    final l = context.l10n;
    setState(() {
      _running = r.type;
      _progress = 0;
    });
    try {
      final task = await ref
          .read(apiProvider)
          .requestReport(type: r.type, format: format, lang: lang == 'pt' ? 'pt-BR' : lang, currency: currency, collectorId: _collectorId, from: r.period ? _from : null, to: r.period ? _to : null);
      final id = await waitForTask(
        ref,
        task.id,
        onProgress: (p) {
          if (mounted) setState(() => _progress = p);
        },
      );
      ref.invalidate(recentReportsProvider);
      if (!mounted) return;
      if (id == null) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l.docTaskFailed)));
        return;
      }
      final doc = await ref.read(apiProvider).document(id);
      if (mounted) await _open(context, doc);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(context, e))));
    } finally {
      if (mounted) setState(() => _running = null);
    }
  }
}

class _DateField extends StatelessWidget {
  const _DateField({required this.label, required this.value, required this.onChanged});
  final String label;
  final String value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 200,
      child: InkWell(
        borderRadius: BorderRadius.circular(CorocRadii.control),
        onTap: () async {
          final d = await showDatePicker(context: context, initialDate: DateTime.parse(value), firstDate: DateTime(2020), lastDate: DateTime.now().add(const Duration(days: 365)));
          if (d != null) onChanged('${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}');
        },
        child: InputDecorator(
          decoration: corocInput(context, label: label, suffix: const Icon(Icons.event_outlined)),
          child: Text(Dates.medium(value, context.lang)),
        ),
      ),
    );
  }
}
