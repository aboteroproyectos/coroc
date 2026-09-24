# COROC 0.5.0 · Fase 5 «Endurecimiento y publicación» · Notas de versión

Fecha: 24 de septiembre de 2026.
Rama: `fase-5`.

La Fase 5 prepara COROC para salir a producción:
- medido con 100.000 clientes;
- atacado de forma automática en cada cambio;
- usable sin conexión y con lectores de pantalla;
- listo para firmarse y publicarse en las cuatro tiendas en cuanto existan las cuentas.

El estado de cada requisito de §21 está en [04_CRITERIOS_DE_ACEPTACION.md](04_CRITERIOS_DE_ACEPTACION.md). Las veinte CA siguen en verde.

## Novedades

### Rendimiento (§21)
- **Carga de 100.000 clientes y 2.000.000 de cuotas** en un trabajo propio de la CI («Rendimiento»), con su informe como artefacto:
  - dashboard: 196 ms;
  - búsqueda: 23–69 ms;
  - con 10 usuarios a la vez: búsqueda 192 ms y dashboard 538 ms (p95);
  - carga mixta de 300 peticiones sin errores.
- **Búsqueda indexada a pesar de RLS (ADR-051):** índices trigrama del segundo teléfono y de los dígitos del documento, y una función que filtra por empresa de forma explícita. La búsqueda con 10 usuarios a la vez bajó de 471 ms a 192 ms.
- **Comprobante → pago:** con 20 comprobantes a la vez por el portal y OCR real, el p95 es de 4,4 s (el límite es 60 s).

### Seguridad (ASVS nivel 2)
- **Suite de penetración sobre el contrato (ADR-052):** recorre las 110 operaciones y comprueba:
  - sesión obligatoria;
  - tokens manipulados (alg none, otra clave, rol cambiado, vencido);
  - la matriz de roles;
  - que otra empresa no alcance ningún recurso por su identificador;
  - el aislamiento del Cobrador;
  - encabezados, inyección SQL y de rutas, cuerpos enormes, CORS y límite de intentos.
- **Dos errores corregidos** que encontró la suite:
  - un cuerpo JSON demasiado grande daba 500 y ahora da 413;
  - un byte nulo en la búsqueda daba 500 y ahora da 422.
- **Dependencias:**
  - `npm audit` sin hallazgos: nodemailer 10, pdfjs-dist 6.3, jspdf 4.2 (prototipo) y uuid 11 para exceljs;
  - la CI falla ante cualquier vulnerabilidad moderada o mayor.
- **OWASP ZAP en CI** sobre el contrato, con sesión: 118 reglas en PASS, sin hallazgos de inyección, XSS ni SSRF.
- **Id de petición (ADR-053):** `X-Request-Id` en cada respuesta, registro de acceso sin datos personales y `Cache-Control: no-store`.
- **Interbloqueo corregido (ADR-057):** un reverso de pago podía chocar con la generación de su recibo. Ahora el PDF se genera fuera de la transacción y los bloqueos siguen siempre el orden préstamo → recibo.

### Soporte y observabilidad (ADR-054)
- **Cola de fallidos:** documentos que no se generaron, mensajes que no salieron y comprobantes ilegibles, con su motivo técnico y el botón «Reintentar». Está en Configuración › Soporte, para el Propietario, el Administrador y el Auditor.
- **Recorrido del comprobante:** en la Bandeja, cada etapa con su hora (recibido, leído, identificado, decidido, pago, recibo y entrega) y los segundos que tardó el pago.

### App
- **Sin conexión (ADR-055):**
  - clientes, préstamos, planes, cobros de hoy, tablero y los últimos 30 documentos abiertos se consultan sin red;
  - lo guardado va cifrado con AES-256-GCM y una clave del almacén seguro del sistema;
  - un aviso indica desde cuándo son los datos.
