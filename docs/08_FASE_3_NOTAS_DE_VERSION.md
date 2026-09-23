# COROC 0.3.0 · Fase 3 «Recepción y lectura» · Notas de versión

Fecha: 23 de septiembre de 2026.
Rama: `fase-3`.

La Fase 3 hace que los comprobantes lleguen solos y se lean solos:
- recepción por WhatsApp, correo, portal del deudor, «Compartir con COROC», carpeta vigilada y la app;
- lectura con OCR (y, si se activa, con IA);
- identificación del remitente y validaciones;
- registro automático de lo inequívoco y Bandeja de validación para todo lo demás.

Se cierra con CA-07, CA-08 y CA-09 en verde por la API con OCR real, y con CA-19 en verde sobre un conjunto sintético de 43 comprobantes. El conjunto real sigue pendiente (P-3). El detalle está en [04_CRITERIOS_DE_ACEPTACION.md](04_CRITERIOS_DE_ACEPTACION.md).

## Novedades

### Servidor (`services/api`)
- **Canales de recepción (§12):**
  - **WhatsApp Cloud API:** webhook con firma obligatoria y descarga inmediata del medio.
  - **Correo:** buzón `pagos-<empresa>@…`, en formato Postmark.
  - **Portal del deudor:** página sin JavaScript donde el deudor ve su plan y sube el comprobante; el enlace lo identifica.
  - **Desde la app:** «Compartir con COROC», carpeta vigilada y subida manual.
- **Lectura (§13.2, ADR-037):**
  - capa de texto del PDF con pdf.js;
  - imágenes y PDF escaneados con Tesseract 5 (español, portugués e inglés), con detección de orientación;
  - el texto queda para la búsqueda del repositorio;
  - señales de alteración en los metadatos: programas de edición y PDF modificados después de creados.
- **Extracción (§13.3):**
  - el lector por reglas de `@coroc/core` corre siempre;
  - con `COROC_EXTRACTION=claude`, la IA con visión (salida JSON validada) es la principal y las reglas la verifican;
  - cada campo trae su confianza y la región de la imagen donde se leyó.
- **Identificación del remitente (§12.7):** por enlace, carpeta, número (también el del codeudor) o correo. Si no se reconoce, sugiere clientes por el nombre del pagador y el valor. Elige el préstamo por el valor de la cuota o por la cuota vencida más antigua.
- **Validaciones (§13.4):**
  - beneficiario contra las cuentas receptoras;
  - pagador frente al cliente;
  - fecha y antigüedad, valor y moneda;
  - antiduplicado doble: archivo y huella lógica (ADR-038);
  - señales de alteración.
- **Decisión automática (§13.5):** en modo «Automático con auditoría», el pago se registra al instante solo si todo es inequívoco y supera la confianza mínima. Se revierte con un toque durante 72 horas (configurable). En modo «Aprobación previa», todo pasa por la Bandeja. El pago y el estado del comprobante van en la misma transacción (ADR-039).
- **Bandeja (§13.6):**
  - listar y contar;
  - aprobar corrigiendo o reasignando, y aprobar en lote;
  - rechazar con motivo o marcar «No es comprobante» (se archiva en Otros documentos);
  - revertir un registro automático;
  - guardar el número del remitente como secundario (CA-08).

  Cada corrección queda como ejemplo de la empresa.
- **Configuración:** número de WhatsApp Business de la empresa, con el token cifrado.
- **Base de datos y contrato:** migración `0004_fase3.sql`; contrato OpenAPI 0.4.0 con 88 operaciones (8 nuevas).

### App Flutter (`apps/coroc_app`)
- **Bandeja de validación:**
  - contador en la navegación y filtros;
  - aprobación en lote;
  - vista dividida: el comprobante con los campos leídos resaltados y el formulario con la confianza de cada campo;
  - cliente sugerido o buscado, préstamo, y saldo antes y después;
  - aprobar con Enter, rechazar, «No es comprobante» y revertir.
