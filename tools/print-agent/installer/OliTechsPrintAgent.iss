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

[Run]
; Registers (or upgrades) the service, waits for health, and prints a short
; result. -NodeExe points at the bundled runtime so Node need not be installed.
Filename: "powershell.exe"; Parameters: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\service\install-service.ps1"" -WinSWPath ""{app}\service\WinSW.exe"" -NodeExe ""{app}\node\node.exe"""; StatusMsg: "Installing the OliTechs Print Agent service…"; Flags: runhidden waituntilterminated
; Optional but recommended: pair immediately with the code from Settings → Printers.
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\pair-workstation.ps1"""; Description: "Pair this computer with OliTechs now (recommended)"; StatusMsg: "Opening the pairing step…"; Flags: postinstall runhidden waituntilterminated runasoriginaluser

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\service\uninstall-service.ps1"""; Flags: runhidden waituntilterminated; RunOnceId: "RemoveOliTechsPrintAgentService"

[UninstallDelete]
; The service and its wrapper live in ProgramData. Printer data, logs and the
; workstation credential are deliberately kept so a reinstall keeps working.
Type: filesandordirs; Name: "{app}"

[Code]
function InitializeSetup(): Boolean;
begin
  Result := True;
end;
