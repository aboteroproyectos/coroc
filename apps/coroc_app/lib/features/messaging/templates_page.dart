import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/l10n.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/common.dart';
import '../../design/widgets/labels.dart';
import '../loans/loan_providers.dart';
import '../shell/app_shell.dart';
import 'messaging_common.dart';

final templatesProvider = FutureProvider.autoDispose<TemplatesView>((ref) => ref.watch(apiProvider).templates());

/// Variables disponibles (§11.3). Los nombres son parte del contrato: se escriben igual en los tres idiomas.
const templateVariables = [
  'nombre',
  'apellidos',
  'contrato',
  'valor_cuota',
  'fecha_vencimiento',
  'cuota_numero',
  'cuotas_restantes',
  'saldo',
  'valor_pagado',
  'enlace_carga',
  'enlace_recibo',
  'empresa',
  'telefono_empresa',
];

const _langs = ['es', 'pt-BR', 'en'];

/// Plantillas (§11.3, pantalla 9): un editor por evento e idioma con vista previa en vivo sobre un cliente real,
/// contador de caracteres y el validador que bloquea contenido prohibido. Cada evento se activa por separado.
class TemplatesPage extends ConsumerStatefulWidget {
  const TemplatesPage({super.key});
  @override
  ConsumerState<TemplatesPage> createState() => _TemplatesPageState();
}

class _TemplatesPageState extends ConsumerState<TemplatesPage> {
  String? _lang;
  String? _loanId;
  String? _clientName;

