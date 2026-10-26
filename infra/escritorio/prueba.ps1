<#
  Prueba de punta a punta de COROC Escritorio en Windows (CI, windows-latest, sin derechos de administrador).

    pwsh infra/escritorio/prueba.ps1 -Instalador <COROC-Escritorio-Windows.exe>

  E-1  instalación limpia en silencio, sin Docker ni administrador, hasta COROC listo en menos de 5 minutos
       crear la empresa (asistente), un préstamo por encima del tope con la casilla (E-6) y un pago
       el recibo en PDF hecho con Microsoft Edge; un comprobante leído con Tesseract
  E-2  apagar y volver a encender: datos intactos; actualizar encima: copia previa y datos intactos
       desinstalar conserva los datos; con /BORRARDATOS los borra
#>
param(
  [Parameter(Mandatory = $true)] [string] $Instalador,
  [string] $Comprobante = (Join-Path $PSScriptRoot 'prueba\comprobante.png')
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$ProgressPreference = 'SilentlyContinue'

$base = Join-Path $env:LOCALAPPDATA 'COROC'
$datos = Join-Path $base 'datos'
$node = Join-Path $base 'servidor\node.exe'
$cli = Join-Path $base 'servidor\services\api\dist\desktop\supervisor\cli.js'
$tmp = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$script:sup = $null

function Paso([string] $t) { Write-Host "`n▶ $t" -ForegroundColor Cyan }
function Ok([string] $t) { Write-Host "  ✔ $t" -ForegroundColor Green }
function Falla([string] $t) { throw "✘ $t" }

function Instalar([string] $log) {
  $p = Start-Process $Instalador -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/LOG=`"$log`"" -Wait -PassThru
  if ($p.ExitCode -ne 0) { Get-Content $log -Tail 40; Falla "el instalador terminó con $($p.ExitCode)" }
}

function Desinstalar([string[]] $extra = @()) {
  $unins = Join-Path $base 'unins000.exe'
  if (-not (Test-Path $unins)) { Falla 'falta el desinstalador' }
  Start-Process $unins -ArgumentList (@('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART') + $extra) -Wait | Out-Null
  # El desinstalador se copia a una carpeta temporal y sigue desde ahí: se espera a que termine de verdad.
  for ($i = 0; $i -lt 120 -and (Test-Path $unins); $i++) { Start-Sleep -Seconds 1 }
  if (Test-Path $unins) { Falla 'el desinstalador no terminó' }
}

# Enciende el supervisor como lo hace la app y espera el evento «listo» (una línea JSON por evento).
function Encender {
  $out = Join-Path $tmp "supervisor-$([guid]::NewGuid().ToString('N')).out"
  $script:sup = Start-Process $node -ArgumentList "`"$cli`"", 'iniciar', '--sin-entrada' -RedirectStandardOutput $out -RedirectStandardError "$out.err" -PassThru -WindowStyle Hidden
  for ($i = 0; $i -lt 600; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Path $out) {
      foreach ($l in Get-Content $out) {
        $e = $l | ConvertFrom-Json
        if ($e.evento -eq 'listo') { return $e }
        if ($e.evento -eq 'error') { Get-Content "$out.err" -ErrorAction SilentlyContinue; Falla "el supervisor no inició: $($e.codigo) $($e.detalle)" }
      }
    }
    if ($script:sup.HasExited) { Get-Content $out, "$out.err" -ErrorAction SilentlyContinue; Falla 'el supervisor se cerró' }
  }
  Falla 'COROC no quedó listo en 5 minutos'
}

function Apagar {
  & $node $cli detener | Out-Host
  if ($LASTEXITCODE) { Falla 'no se apagó' }
  if ($script:sup) { $script:sup.WaitForExit(60000) | Out-Null }
  if (Get-Process postgres -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$base*" }) { Falla 'PostgreSQL siguió encendido' }
}

function Api([string] $metodo, [string] $ruta, $cuerpo = $null, [hashtable] $h, [int] $esperado = 200) {
  $req = @{ Method = $metodo; Uri = "$($script:api)$ruta"; Headers = $h; SkipHttpErrorCheck = $true; StatusCodeVariable = 'code' }
  if ($null -ne $cuerpo) { $req.ContentType = 'application/json; charset=utf-8'; $req.Body = [Text.Encoding]::UTF8.GetBytes(($cuerpo | ConvertTo-Json -Depth 8 -Compress)) }
  $r = Invoke-RestMethod @req
  if ($code -ne $esperado) { Falla "$metodo $ruta respondió $code (se esperaba $esperado): $($r | ConvertTo-Json -Depth 4 -Compress)" }
  return $r
}

# ─── E-1: instalación limpia ───
Paso 'E-1 · instalación limpia en silencio, sin administrador'
if (Test-Path $base) { Falla "ya había una instalación en $base" }
$reloj = [Diagnostics.Stopwatch]::StartNew()
Instalar (Join-Path $tmp 'instalar.log')
foreach ($f in @('app\coroc.exe', 'servidor\node.exe', 'servidor\pgsql\bin\postgres.exe', 'servidor\tesseract\tesseract.exe', 'servidor\poppler\bin\pdftoppm.exe', 'LICENCIAS.txt')) {
  if (-not (Test-Path (Join-Path $base $f))) { Falla "falta $f" }
}
$escritorio = Join-Path ([Environment]::GetFolderPath('Desktop')) 'COROC.lnk'
$inicio = Join-Path ([Environment]::GetFolderPath('Programs')) 'COROC.lnk'
if (-not (Test-Path $escritorio)) { Falla 'falta el acceso en el escritorio' }
if (-not (Test-Path $inicio)) { Falla 'falta el acceso en el menú Inicio' }
Ok "instalado en $base con accesos en el escritorio y el menú Inicio"
$listo = Encender
$script:api = $listo.api
$segundos = [math]::Round($reloj.Elapsed.TotalSeconds)
if ($segundos -gt 300) { Falla "de instalar a listo tardó $segundos s (máximo 300)" }
Ok "de doble clic a COROC listo: $segundos s"
# Un bloque de DPAPI empieza con la versión 1; un JSON en claro empezaría con «{».
if ([Convert]::FromBase64String((Get-Content (Join-Path $datos 'secretos.bin') -Raw).Trim())[0] -ne 1) { Falla 'las claves no quedaron cifradas con DPAPI' }
Ok 'claves de la instalación cifradas con DPAPI'

$h = @{ 'X-Coroc-Desktop' = $listo.clave }
Api GET '/desktop/status' -h @{} -esperado 403 | Out-Null
Ok 'sin la clave de la ejecución la API no responde'

Paso 'Asistente: empresa y Propietario; tasa libre (ADR-061)'
$s = Api POST '/desktop/setup' @{ company = @{ name = 'Inversiones Prueba Windows'; country = 'CO' }; owner = @{ name = 'Ana Prueba'; username = 'ana'; password = 'Prueba-Windows-2026' }; deviceId = 'ci-windows-0001' } -h $h -esperado 201
if ($s.mfaEnrollmentRequired) { Falla 'en Escritorio el segundo factor es opcional' }
$ha = $h + @{ Authorization = "Bearer $($s.accessToken)" }
Api PUT '/compliance/rate-cap-policy' @{ policy = 'warn'; acceptResponsibility = $true } -h $ha | Out-Null
Ok "empresa creada ($($s.company.slug))"

# «Hoy» es el de la empresa (Colombia, UTC-5), no el del runner (UTC): entre las 00:00 y las 05:00 UTC
# la fecha UTC ya es mañana en Bogotá y la API rechaza el pago por fecha futura.
$hoy = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, 'SA Pacific Standard Time').ToString('yyyy-MM-dd')

Paso 'E-6 · préstamo sin tope de usura registrado, confirmado con la casilla; pago y recibo en PDF con Edge'
$loan = @{ principal = 500000; currency = 'COP'; method = 'simple'; rate = '0.10'; installments = 5; frequency = 'weekly'; disbursementDate = $hoy }
Api POST '/clients' @{ client = @{ firstName = 'Luz Mery'; lastName = 'Mora Díaz'; phone = '+57 300 111 2233'; lang = 'es' }; loan = $loan } -h $ha -esperado 422 | Out-Null
$loan.acknowledgeRateCap = $true
$c = Api POST '/clients' @{ client = @{ firstName = 'Luz Mery'; lastName = 'Mora Díaz'; phone = '+57 300 111 2233'; lang = 'es' }; loan = $loan } -h $ha -esperado 201
$p = Api POST "/loans/$($c.loan.id)/payments" @{ amount = 110000; date = $hoy } -h $ha -esperado 201
$doc = $null
for ($i = 0; $i -lt 120 -and -not $doc; $i++) {
  Start-Sleep -Seconds 1
  $doc = (Api GET "/documents?kind=receipt_out&limit=5" -h $ha).items | Where-Object { $_.kind -eq 'receipt_out' } | Select-Object -First 1
}
if (-not $doc) { Falla 'el recibo en PDF no se generó (¿Microsoft Edge?)' }
$link = Api POST "/documents/$($doc.id)/link" -h $ha
$pdf = Join-Path $tmp 'recibo.pdf'
Invoke-WebRequest -Uri "$($script:api)$($link.path)" -OutFile $pdf
$cabecera = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($pdf), 0, 5)
if ($cabecera -ne '%PDF-' -or (Get-Item $pdf).Length -lt 10000) { Falla 'el recibo no es un PDF válido' }
Ok "recibo $($p.receipt.number) en PDF ($([math]::Round((Get-Item $pdf).Length / 1KB)) KB)"

Paso 'Comprobante leído con Tesseract (español)'
$up = Invoke-RestMethod -Method Post -Uri "$($script:api)/intake?channel=share&clientId=$($c.client.id)" -Headers $ha -ContentType 'application/octet-stream' -InFile $Comprobante
$item = $null
for ($i = 0; $i -lt 180; $i++) {
  Start-Sleep -Seconds 1
  $item = Api GET "/intake/$($up.id)" -h $ha
  if ($item.status -ne 'processing') { break }
}
$traza = Api GET "/intake/$($up.id)/trace" -h $ha
$leido = $traza.steps | Where-Object { $_.step -eq 'read' }
if ($leido.detail -ne 'ocr') { Falla "el comprobante no se leyó con OCR: $($leido | ConvertTo-Json -Compress)" }
if ($item.extraction.amount.value -ne 110000) { Falla "el valor leído no es 110.000: $($item.extraction | ConvertTo-Json -Depth 5 -Compress)" }
Ok "leído con OCR: valor $($item.extraction.amount.value), referencia $($item.extraction.reference.value), estado $($item.status)"

# ─── E-2: reiniciar y actualizar ───
Paso 'E-2 · apagar y volver a encender: los datos siguen ahí'
Apagar
$listo = Encender
$script:api = $listo.api
$login = Api POST '/auth/login' @{ tenant = $s.company.slug; username = 'ana'; password = 'Prueba-Windows-2026'; deviceId = 'ci-windows-0001' } -h @{ 'X-Coroc-Desktop' = $listo.clave }
$ha = @{ 'X-Coroc-Desktop' = $listo.clave; Authorization = "Bearer $($login.accessToken)" }
$clientes = (Api GET '/clients' -h $ha).items
if ($clientes.Count -ne 1 -or $clientes[0].fullName -ne 'Luz Mery Mora Díaz') { Falla 'los datos no sobrevivieron al reinicio' }
Ok 'datos intactos tras reiniciar'

Paso 'E-2 · actualizar instalando encima: copia previa de la base y datos intactos'
Instalar (Join-Path $tmp 'actualizar.log')
if (-not $script:sup.HasExited) { $script:sup.WaitForExit(60000) | Out-Null }
$copias = Get-ChildItem (Join-Path $datos 'respaldos-previos') -Directory -ErrorAction SilentlyContinue
if (-not $copias) { Falla 'no quedó la copia previa a la actualización' }
$listo = Encender
$script:api = $listo.api
$login = Api POST '/auth/login' @{ tenant = $s.company.slug; username = 'ana'; password = 'Prueba-Windows-2026'; deviceId = 'ci-windows-0001' } -h @{ 'X-Coroc-Desktop' = $listo.clave }
$ha = @{ 'X-Coroc-Desktop' = $listo.clave; Authorization = "Bearer $($login.accessToken)" }
if ((Api GET '/clients' -h $ha).items.Count -ne 1) { Falla 'los datos no sobrevivieron a la actualización' }
Ok "copia previa en $($copias[0].Name); datos intactos tras actualizar"
Apagar

# ─── Desinstalar ───
Paso 'Desinstalar conserva los datos'
Desinstalar
if (Test-Path (Join-Path $base 'servidor')) { Falla 'quedaron los programas' }
if (Test-Path $escritorio) { Falla 'quedó el acceso del escritorio' }
if (-not (Test-Path (Join-Path $datos 'pg\PG_VERSION'))) { Falla 'se borraron los datos sin pedirlo' }
Ok 'programas quitados; datos guardados'

Paso 'Reinstalar usa los mismos datos; desinstalar con /BORRARDATOS los borra'
Instalar (Join-Path $tmp 'reinstalar.log')
$listo = Encender
$st = Invoke-RestMethod -Uri "$($listo.api)/desktop/status" -Headers @{ 'X-Coroc-Desktop' = $listo.clave }
if (-not $st.configured) { Falla 'al reinstalar no se encontraron los datos' }
Apagar
Desinstalar @('/BORRARDATOS')
if (Test-Path $datos) { Falla 'no se borraron los datos' }
Ok 'datos borrados a pedido'
Write-Host "`n✔ COROC Escritorio pasó la prueba de punta a punta en Windows" -ForegroundColor Green
