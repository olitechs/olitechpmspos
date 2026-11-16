[CmdletBinding()]
param(
  [string]$WinSWPath = '',
  [string]$NodeExe = '',
  [string]$SupabaseUrl = '',
  [string]$SupabaseAnonKey = '',
  [string]$AgentConfigPath = '',
  [switch]$SkipLegacyTaskCleanup
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Diagnostic logging
#
# One append-only log (install-service.log) records every installation stage
# with a timestamp, the exact command, its exit code and its output, so a
# failed install can be diagnosed from the file the installer dialog names.
# A small companion file (install-last-error.txt) records the failed stage so
# the installer dialog can show staff what went wrong, not just an exit code.
# Neither file contains secrets: configuration values are described, not shown.
# ---------------------------------------------------------------------------
$DataDir = Join-Path $env:ProgramData 'OliTechs\PrintAgent'
$InstallLogDir = Join-Path $DataDir 'logs'
$InstallLogPath = Join-Path $InstallLogDir 'install-service.log'
$LastErrorPath = Join-Path $InstallLogDir 'install-last-error.txt'
# Logs must exist even when the installation fails at the very first stage.
New-Item -ItemType Directory -Force -Path $InstallLogDir | Out-Null

# The stage the script is currently in; every throw is attributed to it.
$script:CurrentStage = 'start'

function Write-InstallLog {
  param([string]$Message)
  $line = '{0:yyyy-MM-dd HH:mm:ss.fff} {1}' -f (Get-Date), $Message
  try { $line | Out-File -FilePath $InstallLogPath -Append -Encoding utf8 | Out-Null } catch {}
}

function Write-Stage {
  param([string]$Stage, [string]$Message)
  Write-InstallLog ("[{0}] {1}" -f $Stage, $Message)
}

function Write-LastStageError {
  param([string]$Stage, [string]$Message)
  # ASCII only: the installer dialog reads this file with an ANSI reader.
  $safe = ($Message -replace '[^\x20-\x7E]', '?')
  try {
    @(
      "Failed stage: $Stage"
      "Error: $safe"
      "Full log: $InstallLogPath"
    ) | Set-Content -Path $LastErrorPath -Encoding ascii
  } catch {}
}

trap {
  Write-InstallLog ("[{0}] INSTALL ERROR: {1}" -f $script:CurrentStage, $_.Exception.Message)
  Write-LastStageError $script:CurrentStage $_.Exception.Message
  throw
}

# NOTE: deliberately no Start-Transcript. An active transcript holds an
# exclusive write lock on this log file, so every structured Write-InstallLog
# line (and the captured WinSW output) fails with a sharing violation and is
# silently lost — leaving only the bare transcript behind. The structured
# logger below is the single writer for install-service.log.
function Invoke-LoggedCommand {
  # Run a native command, record the exact command line, exit code and output,
  # and return the output. stderr redirection with $ErrorActionPreference
  # = 'Stop' can turn stderr text into a terminating error, so the call itself
  # runs with 'Continue' and errors are handled by the exit code.
  param([string]$Stage, [string]$FilePath, [string[]]$ArgumentList = @(), [string]$Description = '')
  $display = (@($FilePath) + $ArgumentList) -join ' '
  Write-Stage $Stage ("Running: {0}" -f $display)
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & $FilePath @ArgumentList 2>&1
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  if ($null -ne $output -and @($output).Count -gt 0) {
    foreach ($line in @($output)) { Write-InstallLog ("  exit {0}: {1}" -f $code, $line) }
  } else {
    Write-InstallLog ("  exit {0}: (no output)" -f $code)
  }
  if ($Description) { Write-Stage $Stage ("{0} exit code: {1}" -f $Description, $code) }
  return ,@($output)
}

# ---------------------------------------------------------------------------
# Service-state helpers. sc.exe exit codes used here:
#   0    = the service exists (query succeeded)
#   1060 = the service is not installed
#   1072 = the service is marked for deletion
# ---------------------------------------------------------------------------
function Get-ServiceReportedState {
  param([string]$ServiceName)
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $query = & sc.exe query $ServiceName 2>$null
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  if ($code -ne 0) { return '' }
  $match = @($query) | Select-String -Pattern 'STATE\s*:\s*\d+\s+(\S+)'
  if ($match) { return $match.Matches[0].Groups[1].Value }
  return ''
}

function Wait-ServiceState {
  param([string]$ServiceName, [string[]]$DesiredStates, [int]$TimeoutSeconds)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $state = Get-ServiceReportedState -ServiceName $ServiceName
    if ($DesiredStates -contains $state) { return $state }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  return $state
}

function Wait-ServiceGone {
  param([string]$ServiceName, [int]$TimeoutSeconds)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      & sc.exe query $ServiceName 2>$null | Out-Null
      $code = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $previousPreference
    }
    if ($code -eq 1060) { return $true }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  return $false
}

