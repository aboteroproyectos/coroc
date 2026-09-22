# PROMPT MAESTRO · COROC
## Plataforma multiplataforma de gestión y cobro de préstamos personales

Versión 1.0 · Septiembre de 2026 · Especificación obligatoria
Adjunto obligatorio: `Logo_COROC.jpeg` (logo oficial de la marca)

---

## 0. ROL QUE ASUMES

Actúa como arquitecto de software principal y líder técnico de un equipo senior que ha entregado más de 10.000 productos exitosos. Tu especialidad: sistemas contables y de cartera, motores de amortización, gestión documental, OCR e IA aplicada a documentos, mensajería transaccional, seguridad de datos financieros y diseño de producto premium.

Tu estándar es el de un producto cuya suscripción cuesta más de USD 5.000: cero improvisación, cero errores de cálculo, trazabilidad total y una experiencia visual impecable.

---

## 1. MISIÓN

Construir **COROC**: aplicación nativa para **Android, iOS, Windows y macOS** (una sola base de código) con backend en la nube, para que prestamistas y empresas de préstamos personales administren clientes, planes de pago, recaudo y documentos. La referencia funcional son las apps de cobro tipo Cobraap, y COROC debe superarlas en automatización, precisión contable y diseño.

**Principio rector: "Registras una vez, COROC hace el resto y tú supervisas".**
El usuario solo ingresa los datos del cliente y del préstamo al crearlo. Todo lo demás ocurre automáticamente en el servidor, aun con todos los dispositivos apagados: plan de pagos, recordatorios, recepción de comprobantes, lectura de documentos, registro de pagos, emisión de recibos, archivo documental y actualización del dashboard. Cada acción automática queda visible y auditable, y el usuario puede revertirla.

---

## 2. REGLAS DE TRABAJO NO NEGOCIABLES

1. **Producto terminado.** Cero `TODO`, cero datos de ejemplo en producción, cero funciones simuladas, cero botones sin acción.
2. **No inventes APIs, endpoints, parámetros ni librerías.** Toda integración externa (WhatsApp Cloud API, correo, OCR, tiendas de apps) se implementa contra su documentación oficial vigente, y la versión usada se cita en el documento de arquitectura.
3. **Decisiones documentadas.** Toda decisión que este prompt no especifique la tomas con criterio profesional y la registras en dos lugares: `docs/DECISIONES.md` (ADR numerados) y el módulo **Ayuda** dentro de la app, en lenguaje claro para el usuario.
4. **Nada ilegal ni contra políticas de plataforma.** Si un requisito es técnicamente imposible, ilegal o viola las políticas de una plataforma, no lo simules ni lo "hackees": detente, explica por qué, propón la alternativa más cercana y continúa con ella. Este prompt ya resuelve los casos conocidos (§11.1, §11.4, §9.6 y §20).
5. **Dinero.** Nunca `float` ni `double`: usa enteros en la unidad mínima de la moneda o `Decimal` de precisión fija. El redondeo es explícito y documentado (§9.4).
6. **Libro inmutable.** Ningún movimiento financiero se edita ni se borra. Las correcciones se hacen con reversos y ajustes que llevan motivo.
7. **Cero textos quemados.** Todo texto visible en la interfaz o en documentos generados pasa por el sistema de traducción (§6). Un lint en CI falla si aparece un texto literal visible.
8. **Calidad por fase.** Cada fase se entrega con pruebas automatizadas en verde (unitarias, integración y E2E) y con sus criterios de aceptación de §22 verificados.
9. **Privacidad desde el diseño.** Ningún dato personal en logs, trazas ni mensajes de error.
10. **Primero el diseño, luego el código.** Antes de programar, entrega los artefactos de §24.1 y espera aprobación.

---

## 3. ALCANCE Y PLATAFORMAS

| Plataforma | Versión mínima | Distribución |
|---|---|---|
| Android | 8.0 (API 26) | Google Play y APK firmado para distribución directa |
| iOS / iPadOS | 16 | App Store |
| Windows | 10 (22H2) y 11, x64 | Instalador MSIX firmado |
| macOS | 13 Ventura (Apple Silicon e Intel) | DMG firmado y notarizado |
| Portal del deudor | Navegadores modernos | Web responsiva, solo para que el deudor consulte su plan y suba comprobantes (§12.3) |

- **Multiempresa (multi-tenant):** cada suscriptor es una empresa aislada con sus propios usuarios, clientes, datos y archivos.
- **Clientes ilimitados:** la arquitectura debe soportar como mínimo 100.000 clientes y 2.000.000 de cuotas por empresa sin degradación perceptible (§21).

---

## 4. ARQUITECTURA Y STACK OBLIGATORIO

### 4.1 Apps (Android, iOS, Windows, macOS)
- **Flutter** (canal stable vigente) + Dart 3.
- Estado: Riverpod. Navegación: go_router. Modelos: freezed + json_serializable.
- Base local: drift (SQLite) cifrada con SQLCipher, para caché offline y cola de operaciones.
- Secretos: flutter_secure_storage (Keychain, Keystore, DPAPI).
- Biometría: local_auth.
- Internacionalización: flutter_localizations + archivos ARB con ICU MessageFormat.
- Notificaciones push: FCM (Android) y APNs (iOS/macOS).
- Gráficas: fl_chart o equivalente, con animaciones propias.

### 4.2 Backend
- **Node.js 22 LTS + TypeScript + NestJS.**
- **PostgreSQL 16** con Row Level Security por `tenant_id`.
- **Redis + BullMQ** para trabajos asíncronos: recepción de documentos, OCR, envío de mensajes, generación de PDF y respaldos.
- **Almacenamiento de archivos** compatible con S3 (AWS S3 o Cloudflare R2), con cifrado en reposo y URLs firmadas de corta duración.
- **PDF:** plantillas HTML/CSS renderizadas con Chromium headless (Playwright), para lograr tipografía de calidad editorial.
- API REST documentada con **OpenAPI 3.1** + eventos en tiempo real por WebSocket (o SSE) para el dashboard.
- Infraestructura como código (Terraform), contenedores Docker, CI/CD (GitHub Actions), observabilidad con OpenTelemetry + Sentry.

### 4.3 Por qué esta arquitectura
Las automatizaciones (recibir un comprobante a las 3 p. m., leerlo, registrarlo, emitir el recibo y enviarlo) deben correr aunque el celular y el PC del usuario estén apagados. Por eso toda la lógica de negocio vive en el servidor; las apps muestran, supervisan y mantienen una copia local en la carpeta COROC.

### 4.4 Módulos del backend
`auth` · `tenants` · `users` · `clients` · `loans` (motor financiero) · `ledger` (libro de movimientos) · `documents` (repositorio) · `intake` (recepción multicanal) · `extraction` (OCR + IA) · `messaging` (WhatsApp, correo, plantillas) · `compliance` (reglas de contacto y tasas) · `receipts` (PDF) · `reports` · `dashboard` · `backup` · `audit` · `i18n`

