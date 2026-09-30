# Abre COROC: enciende Docker Desktop y el servidor si hace falta, y luego la aplicación. Lo usa «Abrir-COROC.bat»
# (y el acceso directo del escritorio). Si el servidor ya está encendido, la aplicación abre de inmediato.
. "$PSScriptRoot\comun.ps1"

if (-not (Test-Path $ArchivoEnv)) { Detener-ConMensaje 'COROC todavía no está instalado en este PC. Ejecute primero «1-Instalar-COROC.bat».' }
$listo = $false
try { $listo = (Invoke-WebRequest -Uri $Salud -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch { }
if (-not $listo) {
  Asegurar-Docker
  Encender-Servidor
}
if (-not (Test-Path $App)) { Detener-ConMensaje 'No encuentro app\coroc.exe. Descomprima de nuevo el paquete completo de COROC.' }
Start-Process $App -WorkingDirectory (Split-Path $App)
