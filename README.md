# COROC · Personal Loans

Plataforma de gestión y cobro de préstamos personales para Android, iOS, Windows y macOS, y **COROC Escritorio para Windows**: un solo instalador con todo dentro del PC, sin Docker, sin nube y sin costo mensual.

**Estado:** Fase 10 «COROC Escritorio para Windows» terminada en la rama `fase-10` (notas en [`docs/12_FASE_10_NOTAS_DE_VERSION.md`](docs/12_FASE_10_NOTAS_DE_VERSION.md)). Las fases 0 a 9 están en `main`. La publicación en las tiendas y la firma del instalador esperan las cuentas y los certificados (P-2).

## Instalar COROC en un PC con Windows

1. En [Releases](https://github.com/aboteroproyectos/coroc/releases), abra la más reciente que se llame **COROC Escritorio para Windows** y descargue **COROC-Escritorio-Windows.exe**.
2. Ábralo con doble clic. Si Windows dice «Windows protegió su PC», toque **Más información › Ejecutar de todas formas**.
3. Siga los 5 pasos del asistente. La guía completa, con capturas, está en [`docs/GUIA_ESCRITORIO.md`](docs/GUIA_ESCRITORIO.md).

## Estructura (§24.2)

```
coroc/
├── apps/coroc_app/     App Flutter para Android, iOS, Windows y macOS, y modo Escritorio para Windows (Fase 10)
│   ├── packages/coroc_bookmarks/  Plugin de marcadores de seguridad de macOS para la carpeta COROC
│   └── packages/coroc_share/      Plugin «Compartir con COROC» (Android e iOS)
├── apps/prototype/     App COROC en un solo archivo HTML (Fase 0): valida los flujos de las fases 2 a 4
├── services/api/       API NestJS 12 · PostgreSQL 16 con RLS · PDF con Chromium · archivos cifrados · OCR con Tesseract · Gmail · contrato OpenAPI 3.1 (124 operaciones) · supervisor de COROC Escritorio · pruebas de aceptación, penetración y rendimiento
├── packages/core/      @coroc/core: dinero, calendario, amortización, pagos, tasas, Ley 2300, identificación, lectura, recibo, carpeta COROC
├── infra/              Docker Compose (PostgreSQL, Redis, migraciones, API, HTTPS con Caddy) · escritorio/: instalador de COROC Escritorio (Inno Setup) y su prueba en Windows · pc/: paquete con Docker (solo soporte)
├── brand/              Logo vectorizado, variantes e íconos de app
├── docs/               Arquitectura, decisiones (ADR-001 a ADR-067), pantallas, supuestos, criterios, notas de versión, despliegue, fichas de tienda y guías
├── .zap/               Reglas de OWASP ZAP para el escaneo dinámico en CI
└── .github/            CI (pruebas, rendimiento, seguridad, compilación de las 4 apps e instalador de Escritorio probado en Windows) y publicación
```

## Documentos

| Documento | Contenido |
|---|---|
| [`docs/GUIA_ESCRITORIO.md`](docs/GUIA_ESCRITORIO.md) | **Empiece aquí.** Instalar y usar COROC Escritorio en un PC con Windows: un solo instalador, sin Docker ni nube, con capturas |
| [`docs/GUIA_PUESTA_EN_MARCHA.md`](docs/GUIA_PUESTA_EN_MARCHA.md) | Poner COROC en la nube (Fly.io y Cloudflare) desde el navegador |
| [`docs/12_FASE_10_NOTAS_DE_VERSION.md`](docs/12_FASE_10_NOTAS_DE_VERSION.md) | Qué trae la Fase 10: COROC Escritorio, asistente de 5 pantallas, «Mensajes de hoy» con WhatsApp para Windows, comprobantes sin menús, Gmail de la empresa y copia diaria |
| [`docs/10_FASE_5_NOTAS_DE_VERSION.md`](docs/10_FASE_5_NOTAS_DE_VERSION.md) | Qué trae la Fase 5: rendimiento con 100.000 clientes, seguridad (penetración, dependencias, ZAP), soporte y trazas, modo sin conexión, accesibilidad, eliminación de cuenta, privacidad, fichas y publicación |
| [`docs/11_FICHAS_DE_TIENDA.md`](docs/11_FICHAS_DE_TIENDA.md) | Fichas de Google Play, App Store y Microsoft Store en 3 idiomas y declaraciones de privacidad |
| [`docs/09_FASE_4_NOTAS_DE_VERSION.md`](docs/09_FASE_4_NOTAS_DE_VERSION.md) | Qué trae la Fase 4: mensajes automáticos, plantillas, correo saliente, WhatsApp asistido y Cloud API, reglas de contacto |
| [`docs/08_FASE_3_NOTAS_DE_VERSION.md`](docs/08_FASE_3_NOTAS_DE_VERSION.md) | Qué trae la Fase 3: recepción por WhatsApp, correo, portal, compartir y carpeta; lectura con OCR; Bandeja |
| [`docs/07_FASE_2_NOTAS_DE_VERSION.md`](docs/07_FASE_2_NOTAS_DE_VERSION.md) | Qué trae la Fase 2: documentos, PDF, carpeta COROC, informes y respaldo |
| [`docs/05_FASE_1_NOTAS_DE_VERSION.md`](docs/05_FASE_1_NOTAS_DE_VERSION.md) | Qué trae la Fase 1, seguridad y límites conocidos |
| [`docs/06_EJECUCION_Y_DESPLIEGUE.md`](docs/06_EJECUCION_Y_DESPLIEGUE.md) | Ejecución local, Docker, app Flutter, CI, producción y cómo se construye COROC Escritorio |
| [`docs/04_CRITERIOS_DE_ACEPTACION.md`](docs/04_CRITERIOS_DE_ACEPTACION.md) | Estado de CA-01 a CA-20 y de E-1 a E-7 con su evidencia |
| [`docs/GUIA_PC_WINDOWS.md`](docs/GUIA_PC_WINDOWS.md) | Paquete con Docker de la Fase 8 (solo soporte; para instalar use COROC Escritorio) |
| [`docs/DECISIONES.md`](docs/DECISIONES.md) | Decisiones de arquitectura (ADR) |
| [`docs/03_SUPUESTOS_Y_PREGUNTAS.md`](docs/03_SUPUESTOS_Y_PREGUNTAS.md) | Preguntas abiertas y respondidas (P-1 a P-10) y supuestos |
| [`docs/01_ARQUITECTURA.md`](docs/01_ARQUITECTURA.md) · [`docs/02_MAPA_DE_PANTALLAS.md`](docs/02_MAPA_DE_PANTALLAS.md) | Arquitectura y mapa de pantallas (Fase 0) |
| [`docs/00_PROMPT_MAESTRO.md`](docs/00_PROMPT_MAESTRO.md) | Especificación de referencia |

## Verificar

```bash
npm ci && npm run build
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres npm test   # núcleo (69) y API (126, más 5 de rendimiento con PERF=1); necesitan Chromium y Tesseract, ver docs/06
(cd services/api && PERF=1 TEST_DATABASE_URL=... npx vitest run test/perf.test.ts)  # 100.000 clientes
npm run lint:i18n
cd apps/coroc_app && flutter test                                                 # 163 pruebas; ver apps/coroc_app/README.md
```

## Usar la app HTML de la Fase 0

1. Abra `apps/prototype/dist/COROC.html` en Chrome o Edge de escritorio. También funciona en Safari y Firefox, pero sin la carpeta COROC directa; en ellos la carpeta se descarga como ZIP.
2. Cree la empresa y el usuario Propietario. Marque «Cargar datos de demostración» si quiere recorrerla con 12 clientes de ejemplo.
3. Los datos quedan en el navegador de ese equipo. Cree respaldos `.coroc` desde Configuración.

## Siguiente paso

- **COROC Escritorio** queda listo para usarse en un PC: se publica en Releases cuando la rama llega a `main`. Falta probarlo en un PC con Windows 10 y otro con Windows 11 de escritorio, con WhatsApp para Windows (P-9).
- Todas las fases de §23 están implementadas. Para salir a producción en la nube faltan decisiones y cuentas:
  - P-1 resuelta: Fly.io en São Paulo con Fly Postgres y Cloudflare R2 (ADR-060). Falta crear las cuentas y seguir la preparación de 06 §6. El dominio queda pendiente (P-10);
  - P-2: cuentas de tiendas y certificados, también el de firma de código para el instalador de Escritorio;
  - P-3: comprobantes reales de Colombia para medir CA-19 con ellos;
  - P-5: revisión legal de la política y de las fichas;
  - P-8: prueba de penetración externa;
  - P-9: pruebas en dispositivos y con lectores de pantalla.
- Resueltas el 24 de octubre de 2026: P-4 (WhatsApp en modo asistido, ADR-064) y P-7 (Gmail de la empresa con contraseña de aplicación, ADR-065). P-6 quedó resuelta antes: el Propietario puede permitir tasas por encima del tope (ADR-061).
