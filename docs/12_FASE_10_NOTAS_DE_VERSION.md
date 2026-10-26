# COROC 0.10.0 · Fase 10 «COROC Escritorio para Windows» · Notas de versión

Fecha: 25 de octubre de 2026.
Rama: `fase-10`.

COROC Escritorio es **un solo instalador y una sola app** para Windows 10 y 11 de 64 bits: todo corre dentro del PC,
sin Docker, sin nube, sin costo mensual y sin derechos de administrador. Está pensado para personas sin destreza con
computadores: cinco pantallas para empezar, un botón principal por pantalla y ninguna palabra técnica.

Responde al encargo del 24 de octubre de 2026 y a tres decisiones del Propietario:
- WhatsApp en modo **asistido**, sin vincular el número a ningún programa (ADR-064);
- correo con el **Gmail de la empresa** y una contraseña de aplicación (ADR-065, responde P-7);
- **tasa libre por préstamo** con la política de la ADR-061, que el Propietario activa una sola vez en el asistente.

La guía para quien usa COROC está en [GUIA_ESCRITORIO.md](GUIA_ESCRITORIO.md), con capturas. Los criterios E-1 a E-7
y su evidencia están en [04_CRITERIOS_DE_ACEPTACION.md](04_CRITERIOS_DE_ACEPTACION.md). Las veinte CA siguen en verde
y el modo nube no cambia.

## Novedades

### Instalador y servidor dentro del PC (ADR-062, ADR-067)
- **Un `.exe` de unos 110 MB** hecho con Inno Setup: por usuario, sin administrador, en `%LOCALAPPDATA%\COROC`, con
  accesos en el escritorio y el menú Inicio, en español, portugués o inglés según Windows.
- **Incluye todo:** la app, `node.exe` 22 con la API, PostgreSQL 16 portátil, Tesseract (español, portugués e inglés),
  Poppler y el runtime de Visual C++. Cada descarga del armado tiene versión y SHA-256 fijos.
- **Supervisor:** enciende la base y la API bajo el usuario, solo en 127.0.0.1 y en puertos libres.
  - La primera vez genera las claves de la instalación y las protege con DPAPI: solo esa cuenta de Windows las abre.
  - Cada vez aplica las migraciones pendientes, vigila la salud cada 10 s y reinicia lo que se caiga.
  - Apaga en orden al salir o cuando el instalador va a actualizar.
- **La API solo atiende a la app** de ese PC: además de escuchar en 127.0.0.1, exige la clave de la ejecución, que
  cambia en cada arranque.
- **Sin Redis ni almacenamiento externo:** colas en memoria y archivos cifrados en el disco. PDF con Microsoft Edge
  (Chromium solo si falta Edge).
- **Actualizar = abrir el instalador nuevo:** COROC se apaga, copia la base en frío y se actualiza; al abrir aplica las
  migraciones. Si la copia falla, no se cambia nada.
- **Desinstalar conserva los datos** salvo que se pida borrarlos (`/BORRARDATOS` en silencio).

### La app en el PC
- **Pantalla de carga** en azul noche con el logo y un paso a la vez en palabras simples («Encendiendo su base de
  datos…»). Si algo falla, dice qué hacer, ofrece «Reintentar» y un código para soporte.
- **«COROC sigue trabajando»:** cerrar la ventana deja a COROC junto al reloj, leyendo el correo y preparando los
  recordatorios. El menú del ícono abre la ventana, «Mensajes de hoy» o «Salir de COROC».
- **«Iniciar COROC con Windows»** la abre en la bandeja al encender el PC. Un segundo doble clic trae al frente la
  ventana que ya estaba abierta.
- **Ingreso sin código de empresa** (hay una por PC) y **Windows Hello** para abrir COROC (ADR-063).
- **«¿Olvidó su contraseña?»** con Windows Hello, sin correo de por medio.

### Asistente de primer uso (5 pantallas)
1. **Empresa y país** (Colombia, Brasil o Estados Unidos) y el idioma.
2. **Propietario y contraseña**, con Windows Hello. En Escritorio la verificación en dos pasos es opcional (ADR-063).
3. **Tasas:** tope de usura opcional y la política de la ADR-061 con su advertencia legal.
4. **Gmail:** guía con tres imágenes para crear la contraseña de aplicación y prueba de conexión con un mensaje claro.
5. **WhatsApp:** comprueba que WhatsApp para Windows esté instalado; si falta, botón a Microsoft Store.

Desde la primera pantalla también se **restaura la copia `.coroc` de otro PC** y se entra con el usuario de siempre (E-7).
Al final, un recorrido de cuatro tarjetas muestra lo principal.

