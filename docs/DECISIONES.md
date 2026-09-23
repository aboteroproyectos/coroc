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

## Fase 1

### ADR-021 · Estado del préstamo derivado y recalculable
**Contexto:** el dashboard y la lista de clientes necesitan saldo, mora y próxima cuota de miles de préstamos en menos de 1,5 s (§21), pero el libro de movimientos es la única fuente de verdad (ADR-003). **Decisión:** la tabla `loan_state` es una caché derivada: se recalcula con `replayLoan` de `@coroc/core` dentro de la misma transacción de cada pago, reverso o préstamo nuevo. Un trabajo horario (BullMQ, `7 * * * *`) actualiza la mora de los préstamos cuyo corte quedó atrás, en lotes de 2.000 y solo si el cálculo nuevo es más reciente. Si al abrir el dashboard hay hasta 3.000 préstamos atrasados, se actualizan en el momento; si hay más, la respuesta lleva `refreshing: true` y la app lo informa. **Consecuencias:** dashboard en 75 ms y búsqueda en 55 a 137 ms con 50.000 clientes; `loan_state` se puede borrar y reconstruir sin perder nada.

### ADR-022 · Rol de base de datos propio para el Cobrador
**Contexto:** CA-16 exige que el Cobrador no vea clientes ajenos «aunque la API se equivocara». **Decisión:** las transacciones del Cobrador hacen `SET LOCAL ROLE coroc_collector`; ese rol tiene políticas RLS **restrictivas** que exigen que el cliente o préstamo le esté asignado, además del aislamiento por empresa. El usuario de la API es miembro de `coroc_collector` con `INHERIT FALSE, SET TRUE`: no hereda esas políticas en las demás sesiones, pero puede asumirlas. Las consultas que necesitan saltar el filtro de forma controlada (consecutivos, recaudo diario, lista de empresas del trabajo nocturno) son funciones `SECURITY DEFINER` con `search_path` fijo. **Consecuencias:** verificado por la API y directamente en la base (`acceptance.test.ts`, CA-16).

### ADR-023 · La app no guarda datos de clientes en el equipo (Fase 1)
**Contexto:** §7.3 pide cifrado local y §15 consulta sin conexión. Un caché local mal protegido es el mayor riesgo en teléfonos de cobradores. **Decisión:** en la Fase 1 la app solo guarda en el almacén seguro del sistema (Keychain, Keystore, DPAPI) el identificador del dispositivo, el token de renovación y preferencias sin datos personales. La consulta sin conexión (drift + SQLCipher con clave en el almacén seguro) se implementa en la fase de endurecimiento, junto con el borrado remoto. **Consecuencias:** robar o perder un teléfono no expone la cartera. Mientras tanto la app necesita conexión, y lo dice con un mensaje claro cuando no la hay.

### ADR-024 · Versiones del servidor
**Decisión:** Node.js 22 LTS, NestJS 12 (ESM), TypeScript 6.0, PostgreSQL 16, Redis 7 y BullMQ 5, que eran las versiones estables vigentes al iniciar la Fase 1. **Consecuencias:** sin dependencias en fin de soporte al salir a producción.

### ADR-025 · Bloqueo progresivo de cuentas
**Contexto:** §7.1 fija 15 minutos tras 5 intentos fallidos. Un atacante paciente podría seguir probando indefinidamente. **Decisión:** cada bloqueo nuevo dura el doble del anterior (15, 30, 60 minutos…) hasta un máximo de 24 horas. Un ingreso correcto o el cambio de contraseña reinician la cuenta. Cada bloqueo queda en la bitácora y avisa en vivo al Propietario. **Consecuencias:** el primer bloqueo cumple §7.1 al pie de la letra y los siguientes frenan los ataques lentos.

### ADR-026 · Tope de tasa obligatorio en Colombia
**Decisión:** en empresas de Colombia no se puede crear un préstamo si no hay tasa de usura vigente registrada para la fecha de desembolso (`RATE_CAP_MISSING`). En Brasil y Estados Unidos el tope es opcional: si existe se aplica y, si no, la vista previa lo informa. La mora también se limita al tope (`LATE_FEE_EXCEEDS_CAP`). Las vigencias no se pueden solapar (restricción de exclusión en la base). **Consecuencias:** es imposible prestar por encima de la usura por olvido.

### ADR-027 · CA-05 y CA-06 en una empresa sin tope
**Contexto:** las condiciones de CA-01 (20 % sobre el capital en 20 cuotas diarias) equivalen a una tasa efectiva anual muy superior a la usura colombiana, así que por ADR-026 ese préstamo no se puede crear en una empresa de Colombia. **Decisión:** CA-01 a CA-04 se verifican con la vista previa en una empresa de Colombia, y CA-05, CA-06 y CA-18 con el mismo préstamo creado en una empresa de Estados Unidos, donde no hay tope registrado. **Consecuencias:** se verifica la aritmética exacta que piden los criterios sin debilitar el control legal. Queda como pregunta para el Propietario si las tasas reales de sus préstamos diarios cumplen la usura (P-6).

### ADR-028 · El contrato OpenAPI valida en tiempo de ejecución
**Decisión:** cada ruta declara su `operationId`. Al arrancar, la API compila con Ajv (JSON Schema 2020-12) el esquema de cada petición y rechaza con 422 lo que no cumpla. Las pruebas validan cada respuesta contra el contrato y verifican que toda ruta del código exista en `openapi.yaml` y viceversa. **Consecuencias:** el contrato no se desactualiza. La app Flutter y los clientes futuros pueden confiar en él.

### ADR-029 · Carpetas nativas de Flutter generadas en CI
**Decisión:** el repositorio guarda solo el código Dart, los recursos y `tool/patch_platforms.py`. En cada compilación, `flutter create` genera `android/`, `ios/`, `macos/` y `windows/`, y el script aplica los ajustes de COROC:
- Android: `FlutterFragmentActivity` con `FLAG_SECURE`, permisos, sin copia de seguridad en la nube y API 26 o superior.
- iOS: Face ID e iOS 16.
- macOS: acceso de red y macOS 13.
- Windows: título de la ventana.

**Consecuencias:** las plantillas siempre corresponden a la versión de Flutter en uso. Cuando se configure la firma para las tiendas (fase de publicación), estas carpetas se versionarán.

### ADR-030 · Formato del peso colombiano fijado en código
**Contexto:** la biblioteca `intl` no trae datos de `es_CO`; con `es` pondría el símbolo después del número («1.200.000 $»). **Decisión:** COP usa el patrón fijo `¤ #,##0`: símbolo delante, punto de miles y sin decimales, que es como se escribe en Colombia. Las fechas y porcentajes usan `es`. **Consecuencias:** «$ 1.200.000» en todas las plataformas. Una prueba lo verifica.
