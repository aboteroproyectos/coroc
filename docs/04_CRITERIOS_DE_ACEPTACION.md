# COROC · Estado de los criterios de aceptación (§22)

Corte: 22 de septiembre de 2026 · Fase 0.

Cada criterio se verifica con una prueba automatizada que se puede volver a ejecutar; los comandos están al final. El motor financiero, las reglas de contacto, la identificación y la lectura viven en `@coroc/core`. Ese núcleo es el mismo que usan la app de este paquete y, desde la Fase 1, la API. Por eso las pruebas de hoy son las mismas que cerrarán cada fase, ejecutadas contra el servidor.

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
| CA-10 | Recordatorio el domingo 11-oct-2026 10:00 | ✅ Verde | Núcleo: reprogramado al martes 13-oct-2026 07:00, con la regla registrada |
| CA-11 | Segundo mensaje de cobranza el mismo día | ✅ Verde | Núcleo: bloqueado con la regla `MAX_PER_DAY` |
| CA-12 | Tasa efectiva por encima del tope | ✅ Verde | Núcleo y app: no se guarda; se informa la tasa máxima que cumple |
| CA-13 | Respaldo y restauración | ✅ Verde | `apps/prototype/tools/verify.mjs`: se restauraron 183 de 183 documentos con la misma huella SHA-256 y 180 de 180 PDF abren. Se rechazan la contraseña errada y un byte alterado |
| CA-14 | es → pt-BR → en con la app abierta | ✅ Verde | `apps/prototype/tools/e2e.mjs`: todas las vistas en los tres idiomas sin recargar; 0 cadenas sin traducir (676 entradas) |
| CA-15 | Cliente «María José Pérez Gómez» | ✅ Verde, con ajuste | Se crea `Maria Jose Perez Gomez - C000013/CT-000014/` con 5 subcarpetas, el PDF del plan y `.coroc-id`. El nombre de la carpeta va sin tildes (ADR-013) |
| CA-16 | Cobrador consulta cliente ajeno | ✅ Verde | Acceso denegado y evento `access.denied` en la bitácora; el Cobrador ve 1 de 13 clientes |
| CA-17 | Empresa A lee datos de B | ✅ Verde | `services/api/db/test`: 18 de 18 pruebas en PostgreSQL 16 real con RLS forzada y rol sin BYPASSRLS |
| CA-18 | Reverso de un pago | ✅ Verde | Contramovimiento en el libro, recibo ANULADO en el repositorio y en la carpeta, saldo y dashboard vuelven exactamente al valor anterior |
| CA-19 | Precisión de extracción | 🟡 Parcial | Lector verificado con 6 formatos de texto y 1 imagen con OCR real. Todos los campos se leyeron con confianza de 0,93 a 0,96 y el pago se registró solo. Falta el conjunto de 40 o más comprobantes reales anonimizados (pregunta P-3) |
| CA-20 | Suspensión de la cuenta de WhatsApp Cloud API | ⏳ Fase 4 | Requiere el servidor y una cuenta de Meta. El modo asistido, que es el destino del cambio automático, ya funciona |

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
