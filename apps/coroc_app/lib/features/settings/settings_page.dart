import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../core/api/api_exception.dart';
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
import '../../design/widgets/labels.dart';
import '../auth/login_page.dart' show CodeField;
import '../loans/loan_providers.dart';
import '../loans/loan_terms_form.dart' show percentToRate;
import '../shell/app_shell.dart';

void _toast(BuildContext context, String message) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));

/// Ejecuta una operación y muestra el error traducido si falla. Devuelve si tuvo éxito.
Future<bool> _run(BuildContext context, Future<void> Function() action) async {
  try {
    await action();
    return true;
  } catch (e) {
    if (context.mounted) _toast(context, errorText(context, e));
    return false;
  }
}

/// Configuración (§18): preferencias personales, seguridad, empresa, usuarios y roles, y topes legales de tasa.
/// Cada sección aparece solo si el rol tiene el permiso correspondiente.
class SettingsPage extends ConsumerWidget {
  const SettingsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final auth = ref.watch(authProvider);
    if (auth is! SignedIn) return const SizedBox.shrink();
    final u = auth.user;
    const gap = SizedBox(height: CorocSpace.lg);
    return PageScaffold(maxWidth: 1000, children: [
      PageHeader(title: l.navSettings, subtitle: l.settingsSubtitle),
      _Preferences(user: u),
      gap,
      _Security(user: u),
      if (u.can('company.view')) ...[gap, _CompanySection(canEdit: u.can('company.edit'))],
      if (u.can('users.view')) ...[gap, _UsersSection(me: u)],
      if (u.can('compliance.view')) ...[gap, _RateCapsSection(canManage: u.can('compliance.manage'), country: auth.company.country)],
      gap,
      _About(company: auth.company),
    ]);
  }
}

/// Fila de ajuste: etiqueta y ayuda a la izquierda, control a la derecha (apilados en pantallas estrechas).
class _SettingRow extends StatelessWidget {
  const _SettingRow({required this.label, this.help, required this.child});
  final String label;
  final String? help;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final text = Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(label, style: t.titleSmall),
      if (help != null) ...[const SizedBox(height: 4), Text(help!, style: t.bodySmall?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant))],
    ]);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: LayoutBuilder(builder: (context, c) {
        if (c.maxWidth < 620) return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [text, const SizedBox(height: 8), child]);
        return Row(children: [Expanded(child: text), const SizedBox(width: CorocSpace.md), child]);
      }),
    );
  }
}

Future<String?> _promptText(BuildContext context, {required String title, required String label, String initial = ''}) {
  final c = TextEditingController(text: initial);
  return showDialog<String>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: SizedBox(width: 380, child: TextField(controller: c, autofocus: true, decoration: corocInput(context, label: label), onSubmitted: (v) => Navigator.pop(context, v.trim()))),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text(context.l10n.actionCancel)),
        FilledButton(onPressed: () => Navigator.pop(context, c.text.trim()), child: Text(context.l10n.actionSave)),
      ],
    ),
  );
  // El controlador no se libera aquí: el diálogo aún lo usa durante la animación de salida.
}

// ─────────────────────────────── Preferencias ───────────────────────────────

class _Preferences extends ConsumerWidget {
  const _Preferences({required this.user});
  final User user;