### 4.5 Proveedores externos detrás de interfaces (patrón adaptador)
Intercambiables sin tocar la lógica de negocio:
- `WhatsAppProvider`: WhatsApp Business Platform, Cloud API de Meta (§11.1).
- `EmailProvider`: salida por Amazon SES, Postmark o SMTP propio; OAuth con Gmail API y Microsoft Graph para buzones del usuario. Entrada por buzón dedicado por empresa + IMAP/Gmail/Graph.
- `OcrProvider`: Google Document AI, AWS Textract o Azure AI Document Intelligence.
- `ExtractionProvider`: modelo de IA con visión y salida JSON validada por esquema (por ejemplo, la API de Claude de Anthropic u otro equivalente).

### 4.6 Flujo central de automatización
```
Deudor ──(WhatsApp · correo · enlace de carga · compartir)──► RECEPCIÓN
   ▲                                                              │
   │                                                              ▼
RECIBO PDF ◄── ENVÍO (reglas de contacto) ◄── REGISTRO DEL PAGO ◄── VALIDACIÓN ◄── LECTURA (OCR + IA)
                                                  │
                                                  ▼
             Cuadro de pagos · Repositorio · Carpeta COROC · Dashboard en tiempo real
```

---

## 5. IDENTIDAD VISUAL Y DISEÑO

### 5.1 Logo (adjunto `Logo_COROC.jpeg`)
- **Composición:** isotipo dorado (símbolo de infinito formado por dos esferas de reloj con marcas horarias) + palabra **COROC** en azul noche + descriptor **PERSONAL LOANS** con tracking amplio.
- **Vectoriza el logo a SVG con fidelidad total.** No lo redibujes ni cambies proporciones, colores ni tipografía. Elimina el fondo.
- **Variantes:** (a) logotipo completo vertical; (b) horizontal, con el isotipo a la izquierda; (c) isotipo solo; (d) monocromo azul noche; (e) monocromo dorado; (f) versión para fondo oscuro: isotipo dorado + palabra en marfil `#FFFDE7`.
- **Íconos de app** a partir del isotipo sobre fondo azul noche: Android adaptativo (108 dp con zona segura), iOS 1024 px, Windows `.ico`, macOS `.icns`, favicon del portal.
- **Zona de respeto:** la altura de la "O" de COROC alrededor del logotipo. Ancho mínimo del logotipo completo: 120 px en pantalla.
- **Dónde va:** pantalla de ingreso (logotipo completo, grande y centrado), splash, barra lateral (isotipo + palabra), encabezado de todos los PDF y pie de los correos.

### 5.2 Paleta (muestreada del logo)

| Token | Hex | Uso |
|---|---|---|
| `navy-900` | `#0B0826` | Fondo del modo oscuro |
| `navy-800` | `#130E42` | Azul de marca (palabra COROC); texto principal en modo claro; barra lateral |
| `navy-600` | `#2A2466` | Superficies elevadas en modo oscuro |
| `gold-800` | `#8A6A2B` | Único dorado permitido para texto normal sobre fondo claro (contraste 5,0:1) |
| `gold-700` | `#A57E33` | Sombra del degradado; sobre fondo claro solo en íconos y cifras ≥ 24 px |
| `gold-500` | `#CAA555` | Dorado medio |
| `gold-300` | `#E9C879` | Brillo del degradado; texto dorado sobre fondo oscuro |
| `ivory` | `#FFFDE7` | Filetes finos, texto sobre oscuro, detalles |
| `paper` | `#F6F6F6` | Fondo del modo claro |
| `surface` | `#FFFFFF` | Tarjetas en modo claro |
| `ink-muted` | `#5B5878` (claro) / `#B8B4D6` (oscuro) | Texto secundario |
| Estados | Éxito `#2E7D5B` · Alerta `#B7791F` · Error `#B3261E` · Info `#2B5CAB` | Siempre acompañados de ícono o texto, nunca solo color |

**Degradado de marca:** `linear-gradient(135deg, #A57E33 0%, #CAA555 45%, #E9C879 70%, #A57E33 100%)`. Solo se usa en el botón primario (con texto `navy-800`), el isotipo, el anillo de progreso y la cifra protagonista del dashboard.

**Reglas de lujo:**
- El dorado ocupa como máximo el 8–10 % de cualquier pantalla. El lujo está en el espacio, no en la decoración.
- Filetes de 1 px (`ivory` en oscuro, `#E8E4D8` en claro); esquinas de 16 px en tarjetas y 12 px en controles; sombras suaves de una sola capa.
- Sin ilustraciones genéricas, sin emojis y sin degradados fuera de los tokens.
- Contraste WCAG 2.2 AA en todo el texto. El dorado medio nunca se usa para texto sobre fondo claro.

### 5.3 Tipografía
- **Titulares y etiquetas: Montserrat** (licencia OFL), coherente con la geometría de la palabra COROC. Etiquetas en mayúsculas con tracking de 0,18 em, en el mismo espíritu de "PERSONAL LOANS".
- **Texto y cifras: Inter**, con cifras tabulares (`tnum`) para que las columnas de dinero queden alineadas.
- Escala: 12 / 14 / 16 / 20 / 24 / 32 / 44 / 56. Cifra protagonista del dashboard: 44–56 px, peso 300–400.
- Fuentes empaquetadas dentro de la app, nunca descargadas en tiempo de ejecución.

### 5.4 Modos
Claro **"Marfil"** y oscuro **"Medianoche"**. Por defecto sigue al sistema operativo; cada usuario puede elegir.

### 5.5 Movimiento
- Transiciones de 180–320 ms con curva `easeOutCubic`.
- Cifras del dashboard con conteo animado (900 ms) al cargar y al llegar un pago.
- Transición compartida de tarjeta a ficha del cliente.
- Háptica suave en móvil al confirmar un pago.
- Respetar la opción "reducir movimiento" del sistema.

### 5.6 Diseño adaptable
- Móvil: una columna y barra inferior de 5 destinos.
- Tableta: dos columnas.
- Escritorio: barra lateral fija + contenido + panel de detalle. Atajos: `Ctrl/Cmd + K` búsqueda global, `N` nuevo cliente, `Enter` aprobar en la bandeja.

### 5.7 Mapa de pantallas
1. **Ingreso:** logotipo completo, usuario, contraseña, "Recordarme en este dispositivo" y selector de idioma visible.
2. **Primer uso (asistente):** idioma → datos de la empresa → cuentas receptoras (§13.4) → creación de la carpeta COROC (§16.2) → canales WhatsApp y correo (§11) → reglas de contacto (§11.4) → listo.
3. **Dashboard** (§17).
4. **Cobros de hoy:** cuotas que vencen hoy y vencidas, ordenables, con estado y acción rápida (incluido registro de pago en efectivo).
5. **Clientes:** lista virtualizada, búsqueda instantánea y filtros (al día, en mora, frecuencia, cobrador, finalizados).
6. **Nuevo cliente:** asistente de 3 pasos (§8.3).
7. **Ficha del cliente:** pestañas Resumen · Cuadro de inversión y pagos · Documentos · Mensajes · Historial.
8. **Bandeja de validación** (§13.6).
9. **Mensajería:** plantillas, cola programada, historial y estado de los canales.
10. **Informes** (§18).
11. **Configuración:** empresa, usuarios y roles, cuentas receptoras, canales, cumplimiento, numeraciones, idioma, apariencia, carpeta COROC y respaldo.
12. **Ayuda:** guía de uso + decisiones documentadas.