- **Pagos sin conexión:** quedan en una cola y se envían solos al volver la red, con su misma clave, así que nunca se duplican. Si el servidor rechaza uno, queda «En conflicto» con el motivo para revisarlo o descartarlo.
- **Accesibilidad (WCAG 2.2 AA):** en claro y oscuro, con pruebas de contraste, áreas táctiles (48 px Android, 44 pt iOS) y nombre de cada control, y texto al 200 % sin desbordes. Cubren el ingreso, el registro de pago, Soporte, el recorrido y el aviso sin conexión.
- **Eliminar la cuenta (ADR-056):** «Eliminar mi cuenta» en Configuración; el usuario queda anónimo y sus pagos se conservan. El Propietario «Cierra la empresa» escribiendo su identificador. El Administrador puede eliminar usuarios.
- **Política de privacidad:** enlazada desde «Acerca de».
- **Contrato de la app:** una prueba verifica que las 96 operaciones de la app existen en el contrato de la API.
- **Envío de archivos corregido:** el cuerpo de la petición no se cerraba al terminar el archivo.
- **Ayuda:** 3 temas nuevos: trabajar sin conexión, soporte y eliminar la cuenta.
- **Textos:** 63 nuevos, en 3 idiomas (889 en total).
- **Dependencias nuevas:**
  - `cryptography` (cifrado AES-GCM en Dart);
  - `msix` (instalador de Windows, solo para compilar);
  - `yaml` (solo pruebas).

### Privacidad y tiendas (§20.4)
- **Política de privacidad pública (ADR-058):** `GET /v1/public/privacy` en español, portugués e inglés, en HTML indexable o JSON.
- **Fichas de tienda** en 3 idiomas, declaración de funciones financieras de Google Play y respuestas exactas de Data safety y App Privacy: [11_FICHAS_DE_TIENDA.md](11_FICHAS_DE_TIENDA.md).
- **Firma y publicación en CI (ADR-059):**
  - Android: App Bundle y APK firmados, y pista interna de Google Play;
  - iOS: IPA firmado y TestFlight;
  - macOS: DMG con Developer ID, notarizado y grapado;
  - Windows: MSIX firmado.

  Se activan al cargar los secretos; mientras tanto, se compila sin firma.

### API y base de datos
- **Migración `0006_fase5.sql`:** índices y función de búsqueda, `users.deleted_at` y `tenants.closure_requested_at`.
- **Contrato OpenAPI 0.6.0:** 110 operaciones, 7 nuevas:
  - `listFailures`, `retryTask` y `traceIntake`;
  - `deleteMyAccount`, `deleteUser` y `closeCompany`;
  - `privacyPolicy`.
- **Cobertura con umbrales en CI:**
  - núcleo: 97 % de líneas (mínimo 90 %);
  - API: 88 % (mínimo 80 %);
  - app: piso de 25 %.

## Pruebas
- **Núcleo:** 64 pruebas.
- **API:** 105 pruebas con PostgreSQL 16 real, 17 de ellas nuevas:
  - `security.test.ts`: 11;
  - `account.test.ts`: 4;
  - en `intake.test.ts`: comprobante → pago con 20 a la vez y soporte.

  Hay además 5 de rendimiento con `PERF=1`.
- **App:** 45 pruebas, 13 de ellas nuevas:
  - sin conexión;
  - accesibilidad;
  - soporte;
  - contrato de la app.

## Límites conocidos
- **Cobertura global:** el requisito de ≥ 75 % se cumple en el servidor (núcleo 97 % y API 88 %), pero la app llega a 26 % sin el código generado. Las pantallas se prueban sobre todo por su lógica y sus componentes, no pantalla por pantalla. La CI impide que baje; subirla es trabajo pendiente.
- **Lectores de pantalla y arranque en frío:** las etiquetas y la semántica están probadas de forma automática. Faltan la prueba manual con TalkBack, VoiceOver y Narrador y la medición del arranque en un teléfono de gama media (P-9).
- **Prueba de penetración externa:** la suite automática y ZAP no la reemplazan (P-8).
- **Publicación:** faltan las cuentas de desarrollador y los certificados (P-2) y el entorno público con la cuenta de demostración para la revisión (P-1).
- **Revisión legal:** la política de privacidad y las fichas esperan la revisión de un abogado (P-5).
- **Sin conexión solo se registran pagos.** Crear clientes o préstamos exige conexión, porque dependen de numeraciones y del tope de tasa en el servidor.
- **Purga tras el cierre de una empresa:** es un procedimiento de soporte (06 §5.8), no automático, para que un error sea reversible dentro de los 30 días.
- **Prototipo HTML (Fase 0):** su dependencia jspdf se actualizó, pero el `dist/COROC.html` publicado conserva la versión anterior hasta volver a compilarlo.

## Cambios que requieren acción
- Aplique la migración `0006_fase5.sql`.
- Configure `COROC_PRIVACY_CONTACT` y declare en las tiendas la URL `https://<api>/v1/public/privacy`.
- Si el balanceador genera un id de petición, envíelo como `X-Request-Id`.
- Para publicar, cargue los secretos listados al inicio de `.github/workflows/release.yml` y cree una etiqueta `v0.5.0`.