  Future<void> _patch(BuildContext context, WidgetRef ref, {String? lang, String? theme, int? autoLockMinutes, String? name}) {
    // Se toman antes de esperar a la red: la página puede cerrarse mientras tanto.
    final api = ref.read(apiProvider);
    final auth = ref.read(authProvider.notifier);
    return _run(context, () async => auth.updateUser(await api.updateMe(lang: lang, theme: theme, autoLockMinutes: autoLockMinutes, name: name)));
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final lang = ref.watch(localeProvider).languageCode;
    final mode = ref.watch(themeModeProvider);
    return SectionCard(
      title: l.settingsPreferences,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        _SettingRow(
          label: l.fieldLanguage,
          help: l.settingsLanguageHelp,
          child: SegmentedButton<String>(
            showSelectedIcon: false,
            segments: [for (final c in supportedLanguages) ButtonSegment(value: c, label: Text(languageName(l, c)))],
            selected: {lang},
            onSelectionChanged: (v) async {
              // CA-14: la interfaz cambia al instante; luego se guarda en el perfil para los demás equipos.
              await ref.read(localeProvider.notifier).set(v.first);
              if (context.mounted) await _patch(context, ref, lang: ref.read(localeProvider.notifier).apiCode);
            },
          ),
        ),
        _SettingRow(
          label: l.settingsTheme,
          child: SegmentedButton<ThemeMode>(
            showSelectedIcon: false,
            segments: [
              ButtonSegment(value: ThemeMode.system, icon: const Icon(Icons.brightness_auto_outlined), label: Text(l.themeSystem)),
              ButtonSegment(value: ThemeMode.light, icon: const Icon(Icons.light_mode_outlined), label: Text(l.themeLight)),
              ButtonSegment(value: ThemeMode.dark, icon: const Icon(Icons.dark_mode_outlined), label: Text(l.themeDark)),
            ],
            selected: {mode},
            onSelectionChanged: (v) async {
              await ref.read(themeModeProvider.notifier).set(v.first);
              if (context.mounted) await _patch(context, ref, theme: ThemeController.name(v.first));
            },
          ),
        ),
        _SettingRow(
          label: l.settingsAutoLock,
          help: l.settingsAutoLockHelp,
          child: DropdownMenu<int>(
            initialSelection: user.autoLockMinutes,
            width: 180,
            dropdownMenuEntries: [for (final m in const [1, 2, 5, 10, 15, 30, 60]) DropdownMenuEntry<int>(value: m, label: l.minutesN(m))],
            onSelected: (m) {
              if (m != null && m != user.autoLockMinutes) _patch(context, ref, autoLockMinutes: m);
            },
          ),
        ),
        _SettingRow(
          label: l.settingsDisplayName,
          help: '@${user.username} · ${roleLabel(l, user.role)}',
          child: OutlinedButton.icon(
            onPressed: () async {
              final name = await _promptText(context, title: l.settingsDisplayName, label: l.fieldName, initial: user.name);
              if (name != null && name.isNotEmpty && name != user.name && context.mounted) await _patch(context, ref, name: name);
            },
            icon: const Icon(Icons.edit_outlined, size: 18),
            label: Text(user.name),
          ),
        ),
      ]),
    );
  }
}

// ─────────────────────────────── Seguridad ───────────────────────────────

class _Security extends ConsumerWidget {
  const _Security({required this.user});
  final User user;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final t = Theme.of(context).textTheme;
    final sessions = ref.watch(mySessionsProvider);
    final ownerLocked = user.role == 'owner';
    return SectionCard(
      title: l.settingsSecurity,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.password_outlined),
          title: Text(l.passwordChangeTitle),
          subtitle: Text(l.passwordChangeHelp),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => showDialog<void>(context: context, builder: (_) => const _ChangePasswordDialog()),
        ),
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.verified_user_outlined),
          title: Text(l.mfaSetting),
          subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const SizedBox(height: 4),
            StatusDot(label: user.mfaEnabled ? l.mfaOn : l.mfaOff, tone: user.mfaEnabled ? StatusTone.ok : StatusTone.warn),
            if (user.mfaEnabled && ownerLocked) ...[const SizedBox(height: 4), Text(l.mfaOwnerRequired, style: t.bodySmall)],
          ]),
          trailing: user.mfaEnabled
              ? (ownerLocked ? null : TextButton(onPressed: () => showDialog<void>(context: context, builder: (_) => const _DisableMfaDialog()), child: Text(l.actionDisable)))
              : FilledButton.tonal(onPressed: () => showDialog<void>(context: context, builder: (_) => const _EnrollDialog()), child: Text(l.actionEnable)),
        ),
        const Divider(height: CorocSpace.xl),
        Text(l.sessionsTitle, style: t.titleSmall),
        const SizedBox(height: 4),
        Text(l.sessionsHelp, style: t.bodySmall),
        const SizedBox(height: CorocSpace.sm),
        AsyncBody<List<SessionInfo>>(
          value: sessions,
          onRetry: () => ref.invalidate(mySessionsProvider),
          builder: (list) => Column(children: [
            for (final s in list)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Icon(s.current ? Icons.smartphone : Icons.devices_other_outlined),
                title: Text(s.deviceName ?? s.deviceId, overflow: TextOverflow.ellipsis),
                subtitle: Text(l.sessionLastUsed(Dates.dateTime(s.lastUsedAt, context.lang))),
                trailing: s.current
                    ? Chip(label: Text(l.sessionCurrent), visualDensity: VisualDensity.compact)
                    : TextButton(
                        onPressed: () async {
                          final container = ProviderScope.containerOf(context, listen: false);
                          if (await _run(context, () => container.read(apiProvider).revokeMySession(s.id))) container.invalidate(mySessionsProvider);
                        },
                        child: Text(l.actionSignOutDevice),
                      ),
              ),
          ]),
        ),
      ]),
    );
  }
}

