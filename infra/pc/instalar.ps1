# Instala COROC en este PC con Windows: servidor en Docker Desktop, primera empresa y acceso directo en el escritorio.
# Se ejecuta con «1-Instalar-COROC.bat». Se puede repetir sin riesgo: lo que ya está hecho se salta y los datos se conservan.
. "$PSScriptRoot\comun.ps1"

Write-Host ''
Write-Host '  COROC - instalación en este PC' -ForegroundColor White
Write-Host '  ==============================='

Paso '1 de 5. Docker Desktop'
Asegurar-Docker

Paso '2 de 5. Claves del servidor'
if (Test-Path $ArchivoEnv) {
  Bien 'Ya existían; se conservan (sin ellas no se pueden leer los documentos guardados)'
} else {
  function Aleatorio([int]$bytes) {
    $b = New-Object byte[] $bytes
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
    [Convert]::ToBase64String($b)
  }
  function Clave { (Aleatorio 24) -replace '[+/=]', 'x' }
  $contenido = @(
    '# Claves de COROC en este PC. Generadas al instalar; NO las cambie ni borre este archivo:'
    '# COROC_DATA_KEY cifra los documentos guardados. Guarde una copia en una memoria USB (guía, paso 5).'
    "POSTGRES_PASSWORD=$(Clave)"
    "COROC_API_DB_PASSWORD=$(Clave)"
    "COROC_JWT_SECRET=$(Aleatorio 48)"
    "COROC_DATA_KEY=$(Aleatorio 32)"
    'COROC_API_PORT=3000'
    'COROC_PUBLIC_URL=http://localhost:3000'
    'COROC_BREACHED_CHECK=hibp'
    'COROC_MFA_OWNER=required'
    'COROC_OCR=tesseract'
    'COROC_DOCUMENT_WORKER=on'
    'COROC_MESSAGE_WORKER=on'
    'LOG_LEVEL=info'
  )
  [IO.File]::WriteAllLines($ArchivoEnv, $contenido, [Text.UTF8Encoding]::new($false))
  Bien 'Claves nuevas creadas en servidor\.env'
}

Paso '3 de 5. Programa del servidor'
$imagen = Join-Path $Servidor 'coroc-api.tar'
$marca = Join-Path $Servidor '.imagen-cargada'
$huella = if (Test-Path $imagen) { (Get-Item $imagen).Length.ToString() + '-' + (Get-Item $imagen).LastWriteTimeUtc.Ticks } else { '' }
if (-not (Test-Path $imagen)) {
  Detener-ConMensaje 'Falta servidor\coroc-api.tar. Descomprima de nuevo el paquete completo de COROC.'
} elseif ((Test-Path $marca) -and ((Get-Content $marca -Raw).Trim() -eq $huella)) {
  Bien 'Ya estaba cargado'
} else {
  Write-Host '    Cargando el servidor en Docker (unos minutos la primera vez)...'
  docker load -i $imagen
  if ($LASTEXITCODE -ne 0) { Detener-ConMensaje 'No se pudo cargar el servidor en Docker. Tome una captura y envíela.' }
  Set-Content -Path $marca -Value $huella
  Bien 'Servidor cargado'
}

Paso '4 de 5. Base de datos y servidor'
Write-Host '    La primera vez Docker descarga PostgreSQL y Redis desde internet (unos 200 MB).'
Encender-Servidor

