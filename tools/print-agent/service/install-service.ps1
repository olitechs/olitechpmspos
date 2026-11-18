[CmdletBinding()]
param(
  [string]$WinSWPath = '',
  [string]$NodeExe = '',
  [string]$SupabaseUrl = '',
  [string]$SupabaseAnonKey = '',
  [string]$AgentConfigPath = '',
  [string]$LogPath = '',
  [switch]$SkipLegacyTaskCleanup
)

$ErrorActionPreference = 'Stop'

# Keep a diagnostic trail even when ProgramData cannot be created. Inno Setup
# passes its pre-created log path; the temp fallback covers early/manual failures.
$InstallLogPath = $LogPath
if (-not $InstallLogPath) {
  $InstallLogPath = Join-Path $env:TEMP 'OliTechs-PrintAgent-install.log'
}
$script:TranscriptStarted = $false
$script:ServiceRegistrationAttempted = $false
$ServiceId = 'OliTechsPrintAgent'
function Write-InstallLog([string]$Message) {
  $line = "[$(Get-Date -Format o)] $Message"
  try { Add-Content -LiteralPath $InstallLogPath -Value $line -Encoding UTF8 -ErrorAction Stop } catch {
    $fallback = Join-Path $env:TEMP 'OliTechs-PrintAgent-install.log'
    try { Add-Content -LiteralPath $fallback -Value $line -Encoding UTF8 -ErrorAction Stop } catch {}
  }
}
Write-InstallLog "BEGIN service installation. Script=$($MyInvocation.MyCommand.Path); ProgramData=$env:ProgramData; User=$([Security.Principal.WindowsIdentity]::GetCurrent().Name)"
try {
  if (-not $LogPath) {
    $logDir = Join-Path $env:ProgramData 'OliTechs\\PrintAgent\\logs'
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $InstallLogPath = Join-Path $logDir 'install-service.log'
  }
  $logParent = Split-Path -Parent $InstallLogPath
  if ($logParent) { New-Item -ItemType Directory -Force -Path $logParent | Out-Null }
  Start-Transcript -Path $InstallLogPath -Append -Force | Out-Null
  $script:TranscriptStarted = $true
} catch {
  Write-InstallLog "WARNING: could not initialize ProgramData/transcript logging: $($_.Exception.Message)"
}
trap {
  Write-InstallLog "INSTALL ERROR: $($_.Exception.Message)"
  if ($script:ServiceRegistrationAttempted) {
    try {
      $failedService = Get-Service -Name $ServiceId -ErrorAction SilentlyContinue
      if ($failedService -and $failedService.Status -ne 'Stopped') {
        Stop-Service -Name $ServiceId -Force -ErrorAction SilentlyContinue
      }
      if (Test-Path $WrapperPath) { & $WrapperPath uninstall 2>&1 | Out-File -FilePath $InstallLogPath -Append -Encoding utf8 }
    } catch {
      Write-InstallLog "WARNING: automatic service rollback failed: $($_.Exception.Message)"
    }
    Write-InstallLog 'Failed service registration was rolled back where possible. Persistent pairing and queue data were retained.'
  }
  if ($script:TranscriptStarted) { try { Stop-Transcript | Out-Null } catch {} }
  throw
}
$ServiceDisplayName = 'OliTechs Print Agent'
$LegacyTaskName = 'OliTechs Print Agent'

$ServiceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AgentDir = Split-Path -Parent $ServiceRoot
$RepoRoot = Split-Path -Parent (Split-Path -Parent $AgentDir)

$TemplatePath = Join-Path $ServiceRoot 'OliTechsPrintAgent.xml.template'
if (-not (Test-Path $TemplatePath)) { throw "Service template not found: $TemplatePath" }

$AgentScript = Join-Path $AgentDir 'print-agent-v2.js'
$InstrumentScript = Join-Path $AgentDir 'instrument.mjs'
if (-not (Test-Path $InstrumentScript)) { throw "Sentry instrumentation file not found: $InstrumentScript" }
if (-not (Test-Path $AgentScript)) { throw "Print agent entry point not found: $AgentScript" }

