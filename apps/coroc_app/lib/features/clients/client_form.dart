import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/l10n.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/brand.dart';
import '../../design/widgets/common.dart';
import '../../design/widgets/labels.dart';
import '../loans/loan_providers.dart';

/// Controladores del formulario de datos del cliente (§8.1).
class ClientFormData {
  ClientFormData([Client? c])
    : firstName = TextEditingController(text: c?.firstName),
      lastName = TextEditingController(text: c?.lastName),
      phone = TextEditingController(text: c?.phone),
      phone2 = TextEditingController(text: c?.phone2),
      email = TextEditingController(text: c?.email),
      address = TextEditingController(text: c?.address),
      city = TextEditingController(text: c?.city),
      idDocType = TextEditingController(text: c?.idDocType ?? 'CC'),
      idDocNumber = TextEditingController(text: c?.idDocNumber),
      notes = TextEditingController(text: c?.notes),
      coName = TextEditingController(text: c?.coDebtor?.name),
      coPhone = TextEditingController(text: c?.coDebtor?.phone),
      coEmail = TextEditingController(text: c?.coDebtor?.email),
      lang = c?.lang,
      collectorId = c?.collectorId;

  final TextEditingController firstName, lastName, phone, phone2, email, address, city, idDocType, idDocNumber, notes, coName, coPhone, coEmail;
  String? lang;
  String? collectorId;

  String? _t(TextEditingController c) => c.text.trim().isEmpty ? null : c.text.trim();

  Map<String, dynamic> toJson({required String defaultLang}) => {
    'firstName': firstName.text.trim(),
    'lastName': lastName.text.trim(),
    'phone': phone.text.trim(),
    'phone2': _t(phone2),
    'email': _t(email),
    'address': _t(address),
    'city': _t(city),
    'idDocType': _t(idDocNumber) == null ? null : _t(idDocType),
    'idDocNumber': _t(idDocNumber),
    'lang': lang ?? defaultLang,
    'collectorId': collectorId,
    'notes': _t(notes),
    'coDebtor': _t(coName) == null ? null : {'name': _t(coName), 'phone': ?_t(coPhone), 'email': ?_t(coEmail)},
  };

  void dispose() {
    for (final c in [firstName, lastName, phone, phone2, email, address, city, idDocType, idDocNumber, notes, coName, coPhone, coEmail]) {
      c.dispose();
    }
  }
}

/// Campos del cliente. Los errores del servidor (número no válido, correo) se muestran en su campo.
class ClientFields extends ConsumerWidget {
  const ClientFields({super.key, required this.data, this.error, required this.onChanged});
  final ClientFormData data;
  final ApiException? error;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final auth = ref.watch(authProvider);
    final canPickCollector = auth is SignedIn && auth.user.can('users.view');
    String? err(String f) => error?.fieldMessage(f);
    Widget field(TextEditingController c, String label, {String? errorField, TextInputType? type, String? helper, bool required = false, int lines = 1}) => TextFormField(
      controller: c,
      keyboardType: type,
      maxLines: lines,
      decoration: corocInput(context, label: required ? '$label *' : label, helper: helper, error: errorField == null ? null : err(errorField)),
      validator: required ? (v) => (v ?? '').trim().isEmpty ? l.validationRequired : null : null,
      onChanged: (_) => onChanged(),
    );
    Widget pair(Widget a, Widget b) => LayoutBuilder(
      builder: (context, c) {
        if (c.maxWidth < 560) {
          return Column(
            children: [
              a,
              const SizedBox(height: CorocSpace.md),
              b,
            ],
          );
        }
        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(child: a),
            const SizedBox(width: CorocSpace.md),
            Expanded(child: b),
          ],
        );
      },
    );
    const gap = SizedBox(height: CorocSpace.md);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        pair(field(data.firstName, l.fieldFirstName, required: true, errorField: 'firstName'), field(data.lastName, l.fieldLastName, required: true, errorField: 'lastName')),
        gap,
        pair(
          field(data.phone, l.fieldPhone, required: true, type: TextInputType.phone, helper: l.fieldPhoneHelp, errorField: 'phone'),
          field(data.phone2, l.fieldPhone2, type: TextInputType.phone, errorField: 'phone2'),
        ),
        gap,
        pair(field(data.email, l.fieldEmail, type: TextInputType.emailAddress, errorField: 'email'), field(data.city, l.fieldCity)),
        gap,
        field(data.address, l.fieldAddress),
        gap,
        pair(field(data.idDocType, l.fieldIdDocType), field(data.idDocNumber, l.fieldIdDoc, errorField: 'idDocNumber')),
        gap,
        Wrap(
          spacing: CorocSpace.md,
          runSpacing: CorocSpace.md,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Text(l.fieldLanguage),
            SegmentedButton<String>(
              showSelectedIcon: false,
              segments: [
                for (final c in ['es', 'pt-BR', 'en']) ButtonSegment(value: c, label: Text(languageName(l, c))),
              ],
              selected: {data.lang ?? (context.lang == 'pt' ? 'pt-BR' : context.lang)},
              onSelectionChanged: (v) {
                data.lang = v.first;
                onChanged();
              },
            ),
          ],
        ),
        if (canPickCollector) ...[gap, _CollectorPicker(data: data, onChanged: onChanged)],
        gap,
        ExpansionTile(
          tilePadding: EdgeInsets.zero,
          title: Text(l.coDebtor),
          subtitle: Text(l.coDebtorHelp, style: Theme.of(context).textTheme.bodySmall),
          childrenPadding: const EdgeInsets.only(bottom: CorocSpace.md),
          children: [
            field(data.coName, l.fieldName),
            gap,
            pair(field(data.coPhone, l.fieldPhone, type: TextInputType.phone, errorField: 'coDebtor.phone'), field(data.coEmail, l.fieldEmail, type: TextInputType.emailAddress)),
          ],
        ),
        field(data.notes, l.fieldNotes, lines: 3),
      ],
    );
  }
}

