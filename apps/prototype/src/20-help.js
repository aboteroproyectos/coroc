/* COROC · ayuda y decisiones documentadas (regla 3 del prompt maestro) */
C.HELP = [
  ['sparkle', 'Cómo trabaja COROC', 'Usted registra al cliente y las condiciones del préstamo una sola vez. COROC genera el plan de pagos, crea la carpeta del cliente, prepara los mensajes, lee los comprobantes que llegan, registra los pagos, emite el recibo «Gracias por tu pago» y actualiza el cuadro de inversión y el dashboard. Todo queda en la bitácora y usted puede revertirlo.'],
  ['users', 'Crear un cliente', 'Botón «Nuevo cliente» (tecla N). Paso 1: datos personales; el número de WhatsApp es la llave para reconocer quién envía cada comprobante. Paso 2: condiciones con vista previa en vivo del plan, tasa efectiva anual y control del tope legal. Paso 3: autorizaciones de mensajes y de datos personales.'],
  ['inbox', 'Cómo llegan los comprobantes', 'Arrástrelos a la Bandeja (indicando, si lo sabe, el número de WhatsApp que lo envió), súbalos desde la ficha del cliente o déjelos en la carpeta COROC › _Entrada o en la subcarpeta «02 Comprobantes recibidos» del cliente y pulse «Revisar carpeta COROC». COROC lee el valor, la fecha, quién paga y quién recibe.'],
  ['shield', 'Cuándo registra solo y cuándo le pregunta', 'Registra solo cuando identifica al cliente sin duda, la lectura supera el umbral de confianza, el pago se hizo a una de sus cuentas receptoras, la fecha es válida y el comprobante no está repetido. En cualquier otro caso lo deja en la Bandeja con la alerta que explica por qué. Un registro automático se revierte con un toque durante el plazo configurado.'],
  ['receipt', 'Recibos y documentos', 'Cada pago genera un recibo PDF con número consecutivo, cuotas pactadas, valor pagado, cuota pagada, cuotas restantes, acumulado y nuevo saldo, más un código de verificación. Un reverso no borra el recibo: lo marca como ANULADO. Al terminar de pagar se emite el paz y salvo.'],
  ['chat', 'Mensajería y Ley 2300', 'En modo asistido COROC escribe cada mensaje y abre WhatsApp o el correo con el texto listo; usted confirma. Las reglas de contacto se aplican solas: lunes a viernes de 7:00 a. m. a 7:00 p. m., sábados de 8:00 a. m. a 3:00 p. m., nunca domingos ni festivos, un contacto de cobranza por día y un solo canal por semana. Lo que cae fuera de franja se reprograma.'],
  ['folder', 'Carpeta COROC', 'En Chrome o Edge de escritorio COROC le pide permiso una vez y crea la carpeta COROC con una subcarpeta por cliente y por contrato. En otros navegadores descargue la carpeta completa como ZIP desde Configuración › Carpeta COROC.'],
  ['archive', 'Respaldo', 'El botón de respaldo crea un único archivo .coroc cifrado con AES-256 que contiene toda la información y todos los documentos. La restauración verifica la huella de cada archivo antes de reemplazar nada.'],
  ['key', 'Usuarios y roles', 'Propietario: todo. Administrador: todo excepto restaurar respaldos. Cobrador: solo sus clientes; registra pagos y valida comprobantes. Auditor: solo lectura. La sesión se bloquea sola tras unos minutos sin uso.'],
];
C.DECISIONS = [
  ['ADR-001', 'Montos en enteros de la unidad mínima de la moneda', 'Evita errores de redondeo. Las tasas se calculan con decimales de 40 dígitos y el resultado se redondea mitad hacia arriba.'],
  ['ADR-002', 'La última cuota absorbe la diferencia de redondeo', 'La suma de las cuotas siempre es exactamente el total pactado.'],
  ['ADR-003', 'Los saldos se derivan del libro de movimientos', 'Ningún pago se edita ni se borra; las correcciones son reversos con motivo.'],
  ['ADR-004', 'Orden de aplicación de pagos', 'Primero la mora, luego las cuotas de la más antigua a la más reciente; el excedente queda como saldo a favor.'],
  ['ADR-005', 'Tope legal de tasa obligatorio', 'COROC calcula la tasa efectiva anual real con la TIR de los flujos y no guarda préstamos por encima del tope registrado.'],
  ['ADR-006', 'Contraseñas', 'En esta versión local se usa PBKDF2-SHA256 con 310.000 iteraciones (disponible en todos los navegadores); en el servidor se usará Argon2id.'],
  ['ADR-007', 'WhatsApp en modo asistido', 'La política de WhatsApp Business restringe la cobranza de deudas; COROC no usa automatizaciones no oficiales. El modo automático con la API oficial queda para el servidor, sujeto a aprobación de Meta.'],
  ['ADR-008', 'Reglas de contacto por defecto', 'Se aplica el preset de Colombia (Ley 2300 de 2023) también a los mensajes transaccionales, salvo que el propietario habilite su envío inmediato.'],
  ['ADR-009', 'Recordatorios de préstamos diarios desactivados por defecto', 'El deudor ya conoce su cuota diaria; enviar un mensaje cada día sería un contacto excesivo. Se puede activar.'],
  ['ADR-010', 'Doble control de duplicados', 'Huella SHA-256 del archivo y huella lógica (referencia, valor, fecha y entidad).'],
  ['ADR-011', 'Pagador inferido', 'Si el comprobante no muestra quién paga (algunas billeteras no lo imprimen) y el remitente está verificado, se asume el cliente y queda una alerta no bloqueante.'],
  ['ADR-012', 'Respaldo cifrado', 'ZIP con manifiesto de huellas SHA-256 dentro de un sobre AES-256-GCM con clave derivada por PBKDF2.'],
  ['ADR-013', 'Nombres de carpeta sin tildes', 'Las carpetas y archivos usan el nombre del cliente sin tildes ni eñes («Maria Jose Perez Gomez - C000001») para que funcionen igual en Windows, macOS, celulares, archivos ZIP y sincronizadores en la nube. En la aplicación y en los documentos el nombre se muestra completo.'],
  ['ADR-018', 'Formato de dinero', 'En pantalla cada moneda usa su formato nativo sin importar el idioma; los documentos para el deudor usan su idioma e indican la moneda.'],
  ['ADR-019', 'Fechas sin rótulo en los comprobantes', 'Si el comprobante muestra una sola fecha completa con año, se acepta aunque no tenga rótulo; una fecha relativa («hoy») siempre pasa a revisión.'],
  ['ADR-020', 'Duplicados también contra la bandeja', 'Un comprobante que llega de nuevo mientras el primero espera revisión se marca como duplicado.'],
];

