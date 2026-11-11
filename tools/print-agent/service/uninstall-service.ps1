[CmdletBinding()]
param(
  [switch]$RemoveData
)

$ErrorActionPreference = 'Stop'

$ServiceId = 'OliTechsPrintAgent'
$LegacyTaskName = 'OliTechs Print Agent'
$DataDir = Join-Path $env:ProgramData 'OliTechs\PrintAgent'
$ServiceDir = Join-Path $DataDir 'service'
$WrapperPath = Join-Path $ServiceDir "$ServiceId.exe"

$service = Get-Service -Name $ServiceId -ErrorAction SilentlyContinue
if ($service) {
  if ($service.Status -ne 'Stopped') {
    Stop-Service -Name $ServiceId -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path $WrapperPath) {
    & $WrapperPath uninstall 2>$null | Out-Null
  } else {
    sc.exe delete $ServiceId 2>$null | Out-Null
  }
  Start-Sleep -Seconds 2
  Write-Host 'OliTechs Print Agent service removed.' -ForegroundColor Green
} else {
  Write-Host 'The OliTechs Print Agent service is not installed.'
}

$legacyTask = Get-ScheduledTask -TaskName $LegacyTaskName -ErrorAction SilentlyContinue
if ($legacyTask) {
  Stop-ScheduledTask -TaskName $LegacyTaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $LegacyTaskName -Confirm:$false
  Write-Host 'Removed the old logon-based Print Agent task.' -ForegroundColor Green
}

Remove-Item -Path (Join-Path $ServiceDir "$ServiceId.exe") -Force -ErrorAction SilentlyContinue
Remove-Item -Path (Join-Path $ServiceDir "$ServiceId.xml") -Force -ErrorAction SilentlyContinue

if ($RemoveData) {
  Remove-Item -Path $DataDir -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "Removed print agent data and logs from $DataDir" -ForegroundColor Yellow
} else {
  # Printer discovery details and logs help the next install and any support
  # request, so they are only deleted when that is explicitly requested.
  Write-Host "Printer data and logs were kept in $DataDir"
  Write-Host 'Run this uninstaller with -RemoveData to delete them as well.'
}
