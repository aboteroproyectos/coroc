# COROC · App (Flutter)

App nativa de COROC para Android, iOS, Windows y macOS. Consume la API de `services/api` y no guarda datos de clientes en el equipo (ADR-023).

## Preparar y ejecutar

```bash
flutter create --platforms=android,ios,macos,windows --org co.coroc --project-name coroc .
rm -f test/widget_test.dart
python3 tool/patch_platforms.py                          # ajustes de COROC en las carpetas nativas (ADR-029)
flutter pub get
dart run build_runner build --delete-conflicting-outputs # modelos (freezed + json_serializable)
flutter gen-l10n                                         # textos es / pt / en desde lib/l10n/*.arb
dart run flutter_launcher_icons                          # íconos desde el isotipo

flutter run --dart-define=COROC_API=http://10.0.2.2:3000/v1   # emulador Android contra la API local
flutter test
python3 tool/l10n_keys.py --check                        # cada texto usado existe en los 3 idiomas con sus marcadores
```

## Estructura

```
lib/
├── core/        API (cliente HTTP, errores RFC 9457, eventos en vivo), sesión, modelos, formatos, idioma y tema
├── design/      Sistema de diseño: colores, espacios, temas Marfil y Medianoche, logo, botón dorado, componentes
├── features/    auth · shell · dashboard · today · clients · new_client · loans · settings · help
└── l10n/        app_es.arb (plantilla), app_pt.arb, app_en.arb
test/            Pantallas contra respuestas reales de la API (fixtures/api.json, fake_api.dart, app_harness.dart), formatos, cliente HTTP, CA-14, accesibilidad y contrato
tool/            patch_platforms.py, l10n_keys.py, coverage_imports.py y coverage_report.sh (cobertura sin código generado)
```

## Convenciones

- Montos en unidades mínimas (`int`). Tasas como texto decimal exacto. Fechas civiles como `AAAA-MM-DD` (ADR-001).
- Todo texto visible sale de los ARB, y un texto nuevo se agrega en los tres idiomas. `app_es.arb` lleva la descripción y los marcadores.
- Estado con Riverpod, sin generación de código. Navegación con go_router; el acceso a cada pantalla depende de los permisos del rol.
- Colores y tamaños solo desde `design/tokens.dart`.
