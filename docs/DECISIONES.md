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

## Fase 2

### ADR-031 · Archivos cifrados en reposo, por bloques
**Contexto:** §7.3 pide cifrado en reposo. Los documentos pueden pesar varios megas y el respaldo varios gigas, y §16 pide descargas que se reanuden. **Decisión:** la API cifra cada archivo antes de entregarlo al almacén, con AES-256-GCM en bloques de 64 KiB.
- Cada objeto tiene su propia clave, derivada con HKDF-SHA256 de `COROC_DATA_KEY`, una sal aleatoria y el identificador de la empresa.
- Cada bloque lleva su número y la marca de último bloque como datos autenticados, así que no se pueden reordenar, truncar ni mover a otra empresa.
- Una lectura por rangos descifra solo los bloques necesarios.
- El almacén puede ser un disco (`COROC_STORAGE=fs`) o un servicio compatible con S3 (`COROC_STORAGE=s3`, con cifrado del proveedor opcional como segunda capa).

**Consecuencias:** quien obtenga el disco o el depósito no lee nada sin la clave maestra, y un byte alterado se detecta. Perder `COROC_DATA_KEY` hace ilegibles los archivos, así que debe tener respaldo en el gestor de secretos. El almacén S3 se probó con la interfaz, pero no contra un servicio S3 real.

### ADR-032 · Documentos en bandeja de salida transaccional
**Contexto:** el PDF de un recibo no puede perderse si el proceso se cae justo después del pago, ni puede frenar el registro del pago. **Decisión:** cada hecho (préstamo creado, pago, reverso, estado de cuenta pedido, informe, respaldo) registra su tarea en `document_tasks` dentro de la misma transacción.
- Un trabajador las toma con `claim_document_tasks` (`FOR UPDATE SKIP LOCKED`, con plazo de posesión), en orden por préstamo.
- Si una tarea falla, se reintenta hasta 6 veces, con esperas crecientes de hasta una hora.
- `COROC_DOCUMENT_WORKER=on|off|inline` permite separar el trabajador de la API o, en las pruebas, ejecutarlo en línea.
- La app consulta el avance con `GET /tasks/{id}`.

**Consecuencias:** un pago nunca queda sin recibo, aunque el PDF puede tardar unos segundos. Varias instancias pueden procesar la bandeja sin coordinarse.

### ADR-033 · PDF con plantillas HTML y Chromium sin interfaz
**Decisión:** los PDF (plan de pagos, recibo A5, estado de cuenta, paz y salvo, versión ANULADO e informes) se generan con plantillas HTML y CSS, renderizadas por Chromium sin interfaz (`playwright-core`).
- Las tipografías y el logo van incrustados.
- JavaScript está desactivado y no hay acceso a la red.
- Hay un contexto nuevo por documento y un tope de páginas por tipo.
- El código QR del recibo lleva a `GET /v1/public/receipts/{código}`, que confirma la empresa, el número, la fecha, el monto y si fue anulado, sin datos del deudor.

**Consecuencias:** los documentos se ven iguales en las tres lenguas y los tres países, y el diseño se cambia editando HTML. La imagen Docker incluye `chromium-headless-shell`. En desarrollo se puede indicar otro ejecutable con `COROC_CHROMIUM_PATH`.

### ADR-034 · Formato del respaldo `.coroc` y restauración atómica
**Decisión:** el respaldo es una línea JSON de encabezado seguida de un ZIP cifrado por bloques (ADR-031).
- La clave se deriva de la contraseña con PBKDF2-SHA256 de 310.000 iteraciones, y el encabezado va autenticado.
- El ZIP contiene `data/*.jsonl` por tabla, `files/<documento>` y `manifest.json` con conteos y huellas SHA-256.
- Se genera por flujo, sin cargarlo en memoria, y se descarga en partes.
- La restauración tiene tres pasos: subir, verificar (contraseña, integridad y un resumen de lo que se restaurará) y aplicar.
- Al aplicar, en una sola transacción se vacía la empresa y se vuelven a crear los identificadores de forma determinista (`sha256(empresa:restore:id)`). Los usuarios se emparejan por nombre de usuario, se reconstruyen los saldos y se comparan los conteos. Si algo no cuadra, no se cambia nada.
- Para confirmar hay que escribir el nombre de la empresa. Solo el Propietario restaura.

**Consecuencias:**
- Un respaldo se puede restaurar en la misma empresa o en otra, sin choques de identificadores.
- Los secretos del segundo factor no se restauran: cada usuario lo activa de nuevo.
- La bitácora de la empresa se reemplaza por la del respaldo, más el evento de restauración.
- Los respaldos `COROC-BACKUP-1` de la app HTML de la Fase 0 usan otro modelo de datos y no se restauran en el servidor.

