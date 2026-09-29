# COROC · Supuestos y preguntas abiertas (§24.1-5)

## Preguntas que bloquean

Solo se listan las que detienen una fase. Mientras llega la respuesta, el trabajo sigue con la alternativa indicada.

| ID | Pregunta | Bloquea | Mientras tanto |
|---|---|---|---|
| P-10 | ¿Qué dominio usará COROC y quién lo registra? | Direcciones definitivas de la API y de los enlaces de recibos y del portal | Se usa `https://coroc-api.fly.dev`. Cambiarlo son tres pasos (06 §6) |
| P-2 | ¿Existen ya cuentas de Apple Developer (organización), Google Play Console, Microsoft Partner Center y un certificado de firma de código para Windows? Deben quedar a nombre de la empresa titular | Publicación (Fase 5) | El flujo `release.yml` ya compila las cuatro plataformas y firma y publica en cuanto se carguen los secretos (ADR-059). Sin ellos, compila sin firma |
| P-3 | ¿Puede entregar 40 o más comprobantes reales anonimizados (nombres y cuentas tachados) de Nequi, Daviplata, Bancolombia, Bre-B, Davivienda, BBVA, Banco de Bogotá, PSE, Efecty y corresponsales? Si opera en Brasil o EE. UU., también PIX y TED, o Zelle, Venmo y Cash App | Medición definitiva de CA-19 | En la Fase 3 CA-19 se midió con 43 comprobantes sintéticos de 18 formatos (`services/api/test/receipts/dataset.ts`); con los reales se repite la misma prueba. Todo lo que no alcance el umbral pasa a la Bandeja. **Avance (24/09/2026):** llegaron los primeros 9 reales, de Pix (Nubank, Mercado Pago, Inter, PagBank). Con ellos se ajustó el lector: secciones «Destino/Origem», «Origem e destino», «Quem recebeu/Quem pagou», el identificador Pix (E2E) aunque el OCR lo parta, «RS» por R$, «22/setembro/2026» y «22h25». Quedan 5 de 5 bien leídos con OCR real y pruebas con los formatos anonimizados. Faltan los de Colombia |
| P-4 | ¿Quiere intentar el modo automático de WhatsApp (Cloud API)? Meta prohíbe expresamente la cobranza de deudas en WhatsApp Business, así que la aprobación es incierta, y el intento exige un número dedicado y una revisión legal | Uso real del modo automático | Modo asistido, enlace de carga y correo, que cubren todo el flujo sin Meta (ADR-007). El modo automático y el paso al asistido ante una suspensión ya están implementados y probados con un Graph API de prueba (CA-20, ADR-047) |
| P-5 | ¿Quién revisa, como abogado, la política de privacidad pública (Ley 1581 y LGPD), el preset de la Ley 2300, el plazo de gracia del cierre de empresa y los textos de las fichas de tienda? | Publicación (Fase 5) | La política está publicada en `/v1/public/privacy` (ADR-058) y las fichas en `11_FICHAS_DE_TIENDA.md`, pendientes de la revisión legal |
| P-7 | ¿Enviará el correo desde el Gmail o el Outlook de la empresa? Requiere registrar COROC como app en Google Cloud y en Microsoft Entra, con su verificación | Envío por OAuth (§11.2) | Correo por Postmark o SMTP propio con el dominio de la empresa verificado (SPF, DKIM y DMARC), o desde el remitente de COROC con el nombre de la empresa (ADR-048) |
| P-8 | ¿Quién hará la prueba de penetración externa antes de producción, y con qué alcance? | Paso a producción | Suite de penetración automatizada sobre el contrato, `npm audit` y OWASP ZAP en cada cambio (ADR-052) |
| P-9 | ¿Hay teléfonos de gama media y de apoyo (TalkBack, VoiceOver, Narrador) para medir el arranque en frío y probar los lectores de pantalla? | Cierre de §21 en dispositivos | Pruebas automáticas de contraste, áreas táctiles, etiquetas y texto al 200 % (Fase 5) |

## Preguntas respondidas

| ID | Pregunta | Respuesta | Qué cambió |
|---|---|---|---|
| P-1 | ¿En qué nube y región se despliega, con qué dominio y a nombre de quién? | PaaS gestionado; aún sin dominio (24 de septiembre de 2026) | Fly.io en São Paulo, Fly Postgres y Cloudflare R2. Las cuentas van a nombre de la empresa titular. Se usa `coroc-api.fly.dev` hasta tener dominio (ADR-060, 06 §6) |
| P-6 | Las tasas de los préstamos diarios de ejemplo (CA-01) superan la usura y COROC no dejaba crearlos en Colombia (ADR-026). ¿Qué tasas usa realmente? | «Se deberá dejar usar tasas más altas, si el usuario lo desea» (24 de septiembre de 2026) | La empresa elige entre bloquear (predeterminado) o solo advertir. Solo el Propietario activa «solo advertir», aceptando la responsabilidad legal, y cada préstamo por encima del tope se confirma y queda marcado y auditado (ADR-061) |

## Supuestos

Si alguno no es correcto, basta con indicarlo; todos se cambian desde Configuración o con una ADR nueva.

| ID | Supuesto |
|---|---|
| S-1 | La primera empresa opera en Colombia: COP, zona `America/Bogota`, festivos de Colombia y preset de la Ley 2300. Brasil y EE. UU. quedan como presets para revisar con asesor legal (§11.4) |
| S-2 | El método por defecto es el interés simple sobre el capital; el sistema francés se elige por préstamo |
| S-3 | Umbrales por defecto: confianza de 0,95 para registrar solo, 72 horas para revertir con un toque, 30 días de antigüedad máxima del comprobante y redondeo COP a 1 peso |
| S-4 | El propietario registra la tasa de usura certificada y su vigencia. El 25 % E.A. de los datos de demostración es ilustrativo |
| S-5 | La suscripción se vende y se cobra fuera de las apps (§20.4). La facturación de la suscripción no forma parte de COROC en estas fases |
| S-6 | Proveedores propuestos, detrás de adaptadores (§4.5): Google Document AI para OCR, la API de Claude con salida JSON validada para la extracción, Postmark o SMTP (Amazon SES por SMTP) para el correo saliente y S3 con cifrado del lado del servidor. Cada uno requiere acuerdo de tratamiento de datos (§20.1) |
| S-7 | Las carpetas y archivos locales usan nombres sin tildes (ADR-013). En la app y en los documentos el nombre se ve completo |
| S-8 | La app HTML de esta entrega guarda los datos en el navegador del equipo donde se abre y no sincroniza entre dispositivos. La sincronización, el portal del deudor y el correo entrante llegan con el servidor (fases 1 a 4) |
| S-9 | El calendario de festivos se incluye como datos versionados para 2025–2031 (Colombia, Brasil y EE. UU.) y se actualiza sin cambiar código |