---

## 6. IDIOMAS

- **Español (es-CO, idioma base), portugués de Brasil (pt-BR) e inglés (en-US).**
- Cambio instantáneo desde la pantalla de ingreso y desde Configuración, sin reiniciar la app. La preferencia se guarda por usuario.
- **Cada deudor tiene su idioma preferido:** los mensajes, recibos, estados de cuenta y paz y salvo que recibe se generan en su idioma, sin importar el idioma del usuario de COROC.
- Formatos por configuración regional: moneda (COP `$ 1.200.000`, BRL `R$ 1.200.000,00`, USD `$1,200,000.00`), fechas, separadores y plurales ICU ("1 cuota restante" / "19 cuotas restantes").
- Todas las cadenas viven en ARB (app) y en JSON de i18n (backend y plantillas PDF). Cobertura del 100 % en los tres idiomas, verificada en CI.
- Traducción profesional con terminología financiera local: cuota / parcela / installment; paz y salvo / termo de quitação / payoff letter.

---

## 7. ACCESO, USUARIOS Y SEGURIDAD

### 7.1 Ingreso con usuario y contraseña
- Contraseña de mínimo 12 caracteres, verificada contra listas de contraseñas filtradas; hash Argon2id.
- Bloqueo progresivo tras 5 intentos fallidos (15 minutos) y alerta al propietario.
- Segundo factor TOTP opcional; obligatorio para el rol Propietario.
- Sesión: token de acceso de 15 minutos + token de renovación rotativo ligado al dispositivo. Cierre remoto de sesiones desde Configuración.
- Desbloqueo biométrico (huella, Face ID, Windows Hello, Touch ID) después del primer ingreso. Bloqueo automático por inactividad configurable (por defecto, 5 minutos).
- Recuperación de contraseña por correo con enlace de un solo uso (30 minutos).

### 7.2 Roles

| Rol | Permisos |
|---|---|
| Propietario | Todo, incluidos suscripción, respaldo, restauración y eliminación de datos |
| Administrador | Todo excepto suscripción y restauración total |
| Cobrador | Solo sus clientes asignados; puede validar pagos; no puede reversar ni ver informes globales |
| Auditor | Solo lectura de todo, incluida la bitácora |

### 7.3 Protección de datos
- TLS 1.3 en tránsito; AES-256 en reposo (base de datos, archivos, respaldos y base local).
- Aislamiento por empresa con RLS y pruebas automatizadas de fuga entre empresas.
- Bitácora de auditoría inmutable: quién, qué, cuándo, desde qué dispositivo, valor anterior y valor nuevo.
- Verificación contra OWASP ASVS nivel 2 (backend) y OWASP MASVS L2 (móvil). Prueba de penetración antes del lanzamiento.
- Contenido oculto en el selector de apps del sistema (móvil) y datos personales enmascarados en logs.

---

## 8. CLIENTES Y PRÉSTAMOS

Un cliente puede tener varios préstamos a lo largo del tiempo (renovaciones), y cada préstamo tiene su propio número de contrato. El asistente de creación registra cliente y primer préstamo en un solo flujo.

### 8.1 Datos del cliente

| Campo | Regla |
|---|---|
| Nombre(s) | Obligatorio |
| Apellidos | Obligatorio |
| Código de cliente | Autogenerado (`C000001`), único e inmutable |
| Número de contacto principal (WhatsApp) | Obligatorio. Normalizado a E.164 con libphonenumber según el país de la empresa. Es la llave para identificar al remitente de documentos |
| Número secundario | Opcional, E.164. También identifica al remitente |
| Correo electrónico | Opcional, pero obligatorio para usar el canal de correo; validado |
| Dirección | Dirección + ciudad + país |
| Documento de identidad | Opcional (tipo y número) |
| Idioma preferido | es / pt-BR / en (por defecto, el de la empresa) |
| Codeudor | Opcional: nombre, teléfono y correo |
| Cobrador asignado | Opcional |
| Consentimientos | Por canal (WhatsApp y correo): fecha, método y evidencia (§20.1) |
| Notas | Texto libre |

No se registran "referencias personales" con fines de contacto: la Ley 2300 de 2023 de Colombia prohíbe contactarlas para cobranza.

### 8.2 Datos del préstamo

| Campo | Regla |
|---|---|
| Número de contrato | Consecutivo autogenerado con prefijo configurable (`CT-000001`). Editable al crear, para respetar contratos físicos existentes. Único por empresa |
| Capital prestado | Obligatorio, mayor que 0 |
| Moneda | Por defecto, la de la empresa |
| Método de cálculo | Interés simple fijo sobre capital (por defecto) o cuota fija con amortización francesa |
| Tasa de interés | % sobre el total del préstamo (simple) o % por período (francés) |
| Total de cuotas | Obligatorio, entero ≥ 1 |
| Forma de pago | **Diaria · Semanal · Mensual** |
| Fecha de desembolso | Obligatoria |
| Fecha de primera cuota | Por defecto, el siguiente día de cobro después del desembolso; editable |
| Días de cobro (diaria) | Por defecto, lunes a sábado; excluir festivos del país (activado por defecto) |
| Día de cobro (semanal) | Día de la semana |
| Día de cobro (mensual) | Día 1–31; si el mes no tiene ese día, el último día del mes |
| Mora | Opcional: cargo por día de atraso (% o valor fijo) y días de gracia, siempre dentro del tope legal (§9.6) |
| Medio de pago esperado | Transferencia, efectivo, billetera digital, etc. (informativo) |

### 8.3 Asistente "Nuevo cliente" (3 pasos)
1. Datos personales.
2. Condiciones del préstamo con **vista previa en vivo** del plan: valor de cuota, calendario, total a pagar, utilidad y tasa efectiva anual.
3. Canales y consentimientos + resumen final.

Validación en línea y detección de duplicados (mismo número o mismo documento) con aviso antes de guardar.

**Al guardar, automáticamente:** se genera el plan de pagos; se crea la carpeta del cliente en la nube y en la carpeta local COROC; se generan el PDF del plan de pagos y el resumen del contrato; y, si hay consentimiento, se envía el mensaje de bienvenida con el plan.

### 8.4 Entidades mínimas del modelo de datos
`Tenant`, `User`, `Role`, `Session/Device`, `Client`, `CoDebtor`, `Consent`, `Loan`, `Installment`, `LedgerEntry`, `Payment`, `PaymentAllocation`, `ReceivingAccount`, `Document`, `DocumentVersion`, `Extraction`, `IntakeEvent`, `Message`, `MessageTemplate`, `ContactRuleSet`, `HolidayCalendar`, `RateCap`, `Receipt`, `Report`, `Backup`, `AuditLog`, `NumberSequence`. Todas con `tenant_id`, marcas de tiempo UTC, autor y versión para concurrencia optimista.

---

## 9. MOTOR FINANCIERO

### 9.1 Interés simple fijo (estilo prestamista, por defecto)
`total_a_pagar = capital × (1 + tasa)`
`cuota = total_a_pagar ÷ número_de_cuotas`
Cada cuota se separa proporcionalmente en capital e interés para los informes.

