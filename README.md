# COROC · Personal Loans

Plataforma de gestión y cobro de préstamos personales para Android, iOS, Windows y macOS.

**Estado:** Fase 5 «Endurecimiento y publicación» terminada en la rama `fase-5` (notas en [`docs/10_FASE_5_NOTAS_DE_VERSION.md`](docs/10_FASE_5_NOTAS_DE_VERSION.md)). Las fases 0 a 4 están en `main`. La publicación en las tiendas espera las cuentas y los certificados (P-2).

## Estructura (§24.2)

```
coroc/
├── apps/coroc_app/     App Flutter para Android, iOS, Windows y macOS (fases 1 a 5)
│   ├── packages/coroc_bookmarks/  Plugin de marcadores de seguridad de macOS para la carpeta COROC
│   └── packages/coroc_share/      Plugin «Compartir con COROC» (Android e iOS)
├── apps/prototype/     App COROC en un solo archivo HTML (Fase 0): valida los flujos de las fases 2 a 4
├── services/api/       API NestJS 12 · PostgreSQL 16 con RLS · PDF con Chromium · archivos cifrados · OCR con Tesseract · contrato OpenAPI 3.1 (110 operaciones) · pruebas de aceptación, penetración y rendimiento
├── packages/core/      @coroc/core: dinero, calendario, amortización, pagos, tasas, Ley 2300, identificación, lectura, recibo, carpeta COROC
├── infra/              Docker Compose (PostgreSQL, Redis, migraciones, API, HTTPS con Caddy)
├── brand/              Logo vectorizado, variantes e íconos de app
├── docs/               Arquitectura, decisiones (ADR-001 a ADR-059), pantallas, supuestos, criterios, notas de versión, despliegue, fichas de tienda
├── .zap/               Reglas de OWASP ZAP para el escaneo dinámico en CI
└── .github/            CI (pruebas, rendimiento, seguridad y compilación de las 4 apps) y publicación firmada
```

## Documentos

| Documento | Contenido |
|---|---|
| [`docs/10_FASE_5_NOTAS_DE_VERSION.md`](docs/10_FASE_5_NOTAS_DE_VERSION.md) | Qué trae la Fase 5: rendimiento con 100.000 clientes, seguridad (penetración, dependencias, ZAP), soporte y trazas, modo sin conexión, accesibilidad, eliminación de cuenta, privacidad, fichas y publicación |
| [`docs/11_FICHAS_DE_TIENDA.md`](docs/11_FICHAS_DE_TIENDA.md) | Fichas de Google Play, App Store y Microsoft Store en 3 idiomas y declaraciones de privacidad |
| [`docs/09_FASE_4_NOTAS_DE_VERSION.md`](docs/09_FASE_4_NOTAS_DE_VERSION.md) | Qué trae la Fase 4: mensajes automáticos, plantillas, correo saliente, WhatsApp asistido y Cloud API, reglas de contacto |
| [`docs/08_FASE_3_NOTAS_DE_VERSION.md`](docs/08_FASE_3_NOTAS_DE_VERSION.md) | Qué trae la Fase 3: recepción por WhatsApp, correo, portal, compartir y carpeta; lectura con OCR; Bandeja |
| [`docs/07_FASE_2_NOTAS_DE_VERSION.md`](docs/07_FASE_2_NOTAS_DE_VERSION.md) | Qué trae la Fase 2: documentos, PDF, carpeta COROC, informes y respaldo |
| [`docs/05_FASE_1_NOTAS_DE_VERSION.md`](docs/05_FASE_1_NOTAS_DE_VERSION.md) | Qué trae la Fase 1, seguridad y límites conocidos |
| [`docs/06_EJECUCION_Y_DESPLIEGUE.md`](docs/06_EJECUCION_Y_DESPLIEGUE.md) | Ejecución local, Docker, app Flutter, CI y producción |
| [`docs/04_CRITERIOS_DE_ACEPTACION.md`](docs/04_CRITERIOS_DE_ACEPTACION.md) | Estado de CA-01 a CA-20 con su evidencia |
| [`docs/DECISIONES.md`](docs/DECISIONES.md) | Decisiones de arquitectura (ADR) |
| [`docs/03_SUPUESTOS_Y_PREGUNTAS.md`](docs/03_SUPUESTOS_Y_PREGUNTAS.md) | Preguntas abiertas P-1 a P-9 y supuestos |
| [`docs/01_ARQUITECTURA.md`](docs/01_ARQUITECTURA.md) · [`docs/02_MAPA_DE_PANTALLAS.md`](docs/02_MAPA_DE_PANTALLAS.md) | Arquitectura y mapa de pantallas (Fase 0) |
| [`docs/00_PROMPT_MAESTRO.md`](docs/00_PROMPT_MAESTRO.md) | Especificación de referencia |

## Verificar

```bash
npm ci && npm run build
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres npm test   # núcleo (64) y API (105, más 5 de rendimiento con PERF=1); necesitan Chromium y Tesseract, ver docs/06
(cd services/api && PERF=1 TEST_DATABASE_URL=... npx vitest run test/perf.test.ts)  # 100.000 clientes
npm run lint:i18n
cd apps/coroc_app && flutter test                                                 # ver apps/coroc_app/README.md
```

## Usar la app HTML de la Fase 0

1. Abra `apps/prototype/dist/COROC.html` en Chrome o Edge de escritorio. También funciona en Safari y Firefox, pero sin la carpeta COROC directa; en ellos la carpeta se descarga como ZIP.
2. Cree la empresa y el usuario Propietario. Marque «Cargar datos de demostración» si quiere recorrerla con 12 clientes de ejemplo.
3. Los datos quedan en el navegador de ese equipo. Cree respaldos `.coroc` desde Configuración.

## Siguiente paso

- Todas las fases de §23 están implementadas. Para salir a producción faltan decisiones y cuentas:
  - P-1: nube y dominio;
  - P-2: cuentas de tiendas y certificados;
  - P-5: revisión legal de la política y de las fichas;
  - P-8: prueba de penetración externa;
  - P-9: pruebas en dispositivos y con lectores de pantalla.
- También siguen abiertas P-4 (modo automático de WhatsApp) y P-7 (correo por Gmail u Outlook). P-6 quedó resuelta: el Propietario puede permitir tasas por encima del tope (ADR-061).
