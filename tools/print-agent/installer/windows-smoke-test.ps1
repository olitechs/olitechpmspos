[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$InstallerPath,
  [string]$InnoSetupPath = 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
  [string]$PayloadRoot = (Join-Path (Get-Location).Path 'dist\installer\payload')
)

$ErrorActionPreference = 'Stop'

function Assert-Condition {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

function Wait-ForServiceState {
  param([string]$Name, [string]$ExpectedState, [int]$TimeoutSeconds = 45)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if ($ExpectedState -eq 'Absent' -and -not $service) { return }
    if ($service -and $service.Status.ToString() -eq $ExpectedState) { return }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  $actual = Get-Service -Name $Name -ErrorAction SilentlyContinue
  if ($actual) { throw "Service $Name did not reach '$ExpectedState'; current state: $($actual.Status)." }
  throw "Service $Name did not reach '$ExpectedState' before timeout."
}

function Invoke-SilentSetup {
  param([string]$Path, [string]$InstallDirectory, [string]$LogPath)
  $arguments = '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /DIR="{0}" /LOG="{1}"' -f $InstallDirectory, $LogPath
  $process = Start-Process -FilePath $Path -ArgumentList $arguments -Wait -PassThru
  return $process.ExitCode
}

$InstallerPath = (Resolve-Path $InstallerPath).Path
$InnoSetupPath = (Resolve-Path $InnoSetupPath).Path
$PayloadRoot = (Resolve-Path $PayloadRoot).Path
Assert-Condition (Test-Path $InstallerPath) "Installer not found: $InstallerPath"
Assert-Condition (Test-Path (Join-Path $PayloadRoot 'tools\print-agent\service\install-service.ps1')) 'Staged service installer is missing.'

$setupName = [IO.Path]::GetFileNameWithoutExtension($InstallerPath)
if ($setupName -notmatch '^OliTechsPrintAgentSetup-(.+?)(?:-UNSIGNED)?$') {
  throw "Unexpected installer filename: $setupName"
}
$version = $Matches[1]
$failureVersion = "$version-smoke-failure"
$installDirectory = Join-Path $env:ProgramFiles 'OliTechs\Print Agent'
$failureDirectory = Join-Path $env:ProgramFiles 'OliTechs\Print Agent Smoke Failure'
$serviceName = 'OliTechsPrintAgent'
$logRoot = Join-Path $env:RUNNER_TEMP 'olitechs-print-agent-smoke'
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
$successSetupLog = Join-Path $logRoot 'successful-install.log'
$uninstallLog = Join-Path $logRoot 'successful-uninstall.log'
$failureSetupLog = Join-Path $logRoot 'forced-failure-install.log'
$failureOutputRoot = Join-Path $logRoot 'failure-build'
New-Item -ItemType Directory -Force -Path $failureOutputRoot | Out-Null

try {
  # Ensure the hosted runner starts from a clean state.
  $existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
  if ($existing) {
    $existingWrapper = Join-Path $env:ProgramData 'OliTechs\PrintAgent\service\OliTechsPrintAgent.exe'
    if (Test-Path $existingWrapper) { & $existingWrapper uninstall | Out-Host }
    else { & sc.exe delete $serviceName | Out-Host }
    Wait-ForServiceState -Name $serviceName -ExpectedState 'Absent'
  }
  if (Test-Path $installDirectory) { Remove-Item $installDirectory -Recurse -Force }
  if (Test-Path $failureDirectory) { Remove-Item $failureDirectory -Recurse -Force }

  Write-Host 'Smoke test: silent install.' -ForegroundColor Cyan
  $installCode = Invoke-SilentSetup -Path $InstallerPath -InstallDirectory $installDirectory -LogPath $successSetupLog
  Assert-Condition ($installCode -eq 0) "Silent installation failed with exit code $installCode. See $successSetupLog."
  Wait-ForServiceState -Name $serviceName -ExpectedState 'Running'

  $healthy = $false
  $healthDeadline = (Get-Date).AddSeconds(45)
  do {
    try {
      $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8631/health' -TimeoutSec 2
      if ($health.ok -eq $true) { $healthy = $true; break }
    } catch {}
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $healthDeadline)
  Assert-Condition $healthy 'Print Agent service started but the local /health endpoint did not report ok=true.'

  Write-Host 'Smoke test: silent uninstall.' -ForegroundColor Cyan
  $uninstaller = Join-Path $installDirectory 'unins000.exe'
  Assert-Condition (Test-Path $uninstaller) "Uninstaller was not created at $uninstaller."
  $uninstallArgs = '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /LOG="{0}"' -f $uninstallLog
  $uninstallProcess = Start-Process -FilePath $uninstaller -ArgumentList $uninstallArgs -Wait -PassThru
  Assert-Condition ($uninstallProcess.ExitCode -eq 0) "Silent uninstall failed with exit code $($uninstallProcess.ExitCode). See $uninstallLog."
  Wait-ForServiceState -Name $serviceName -ExpectedState 'Absent'

  Write-Host 'Smoke test: compile forced-failure fixture.' -ForegroundColor Cyan
  $issPath = Join-Path $PSScriptRoot 'OliTechsPrintAgent.iss'
  & $InnoSetupPath "/DAppVersion=$failureVersion" "/DSourceRoot=$PayloadRoot" "/DOutputRoot=$failureOutputRoot" '/DForceServiceInstallFailure' $issPath
  if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed to compile the failure fixture (exit code $LASTEXITCODE)." }
  $failureInstaller = Join-Path $failureOutputRoot "OliTechsPrintAgentSetup-$failureVersion.exe"
  Assert-Condition (Test-Path $failureInstaller) "Forced-failure installer was not created: $failureInstaller"

  Write-Host 'Smoke test: forced silent service-install failure must return non-zero.' -ForegroundColor Cyan
  $failureCode = Invoke-SilentSetup -Path $failureInstaller -InstallDirectory $failureDirectory -LogPath $failureSetupLog
  Assert-Condition ($failureCode -ne 0) 'Forced service-install failure incorrectly returned exit code 0 in silent mode.'
  Wait-ForServiceState -Name $serviceName -ExpectedState 'Absent'
  Write-Host "Forced silent failure returned expected non-zero exit code: $failureCode" -ForegroundColor Green

  Write-Host 'All Windows installer smoke tests passed.' -ForegroundColor Green
} finally {
  # Best-effort cleanup of the isolated failure fixture. Preserve ProgramData logs for CI diagnostics.
  $remaining = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
  if ($remaining) {
    $wrapper = Join-Path $env:ProgramData 'OliTechs\PrintAgent\service\OliTechsPrintAgent.exe'
    if (Test-Path $wrapper) { & $wrapper uninstall 2>&1 | Out-Host }
    else { & sc.exe delete $serviceName 2>&1 | Out-Host }
  }
  if (Test-Path $failureDirectory) { Remove-Item $failureDirectory -Recurse -Force -ErrorAction SilentlyContinue }
  if (Test-Path $installDirectory) { Remove-Item $installDirectory -Recurse -Force -ErrorAction SilentlyContinue }
}