### 9.2 Cuota fija (sistema francés)
`cuota = capital × i ÷ (1 − (1 + i)^−n)`, con `i` = tasa del período. Los intereses se calculan sobre el saldo. La última cuota ajusta el residuo para cerrar exactamente en cero.

### 9.3 Calendario
- **Diaria:** solo en los días de cobro configurados. Si se excluyen festivos, se usa el calendario oficial del país (en Colombia, con los traslados de la Ley Emiliani), mantenido como datos versionados y no como lógica fija en el código.
- **Semanal:** el mismo día cada semana; si cae en festivo, pasa al siguiente día de cobro.
- **Mensual:** el mismo día de cada mes; un día 29–31 inexistente pasa al último día del mes.
- Todas las fechas se calculan en la zona horaria de la empresa (por defecto, America/Bogota).

### 9.4 Redondeo
- Cada cuota se redondea a la unidad de redondeo de la moneda (COP: 1 peso, configurable a 50, 100 o 1.000; BRL y USD: 0,01) con redondeo "mitad hacia arriba".
- La última cuota absorbe la diferencia para que la suma de las cuotas sea exactamente el total pactado.

### 9.5 Aplicación de pagos (orden estricto)
1. Cargos por mora causados, empezando por la cuota vencida más antigua (si la mora está activa).
2. Cuotas pendientes en orden cronológico, empezando por la vencida más antigua.
3. **Excedente:** se abona a las cuotas futuras en orden (pago anticipado). Si supera el saldo total, queda como **saldo a favor** visible y el usuario decide si lo devuelve o lo aplica a un nuevo préstamo.

- Estados de cuota: Pendiente · Parcial · Pagada · Vencida · Condonada.
- **Cuotas restantes** = cuotas que no están totalmente pagadas.
- Un pago puede cubrir varias cuotas y dejar una parcial; el recibo lo refleja con exactitud (§15).

### 9.6 Tope legal de tasa
- COROC calcula la **tasa efectiva anual real** de cada préstamo como la TIR de sus flujos (desembolso frente a cuotas en sus fechas, incluidos los cargos).
- Configuración de cumplimiento por país. En Colombia, el usuario registra la **tasa de usura vigente certificada por la Superintendencia Financiera** y su período de vigencia; COROC recuerda actualizarla cuando vence.
- Si la tasa efectiva de un préstamo supera el tope vigente, COROC **no permite guardarlo** y muestra la tasa máxima que sí cumple. Los cargos por mora también se validan contra el tope.

### 9.7 Libro de movimientos (contable)
- Cada préstamo tiene un libro inmutable con estos tipos de movimiento: Desembolso, Pago, Aplicación a cuota, Cargo por mora, Condonación, Reverso, Ajuste y Saldo a favor.
- Los saldos siempre se derivan del libro, nunca se guardan editables.
- Toda corrección exige motivo y queda en la bitácora.
- Exportable a CSV y XLSX para la contabilidad.

---

## 10. CUADRO DE INVERSIÓN Y PAGOS (por cliente y por préstamo)

**Encabezado en tarjetas:** capital invertido · intereses pactados · total a recibir · recaudado · saldo pendiente · utilidad realizada · tasa efectiva anual · % de avance (anillo dorado) · próxima cuota (fecha y valor) · días de mora.

**Tabla del plan de pagos** (el definido al crear el préstamo): N.º de cuota · fecha de vencimiento · valor de la cuota · capital · interés · valor pagado · fecha de pago · estado · documento soporte (miniatura enlazada al repositorio) · recibo emitido · saldo después de la cuota.

- Se actualiza en tiempo real cuando se registra un pago automático.
- Estados con indicadores discretos (punto + texto), nunca filas con fondos saturados.
- Exportable a PDF y XLSX. La versión vigente se guarda automáticamente en el repositorio y en la carpeta local cada vez que cambia.

---

## 11. MENSAJERÍA AUTOMÁTICA (WhatsApp y correo)

### 11.1 Restricción de WhatsApp que condiciona el diseño (leer antes de implementar)

La Política de Mensajería de WhatsApp Business (sección 4, vigente a septiembre de 2026) **prohíbe usar los servicios de WhatsApp Business para "préstamos de día de pago, adelantos de nómina, préstamos entre pares, cobranza de deudas y fianzas"**, sin importar las licencias locales que tenga la empresa. Además:
- solo se puede escribir a personas que dieron su número y aceptaron expresamente recibir mensajes (opt-in);
- fuera de la ventana de 24 horas desde el último mensaje del cliente, solo se pueden enviar plantillas aprobadas por Meta.

**Consecuencias obligatorias de diseño:**
1. **Prohibido** automatizar WhatsApp con librerías no oficiales o emulación de WhatsApp Web (Baileys, whatsapp-web.js, WPPConnect, Venom y similares), con bots de escritorio o leyendo las carpetas internas de WhatsApp. Violan los términos de WhatsApp y exponen el número del cliente a bloqueo permanente; además, Android 11+ impide leer esas carpetas sin permisos que Google Play restringe.
2. **WhatsApp es un canal enchufable, nunca un punto único de falla.** COROC debe funcionar completo (recepción, lectura, registro y recibos) aunque la Cloud API no esté habilitada para la empresa.
3. **Dos modos de WhatsApp por empresa,** seleccionables en Configuración:

| Modo | Envío | Recepción e identificación del remitente | Requisitos |
|---|---|---|---|
| **A. Automático (Cloud API)** | Automático, con plantillas aprobadas (categoría utilidad) y respuestas libres dentro de la ventana de 24 h | Automática: el webhook entrega el número remitente y el archivo, que se descarga de inmediato | Cuenta de WhatsApp Business Platform verificada, número dedicado, plantillas aprobadas y revisión legal de que el caso de uso de la empresa es admisible para Meta |
| **B. Asistido (sin API)** | COROC redacta cada mensaje personalizado y abre WhatsApp con el texto listo (`https://wa.me/<número>?text=`); el usuario solo toca "Enviar". Cola "Por enviar hoy" para enviarlos uno tras otro | Enlace personal de carga (§12.3) incluido en cada mensaje + "Compartir con COROC" desde WhatsApp (§12.4) | Ninguno |

- El modo A se implementa completo, pero solo se activa tras una lista de verificación en Configuración: verificación del negocio, número, plantillas aprobadas y aceptación explícita del propietario sobre la política de Meta. Si Meta rechaza o suspende la cuenta, COROC pasa automáticamente al modo B sin perder mensajes en cola y avisa al propietario.
- En el modo B, los recibos PDF se entregan mediante **enlace seguro de descarga** dentro del mensaje (URL firmada con caducidad configurable, por defecto 30 días), porque `wa.me` no adjunta archivos. En móvil se ofrece además compartir el PDF directamente al chat mediante la hoja de compartir del sistema.

### 11.2 Correo electrónico
- Envío desde el dominio de la empresa (SPF, DKIM y DMARC configurados con asistente) o desde su Gmail u Outlook conectado por OAuth.
- Recibos y estados de cuenta como PDF adjunto + cuerpo HTML elegante con el logo.
- Manejo de rebotes y quejas; las direcciones inválidas se marcan en la ficha del cliente.

