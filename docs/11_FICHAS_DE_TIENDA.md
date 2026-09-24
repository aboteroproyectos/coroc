# COROC · Fichas de tienda y declaraciones de privacidad

Fase 5, §20.4. Este documento es la fuente de lo que se escribe en Google Play Console, App Store Connect y Microsoft Partner Center. Las respuestas de privacidad salen de lo que la app hace de verdad, según el código de la versión 0.5.0:
- permisos declarados;
- datos que envía a la API;
- caché cifrada sin conexión (ADR-055);
- eliminación de cuenta (ADR-056).

Antes de enviar, compárelas con la redacción vigente de cada formulario: las tiendas cambian sus preguntas.

Enlace público de la política de privacidad, el mismo para las tres tiendas y la app:
`https://api.coroc.app/v1/public/privacy`. Acepta `?lang=es|pt-BR|en` y sirve el idioma del navegador si no se indica.

## 1. Ficha

| Campo | Español | Português (Brasil) | English |
|---|---|---|---|
| Nombre | COROC | COROC | COROC |
| Subtítulo (App Store, 30) | Cartera y cobros en orden | Carteira e cobranças em dia | Loan portfolio, in order |
| Descripción corta (Play, 80) | Préstamos, pagos, recibos y cobros de tu cartera, en un solo lugar. | Empréstimos, pagamentos, recibos e cobranças da sua carteira, num só lugar. | Loans, payments, receipts and collections for your portfolio, in one place. |
| Categoría | Negocios (Play y App Store) · Productividad (Microsoft) | igual | same |
| Clasificación de contenido | Para todos. Sin contenido generado por usuarios que sea público. | igual | same |
| Palabras clave (App Store, 100) | cartera,préstamos,cobranza,recibos,pagos,cuotas,prestamista,cobrador | carteira,empréstimos,cobrança,recibos,pagamentos,parcelas,credor | portfolio,loans,collections,receipts,payments,installments,lender |

### Descripción larga

**Español.** COROC es la herramienta de gestión de cartera para quienes prestan dinero: cada cliente, cada préstamo, cada cuota y cada pago en orden.
- Planes de pago exactos, con interés simple o francés, diario, semanal, quincenal o mensual, y con festivos.
- Registro de pagos con recibo en PDF. Los comprobantes que envía el deudor por WhatsApp, correo o su enlace personal se leen solos.
- Recordatorios y recibos por WhatsApp y correo, siempre dentro de las reglas de contacto de la ley y con el consentimiento del cliente.
- Tablero con lo cobrado, lo vencido y lo por cobrar hoy, y roles para Propietario, Administrador, Cobrador y Auditor.
- Funciona sin conexión para consultar y registrar pagos. Respaldo cifrado y carpeta COROC en el computador.

COROC no ofrece ni otorga préstamos: es un programa para que la empresa administre su propia cartera. Se contrata por empresa, fuera de la app; en la app solo se inicia sesión.

**Português.** O COROC é a ferramenta de gestão de carteira para quem empresta dinheiro: cada cliente, cada empréstimo, cada parcela e cada pagamento em ordem.
- Planos de pagamento exatos, com juros simples ou Price, diários, semanais, quinzenais ou mensais, e com feriados.
- Registro de pagamentos com recibo em PDF. Os comprovantes que o devedor envia por WhatsApp, e-mail ou pelo seu link pessoal são lidos automaticamente.
- Lembretes e recibos por WhatsApp e e-mail, sempre dentro das regras de contato da lei e com o consentimento do cliente.
- Painel com o recebido, o vencido e o que cobrar hoje, e funções para Proprietário, Administrador, Cobrador e Auditor.
- Funciona sem conexão para consultar e registrar pagamentos. Backup criptografado e pasta COROC no computador.

O COROC não oferece nem concede empréstimos: é um programa para a empresa administrar a sua própria carteira. A contratação é feita por empresa, fora do app; no app apenas se faz login.

**English.** COROC is the portfolio management tool for lenders: every customer, loan, installment and payment in order.
- Exact payment plans with simple or amortized interest, daily, weekly, biweekly or monthly, holiday-aware.
- Payment recording with a PDF receipt. Proofs of payment that borrowers send by WhatsApp, email or their personal link are read automatically.
- Reminders and receipts by WhatsApp and email, always within the legal contact rules and with the customer's consent.
- Dashboard with what was collected, what is overdue and what is due today, and roles for Owner, Administrator, Collector and Auditor.
- Works offline to look things up and record payments. Encrypted backup and a COROC folder on the computer.

COROC does not offer or grant loans: it is software for a company to manage its own portfolio. It is purchased per company, outside the app; the app only signs in.

### Capturas

Se generan en español, portugués y inglés, en modo claro, con datos de demostración (nunca de clientes reales):
1. Tablero.
2. Cobros de hoy.
3. Ficha del cliente con su plan.
4. Registro de pago con la vista previa.
5. Recibo en PDF.
6. Bandeja de comprobantes.
7. Mensajería «Por enviar hoy».
8. Configuración › Soporte.

Tamaños: teléfono de 6,7″ y 5,5″, iPad de 13″, Play teléfono y tableta de 10″, y Windows y macOS de 1920 × 1080.

## 2. Google Play

### Permisos
- `INTERNET`.
- `USE_BIOMETRIC` (desbloqueo con huella o rostro).