# The packaged OliTechs installer ships its own Node runtime, so a POS computer
# never needs Node.js installed system-wide. A manual install still uses PATH.
$nodeExePath = ''
if ($NodeExe) {
  if (-not (Test-Path $NodeExe)) { throw "The bundled Node.js runtime was not found: $NodeExe" }
  $nodeExePath = (Resolve-Path $NodeExe).Path
} else {
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $node) {
    throw 'Node.js was not found on this computer. Run the OliTechs Print Agent installer, or install Node.js 20 or newer.'
  }
  $nodeExePath = $node.Source
}

$DataDir = Join-Path $env:ProgramData 'OliTechs\PrintAgent'
$ServiceDir = Join-Path $DataDir 'service'
$LogDir = Join-Path $DataDir 'logs'
$ConfigPath = Join-Path $ServiceDir "$ServiceId.xml"
$WrapperPath = Join-Path $ServiceDir "$ServiceId.exe"

# The service wrapper is a separate signed binary. This script never downloads
# and runs an executable: the OliTechs installer ships WinSW, or an engineer
# points at an existing copy with -WinSWPath.
$resolvedWinSW = ''
if ($WinSWPath) {
  if (-not (Test-Path $WinSWPath)) { throw "WinSW executable not found: $WinSWPath" }
  $resolvedWinSW = (Resolve-Path $WinSWPath).Path
} else {
  foreach ($candidate in @((Join-Path $ServiceRoot 'WinSW.exe'), (Join-Path $DataDir 'bin\WinSW.exe'))) {
    if (Test-Path $candidate) { $resolvedWinSW = (Resolve-Path $candidate).Path; break }
  }
}
if (-not $resolvedWinSW) {
  throw 'The Windows service wrapper (WinSW.exe) is missing. Run the OliTechs Print Agent installer, or pass -WinSWPath with an existing WinSW.exe.'
}

New-Item -ItemType Directory -Force -Path $DataDir, $ServiceDir, $LogDir | Out-Null
Write-InstallLog "Validated payload and created persistent directories. DataDir=$DataDir; ServiceDir=$ServiceDir"

# Re-installing must be safe: stop and remove the previous service first.
# Windows can keep a service registration in the "marked for deletion" state
# briefly after WinSW uninstall. Installing again during that window commonly
# returns WinSW exit code 1. Wait for the Service Control Manager to release it.
# Also handle a service that a previous uninstaller has already removed from
# Get-Service but which the Service Control Manager still marks for deletion.
$registrationDeadline = (Get-Date).AddSeconds(30)
do {
  $registrationState = & sc.exe query $ServiceId 2>&1
  $registrationCode = $LASTEXITCODE
  if ($registrationCode -eq 1072) { Start-Sleep -Milliseconds 500 }
} while ($registrationCode -eq 1072 -and (Get-Date) -lt $registrationDeadline)
if ($registrationCode -eq 1072) {
  $registrationState | Out-File -FilePath $InstallLogPath -Append -Encoding utf8
  throw "Windows still marks $ServiceId for deletion. Restart Windows before installing again. No new service was registered."
}
if ($registrationCode -eq 0) {
  throw "The $ServiceId service is registered but could not be opened through the Windows service API. Restart Windows and retry; no new service was registered."
}
if ($registrationCode -ne 1060) {
  $registrationState | Out-File -FilePath $InstallLogPath -Append -Encoding utf8
  throw "Could not inspect the existing $ServiceId service registration (sc.exe exit code $registrationCode). See $InstallLogPath."
}