### 11.3 Mensajes automáticos
Cada uno se activa o desactiva de forma individual y tiene plantilla editable por idioma.

| Evento | Tipo | Momento por defecto | Canal por defecto |
|---|---|---|---|
| Bienvenida + plan de pagos | Transaccional | Al crear el préstamo | WhatsApp y correo |
| Recordatorio de cuota | Cobranza | Semanal y mensual: 1 día antes y el día del vencimiento, 8:00 a. m. Diaria: desactivado por defecto | WhatsApp |
| Pago recibido + recibo PDF | Transaccional | Al registrar el pago | Canal por el que llegó el comprobante |
| Cuota vencida | Cobranza | 1 día después del vencimiento, tono respetuoso | WhatsApp |
| Estado de cuenta | Transaccional | Mensual o a solicitud | Correo |
| Paz y salvo | Transaccional | Al quedar el saldo en cero | WhatsApp y correo |

**Variables disponibles:** `{{nombre}}`, `{{apellidos}}`, `{{contrato}}`, `{{valor_cuota}}`, `{{fecha_vencimiento}}`, `{{cuota_numero}}`, `{{cuotas_restantes}}`, `{{saldo}}`, `{{valor_pagado}}`, `{{enlace_carga}}`, `{{enlace_recibo}}`, `{{empresa}}`, `{{telefono_empresa}}`.

- Editor de plantillas con vista previa en vivo usando datos de un cliente real y contador de caracteres.
- **Contenido bloqueado por el validador al guardar:** amenazas o lenguaje intimidante; preguntar la causa del incumplimiento; menciones a terceros; solicitar números completos de tarjeta, cuenta o documento de identidad (esto último también lo prohíbe la política de WhatsApp).
- Cada mensaje queda en el historial del cliente con su estado: programado · enviado · entregado · leído · fallido · bloqueado por regla (indicando la regla).

### 11.4 Motor de reglas de contacto (cumplimiento)
Configurable por país. Preset **Colombia — Ley 2300 de 2023**, activado por defecto para empresas colombianas y aplicado a todo mensaje de tipo **Cobranza**:
- **Franjas permitidas:** lunes a viernes de 7:00 a. m. a 7:00 p. m.; sábados de 8:00 a. m. a 3:00 p. m.; **nunca domingos ni festivos**. Siempre en la hora local del deudor.
- **Máximo un contacto de cobranza por deudor por día.**
- Una vez establecido contacto con el deudor por un canal, **no se usan otros canales de cobranza en la misma semana.**
- **Nunca** se contacta a referencias. Los codeudores solo se contactan en las mismas condiciones que el deudor.
- Si el deudor autoriza otros horarios por escrito (en un documento distinto del contrato y posterior a él), se guarda la evidencia y se habilita la excepción solo para ese deudor.
- Los mensajes que caen fuera de franja se **reprograman automáticamente** al inicio de la siguiente franja válida.
- Los mensajes **transaccionales** (recibo, paz y salvo, estado de cuenta, bienvenida) también respetan la franja por defecto; el propietario puede habilitar su envío inmediato, y la decisión queda documentada en Ayuda.
- Hay presets para Brasil y EE. UU. como plantillas que el propietario debe revisar con su asesor legal antes de activarlas; mientras tanto se aplica el preset de Colombia, que es el más restrictivo.
- Cada decisión del motor queda registrada. Ejemplo: "Reprogramado para 13-oct-2026 07:00: fuera de franja (domingo) y 12-oct festivo".

---

## 12. RECEPCIÓN MULTICANAL DE DOCUMENTOS E IDENTIFICACIÓN DEL REMITENTE

**Objetivo:** todo documento que envía un deudor llega a COROC, se identifica a quién pertenece y se guarda en su repositorio sin intervención manual cuando la identificación es inequívoca.

### 12.1 WhatsApp (modo A)
Webhook `messages` → verificación de la firma `X-Hub-Signature-256` → idempotencia por ID de mensaje → **descarga inmediata del archivo** (imagen o PDF), porque la URL del medio caduca en minutos → se guardan el original y los metadatos: número remitente, fecha y hora, ID del mensaje y texto acompañante.

### 12.2 Correo
Dirección de recepción dedicada por empresa (por ejemplo, `pagos-<empresa>@<dominio de COROC>`) y/o buzón propio conectado. Se procesan adjuntos JPG, PNG, HEIC y PDF. Remitente = dirección de correo.

### 12.3 Enlace personal de carga (portal del deudor)
Cada préstamo tiene un enlace único, firmado y revocable, que se incluye en los mensajes. Allí el deudor ve su plan de pagos y sube su comprobante desde el celular. **El enlace determina la identidad del remitente**, así que el pago se vincula al cliente correcto sin depender de WhatsApp. Funciona en cualquier navegador, sin instalar nada, en el idioma del deudor y con la marca COROC.

### 12.4 "Compartir con COROC" (Android e iOS)
COROC aparece en la hoja de compartir del sistema (Android `ACTION_SEND` / `ACTION_SEND_MULTIPLE`; iOS Share Extension). El usuario reenvía el comprobante desde WhatsApp en dos toques. Como el sistema operativo no entrega el número del remitente, COROC propone el cliente más probable (nombre del pagador leído, valor que coincide con una cuota esperada, clientes con cuota hoy) y el usuario confirma con un toque.

### 12.5 Carpeta vigilada (escritorio, opcional)
COROC vigila `COROC/_Entrada` y las carpetas de los clientes. Un archivo nuevo sigue el mismo flujo; si se dejó en la carpeta de un cliente, ese cliente queda identificado.

### 12.6 Carga manual y pagos en efectivo
Arrastrar y soltar, o botón "Subir comprobante" en la ficha del cliente. Los pagos en efectivo se registran en dos toques desde "Cobros de hoy", con foto opcional, y generan el mismo recibo automático.

### 12.7 Regla de identificación del remitente
1. Normalizar el número a E.164 y buscarlo en los números principal y secundario de los clientes activos y de sus codeudores.
2. **Un solo cliente:** identificado. **Varios clientes con el mismo número** (familia): desempatar por nombre del pagador y valor; si persiste la duda, a la Bandeja de validación.
3. **Número desconocido:** a "Sin asignar" en la Bandeja, con sugerencias. Al asignarlo, COROC ofrece guardar ese número como secundario del cliente.
4. **Cliente con varios préstamos activos:** asignar al préstamo cuya cuota pendiente coincide con el valor; si ninguna coincide, al de la cuota vencida más antigua; si hay ambigüedad, a la Bandeja.

---

## 13. LECTURA INTELIGENTE DE DOCUMENTOS (OCR + IA)

### 13.1 Pipeline
Cada paso es idempotente, con reintentos y estado visible:

`RECIBIDO → ALMACENADO → CLASIFICADO → LEÍDO → EXTRAÍDO → VALIDADO → {APLICADO_AUTOMÁTICO | EN_REVISIÓN} → RECIBO_EMITIDO → RECIBO_ENVIADO`

Salidas alternativas: `DUPLICADO` · `NO_ES_COMPROBANTE` (se archiva en el repositorio como documento general) · `RECHAZADO`.

