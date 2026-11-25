[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$InstallerPath,
  [string]$HealthUrl = 'http://127.0.0.1:8631/health'
)

# End-to-end installer smoke test for an elevated Windows runner.
# It installs silently, checks the service and /health, upgrades, checks again,
# then uninstalls silently and verifies the service is gone. An unpaired agent
# is healthy by design, so this script never requires pairing.
#
# The caller must provide an installer built from the same tree being tested.
# No signing key, Supabase service-role key or pairing code is needed.

$ErrorActionPreference = 'Stop'

$ServiceId = 'OliTechsPrintAgent'
$SetupTimeoutSeconds = 180
$DataDir = Join-Path $env:ProgramData 'OliTechs\PrintAgent'
$ResultPath = Join-Path $DataDir 'logs\install-result.json'
$RunDir = Join-Path $env:TEMP ('olitechs-print-agent-smoke-{0}' -f [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $RunDir | Out-Null

function Write-Step {
  param([string]$Message)
  Write-Host "[smoke] $Message"
}

function Fail-Test {
  param([string]$Message)
  throw "SMOKE TEST FAILED: $Message"
}

function Assert-True {
  param(
    [bool]$Condition,
    [string]$Message
  )
  if (-not $Condition) { Fail-Test $Message }
}

function Write-Diagnostics {
  param(
    [Parameter(Mandatory = $true)][string]$SetupLog,
    [Parameter(Mandatory = $true)][int]$ExitCode
  )
  Write-Step ("Silent setup exited with code {0}" -f $ExitCode)
  if (Test-Path -LiteralPath $SetupLog) {
    Write-Step ("Setup log tail: {0}" -f $SetupLog)
    Get-Content -LiteralPath $SetupLog -Tail 100 | ForEach-Object { Write-Host ("  {0}" -f $_) }
  } else {
    Write-Step ("Setup log was not created: {0}" -f $SetupLog)
  }

  $resultPaths = @(
    (Join-Path $env:ProgramData 'OliTechs\PrintAgent\logs\install-result.json'),
    (Join-Path $env:TEMP 'OliTechsPrintAgent-logs\install-result.json')
  )
  foreach ($resultFile in $resultPaths) {
    if (-not (Test-Path -LiteralPath $resultFile)) { continue }
    Write-Step ("Install result: {0}" -f $resultFile)
    Get-Content -LiteralPath $resultFile | ForEach-Object { Write-Host ("  {0}" -f $_) }
  }

  $serviceLogs = @(
    (Join-Path $env:ProgramData 'OliTechs\PrintAgent\logs\install-service.log'),
    (Join-Path $env:TEMP 'OliTechsPrintAgent-logs\install-service.log')
  )
  foreach ($serviceLog in $serviceLogs) {
    if (-not (Test-Path -LiteralPath $serviceLog)) { continue }
    Write-Step ("Service log tail: {0}" -f $serviceLog)
    Get-Content -LiteralPath $serviceLog -Tail 150 | ForEach-Object { Write-Host ("  {0}" -f $_) }
  }
}

function Stop-StuckPairing {
  # Defensive cleanup for a hung silent install. The installer now skips this
  # dialog, but a stale build must not leave a hidden window on the runner.
  try {
    $pairings = Get-CimInstance -ClassName Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -match 'pair-workstation\.ps1' }
    foreach ($pairing in $pairings) {
      Stop-Process -Id $pairing.ProcessId -Force -ErrorAction SilentlyContinue
    }
  } catch {
  }
}

function Invoke-Setup {
  param(
    [Parameter(Mandatory = $true)][string]$Executable,
    [Parameter(Mandatory = $true)][string]$LogName
  )
  $log = Join-Path $RunDir $LogName
  $arguments = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', ('/LOG="{0}"' -f $log))
  Write-Step ("Running {0}" -f (Split-Path -Leaf $Executable))
  $name = Split-Path -Leaf $Executable
  $process = Start-Process -FilePath $Executable -ArgumentList $arguments -PassThru -ErrorAction Stop
  if (-not $process.WaitForExit($SetupTimeoutSeconds * 1000)) {
    Stop-StuckPairing
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    Write-Diagnostics -SetupLog $log -ExitCode (-1)
    Fail-Test ("{0} did not exit within {1} seconds. Setup log: {2}" -f $name, $SetupTimeoutSeconds, $log)
  }
  $process.Refresh()
  if ($process.ExitCode -ne 0) {
    Write-Diagnostics -SetupLog $log -ExitCode $process.ExitCode
    Fail-Test ("{0} exited with code {1}. Setup log: {2}" -f $name, $process.ExitCode, $log)
  }
  return $log
}

function Wait-ServiceRunning {
  param([int]$TimeoutSeconds = 90)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $service = Get-Service -Name $ServiceId -ErrorAction SilentlyContinue
    if ($service -and $service.Status -eq 'Running') { return $service }
    Start-Sleep -Seconds 1
  }
  Fail-Test ("Service {0} did not reach Running within {1} seconds." -f $ServiceId, $TimeoutSeconds)
}

