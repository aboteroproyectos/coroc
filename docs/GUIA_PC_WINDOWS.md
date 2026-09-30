# COROC en su PC con Windows (todo en el mismo equipo)

Esta guía instala COROC completo en **un solo PC con Windows**: la aplicación y el servidor donde se guardan los datos.
No usa la nube ni tiene costo mensual. No hace falta saber de sistemas: son clics y unas preguntas.

**Qué funciona y qué no en esta modalidad**

| Funciona | No funciona (necesita la nube, [GUIA_PUESTA_EN_MARCHA.md](GUIA_PUESTA_EN_MARCHA.md)) |
|---|---|
| Clientes, préstamos, pagos, recibos en PDF, informes | Cobradores desde su celular |
| Leer comprobantes que usted sube o arrastra, y la carpeta COROC | Enlace para que el deudor suba su comprobante |
| Respaldos cifrados | Recordatorios automáticos por WhatsApp o correo |

Más adelante puede pasar todo a la nube sin volver a digitar nada: se hace con un respaldo (ver «Pasar a la nube»).

**Qué necesita:** Windows 10 u 11 de 64 bits, 8 GB de memoria o más, 15 GB libres en el disco e internet durante la
instalación (después funciona sin internet, salvo la verificación de contraseñas filtradas).

---

## Paso 1. Instalar Docker Desktop (una sola vez, unos 15 minutos)

Docker Desktop es el programa que mantiene encendido el servidor de COROC dentro de su PC. Es gratuito para personas y
empresas pequeñas (menos de 250 empleados y menos de 10 millones de dólares de ingresos al año).

1. Entre a **https://www.docker.com/products/docker-desktop/** y oprima **Download for Windows**. Si le pregunta,
   elija **AMD64** (la opción normal).
2. Abra el archivo descargado (*Docker Desktop Installer.exe*). Deje marcada la opción **Use WSL 2** y oprima **OK**.
3. Al terminar, oprima **Close and restart** (o reinicie el PC).
4. Después de reiniciar, abra **Docker Desktop** desde el menú Inicio:
   - acepte las condiciones (**Accept**);
   - si le pide iniciar sesión o crear cuenta, oprima **Skip** (no hace falta);
   - si le pide actualizar WSL o activar la virtualización, siga lo que dice la pantalla y reinicie.
   - si dice **«WSL not installed»**: oprima **Quit**; abra el menú Inicio, escriba `powershell`, clic derecho sobre
     **Windows PowerShell › Ejecutar como administrador**; escriba `wsl --install` y Enter. Si al final le pide un
     usuario y contraseña de Ubuntu, invéntelos (COROC no los usa). Reinicie el PC y vuelva a abrir Docker Desktop.
5. Espere a que abajo a la izquierda diga **Engine running** (motor encendido) en verde.
6. Para que COROC esté listo cada vez que prenda el PC: en Docker Desktop, ⚙ **Settings › General**, deje marcada
   **Start Docker Desktop when you sign in to your computer**.

## Paso 2. Descargar COROC

