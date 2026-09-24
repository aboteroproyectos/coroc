# Guía para poner COROC en internet (sin conocimientos técnicos)

Esta guía es para el dueño de la empresa. Todo se hace desde el navegador: no hay que instalar nada ni escribir comandos.
Son cuatro pasos. Tómese su tiempo: puede hacer uno hoy y otro mañana. Si algo no se ve igual a como está descrito aquí,
tome una captura de pantalla y envíela a quien le ayuda con COROC.

**Qué va a necesitar:** la tarjeta de crédito de la empresa, un correo de la empresa y unos 45 minutos.
**Costo aproximado:** 30 a 40 dólares al mes en Fly.io. Cloudflare R2 no cobra mientras se guarden menos de 10 GB.

**Antes de empezar,** abra un documento o una libreta y llámelo «Claves de COROC». Ahí va a pegar lo que copie en los
pasos 1 y 2. Guárdelo en un lugar seguro (un gestor de contraseñas es lo ideal) y no lo envíe por correo ni por chat.

---

## Paso 1. Fly.io: el servidor donde vive COROC

1. Entre a **https://fly.io** y oprima **Sign up**. Regístrese con el correo de la empresa.
2. Fly.io le pedirá una tarjeta: agregue la de la empresa (**Billing › Add payment method**).
3. En el panel, en el menú de la izquierda, busque **Tokens** (a veces está dentro de **Account** o de su organización).
4. Oprima **Create token**. Si le pregunta el tipo, elija **Org token** (de la organización) y póngale de nombre
   `github-coroc`. Si le pide vencimiento, elija el más largo.
5. Aparece un texto muy largo que empieza por `FlyV1`. **Cópielo completo** y péguelo en «Claves de COROC» con el
   título **FLY_API_TOKEN**. Solo se muestra una vez.

## Paso 2. Cloudflare R2: el disco donde se guardan los recibos

1. Entre a **https://dash.cloudflare.com/sign-up** y cree la cuenta con el correo de la empresa.
2. En el menú de la izquierda elija **R2 Object Storage**. La primera vez le pide activar R2 y una tarjeta: agréguela
   (no cobra mientras use poco).
3. Cree el primer depósito: **Create bucket** › nombre exactamente `coroc-objects` › ubicación **Automatic** ›
   **Create bucket**.
4. Vuelva a **R2 Object Storage** y cree el segundo: nombre exactamente `coroc-db-backups`.
5. En la página principal de R2 busque **Manage API tokens** (o **API › Manage API Tokens**) y oprima
   **Create API token** (o **Create Account API token**):
   - Nombre: `coroc`.
   - Permisos: **Object Read & Write**.
   - En **Specify bucket(s)** elija **Apply to specific buckets only** y marque `coroc-objects` y `coroc-db-backups`.
   - Oprima **Create API Token**.
6. La página siguiente muestra tres datos. **Cópielos los tres** a «Claves de COROC» con estos títulos:
   - **Access Key ID** → título **R2_ACCESS_KEY_ID**
   - **Secret Access Key** → título **R2_SECRET_ACCESS_KEY**
   - la dirección que termina en `.r2.cloudflarestorage.com` (puede decir *S3 API* o *jurisdiction-specific endpoint*)
     → título **R2_ENDPOINT**. Debe verse así: `https://abc123….r2.cloudflarestorage.com`

## Paso 3. Dos frases que usted inventa

Invente estas dos y escríbalas en «Claves de COROC». **No las olvide:**

- **BACKUP_PASSPHRASE**: una frase larga, de al menos 20 caracteres, por ejemplo cinco palabras al azar separadas por
  guiones: `mango-silla-azul-trueno-cuaderno`. Con ella se cifran las copias de seguridad y la llave de los documentos.
  **Si se pierde, no hay forma de recuperar los documentos en caso de desastre.** Guárdela también en papel.
- **COROC_OWNER_PASSWORD**: la contraseña con la que usted entrará a COROC la primera vez. Mínimo 12 caracteres, que no
  sea una contraseña conocida ni la haya usado en otro sitio. Después podrá cambiarla desde la app.

## Paso 4. Cargar las claves en GitHub y oprimir el botón

1. Entre a **https://github.com/aboteroproyectos/coroc** › pestaña **Settings** (arriba a la derecha) › en el menú de la
   izquierda **Secrets and variables** › **Actions**.
2. Oprima **New repository secret** una vez por cada clave. En **Name** escriba el título tal cual y en **Secret** pegue
   el valor. Son seis:

   | Name | Qué pegar |
   |---|---|
   | `FLY_API_TOKEN` | el texto largo del paso 1 |
   | `R2_ENDPOINT` | la dirección `https://….r2.cloudflarestorage.com` del paso 2 |
   | `R2_ACCESS_KEY_ID` | el Access Key ID del paso 2 |
   | `R2_SECRET_ACCESS_KEY` | el Secret Access Key del paso 2 |
   | `BACKUP_PASSPHRASE` | la frase larga del paso 3 |
   | `COROC_OWNER_PASSWORD` | su contraseña inicial del paso 3 |

3. Vaya a la pestaña **Actions** del repositorio › en la lista de la izquierda **Preparar producción** › botón
   **Run workflow** (a la derecha). Se abre un formulario:
   - **Nombre de la empresa**: por ejemplo `Inversiones Coroc S.A.S.`
   - **Identificador corto**: el mismo nombre en minúsculas y con guiones, sin tildes: `inversiones-coroc`. Es el que
     escribirá al entrar a la app.
   - **País**: donde presta y cobra. **CO** si cobra en pesos colombianos, **BR** si cobra en reales (Pix), **US** si
     cobra en dólares. Define la moneda, el idioma de los mensajes al cliente, la zona horaria y las reglas legales.
   - **Usuario del Propietario**: por ejemplo `andres`.
   - **Nombre completo** y **correo** del Propietario.
4. Oprima el botón verde **Run workflow**. Aparece una fila con un círculo amarillo girando: tarda unos 15 minutos.
   - **Marca verde ✔:** COROC ya está en internet. Al abrir la fila verá el resumen con la dirección.
   - **Cruz roja ✖:** no se dañó nada. Abra la fila, tome una captura del mensaje en rojo y envíela. El botón se puede
     volver a oprimir cuantas veces haga falta: lo que ya quedó hecho se salta.

Desde ese momento, cada mejora que se apruebe en COROC se publica sola.

---

## Después: la aplicación

- Mientras no haya dominio propio, la dirección es `https://coroc-api.fly.dev`.
- Para entrar: identificador de la empresa, usuario y la contraseña del paso 3. La primera vez la app pide activar la
  verificación en dos pasos (con una app como Google Authenticator o Microsoft Authenticator).

## Si algún día cambia de proveedor o pierde el acceso a Fly.io

La llave de los documentos queda guardada, cifrada con su **BACKUP_PASSPHRASE**, en Cloudflare R2:
`coroc-db-backups/claves/COROC_DATA_KEY.enc`. Las copias semanales de la base quedan en el mismo depósito. Con la frase
y ese depósito se puede reconstruir todo (docs/06_EJECUCION_Y_DESPLIEGUE.md §6).
