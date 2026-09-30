# Funciones compartidas por los scripts de COROC para un PC con Windows (guía: docs/GUIA_PC_WINDOWS.md).
# Se carga con «. $PSScriptRoot\comun.ps1». Funciona en Windows PowerShell 5.1, el que trae Windows 10 y 11.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

$Servidor = $PSScriptRoot
$Raiz = Split-Path $Servidor -Parent
$Compose = Join-Path $Servidor 'docker-compose.yml'
$ArchivoEnv = Join-Path $Servidor '.env'
$App = Join-Path $Raiz 'app\coroc.exe'
$Salud = 'http://127.0.0.1:3000/health'

function Paso([string]$texto) { Write-Host ''; Write-Host "==> $texto" -ForegroundColor Cyan }
function Bien([string]$texto) { Write-Host "    OK  $texto" -ForegroundColor Green }
function Aviso([string]$texto) { Write-Host "    !   $texto" -ForegroundColor Yellow }

function Detener-ConMensaje([string]$texto) {
  Write-Host ''
  Write-Host $texto -ForegroundColor Red
  Write-Host ''
  Read-Host 'Oprima Enter para cerrar esta ventana'
  exit 1
}

function Hay-Docker { [bool](Get-Command docker -ErrorAction SilentlyContinue) }

function Docker-Responde {
  # «docker info» escribe en la salida de errores cuando el motor está apagado; no debe detener el script.
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { docker info *> $null; return $LASTEXITCODE -eq 0 } finally { $ErrorActionPreference = $prev }
}

# Enciende Docker Desktop si está apagado y espera hasta 5 minutos a que responda.
function Asegurar-Docker {
  if (-not (Hay-Docker)) {
    Start-Process 'https://www.docker.com/products/docker-desktop/'
    Detener-ConMensaje ("Falta Docker Desktop, el programa que mantiene encendido el servidor de COROC.`n" +
      "Se abrió su página de descarga: instálelo (Download for Windows), reinicie el PC si se lo pide, ábralo una vez,`n" +
      "acepte sus condiciones y vuelva a ejecutar este instalador. Guía: docs/GUIA_PC_WINDOWS.md, paso 1.")
  }
  if (Docker-Responde) { return }
  $desktop = @("$env:ProgramFiles\Docker\Docker\Docker Desktop.exe", "$env:LOCALAPPDATA\Docker\Docker Desktop.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($desktop) {
    Write-Host '    Encendiendo Docker Desktop (puede tardar un par de minutos)...'
    Start-Process $desktop
  }
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 5
    if (Docker-Responde) { Bien 'Docker Desktop está encendido'; return }
  }
  Detener-ConMensaje ("Docker Desktop no respondió. Ábralo desde el menú Inicio, espere a que diga «Engine running»`n" +
    "(motor encendido) y vuelva a intentarlo. Si pide activar WSL o la virtualización, siga sus indicaciones.")
}

function Compose { docker compose -f $Compose --project-directory $Servidor @args }

function Esperar-Servidor([int]$minutos = 5) {
  for ($i = 0; $i -lt ($minutos * 12); $i++) {
    try {
      $r = Invoke-WebRequest -Uri $Salud -UseBasicParsing -TimeoutSec 4
      if ($r.StatusCode -eq 200) { return $true }
    } catch { }
    Start-Sleep -Seconds 5
  }
  return $false
}

function Encender-Servidor {
  Paso 'Encendiendo el servidor de COROC'
  Compose up -d
  if ($LASTEXITCODE -ne 0) { Detener-ConMensaje 'No se pudo encender el servidor. Tome una captura de esta ventana y envíela.' }
  if (-not (Esperar-Servidor)) {
    Compose logs --tail 40 api
    Detener-ConMensaje 'El servidor no respondió a tiempo. Tome una captura de esta ventana y envíela.'
  }
  Bien 'El servidor responde en este PC'
}
