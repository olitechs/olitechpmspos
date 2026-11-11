$ErrorActionPreference = 'Stop'
$AgentRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent (Split-Path -Parent $AgentRoot)
$Server = Join-Path $AgentRoot 'print-agent-v2.js'
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw 'Node.js was not found. Install Node.js 20 or newer and run the OliTechs Print Agent installer again.' }

# Diagnostic/manual mode only. The installed Windows service is the supported
# way to run the agent; running both at once is refused by the single-instance
# lock, which is intentional.
$env:PRINT_AGENT_MODE = 'console'
$env:PRINT_AGENT_HOST = if ($env:PRINT_AGENT_HOST) { $env:PRINT_AGENT_HOST } else { '127.0.0.1' }
$env:PRINT_AGENT_PORT = if ($env:PRINT_AGENT_PORT) { $env:PRINT_AGENT_PORT } else { '8631' }
Set-Location $RepoRoot
& $nodeCommand.Source $Server
exit $LASTEXITCODE
