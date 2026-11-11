$ErrorActionPreference = 'Stop'

# Kept as the documented entry point (npm run print-agent:uninstall).
$AgentRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Uninstaller = Join-Path $AgentRoot 'service\uninstall-service.ps1'
if (-not (Test-Path $Uninstaller)) { throw "Service uninstaller not found: $Uninstaller" }

& $Uninstaller @args
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
