# COROC 0.4.0 · Fase 4 «Mensajería y cumplimiento» · Notas de versión

Fecha: 23 de septiembre de 2026.
Rama: `fase-4`.

La Fase 4 hace que COROC hable con los deudores sin que nadie lo tenga que recordar:
- bienvenida con el plan de pagos, recordatorios de cuota, pago recibido con su recibo, cuota vencida, estado de cuenta mensual y paz y salvo;
- por correo con el PDF adjunto, por WhatsApp en modo asistido (un toque) o automático (Cloud API);
- siempre dentro de las reglas de contacto de la Ley 2300, en la hora local del deudor, con su consentimiento y con la posibilidad de excluirse en cualquier momento.

Se cierra con CA-10, CA-11 y CA-20 en verde por la API. El detalle está en [04_CRITERIOS_DE_ACEPTACION.md](04_CRITERIOS_DE_ACEPTACION.md).

## Novedades

### Núcleo (`packages/core`)
- **Plantillas (§11.3):** los textos por defecto de los siete eventos en los tres idiomas, con sus asuntos de correo y las 13 variables (`{{nombre}}`, `{{saldo}}`, `{{enlace_carga}}`, `{{enlace_recibo}}`…).
- **Validador de contenido (ADR-050):** bloquea amenazas, preguntar la causa del impago, menciones a terceros y pedir datos sensibles, en español, portugués e inglés.
- **Exclusión:** reconoce SALIR, SAIR y STOP.
- **Modo asistido:** arma los enlaces `wa.me` y `mailto:` con el texto listo.
- **Hora del deudor:** convierte entre UTC y su hora local, con horario de verano.
- **Presets:** agrega los de Brasil y EE. UU. como plantillas que exigen revisión legal. Mientras no se revisen, rige el de Colombia.

### Servidor (`services/api`)
- **Mensajes automáticos (ADR-044):** cada mensaje se registra en la misma transacción que lo origina:
  - el préstamo nuevo (bienvenida, con el plan adjunto);
  - el pago (recibo, por el canal por el que llegó el comprobante);
  - el saldo en cero (paz y salvo);
  - la tarea mensual (estado de cuenta);
  - el trabajo de cada hora (recordatorios 1 día antes y el día del vencimiento, y cuota vencida 1 día después).

  Un despachador los envía cuando llega su hora; si llevan PDF, espera a que se genere.
- **Reglas de contacto (ADR-045):**
  - preset por empresa, en la hora local del deudor (cada cliente puede tener su zona);
  - se aplican al registrar el mensaje y otra vez al enviarlo;
  - cada decisión queda en el mensaje con su motivo;
  - excepción horaria del deudor, con un documento de evidencia posterior al contrato;
  - envío inmediato de los transaccionales, que decide el propietario.
- **Modo asistido (ADR-046):**
  - los WhatsApp quedan en «Por enviar hoy» con el texto listo;
  - «Enviar» revalida las reglas antes de abrir WhatsApp;
  - los recibos van con un enlace seguro de descarga que vence en 30 días.
- **WhatsApp Cloud API (ADR-047):**
  - texto libre dentro de las 24 horas desde el último mensaje del deudor, y fuera de ellas la plantilla aprobada por Meta;
  - estados enviado, entregado, leído y fallido;
  - se activa con la lista de verificación del Propietario;
  - si Meta suspende la cuenta, la empresa pasa sola al modo asistido sin perder mensajes y se avisa al propietario (CA-20).
- **Correo saliente (ADR-048):**
  - Postmark o SMTP propio (Amazon SES por SMTP);
  - HTML con el logo, PDF adjunto y baja con un clic;
  - remitente con el dominio de la empresa, con asistente de SPF, DKIM y DMARC;
  - un rebote duro marca la dirección como inválida en la ficha;
  - sin proveedor, los correos quedan en «Por enviar hoy» con `mailto:` en lugar de simular el envío.
- **Consentimiento y exclusión (ADR-049):** ningún mensaje sale sin el consentimiento del canal. El deudor se excluye:
  - con SALIR, SAIR o STOP por WhatsApp;
  - con el botón nuevo del portal;
  - con el enlace de baja del correo.

  Una queja por correo no deseado también lo excluye.
- **API:**
  - cola y bitácora de mensajes, contadores, envío manual, enviar, descartar y reintentar;
  - plantillas con vista previa en vivo;
  - reglas de contacto y excepción del deudor;
  - remitente de correo;
  - modo de WhatsApp;
  - webhook de avisos del correo.
- **Base de datos y contrato:** migración `0005_fase4.sql`; contrato OpenAPI 0.5.0 con 103 operaciones (15 nuevas).
- **Correo de la cuenta:** la recuperación de contraseña sale por el mismo proveedor de correo.