### ADR-035 · Documentos en la app: visor propio y descargas firmadas
**Decisión:** la app no guarda documentos en un caché propio (en línea con ADR-023).
- Cada descarga usa un enlace firmado con HMAC que vence en 5 minutos (`COROC_LINK_TTL`) y admite rangos para reanudar.
- Los PDF se abren en un visor integrado (pdfrx) con zoom, historial de versiones, datos del documento (con su huella SHA-256) y botón para compartir o guardar. Para imprimir se comparte a la app de impresión del sistema. XLSX y CSV se comparten o se guardan con el diálogo del sistema.
- Los documentos nunca se sobrescriben: cada cambio crea una versión nueva (el recibo ANULADO es una versión del recibo).

**Consecuencias:** un enlace filtrado deja de servir en minutos y el historial de cada documento queda completo.

### ADR-036 · Carpeta COROC en cada plataforma
**Contexto:** §16.2 pide una carpeta COROC visible para el usuario, y cada sistema tiene su propio modelo de permisos. **Decisión:** la carpeta es un espejo de solo llegada del repositorio del servidor, que es la fuente de verdad.
- **Windows:** carpeta elegida con el diálogo del sistema; por defecto, `Documentos\COROC`.
- **macOS:** marcador de seguridad de la app (plugin `coroc_bookmarks` del repositorio), que conserva el permiso entre sesiones.
- **Android:** Storage Access Framework con permiso persistente (`saf_util`/`saf_stream`).
- **iOS:** carpeta Documentos de la app, visible en Archivos › En mi iPhone › COROC.

La sincronización corre al abrir la app, cada 2 minutos y con cada evento `document.created`. Lleva un índice `.coroc-sync.json` con la huella de cada archivo. En escritorio, los archivos que el usuario pone en la carpeta de un cliente se pueden subir al repositorio. Los nombres siguen §16.3 sin tildes (ADR-013), en el idioma de la empresa.

**Consecuencias:** si el usuario no da permiso, COROC sigue funcionando con la nube. Borrar un archivo de la carpeta no lo borra del servidor: vuelve en la siguiente sincronización.

## Fase 3

### ADR-037 · Lectura local con Tesseract; IA opcional verificada por reglas
**Contexto:** §4.5 propone OCR en la nube (Document AI, Textract o Azure) y una IA con visión para extraer los campos. Ambos requieren contratos y acuerdos de tratamiento de datos (S-6) que aún no existen. **Decisión:**
- Los PDF con capa de texto se leen con pdf.js.
- Las imágenes y los PDF escaneados se leen con Tesseract 5 en el servidor (español, portugués e inglés, con detección de orientación), con un hilo por proceso para que varias lecturas no se bloqueen entre sí.
- El lector por reglas de `@coroc/core` extrae siempre los campos.
- Con `COROC_EXTRACTION=claude`, la IA con visión de Anthropic (salida JSON validada con un esquema) es la principal y las reglas la verifican (ADR-017). Si discrepan en valor o fecha, esos campos bajan de confianza y el comprobante va a revisión. Si la IA no responde, se sigue con las reglas.
- El texto del comprobante se pasa a la IA como datos, nunca como instrucciones.
- Las palabras leídas conservan su posición, para resaltar cada campo sobre la imagen en la Bandeja.

**Consecuencias:** COROC lee comprobantes sin depender de un proveedor externo, y la IA se activa con una variable de entorno cuando haya contrato. Los proveedores de OCR en la nube quedan como adaptadores futuros.

### ADR-038 · Huella lógica sin la entidad cuando hay referencia
**Contexto:** el mismo pago puede llegar como captura de WhatsApp (donde el OCR no siempre lee el logo del banco) y como PDF por correo (donde sí). Con la entidad dentro de la huella, CA-07 registraba el pago dos veces. **Decisión:** con referencia, la huella lógica es referencia + valor + fecha. Sin referencia, sigue siendo valor + fecha + hora + entidad + pagador. La huella se compara contra lo aplicado y contra lo que espera revisión (ADR-020). En la base, dos índices únicos parciales impiden dos aplicaciones del mismo comprobante aunque lleguen a la vez. **Consecuencias:** un reenvío en otro formato queda DUPLICADO. Dos pagos distintos con la misma referencia, el mismo valor y la misma fecha en bancos distintos se confundirían, un caso que no se considera realista.

