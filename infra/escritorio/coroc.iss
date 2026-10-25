; COROC Escritorio para Windows (ADR-067): un solo instalador, por usuario y sin derechos de administrador.
; Se compila en CI después de construir.ps1:
;   ISCC.exe /DStage=<carpeta de construir.ps1> /DAppVersion=0.10.0+123 /DIcono=<app_icon.ico> /O<salida> infra\escritorio\coroc.iss
;
; Programas en %LOCALAPPDATA%\COROC\app y \servidor (se reemplazan en cada actualización); datos en
; %LOCALAPPDATA%\COROC\datos (el instalador nunca los toca; el desinstalador los conserva salvo que se pida borrarlos).
; Antes de actualizar, el supervisor apaga COROC y copia la base de datos (respaldo-previo).

#ifndef Stage
  #error Falta /DStage=<carpeta armada por construir.ps1>
#endif
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#define NumericVersion Copy(AppVersion, 1, Pos("+", AppVersion + "+") - 1)
#define Supervisor "{app}\servidor\services\api\dist\desktop\supervisor\cli.js"

[Setup]
AppId={{8F1C2B7E-5D4A-4E0B-9C3F-6A2D1E7B9C40}
AppName=COROC
AppVersion={#AppVersion}
AppVerName=COROC {#AppVersion}
AppPublisher=COROC
VersionInfoVersion={#NumericVersion}
VersionInfoDescription=COROC Escritorio para Windows
DefaultDirName={localappdata}\COROC
UsePreviousAppDir=yes
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputBaseFilename=COROC-Escritorio-Windows
Compression=lzma2/ultra64
SolidCompression=yes
LZMANumBlockThreads=4
WizardStyle=modern
ShowLanguageDialog=no
LanguageDetectionMethod=uilanguage
CloseApplications=yes
RestartApplications=no
SetupMutex=COROCInstalador
UninstallDisplayName=COROC
UninstallDisplayIcon={app}\app\coroc.exe
#ifdef Icono
SetupIconFile={#Icono}
#endif
#ifdef ImagenGrande
WizardImageFile={#ImagenGrande}
#endif
#ifdef ImagenPequena
WizardSmallImageFile={#ImagenPequena}
#endif

[Languages]
Name: "es"; MessagesFile: "compiler:Languages\Spanish.isl"
Name: "pt"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
es.AbrirCoroc=Abrir COROC
pt.AbrirCoroc=Abrir o COROC
en.AbrirCoroc=Open COROC
es.NoSePudoCopiar=No se pudo guardar una copia de sus datos antes de actualizar, así que no se cambió nada. Revise que el disco tenga espacio libre y vuelva a abrir este instalador.
pt.NoSePudoCopiar=Não foi possível salvar uma cópia dos seus dados antes de atualizar, então nada foi alterado. Confira se o disco tem espaço livre e abra este instalador de novo.
en.NoSePudoCopiar=A copy of your data could not be saved before updating, so nothing was changed. Check that the disk has free space and open this installer again.
es.BorrarDatos=¿Borrar también los datos de COROC de este PC (empresa, clientes, préstamos y documentos)?%n%nSi elige «No», quedan guardados y COROC los usa otra vez si lo vuelve a instalar.
pt.BorrarDatos=Apagar também os dados do COROC deste PC (empresa, clientes, empréstimos e documentos)?%n%nSe escolher «Não», eles ficam guardados e o COROC volta a usá-los se for instalado de novo.
en.BorrarDatos=Also delete the COROC data on this PC (company, clients, loans and documents)?%n%nIf you choose «No», it stays saved and COROC uses it again if you reinstall.

[InstallDelete]
; Los programas de la versión anterior se reemplazan por completo; los datos no se tocan.
Type: filesandordirs; Name: "{app}\servidor"
Type: filesandordirs; Name: "{app}\app"

[Files]
Source: "{#Stage}\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#Stage}\servidor\*"; DestDir: "{app}\servidor"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#Stage}\LICENCIAS.txt"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\COROC"; Filename: "{app}\app\coroc.exe"; WorkingDir: "{app}\app"
Name: "{autodesktop}\COROC"; Filename: "{app}\app\coroc.exe"; WorkingDir: "{app}\app"

[Registry]
; «Iniciar COROC con Windows» lo activa la app; al desinstalar se quita.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: none; ValueName: "COROC"; Flags: uninsdeletevalue

[Run]
Filename: "{app}\app\coroc.exe"; Description: "{cm:AbrirCoroc}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\servidor\node.exe"; Parameters: """{#Supervisor}"" detener"; Flags: runhidden waituntilterminated; RunOnceId: "DetenerCOROC"
Filename: "{sys}\taskkill.exe"; Parameters: "/IM coroc.exe /F"; Flags: runhidden waituntilterminated; RunOnceId: "CerrarCOROC"

[Code]
var
  BorrarDatos: Boolean;

{ Antes de reemplazar los programas: el supervisor de la versión instalada apaga COROC y copia la base. }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Node, Cli: String;
  Code: Integer;
begin
  Result := '';
  Node := ExpandConstant('{app}\servidor\node.exe');
  Cli := ExpandConstant('{#Supervisor}');
  if FileExists(Node) and FileExists(Cli) then
  begin
    if not Exec(Node, '"' + Cli + '" respaldo-previo', '', SW_HIDE, ewWaitUntilTerminated, Code) or (Code <> 0) then
    begin
      Result := CustomMessage('NoSePudoCopiar');
      exit;
    end;
    { La app se cierra sola al ver que el servidor se apagó; si quedó abierta, se cierra aquí (los datos ya están a salvo). }
    Exec(ExpandConstant('{sys}\taskkill.exe'), '/IM coroc.exe /F', '', SW_HIDE, ewWaitUntilTerminated, Code);
  end;
end;

function TienePar(const Nombre: String): Boolean;
var
  I: Integer;
begin
  Result := False;
  for I := 1 to ParamCount do
    if CompareText(ParamStr(I), Nombre) = 0 then Result := True;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
  begin
    { Silencioso: solo con /BORRARDATOS. Con ventana: se pregunta y la respuesta por defecto es «No». }
    if UninstallSilent then BorrarDatos := TienePar('/BORRARDATOS')
    else BorrarDatos := MsgBox(CustomMessage('BorrarDatos'), mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES;
  end;
  if CurUninstallStep = usPostUninstall then
  begin
    DelTree(ExpandConstant('{app}\servidor'), True, True, True);
    DelTree(ExpandConstant('{app}\app'), True, True, True);
    if BorrarDatos then DelTree(ExpandConstant('{app}\datos'), True, True, True);
    RemoveDir(ExpandConstant('{app}'));
  end;
end;