class _ChangePasswordDialog extends ConsumerStatefulWidget {
  const _ChangePasswordDialog();
  @override
  ConsumerState<_ChangePasswordDialog> createState() => _ChangePasswordDialogState();
}

class _ChangePasswordDialogState extends ConsumerState<_ChangePasswordDialog> {
  final _current = TextEditingController();
  final _next = TextEditingController();
  final _confirm = TextEditingController();
  bool _show = false;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final l = context.l10n;
    final problem = _next.text.length < 12 ? l.passwordTooShort : (_next.text != _confirm.text ? l.passwordMismatch : null);
    if (problem != null) {
      setState(() => _error = problem);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(apiProvider).changePassword(_current.text, _next.text);
      if (!mounted) return;
      Navigator.pop(context);
      _toast(context, l.passwordChanged);
      ref.invalidate(mySessionsProvider);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = errorText(context, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    Widget field(TextEditingController c, String label, {String? helper}) => Padding(
          padding: const EdgeInsets.only(bottom: CorocSpace.md),
          child: TextField(
            controller: c,
            obscureText: !_show,
            autocorrect: false,
            enableSuggestions: false,
            decoration: corocInput(context, label: label, helper: helper),
            onSubmitted: (_) => _save(),
          ),
        );
    return AlertDialog(
      title: Text(l.passwordChangeTitle),
      content: SizedBox(
        width: 420,
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          field(_current, l.passwordCurrent),
          field(_next, l.passwordNew, helper: l.passwordRules),
          field(_confirm, l.passwordConfirm),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              onPressed: () => setState(() => _show = !_show),
              icon: Icon(_show ? Icons.visibility_off_outlined : Icons.visibility_outlined, size: 18),
              label: Text(_show ? l.actionHidePassword : l.actionShowPassword),
            ),
          ),
          if (_error != null) Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
        ]),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text(l.actionCancel)),
        GoldButton(label: l.actionSave, onPressed: _save, busy: _busy),
      ],
    );
  }
}

/// Activación voluntaria del segundo factor desde Configuración (obligatoria para el Propietario al ingresar).
class _EnrollDialog extends ConsumerStatefulWidget {
  const _EnrollDialog();
  @override
  ConsumerState<_EnrollDialog> createState() => _EnrollDialogState();
}