function Assert-AgentHealth {
  param([int]$TimeoutSeconds = 60)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastError = ''
  while ((Get-Date) -lt $deadline) {
    try {
      $health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 5 -ErrorAction Stop
      if ($health.ok -eq $true) {
        $paired = if ($health.paired -and $health.paired.paired) { 'yes' } else { 'no' }
        Write-Step ("/health ok=true (paired: {0})" -f $paired)
        return $health
      }
      $lastError = 'health response did not report ok=true'
    } catch {
      $lastError = $_.Exception.Message
    }
    Start-Sleep -Seconds 1
  }
  Fail-Test ("/health did not become healthy within {0} seconds: {1}" -f $TimeoutSeconds, $lastError)
}

function Assert-InstallResult {
  if (-not (Test-Path -LiteralPath $ResultPath)) {
    Fail-Test ("Install result file is missing: {0}" -f $ResultPath)
  }
  $result = Get-Content -LiteralPath $ResultPath -Raw -ErrorAction Stop | ConvertFrom-Json
  Assert-True ($result.stage -eq 'complete') ("install-result stage was '{0}', expected 'complete'." -f $result.stage)
  Assert-True ($result.code -eq 0) ("install-result code was '{0}', expected 0." -f $result.code)
  Assert-True ($result.port -eq 8631) ("install-result port was '{0}', expected 8631." -f $result.port)
  Write-Step ('install-result: stage={0} code={1} service={2}' -f $result.stage, $result.code, $result.serviceStatus)
}

function Find-Uninstaller {
  foreach ($root in @(${env:ProgramFiles}, ${env:ProgramFiles(x86)})) {
    if (-not $root) { continue }
    $candidate = Join-Path $root 'OliTechs\Print Agent\unins000.exe'
    if (Test-Path -LiteralPath $candidate) { return (Resolve-Path -LiteralPath $candidate).Path }
  }
  Fail-Test 'The Inno Setup uninstaller was not found in either Program Files folder.'
}

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Fail-Test 'Run this smoke test from an elevated shell; service registration requires administrator rights.'
}
if (-not (Test-Path -LiteralPath $InstallerPath)) {
  Fail-Test ("Installer not found: {0}" -f $InstallerPath)
}
$InstallerPath = (Resolve-Path -LiteralPath $InstallerPath).Path

Write-Step ('Artifact: {0}' -f $InstallerPath)
Write-Step ('Logs: {0}' -f $RunDir)

# 1. Fresh install.
$installLog = Invoke-Setup -Executable $InstallerPath -LogName 'install.log'
[void](Wait-ServiceRunning)
[void](Assert-AgentHealth)
Assert-InstallResult
Write-Step ('Install passed. Setup log: {0}' -f $installLog)

# 2. Upgrade over a running service. This catches locked node.exe regressions.
$upgradeLog = Invoke-Setup -Executable $InstallerPath -LogName 'upgrade.log'
[void](Wait-ServiceRunning)
[void](Assert-AgentHealth)
Assert-InstallResult
Write-Step ('Upgrade passed. Setup log: {0}' -f $upgradeLog)

# 3. Silent uninstall. Printer data and logs must survive by default.
$uninstaller = Find-Uninstaller
$uninstallLog = Invoke-Setup -Executable $uninstaller -LogName 'uninstall.log'
$deadline = (Get-Date).AddSeconds(90)
while ((Get-Date) -lt $deadline -and (Get-Service -Name $ServiceId -ErrorAction SilentlyContinue)) {
  Start-Sleep -Seconds 1
}
Assert-True (-not (Get-Service -Name $ServiceId -ErrorAction SilentlyContinue)) 'The service still exists after uninstall.'
Assert-True (Test-Path -LiteralPath $DataDir) ('Printer data was deleted without -RemoveData: {0}' -f $DataDir)
Write-Step ('Uninstall passed. Setup log: {0}' -f $uninstallLog)

Write-Step 'PASS: silent install, upgrade and uninstall all behaved as expected.'
exit 0
