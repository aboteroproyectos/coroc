import 'package:flutter/widgets.dart';

import '../l10n/gen/app_localizations.dart';

export '../l10n/gen/app_localizations.dart';

extension L10nContext on BuildContext {
  AppLocalizations get l10n => AppLocalizations.of(this);

  /// Código de idioma de la interfaz: es, pt o en.
  String get lang => Localizations.localeOf(this).languageCode;
}