### WhatsApp asistido (ADR-064)
- **«Mensajes de hoy»:** los mensajes listos del día uno a la vez, con un botón grande «Enviar por WhatsApp».
  - Se abre el chat del cliente en WhatsApp para Windows con el texto listo (`whatsapp://send`; `wa.me` de respaldo).
  - Si el mensaje lleva PDF, queda copiado: «oprima Ctrl+V y después Enter».
  - Al volver a COROC pasa solo al siguiente («3 de 12»). Las reglas de la Ley 2300 se vuelven a aplicar al enviar y,
    si un mensaje no puede salir, se dice por qué.
- **Comprobantes sin menús:** soltarlos en cualquier parte («Suelte aquí el comprobante»), pegarlos con Ctrl+V o
  aceptar «¿Es un comprobante?» cuando llegan a Descargas. Todos van a la Bandeja de la Fase 3.
- **El recibo con un clic:** al registrarse el pago, «Enviar el recibo» abre WhatsApp con el mensaje y el PDF copiado.

### Gmail de la empresa (ADR-065)
- **Lectura** con IMAP IDLE y una revisión cada 2 minutos, solo de los correos que llegan desde la dirección de un
  cliente. Los comprobantes adjuntos se registran o se proponen, sin duplicados (CA-07), y el correo queda con la
  etiqueta «COROC/Procesado».
- **Envío** por el SMTP de Gmail: recibos (en el mismo hilo del comprobante), recordatorios, estados de cuenta y paz y
  salvos, con las reglas de contacto y hasta 400 correos al día. Si Google rechaza la contraseña, el mensaje pasa a
  «Mensajes de hoy».
- **Hilo de correo** de cada cliente en su ficha, con el comprobante a un clic.
- **Configuración** muestra el estado, los correos enviados hoy y, si hay un problema, qué hacer.

### Copia diaria automática (ADR-066)
- Una copia `.coroc` cifrada al día en la carpeta elegida (OneDrive, Google Drive para escritorio o USB), con las
  últimas 3, 7, 14 o 30.
- **Aviso arriba de la pantalla** si pasan 7 días sin copia, y en Configuración si la carpeta no está (USB
  desconectada) o la copia falló.
- «Hacer una copia ahora» cuando se quiera.

### Para personas sin destreza
- **Tamaño de la letra:** normal, grande o más grande, al instante y solo en ese equipo. El menú lateral se desplaza
  si no cabe.
- **Ayuda:** 6 temas nuevos (COROC en este PC, Mensajes de hoy, comprobantes en el PC, Gmail, copias y cambio de PC, y
  el aviso de SmartScreen).
- **Textos:** 187 nuevos, en español, portugués de Brasil e inglés.
- **Errores que dicen qué hacer:** por ejemplo, «Si es una memoria USB, conéctela; si no, elija otra carpeta».

### API y base de datos
- **Migración `0008_fase10.sql`,** con RLS en cada tabla nueva:
  - `installation_tenant()`;
  - `gmail_accounts` (la contraseña de aplicación va cifrada) y `email_messages` (el hilo de correos de cada cliente);
  - `auto_backups` y la marca `backups.auto` de la copia diaria.
- **Contrato OpenAPI 0.8.0:** 124 operaciones, 13 nuevas:
  - `desktopStatus`, `desktopSetup`, `desktopRestoreUpload`, `desktopRestoreApply` y `desktopResetPassword`;
  - `getGmail`, `saveGmail`, `testGmail`, `deleteGmail` y `clientEmails`;
  - `getAutoBackup`, `saveAutoBackup` y `runAutoBackup`.
- **Modo Escritorio** (`COROC_MODE=desktop`): solo 127.0.0.1 con la clave de la ejecución, segundo factor opcional,
  mensajes sin enlaces públicos y recibo con código de verificación sin QR.
- **Más robusta:**
  - en los dos modos, el pool de la base atiende el cierre de una conexión inactiva (reinicio, apagado del PC o cambio
    de servidor en la nube) en vez de tumbar el proceso;
  - en Escritorio, si el supervisor se cierra de golpe, la API se apaga en orden en vez de quedar huérfana.
- **Dependencias:**
  - nuevas: `imapflow` y `mailparser` (Gmail); para pruebas, `imapkit` y `smtp-server`;
  - de seguridad: NestJS 12.2.0, multer 2.5.0, nodemailer 10.2.1, zod 4.6.7, body-parser, fast-uri y dompurify.
    `npm audit` queda sin hallazgos;
  - en la app: `window_manager`, `tray_manager`, `desktop_drop`, `win32`, `win32_registry` y `ffi`.