function Wait-ServiceExists {
  param([string]$ServiceName, [int]$TimeoutSeconds)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      & sc.exe query $ServiceName 2>$null | Out-Null
      $code = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $previousPreference
    }
    if ($code -eq 0) { return $true }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  return $false
}

# ---------------------------------------------------------------------------
# Stage: start
# ---------------------------------------------------------------------------
$ServiceId = 'OliTechsPrintAgent'
$ServiceDisplayName = 'OliTechs Print Agent'
$LegacyTaskName = 'OliTechs Print Agent'

$ServiceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AgentDir = Split-Path -Parent $ServiceRoot
$RepoRoot = Split-Path -Parent (Split-Path -Parent $AgentDir)

Write-Stage 'start' ("Print Agent service installation started. PowerShell {0}" -f $PSVersionTable.PSVersion.ToString())
Write-Stage 'start' ("Windows: {0}" -f [System.Environment]::OSVersion.VersionString)
Write-Stage 'start' ("Install paths: service root '{0}', agent folder '{1}', working directory '{2}'" -f $ServiceRoot, $AgentDir, $RepoRoot)
Write-Stage 'start' ("Parameters: WinSWPath='{0}' NodeExe='{1}' AgentConfigPath='{2}' SkipLegacyTaskCleanup={3}" -f $WinSWPath, $NodeExe, $AgentConfigPath, [bool]$SkipLegacyTaskCleanup)

# ---------------------------------------------------------------------------
# Stage: validate
# ---------------------------------------------------------------------------
$script:CurrentStage = 'validate'

$TemplatePath = Join-Path $ServiceRoot 'OliTechsPrintAgent.xml.template'
if (-not (Test-Path $TemplatePath)) { throw "Service template not found: $TemplatePath" }
Write-Stage 'validate' ("Service template found: {0}" -f $TemplatePath)

$AgentScript = Join-Path $AgentDir 'print-agent-v2.js'
if (-not (Test-Path $AgentScript)) { throw "Print agent entry point not found: $AgentScript" }
Write-Stage 'validate' ("Agent entry point found: {0}" -f $AgentScript)

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
$nodeVersion = Invoke-LoggedCommand -Stage 'validate' -FilePath $nodeExePath -ArgumentList @('--version') -Description 'Node.js version check'
Write-Stage 'validate' ("Node.js runtime: {0} ({1})" -f (($nodeVersion | Select-Object -First 1) -join ''), $nodeExePath)

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
$winswVersion = Invoke-LoggedCommand -Stage 'validate' -FilePath $resolvedWinSW -ArgumentList @('--version') -Description 'WinSW version check'
Write-Stage 'validate' ("WinSW wrapper: {0} ({1})" -f (($winswVersion | Select-Object -First 1) -join ''), $resolvedWinSW)

New-Item -ItemType Directory -Force -Path $DataDir, $ServiceDir, $LogDir | Out-Null
Write-Stage 'validate' ("Data, service and log folders are ready under {0}" -f $DataDir)

