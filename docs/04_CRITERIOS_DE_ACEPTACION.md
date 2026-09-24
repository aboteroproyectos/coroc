# COROC · Estado de los criterios de aceptación (§22)

Corte: 23 de septiembre de 2026 · Fase 5.

## Fase 5: endurecimiento y publicación (§21, §23)

Las veinte CA siguen en verde en cada cambio. Las comprueban:
- el núcleo (64 pruebas);
- la API con PostgreSQL 16 real (105 pruebas, más 5 de rendimiento);
- la app (45 pruebas).

La Fase 5 agrega §21, verificado así:

| Requisito de §21 | Estado | Evidencia |
|---|---|---|
| Dashboard < 1,5 s con 50.000 clientes | ✅ 196 ms con **100.000** clientes y 2.000.000 de cuotas; p95 de 538 ms con 10 a la vez | `perf.test.ts` (trabajo «Rendimiento» en CI, informe como artefacto) |
| Búsqueda de clientes < 300 ms | ✅ 23–69 ms; p95 de 192 ms con 10 a la vez (ADR-051) | `perf.test.ts` |
| Comprobante → pago < 60 s (p95, camino automático) | ✅ p95 de 4,4 s con 20 comprobantes a la vez por el portal, con OCR real | `intake.test.ts` · «§21: 20 comprobantes a la vez» |
| Carga mixta sin errores | ✅ 300 peticiones, 25 a la vez, cero errores; p95 < 3 s con servidor y cliente en un solo proceso | `perf.test.ts` |
| Colas con reintentos y cola de fallidos visible para soporte | ✅ Reintentos exponenciales (Fases 2 a 4); `GET /support/failures`, reintento y Configuración › Soporte (ADR-054) | `intake.test.ts` · «soporte»; `support_test.dart` |
| Traza por documento hasta el recibo enviado | ✅ `GET /intake/{id}/trace` con las siete etapas y el tiempo al pago | `intake.test.ts` · «soporte» |
| Offline: consulta en caché, operaciones en cola, conflictos documentados | ✅ Lecturas y documentos cifrados; pagos en cola idempotente; conflictos con motivo (ADR-055) | `offline_test.dart` |
| WCAG 2.2 AA, texto al 200 %, objetivos ≥ 44 pt | ✅ Contraste, áreas táctiles de 48 px (Android) y 44 pt (iOS) y etiquetas en claro y oscuro; 200 % sin desbordes | `accessibility_test.dart`, `support_test.dart` |
| Lectores de pantalla (TalkBack, VoiceOver, Narrador) | ⚠️ Etiquetas, encabezados y región viva verificados con el árbol de semántica; falta la prueba manual en dispositivos | — |
| Análisis estático sin advertencias | ✅ `flutter analyze`, `tsc` estricto, Redocly y lint de textos | CI |
| Cobertura ≥ 90 % en motor financiero, cumplimiento y extracción | ✅ 97,4 % de líneas en `@coroc/core` (umbral 90 % en CI) | `packages/core/vitest.config.ts` |
| Cobertura ≥ 75 % global | ⚠️ API 88 % y núcleo 97 %; la app llega a 26 % (sin código generado). En CI hay un piso para que no baje | `services/api/vitest.config.ts`, trabajo «App · análisis y pruebas» |
| Seguridad (ASVS L2) | ✅ Suite de penetración sobre el contrato, `npm audit` sin hallazgos y ZAP sin hallazgos de inyección, XSS ni SSRF (118 reglas en PASS). ⚠️ Falta la prueba de un tercero | `security.test.ts`, trabajo «Seguridad · dependencias y DAST» |
| Disponibilidad del backend 99,9 % | ⏳ Depende del despliegue (P-1). La API es sin estado, con salud en `/health` e id de petición | `06_EJECUCION_Y_DESPLIEGUE.md` |
| Arranque en frío < 2,5 s y listas a 60 fps | ⏳ Listas virtualizadas desde la Fase 1; la medición en un teléfono de gama media queda para la prueba en dispositivos | — |

§20.4, tiendas:
- Política de privacidad pública en tres idiomas (ADR-058).
- Eliminación de cuenta desde la app (ADR-056), verificada en `account.test.ts`.
- Fichas y declaraciones (`11_FICHAS_DE_TIENDA.md`).
- Firma y publicación en CI (ADR-059), que esperan las cuentas y los certificados (P-2).

## Fase 4: cierre por el servidor