### CI y publicación
- **Nuevo flujo «COROC Escritorio para Windows»** en `windows-latest`: compila la app y la API, arma el servidor
  portátil y el instalador, y lo prueba de punta a punta con `infra/escritorio/prueba.ps1`:
  - instala en silencio y mide hasta COROC listo: de 62 a 85 s (E-1);
  - comprueba DPAPI y que sin la clave de la ejecución no se entra;
  - crea la empresa, un préstamo por encima del tope con la casilla (E-6) y un pago con su recibo en PDF hecho con Edge;
  - lee un comprobante con Tesseract;
  - reinicia y actualiza con los datos intactos y la copia previa (E-2);
  - desinstala conservando los datos, reinstala con los mismos datos y desinstala borrándolos.
- **El instalador queda como artefacto** de cada ejecución. En `main` se publica en Releases como «COROC Escritorio
  para Windows».
- **Capturas de la guía:** `apps/coroc_app/tool/capturas_escritorio_test.dart` las genera con la app real, sus
  fuentes y datos de ejemplo.

## Pruebas
- **Núcleo:** 69 pruebas.
- **API:** 131 pruebas con PostgreSQL 16 real (5 de ellas de rendimiento, con `PERF=1`), 15 nuevas:
  - `desktop.test.ts` (8): sin la clave de la ejecución no se entra, el asistente sin segundo factor obligatorio, la
    restauración en otro PC y la copia diaria (E-7), la contraseña nueva tras Windows Hello, mensajes sin enlaces con
    WhatsApp para Windows y el recibo sin QR; en la nube las rutas de Escritorio no existen;
  - `gmail.test.ts` (6), con un servidor IMAP con las extensiones de Gmail y un SMTP local: conexión y errores claros;
    el comprobante que llega por correo se registra solo y el recibo sale en el mismo hilo con la etiqueta (E-4);
    sin duplicados (CA-07); IDLE; el tope diario; «SALIR»;
  - `supervisor.test.ts` (1): instala la base, enciende la API, la reinicia si se cae y conserva los datos (E-2), en
    una carpeta con espacios y eñe.
- **App:** 163 pruebas, 53 de ellas nuevas, con un supervisor de prueba y un Windows de prueba:
  - arranque, errores, reinicio y apagado;
  - el asistente completo, restaurar, olvidé mi contraseña y bloqueo con Windows Hello;
  - «Mensajes de hoy», también 10 mensajes seguidos con un clic cada uno (E-5);
  - comprobantes soltados, pegados y de Descargas, y el recibo con un clic (E-3);
  - Este PC, Gmail, copia diaria, aviso de 7 días, tamaño de la letra, recorrido y ayuda.
- **Cobertura de la app:** 88,6 % (mínimo 85 % en la CI).
- **Windows real:** la prueba de punta a punta de `prueba.ps1` en cada cambio (ver «CI y publicación»).

## Límites conocidos
- **Firma digital:** hasta tener el certificado de firma de código (P-2), Windows muestra «Windows protegió su PC» al
  abrir el instalador. La guía y la Ayuda explican cómo seguir.
- **Prueba en PCs reales:** la CI corre en Windows Server (`windows-latest`). Falta repetir E-1 en Windows 10 y 11 de
  escritorio y medir con una persona el tiempo de E-5 en WhatsApp para Windows (P-9).
- **Lo que necesita estar en internet sigue en la nube:** cobradores desde el celular y enlace de carga para el
  cliente. Pasar a la nube se hace con una copia `.coroc` (GUIA_ESCRITORIO §9).
- **El PC tiene que estar encendido** para leer el correo y preparar los recordatorios. Lo que se acumula mientras
  está apagado se procesa al encender; el estado de cuenta mensual se genera del 1 al 7 del mes.
- **Una empresa por PC.**
- **Gmail:** exige la verificación en 2 pasos. En cuentas de Google Workspace el administrador puede haber desactivado
  las contraseñas de aplicación.
- **WhatsApp:** cada mensaje lo envía la persona, como decidió el Propietario (P-4). El modo automático (Cloud API) sigue
  implementado solo para la nube (ADR-047), sin activar.

## Cambios que requieren acción
- **Nube:** aplique la migración `0008_fase10.sql`; las tablas nuevas quedan vacías y nada cambia para las empresas
  existentes.
- **Escritorio:** nada; el instalador aplica las migraciones al abrir.
- **Para firmar el instalador** cuando exista el certificado (P-2): firmar `COROC-Escritorio-Windows.exe` en el flujo
  `escritorio-windows.yml` con `signtool`.