### 13.2 Lectura
- PDF con capa de texto: extracción directa.
- Imagen o PDF escaneado: preprocesamiento (orientación, recorte, contraste) + OCR.
- El texto completo se guarda para búsqueda.

### 13.3 Campos a extraer
Salida en JSON validado por esquema; cada campo con su confianza (0–1) y la región de la imagen donde se leyó.

| Campo | Obligatorio |
|---|---|
| **Nombre de quien recibe** (beneficiario) | Sí |
| **Nombre de quien envía o paga** | Sí |
| **Valor pagado** + moneda | Sí |
| **Fecha (y hora) del pago o del documento** | Sí |
| Entidad o medio (banco, billetera, corresponsal) | Si existe |
| Número de referencia, aprobación o transacción | Si existe |
| Cuenta o celular de destino (solo los últimos 4 dígitos) | Si existe |
| Tipo de documento | Sí |

**Formatos que debe dominar desde el lanzamiento**, validados con un conjunto de prueba de al menos 40 comprobantes reales anonimizados:
- **Colombia:** Nequi, Daviplata, Bancolombia (app y QR), Bre-B, Davivienda, BBVA, Banco de Bogotá, PSE, Efecty y corresponsales.
- **Brasil:** comprovante PIX y TED de los principales bancos.
- **EE. UU.:** Zelle, Venmo, Cash App y transferencias bancarias.
- Consignaciones en papel fotografiadas y capturas de pantalla.

**Interpretación:** formatos numéricos locales (`$ 60.000`, `60,000.00`, `R$ 60,00`), meses en texto en los tres idiomas y fechas relativas ("hoy 14:32") resueltas con la fecha de recepción.

### 13.4 Validaciones automáticas
- **Cuentas receptoras:** la empresa registra en Configuración sus cuentas (titular, entidad, últimos 4 dígitos). El beneficiario del comprobante debe coincidir con alguna, mediante comparación difusa sin tildes (similitud ≥ 0,85). Si no coincide, va a revisión con la alerta "El pago no se hizo a tus cuentas".
- **Pagador frente a cliente o codeudor:** si no coincide, se permite (los pagos de terceros son comunes), pero se marca.
- **Fecha:** no futura, no anterior al desembolso y con antigüedad máxima configurable (por defecto, 30 días).
- **Valor:** mayor que 0 y en la moneda del préstamo.
- **Anti-duplicado doble:** huella SHA-256 del archivo + huella lógica (referencia + valor + fecha + entidad). Un comprobante reenviado nunca se registra dos veces.
- **Señales de posible alteración** (metadatos de edición, inconsistencias tipográficas detectables, fecha del archivo posterior al reporte): siempre a revisión, nunca aplicación automática.

### 13.5 Decisión automática
- **Aplicación automática solo si** el remitente está identificado de forma inequívoca, todos los campos obligatorios superan el umbral de confianza (por defecto 0,95, configurable) y todas las validaciones pasan.
- **Modo de supervisión por empresa:**
  - **"Automático con auditoría"** (por defecto): el pago se registra al instante, aparece en la Bandeja como "Registrado automáticamente" y puede revertirse con un toque durante 72 horas; después, solo con reverso formal y motivo.
  - **"Aprobación previa":** todo pasa por la Bandeja antes de registrarse.
- Todo lo demás va a la Bandeja de validación.

### 13.6 Bandeja de validación
- Vista dividida: imagen original con los campos resaltados sobre ella · formulario precargado con indicador de confianza por campo · cliente, préstamo y cuotas afectadas, con vista previa del resultado (saldo antes y después).
- Acciones: Aprobar (`Enter`), Corregir y aprobar, Reasignar cliente, Marcar como no comprobante, Rechazar con motivo. Aprobación en lote para los elementos de alta confianza.
- Contador en la navegación y notificación push al usuario o cobrador responsable.
- Cada corrección humana se guarda como ejemplo para mejorar la extracción de esa empresa (nunca se usan datos de una empresa para otra).

---

## 14. REGISTRO AUTOMÁTICO DEL PAGO

Al aprobarse un pago (de forma automática o manual) se ejecuta **una transacción atómica** que:
1. crea el movimiento en el libro;
2. lo aplica según §9.5 y actualiza el estado de las cuotas;
3. recalcula el saldo;
4. vincula el documento soporte a las cuotas afectadas;
5. genera el recibo (§15) y programa su envío respetando §11.4;
6. regenera el cuadro de pagos en PDF/XLSX en el repositorio y la carpeta local;
7. actualiza el dashboard en tiempo real en todos los dispositivos;
8. escribe en la bitácora.

Todo o nada: si un paso falla, se revierte y se reintenta. Nunca queda un pago a medias.

---

## 15. RECIBO DE PAGO ("Gracias por tu pago")

Se genera automáticamente en PDF (A5 vertical, legible en el celular), en el idioma del deudor y con el logo. Contiene:

- Título **"Gracias por tu pago"** + mensaje de agradecimiento personalizable.
- Número de recibo consecutivo por empresa (`RC-000001`), inmutable.
- **Fecha de emisión** (fecha y hora).
- Cliente (nombre y apellidos) y número de contrato.
- Fecha del pago (la del comprobante), medio y referencia.
- **Total de cuotas pactadas.**
- **Valor pagado.**
- **Cuota pagada**, con detalle exacto. Ejemplo: "Cuotas 2 y 3 (completas) · Cuota 4 (abono parcial $ 30.000)".
- **Cuotas restantes.**
- **Acumulado** pagado (suma histórica de los pagos del préstamo).
- Saldo anterior y **nuevo saldo por pagar.**
- Próxima cuota: fecha y valor.
- Código QR de verificación, que abre en el portal la confirmación de autenticidad por la huella del recibo.
- Pie: datos de la empresa y la leyenda "Documento generado por COROC".

**Diseño:** fondo marfil, filete dorado superior, cifras en Inter tabular y jerarquía clara, con el valor pagado y el nuevo saldo como protagonistas.

**Reglas:**
- Se guarda en el repositorio del cliente y en la carpeta local (`03 Recibos emitidos`), queda vinculado al pago y se envía por el canal correspondiente.
- Un reverso **anula** el recibo con el sello "ANULADO" (nunca se borra) y, si aplica, se emite uno nuevo.
- Cuando el saldo llega a cero se genera además el **Paz y salvo**, con los mismos estándares.

---

## 16. REPOSITORIO DOCUMENTAL Y CARPETA COROC

### 16.1 Repositorio en la nube por cliente (fuente de verdad)
Visor integrado (imágenes con zoom y PDF), búsqueda por el texto leído, filtros por tipo y fecha, etiquetas, descarga y compartir. Los documentos nunca se sobrescriben: se versionan.