### ADR-039 · El pago automático y el estado del comprobante en la misma transacción
**Decisión:** la tarea de lectura corre en la bandeja de salida (ADR-032). Cuando decide aplicar, registra el pago con `PaymentsService.postTx` dentro de la transacción que actualiza el comprobante, con un punto de guardado:
- si el pago no se puede registrar (fecha fuera de rango, préstamo pagado, otro igual al mismo tiempo), se deshace solo ese paso y el comprobante va a revisión;
- después de 5 intentos fallidos, el comprobante queda en la Bandeja con la alerta «No se pudo leer el archivo».

**Consecuencias:** nunca queda un pago sin su comprobante, ni un comprobante «aplicado» sin su pago (§14: todo o nada).

### ADR-040 · Portal del deudor sin JavaScript y enlace con token cifrado
**Decisión:** el portal (`/v1/public/upload/{token}`) es una página generada por el servidor:
- **Página:** sin JavaScript ni recursos externos (política de seguridad `default-src 'none'`), con la marca, en el idioma del deudor y con selector de idioma.
- **Contenido:** el nombre del deudor, el contrato, el saldo, la próxima cuota y el plan, sin apellidos ni documentos.
- **Formulario:** se envía y responde con Post/Redirect/Get.
- **Token:** de 24 bytes al azar. Se busca por su hash y se guarda cifrado con `COROC_DATA_KEY`, para poder mostrarlo otra vez y usarlo en los mensajes de la Fase 4. Rotarlo invalida el anterior; vence en 365 días (`COROC_UPLOAD_LINK_DAYS`).
- **Límites de envío:** 20 archivos por enlace por hora y 60 por dirección IP.

**Consecuencias:** funciona en cualquier celular, incluso con navegadores antiguos, y un enlace filtrado se desactiva con un toque.

### ADR-041 · Canales entrantes: WhatsApp Cloud API y correo de Postmark
**Decisión:**
- **WhatsApp:** el webhook verifica la firma `X-Hub-Signature-256` con el secreto de la app de Meta. Reconoce la empresa por el número que recibió el mensaje (tabla `whatsapp_accounts`, con el token cifrado) y descarga el medio antes de responder, porque su URL caduca en minutos. Es idempotente por el identificador del mensaje.
- **Correo:** llega al webhook en el formato JSON de Postmark, con un secreto en la URL o por autenticación básica. La empresa se reconoce por la dirección `pagos-<empresa>@<COROC_INBOUND_EMAIL_DOMAIN>`, y los adjuntos que no son imagen ni PDF se ignoran.
- **Límites de esta fase:** los mensajes de texto y los estados de entrega de WhatsApp llegan en la Fase 4, con la mensajería.

**Consecuencias:** CA-07 y CA-08 se verifican con el canal real. SendGrid o SES se conectan con un adaptador que produzca el mismo JSON.

### ADR-042 · «Compartir con COROC» con un plugin propio y la escena de iOS
**Contexto:** en iOS, una extensión para compartir exige un destino aparte en Xcode, grupos de apps y su propio perfil de firma. La firma para tiendas está pendiente (P-2). **Decisión:**
- **Plugin:** `coroc_share`, dentro del repositorio.
- **Android:** filtros `ACTION_SEND` y `ACTION_SEND_MULTIPLE` para imágenes y PDF, agregados por `patch_platforms.py`.
- **iOS:** COROC declara los tipos de documento imagen y PDF, así que aparece al compartir o abrir esos archivos. El plugin recibe el archivo por el ciclo de vida de la escena (`addSceneDelegate`, en frío o con la app abierta), lo copia a la caché y la app lo envía a la Bandeja por el canal `share`.
- **Escritorio:** se usa la carpeta vigilada o el botón «Subir comprobante».

**Consecuencias:** funciona sin extensiones ni firma adicional. La extensión para compartir de iOS, con vista previa dentro de la hoja, queda para la fase de publicación.

### ADR-043 · Carpeta vigilada en escritorio
**Decisión:** en Windows y macOS, la carpeta COROC se vigila con el sistema de archivos y además se revisa cada 2 minutos. Las imágenes y PDF nuevos en `_Entrada` o en la carpeta de un cliente, que no hayan cambiado en los últimos 10 segundos, se suben a la Bandeja por el canal `folder`. Si estaban en la carpeta de un cliente, ese cliente queda identificado. El original se retira: la copia con el nombre estándar vuelve con la sincronización. Los demás archivos se siguen ofreciendo para importar como documentos. La vigilancia se puede apagar en Configuración. **Consecuencias:** en la oficina basta con guardar el comprobante en la carpeta. En los teléfonos la carpeta sigue siendo solo de llegada (ADR-036).
