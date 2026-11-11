$ErrorActionPreference = 'Stop'

# Kept as the documented entry point (npm run print-agent:install). The service
# work happens in service/install-service.ps1 so there is one implementation.
$AgentRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Installer = Join-Path $AgentRoot 'service\install-service.ps1'
if (-not (Test-Path $Installer)) { throw "Service installer not found: $Installer" }

& $Installer @args
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