### 16.2 Carpeta local COROC: permiso y creación
En el primer uso de cada dispositivo, COROC explica en una pantalla qué guardará y **pide permiso para crear la carpeta COROC**:
- **Windows / macOS:** ubicación sugerida `Documentos/COROC`, con opción de elegir otra. En macOS se usa un marcador de seguridad (security-scoped bookmark) para conservar el acceso.
- **Android:** Storage Access Framework (`ACTION_OPEN_DOCUMENT_TREE`), sugiriendo Documentos; el permiso se conserva con `takePersistableUriPermission`. **Prohibido** solicitar `MANAGE_EXTERNAL_STORAGE`.
- **iOS / iPadOS:** carpeta COROC visible en la app Archivos ("En mi iPhone › COROC"), habilitando `UIFileSharingEnabled` y `LSSupportsOpeningDocumentsInPlace`; opción de elegir una carpeta de iCloud Drive con marcador persistente.
- Si el usuario niega el permiso, COROC sigue funcionando con el repositorio en la nube y deja la opción disponible en Configuración.

### 16.3 Estructura
```
COROC/
├── María José Pérez Gómez - C000042/
│   ├── CT-000125/
│   │   ├── 01 Contrato y plan de pagos/
│   │   ├── 02 Comprobantes recibidos/
│   │   ├── 03 Recibos emitidos/
│   │   ├── 04 Estados de cuenta/
│   │   └── 05 Otros documentos/
│   └── CT-000301/
├── _Sin asignar/
├── _Entrada/          (solo escritorio: carpeta vigilada)
├── _Informes/
└── _Respaldos/
```
- **Carpeta del cliente:** `Nombre Apellidos - Código`. Se conservan las tildes y se eliminan los caracteres no válidos en Windows y macOS (`< > : " / \ | ? *`, puntos o espacios finales). El código evita que dos clientes homónimos se mezclen.
- Los nombres de subcarpetas siguen el idioma de la empresa.
- **Nombres de archivo:** `AAAA-MM-DD_HHMM_TIPO_CONTRATO_VALOR.ext`. Ejemplos: `2026-10-09_1432_COMPROBANTE_CT-000125_60000.jpg`, `2026-10-09_1435_RECIBO_RC-000482_CT-000125.pdf`.
- Cada carpeta de cliente contiene un archivo oculto `.coroc-id` con su identificador interno: si el cliente cambia de nombre, la carpeta se renombra sin perder el vínculo.
- **Sincronización:** la nube es la fuente de verdad; la carpeta local es un espejo que se actualiza en segundo plano mientras la app está abierta y al abrirla. En escritorio, los archivos nuevos que el usuario ponga en la carpeta de un cliente se detectan y se ofrecen para importar.

### 16.4 Informes de estado del préstamo
Se generan bajo demanda y automáticamente (cada mes y al cerrar el préstamo) en el repositorio y en `04 Estados de cuenta`.

---

## 17. DASHBOARD INICIAL

Cuatro indicadores protagonistas, con definiciones contables exactas:

| Indicador | Definición |
|---|---|
| **Total de clientes** | Clientes con al menos un préstamo activo (subtexto: total registrados) |
| **Total prestado** | Suma del capital desembolsado de los préstamos activos (subtexto: histórico) |
| **Esperado para hoy** | Suma del saldo pendiente de las cuotas que vencen hoy (subtexto: recaudado hoy y vencido acumulado) |
| **Total por recibir** | Suma del saldo pendiente (capital + intereses pactados + mora causada) de todos los préstamos activos |

**Presentación:**
- Cifras protagonistas en dorado sobre azul noche (modo oscuro) o en azul noche sobre marfil con acento dorado (modo claro).
- Conteo animado y actualización en tiempo real al registrar un pago: la cifra se anima hasta el nuevo valor y aparece un aviso discreto, por ejemplo "Pago registrado · María Pérez · $ 60.000".

**Complementos** (debajo, sin competir con los cuatro): anillo "Recaudado hoy frente a esperado hoy"; tendencia de recaudo de 30 días; cartera por estado (al día, 1–7, 8–30 y más de 30 días de mora); lista "Cobros de hoy"; acceso a la Bandeja de validación con contador.

**Filtros:** período, cobrador y moneda. Si hay varias monedas, se agrupan por moneda; nunca se suman monedas distintas.

---

## 18. INFORMES (PDF y XLSX, en el idioma elegido)

Estado de cuenta por préstamo · cartera total y por cobrador · recaudo por período · mora por edades · préstamos finalizados y utilidad · proyección de flujo de caja · libro de movimientos · bitácora de mensajes y de cumplimiento.

Todos llevan logo, fecha de corte, filtros aplicados y paginación profesional.

---

## 19. RESPALDO Y RESTAURACIÓN

- Botón **"Crear respaldo"** visible en Configuración y en el menú principal.
- Archivo `COROC_Respaldo_<empresa>_AAAA-MM-DD_HHMM.coroc`: contenedor ZIP cifrado con AES-256 y contraseña definida por el usuario. Incluye la base de datos completa (JSON por entidad + versión de esquema), **todos los documentos recibidos y generados**, las plantillas, la configuración y un `manifest.json` con conteos y huella SHA-256 de cada archivo.
- Se guarda en `COROC/_Respaldos`; el usuario puede además guardarlo en otra ubicación o compartirlo.
- Generación por flujo (streaming), con barra de progreso, cancelable y reanudable ante cortes.
- **Restauración (solo Propietario):** verificación de integridad y versión; simulación previa con resumen (por ejemplo, "se restaurarán 1.245 clientes, 1.302 préstamos y 18.450 documentos"); confirmación escribiendo el nombre de la empresa; restauración atómica. Compatible con respaldos de versiones anteriores de COROC.
- **Respaldos automáticos del servidor:** diarios con retención de 30 días; punto de recuperación máximo de 1 hora (RPO 1 h, RTO 4 h).

---

## 20. PRIVACIDAD, CUMPLIMIENTO LEGAL Y TIENDAS

### 20.1 Datos personales
- Colombia: Ley 1581 de 2012 (habeas data). Brasil: LGPD (Lei 13.709/2018).
- Aviso de privacidad y autorización de tratamiento por cada deudor, registrada con fecha y evidencia.
- Consentimiento (opt-in) por canal antes de cualquier mensaje, exigido también por WhatsApp.
- Exclusión (opt-out) con una palabra ("SALIR" / "SAIR" / "STOP") o desde el portal, respetada de inmediato.
- Derechos de acceso, corrección y supresión atendibles desde la ficha del cliente.
- Acuerdos de tratamiento de datos con los proveedores de OCR e IA; datos minimizados y cifrados.

### 20.2 Cobranza
Motor de reglas de contacto de §11.4.

### 20.3 Tasas
Tope legal de tasa de §9.6.

### 20.4 Tiendas de aplicaciones
- **Google Play:** completar la declaración de funciones financieras describiendo a COROC como herramienta de gestión de cartera para prestamistas, que no ofrece ni otorga préstamos a consumidores. Sin permisos amplios de almacenamiento, SMS ni contactos.
- **App Store:** la suscripción se vende y se cobra fuera de la app (web o contrato); las apps solo permiten iniciar sesión, conforme a las guías de App Store para servicios multiplataforma y empresariales (revisar la sección 3.1.3 vigente al publicar). Si la app permite crear cuentas, debe permitir eliminarlas desde la propia app.
- **Ambas:** política de privacidad pública y etiquetas de privacidad (App Privacy / Data safety) exactas.

---