class _EnrollDialogState extends ConsumerState<_EnrollDialog> {
  final _code = TextEditingController();
  late Future<MfaEnrollment> _enrollment = ref.read(apiProvider).enrollMfa();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _confirm() async {
    if (_busy || _code.text.length != 6) return;
    final l = context.l10n;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(authProvider.notifier).confirmEnrollment(_code.text);
      if (!mounted) return;
      Navigator.pop(context);
      _toast(context, l.mfaEnabledDone);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = errorText(context, e));
      _code.clear();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return AlertDialog(
      title: Text(l.enrollTitle),
      content: SizedBox(
        width: 380,
        child: FutureBuilder<MfaEnrollment>(
          future: _enrollment,
          builder: (context, snap) {
            if (snap.hasError) return ErrorState(message: errorText(context, snap.error!), onRetry: () => setState(() {
                  _enrollment = ref.read(apiProvider).enrollMfa();
                }));
            if (!snap.hasData) return const Center(child: Padding(padding: EdgeInsets.all(CorocSpace.xl), child: CircularProgressIndicator()));
            final e = snap.data!;
            return SingleChildScrollView(
              child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Text(l.enrollSubtitle, style: Theme.of(context).textTheme.bodyMedium),
                const SizedBox(height: CorocSpace.md),
                Center(
                  child: Container(
                    padding: const EdgeInsets.all(CorocSpace.sm),
                    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(CorocRadii.control)),
                    child: QrImageView(data: e.otpauthUri, size: 180, backgroundColor: Colors.white),
                  ),
                ),
                const SizedBox(height: CorocSpace.sm),
                Text(l.enrollManual, style: Theme.of(context).textTheme.bodySmall, textAlign: TextAlign.center),
                SelectableText(e.secret, textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleSmall?.copyWith(letterSpacing: 1.5)),
                TextButton.icon(
                  onPressed: () {
                    Clipboard.setData(ClipboardData(text: e.secret));
                    _toast(context, l.copied);
                  },
                  icon: const Icon(Icons.copy, size: 18),
                  label: Text(l.actionCopy),
                ),
                const SizedBox(height: CorocSpace.sm),
                CodeField(controller: _code, onSubmit: _confirm, error: _error),
              ]),
            );
          },
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text(l.actionCancel)),
        GoldButton(label: l.enrollConfirm, onPressed: _confirm, busy: _busy),
      ],
    );
  }
}

class _DisableMfaDialog extends ConsumerStatefulWidget {
  const _DisableMfaDialog();
  @override
  ConsumerState<_DisableMfaDialog> createState() => _DisableMfaDialogState();
}

class _DisableMfaDialogState extends ConsumerState<_DisableMfaDialog> {
  final _code = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _confirm() async {
    if (_busy || _code.text.length != 6) return;
    final l = context.l10n;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final api = ref.read(apiProvider);
      final auth = ref.read(authProvider.notifier);
      await api.disableMfa(_code.text);
      auth.updateUser(await api.me());
      if (!mounted) return;
      Navigator.pop(context);
      _toast(context, l.mfaDisabledDone);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = errorText(context, e));
      _code.clear();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return AlertDialog(
      title: Text(l.mfaDisableTitle),
      content: SizedBox(
        width: 380,
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(l.mfaDisableHelp),
          const SizedBox(height: CorocSpace.md),
          CodeField(controller: _code, onSubmit: _confirm, error: _error),
        ]),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text(l.actionCancel)),
        FilledButton(onPressed: _busy ? null : _confirm, child: Text(l.actionDisable)),
      ],
    );
  }
}

// ─────────────────────────────── Empresa ───────────────────────────────

String countryName(AppLocalizations l, String code) => switch (code) {
      'CO' => l.countryCO,
      'BR' => l.countryBR,
      'US' => l.countryUS,
      _ => code,
    };

class _CompanySection extends ConsumerWidget {
  const _CompanySection({required this.canEdit});
  final bool canEdit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final company = ref.watch(companyProvider);
    final current = company.valueOrNull;
    return SectionCard(
      title: l.settingsCompany,
      trailing: canEdit && current != null
          ? TextButton.icon(
              onPressed: () => showDialog<void>(context: context, builder: (_) => _CompanyDialog(company: current)),
              icon: const Icon(Icons.edit_outlined, size: 18),
              label: Text(l.actionEdit),
            )
          : null,
      child: AsyncBody<Company>(
        value: company,
        onRetry: () => ref.invalidate(companyProvider),
        builder: (c) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          KeyValue(l.companyName, c.name, emphasize: true),
          KeyValue(l.companyCode, c.slug),
          if (c.taxId case final taxId?) KeyValue(l.companyTaxId, taxId),
          KeyValue(l.companyCountry, countryName(l, c.country)),
          KeyValue(l.companyCurrency, c.currency),
          KeyValue(l.companyTimezone, c.timezone),
          if (c.phone case final phone?) KeyValue(l.fieldPhone, phone),
          if (c.email case final email?) KeyValue(l.fieldEmail, email),
          if (c.address != null || c.city != null) KeyValue(l.fieldAddress, [c.address, c.city].whereType<String>().join(', ')),
        ]),
      ),
    );
  }
}