La Fase 4 se cierra con CA-10, CA-11 y CA-20 (§23). Los tres se verificaron por la API real: PostgreSQL 16 con RLS, el motor de reglas en la hora local del deudor (America/Bogota), el despachador de mensajes, el correo saliente en memoria y la Cloud API de WhatsApp con un Graph API de prueba que responde como Meta, incluido el error 131031 de cuenta bloqueada.

| ID | Resultado por la API | Prueba |
|---|---|---|
| CA-10 | ✅ Un recordatorio de cobranza pedido el domingo 11-oct-2026 a las 10:00 queda programado para el martes 13-oct-2026 a las 07:00 (12:00 UTC), con los motivos «fuera de franja» y «festivo 12-oct». El despachador no lo envía antes de esa hora | `services/api/test/messaging.test.ts` · «CA-10» |
| CA-11 | ✅ El martes, después de que salió el recordatorio, un segundo mensaje de cobranza al mismo deudor queda bloqueado con la regla `MAX_PER_DAY` (13-oct-2026) y aparece en «Bloqueados». La simulación del motor da lo mismo para un correo: el cupo del día es por deudor, no por canal | «CA-11» |
| CA-20 | ✅ Con la Cloud API activa, el mensaje sale con la plantilla aprobada y registra entregado y leído. Si Meta responde 131031 (cuenta bloqueada), la empresa pasa sola al modo asistido: solo ese intento llega a Meta, los mensajes en cola quedan en «Por enviar hoy» con el enlace de WhatsApp listo, ninguno se pierde ni falla, y el propietario recibe el aviso por correo. Un `account_update` de suspensión por webhook produce lo mismo | «CA-20» (dos pruebas) |

Otras verificaciones de la Fase 4:
- bienvenida con el plan de pagos en PDF adjunto al correo, logo incrustado y baja con un clic; WhatsApp en «Por enviar hoy» con el enlace de carga;
- modo asistido: «Enviar» vuelve a aplicar las reglas y fuera de franja no se envía;
- recibo con enlace seguro de descarga que abre el PDF;
- plantillas: el validador bloquea amenazas; la vista previa usa los datos reales del préstamo;
- programador: recordatorio a la hora configurada sin duplicados y aviso de cuota vencida;
- exclusión con «Salir» por WhatsApp y baja del correo con un clic desde el enlace;
- rebote duro: la dirección queda inválida en la ficha y el siguiente correo se bloquea;
- presets sin revisión legal, excepción horaria del deudor con evidencia y remitente propio con SPF, DKIM y DMARC.

## Fase 3: cierre por el servidor

La Fase 3 se cierra con CA-07, CA-08, CA-09 y CA-19 (§23). CA-07 a CA-09 se verificaron por la API real, con OCR real (Tesseract 5) sobre comprobantes generados como imagen y como PDF, PostgreSQL 16 con RLS y los canales reales: webhook de WhatsApp firmado con un Graph API de prueba, y correo entrante en formato Postmark.

| ID | Resultado por la API | Prueba |
|---|---|---|
| CA-07 | ✅ El comprobante llega por WhatsApp desde el número del cliente, se lee con OCR y se registra solo, con el recibo RC-000001. El mismo pago reenviado por correo, ahora en PDF (otro archivo, misma referencia, valor y fecha), queda DUPLICADO y no se registra otro pago. Un reintento del webhook con el mismo id de mensaje no se recibe dos veces | `services/api/test/intake.test.ts` · «CA-07» |
| CA-08 | ✅ Desde un número no registrado queda «Sin asignar», con el cliente sugerido por el nombre del pagador y el valor. Al aprobarlo asignando el cliente, el número se guarda como secundario y el siguiente comprobante desde ese número se identifica solo | «CA-08» |
| CA-09 | ✅ Si quien recibe no es una cuenta receptora de la empresa, no se aplica: queda en revisión con la alerta bloqueante `RECEIVER_MISMATCH` («El pago no se hizo a tus cuentas») | «CA-09» |
| CA-19 | ✅ Sobre un conjunto sintético: valor 100 %, fecha 100 %, nombres 97,7 % (84 de 86). Ningún campo errado llega con confianza de 0,95 o más, así que lo que no alcanza el umbral nunca se aplica solo. Falta repetir la medición con 40 o más comprobantes reales anonimizados (P-3) | `services/api/test/extraction.test.ts` |

El conjunto sintético de CA-19 (`services/api/test/receipts/dataset.ts`) tiene 43 comprobantes de 18 formatos:
- **Colombia:** Nequi, Daviplata, Bancolombia (app y QR), Bre-B, Davivienda, BBVA, Banco de Bogotá, PSE, Efecty, corresponsal y consignación en papel.
- **Brasil:** PIX y TED.
- **EE. UU.:** Zelle, Venmo, Cash App y transferencia bancaria.

