$ErrorActionPreference = 'Stop'
$TaskName = 'OliTechs Print Agent'
$AgentRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent (Split-Path -Parent $AgentRoot)
$Runner = Join-Path $AgentRoot 'run-windows.ps1'
if (-not (Test-Path $Runner)) { throw "Print agent runner not found: $Runner" }
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw 'Node.js was not found. Install Node.js 20+ before installing the OliTechs Print Agent.' }
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType InteractiveToken -RunLevel Limited
$arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $Runner + '"'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'OliTechs local print agent for LAN, Windows spooler and POS receipt printers.' -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 1
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
Write-Host ''
Write-Host 'OliTechs Print Agent installed successfully.' -ForegroundColor Green
Write-Host "Task: $TaskName"
Write-Host "Repository: $RepoRoot"
Write-Host "Endpoint: http://127.0.0.1:8631"
Write-Host "Status: $($task.State)"
Write-Host ''
Write-Host 'Verify with:'
Write-Host '  Invoke-RestMethod http://127.0.0.1:8631/health'