class _CollectorPicker extends ConsumerWidget {
  const _CollectorPicker({required this.data, required this.onChanged});
  final ClientFormData data;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final users = ref.watch(usersProvider).valueOrNull ?? const <User>[];
    final collectors = users.where((u) => u.role == 'collector' && u.active).toList();
    if (collectors.isEmpty) return const SizedBox.shrink();
    return DropdownMenu<String?>(
      initialSelection: data.collectorId,
      label: Text(l.fieldCollector),
      expandedInsets: EdgeInsets.zero,
      onSelected: (v) {
        data.collectorId = v;
        onChanged();
      },
      dropdownMenuEntries: [
        DropdownMenuEntry<String?>(value: null, label: l.collectorNone),
        for (final u in collectors) DropdownMenuEntry<String?>(value: u.id, label: u.name),
      ],
    );
  }
}

/// Edición del cliente con concurrencia optimista (If-Match con la versión).
Future<Client?> showEditClient(BuildContext context, WidgetRef ref, Client client) {
  return showDialog<Client>(
    context: context,
    builder: (_) => Dialog(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 720),
        child: _EditClient(client: client),
      ),
    ),
  );
}

class _EditClient extends ConsumerStatefulWidget {
  const _EditClient({required this.client});
  final Client client;
  @override
  ConsumerState<_EditClient> createState() => _EditClientState();
}

class _EditClientState extends ConsumerState<_EditClient> {
  late final ClientFormData _data = ClientFormData(widget.client);
  final _form = GlobalKey<FormState>();
  ApiException? _error;
  bool _busy = false;

  @override
  void dispose() {
    _data.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!(_form.currentState?.validate() ?? false)) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final updated = await ref.read(apiProvider).updateClient(widget.client.id, _data.toJson(defaultLang: widget.client.lang), widget.client.version);
      if (mounted) Navigator.of(context).pop(updated);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return Form(
      key: _form,
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(CorocSpace.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(l.editClientTitle, style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: CorocSpace.lg),
            ClientFields(data: _data, error: _error, onChanged: () {}),
            if (_error != null) ...[const SizedBox(height: CorocSpace.md), Text(errorText(context, _error!), style: TextStyle(color: Theme.of(context).colorScheme.error))],
            const SizedBox(height: CorocSpace.lg),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(onPressed: () => Navigator.of(context).pop(), child: Text(l.actionCancel)),
                const SizedBox(width: 8),
                GoldButton(label: l.actionSave, onPressed: _save, busy: _busy),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