Cada formato va como captura (PNG), como PDF con capa de texto y, en tres de ellos, como foto de papel girada y con ruido. En total se leen 26 con OCR y 17 por la capa de texto.

Otras verificaciones de la Fase 3:
- portal del deudor: el enlace identifica al remitente, registro automático, reversión con un toque dentro de 72 h, rotación y desactivación del enlace;
- modo «Aprobación previa» con aprobación en lote y corrección del valor;
- «No es comprobante» archivado en Otros documentos y encontrado por su texto;
- el Cobrador solo ve en la Bandeja lo de sus clientes;
- CA-13 también restaura la Bandeja.


## Fase 2: cierre por el servidor

La Fase 2 se cierra con CA-13, CA-15 y CA-18 (§23), verificados contra la API real con PostgreSQL 16, RLS forzada, archivos cifrados y PDF generados con Chromium. Las pruebas leen el texto de cada PDF generado.

| ID | Resultado por la API | Prueba |
|---|---|---|
| CA-13 | ✅ Respaldo `.coroc` generado por flujo y descargado en partes. Se rechazan la contraseña errada, un byte alterado y la confirmación con otro nombre, sin cambiar nada. Al restaurar en una empresa vacía quedan los mismos conteos, las mismas huellas SHA-256 de cada documento y los mismos saldos, y todos los documentos abren | `services/api/test/backup.test.ts` · «Respaldo y restauración (§19, CA-13)» |
| CA-15 | ✅ Al crear a «María José Pérez Gómez» queda `Maria Jose Perez Gomez - C…/CT-…/` con las 5 subcarpetas, el `.coroc-id` y el PDF del contrato y plan de pagos. En la app, la sincronización lo copia a la carpeta del dispositivo | `services/api/test/documents.test.ts` y `apps/coroc_app/test/folder_sync_test.dart` |
| CA-18 | ✅ El reverso emite la versión ANULADO del recibo, la carpeta reemplaza el archivo, y el saldo y el dashboard vuelven al valor anterior. El QR del recibo lo muestra anulado | `documents.test.ts` · «CA-18 con PDF» y `acceptance.test.ts` |

Otras verificaciones de la Fase 2: CA-05 con PDF (el recibo dice exactamente lo que registró el pago), descargas por rangos, enlaces alterados o vencidos rechazados, estado de cuenta y paz y salvo, carga manual por contenido, informes en PDF, XLSX y CSV, y cifrado en reposo con detección de alteraciones. En total hay 59 pruebas de la API.


## Fase 1: cierre por el servidor

La Fase 1 se cierra con CA-01 a CA-06, CA-12, CA-14, CA-16 y CA-17 (§23). Todos se verificaron de nuevo contra la API NestJS real, con PostgreSQL 16, RLS forzada y el usuario de la API sin `BYPASSRLS`. Las pruebas hacen peticiones HTTP y validan cada respuesta contra el contrato OpenAPI.

| ID | Resultado por la API | Prueba |
|---|---|---|
| CA-01 | ✅ Total $ 1.200.000 y cuota $ 60.000 | `services/api/test/acceptance.test.ts` · «Motor financiero por la API» |
| CA-02 | ✅ Seis cuotas de $ 164.286 y la séptima de $ 164.284 | ídem |
| CA-03 | ✅ Cuota $ 472.798; cuota 1 con interés $ 100.000 y capital $ 372.798; saldo final $ 0 | ídem |
| CA-04 | ✅ 9, 10, 13 y 14 de octubre de 2026 (salta el domingo y el festivo) | ídem |
| CA-05 | ✅ Cuota 1 pagada, 19 restantes, acumulado $ 60.000, saldo $ 1.140.000; el recibo trae los mismos datos | «Pagos, recibo, reverso y dashboard» (empresa sin tope, ADR-027) |
| CA-06 | ✅ Cuotas 2 y 3 completas, abono de $ 30.000 a la 4, 17 restantes, saldo $ 990.000 | ídem |
| CA-12 | ✅ No se guarda; responde `RATE_CAP_EXCEEDED` con la tasa máxima que cumple. Sin tasa de usura vigente, `RATE_CAP_MISSING` | «Tope legal, clientes y duplicados» |
| CA-14 | ✅ Servidor: los errores cambian de idioma con cada petición (`Accept-Language`). App: `test/widgets_test.dart` cambia es → pt → en en la pantalla de ingreso sin reiniciar. 377 textos en 3 idiomas, verificados por `tool/l10n_keys.py` | `acceptance.test.ts` y app Flutter (CI) |
| CA-16 | ✅ El Cobrador ve solo sus clientes; sobre uno ajeno recibe 403 «Acceso denegado» y queda `access.denied` en la bitácora. En la base, aunque la API se equivocara, RLS le oculta los ajenos (ADR-022) | «Roles y aislamiento» |
| CA-17 | ✅ La empresa B no puede leer, modificar ni pagar datos de la empresa A | ídem |
| CA-18 | ✅ Contramovimiento, recibo ANULADO, saldos y dashboard recalculados | «Pagos, recibo, reverso y dashboard» |

