# COROC · Personal Loans

Plataforma de gestión y cobro de préstamos personales para Android, iOS, Windows y macOS.

**Estado:** Fase 2 «Documentos» terminada en la rama `fase-2` (notas en [`docs/07_FASE_2_NOTAS_DE_VERSION.md`](docs/07_FASE_2_NOTAS_DE_VERSION.md)). Las fases 0 y 1 están en `main` (notas de la Fase 1 en [`docs/05_FASE_1_NOTAS_DE_VERSION.md`](docs/05_FASE_1_NOTAS_DE_VERSION.md)).

## Estructura (§24.2)

```
coroc/
├── apps/coroc_app/     App Flutter para Android, iOS, Windows y macOS (fases 1 y 2)
│   └── packages/coroc_bookmarks/  Plugin de marcadores de seguridad de macOS para la carpeta COROC
├── apps/prototype/     App COROC en un solo archivo HTML (Fase 0): valida los flujos de las fases 2 a 4
├── services/api/       API NestJS 12 · PostgreSQL 16 con RLS · PDF con Chromium · archivos cifrados · contrato OpenAPI 3.1 (80 operaciones) · pruebas de aceptación
├── packages/core/      @coroc/core: dinero, calendario, amortización, pagos, tasas, Ley 2300, identificación, lectura, recibo, carpeta COROC
├── infra/              Docker Compose (PostgreSQL, Redis, migraciones, API, HTTPS con Caddy)
├── brand/              Logo vectorizado, variantes e íconos de app
├── docs/               Arquitectura, decisiones (ADR-001 a ADR-036), pantallas, supuestos, criterios, notas de versión, despliegue
└── .github/            Integración continua: pruebas y compilación de las 4 apps
```

## Documentos

| Documento | Contenido |
|---|---|
| [`docs/07_FASE_2_NOTAS_DE_VERSION.md`](docs/07_FASE_2_NOTAS_DE_VERSION.md) | Qué trae la Fase 2: documentos, PDF, carpeta COROC, informes y respaldo |
| [`docs/05_FASE_1_NOTAS_DE_VERSION.md`](docs/05_FASE_1_NOTAS_DE_VERSION.md) | Qué trae la Fase 1, seguridad y límites conocidos |
| [`docs/06_EJECUCION_Y_DESPLIEGUE.md`](docs/06_EJECUCION_Y_DESPLIEGUE.md) | Ejecución local, Docker, app Flutter, CI y producción |
| [`docs/04_CRITERIOS_DE_ACEPTACION.md`](docs/04_CRITERIOS_DE_ACEPTACION.md) | Estado de CA-01 a CA-20 con su evidencia |
| [`docs/DECISIONES.md`](docs/DECISIONES.md) | Decisiones de arquitectura (ADR) |
| [`docs/03_SUPUESTOS_Y_PREGUNTAS.md`](docs/03_SUPUESTOS_Y_PREGUNTAS.md) | Preguntas abiertas P-1 a P-6 y supuestos |
| [`docs/01_ARQUITECTURA.md`](docs/01_ARQUITECTURA.md) · [`docs/02_MAPA_DE_PANTALLAS.md`](docs/02_MAPA_DE_PANTALLAS.md) | Arquitectura y mapa de pantallas (Fase 0) |
| [`docs/00_PROMPT_MAESTRO.md`](docs/00_PROMPT_MAESTRO.md) | Especificación de referencia |

## Verificar

```bash
npm ci && npm run build
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres npm test   # núcleo (50) y API (59); los PDF necesitan Chromium, ver docs/06
npm run lint:i18n
cd apps/coroc_app && flutter test                                                 # ver apps/coroc_app/README.md
```

## Usar la app HTML de la Fase 0

1. Abra `apps/prototype/dist/COROC.html` en Chrome o Edge de escritorio. También funciona en Safari y Firefox, pero sin la carpeta COROC directa; en ellos la carpeta se descarga como ZIP.
2. Cree la empresa y el usuario Propietario. Marque «Cargar datos de demostración» si quiere recorrerla con 12 clientes de ejemplo.
3. Los datos quedan en el navegador de ese equipo. Cree respaldos `.coroc` desde Configuración.

## Siguiente paso

- Fase 3 (§23): lectura de comprobantes y portal del deudor.
- Responder P-1 (nube y dominio), P-2 (cuentas de tiendas) y P-6 (tasas de los préstamos diarios frente a la usura).
- Fase 2 «Documentos»: repositorio, carpeta COROC en las 4 plataformas, PDF, respaldo y restauración, e informes.
