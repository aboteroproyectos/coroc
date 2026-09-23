# COROC 0.2.0 · Fase 2 «Documentos» · Notas de versión

Fecha: 23 de septiembre de 2026.
Rama: `fase-2`.

La Fase 2 agrega los documentos a la plataforma:
- repositorio documental cifrado en el servidor;
- carpeta COROC en Android, iOS, Windows y macOS;
- PDF del plan de pagos, del recibo, del estado de cuenta y del paz y salvo;
- informes, y respaldo y restauración por empresa.

Se cierra con CA-13, CA-15 y CA-18 en verde por la API (detalle en [04_CRITERIOS_DE_ACEPTACION.md](04_CRITERIOS_DE_ACEPTACION.md)).

## Novedades

### Servidor (`services/api`)
- **Repositorio documental (§16).**
  - Cada documento tiene su cliente, préstamo, tipo, idioma, etiquetas, huella SHA-256 y versiones: nunca se sobrescribe.
  - Búsqueda sin tildes, con filtros y paginación.
  - Carga manual de PDF e imágenes, reconocidos por su contenido, con un límite de 25 MB.
  - El Cobrador solo ve los documentos de sus clientes, también en la base (RLS).
- **Archivos cifrados en reposo (ADR-031).** AES-256-GCM por bloques, con una clave por archivo ligada a la empresa. Se guardan en disco o en un almacén compatible con S3.
- **Descargas firmadas.** Los enlaces vencen en 5 minutos y admiten rangos, así que una descarga cortada se reanuda.
- **PDF con Chromium (ADR-033).**
  - Contrato y plan de pagos al crear el préstamo, con una versión nueva tras cada pago.
  - Recibo A5 con código QR de verificación, y su versión ANULADO al reversar el pago.
  - Estado de cuenta bajo demanda y el primer día de cada mes.
  - Paz y salvo al pagar todo.
- **Verificación pública del recibo.** `GET /v1/public/receipts/{código}` muestra la empresa, el número, la fecha, el monto y si fue anulado, sin datos del deudor.
- **Tareas en bandeja de salida (ADR-032).** Un documento nunca se pierde aunque el proceso se caiga. Las tareas se reintentan y la app ve su avance.
- **Carpeta COROC (§16.2 y §16.3).** El manifiesto de la carpeta lleva las subcarpetas por cliente y contrato, el `.coroc-id` y los nombres `AAAA-MM-DD_HHMM_TIPO_…` en el idioma de la empresa y sin tildes.
- **Informes (§18).**
  - Cartera total y por cobrador, recaudo por período, mora por edades, finalizados con su utilidad, flujo de caja, libro de movimientos y mensajes.
  - En PDF, XLSX con números reales y formato de moneda, o CSV con BOM y protección contra fórmulas inyectadas.
  - En el idioma que se elija.
- **Respaldo `.coroc` y restauración (§19, ADR-034).**
  - Respaldo cifrado con contraseña y generado por flujo, con avance y cancelación.
  - Restauración en tres pasos: subir, verificar con un resumen y aplicar de forma atómica, escribiendo el nombre de la empresa.
  - Solo el Propietario restaura. El Administrador puede respaldar.
- **Contrato OpenAPI 3.1** con 80 operaciones (10 nuevas).

### App Flutter (`apps/coroc_app`)
- **Pestaña «Documentos»** en la ficha del cliente:
  - documentos por préstamo, con búsqueda y filtros;
  - carga de archivos;
  - estado de cuenta bajo demanda;
  - visor PDF integrado, con versiones, datos del documento, etiquetas y el botón para compartir o guardar.
- **Recibo en PDF** desde el pago recién registrado y desde el historial de movimientos.
- **Informes:** filtros de período, moneda, idioma y cobrador, y lista de informes recientes. XLSX y CSV se comparten o se guardan.
- **Carpeta COROC** en las cuatro plataformas (ADR-036):
  - se pide permiso una vez, se recuerda y se sincroniza en segundo plano;
  - en escritorio se pueden subir al repositorio los archivos que el usuario ponga en la carpeta de un cliente.
- **Respaldo y restauración** en Configuración:
  - crear un respaldo, ver su avance y guardarlo en `_Respaldos`;
  - restaurar con la verificación previa, que muestra qué se restaurará.
- **Ayuda:** 4 temas nuevos (documentos, carpeta COROC, informes, respaldo).
- **Idiomas:** 519 textos en español, portugués de Brasil e inglés (142 nuevos).

### Infraestructura
- La imagen Docker incluye Chromium sin interfaz, y el volumen `/var/lib/coroc/objects` guarda los archivos cifrados.
- La CI instala Chromium para las pruebas de PDF.
- Plantillas nativas:
  - iOS: la carpeta de la app se muestra en Archivos;
  - macOS: permisos de carpetas elegidas por el usuario y marcadores de seguridad.

## Pruebas
- Núcleo: 50 pruebas.
- API: 59 pruebas con PostgreSQL 16 real. Incluyen:
  - CA-13, CA-15 y CA-18 con PDF;
  - leer el texto de los PDF generados;
  - cifrado, rangos e integridad;
  - informes en los 3 formatos;
  - respaldo con contraseña errada y byte alterado;
  - permisos del Cobrador.
- App: 25 pruebas, incluida la sincronización de la carpeta (CA-15 del lado de la app). También se compila para Android, Windows, macOS e iOS en CI.

## Seguridad y privacidad
- Los documentos se cifran antes de salir del proceso de la API, y la app no guarda un caché propio (ADR-023, ADR-035).
- Los enlaces de descarga duran 5 minutos.
- El código QR del recibo no revela datos del deudor.
- El respaldo va cifrado con la contraseña que elige el usuario. Sin ella no se puede restaurar.

## Límites conocidos
- **S3:** el almacén compatible con S3 no se ha probado contra un servicio real. Las pruebas usan el almacén en disco.
- **Respaldos de la Fase 0:** los `COROC-BACKUP-1` de la app HTML no se restauran en el servidor (ADR-034).
- **Segundo factor tras restaurar:** después de una restauración, cada usuario vuelve a activar su segundo factor.
- **Carpeta en teléfonos:** en Android e iOS la carpeta solo recibe archivos. La carga de archivos puestos a mano está en escritorio, y en el teléfono se usa «Subir archivo».
- **Fases siguientes:** lectura de comprobantes y portal del deudor (Fase 3), y mensajería (Fase 4).

## Cambios que requieren acción
- Aplique la migración `0003_fase2.sql` (`node dist/db/migrate.js`).
- Defina `COROC_API_PUBLIC_URL` con la dirección pública de la API: la usan los códigos QR de los recibos. Opcionalmente, defina `COROC_VERIFY_URL`.
- Conserve `COROC_DATA_KEY` en el gestor de secretos: sin ella, los archivos no se pueden leer (ADR-031).
- En producción con varias instancias, deje el trabajador de documentos en una o en todas (`COROC_DOCUMENT_WORKER=on`). La bandeja admite varias.
