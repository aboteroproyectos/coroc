# Apaga el servidor de COROC en este PC (los datos se conservan). Lo usa «Detener-COROC.bat». No hace falta usarlo a
# diario: el servidor casi no consume mientras no se usa, y se vuelve a encender con «Abrir-COROC.bat».
. "$PSScriptRoot\comun.ps1"

Paso 'Apagando el servidor de COROC'
if (-not (Docker-Responde)) { Bien 'Docker Desktop ya estaba apagado'; exit 0 }
Compose stop
Bien 'Servidor apagado. Sus datos siguen guardados en este PC.'
Start-Sleep -Seconds 3