class _CompanyDialog extends ConsumerStatefulWidget {
  const _CompanyDialog({required this.company});
  final Company company;
  @override
  ConsumerState<_CompanyDialog> createState() => _CompanyDialogState();
}

class _CompanyDialogState extends ConsumerState<_CompanyDialog> {
  late final _name = TextEditingController(text: widget.company.name);
  late final _taxId = TextEditingController(text: widget.company.taxId);
  late final _phone = TextEditingController(text: widget.company.phone);
  late final _email = TextEditingController(text: widget.company.email);
  late final _address = TextEditingController(text: widget.company.address);
  late final _city = TextEditingController(text: widget.company.city);
  bool _busy = false;
  ApiException? _error;

  @override
  void dispose() {
    for (final c in [_name, _taxId, _phone, _email, _address, _city]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    final l = context.l10n;
    if (_name.text.trim().isEmpty) return;
    String? v(TextEditingController c) => c.text.trim().isEmpty ? null : c.text.trim();
    final patch = <String, dynamic>{'name': _name.text.trim(), 'taxId': ?v(_taxId), 'phone': ?v(_phone), 'email': ?v(_email), 'address': ?v(_address), 'city': ?v(_city)};
    setState(() {
      _busy = true;
      _error = null;
    });
    final container = ProviderScope.containerOf(context, listen: false);
    try {
      await container.read(apiProvider).updateCompany(patch, widget.company.version);
      container.invalidate(companyProvider);
      if (!mounted) return;
      Navigator.pop(context);
      _toast(context, l.saved);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    Widget field(TextEditingController c, String label, {String? errorField, TextInputType? type}) => Padding(
          padding: const EdgeInsets.only(bottom: CorocSpace.md),
          child: TextField(controller: c, keyboardType: type, decoration: corocInput(context, label: label, error: errorField == null ? null : _error?.fieldMessage(errorField))),
        );
    return AlertDialog(
      title: Text(l.editCompanyTitle),
      content: SizedBox(
        width: 480,
        child: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            field(_name, '${l.companyName} *'),
            field(_taxId, l.companyTaxId),
            field(_phone, l.fieldPhone, type: TextInputType.phone),
            field(_email, l.fieldEmail, errorField: 'email', type: TextInputType.emailAddress),
            field(_address, l.fieldAddress),
            field(_city, l.fieldCity),
            if (_error != null) Text(errorText(context, _error!), style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ]),
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text(l.actionCancel)),
        GoldButton(label: l.actionSave, onPressed: _save, busy: _busy),
      ],
    );
  }
}

// ─────────────────────────────── Usuarios y roles ───────────────────────────────

class _UsersSection extends ConsumerWidget {
  const _UsersSection({required this.me});
  final User me;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final users = ref.watch(usersProvider);
    final canManage = me.can('users.manage');
    return SectionCard(
      title: l.settingsUsers,
      trailing: canManage
          ? TextButton.icon(
              onPressed: () => showDialog<void>(context: context, builder: (_) => _NewUserDialog(me: me)),
              icon: const Icon(Icons.person_add_alt_1_outlined, size: 18),
              label: Text(l.userNew),
            )
          : null,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(l.rolesHelp, style: Theme.of(context).textTheme.bodySmall),
        const SizedBox(height: CorocSpace.sm),
        AsyncBody<List<User>>(
          value: users,
          onRetry: () => ref.invalidate(usersProvider),
          builder: (list) => Column(children: [for (final u in list) _UserTile(user: u, me: me, canManage: canManage)]),
        ),
      ]),
    );
  }
}

class _UserTile extends StatelessWidget {
  const _UserTile({required this.user, required this.me, required this.canManage});
  final User user;
  final User me;
  final bool canManage;