## 21. REQUISITOS NO FUNCIONALES

- **Rendimiento:** arranque en frío < 2,5 s en gama media; dashboard < 1,5 s con 50.000 clientes; búsqueda de clientes < 300 ms; listas virtualizadas a 60 fps; del comprobante recibido al pago registrado (camino automático) < 60 s en el percentil 95.
- **Disponibilidad** del backend: 99,9 %. Colas con reintentos exponenciales y cola de fallidos visible para soporte.
- **Offline:** consulta de clientes, planes y documentos en caché. Las operaciones hechas sin conexión se encolan y sincronizan con resolución de conflictos documentada; el libro contable siempre se valida en el servidor.
- **Accesibilidad:** WCAG 2.2 AA, texto dinámico hasta 200 %, lectores de pantalla (TalkBack, VoiceOver, Narrador) y objetivos táctiles ≥ 44 pt.
- **Calidad de código:** análisis estático sin advertencias; cobertura ≥ 90 % en motor financiero, cumplimiento y extracción, y ≥ 75 % global.
- **Observabilidad:** traza por documento desde la recepción hasta el recibo enviado.

---

## 22. CRITERIOS DE ACEPTACIÓN (pruebas automatizadas obligatorias)

| ID | Escenario | Resultado esperado |
|---|---|---|
| CA-01 | Interés simple: capital $ 1.000.000, 20 %, 20 cuotas diarias | Total $ 1.200.000; cuota $ 60.000 |
| CA-02 | Redondeo: $ 1.000.000, 15 %, 7 cuotas, COP a 1 peso | Cuotas 1–6 de $ 164.286 y cuota 7 de $ 164.284; suma exacta $ 1.150.000 |
| CA-03 | Francés: $ 5.000.000, 2 % mensual, 12 cuotas | Cuota $ 472.798; cuota 1: interés $ 100.000, capital $ 372.798, saldo $ 4.627.202; saldo final $ 0; total pagado $ 5.673.576 |
| CA-04 | Diaria lunes a sábado sin festivos (Colombia); desembolso jueves 8-oct-2026 | Cuotas 1–4: 9-oct, 10-oct, 13-oct y 14-oct (11-oct es domingo; 12-oct es festivo) |
| CA-05 | Préstamo de CA-01; llega un pago de $ 60.000 | Cuota 1 pagada; cuotas restantes 19; acumulado $ 60.000; nuevo saldo $ 1.140.000; recibo con exactamente esos datos |
| CA-06 | A continuación, un pago de $ 150.000 | Cuotas 2 y 3 pagadas y cuota 4 con abono parcial de $ 30.000; restantes 17; acumulado $ 210.000; nuevo saldo $ 990.000 |
| CA-07 | El mismo comprobante llega por WhatsApp y luego por correo | El segundo ingreso queda como DUPLICADO; no se registra un pago adicional |
| CA-08 | Comprobante desde un número no registrado | Va a "Sin asignar" con sugerencias; al asignarlo se ofrece guardar el número |
| CA-09 | El beneficiario del comprobante no coincide con las cuentas receptoras | No se aplica automáticamente; va a revisión con alerta |
| CA-10 | Recordatorio de cobranza programado el domingo 11-oct-2026 a las 10:00 (preset Colombia) | Reprogramado al martes 13-oct-2026 a las 07:00 (el 12-oct es festivo) |
| CA-11 | Segundo mensaje de cobranza al mismo deudor el mismo día | Bloqueado y registrado con la regla aplicada |
| CA-12 | Préstamo cuya tasa efectiva supera el tope vigente | No se guarda; se informa la tasa máxima permitida |
| CA-13 | Respaldo y restauración en una empresa vacía | Conteos y huellas SHA-256 idénticos; todos los documentos abren correctamente |
| CA-14 | Cambio de idioma es → pt-BR → en con la app abierta | Toda la interfaz cambia sin reiniciar; cero cadenas sin traducir |
| CA-15 | Crear el cliente "María José Pérez Gómez" | Existe `María José Pérez Gómez - C0000xx/CT-xxxxxx/` con sus 5 subcarpetas y el PDF del plan de pagos |
| CA-16 | Un Cobrador consulta un cliente de otro cobrador | Acceso denegado y registrado en la bitácora |
| CA-17 | La empresa A intenta leer datos de la empresa B por la API | Denegado por RLS; prueba automatizada en CI |
| CA-18 | Reverso de un pago | Contramovimiento en el libro; recibo marcado ANULADO; saldos y dashboard recalculados |
| CA-19 | Extracción sobre el conjunto de prueba | Valor ≥ 98 % exacto, fecha ≥ 97 %, nombres ≥ 95 %; lo que no alcance el umbral nunca se aplica automáticamente |
| CA-20 | La cuenta de WhatsApp Cloud API es suspendida | Paso automático al modo asistido sin perder mensajes; aviso al propietario |

---

## 23. PLAN DE ENTREGA POR FASES

| Fase | Contenido | Se cierra cuando |
|---|---|---|
| 0. Arquitectura | Artefactos de §24.1 | El propietario del producto los aprueba |
| 1. Núcleo | Autenticación, roles, multiempresa, i18n, sistema de diseño completo con el logo, clientes, préstamos, motor financiero, cuadro de pagos y dashboard | CA-01 a CA-06, CA-12, CA-14, CA-16 y CA-17 en verde |
| 2. Documentos | Repositorio, carpeta COROC en las 4 plataformas, PDF (plan, recibo, estado de cuenta, paz y salvo), respaldo y restauración, informes | CA-13, CA-15 y CA-18 en verde |
| 3. Recepción y lectura | Portal del deudor con enlace de carga, correo entrante, "Compartir con COROC", carpeta vigilada, OCR + IA, validaciones y Bandeja | CA-07 a CA-09 y CA-19 en verde |
| 4. Mensajería y cumplimiento | Plantillas, correo saliente, WhatsApp modo asistido y modo Cloud API, motor de reglas de contacto | CA-10, CA-11 y CA-20 en verde |
| 5. Endurecimiento y publicación | Pruebas de carga y de penetración, accesibilidad, fichas de tienda, firma y publicación | §21 cumplido y todas las CA en verde |

---

## 24. FORMATO DE ENTREGA

### 24.1 Antes de programar, entrega en este orden y espera aprobación
1. Documento de arquitectura: componentes, flujos, decisiones en formato ADR y versiones de las APIs externas.
2. Modelo entidad-relación completo, con índices y políticas RLS.
3. Contrato OpenAPI 3.1.
4. Mapa de pantallas con wireframes de ingreso, dashboard, ficha del cliente, Bandeja de validación y recibo PDF, aplicando el sistema de diseño de §5.
5. Lista de supuestos y preguntas abiertas (solo las que bloqueen el avance).

### 24.2 En cada fase
- Código completo en un monorepo con esta estructura: `apps/coroc_app`, `services/api`, `packages/…`, `infra/`, `docs/`.
- Pruebas en verde, instrucciones de ejecución local y de despliegue, notas de versión y actualización del módulo Ayuda.

### 24.3 Idioma de trabajo
Responde y documenta en español. Código e identificadores en inglés. Textos para el usuario en los tres idiomas.