$existing = Get-Service -Name $ServiceId -ErrorAction SilentlyContinue
if ($existing) {
  if ($existing.Status -ne 'Stopped') {
    Stop-Service -Name $ServiceId -Force -ErrorAction Stop
    $stopDeadline = (Get-Date).AddSeconds(30)
    do {
      Start-Sleep -Milliseconds 500
      $existing = Get-Service -Name $ServiceId -ErrorAction SilentlyContinue
    } while ($existing -and $existing.Status -ne 'Stopped' -and (Get-Date) -lt $stopDeadline)
    if ($existing -and $existing.Status -ne 'Stopped') {
      throw "The existing $ServiceId service did not stop. Status: $($existing.Status). No service files were replaced."
    }
  }

  if (Test-Path $WrapperPath) {
    $uninstallOutput = & $WrapperPath uninstall 2>&1
    $uninstallExitCode = $LASTEXITCODE
    if ($uninstallOutput) {
      $uninstallOutput | Tee-Object -FilePath $InstallLogPath -Append | Out-Null
    }
    if ($uninstallExitCode -ne 0) {
      throw "The existing Windows service could not be removed (WinSW exit code $uninstallExitCode). Restart Windows, then run the installer again. See $InstallLogPath."
    }
  } else {
    $deleteOutput = & sc.exe delete $ServiceId 2>&1
    $deleteExitCode = $LASTEXITCODE
    if ($deleteOutput) {
      $deleteOutput | Tee-Object -FilePath $InstallLogPath -Append | Out-Null
    }
    if ($deleteExitCode -ne 0) {
      throw "The existing Windows service could not be removed (sc.exe exit code $deleteExitCode). See $InstallLogPath."
    }
  }

  $removeDeadline = (Get-Date).AddSeconds(30)
  do {
    Start-Sleep -Milliseconds 500
    $queryOutput = & sc.exe query $ServiceId 2>&1
    $queryExitCode = $LASTEXITCODE
  } while ($queryExitCode -eq 0 -and (Get-Date) -lt $removeDeadline)

  if ($queryExitCode -eq 0) {
    $queryOutput | Out-File -FilePath $InstallLogPath -Append -Encoding utf8
    throw "Windows is still holding the old $ServiceId service registration. Restart Windows, then run the installer again. No new service was installed."
  }
  if ($queryExitCode -ne 1060) {
    $queryOutput | Out-File -FilePath $InstallLogPath -Append -Encoding utf8
    throw "Could not verify removal of the previous $ServiceId service (sc.exe exit code $queryExitCode). See $InstallLogPath."
  }
}

$escape = [System.Security.SecurityElement]::Escape
$xml = Get-Content -Raw -Path $TemplatePath
$xml = $xml.Replace('{{NODE_EXE}}', $escape.Invoke($nodeExePath))
$xml = $xml.Replace('{{AGENT_SCRIPT}}', $escape.Invoke($AgentScript))
$xml = $xml.Replace('{{INSTRUMENT_SCRIPT}}', $escape.Invoke($InstrumentScript))
$xml = $xml.Replace('{{WORKING_DIR}}', $escape.Invoke($RepoRoot))
$xml = $xml.Replace('{{DATA_DIR}}', $escape.Invoke($DataDir))
$xml = $xml.Replace('{{LOG_DIR}}', $escape.Invoke($LogDir))

# Pairing needs the public Supabase URL and anon key. Neither is a secret in the
# credential sense (the anon key ships in the web app), and the workstation gets
# its own print credential through pairing. A service-role key is never installed
# here, so a copied workstation cannot read another property's data.
if (-not $AgentConfigPath) { $AgentConfigPath = Join-Path $RepoRoot 'agent-config.json' }
if ((-not $SupabaseUrl -or -not $SupabaseAnonKey) -and (Test-Path $AgentConfigPath)) {
  try {
    $agentConfig = Get-Content -Raw -Path $AgentConfigPath | ConvertFrom-Json
    if (-not $SupabaseUrl) { $SupabaseUrl = [string]$agentConfig.supabaseUrl }
    if (-not $SupabaseAnonKey) { $SupabaseAnonKey = [string]$agentConfig.supabaseAnonKey }
  } catch {
    Write-Host "Could not read $AgentConfigPath. Pairing will stay unavailable until the agent is configured." -ForegroundColor Yellow
  }
}