1. Entre a **https://github.com/aboteroproyectos/coroc** (con su usuario de GitHub).
2. A la derecha, en **Releases**, abra la más reciente: **COROC para PC con Windows**.
3. En **Assets**, descargue **COROC-PC-Windows.zip** (pesa unos 380 MB).
4. Abra la carpeta Descargas, haga clic derecho sobre el archivo › **Extraer todo…** › en la ruta escriba `C:\` › **Extraer**.
   Queda la carpeta **C:\COROC**. No la mueva después de instalar.

## Paso 3. Instalar

1. Abra **C:\COROC** y haga doble clic en **1-Instalar-COROC**.
2. Si aparece «Windows protegió su PC», oprima **Más información** › **Ejecutar de todas formas**. (Aparece porque la
   aplicación todavía no tiene firma digital; es la misma que se compila en GitHub.)
3. Se abre una ventana negra que va mostrando los pasos. La primera vez tarda unos 10 minutos: carga el servidor y
   descarga la base de datos.
4. Al final le hace unas preguntas. Escriba cada respuesta y oprima **Enter**:
   - **Nombre de la empresa**, por ejemplo `Inversiones Coroc S.A.S.`;
   - **Identificador**: con Enter acepta el que propone. Lo va a escribir al entrar a la app: anótelo;
   - **País**: `CO` si cobra en pesos colombianos, `BR` si cobra en reales (Pix), `US` si cobra en dólares;
   - **su usuario**, **su nombre** y, si quiere, **su correo**;
   - **su contraseña**, dos veces: mínimo 12 caracteres. No se ve mientras la escribe; es normal.
5. Al terminar, se crea el acceso **COROC** en el escritorio y se abre la aplicación.

Si algo sale en rojo, tome una captura de la ventana y envíela. El instalador se puede volver a ejecutar sin riesgo:
lo que ya quedó hecho se salta y no se pierde nada.

## Paso 4. Primer ingreso

1. En la aplicación escriba el **identificador de la empresa**, **su usuario** y **su contraseña**.
2. La primera vez le pide activar la **verificación en dos pasos**. Instale en su celular **Google Authenticator** o
   **Microsoft Authenticator**, escanee el código que muestra COROC y escriba los 6 números.
3. Listo: ya puede crear clientes y préstamos.

## Paso 5. Copias de seguridad (muy importante)

Todo queda **solo en este PC**. Si el disco se daña o el PC se pierde, sin copia se pierde todo.

- **Cada semana:** en COROC, **Configuración › Respaldo › Crear respaldo**. Elija una contraseña para el respaldo y
  guarde el archivo `.coroc` en una memoria USB o en Google Drive/OneDrive. Sin esa contraseña el respaldo no se abre.
- **Una sola vez:** copie el archivo **C:\COROC\servidor\.env** a una memoria USB y guárdela en un lugar seguro.
  Tiene las llaves del servidor. No lo envíe por correo ni por chat.

## El día a día

- **Abrir:** doble clic en **COROC** en el escritorio. Si el servidor estaba apagado, lo enciende solo (tarda un
  minuto) y luego abre la aplicación.
- **Apagar el PC:** normal, como siempre. Al volver a prender, Docker Desktop arranca solo y COROC queda listo.
- **Detener-COROC** (en C:\COROC): apaga el servidor si necesita liberar memoria. Los datos se conservan.

## Pasar a la nube más adelante

1. En COROC del PC: **Configuración › Respaldo › Crear respaldo**.
2. Siga [GUIA_PUESTA_EN_MARCHA.md](GUIA_PUESTA_EN_MARCHA.md) para crear el servidor en la nube.
3. En la aplicación conectada a la nube: **Configuración › Respaldo › Restaurar** con ese archivo y su contraseña.

## Problemas frecuentes

| Qué pasa | Qué hacer |
|---|---|
| «Falta Docker Desktop» | Haga el paso 1 y vuelva a ejecutar el instalador. |
| «Docker Desktop no respondió» | Abra Docker Desktop, espere a *Engine running* y vuelva a intentar. |
| La app dice que no hay conexión con el servidor | Cierre la app y ábrala con el acceso **COROC** del escritorio (no con coroc.exe directamente). |
| «No se pudo crear» la empresa por la contraseña | Use una más larga que no haya usado en otros sitios; el instalador vuelve a preguntar. |
| Olvidé el identificador de la empresa | Está en el archivo C:\COROC\servidor\.empresa-creada (ábralo con el Bloc de notas). |

Para quien da soporte: los archivos del paquete salen de `infra/pc/` y el flujo `.github/workflows/pc-windows.yml` arma el
.zip (app de Windows apuntando a `http://localhost:3000/v1` e imagen `coroc-api:pc`). El servidor usa
`infra/pc/docker-compose.yml` con el proyecto `coroc`; `docker compose -f C:\COROC\servidor\docker-compose.yml logs api`
muestra sus registros.
