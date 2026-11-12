; OliTechs Print Agent — click-once Windows installer.
;
; Staff never see a terminal: this installer copies the agent and its own Node
; runtime, registers the Windows service, starts it, and then offers the pairing
; dialog in a normal window. Signing is applied by build-installer.ps1 after
; compilation, so the same script also refuses to publish an unsigned build for
; release.
;
; Compile from tools\print-agent\installer:
;   ISCC.exe /DAppVersion=2.2.0 /DSourceRoot=..\..\..\dist\installer\payload OliTechsPrintAgent.iss

#define AppName "OliTechs Print Agent"
#define AppPublisher "OliTechs"
#define AppUrl "https://olitechpmspos.vercel.app"

#ifndef AppVersion
  #define AppVersion "0.0.0-dev"
#endif
#ifndef SourceRoot
  #define SourceRoot "..\..\..\dist\installer\payload"
#endif
#ifndef OutputRoot
  #define OutputRoot "..\..\..\dist\installer"
#endif

[Setup]
; Stable AppId: upgrades and uninstall must recognise the same product forever.
AppId={{7F1C2E44-9C3B-4B8E-9E51-3D2B8A6E5C11}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppUrl}
DefaultDirName={autopf}\OliTechs\Print Agent
DefaultGroupName=OliTechs Print Agent
DisableProgramGroupPage=yes
DisableWelcomePage=no
OutputDir={#OutputRoot}
OutputBaseFilename=OliTechsPrintAgentSetup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
; Registering a Windows service needs elevation. The pairing dialog afterwards
; runs as the signed-in user, because it only talks to loopback.
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\service\WinSW.exe
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; Payload layout mirrors the repository so the agent's relative imports resolve:
;   {app}\tools\print-agent\...
;   {app}\src\services\escposJob.js
;   {app}\node\node.exe               (bundled runtime, no system Node needed)
;   {app}\service\WinSW.exe           (service wrapper)
Source: "{#SourceRoot}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Printer status"; Filename: "http://127.0.0.1:8631/health"
Name: "{group}\Pair this computer"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\pair-workstation.ps1"""; WorkingDir: "{app}"
Name: "{group}\Print agent logs"; Filename: "{commonappdata}\OliTechs\PrintAgent\logs"
Name: "{group}\Uninstall OliTechs Print Agent"; Filename: "{uninstallexe}"

; The service is registered in [Code] (RunServiceInstaller) so a failure can be
; shown to staff instead of being swallowed by a hidden window. Only the pairing
; dialog lives here, and it is skipped when the service did not install.
[Run]
; Optional but recommended: pair immediately with the code from Settings → Printers.
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\pair-workstation.ps1"""; Description: "Pair this computer with OliTechs now (recommended)"; StatusMsg: "Opening the pairing step…"; Flags: postinstall runhidden waituntilterminated runasoriginaluser; Check: ServiceInstalledOk

[UninstallRun]
; Scripts live with the agent that ships them, not beside WinSW.exe.
Filename: "powershell.exe"; Parameters: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\tools\print-agent\service\uninstall-service.ps1"""; Flags: runhidden waituntilterminated; RunOnceId: "RemoveOliTechsPrintAgentService"

[UninstallDelete]
; The service and its wrapper live in ProgramData. Printer data, logs and the
; workstation credential are deliberately kept so a reinstall keeps working.
Type: filesandordirs; Name: "{app}"

[Code]
var
  ServiceInstallFailed: Boolean;

function InitializeSetup(): Boolean;
begin
  ServiceInstallFailed := False;
  Result := True;
end;

{ True when sc.exe reported success, i.e. the service exists. }
function AgentServiceExists(): Boolean;
var
  Code: Integer;
begin
  Result := False;
  if not Exec(ExpandConstant('{cmd}'), '/C sc.exe query OliTechsPrintAgent', '', SW_HIDE, ewWaitUntilTerminated, Code) then
    exit;
  Result := Code = 0;
end;

{ 0 means the service is currently RUNNING. }
function AgentServiceRunning(): Boolean;
var
  Code: Integer;
begin
  Result := False;
  if not Exec(ExpandConstant('{cmd}'), '/C sc.exe query OliTechsPrintAgent | findstr /I "RUNNING"', '', SW_HIDE, ewWaitUntilTerminated, Code) then
    exit;
  Result := Code = 0;
end;

{ Files in the install folder are replaced right after ssInstall. A running
  service holds the bundled node.exe open, so it must be stopped before any
  file is copied. An upgrade must not need a reboot or a manual "sc stop".
  (Do not write brace constants such as the app folder inside a brace comment:
  Inno ends the comment at the first closing brace.) }
procedure StopExistingAgentService();
var
  I: Integer;
  Code: Integer;
begin
  if not AgentServiceExists() then
    exit;
  Exec(ExpandConstant('{cmd}'), '/C sc.exe stop OliTechsPrintAgent', '', SW_HIDE, ewWaitUntilTerminated, Code);
  for I := 1 to 40 do
  begin
    if not AgentServiceRunning() then
      exit;
    Sleep(500);
  end;
end;

{ The pairing dialog only makes sense when the agent actually installed. }
function ServiceInstalledOk(): Boolean;
begin
  Result := not ServiceInstallFailed;
end;

procedure RunServiceInstaller();
var
  Code: Integer;
  Params: String;
begin
  Params := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' +
    ExpandConstant('{app}\tools\print-agent\service\install-service.ps1') + '"' +
    ' -WinSWPath "' + ExpandConstant('{app}\service\WinSW.exe') + '"' +
    ' -NodeExe "' + ExpandConstant('{app}\node\node.exe') + '"';

  if not Exec('powershell.exe', Params, ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Code) then
  begin
    ServiceInstallFailed := True;
    MsgBox('Windows could not start the OliTechs Print Agent service installer.' + #13#10#13#10 +
      'Printing will not work until this is fixed. Restart the computer and run this installer again, ' +
      'or send the log folder to support: ' + ExpandConstant('{commonappdata}\OliTechs\PrintAgent\logs'),
      mbError, MB_OK);
    exit;
  end;

  if Code <> 0 then
  begin
    ServiceInstallFailed := True;
    MsgBox('The OliTechs Print Agent service could not be installed (exit code ' + IntToStr(Code) + ').' + #13#10#13#10 +
      'Printing will not work until this is fixed. The agent log folder is:' + #13#10 +
      ExpandConstant('{commonappdata}\OliTechs\PrintAgent\logs') + #13#10#13#10 +
      'Try running this installer again. If it keeps failing, send that folder to support.',
      mbError, MB_OK);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then
    StopExistingAgentService()
  else if CurStep = ssPostInstall then
    RunServiceInstaller();
end;