  Future<void> _action(BuildContext context, String action) async {
    final l = context.l10n;
    final container = ProviderScope.containerOf(context, listen: false);
    final api = container.read(apiProvider);
    switch (action) {
      case 'role':
        final role = await showDialog<String>(
          context: context,
          builder: (context) => SimpleDialog(
            title: Text(l.userChangeRole),
            children: [
              for (final r in _assignableRoles(me))
                SimpleDialogOption(
                  onPressed: () => Navigator.pop(context, r),
                  child: Row(children: [
                    Icon(r == user.role ? Icons.radio_button_checked : Icons.radio_button_off, size: 20),
                    const SizedBox(width: 12),
                    Expanded(child: Text(roleLabel(l, r))),
                  ]),
                ),
            ],
          ),
        );
        if (role == null || role == user.role || !context.mounted) return;
        if (await _run(context, () => api.updateUser(user.id, role: role))) container.invalidate(usersProvider);
      case 'toggle':
        if (await _run(context, () => api.updateUser(user.id, active: !user.active))) container.invalidate(usersProvider);
      case 'sessions':
        if (await _run(context, () => api.revokeUserSessions(user.id)) && context.mounted) _toast(context, l.userSessionsRevoked);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final isMe = user.id == me.id;
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: CircleAvatar(
        backgroundColor: Theme.of(context).colorScheme.secondaryContainer,
        child: Text(initials(user.name), style: TextStyle(color: Theme.of(context).colorScheme.onSecondaryContainer, fontWeight: FontWeight.w600)),
      ),
      title: Text(isMe ? '${user.name} (${l.userYou})' : user.name, overflow: TextOverflow.ellipsis),
      subtitle: Text(['@${user.username}', roleLabel(l, user.role), if (user.mfaEnabled) l.mfaOn].join(' · '), overflow: TextOverflow.ellipsis),
      trailing: Row(mainAxisSize: MainAxisSize.min, children: [
        StatusDot(label: user.active ? l.userActive : l.userInactive, tone: user.active ? StatusTone.ok : StatusTone.neutral),
        if (canManage && !isMe)
          PopupMenuButton<String>(
            tooltip: l.actionMore,
            onSelected: (a) => _action(context, a),
            itemBuilder: (_) => [
              PopupMenuItem(value: 'role', child: Text(l.userChangeRole)),
              PopupMenuItem(value: 'toggle', child: Text(user.active ? l.userDeactivate : l.userActivate)),
              PopupMenuItem(value: 'sessions', child: Text(l.userRevokeSessions)),
            ],
          ),
      ]),
    );
  }
}

/// Solo el Propietario puede nombrar a otro Propietario (§7.2).
List<String> _assignableRoles(User me) => [if (me.role == 'owner') 'owner', 'admin', 'collector', 'auditor'];

/// Contraseña temporal legible (sin caracteres ambiguos), p. ej. «Hk7p-Qm3r-Tz9w-Nb4x».
String generatePassword([Random? random]) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  final r = random ?? Random.secure();
  return List.generate(4, (_) => List.generate(4, (_) => alphabet[r.nextInt(alphabet.length)]).join()).join('-');
}

class _NewUserDialog extends ConsumerStatefulWidget {
  const _NewUserDialog({required this.me});
  final User me;
  @override
  ConsumerState<_NewUserDialog> createState() => _NewUserDialogState();
}

class _NewUserDialogState extends ConsumerState<_NewUserDialog> {
  final _form = GlobalKey<FormState>();
  final _username = TextEditingController();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController(text: generatePassword());
  String _role = 'collector';
  bool _busy = false;
  ApiException? _error;