Nada más: sin almacenamiento amplio, SMS, contactos, ubicación ni cámara. Los archivos se leen con el selector del sistema o con «Compartir con COROC» (§20.4).

### Declaración de funciones financieras

Describa COROC como **herramienta de gestión de cartera para prestamistas que no ofrece ni otorga préstamos a consumidores** (§20.4). Texto sugerido para el campo de descripción:

> COROC es un software de gestión (SaaS) que usan empresas prestamistas para administrar su propia cartera: clientes, planes de pago, registro de pagos, recibos y recordatorios. La app no ofrece, intermedia ni otorga préstamos, no recibe ni transfiere dinero y no evalúa crédito de consumidores. Solo pueden ingresar los usuarios que la empresa crea; las cuentas se contratan fuera de la app.

Elija en el formulario la categoría que corresponda a software para prestamistas. Si ninguna encaja, use «otra» con el texto anterior; no marque «préstamos personales ofrecidos por la app». La licencia o el registro de la empresa prestamista no aplican a COROC, que no presta.

### Seguridad de los datos (Data safety)

| Tipo de dato (Play) | ¿Se recopila? | ¿Se comparte? | Propósito | ¿Opcional? |
|---|---|---|---|---|
| Información personal › Nombre | Sí | No | Funcionalidad de la app; administración de la cuenta | No |
| Información personal › Dirección de correo | Sí | No | Funcionalidad de la app; administración de la cuenta | Sí |
| Información personal › Número de teléfono | Sí | No | Funcionalidad de la app | No |
| Información personal › Dirección | Sí | No | Funcionalidad de la app | Sí |
| Información personal › Otra información (documento de identidad) | Sí | No | Funcionalidad de la app | Sí |
| Información financiera › Otra información financiera (préstamos, pagos, recibos) | Sí | No | Funcionalidad de la app | No |
| Fotos y videos › Fotos (comprobantes que el usuario elige o comparte) | Sí | No | Funcionalidad de la app | Sí |
| Archivos y documentos (PDF de comprobantes y documentos del cliente) | Sí | No | Funcionalidad de la app | Sí |
| Actividad en la app › Otras acciones (bitácora de auditoría) | Sí | No | Prevención de fraude, seguridad y cumplimiento | No |
| ID de dispositivo u otros (identificador propio de la instalación) | Sí | No | Prevención de fraude, seguridad y cumplimiento; administración de la cuenta | No |

- **«No se comparte»:** los proveedores que tratan datos por cuenta de COROC (alojamiento, correo, WhatsApp Business y lectura de comprobantes) son proveedores de servicios según la definición de Play, así que no cuentan como compartir.
- **Cifrado en tránsito:** sí (TLS).
- **Eliminación:** sí, desde la app (Configuración › Eliminar mi cuenta) y con la URL de la política.
- **Otras respuestas:** sin anuncios, sin seguimiento entre apps, y la app no está dirigida a menores.

## 3. App Store

### Privacidad de la app (App Privacy)

Todos los datos están **vinculados a la identidad**, **no se usan para rastrear** y su propósito es **Funcionalidad de la app**. Los identificadores sirven además para Seguridad (prevención de fraude).

| Categoría | Tipos |
|---|---|
| Información de contacto | Nombre, correo electrónico, número de teléfono, dirección física |
| Información financiera | Otra información financiera |
| Contenido del usuario | Fotos o videos; otro contenido del usuario (PDF de comprobantes) |
| Identificadores | ID de usuario; ID del dispositivo |

No se recopilan ubicación, contactos, historial de navegación ni de búsqueda, datos de uso para analítica ni diagnósticos.

### Notas para la revisión
- **3.1.3 (servicios multiplataforma y empresariales):** COROC se contrata por empresa, fuera de la app. La app no vende nada ni enlaza a una compra; solo permite iniciar sesión. Revise la sección vigente al enviar.
- **5.1.1(v) Eliminación de cuenta:** Configuración › Eliminar mi cuenta. El Propietario cierra la empresa desde el mismo lugar.
- **Cuenta de demostración:** empresa `demo`, usuario `revision` con rol Administrador, sin segundo factor, y datos de demostración. Se crea al tener el entorno público (P-1).
- **Cifrado:** `ITSAppUsesNonExemptEncryption = false`. Solo se usa cifrado estándar del sistema y de TLS, y AES-GCM para los datos propios en el equipo, que es uso exento.

## 4. Microsoft Store y descarga directa (Windows)
- Paquete MSIX (`co.coroc.coroc`) con la capacidad `internetClient`.
- Para la tienda, el MSIX se sube sin firma propia y lo firma Microsoft.
- Para descarga directa, se firma con el certificado de la empresa (`WINDOWS_CERTIFICATE_*`).
- Mismas respuestas de privacidad y el mismo enlace a la política.

## 5. macOS (descarga directa)
DMG firmado con Developer ID, notarizado y grapado por el flujo de publicación (`.github/workflows/release.yml`).

## 6. Pendiente para publicar (P-2)
- Cuentas de desarrollador: Google Play Console, Apple Developer Program y Microsoft Partner Center.
- Certificados y secretos del flujo de publicación (lista al inicio de `release.yml`).
- Entorno público y cuenta de demostración (P-1).
- Las capturas finales.
