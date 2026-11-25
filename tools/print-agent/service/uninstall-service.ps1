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
$systemRoot = if ($env:SystemRoot) { $env:SystemRoot } else { $env:windir }
$scExe = Join-Path $systemRoot 'System32\sc.exe'

# Native stderr must not become a terminating error under Windows PowerShell 5.1.
function Invoke-NativeSilently {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$Arguments = @()
  )
  $token = '{0}-{1}' -f $PID, [guid]::NewGuid().ToString('N')
  $stdout = Join-Path $env:TEMP "olitechs-uninstall-$token.out"
  $stderr = Join-Path $env:TEMP "olitechs-uninstall-$token.err"
  $exitCode = -1
  try {
    $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -Wait -PassThru -NoNewWindow -RedirectStandardOutput $stdout -RedirectStandardError $stderr -ErrorAction Stop
    $exitCode = $process.ExitCode
  } catch {
    Write-Host "Could not run $(Split-Path -Leaf $FilePath): $($_.Exception.Message)" -ForegroundColor Red
  }
  foreach ($path in @($stdout, $stderr)) {
    if (Test-Path -LiteralPath $path) {
      $text = Get-Content -LiteralPath $path -Raw -ErrorAction SilentlyContinue
      if ($text -and $text.Trim()) { Write-Host $text.Trim() }
      Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
    }
  }
  return $exitCode
}

$service = Get-Service -Name $ServiceId -ErrorAction SilentlyContinue
if ($service) {
  if ($service.Status -ne 'Stopped') {
    Stop-Service -Name $ServiceId -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path $WrapperPath) {
    [void](Invoke-NativeSilently -FilePath $WrapperPath -Arguments @('uninstall'))
  } else {
    [void](Invoke-NativeSilently -FilePath $scExe -Arguments @('delete', $ServiceId))
  }
  for ($i = 0; $i -lt 20; $i++) {
    if (-not (Get-Service -Name $ServiceId -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Seconds 1
  }
  $remaining = Get-Service -Name $ServiceId -ErrorAction SilentlyContinue
  if ($remaining) {
    throw "The OliTechs Print Agent service was not removed (status: $($remaining.Status)). Restart Windows and uninstall again."
  }
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