  @override
  void dispose() {
    for (final c in [_username, _name, _email, _password]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (!(_form.currentState?.validate() ?? false)) return;
    final l = context.l10n;
    setState(() {
      _busy = true;
      _error = null;
    });
    final container = ProviderScope.containerOf(context, listen: false);
    try {
      final u = await container.read(apiProvider).createUser(
            username: _username.text.trim().toLowerCase(),
            name: _name.text.trim(),
            role: _role,
            password: _password.text,
            email: _email.text.trim().isEmpty ? null : _email.text.trim(),
          );
      container.invalidate(usersProvider);
      if (!mounted) return;
      Navigator.pop(context);
      _toast(context, l.userCreated(u.name));
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    const gap = SizedBox(height: CorocSpace.md);
    return AlertDialog(
      title: Text(l.userNew),
      content: SizedBox(
        width: 460,
        child: Form(
          key: _form,
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              TextFormField(
                controller: _name,
                decoration: corocInput(context, label: '${l.fieldName} *', error: _error?.fieldMessage('name')),
                validator: (v) => (v ?? '').trim().isEmpty ? l.validationRequired : null,
              ),
              gap,
              TextFormField(
                controller: _username,
                autocorrect: false,
                decoration: corocInput(context, label: '${l.fieldUsername} *', helper: l.fieldUsernameHelp, error: _error?.fieldMessage('username')),
                validator: (v) => RegExp(r'^[a-z0-9._-]{3,32}$').hasMatch((v ?? '').trim().toLowerCase()) ? null : l.fieldUsernameHelp,
              ),
              gap,
              TextFormField(controller: _email, keyboardType: TextInputType.emailAddress, decoration: corocInput(context, label: l.fieldEmail, error: _error?.fieldMessage('email'))),
              gap,
              DropdownMenu<String>(
                initialSelection: _role,
                label: Text(l.fieldRole),
                expandedInsets: EdgeInsets.zero,
                dropdownMenuEntries: [for (final r in _assignableRoles(widget.me)) DropdownMenuEntry<String>(value: r, label: roleLabel(l, r))],
                onSelected: (r) => setState(() => _role = r ?? _role),
              ),
              gap,
              TextFormField(
                controller: _password,
                autocorrect: false,
                enableSuggestions: false,
                decoration: corocInput(
                  context,
                  label: '${l.fieldTempPassword} *',
                  helper: l.fieldTempPasswordHelp,
                  error: _error?.fieldMessage('password'),
                  suffix: Row(mainAxisSize: MainAxisSize.min, children: [
                    IconButton(tooltip: l.actionGenerate, onPressed: () => setState(() => _password.text = generatePassword()), icon: const Icon(Icons.autorenew)),
                    IconButton(
                      tooltip: l.actionCopy,
                      onPressed: () {
                        Clipboard.setData(ClipboardData(text: _password.text));
                        _toast(context, l.copied);
                      },
                      icon: const Icon(Icons.copy),
                    ),
                  ]),
                ),
                validator: (v) => (v ?? '').length < 12 ? l.passwordTooShort : null,
              ),
              if (_error != null) ...[gap, Text(errorText(context, _error!), style: TextStyle(color: Theme.of(context).colorScheme.error))],
            ]),
          ),
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text(l.actionCancel)),
        GoldButton(label: l.userCreate, onPressed: _save, busy: _busy),
      ],
    );
  }
}

// ─────────────────────────────── Topes de tasa ───────────────────────────────

class _RateCapsSection extends ConsumerWidget {
  const _RateCapsSection({required this.canManage, required this.country});
  final bool canManage;
  final String country;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final caps = ref.watch(rateCapsProvider);
    final today = Dates.isoToday();
    return SectionCard(
      title: l.settingsRateCaps,
      trailing: canManage
          ? TextButton.icon(
              onPressed: () => showDialog<void>(context: context, builder: (_) => _RateCapDialog(country: country)),
              icon: const Icon(Icons.add, size: 18),
              label: Text(l.rateCapAdd),
            )
          : null,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(country == 'CO' ? l.rateCapsHelpCO : l.rateCapsHelp, style: Theme.of(context).textTheme.bodySmall),
        const SizedBox(height: CorocSpace.sm),
        AsyncBody<List<RateCap>>(
          value: caps,
          onRetry: () => ref.invalidate(rateCapsProvider),
          builder: (list) {
            if (list.isEmpty) return Padding(padding: const EdgeInsets.symmetric(vertical: CorocSpace.md), child: StatusDot(label: l.rateCapsEmpty, tone: country == 'CO' ? StatusTone.warn : StatusTone.neutral));
            final sorted = [...list]..sort((a, b) => b.validFrom.compareTo(a.validFrom));
            return Column(children: [
              for (final c in sorted)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.gavel_outlined),
                  title: Text(percent(c.effectiveAnnual, context.lang)),
                  subtitle: Text('${Dates.medium(c.validFrom, context.lang)} – ${Dates.medium(c.validTo, context.lang)} · ${c.source}'),
                  trailing: c.validFrom.compareTo(today) <= 0 && c.validTo.compareTo(today) >= 0 ? StatusDot(label: l.rateCapCurrent, tone: StatusTone.ok) : null,
                ),
            ]);
          },
        ),
      ]),
    );
  }
}