Paso '5 de 5. Su empresa y su usuario'
$empresaCreada = Join-Path $Servidor '.empresa-creada'
if (Test-Path $empresaCreada) {
  Bien "Ya existe: $((Get-Content $empresaCreada -Raw).Trim())"
} else {
  Write-Host '    Ahora los datos con los que va a entrar a COROC. Escriba cada uno y oprima Enter.'
  Write-Host ''
  do { $nombre = (Read-Host '    Nombre de la empresa (p. ej. Inversiones Coroc S.A.S.)').Trim() } while (-not $nombre)
  $sugerido = ($nombre.Normalize([Text.NormalizationForm]::FormD) -replace '\p{Mn}', '' -replace '\.', '').ToLowerInvariant() -replace '[^a-z0-9]+', '-' -replace '^-|-$', ''
  if ($sugerido.Length -gt 40) { $sugerido = $sugerido.Substring(0, 40).TrimEnd('-') }
  do {
    $slug = (Read-Host "    Identificador de la empresa para entrar a la app [Enter = $sugerido]").Trim().ToLowerInvariant()
    if (-not $slug) { $slug = $sugerido }
    # Mismas reglas que la base (tenants_slug_chk): minúsculas, números y guiones, de 3 a 40 caracteres.
    $valido = $slug -cmatch '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'
    if (-not $valido) { Aviso 'Use solo minúsculas sin tildes, números y guiones (3 a 40 caracteres).' }
  } while (-not $valido)
  do {
    $pais = (Read-Host '    País donde presta: CO (pesos), BR (reales) o US (dólares) [Enter = CO]').Trim().ToUpperInvariant()
    if (-not $pais) { $pais = 'CO' }
  } while ($pais -notin @('CO', 'BR', 'US'))
  do {
    $usuario = (Read-Host '    Su usuario para entrar (p. ej. andres)').Trim().ToLowerInvariant()
    # Reglas de la base (users_username_chk): 3 a 32 caracteres entre minúsculas, números, punto, guion y guion bajo.
    $valido = $usuario -cmatch '^[a-z0-9._-]{3,32}$'
    if (-not $valido) { Aviso 'Use de 3 a 32 letras minúsculas sin tildes, números, punto o guion.' }
  } while (-not $valido)
  do { $persona = (Read-Host '    Su nombre completo').Trim() } while (-not $persona)
  $correo = (Read-Host '    Su correo (opcional, Enter para omitir)').Trim()

  Write-Host ''
  Write-Host '    La contraseña: mínimo 12 caracteres, que no use en otros sitios. No se ve al escribirla.'
  while ($true) {
    $p1 = Read-Host '    Contraseña' -AsSecureString
    $p2 = Read-Host '    Repítala' -AsSecureString
    $t1 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($p1))
    $t2 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($p2))
    if ($t1 -ne $t2) { Aviso 'No coinciden. Otra vez.'; continue }
    if ($t1.Length -lt 12) { Aviso 'Debe tener al menos 12 caracteres. Otra vez.'; continue }
    $argumentos = @('run', '--rm', '-T', 'migrate', 'node', 'dist/cli/tenant-create.js', '--slug', $slug, '--name', $nombre, '--country', $pais, '--owner', $usuario, '--owner-name', $persona)
    if ($correo) { $argumentos += @('--email', $correo) }
    # La contraseña va por la entrada estándar: no queda en la línea de comandos ni en los registros.
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $salida = $t1 | docker compose -f $Compose --project-directory $Servidor @argumentos 2>&1 | ForEach-Object { "$_" }
    $ok = $LASTEXITCODE -eq 0
    $ErrorActionPreference = $prev
    $t1 = $t2 = $null
    if ($ok) {
      Set-Content -Path $empresaCreada -Value "$nombre (identificador: $slug, usuario: $usuario)"
      Bien "Empresa «$nombre» creada"
      break
    }
    $motivo = ($salida | Where-Object { $_ -match 'Error|contraseña|password|duplicate|existe' } | Select-Object -Last 1)
    Aviso "No se pudo crear: $motivo"
    if ($salida -match 'duplicate key|tenants_slug_uq') {
      Aviso "El identificador «$slug» ya está en uso en este PC. Vuelva a ejecutar el instalador con otro."
      Read-Host 'Oprima Enter para cerrar'; exit 1
    }
    Aviso 'Si la contraseña es muy común o apareció en filtraciones, use otra más larga.'
  }
}

Paso 'Acceso directo en el escritorio'
$escritorio = [Environment]::GetFolderPath('Desktop')
$acceso = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $escritorio 'COROC.lnk'))
$acceso.TargetPath = Join-Path $Raiz 'Abrir-COROC.bat'
$acceso.WorkingDirectory = $Raiz
$acceso.WindowStyle = 7
if (Test-Path $App) { $acceso.IconLocation = "$App,0" }
$acceso.Save()
Bien 'Creado el acceso «COROC» en el escritorio'

Write-Host ''
Write-Host '  Listo. COROC quedó instalado en este PC.' -ForegroundColor Green
Write-Host '  Para entrar: identificador de la empresa, su usuario y su contraseña.'
Write-Host '  La primera vez la app le pide activar la verificación en dos pasos (Google Authenticator o similar).'
Write-Host ''
if (Test-Path $App) { Start-Process $App -WorkingDirectory (Split-Path $App) }
Read-Host 'Oprima Enter para cerrar esta ventana'
