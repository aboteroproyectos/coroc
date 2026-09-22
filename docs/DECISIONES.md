# COROC · Registro de decisiones (ADR)

Regla 3 del prompt maestro: toda decisión no especificada se toma con criterio y se documenta aquí y en el módulo **Ayuda** de la app (ADR-001 a ADR-013 y ADR-018 a ADR-020; las ADR-014 a ADR-017 son técnicas y no cambian el uso). Formato: contexto → decisión → consecuencias.

| ID | Decisión | Estado |
|---|---|---|
| ADR-001 | Montos en enteros de la unidad mínima de la moneda | Aceptada |
| ADR-002 | La última cuota absorbe la diferencia de redondeo | Aceptada |
| ADR-003 | Saldos derivados del libro de movimientos | Aceptada |
| ADR-004 | Orden de aplicación de pagos | Aceptada |
| ADR-005 | Tope legal de tasa obligatorio (bloqueo) | Aceptada · §9.6 |
| ADR-006 | Hash de contraseñas | Aceptada |
| ADR-007 | WhatsApp en modo asistido por defecto | Aceptada |
| ADR-008 | Reglas de contacto también para mensajes transaccionales | Aceptada |
| ADR-009 | Sin recordatorios diarios por defecto | Aceptada |
| ADR-010 | Doble control de duplicados | Aceptada |
| ADR-011 | Pagador inferido | Aceptada |
| ADR-012 | Formato del respaldo | Aceptada |
| ADR-013 | Nombres de carpeta sin tildes | Aceptada · se aparta de §16.3 |
| ADR-014 | Stack del prompt sin cambios | Aceptada |
| ADR-015 | Un solo núcleo de negocio en TypeScript | Aceptada |
| ADR-016 | Wireframes de Fase 0 como app funcional | Aceptada |
| ADR-017 | Lector por reglas como verificación cruzada de la IA | Aceptada |
| ADR-018 | Formato de dinero en pantalla y en documentos | Aceptada |
| ADR-019 | Confianza de fechas sin etiqueta | Aceptada |
| ADR-020 | Duplicados también contra la bandeja pendiente | Aceptada |

---

### ADR-001 · Montos en enteros de la unidad mínima
**Contexto:** §2 regla 5 prohíbe `float`. **Decisión:** todo monto es `bigint` en la base y entero seguro en JavaScript (COP en pesos, BRL/USD en centavos); los cálculos con tasas usan `decimal.js` con 40 dígitos y se redondean mitad hacia arriba. **Consecuencias:** sumas exactas; la conversión a texto se hace solo al mostrar.

### ADR-002 · La última cuota absorbe la diferencia
**Contexto:** §9.4. **Decisión:** las cuotas regulares se redondean a la unidad configurada (1, 50, 100 o 1.000 pesos) y la última cierra la diferencia; en el sistema francés, la última cuota lleva todo el capital restante. **Consecuencias:** la suma de cuotas es exactamente el total pactado (CA-02, CA-03).

### ADR-003 · Saldos derivados del libro
**Contexto:** §9.7. **Decisión:** el estado de cada cuota se reconstruye aplicando, en orden, los pagos no reversados del libro. Nada se edita: se reversa con motivo. **Consecuencias:** reversar un pago antiguo reacomoda la aplicación de los pagos posteriores, que es el comportamiento contable correcto. La base lo impone con triggers (verificado en PostgreSQL 16).

### ADR-004 · Orden de aplicación de pagos
**Decisión:** mora causada de la cuota más antigua a la más reciente → cuotas en orden cronológico → excedente como saldo a favor visible. **Consecuencias:** el recibo describe con exactitud qué cubrió cada pago («Cuotas 2 y 3 (completas) · Cuota 4 (abono parcial $ 30.000)»).

### ADR-005 · Tope legal de tasa obligatorio
**Contexto:** en Colombia cobrar por encima de la tasa de usura es delito (art. 305 del Código Penal). **Decisión:** COROC calcula la tasa efectiva anual real (TIR sobre las fechas reales de los flujos, base 365) y **no guarda** préstamos que superen el tope registrado; informa la tasa máxima que sí cumple. La mora diaria también se valida. **Consecuencias:** el propietario registra la tasa de usura certificada y su vigencia; COROC avisa cuando vence. Los datos de demostración usan un tope ilustrativo de 25 % E.A., que no corresponde a ninguna certificación.

### ADR-006 · Hash de contraseñas
**Decisión:** servidor con Argon2id. El prototipo local usa PBKDF2-SHA256 con 310.000 iteraciones (Web Crypto no incluye Argon2). **Consecuencias:** al migrar del prototipo al servidor los usuarios definen su contraseña de nuevo.

### ADR-007 · WhatsApp en modo asistido por defecto
**Contexto:** la Política de Mensajería de WhatsApp Business prohíbe usar sus servicios para cobranza de deudas y préstamos entre pares, sin importar licencias; las automatizaciones no oficiales de WhatsApp Web violan sus términos. **Decisión:** modo B (asistido) activo desde el primer día; modo A (Cloud API) se implementa en Fase 4 y se activa solo con lista de verificación y aceptación del propietario. Para identificar al remitente sin depender de WhatsApp se agregan el enlace personal de carga, el correo y la carpeta vigilada. **Consecuencias:** COROC funciona completo aunque Meta rechace la cuenta.

