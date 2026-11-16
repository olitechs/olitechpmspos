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

$service = Get-Service -Name $ServiceId -ErrorAction SilentlyContinue
if ($service) {
  if ($service.Status -ne 'Stopped') {
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      & sc.exe stop $ServiceId 2>$null | Out-Null
    } finally {
      $ErrorActionPreference = $previousPreference
    }
    # Wait for the agent to actually exit before removing the registration;
    # uninstalling a STOP_PENDING service leaves a pending deletion behind.
    $finalState = Wait-ServiceState -ServiceName $ServiceId -DesiredStates @('STOPPED') -TimeoutSeconds 45
    if ($finalState -ne 'STOPPED') {
      Write-Warning "The service did not reach the Stopped state (state: $finalState). It may still be listed as marked for deletion until it exits or Windows restarts."
    }
  }
  if (Test-Path $WrapperPath) {
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      & $WrapperPath uninstall 2>$null | Out-Null
      $code = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $previousPreference
    }
    if ($code -ne 0) {
      & sc.exe delete $ServiceId 2>$null | Out-Null
    }
  } else {
    & sc.exe delete $ServiceId 2>$null | Out-Null
  }
  # Confirm Windows actually removed the registration, not just marked it.
  if (Wait-ServiceGone -ServiceName $ServiceId -TimeoutSeconds 45) {
    Write-Host 'OliTechs Print Agent service removed.' -ForegroundColor Green
  } else {
    Write-Warning "Windows still lists the $ServiceId service (it is marked for deletion and disappears when the running agent exits or after a restart)."
  }
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