C.views.help = (view) => {
  view.innerHTML = `<div class="page-head"><div><h1>${C.esc(C.t('Ayuda'))}</h1><p>${C.esc(C.t('Guía de uso y decisiones tomadas en el diseño de COROC.'))}</p></div></div>
    <div class="grid g2">${C.HELP.map(([ic, t, d]) => `<article class="card card-pad"><div style="display:flex;gap:12px">${C.icon(ic, 24, 'gold')}<div><h3>${C.esc(C.t(t))}</h3><p class="muted" style="margin:8px 0 0">${C.esc(C.t(d))}</p></div></div></article>`).join('')}</div>
    <h2 class="section" style="margin-bottom:14px">${C.esc(C.t('Decisiones documentadas'))}</h2>
    <div class="card"><div class="list">${C.DECISIONS.map(([id, t, d]) => `<div class="li" style="align-items:flex-start"><span class="chip plain">${id}</span><div class="grow"><div class="row-title">${C.esc(C.t(t))}</div><div class="row-sub" style="font-size:13px">${C.esc(C.t(d))}</div></div></div>`).join('')}</div></div>
    <article class="card card-pad section"><h3>${C.esc(C.t('Alcance de esta versión'))}</h3><p class="muted" style="margin:8px 0 0">${C.esc(C.t('Esta versión funciona completa en el navegador y guarda la información en este equipo; proteja el acceso al computador y cree respaldos cifrados con frecuencia. La recepción automática desde WhatsApp, el enlace personal de carga para el deudor, el envío directo de correos y la sincronización entre dispositivos requieren el servidor COROC (fases 3 y 4 del plan).'))}</p></article>`;
};
