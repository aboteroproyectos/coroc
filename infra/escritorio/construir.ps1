<#
  COROC Escritorio para Windows (ADR-067): arma la carpeta que empaqueta el instalador.

    pwsh infra/escritorio/construir.ps1 -Salida <carpeta> [-App <build\windows\x64\runner\Release>] [-Version 0.10.0+123]

  Antes, en la raíz del repositorio: npm ci y npm run build (la API y el núcleo compilados). Resultado:

    <Salida>\app\        la app de Windows (coroc.exe) con el runtime de Visual C++
    <Salida>\servidor\   node.exe portátil, la API con sus dependencias de producción, PostgreSQL 16 portátil,
                         Tesseract (español, portugués e inglés) y Poppler (pdftoppm)
    <Salida>\LICENCIAS.txt

  Cada descarga tiene versión y SHA-256 fijos: si el archivo cambia, el armado se detiene.
#>
param(
  [Parameter(Mandatory = $true)] [string] $Salida,
  [string] $App,
  [string] $Version = '0.0.0-dev',
  # Tesseract de UB Mannheim instalado con «choco install tesseract» (en el flujo de CI).
  [string] $Tesseract = 'C:\Program Files\Tesseract-OCR'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$ProgressPreference = 'SilentlyContinue'

$raiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$cache = Join-Path $raiz '.descargas'
New-Item -ItemType Directory -Force -Path $cache | Out-Null

# Descargas fijas (versión y huella). Para cambiar una versión: nueva URL y su SHA-256 publicado.
$Pins = [ordered]@{
  node     = @{ url = 'https://nodejs.org/dist/v22.23.4/node-v22.23.4-win-x64.zip'; sha256 = 'cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20' }
  postgres = @{ url = 'https://registry.npmjs.org/@embedded-postgres/windows-x64/-/windows-x64-16.14.0-beta.17.tgz'; sha256 = '9249f5d366d332d8023d32699f8667954a6d97d6b2f5ccdf25384d65b9a15582' }
  poppler  = @{ url = 'https://github.com/oschwartz10612/poppler-windows/releases/download/v24.08.0-0/Release-24.08.0-0.zip'; sha256 = '58a6f9ae269756231d2f9aa6cba39d75fec6deacaf3c4a50683383b5f3d5a527' }
  spa      = @{ url = 'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/spa.traineddata'; sha256 = '6f2e04d02774a18f01bed44b1111f2cd7f3ba7ac9dc4373cd3f898a40ea6b464' }
  por      = @{ url = 'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/por.traineddata'; sha256 = 'c4932b937207a9514b7514d518b931a99938c02a28a5a5a553f8599ed58b7deb' }
  eng      = @{ url = 'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/eng.traineddata'; sha256 = '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2' }
  osd      = @{ url = 'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/osd.traineddata'; sha256 = '9cf5d576fcc47564f11265841e5ca839001e7e6f38ff7f7aacf46d15a96b00ff' }
}

function Paso([string] $texto) { Write-Host "`n▶ $texto" -ForegroundColor Cyan }

function Get-Pinned([string] $nombre) {
  $pin = $Pins[$nombre]
  $archivo = Join-Path $cache ([IO.Path]::GetFileName(([Uri]$pin.url).AbsolutePath))
  if (-not (Test-Path $archivo)) {
    Write-Host "  descargando $($pin.url)"
    Invoke-WebRequest -Uri $pin.url -OutFile "$archivo.parcial" -UseBasicParsing
    Move-Item "$archivo.parcial" $archivo -Force
  }
  $hash = (Get-FileHash -Algorithm SHA256 $archivo).Hash.ToLowerInvariant()
  if ($hash -ne $pin.sha256) {
    Remove-Item $archivo -Force
    throw "La huella de $nombre no coincide: $hash (se esperaba $($pin.sha256))"
  }
  return $archivo
}

function Expand-Into([string] $archivo, [string] $destino) {
  New-Item -ItemType Directory -Force -Path $destino | Out-Null
  if ($archivo -like '*.zip') { Expand-Archive -Path $archivo -DestinationPath $destino -Force }
  else { tar -xzf $archivo -C $destino; if ($LASTEXITCODE) { throw "No se pudo abrir $archivo" } }
}

$Salida = [IO.Path]::GetFullPath($Salida)
if (Test-Path $Salida) { Remove-Item $Salida -Recurse -Force }
$servidor = Join-Path $Salida 'servidor'
$tmp = Join-Path $Salida '.tmp'
New-Item -ItemType Directory -Force -Path $servidor, $tmp | Out-Null
$licencias = [Collections.Generic.List[string]]::new()

# ─── Node.js portátil ───
Paso 'Node.js 22 portátil'
Expand-Into (Get-Pinned 'node') (Join-Path $tmp 'node')
$nodeDir = Get-ChildItem (Join-Path $tmp 'node') -Directory | Select-Object -First 1
Copy-Item (Join-Path $nodeDir.FullName 'node.exe') $servidor
$licencias.Add("Node.js $((& (Join-Path $servidor 'node.exe') --version)) — licencia MIT y otras: https://github.com/nodejs/node/blob/main/LICENSE")

# ─── API de COROC con sus dependencias de producción ───
Paso 'API de COROC (dependencias de producción para Windows)'
foreach ($f in @('package.json', 'package-lock.json')) { Copy-Item (Join-Path $raiz $f) $servidor }
foreach ($ws in @('packages\core', 'services\api', 'apps\prototype')) {
  New-Item -ItemType Directory -Force -Path (Join-Path $servidor $ws) | Out-Null
  Copy-Item (Join-Path $raiz "$ws\package.json") (Join-Path $servidor $ws)
}
Copy-Item (Join-Path $raiz 'packages\core\dist') (Join-Path $servidor 'packages\core\dist') -Recurse
foreach ($d in @('dist', 'i18n', 'assets')) { Copy-Item (Join-Path $raiz "services\api\$d") (Join-Path $servidor "services\api\$d") -Recurse }
New-Item -ItemType Directory -Force -Path (Join-Path $servidor 'services\api\db') | Out-Null
Copy-Item (Join-Path $raiz 'services\api\db\migrations') (Join-Path $servidor 'services\api\db\migrations') -Recurse
Copy-Item (Join-Path $raiz 'services\api\openapi.yaml') (Join-Path $servidor 'services\api')
Get-ChildItem (Join-Path $servidor 'services\api\dist') -Recurse -Filter '*.map' | Remove-Item -Force
Push-Location $servidor
try {
  npm ci --omit=dev --workspace '@coroc/core' --workspace '@coroc/api' --include-workspace-root=false --no-audit --no-fund
  if ($LASTEXITCODE) { throw 'npm ci falló' }
} finally { Pop-Location }
# Los paquetes del espacio de trabajo quedan como enlaces (junctions): el instalador necesita carpetas reales.
$corocMods = Join-Path $servidor 'node_modules\@coroc'
if (Test-Path $corocMods) {
  Get-ChildItem $corocMods | ForEach-Object { cmd /c rmdir "$($_.FullName)" | Out-Null; if (Test-Path $_.FullName) { Remove-Item $_.FullName -Recurse -Force } }
}
New-Item -ItemType Directory -Force -Path (Join-Path $corocMods 'core') | Out-Null
Copy-Item (Join-Path $servidor 'packages\core\package.json') (Join-Path $corocMods 'core')
Copy-Item (Join-Path $servidor 'packages\core\dist') (Join-Path $corocMods 'core\dist') -Recurse
Remove-Item (Join-Path $servidor 'apps') -Recurse -Force
Remove-Item (Join-Path $servidor 'package-lock.json') -Force
# La API arranca con este Node: se comprueba que cargue su módulo nativo (argon2) antes de seguir.
$prueba = Join-Path $tmp 'argon2.cjs'
Set-Content -Path $prueba -Encoding utf8 -Value "require(process.argv[2]).hash('prueba').then((h) => process.exit(h.startsWith('`$argon2') ? 0 : 1), () => process.exit(1));"
& (Join-Path $servidor 'node.exe') $prueba (Join-Path $servidor 'node_modules\argon2')
if ($LASTEXITCODE) { throw 'argon2 no carga en Windows' }

# ─── PostgreSQL 16 portátil ───
Paso 'PostgreSQL 16 portátil'
Expand-Into (Get-Pinned 'postgres') (Join-Path $tmp 'pg')
$pgNative = Join-Path $tmp 'pg\package\native'
$pgsql = Join-Path $servidor 'pgsql'
New-Item -ItemType Directory -Force -Path $pgsql | Out-Null
foreach ($d in @('bin', 'lib', 'share')) { Copy-Item (Join-Path $pgNative $d) (Join-Path $pgsql $d) -Recurse }
# Lo que PostgreSQL no usa en COROC: la interfaz de pgAdmin (wx*), bibliotecas de compilación y traducciones de otros idiomas.
Get-ChildItem (Join-Path $pgsql 'bin') -Filter 'wx*.dll' | Remove-Item -Force
Get-ChildItem (Join-Path $pgsql 'lib') -Include '*.lib', '*.a' -Recurse | Remove-Item -Force
$locale = Join-Path $pgsql 'share\locale'
if (Test-Path $locale) { Get-ChildItem $locale -Directory | Where-Object { $_.Name -notin @('es', 'pt_BR') } | Remove-Item -Recurse -Force }
foreach ($exe in @('initdb.exe', 'pg_ctl.exe', 'postgres.exe')) { if (-not (Test-Path (Join-Path $pgsql "bin\$exe"))) { throw "Falta $exe" } }
$licencias.Add('PostgreSQL 16.14 — licencia PostgreSQL: https://www.postgresql.org/about/licence/ (binarios de EDB distribuidos por embedded-postgres, MIT)')

# ─── Tesseract (lectura de comprobantes) ───
Paso 'Tesseract con español, portugués e inglés'
if (-not (Test-Path (Join-Path $Tesseract 'tesseract.exe'))) { throw "No está Tesseract en $Tesseract (choco install tesseract)" }
$tess = Join-Path $servidor 'tesseract'
Copy-Item $Tesseract $tess -Recurse
Get-ChildItem $tess -Include 'unins*', '*.html', 'doc' -Recurse -Force | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
$tessdata = Join-Path $tess 'tessdata'
Get-ChildItem $tessdata -Filter '*.traineddata' | Remove-Item -Force
foreach ($l in @('spa', 'por', 'eng', 'osd')) { Copy-Item (Get-Pinned $l) (Join-Path $tessdata "$l.traineddata") }
if (-not (Test-Path (Join-Path $tessdata 'configs\tsv'))) { throw 'Falta tessdata\configs\tsv' }
$licencias.Add("Tesseract OCR $((& (Join-Path $tess 'tesseract.exe') --version 2>&1 | Select-Object -First 1)) (UB Mannheim) — Apache 2.0: https://github.com/tesseract-ocr/tesseract")
$licencias.Add('tessdata_fast 4.1.0 (spa, por, eng, osd) — Apache 2.0: https://github.com/tesseract-ocr/tessdata_fast')

# ─── Poppler (pdftoppm) ───
Paso 'Poppler (pdftoppm)'
Expand-Into (Get-Pinned 'poppler') (Join-Path $tmp 'poppler')
$popBin = Get-ChildItem (Join-Path $tmp 'poppler') -Recurse -Filter 'pdftoppm.exe' | Select-Object -First 1
$poppler = Join-Path $servidor 'poppler\bin'
New-Item -ItemType Directory -Force -Path $poppler | Out-Null
Copy-Item (Join-Path $popBin.DirectoryName '*') $poppler -Recurse
$licencias.Add('Poppler 24.08.0 (pdftoppm) — GPL 2 o posterior; código fuente: https://poppler.freedesktop.org/ — compilación: https://github.com/oschwartz10612/poppler-windows')

# ─── Runtime de Visual C++ junto a cada programa que lo usa (un Windows recién instalado puede no tenerlo) ───
Paso 'Runtime de Visual C++'
$vc = @('vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll') | ForEach-Object { Join-Path $env:WINDIR "System32\$_" }
foreach ($f in $vc) { if (-not (Test-Path $f)) { throw "Falta $f en este equipo de compilación" } }
$destinosVc = @((Join-Path $pgsql 'bin'), $poppler)

# ─── App de Windows ───
if ($App) {
  Paso 'App de Windows'
  $appDir = Join-Path $Salida 'app'
  Copy-Item ([IO.Path]::GetFullPath($App)) $appDir -Recurse
  if (-not (Test-Path (Join-Path $appDir 'coroc.exe'))) { throw 'Falta coroc.exe en la app' }
  $destinosVc += $appDir
}
foreach ($d in $destinosVc) { foreach ($f in $vc) { Copy-Item $f $d -Force } }
$licencias.Add('Runtime de Visual C++ 2015-2022 — redistribuible de Microsoft')

# ─── Versión y licencias ───
Set-Content -Path (Join-Path $servidor 'VERSION') -Value $Version -NoNewline -Encoding utf8
$texto = @(
  'COROC Escritorio para Windows', "Versión $Version", '',
  'COROC incluye estos programas de terceros, cada uno con su licencia:', ''
) + ($licencias | ForEach-Object { "- $_" })
Set-Content -Path (Join-Path $Salida 'LICENCIAS.txt') -Value $texto -Encoding utf8

Remove-Item $tmp -Recurse -Force
$mb = [math]::Round(((Get-ChildItem $Salida -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB)
Write-Host "`n✔ Carpeta lista: $Salida ($mb MB sin comprimir)" -ForegroundColor Green