# ---------------------------------------------------------------------------
# Stage: pre-clean - re-installing must be safe and idempotent
# ---------------------------------------------------------------------------
$script:CurrentStage = 'pre-clean'
$existing = Get-Service -Name $ServiceId -ErrorAction SilentlyContinue
if ($existing) {
  Write-Stage 'pre-clean' ("An existing {0} service was found (status: {1}). Removing it before registering the new one." -f $ServiceId, $existing.Status)

  if ($existing.Status -ne 'Stopped') {
    $stopOutput = Invoke-LoggedCommand -Stage 'pre-clean' -FilePath "$env:ComSpec" -ArgumentList @('/C', "sc.exe stop $ServiceId") -Description 'stop existing service'
    # Windows reports STOP_PENDING while the agent is still shutting down; a
    # reinstall before the service reached Stopped is the classic cause of
    # "marked for deletion" failures on the next registration.
    $finalState = Wait-ServiceState -ServiceName $ServiceId -DesiredStates @('STOPPED') -TimeoutSeconds 45
    Write-Stage 'pre-clean' ("Existing service stop finished with state '{0}'." -f $finalState)
    if ($finalState -ne 'STOPPED') {
      Write-Stage 'pre-clean' "Warning: the existing service did not reach the Stopped state in time. Continuing; the removal below will report if it cannot be replaced."
    }
  }

  if (Test-Path $WrapperPath) {
    $uninstallOutput = Invoke-LoggedCommand -Stage 'pre-clean' -FilePath $WrapperPath -ArgumentList @('uninstall') -Description 'uninstall previous service (WinSW)'
    if ($LASTEXITCODE -ne 0) {
      # The wrapper may be absent or broken even though the registration
      # exists; fall back to sc.exe so a damaged install can still recover.
      Write-Stage 'pre-clean' "WinSW uninstall failed; falling back to sc.exe delete."
      $deleteOutput = Invoke-LoggedCommand -Stage 'pre-clean' -FilePath "$env:ComSpec" -ArgumentList @('/C', "sc.exe delete $ServiceId") -Description 'delete previous service (sc.exe)'
    }
  } else {
    $deleteOutput = Invoke-LoggedCommand -Stage 'pre-clean' -FilePath "$env:ComSpec" -ArgumentList @('/C', "sc.exe delete $ServiceId") -Description 'delete previous service (sc.exe)'
  }

  # sc.exe delete only MARKS the service for deletion; Windows removes it once
  # every handle is closed. Re-registering before that completes fails with
  # error 1072, so wait until Windows reports the service as gone.
  $gone = Wait-ServiceGone -ServiceName $ServiceId -TimeoutSeconds 45
  if (-not $gone) {
    $pendingState = Get-ServiceReportedState -ServiceName $ServiceId
    throw ("Windows still holds the previous {0} service registration (state: {1}). This normally clears within a minute or after a restart. Restart Windows and run this installer again - no manual cleanup is needed. See {2} for the full log." -f $ServiceDisplayName, $pendingState, $InstallLogPath)
  }
  Write-Stage 'pre-clean' ("Previous {0} registration was fully removed." -f $ServiceId)
} else {
  Write-Stage 'pre-clean' ("No existing {0} service registration. Proceeding with a fresh install." -f $ServiceId)
}

# ---------------------------------------------------------------------------
# Stage: configure - render the service definition and stage the wrapper
# ---------------------------------------------------------------------------
$script:CurrentStage = 'configure'

$escape = [System.Security.SecurityElement]::Escape
$xml = Get-Content -Raw -Path $TemplatePath
$xml = $xml.Replace('{{NODE_EXE}}', $escape.Invoke($nodeExePath))
$xml = $xml.Replace('{{AGENT_SCRIPT}}', $escape.Invoke($AgentScript))
$xml = $xml.Replace('{{WORKING_DIR}}', $escape.Invoke($RepoRoot))
$xml = $xml.Replace('{{DATA_DIR}}', $escape.Invoke($DataDir))
$xml = $xml.Replace('{{LOG_DIR}}', $escape.Invoke($LogDir))