Otras verificaciones de la Fase 1:

| Verificación | Resultado |
|---|---|
| Núcleo `@coroc/core` | 46 de 46 pruebas, incluida la equivalencia del recálculo rápido con 500 préstamos |
| API: aceptación, ingreso y contrato | 33 de 33 pruebas (ingreso con segundo factor, bloqueo progresivo, rotación y reúso del token de renovación, recuperación de contraseña, contraseñas filtradas) |
| Rendimiento con 50.000 clientes (`PERF=1`) | Dashboard en 75 ms (§21: menos de 1,5 s); búsqueda de 55 a 137 ms (menos de 300 ms) |
| Contrato OpenAPI 3.1 | 70 operaciones; cada ruta del código existe en el contrato y viceversa; Redocly sin errores |
| Textos del servidor | 84 claves en es, pt-BR y en (`npm run lint:i18n`) |
| App Flutter | Pruebas de formato de dinero y tasas, cliente HTTP (renovación única del token, errores RFC 9457, eventos en vivo), CA-14 y diseño en teléfono en modo Medianoche. Se ejecutan en GitHub Actions junto con el análisis estático y la compilación para Android, Windows, macOS e iOS |

## Estado general (Fase 0, núcleo y app HTML)

| ID | Escenario | Estado | Evidencia |
|---|---|---|---|
| CA-01 | Interés simple $ 1.000.000 · 20 % · 20 cuotas diarias | ✅ Verde | `packages/core/test/acceptance.test.ts`: total $ 1.200.000, cuota $ 60.000 |
| CA-02 | Redondeo a 1 peso, 7 cuotas | ✅ Verde | Cuotas 1–6 de $ 164.286, cuota 7 de $ 164.284, suma $ 1.150.000 |
| CA-03 | Francés $ 5.000.000 · 2 % mensual · 12 cuotas | ✅ Verde | Cuota $ 472.798; cuota 1: interés $ 100.000 y capital $ 372.798; saldo final $ 0; total $ 5.673.576 |
| CA-04 | Diaria lunes a sábado sin festivos desde el 8-oct-2026 | ✅ Verde | 9, 10, 13 y 14 de octubre (salta el domingo 11 y el festivo 12) |
| CA-05 | Pago de $ 60.000 | ✅ Verde | Cuota 1 pagada, 19 restantes, acumulado $ 60.000, saldo $ 1.140.000; datos del recibo idénticos |
| CA-06 | Pago siguiente de $ 150.000 | ✅ Verde | Cuotas 2 y 3 completas, cuota 4 con abono de $ 30.000, 17 restantes, acumulado $ 210.000, saldo $ 990.000 |
| CA-07 | Mismo comprobante por WhatsApp y luego por correo | ✅ Verde | Núcleo (huella lógica), base de datos (índice único parcial) y lectura real con OCR: el reenvío queda DUPLICADO |
| CA-08 | Comprobante desde un número no registrado | ✅ Verde | Núcleo y app: queda «Sin asignar» con sugerencias; al asignarlo se ofrece guardar el número, que queda como secundario |
| CA-09 | Beneficiario distinto de las cuentas receptoras | ✅ Verde | Núcleo: no se aplica, pasa a revisión con la alerta «El pago no se hizo a tus cuentas» |
| CA-10 | Recordatorio el domingo 11-oct-2026 10:00 | ✅ Verde | Núcleo y API: reprogramado al martes 13-oct-2026 07:00, con la regla registrada |
| CA-11 | Segundo mensaje de cobranza el mismo día | ✅ Verde | Núcleo y API: bloqueado con la regla `MAX_PER_DAY` |
| CA-12 | Tasa efectiva por encima del tope | ✅ Verde | Núcleo y app: no se guarda; se informa la tasa máxima que cumple |
| CA-13 | Respaldo y restauración | ✅ Verde | `apps/prototype/tools/verify.mjs`: se restauraron 183 de 183 documentos con la misma huella SHA-256 y 180 de 180 PDF abren. Se rechazan la contraseña errada y un byte alterado |
| CA-14 | es → pt-BR → en con la app abierta | ✅ Verde | `apps/prototype/tools/e2e.mjs`: todas las vistas en los tres idiomas sin recargar; 0 cadenas sin traducir (676 entradas) |
| CA-15 | Cliente «María José Pérez Gómez» | ✅ Verde, con ajuste | Se crea `Maria Jose Perez Gomez - C000013/CT-000014/` con 5 subcarpetas, el PDF del plan y `.coroc-id`. El nombre de la carpeta va sin tildes (ADR-013) |
| CA-16 | Cobrador consulta cliente ajeno | ✅ Verde | Acceso denegado y evento `access.denied` en la bitácora; el Cobrador ve 1 de 13 clientes |
| CA-17 | Empresa A lee datos de B | ✅ Verde | `services/api/db/test`: 18 de 18 pruebas en PostgreSQL 16 real con RLS forzada y rol sin BYPASSRLS |
| CA-18 | Reverso de un pago | ✅ Verde | Contramovimiento en el libro, recibo ANULADO en el repositorio y en la carpeta, saldo y dashboard vuelven exactamente al valor anterior |
| CA-19 | Precisión de extracción | ✅ Verde en la API con conjunto sintético (ver Fase 3) | Prototipo: 6 formatos de texto y 1 imagen con OCR real. Servidor: 43 comprobantes sintéticos. Falta el conjunto de 40 o más comprobantes reales anonimizados (pregunta P-3) |
| CA-20 | Suspensión de la cuenta de WhatsApp Cloud API | ✅ Verde | API con un Graph API de prueba: paso automático al modo asistido sin perder mensajes y aviso al propietario. Falta repetirlo con una cuenta real de Meta (P-4) |

