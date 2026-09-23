# COROC 0.1.0 · Fase 1 «Núcleo» · Notas de versión

Fecha: 22 de septiembre de 2026.
Rama: `fase-1`.

La Fase 1 entrega el servidor y la app nativa con lo esencial para operar la cartera:
- ingreso seguro, roles y varias empresas en el mismo servidor;
- tres idiomas y el sistema de diseño con el logo;
- clientes y préstamos, con el motor financiero y el cuadro de pagos;
- pagos con recibo y dashboard en vivo.

Se cierra con CA-01 a CA-06, CA-12, CA-14, CA-16 y CA-17 en verde (detalle en [04_CRITERIOS_DE_ACEPTACION.md](04_CRITERIOS_DE_ACEPTACION.md)).

## Novedades

### Servidor (`services/api`)
- **Ingreso seguro (§7.1).**
  - Contraseñas con Argon2id de al menos 12 caracteres, rechazadas si aparecen en filtraciones conocidas (consulta con k-anonimato) o contienen el usuario.
  - Bloqueo tras 5 intentos fallidos, cada vez más largo (ADR-025).
  - Segundo factor TOTP obligatorio para el Propietario.
  - Sesiones por dispositivo con token de renovación rotativo: si se reutiliza un token viejo, la sesión se revoca.
  - Recuperación de contraseña con un enlace de un solo uso que vence en 30 minutos.
- **Roles (§7.2).** Propietario, Administrador, Cobrador y Auditor. El Cobrador solo ve sus clientes, y lo impide también la base de datos (ADR-022). Cada acceso denegado queda en la bitácora.
- **Varias empresas.** Aislamiento con seguridad a nivel de fila de PostgreSQL 16 en todas las tablas. La API se conecta con un usuario sin privilegios para saltarla.
- **Clientes y préstamos (§8 y §9).**
  - Asistente «cliente + primer préstamo» en una sola operación, con aviso de posible duplicado por número o documento.
  - Búsqueda sin tildes por nombre, código, contrato o teléfono.
  - Edición con control de concurrencia y autorizaciones de datos y canales.
  - Interés simple y cuota fija (francés), frecuencias diaria, semanal y mensual, festivos de Colombia, Brasil y EE. UU., y redondeo configurable.
- **Tope legal (§9.6).** Toda tasa se convierte a efectiva anual y se compara con el tope vigente. En Colombia no se presta sin tasa de usura registrada (ADR-026), y la vista previa ofrece la tasa máxima que cumple.
- **Cuadro de pagos (§10).** Cada cuota muestra lo pactado, lo pagado, la fecha del pago, su estado, los recibos y el saldo después de la cuota.
- **Pagos (§14).**
  - Vista previa de cómo se aplicará cada pago.
  - Registro idempotente: un reintento no duplica el pago.
  - Recibo de agradecimiento con número consecutivo y código de verificación.
  - Reverso con motivo que anula el recibo (CA-18, adelantado de la Fase 2).
- **Dashboard (§17).** Clientes activos, capital colocado, esperado y recaudado hoy, vencido, total por recibir, cartera por días de mora y recaudo de 30 días. Una sola moneda por vista. Se actualiza en vivo (eventos SSE sobre Redis) cuando alguien registra un pago.
- **Contrato OpenAPI 3.1** con 70 operaciones. Valida cada petición en tiempo de ejecución (ADR-028). Los errores siguen RFC 9457 y llegan traducidos al idioma de la app.

### App Flutter (`apps/coroc_app`): Android, iOS, Windows y macOS
- **Sistema de diseño.**
  - Logo vectorial oficial y temas «Marfil» y «Medianoche», o el del sistema.
  - Tipografías Inter y Montserrat, botón dorado de marca y cifras animadas que respetan «reducir movimiento».
  - Diseño adaptable: barra inferior en teléfonos, riel en tabletas y menú lateral en escritorio.
- **Ingreso.**
  - Selector de idioma visible, «Recordar mi usuario» y activación del segundo factor con código QR.
  - Recuperación de acceso.
  - Bloqueo por inactividad con huella, rostro o PIN, y contenido oculto al cambiar de app (en Android también se bloquean las capturas de pantalla).
- **Inicio.** Indicadores con definiciones exactas, tarjeta dorada del recaudo de hoy, cartera por días de mora, tendencia de 30 días y cobros de hoy, con avisos en vivo de pagos y de bloqueos de cuentas.
- **Cobros de hoy.** Lista filtrable de lo que vence hoy y lo atrasado, con acceso directo a «Registrar pago».
- **Clientes.** Búsqueda paginada con filtros por estado. Ficha con resumen y avance, cuadro de pagos, movimientos con reverso, datos, autorizaciones y carpeta.
- **Nuevo cliente.** Asistente de tres pasos: datos, condiciones con vista previa en vivo y control del tope, y autorizaciones con resumen.
- **Nuevo préstamo** para un cliente existente.
- **Registrar pago.** Monto, fecha, medio y referencia, con la vista previa de la aplicación y el recibo de agradecimiento en pantalla.
- **Configuración.**
  - Idioma, apariencia, bloqueo automático y nombre visible.
  - Cambio de contraseña, segundo factor y equipos con sesión abierta.
  - Datos de la empresa, usuarios y roles, y topes legales de tasa.
- **Ayuda** con 12 temas y búsqueda sin tildes, en los tres idiomas.
- **Idiomas.** 377 textos en español, portugués de Brasil e inglés. El cambio es inmediato (CA-14) y se guarda en el perfil.

### Infraestructura
- `infra/docker-compose.yml`: PostgreSQL 16, Redis 7, migraciones, API y HTTPS automático con Caddy (perfil `https`).
- GitHub Actions (`.github/workflows/ci.yml`):
  - núcleo y API con PostgreSQL 16, tipos, textos en tres idiomas y contrato;
  - imagen Docker;
  - análisis y pruebas de la app;
  - APK y AAB de Android, Windows, macOS e iOS sin firma.

## Seguridad y privacidad
- La app no guarda datos de clientes en el equipo, solo la sesión en el almacén seguro del sistema (ADR-023).
- Secretos en variables de entorno.
- Los datos sensibles de autenticación (secreto TOTP) se guardan cifrados con AES-256-GCM.
- El libro de movimientos y la bitácora son inmutables en la base de datos.

## Límites conocidos
- **Compilación de las apps.** El código Flutter está completo y revisado, pero aún no se ha compilado. Esta sesión no tiene acceso de escritura a `aboteroproyectos/coroc` y el entorno no permite descargar Flutter. La CI queda lista para compilar las cuatro apps al subir el repositorio. La primera ejecución puede exigir ajustes menores.
- **Sin conexión.** La consulta sin conexión llega en la Fase 5 (ADR-023). Sin red, la app lo indica y permite reintentar.
- **Firma y tiendas.** Faltan la firma para tiendas (P-2) y el despliegue en la nube (P-1). Las compilaciones de iOS y macOS salen sin firma.
- **Fases siguientes (§23).**
  - PDF, carpeta COROC y respaldo en el servidor: Fase 2.
  - Lectura de comprobantes y portal del deudor: Fase 3.
  - Mensajería: Fase 4.
  - La app HTML de la Fase 0 ya los muestra funcionando de forma local.
- **Tasas diarias en Colombia.** Las tasas de los ejemplos de préstamos diarios superan la usura; ver P-6.

## Cambios que requieren acción
- Antes de prestar en Colombia, registre la tasa de usura vigente en Configuración › Topes legales de tasa.
- El Propietario debe activar el segundo factor en su primer ingreso.
