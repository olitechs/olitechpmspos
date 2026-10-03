$ErrorActionPreference = 'Stop'
$AgentRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent (Split-Path -Parent $AgentRoot)
$Server = Join-Path $AgentRoot 'server.mjs'
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw 'Node.js was not found. Install Node.js 20+ and run the OliTechs Print Agent installer again.' }
$env:PRINT_AGENT_HOST = if ($env:PRINT_AGENT_HOST) { $env:PRINT_AGENT_HOST } else { '127.0.0.1' }
$env:PRINT_AGENT_PORT = if ($env:PRINT_AGENT_PORT) { $env:PRINT_AGENT_PORT } else { '8631' }
Set-Location $RepoRoot
& $nodeCommand.Source $Server
exit $LASTEXITCODE