class _RateCapDialog extends ConsumerStatefulWidget {
  const _RateCapDialog({required this.country});
  final String country;
  @override
  ConsumerState<_RateCapDialog> createState() => _RateCapDialogState();
}

class _RateCapDialogState extends ConsumerState<_RateCapDialog> {
  final _rate = TextEditingController();
  final _source = TextEditingController();
  late DateTime _from;
  late DateTime _to;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    // En Colombia la tasa de usura se certifica por mes: por defecto, el mes en curso.
    final now = DateTime.now();
    _from = DateTime(now.year, now.month, 1);
    _to = DateTime(now.year, now.month + 1, 0);
  }

  @override
  void dispose() {
    _rate.dispose();
    _source.dispose();
    super.dispose();
  }

  Future<void> _pick(bool from) async {
    final d = await showDatePicker(context: context, initialDate: from ? _from : _to, firstDate: DateTime(2020), lastDate: DateTime(DateTime.now().year + 2));
    if (d == null) return;
    setState(() {
      if (from) {
        _from = d;
      } else {
        _to = d;
      }
    });
  }

  Future<void> _save() async {
    final l = context.l10n;
    final rate = percentToRate(_rate.text);
    final value = rate == null ? null : double.tryParse(rate);
    if (value == null || value <= 0 || _source.text.trim().isEmpty || _to.isBefore(_from)) {
      setState(() => _error = l.rateCapInvalid);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final container = ProviderScope.containerOf(context, listen: false);
    try {
      await container.read(apiProvider).addRateCap(country: widget.country, effectiveAnnual: value, validFrom: Dates.iso(_from), validTo: Dates.iso(_to), source: _source.text.trim());
      container.invalidate(rateCapsProvider);
      if (!mounted) return;
      Navigator.pop(context);
      _toast(context, l.saved);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = errorText(context, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    const gap = SizedBox(height: CorocSpace.md);
    return AlertDialog(
      title: Text(l.rateCapAdd),
      content: SizedBox(
        width: 440,
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('${l.companyCountry}: ${countryName(l, widget.country)}', style: Theme.of(context).textTheme.bodySmall),
          gap,
          TextField(
            controller: _rate,
            autofocus: true,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: corocInput(context, label: '${l.rateCapRate} *', suffix: const Padding(padding: EdgeInsets.all(14), child: Text('%'))),
          ),
          gap,
          Wrap(spacing: CorocSpace.sm, runSpacing: CorocSpace.sm, children: [
            OutlinedButton.icon(onPressed: () => _pick(true), icon: const Icon(Icons.event), label: Text('${l.rateCapValidFrom}: ${Dates.medium(Dates.iso(_from), context.lang)}')),
            OutlinedButton.icon(onPressed: () => _pick(false), icon: const Icon(Icons.event_busy), label: Text('${l.rateCapValidTo}: ${Dates.medium(Dates.iso(_to), context.lang)}')),
          ]),
          gap,
          TextField(controller: _source, decoration: corocInput(context, label: '${l.rateCapSource} *', helper: l.rateCapSourceHelp)),
          if (_error != null) ...[gap, Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))],
        ]),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text(l.actionCancel)),
        GoldButton(label: l.actionSave, onPressed: _save, busy: _busy),
      ],
    );
  }
}

// ─────────────────────────────── Acerca de ───────────────────────────────

class _About extends StatelessWidget {
  const _About({required this.company});
  final CompanyBrief company;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return SectionCard(
      title: l.settingsAbout,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const Align(alignment: Alignment.centerLeft, child: CorocLogo(layout: LogoLayout.horizontal, height: 40)),
        const SizedBox(height: CorocSpace.md),
        KeyValue(l.aboutVersion, AppConfig.appVersion),
        KeyValue(l.companyCode, company.slug),
        const SizedBox(height: CorocSpace.sm),
        Text(l.aboutPrivacy, style: Theme.of(context).textTheme.bodySmall),
      ]),
    );
  }
}