$envEntries = ''
if ($SupabaseUrl -and $SupabaseAnonKey) {
  $escapedUrl = $escape.Invoke($SupabaseUrl)
  $escapedKey = $escape.Invoke($SupabaseAnonKey)
  $envEntries = "  <env name=`"SUPABASE_URL`" value=`"$escapedUrl`"/>`r`n  <env name=`"VITE_SUPABASE_ANON_KEY`" value=`"$escapedKey`"/>"
}
$xml = $xml.Replace('{{ENV_ENTRIES}}', $envEntries)
Set-Content -Path $ConfigPath -Value $xml -Encoding UTF8
Write-InstallLog "Generated WinSW service configuration at $ConfigPath"

Copy-Item -Path $resolvedWinSW -Destination $WrapperPath -Force
Write-InstallLog "Copied verified service wrapper to $WrapperPath"

# WinSW can return a generic non-zero code when a stale service registration
# still exists (for example, Windows has marked it for deletion). Capture its
# actual output so support can distinguish that from access/configuration errors.
$script:ServiceRegistrationAttempted = $true
$winswOutput = & $WrapperPath install 2>&1
$winswExitCode = $LASTEXITCODE
if ($winswOutput) {
  $winswOutput | Tee-Object -FilePath $InstallLogPath -Append | Out-Null
}
Write-InstallLog "WinSW install exit code: $winswExitCode"
if ($winswExitCode -ne 0) {
  $serviceCheck = & sc.exe query $ServiceId 2>&1
  if ($serviceCheck) { $serviceCheck | Out-File -FilePath $InstallLogPath -Append -Encoding utf8 }
  throw "Installing the Windows service failed (WinSW exit code $winswExitCode). See $InstallLogPath for the detailed installer log."
}

# Service Control Manager recovery: restart after a crash with increasing delay.
sc.exe failure $ServiceId reset= 86400 actions= restart/5000/restart/15000/restart/60000 | Out-Null
sc.exe description $ServiceId "OliTechs local print agent: LAN ESC/POS and Windows spooler printing for Olitech PMS/POS." | Out-Null

if (-not $SkipLegacyTaskCleanup) {
  $legacyTask = Get-ScheduledTask -TaskName $LegacyTaskName -ErrorAction SilentlyContinue
  if ($legacyTask) {
    # Older installs started the agent at logon. A scheduled task and a service
    # would fight over port 8631 and print the same job twice.
    Stop-ScheduledTask -TaskName $LegacyTaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $LegacyTaskName -Confirm:$false
    Write-Host 'Removed the previous logon-based Print Agent task.' -ForegroundColor Yellow
  }
}

Start-Service -Name $ServiceId
$deadline = (Get-Date).AddSeconds(30)
do {
  Start-Sleep -Milliseconds 500
  $status = (Get-Service -Name $ServiceId).Status
} while ($status -ne 'Running' -and (Get-Date) -lt $deadline)
if ($status -ne 'Running') {
  throw "The OliTechs Print Agent service did not start (status: $status). See $InstallLogPath for details."
}
Write-InstallLog 'Windows service reached Running state.'

$healthy = $false
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8631/health' -TimeoutSec 2
    if ($health.ok) { $healthy = $true; break }
  } catch {
    Start-Sleep -Milliseconds 500
  }
}

Write-Host ''
Write-Host 'OliTechs Print Agent service installed successfully.' -ForegroundColor Green
Write-Host "Service:  $ServiceDisplayName ($ServiceId)"
Write-Host "Status:   $((Get-Service -Name $ServiceId).Status)"
Write-Host "Accounts: runs as LocalSystem and starts with Windows, before anyone signs in"
Write-Host "Endpoint: http://127.0.0.1:8631"
Write-Host "Logs:     $LogDir"
if ($SupabaseUrl -and $SupabaseAnonKey) {
  Write-Host 'Pairing:  available. Open OliTechs, Settings, Printers and press "Pair this computer".'
} else {
  Write-Host 'Pairing:  unavailable until SUPABASE_URL and the anon key are configured for the agent.' -ForegroundColor Yellow
}
if ($healthy) {
  Write-Host 'Health:   responding' -ForegroundColor Green
} else {
  Write-InstallLog 'ERROR: Windows service is running but /health did not respond within the verification window.'
  throw "The Print Agent service started but its health endpoint did not respond. See $InstallLogPath."
}
Write-Host ''
Write-InstallLog 'SUCCESS: Print Agent service installation and health verification completed.'
if ($script:TranscriptStarted) { try { Stop-Transcript | Out-Null } catch {} }
