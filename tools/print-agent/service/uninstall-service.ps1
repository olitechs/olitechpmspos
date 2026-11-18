[CmdletBinding()]
param(
  [switch]$RemoveData
)

$ErrorActionPreference = 'Stop'

$ServiceId = 'OliTechsPrintAgent'
$LegacyTaskName = 'OliTechs Print Agent'
$DataDir = Join-Path $env:ProgramData 'OliTechs\PrintAgent'
$ServiceDir = Join-Path $DataDir 'service'
$LogDir = Join-Path $DataDir 'logs'
$InstallLogPath = Join-Path $LogDir 'uninstall-service.log'
try { New-Item -ItemType Directory -Force -Path $LogDir | Out-Null } catch {
  $InstallLogPath = Join-Path $env:TEMP 'OliTechs-PrintAgent-uninstall.log'
}
function Write-UninstallLog([string]$Message) {
  try { Add-Content -LiteralPath $InstallLogPath -Value "[$(Get-Date -Format o)] $Message" -Encoding UTF8 }
  catch { try { Add-Content -LiteralPath (Join-Path $env:TEMP 'OliTechs-PrintAgent-uninstall.log') -Value $Message -Encoding UTF8 } catch {} }
}

$WrapperPath = Join-Path $ServiceDir "$ServiceId.exe"
Write-UninstallLog "BEGIN uninstall. DataDir=$DataDir"

$service = Get-Service -Name $ServiceId -ErrorAction SilentlyContinue
if ($service) {
  if ($service.Status -ne 'Stopped') {
    Stop-Service -Name $ServiceId -Force -ErrorAction Stop
    $stopDeadline = (Get-Date).AddSeconds(30)
    do {
      Start-Sleep -Milliseconds 500
      $service = Get-Service -Name $ServiceId -ErrorAction SilentlyContinue
    } while ($service -and $service.Status -ne 'Stopped' -and (Get-Date) -lt $stopDeadline)
    if ($service -and $service.Status -ne 'Stopped') {
      throw "The Print Agent service did not stop. It has not been removed. See $InstallLogPath."
    }
  }

  if (Test-Path $WrapperPath) {
    $output = & $WrapperPath uninstall 2>&1
    $exitCode = $LASTEXITCODE
  } else {
    $output = & sc.exe delete $ServiceId 2>&1
    $exitCode = $LASTEXITCODE
  }
  if ($output) { $output | Out-File -FilePath $InstallLogPath -Append -Encoding utf8 }
  if ($exitCode -ne 0) {
    throw "Windows could not remove the Print Agent service (exit code $exitCode). See $InstallLogPath."
  }

  $deadline = (Get-Date).AddSeconds(30)
  do {
    Start-Sleep -Milliseconds 500
    $query = & sc.exe query $ServiceId 2>&1
    $queryCode = $LASTEXITCODE
  } while (($queryCode -eq 0 -or $queryCode -eq 1072) -and (Get-Date) -lt $deadline)
  if ($queryCode -ne 1060) {
    $query | Out-File -FilePath $InstallLogPath -Append -Encoding utf8
    throw "Windows has not released the Print Agent service registration (sc.exe exit code $queryCode). Restart Windows and retry. Persistent print data has been kept."
  }
  Write-UninstallLog 'Windows service removed and released.'
} else {
  Write-UninstallLog 'Service is not registered.'
}

$legacyTask = Get-ScheduledTask -TaskName $LegacyTaskName -ErrorAction SilentlyContinue
if ($legacyTask) {
  Stop-ScheduledTask -TaskName $LegacyTaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $LegacyTaskName -Confirm:$false -ErrorAction Stop
  Write-UninstallLog 'Removed the old logon-based Print Agent task.'
}

# Remove wrapper/config only after the Service Control Manager confirms removal.
Remove-Item -Path (Join-Path $ServiceDir "$ServiceId.exe") -Force -ErrorAction SilentlyContinue
Remove-Item -Path (Join-Path $ServiceDir "$ServiceId.xml") -Force -ErrorAction SilentlyContinue

if ($RemoveData) {
  Remove-Item -Path $DataDir -Recurse -Force -ErrorAction Stop
  Write-Host "Removed print agent data and logs from $DataDir" -ForegroundColor Yellow
} else {
  Write-UninstallLog "Persistent printer pairing, queue, logs and diagnostics were retained at $DataDir."
  Write-Host "Printer data and logs were kept in $DataDir"
  Write-Host 'Run this uninstaller with -RemoveData to delete them as well.'
}