### App Flutter (`apps/coroc_app`)
- **Mensajería** (nueva en la navegación, con contador de «Por enviar hoy»):
  - «Por enviar hoy»: «Enviar por WhatsApp» o «Enviar correo» abre la aplicación con el texto listo, y en el celular se puede compartir el PDF al chat;
  - programados, bloqueados con la regla aplicada en palabras del usuario, e historial con los estados de entrega;
  - aviso en vivo si Meta suspende la cuenta.
- **Plantillas:**
  - un editor por evento e idioma, con vista previa en vivo sobre un cliente real;
  - contador de caracteres, variables que se insertan con un toque y el validador mientras se escribe;
  - activar cada mensaje automático y elegir sus canales;
  - nombre de la plantilla aprobada por Meta.
- **Ficha del cliente:** pestaña Mensajes con el historial, el envío manual (pasa por el validador y las reglas), el aviso de correo inválido y la excepción horaria con su evidencia.
- **Configuración:**
  - reglas de contacto: preset, revisión legal, transaccionales inmediatos, recordatorios diarios y hora de los recordatorios;
  - correo saliente: remitente propio y verificación de DNS;
  - WhatsApp: id de la cuenta, modo asistido o automático con la lista de verificación, y estado de suspensión.
- **Navegación en teléfonos:** «Hoy» pasa al tablero (botón «Ver hoy») para dejar sitio a Mensajería.
- **Ayuda:** 4 temas nuevos: mensajes y modo asistido, reglas de contacto, modos de WhatsApp, y consentimiento y exclusión.
- **Textos:** 170 nuevos, en 3 idiomas (826 en total).
- **Dependencia nueva:** `url_launcher`, el plugin oficial de Flutter para abrir WhatsApp y el correo.

## Pruebas
- **Núcleo:** 64 pruebas (12 nuevas). Cubren las plantillas por defecto en los tres idiomas frente al validador, los bloqueos y los falsos positivos del validador, la exclusión, los enlaces, la zona horaria con horario de verano, los presets sin revisión legal y un canal por semana.
- **API:** 88 pruebas con PostgreSQL 16 real (15 nuevas en `messaging.test.ts`):
  - **CA-10:** recordatorio pedido el domingo 11-oct-2026 a las 10:00 → martes 13-oct a las 07:00, porque el 12 es festivo.
  - **CA-11:** el segundo mensaje de cobranza del día queda bloqueado con `MAX_PER_DAY`.
  - **CA-20:** error 131031 al enviar y `account_update` por webhook: la empresa pasa al modo asistido sin perder mensajes y el propietario recibe el aviso.
  - **Otras:** la bienvenida con el PDF, el modo asistido fuera de franja, el enlace del recibo, las plantillas, el programador, la exclusión, los rebotes, las reglas por empresa y el remitente con DNS.
- **App:** 32 pruebas (4 nuevas): la lectura de un mensaje, CA-10 y CA-11 en pantalla, y los textos en portugués.

## Seguridad y privacidad
- Los enlaces de descarga de los mensajes solo llevan identificadores firmados y vencen.
- Los avisos del correo exigen un secreto, y los de WhatsApp la firma de Meta.
- Los registros no contienen datos personales: ni destinatarios ni textos de los mensajes.
- El Cobrador solo ve los mensajes de sus clientes (RLS).
- Solo el Propietario activa la Cloud API o declara la revisión legal de un preset.

## Límites conocidos
- **CA-20 con Meta:** se verificó con un Graph API de prueba que responde como Meta. Falta repetirlo con una cuenta real (P-4), que exige número dedicado, plantillas aprobadas y revisión legal.
- **Correo por Gmail u Outlook (OAuth):** pendiente de registrar la app en Google y Microsoft (P-7). Mientras tanto se usa Postmark o SMTP con el dominio de la empresa.
- **Plantillas con encabezado de documento en WhatsApp:** en el modo automático, el PDF va como enlace en el texto, igual que en el asistido.
- **Codeudores:** no reciben mensajes. §11.4 permite contactarlos en las mismas condiciones que al deudor; se agregará si se pide.
- **Entrada del correo por IMAP, Gmail o Graph:** sigue siendo por el webhook del proveedor (ADR-041).

## Cambios que requieren acción
- Aplique la migración `0005_fase4.sql`.
- Configure el correo saliente (`COROC_EMAIL_PROVIDER` y sus credenciales) y el webhook de avisos (`COROC_EMAIL_EVENTS_SECRET`). Sin proveedor, los correos quedan para enviarlos a mano.
- En Meta, suscriba además los campos `account_update` y `message_template_status_update` del webhook. En Configuración, registre el id de la cuenta de WhatsApp Business.
- Revise en Configuración › Reglas de contacto el preset y la hora de los recordatorios. Fuera de Colombia, los presets exigen la revisión del asesor legal.
- Registre el consentimiento de WhatsApp y de correo de cada cliente: sin él, sus mensajes quedan bloqueados con el motivo.
