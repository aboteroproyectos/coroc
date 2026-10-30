import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'app.dart';
import 'core/config.dart';
import 'core/desktop/desktop_runtime.dart';
import 'personal/app.dart';

Future<void> main(List<String> args) async {
  WidgetsFlutterBinding.ensureInitialized();
  // Formatos de fecha de los tres idiomas disponibles sin conexión (intl no trae es_CO: se usa «es»).
  await Future.wait([initializeDateFormatting('es'), initializeDateFormatting('pt_BR'), initializeDateFormatting('en_US')]);
  // COROC Escritorio abierto al iniciar Windows (`--minimizado`): queda trabajando en la bandeja. En Escritorio corre el
  // nuevo COROC para una sola persona (Fase 11); en la web y el celular, COROC para equipos.
  runApp(ProviderScope(overrides: [launchMinimizedProvider.overrideWithValue(args.contains('--minimizado'))], child: AppConfig.desktop ? const PersonalApp() : const CorocApp()));
}