  Future<void> _pickClient() async {
    final picked = await showDialog<({String loanId, String name})>(context: context, builder: (_) => const _ClientPicker());
    if (picked != null) {
      setState(() {
        _loanId = picked.loanId;
        _clientName = picked.name;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final auth = ref.watch(authProvider);
    if (auth is! SignedIn || !auth.user.can('messages.view')) return const NoPermission();
    final canEdit = auth.user.can('compliance.manage');
    final lang =
        _lang ??
        switch (context.lang) {
          'pt' => 'pt-BR',
          'en' => 'en',
          _ => 'es',
        };
    final view = ref.watch(templatesProvider);
    return PageScaffold(
      maxWidth: 1000,
      children: [
        TextButton.icon(onPressed: () => context.go('/messages'), icon: const Icon(Icons.arrow_back), label: Text(l.navMessages)),
        PageHeader(title: l.templatesTitle, subtitle: l.templatesSubtitle),
        Wrap(
          spacing: CorocSpace.md,
          runSpacing: CorocSpace.sm,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            SegmentedButton<String>(
              showSelectedIcon: false,
              segments: [for (final x in _langs) ButtonSegment(value: x, label: Text(languageName(l, x)))],
              selected: {lang},
              onSelectionChanged: (s) => setState(() => _lang = s.first),
            ),
            OutlinedButton.icon(
              onPressed: _pickClient,
              icon: const Icon(Icons.person_search_outlined),
              label: Text(_clientName == null ? l.templatesPreviewWith : l.templatesPreviewFor(_clientName!)),
            ),
          ],
        ),
        const SizedBox(height: CorocSpace.lg),
        AsyncBody<TemplatesView>(
          value: view,
          onRetry: () => ref.invalidate(templatesProvider),
          builder: (v) => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _EventsCard(events: v.events, canEdit: auth.user.can('company.edit')),
              const SizedBox(height: CorocSpace.lg),
              for (final t in v.templates.where((t) => t.lang == lang)) ...[
                _TemplateEditor(key: ValueKey('${t.event}-${t.lang}-${t.updatedAt}'), template: t, loanId: _loanId, canEdit: canEdit),
                const SizedBox(height: CorocSpace.md),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

/// Activar o desactivar cada mensaje automático y elegir sus canales (§11.3).
class _EventsCard extends ConsumerStatefulWidget {
  const _EventsCard({required this.events, required this.canEdit});
  final List<MessageEventConfig> events;
  final bool canEdit;
  @override
  ConsumerState<_EventsCard> createState() => _EventsCardState();
}

class _EventsCardState extends ConsumerState<_EventsCard> {
  bool _busy = false;

  Future<void> _save(MessageEventConfig e, {bool? enabled, List<String>? channels}) async {
    setState(() => _busy = true);
    try {
      final company = await ref.read(companyProvider.future);
      await ref.read(apiProvider).updateCompany({
        'settings': {
          'messageEvents': {
            e.event: {'enabled': enabled ?? e.enabled, 'channels': channels ?? e.channels},
          },
        },
      }, company.version);
      ref.invalidate(companyProvider);
      ref.invalidate(templatesProvider);
    } catch (err) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(context, err))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    final enabled = widget.canEdit && !_busy;
    return SectionCard(
      title: l.templatesEvents,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(l.templatesEventsHelp, style: t.bodySmall),
          const SizedBox(height: 8),
          for (final e in widget.events)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Wrap(
                spacing: 8,
                runSpacing: 4,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  SizedBox(
                    width: 260,
                    child: SwitchListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text(eventLabel(l, e.event)),
                      subtitle: Text(e.kind == 'collection' ? l.msgKindCollection : l.msgKindTransactional),
                      value: e.enabled,
                      onChanged: enabled ? (v) => _save(e, enabled: v) : null,
                    ),
                  ),
                  for (final c in const ['whatsapp', 'email'])
                    FilterChip(
                      label: Text(c == 'whatsapp' ? l.channelWhatsapp : l.channelEmail),
                      selected: e.channels.contains(c),
                      onSelected: enabled && e.enabled
                          ? (v) {
                              final next = v ? {...e.channels, c}.toList() : e.channels.where((x) => x != c).toList();
                              if (next.isNotEmpty) _save(e, channels: next);
                            }
                          : null,
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// Editor de una plantilla con vista previa en vivo, contador y validador.
class _TemplateEditor extends ConsumerStatefulWidget {
  const _TemplateEditor({super.key, required this.template, required this.loanId, required this.canEdit});
  final MessageTemplate template;
  final String? loanId;
  final bool canEdit;
  @override
  ConsumerState<_TemplateEditor> createState() => _TemplateEditorState();
}

class _TemplateEditorState extends ConsumerState<_TemplateEditor> {
  late final _body = TextEditingController(text: widget.template.body);
  late final _subject = TextEditingController(text: widget.template.subject);
  late final _meta = TextEditingController(text: widget.template.metaTemplateName ?? '');
  late final _metaLang = TextEditingController(text: widget.template.metaTemplateLang ?? '');
  Timer? _debounce;
  TemplatePreview? _preview;
  bool _busy = false;
  bool _dirty = false;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  @override
  void didUpdateWidget(covariant _TemplateEditor old) {
    super.didUpdateWidget(old);
    if (old.loanId != widget.loanId) _refresh();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    for (final c in [_body, _subject, _meta, _metaLang]) {
      c.dispose();
    }
    super.dispose();
  }

  void _changed() {
    setState(() => _dirty = true);
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), _refresh);
  }

  Future<void> _refresh() async {
    try {
      final p = await ref.read(apiProvider).previewTemplate(event: widget.template.event, lang: widget.template.lang, loanId: widget.loanId, body: _body.text, subject: _subject.text);
      if (mounted) setState(() => _preview = p);
    } catch (_) {
      // La vista previa es informativa: si falla, el validador del servidor responde al guardar.
    }
  }

  void _insert(String name) {
    final sel = _body.selection;
    final text = _body.text;
    final token = '{{$name}}';
    final start = sel.isValid ? sel.start : text.length;
    final end = sel.isValid ? sel.end : text.length;
    _body.value = TextEditingValue(
      text: text.replaceRange(start, end, token),
      selection: TextSelection.collapsed(offset: start + token.length),
    );
    _changed();
  }

  Future<void> _save({bool restore = false}) async {
    setState(() => _busy = true);
    final l = context.l10n;
    try {
      await ref
          .read(apiProvider)
          .saveTemplate(
            widget.template.event,
            widget.template.lang,
            body: _body.text,
            subject: _subject.text.trim().isEmpty ? null : _subject.text.trim(),
            active: !restore,
            metaTemplateName: _meta.text.trim().isEmpty ? null : _meta.text.trim(),
            metaTemplateLang: _metaLang.text.trim().isEmpty ? null : _metaLang.text.trim(),
          );
      ref.invalidate(templatesProvider);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(restore ? l.templatesRestored : l.saved)));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(context, e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    final p = _preview;
    final blocking = p != null && p.issues.isNotEmpty;
    final wide = MediaQuery.sizeOf(context).width >= CorocBreakpoints.tablet;
    final editor = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: _body,
          enabled: widget.canEdit,
          minLines: 4,
          maxLines: 10,
          maxLength: 1024,
          onChanged: (_) => _changed(),
          decoration: corocInput(context, label: l.templatesBody),
        ),
        if (widget.template.event != 'manual')
          TextField(
            controller: _subject,
            enabled: widget.canEdit,
            onChanged: (_) => _changed(),
            decoration: corocInput(context, label: l.templatesSubject),
          ),
        const SizedBox(height: 8),
        Text(l.templatesVariables, style: t.labelMedium),
        const SizedBox(height: 4),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            for (final v in templateVariables)
              ActionChip(
                label: Text('{{$v}}', style: t.bodySmall),
                onPressed: widget.canEdit ? () => _insert(v) : null,
              ),
          ],
        ),
        if (widget.canEdit)
          ExpansionTile(
            tilePadding: EdgeInsets.zero,
            title: Text(l.templatesMetaTitle, style: t.labelLarge),
            subtitle: Text(l.templatesMetaHelp, style: t.bodySmall),
            children: [
              TextField(
                controller: _meta,
                onChanged: (_) => setState(() => _dirty = true),
                decoration: corocInput(context, label: l.templatesMetaName),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _metaLang,
                onChanged: (_) => setState(() => _dirty = true),
                decoration: corocInput(context, label: l.templatesMetaLang),
              ),
              const SizedBox(height: 8),
            ],
          ),
      ],
    );
    final preview = Container(
      padding: const EdgeInsets.all(CorocSpace.md),
      decoration: BoxDecoration(color: Theme.of(context).colorScheme.surfaceContainerHighest, borderRadius: BorderRadius.circular(CorocRadii.card)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(l.templatesPreview, style: t.labelLarge)),
              if (p != null) Text(l.templatesChars(p.length), style: t.bodySmall),
            ],
          ),
          const SizedBox(height: 8),
          if (p == null) const LinearProgressIndicator() else SelectableText(p.body, style: t.bodyMedium),
          if (p != null && widget.template.event != 'manual' && p.subject.isNotEmpty) ...[const SizedBox(height: 8), Text('${l.templatesSubject}: ${p.subject}', style: t.bodySmall)],
          if (blocking) ...[
            const SizedBox(height: 8),
            for (final i in p.issues)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(Icons.block, size: 16, color: Theme.of(context).colorScheme.error),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(issueText(l, i), style: t.bodySmall?.copyWith(color: Theme.of(context).colorScheme.error)),
                    ),
                  ],
                ),
              ),
          ],
        ],
      ),
    );
    return SectionCard(
      title: eventLabel(l, widget.template.event),
      trailing: widget.template.custom ? Chip(label: Text(l.templatesCustom)) : Chip(label: Text(l.templatesDefault)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (wide)
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(child: editor),
                const SizedBox(width: CorocSpace.md),
                Expanded(child: preview),
              ],
            )
          else ...[
            editor,
            const SizedBox(height: CorocSpace.md),
            preview,
          ],
          if (widget.canEdit) ...[
            const SizedBox(height: CorocSpace.md),
            Wrap(
              spacing: 8,
              children: [
                FilledButton(onPressed: _busy || !_dirty || blocking ? null : () => _save(), child: Text(l.actionSave)),
                if (widget.template.custom) TextButton(onPressed: _busy ? null : () => _save(restore: true), child: Text(l.templatesRestore)),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

/// Elige un cliente real para la vista previa (§11.3): se usa su préstamo activo.
class _ClientPicker extends ConsumerStatefulWidget {
  const _ClientPicker();
  @override
  ConsumerState<_ClientPicker> createState() => _ClientPickerState();
}

class _ClientPickerState extends ConsumerState<_ClientPicker> {
  final _q = TextEditingController();
  Timer? _debounce;
  List<ClientListItem> _items = const [];

  @override
  void initState() {
    super.initState();
    _search();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _q.dispose();
    super.dispose();
  }

  Future<void> _search() async {
    try {
      final r = await ref.read(apiProvider).clients(q: _q.text.trim().isEmpty ? null : _q.text.trim(), limit: 20);
      if (mounted) setState(() => _items = r.items);
    } catch (_) {
      if (mounted) setState(() => _items = const []);
    }
  }

  Future<void> _pick(ClientListItem c) async {
    try {
      final client = await ref.read(apiProvider).clientById(c.id);
      final loan = client.loans.where((x) => x.status == 'active').firstOrNull ?? client.loans.firstOrNull;
      if (loan != null && mounted) Navigator.pop(context, (loanId: loan.id, name: c.fullName));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(context, e))));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return AlertDialog(
      title: Text(l.templatesPreviewWith),
      content: SizedBox(
        width: 420,
        height: 420,
        child: Column(
          children: [
            TextField(
              controller: _q,
              autofocus: true,
              decoration: corocInput(context, label: l.clientsSearch, prefix: const Icon(Icons.search)),
              onChanged: (_) {
                _debounce?.cancel();
                _debounce = Timer(const Duration(milliseconds: 300), _search);
              },
            ),
            const SizedBox(height: 8),
            Expanded(
              child: ListView(
                children: [
                  for (final c in _items) ListTile(title: Text(c.fullName), subtitle: Text([c.code, ...c.contracts].join(' · ')), onTap: () => _pick(c)),
                ],
              ),
            ),
          ],
        ),
      ),
      actions: [TextButton(onPressed: () => Navigator.pop(context), child: Text(l.actionCancel))],
    );
  }
}