### ADR-008 · Reglas de contacto también para transaccionales
**Decisión:** recibos, bienvenida, estados de cuenta y paz y salvo respetan por defecto las franjas de la Ley 2300; no cuentan para el límite diario de cobranza ni para la regla de un canal por semana. El propietario puede habilitar su envío inmediato. **Consecuencias:** interpretación conservadora; queda documentada.

### ADR-009 · Sin recordatorios diarios por defecto
**Decisión:** en préstamos de pago diario no se envía recordatorio cada día; sí el aviso de cuota vencida. Se puede activar. **Consecuencias:** evita el contacto excesivo que la Ley 2300 busca impedir.

### ADR-010 · Doble control de duplicados
**Decisión:** huella SHA-256 del archivo + huella lógica (referencia + valor + fecha + entidad; sin referencia, valor + fecha + hora + entidad + pagador). En la base, índices únicos parciales impiden aplicar dos veces la misma huella. **Consecuencias:** un comprobante reenviado por otro canal, recortado o recomprimido no se registra de nuevo (CA-07).

### ADR-011 · Pagador inferido
**Contexto:** billeteras como Nequi no imprimen el nombre de quien paga. **Decisión:** si falta el pagador y el remitente se identificó por un canal verificable (número registrado, enlace personal o carpeta del cliente), se asume el cliente y queda una alerta no bloqueante. **Consecuencias:** los pagos más comunes se registran solos sin sacrificar trazabilidad.

### ADR-012 · Formato del respaldo
**Decisión:** archivo `.coroc` = encabezado JSON + ZIP cifrado con AES-256-GCM; clave derivada con PBKDF2-SHA256 (310.000 iteraciones) de la contraseña del usuario; `manifest.json` con conteos y SHA-256 de cada archivo; la restauración verifica todo antes de reemplazar. **Consecuencias:** verificado de extremo a extremo: 181 de 181 documentos restaurados con la misma huella; contraseña errada o byte alterado se rechazan.

### ADR-013 · Nombres de carpeta sin tildes
**Contexto:** §16.3 pedía conservar las tildes. Durante la verificación, el sistema de archivos de Chromium colapsó nombres con tildes en la carpeta superior, y los ZIP con nombres UTF-8 siguen dando problemas en algunas versiones de Windows y sincronizadores. **Decisión:** las carpetas y archivos usan el nombre sin tildes ni eñes («Maria Jose Perez Gomez - C000001»); en la app, los recibos y los documentos el nombre se muestra completo. **Consecuencias:** la carpeta funciona igual en Windows, macOS, Android, iOS, ZIP y nubes. Se aparta de la letra de §16.3 por la regla 4 del prompt.

### ADR-014 · Stack del prompt sin cambios
**Decisión:** Flutter para las cuatro plataformas; NestJS + PostgreSQL 16 + Redis/BullMQ + S3 para el servidor, como ordena §4. **Consecuencias:** una sola base de código de interfaz; la automatización vive en el servidor.

### ADR-015 · Un solo núcleo de negocio en TypeScript
**Decisión:** `@coroc/core` concentra dinero, calendario, reglas de contacto, identificación y lectura. La API y los workers lo usan directamente; Flutter consume la API (incluida la vista previa del plan). **Consecuencias:** no hay dos implementaciones del cálculo; la vista previa requiere conexión (la consulta sin conexión sigue disponible).

### ADR-016 · Wireframes de Fase 0 como app funcional
**Contexto:** §24.1-4 pide wireframes de ingreso, dashboard, ficha, bandeja y recibo. **Decisión:** se entregan como una app funcional de un solo archivo HTML que usa el mismo núcleo probado, con los tres idiomas, el sistema de diseño completo y datos de demostración opcionales. **Consecuencias:** el propietario valida flujos reales, no imágenes; la app sirve como herramienta de trabajo local mientras se construyen las apps nativas.

### ADR-017 · Lector por reglas como verificación cruzada
**Decisión:** en el servidor, la IA con visión es el extractor principal y el lector por reglas de `@coroc/core` la verifica; si discrepan en valor o fecha, el comprobante va a revisión. En el prototipo, el lector por reglas trabaja sobre el texto de Tesseract.js o la capa de texto del PDF. **Consecuencias:** menos registros automáticos erróneos sin perder automatización.

### ADR-018 · Formato de dinero
**Decisión:** en pantalla cada moneda usa su formato nativo (COP «$ 1.200.000», BRL «R$ 1.200,00», USD «$1,200.00») sin importar el idioma de la interfaz; los documentos para el cliente usan su idioma (un recibo en inglés de un préstamo en pesos muestra «COP 560,400»). **Consecuencias:** cifras legibles y sin ambigüedad de moneda en documentos enviados al exterior.

### ADR-019 · Confianza de fechas sin etiqueta
**Decisión:** una sola fecha explícita con año en todo el comprobante recibe confianza 0,96 aunque no tenga etiqueta; una fecha relativa («hoy») recibe 0,90 y va a revisión. **Consecuencias:** los comprobantes bancarios que imprimen la fecha sin rótulo se registran solos (verificado con OCR real).

### ADR-020 · Duplicados también contra la bandeja pendiente
**Decisión:** un comprobante que llega de nuevo mientras el primero espera revisión se marca como duplicado. **Consecuencias:** la bandeja no se llena de copias del mismo pago.
