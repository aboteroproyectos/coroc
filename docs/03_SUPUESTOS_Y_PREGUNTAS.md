# COROC · Supuestos y preguntas abiertas (§24.1-5)

## Preguntas que bloquean

Solo se listan las que detienen una fase. Mientras llega la respuesta, el trabajo sigue con la alternativa indicada.

| ID | Pregunta | Bloquea | Mientras tanto |
|---|---|---|---|
| P-1 | ¿En qué nube y región se despliega, y con qué dominio (por ejemplo, `app.coroc.co`)? ¿Quién es el titular de las cuentas? | Despliegue de la Fase 1 | Se desarrolla contra contenedores locales. La propuesta es AWS `sa-east-1` (São Paulo) o Cloudflare R2 con PostgreSQL gestionado |
| P-2 | ¿Existen ya cuentas de Apple Developer (organización), Google Play Console y un certificado de firma de código para Windows? Deben quedar a nombre de la empresa titular | Pruebas en dispositivos (TestFlight y prueba interna de Play) en la Fase 1; publicación en la Fase 5 | Compilaciones de depuración en emuladores |
| P-3 | ¿Puede entregar 40 o más comprobantes reales anonimizados (nombres y cuentas tachados) de Nequi, Daviplata, Bancolombia, Bre-B, Davivienda, BBVA, Banco de Bogotá, PSE, Efecty y corresponsales? Si opera en Brasil o EE. UU., también PIX y TED, o Zelle, Venmo y Cash App | Cierre de CA-19 (Fase 3) | El lector trabaja con los formatos ya verificados y todo lo que no alcance el umbral pasa a la Bandeja |
| P-4 | ¿Quiere intentar el modo automático de WhatsApp (Cloud API)? Meta prohíbe expresamente la cobranza de deudas en WhatsApp Business, así que la aprobación es incierta, y el intento exige un número dedicado y una revisión legal | CA-20 (Fase 4) | Modo asistido, enlace de carga y correo, que cubren todo el flujo sin Meta (ADR-007) |
| P-5 | ¿Quién revisa, como abogado, el aviso de privacidad (Ley 1581 y LGPD), el preset de la Ley 2300 y los textos de las fichas de tienda? | Publicación (Fase 5) | Se usan textos base con marca de borrador |
| P-6 | Las condiciones de ejemplo de CA-01 (20 % sobre el capital en 20 cuotas diarias) equivalen a una tasa efectiva anual muy superior a la usura, y COROC no deja crear ese préstamo en Colombia (ADR-026). ¿Qué tasas y plazos usa realmente en sus préstamos diarios? ¿Opera con una figura distinta al crédito de consumo que tenga otro tope? | Uso real en Colombia desde la Fase 1 | La vista previa muestra la tasa efectiva anual y ofrece la tasa máxima que cumple. CA-05 y CA-06 se verifican en una empresa sin tope (ADR-027) |

## Supuestos

Si alguno no es correcto, basta con indicarlo; todos se cambian desde Configuración o con una ADR nueva.

| ID | Supuesto |
|---|---|
| S-1 | La primera empresa opera en Colombia: COP, zona `America/Bogota`, festivos de Colombia y preset de la Ley 2300. Brasil y EE. UU. quedan como presets para revisar con asesor legal (§11.4) |
| S-2 | El método por defecto es el interés simple sobre el capital; el sistema francés se elige por préstamo |
| S-3 | Umbrales por defecto: confianza de 0,95 para registrar solo, 72 horas para revertir con un toque, 30 días de antigüedad máxima del comprobante y redondeo COP a 1 peso |
| S-4 | El propietario registra la tasa de usura certificada y su vigencia. El 25 % E.A. de los datos de demostración es ilustrativo |
| S-5 | La suscripción se vende y se cobra fuera de las apps (§20.4). La facturación de la suscripción no forma parte de COROC en estas fases |
| S-6 | Proveedores propuestos, detrás de adaptadores (§4.5): Google Document AI para OCR, la API de Claude con salida JSON validada para la extracción, Amazon SES para el correo saliente y S3 con cifrado del lado del servidor. Cada uno requiere acuerdo de tratamiento de datos (§20.1) |
| S-7 | Las carpetas y archivos locales usan nombres sin tildes (ADR-013). En la app y en los documentos el nombre se ve completo |
| S-8 | La app HTML de esta entrega guarda los datos en el navegador del equipo donde se abre y no sincroniza entre dispositivos. La sincronización, el portal del deudor y el correo entrante llegan con el servidor (fases 1 a 4) |
| S-9 | El calendario de festivos se incluye como datos versionados para 2025–2031 (Colombia, Brasil y EE. UU.) y se actualiza sin cambiar código |
