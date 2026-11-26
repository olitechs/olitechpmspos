[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Origin
)

$ErrorActionPreference = 'Stop'

# Adds one exact app origin to an installed OliTechs Print Agent service and
# restarts it. This is the support fix for "Failed to fetch" when /health works
# in a browser tab but the web app is opened from another trusted domain.
function Test-ExactHttpOrigin {
  param([string]$Value)
  if (-not $Value) { return $false }
  try {
    $uri = [Uri]$Value
    if ($uri.Scheme -notin @('http', 'https')) { return $false }
    if ($uri.UserInfo -or $uri.Query -or $uri.Fragment) { return $false }
    if ($uri.AbsolutePath -notin @('', '/')) { return $false }
    return ($uri.AbsoluteUri.TrimEnd('/') -eq $Value.Trim().TrimEnd('/'))
  } catch {
    return $false
  }
}

if (-not (Test-ExactHttpOrigin $Origin)) {
  throw "Invalid origin '$Origin'. Pass an exact http(s) origin such as https://hotel.example.com (no path, query or trailing slash)."
}
if (-not $env:ProgramData) { throw 'The Windows ProgramData directory is not available.' }

$ConfigPath = Join-Path $env:ProgramData 'OliTechs\PrintAgent\service\OliTechsPrintAgent.xml'
if (-not (Test-Path $ConfigPath)) { throw "Print Agent service configuration not found: $ConfigPath" }

$escaped = [System.Security.SecurityElement]::Escape($Origin)
$entry = "  <env name=`"PRINT_AGENT_ALLOWED_ORIGINS`" value=`"$escaped`"/>"
$current = Get-Content -Raw -Path $ConfigPath
$updated = [regex]::Replace($current, '(?m)^[ \t]*<env name="PRINT_AGENT_ALLOWED_ORIGINS" value="[^"]*"/>\r?\n?', '')
if (-not $updated.Contains('</service>')) { throw "The service configuration is missing its closing tag: $ConfigPath" }
$updated = $updated.Replace('</service>', $entry + "`r`n</service>")
if ($updated -ne $current) { Set-Content -Path $ConfigPath -Value $updated -Encoding UTF8 }
$saved = Get-Content -Raw -Path $ConfigPath
if (-not $saved.Contains($entry)) { throw "The allowed-origin entry was not saved: $ConfigPath" }

Restart-Service -Name 'OliTechsPrintAgent' -ErrorAction Stop
$health = Invoke-RestMethod -Uri 'http://127.0.0.1:8631/health' -TimeoutSec 10
if (-not $health.ok) { throw 'The Print Agent restarted but /health did not report ok:true.' }

Write-Host "Allowed app origin: $Origin" -ForegroundColor Green
Write-Host "Agent version: $($health.version)" -ForegroundColor Green
Write-Host "Service config now allows: https://olitechpmspos.vercel.app, $Origin" -ForegroundColor Green
if ($health.allowedOrigins) {
  Write-Host "Agent reports allowed origins: $($health.allowedOrigins -join ', ')" -ForegroundColor Green
}