# Pairing needs the public Supabase URL and anon key. Neither is a secret in the
# credential sense (the anon key ships in the web app), and the workstation gets
# its own print credential through pairing. A service-role key is never installed
# here, so a copied workstation cannot read another property's data. Their
# values are deliberately not written to the log.
if (-not $AgentConfigPath) { $AgentConfigPath = Join-Path $RepoRoot 'agent-config.json' }
if ((-not $SupabaseUrl -or -not $SupabaseAnonKey) -and (Test-Path $AgentConfigPath)) {
  try {
    $agentConfig = Get-Content -Raw -Path $AgentConfigPath | ConvertFrom-Json
    if (-not $SupabaseUrl) { $SupabaseUrl = [string]$agentConfig.supabaseUrl }
    if (-not $SupabaseAnonKey) { $SupabaseAnonKey = [string]$agentConfig.supabaseAnonKey }
    Write-Stage 'configure' ("Read public pairing configuration from {0}." -f $AgentConfigPath)
  } catch {
    Write-Stage 'configure' "Could not read the agent configuration file. Pairing will stay unavailable until the agent is configured."
  }
}

$envEntries = ''
if ($SupabaseUrl -and $SupabaseAnonKey) {
  $escapedUrl = $escape.Invoke($SupabaseUrl)
  $escapedKey = $escape.Invoke($SupabaseAnonKey)
  $envEntries = "  <env name=`"SUPABASE_URL`" value=`"$escapedUrl`"/>`r`n  <env name=`"VITE_SUPABASE_ANON_KEY`" value=`"$escapedKey`"/>"
  Write-Stage 'configure' "Pairing configuration will be embedded in the service definition (values not logged)."
} else {
  Write-Stage 'configure' "No pairing configuration available; the service definition will be written without it."
}
$xml = $xml.Replace('{{ENV_ENTRIES}}', $envEntries)
Set-Content -Path $ConfigPath -Value $xml -Encoding UTF8
if (-not (Test-Path $ConfigPath)) { throw "The service definition could not be written: $ConfigPath" }
Write-Stage 'configure' ("Service definition written: {0}" -f $ConfigPath)

Copy-Item -Path $resolvedWinSW -Destination $WrapperPath -Force
if (-not (Test-Path $WrapperPath)) { throw "The service wrapper could not be copied to: $WrapperPath" }
Write-Stage 'configure' ("Service wrapper staged: {0}" -f $WrapperPath)

# ---------------------------------------------------------------------------
# Stage: register
# ---------------------------------------------------------------------------
$script:CurrentStage = 'register'

# WinSW can return a generic non-zero code when a stale service registration
# still exists (for example, Windows has marked it for deletion). Its exact
# output is captured above so support can distinguish that from access or
# configuration errors.
$installOutput = Invoke-LoggedCommand -Stage 'register' -FilePath $WrapperPath -ArgumentList @('install') -Description 'register service (WinSW install)'
if ($LASTEXITCODE -ne 0) {
  $queryOutput = Invoke-LoggedCommand -Stage 'register' -FilePath "$env:ComSpec" -ArgumentList @('/C', "sc.exe query $ServiceId") -Description 'service state after failed install'
  throw ("Installing the Windows service failed (WinSW exit code {0}). If Windows still held the previous registration, restarting Windows and running this installer again clears it - no manual cleanup is needed. See {1} for the full log." -f $LASTEXITCODE, $InstallLogPath)
}

# Do not trust the WinSW exit code alone: confirm Windows actually recognises
# the service before configuring recovery options or starting it.
$registered = Wait-ServiceExists -ServiceName $ServiceId -TimeoutSeconds 20
if (-not $registered) {
  throw ("WinSW reported success, but Windows does not recognise the {0} service yet (sc.exe query keeps failing). Restart Windows and run this installer again. See {1} for the full log." -f $ServiceDisplayName, $InstallLogPath)
}
Write-Stage 'register' ("Windows now recognises the {0} service." -f $ServiceId)

# ---------------------------------------------------------------------------
# Stage: recovery - Service Control Manager restart policy (non-fatal)
# ---------------------------------------------------------------------------
$script:CurrentStage = 'recovery'
$failureOutput = Invoke-LoggedCommand -Stage 'recovery' -FilePath "$env:ComSpec" -ArgumentList @('/C', "sc.exe failure $ServiceId reset= 86400 actions= restart/5000/restart/15000/restart/60000") -Description 'configure restart-on-failure recovery'
if ($LASTEXITCODE -ne 0) {
  Write-Stage 'recovery' "Warning: the restart-on-failure policy could not be set. The service will still start; an administrator can set it later."
}
$descriptionOutput = Invoke-LoggedCommand -Stage 'recovery' -FilePath 'sc.exe' -ArgumentList @('description', $ServiceId, 'OliTechs local print agent: LAN ESC/POS and Windows spooler printing for Olitech PMS/POS.') -Description 'set service description'
if ($LASTEXITCODE -ne 0) {
  Write-Stage 'recovery' "Warning: the service description could not be set."
}

# ---------------------------------------------------------------------------
# Stage: legacy-cleanup
# ---------------------------------------------------------------------------
$script:CurrentStage = 'legacy-cleanup'
if (-not $SkipLegacyTaskCleanup) {
  $legacyTask = Get-ScheduledTask -TaskName $LegacyTaskName -ErrorAction SilentlyContinue
  if ($legacyTask) {
    # Older installs started the agent at logon. A scheduled task and a service
    # would fight over port 8631 and print the same job twice.
    Stop-ScheduledTask -TaskName $LegacyTaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $LegacyTaskName -Confirm:$false
    Write-Stage 'legacy-cleanup' 'Removed the previous logon-based Print Agent task.'
    Write-Host 'Removed the previous logon-based Print Agent task.' -ForegroundColor Yellow
  }
}

# ---------------------------------------------------------------------------
# Stage: start
# ---------------------------------------------------------------------------
$script:CurrentStage = 'start'
Write-Stage 'start' "Starting the service..."
try {
  Start-Service -Name $ServiceId
} catch {
  $queryOutput = Invoke-LoggedCommand -Stage 'start' -FilePath "$env:ComSpec" -ArgumentList @('/C', "sc.exe query $ServiceId") -Description 'service state after failed start'
  throw ("Windows could not start the {0} service ({1}). See {2} for the full log; the agent's own logs are in {3}." -f $ServiceDisplayName, $_.Exception.Message, $InstallLogPath, $LogDir)
}

$deadline = (Get-Date).AddSeconds(45)
do {
  Start-Sleep -Milliseconds 500
  $status = (Get-Service -Name $ServiceId).Status
} while ($status -ne 'Running' -and (Get-Date) -lt $deadline)

if ($status -ne 'Running') {
  # Capture everything support needs before deciding anything: the reported
  # service state, its configuration, the wrapper's latest log lines and the
  # Service Control Manager events for this service.
  $queryOutput = Invoke-LoggedCommand -Stage 'start' -FilePath "$env:ComSpec" -ArgumentList @('/C', "sc.exe query $ServiceId") -Description 'service state after start timeout'
  $configOutput = Invoke-LoggedCommand -Stage 'start' -FilePath "$env:ComSpec" -ArgumentList @('/C', "sc.exe qc $ServiceId") -Description 'service configuration'
  $latestWrapperLog = Get-ChildItem -Path $LogDir -Filter '*.log' -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($latestWrapperLog) {
    Write-Stage 'start' ("Latest agent wrapper log: {0}" -f $latestWrapperLog.FullName)
    $tail = Get-Content -Path $latestWrapperLog.FullName -Tail 40 -ErrorAction SilentlyContinue
    foreach ($line in $tail) { Write-InstallLog ("  agent log: {0}" -f $line) }
  }
  try {
    $scmEvents = Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'Service Control Manager'; StartTime = (Get-Date).AddMinutes(-10) } -MaxEvents 50 -ErrorAction SilentlyContinue |
      Where-Object { $_.Message -like "*$ServiceId*" -or $_.Message -like "*$ServiceDisplayName*" } |
      Select-Object -First 5
    foreach ($eventRecord in $scmEvents) {
      Write-Stage 'start' ("Service Control Manager event {0} at {1}: {2}" -f $eventRecord.Id, $eventRecord.TimeCreated, ($eventRecord.Message -replace '\s+', ' '))
    }
  } catch {
    Write-Stage 'start' "The Windows event log could not be read for service details."
  }

  # Leave no broken registration behind: uninstall the service but keep the
  # configuration, pairing data and logs, so simply running the installer
  # again recovers without manual registry or service cleanup. The stage stays
  # "start": rollback is remediation, not the failure staff need to see.
  Write-Stage 'start' "Rollback: removing the not-running registration so the installer can be run again cleanly. Configuration, pairing data and logs are kept."
  Invoke-LoggedCommand -Stage 'start' -FilePath $WrapperPath -ArgumentList @('uninstall') -Description 'rollback service registration'
  Wait-ServiceGone -ServiceName $ServiceId -TimeoutSeconds 30 | Out-Null
  throw ("The {0} service did not reach the Running state (final status: {1}). Its own log is in {2} and the full installer log is {3}. Run this installer again; if it fails the same way, send both files to OliTechs support." -f $ServiceDisplayName, $status, $LogDir, $InstallLogPath)
}
Write-Stage 'start' ("The service is Running (start-up verified with sc.exe: '{0}')." -f (Get-ServiceReportedState -ServiceName $ServiceId))

# ---------------------------------------------------------------------------
# Stage: health
# ---------------------------------------------------------------------------
$script:CurrentStage = 'health'
$healthy = $false
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8631/health' -TimeoutSec 2
    if ($health.ok) { $healthy = $true; break }
  } catch {
    Start-Sleep -Milliseconds 500
  }
}
Write-Stage 'health' ("Health endpoint after start: {0}." -f ($(if ($healthy) { 'responding' } else { 'not answering yet' })))

# ---------------------------------------------------------------------------
# Stage: done
# ---------------------------------------------------------------------------
$script:CurrentStage = 'done'
try { Remove-Item -Path $LastErrorPath -Force -ErrorAction SilentlyContinue } catch {}
Write-Stage 'done' "Print Agent service installation completed successfully."

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
  Write-Host 'Health:   the service is running but /health did not answer yet. Check the logs above.' -ForegroundColor Yellow
}
Write-Host ''
Write-InstallLog 'Summary: OliTechs Print Agent service installed successfully.'
Write-InstallLog ("Summary: Service  {0} ({1})" -f $ServiceDisplayName, $ServiceId)
Write-InstallLog ("Summary: Status   {0}" -f (Get-Service -Name $ServiceId).Status)
Write-InstallLog 'Summary: Accounts runs as LocalSystem and starts with Windows, before anyone signs in'
Write-InstallLog 'Summary: Endpoint http://127.0.0.1:8631'
Write-InstallLog ("Summary: Logs     {0}" -f $LogDir)
if ($SupabaseUrl -and $SupabaseAnonKey) {
  Write-InstallLog 'Summary: Pairing  available. Open OliTechs, Settings, Printers and press "Pair this computer".'
} else {
  Write-InstallLog 'Summary: Pairing  unavailable until SUPABASE_URL and the anon key are configured for the agent.'
}
if ($healthy) {
  Write-InstallLog 'Summary: Health   responding'
} else {
  Write-InstallLog 'Summary: Health   the service is running but /health did not answer yet. Check the logs above.'
}
Write-Host ''