## Otras verificaciones

| Verificación | Resultado |
|---|---|
| Pruebas del núcleo (`vitest`) | 41 de 41; cobertura de líneas del 96,4 % (§21 exige 90 %) y de ramas del 80,4 % |
| Base de datos (PostgreSQL 16.14) | 18 de 18: RLS en lectura, escritura y actualización; libro y bitácora inmutables; reverso único con motivo; capital + interés = cuota; topes de tasa sin vigencias solapadas |
| Contrato OpenAPI 3.1 | 59 operaciones; Redocly lo valida sin errores (2 advertencias de estilo) |
| Recorrido completo de la app (`e2e.mjs`) | 0 errores de consola; escritorio, oscuro, móvil y tres idiomas |
| Carpeta COROC, respaldo, roles y CA-08 (`verify.mjs`) | 24 de 24 |
| Lectura real con OCR (`verify-ocr.mjs`) | 10 de 10: valor, fecha, pagador, beneficiario y referencia; registro automático sin alertas; reenvío marcado duplicado |
| PDF de muestra (`samples.mjs`) | 7 de 7 (`docs/muestras`) |
| Renombrar un cliente | La carpeta se renombra sin perder archivos (4 de 4) |
| Bloqueo por intentos | 15 minutos tras 5 intentos fallidos |

## Cómo repetir las verificaciones

```bash
# Fases 1 y 2: núcleo y API (PostgreSQL 16 accesible con un usuario que pueda crear bases y roles)
npm ci && npm run build
npx playwright-core install chromium-headless-shell   # PDF de la Fase 2 (o COROC_CHROMIUM_PATH=/ruta/al/ejecutable)
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres npm test
(cd services/api && PERF=1 TEST_DATABASE_URL=... npx vitest run test/perf.test.ts)   # 100.000 clientes
COVERAGE=1 TEST_DATABASE_URL=... npm test                                              # con umbrales de cobertura

# Fases 1 y 2: app Flutter (ver apps/coroc_app/README.md)
cd apps/coroc_app && flutter test

# Núcleo
cd packages/core && npm ci && npx vitest run --coverage

# Base de datos (descarga PostgreSQL 16 embebido; no debe ejecutarse como root)
cd services/api/db/test && npm install && node rls-test.mjs

# App (requiere Playwright: npm i -D playwright)
cd apps/prototype && npm ci && node tools/build.mjs
node tools/e2e.mjs          # recorrido, idiomas y capturas → docs/pantallas
node tools/verify.mjs       # CA-08, CA-13, CA-15, CA-16, CA-18
node tools/verify-ocr.mjs   # OCR real; sin internet: OCR_ASSETS=/ruta/con/tesseract
node tools/samples.mjs      # PDF de muestra → docs/muestras
```