- **«Compartir con COROC»** en Android e iOS (plugin `coroc_share`, ADR-042): al compartir desde WhatsApp, el comprobante va a la Bandeja y se abre para confirmar el cliente.
- **Carpeta vigilada** en Windows y macOS (ADR-043): las fotos y PDF de `_Entrada` o de la carpeta de un cliente van solos a la Bandeja.
- **Enlace de carga** en el resumen del préstamo: crear, copiar, compartir, cambiar y desactivar.
- **«Subir comprobante»** en la ficha del cliente y en la Bandeja.
- **Configuración:**
  - cuentas receptoras;
  - registro automático: modo, confianza mínima, antigüedad máxima y plazo para revertir;
  - WhatsApp Business;
  - interruptor de la carpeta vigilada.

  En teléfonos, Informes pasa a Configuración para dejar sitio a la Bandeja.
- **Ayuda:** 4 temas nuevos (Bandeja, enlace de carga, «Compartir con COROC», cuentas receptoras).
- **Textos:** 137 nuevos, en 3 idiomas.

### Infraestructura
- La imagen Docker y la CI incluyen Tesseract (español, portugués e inglés) y Poppler.
- En CI, las pruebas de OCR son obligatorias (`COROC_REQUIRE_OCR=1`).

## Pruebas
- **Núcleo:** 52 pruebas (lectura de formularios en tabla y referencias en el renglón siguiente).
- **API:** 73 pruebas con PostgreSQL 16 real y OCR real. Incluyen:
  - **CA-07:** WhatsApp y luego el mismo comprobante en PDF por correo; queda DUPLICADO.
  - **CA-08:** número desconocido; queda «Sin asignar» con sugerencias y, al asignarlo, se guarda el número.
  - **CA-09:** el pago no se hizo a las cuentas de la empresa; va a revisión con alerta.
  - **Portal del deudor:** registro automático y reversión con un toque.
  - **«Aprobación previa»:** con aprobación en lote.
  - **Visibilidad del Cobrador.**
  - **CA-13:** también restaura la Bandeja.
- **CA-19:** 43 comprobantes sintéticos de 18 formatos, como capturas, PDF y fotos de papel. Resultado: valor 100 %, fecha 100 %, nombres 97,7 %. Ningún campo errado llega con confianza de aplicación automática. Tarda unos 10 s.
- **App:** 28 pruebas, entre ellas la lectura de un elemento de la Bandeja, su fila y la carpeta `_Entrada`. En las notas de la Fase 2 se informaron 26 pruebas de la app; eran 25.

## Seguridad y privacidad
- Los webhooks exigen firma (WhatsApp) o secreto (correo), y el portal limita los envíos.
- Los tokens de WhatsApp y de los enlaces de carga se guardan cifrados.
- El portal no muestra apellidos ni documentos del deudor.
- El Cobrador solo ve en la Bandeja lo de sus clientes; «Sin asignar» es del Propietario y el Administrador (RLS).
- Un comprobante con señales de alteración nunca se registra solo.
- El texto de un comprobante nunca se trata como instrucción para la IA.

## Límites conocidos
- **CA-19 con comprobantes reales:** la medición usa un conjunto sintético que imita los rótulos de cada entidad. Falta el conjunto de 40 o más comprobantes reales anonimizados (P-3).
- **HEIC:** se recibe y se guarda, pero el servidor no lo lee con OCR; va a revisión. Las fotos del iPhone compartidas desde WhatsApp suelen llegar en JPEG.
- **OCR en la nube:** Document AI, Textract y Azure quedan como adaptadores futuros (ADR-037).
- **WhatsApp:** los estados de entrega, los mensajes de texto y el envío llegan en la Fase 4.
- **iOS:** «Compartir con COROC» usa «Abrir con»; la extensión para compartir con vista previa llega con la firma (P-2).
- **Proxy:** el correo entrante acepta hasta 40 MB por mensaje; el proxy debe permitirlo en `/v1/webhooks/email/inbound`.

## Cambios que requieren acción
- Aplique la migración `0004_fase3.sql`.
- Registre las cuentas receptoras en Configuración: sin ellas ningún pago se registra solo.
- Para WhatsApp, defina `COROC_WHATSAPP_APP_SECRET` y `COROC_WHATSAPP_VERIFY_TOKEN`, configure el webhook en Meta con la URL que muestra Configuración y conecte el número de cada empresa.
- Para el correo, defina `COROC_INBOUND_EMAIL_DOMAIN` y `COROC_INBOUND_EMAIL_SECRET` y apunte el webhook del proveedor a `/v1/webhooks/email/inbound?token=…`.
- Opcional: `COROC_EXTRACTION=claude` y `ANTHROPIC_API_KEY` para la extracción con IA. Requiere el acuerdo de tratamiento de datos (S-6).
