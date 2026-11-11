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

$ServiceId = 'OliTechsPrintAgent'
$ServiceDisplayName = 'OliTechs Print Agent'
$LegacyTaskName = 'OliTechs Print Agent'

$ServiceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AgentDir = Split-Path -Parent $ServiceRoot
$RepoRoot = Split-Path -Parent (Split-Path -Parent $AgentDir)

$TemplatePath = Join-Path $ServiceRoot 'OliTechsPrintAgent.xml.template'
if (-not (Test-Path $TemplatePath)) { throw "Service template not found: $TemplatePath" }

$AgentScript = Join-Path $AgentDir 'print-agent-v2.js'
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

# Re-installing must be safe: stop and remove the previous service first.
$existing = Get-Service -Name $ServiceId -ErrorAction SilentlyContinue
if ($existing) {
  if ($existing.Status -ne 'Stopped') {
    Stop-Service -Name $ServiceId -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path $WrapperPath) {
    & $WrapperPath uninstall 2>$null | Out-Null
  } else {
    sc.exe delete $ServiceId 2>$null | Out-Null
  }
  Start-Sleep -Seconds 2
}

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

Copy-Item -Path $resolvedWinSW -Destination $WrapperPath -Force

& $WrapperPath install
if ($LASTEXITCODE -ne 0) { throw "Installing the Windows service failed (exit code $LASTEXITCODE)." }

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
  throw "The OliTechs Print Agent service did not start (status: $status). See $LogDir for details."
}

$healthy = $false
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8631/health' -TimeoutSec 2
    if ($health.ok) { $healthy = $true; break }
  } catch (_) {
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
  Write-Host 'Health:   the service is running but /health did not answer yet. Check the logs above.' -ForegroundColor Yellow
}
Write-Host ''
