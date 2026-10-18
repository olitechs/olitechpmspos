$ErrorActionPreference = 'Stop'
$TaskName = 'OliTechs Print Agent'
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host 'OliTechs Print Agent Windows task removed.' -ForegroundColor Green
} else {
  Write-Host 'OliTechs Print Agent Windows task is not installed.'
}
