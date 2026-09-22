# COROC · Personal Loans

Plataforma de gestión y cobro de préstamos personales para Android, iOS, Windows y macOS.
Esta entrega corresponde a la **Fase 0** del prompt maestro: los artefactos de §24.1 para aprobación, más el núcleo de negocio ya programado y probado y una app funcional para validar los flujos reales.

## Qué contiene

| §24.1 | Artefacto | Dónde |
|---|---|---|
| 1 | Documento de arquitectura: componentes, flujos, versiones de APIs externas | [`docs/01_ARQUITECTURA.md`](docs/01_ARQUITECTURA.md) |
| 1 | Decisiones en formato ADR (ADR-001 a ADR-020) | [`docs/DECISIONES.md`](docs/DECISIONES.md) y módulo Ayuda de la app |
| 2 | Modelo entidad-relación con índices y políticas RLS | [`services/api/db/schema.sql`](services/api/db/schema.sql) · resumen en §4 de la arquitectura |
| 3 | Contrato OpenAPI 3.1 (59 operaciones) | [`services/api/openapi.yaml`](services/api/openapi.yaml) |
| 4 | Mapa de pantallas con wireframes | [`docs/02_MAPA_DE_PANTALLAS.md`](docs/02_MAPA_DE_PANTALLAS.md) · capturas en `docs/pantallas` · app navegable en `apps/prototype/dist/COROC.html` |
| 5 | Supuestos y preguntas abiertas que bloquean | [`docs/03_SUPUESTOS_Y_PREGUNTAS.md`](docs/03_SUPUESTOS_Y_PREGUNTAS.md) |
| — | Prompt maestro (especificación de referencia) | [`docs/00_PROMPT_MAESTRO.md`](docs/00_PROMPT_MAESTRO.md) |
| — | Estado de los criterios de aceptación CA-01 a CA-20 | [`docs/04_CRITERIOS_DE_ACEPTACION.md`](docs/04_CRITERIOS_DE_ACEPTACION.md) |
| — | Logo vectorizado: 11 variantes SVG, íconos Android, iOS, `.ico` y `.icns` | `brand/` |
| — | PDF de muestra: recibo es/en, anulado, plan, estado de cuenta, paz y salvo, informe | `docs/muestras/` |

## Estructura

```
coroc/
├── apps/prototype/     App COROC en un solo archivo HTML (dist/COROC.html) + fuentes y verificaciones
├── services/api/       openapi.yaml · db/schema.sql · db/test (PostgreSQL 16 con RLS)
├── packages/core/      @coroc/core: dinero, calendario, amortización, pagos, tasas, Ley 2300, identificación, lectura, recibo
├── brand/              Logo vectorizado, variantes e íconos de app
└── docs/               Arquitectura, decisiones, pantallas, supuestos, criterios, muestras
```

La app Flutter (`apps/coroc_app`), la API NestJS e `infra/` se crean en la Fase 1, una vez aprobada la Fase 0.

## Usar la app COROC

1. Abra `apps/prototype/dist/COROC.html` en Chrome o Edge de escritorio. También funciona en Safari y Firefox, sin la carpeta COROC directa; en ellos la carpeta se descarga como ZIP.
2. Cree la empresa y el usuario Propietario. Marque «Cargar datos de demostración» si quiere recorrerla con 12 clientes de ejemplo.
3. El asistente pide permiso para crear la carpeta COROC; elija, por ejemplo, `Documentos`.

Los datos se guardan en el navegador de ese equipo (IndexedDB). Cree respaldos `.coroc` desde Configuración o desde el botón del menú. La lectura de imágenes descarga Tesseract.js la primera vez, así que necesita internet en ese momento.

## Verificar

```bash
cd packages/core && npm ci && npx vitest run --coverage          # 41 pruebas (CA-01 a CA-12)
cd services/api/db/test && npm install && node rls-test.mjs      # 18 pruebas en PostgreSQL 16 (CA-17); no como root
cd apps/prototype && npm ci && npm i -D playwright
node tools/build.mjs && node tools/e2e.mjs && node tools/verify.mjs && node tools/verify-ocr.mjs && node tools/samples.mjs
```

## Siguiente paso

Aprobar la Fase 0 y responder las preguntas P-1 y P-2, que bloquean el arranque de la Fase 1: núcleo en Flutter y NestJS sobre este mismo modelo, contrato y núcleo probado.
