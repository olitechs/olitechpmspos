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

$current = Get-Content -Raw -Path $ConfigPath
# Merge instead of replacing: hotels commonly open both the www and apex
# address of the same site, and support may have added other exact origins.
$existingValue = ''
$existingEntry = [regex]::Match($current, '(?m)^[ \t]*<env name="PRINT_AGENT_ALLOWED_ORIGINS" value="([^"]*)"/>')
if ($existingEntry.Success) {
  # SecurityElement has Escape() but no Unescape() in Windows PowerShell 5.1.
  # WebUtility.HtmlDecode covers the XML entities Escape() can write here.
  $existingValue = [System.Net.WebUtility]::HtmlDecode($existingEntry.Groups[1].Value)
}
# Add the www/apex twin as well. Staff and support often paste one variant
# while the browser uses the other; both are exact origins of the same site.
$requestedOrigins = @($Origin)
try {
  $uri = [Uri]$Origin
  if ($uri.Scheme -in @('http', 'https')) {
    $builder = New-Object System.UriBuilder($Origin)
    if ($builder.Host.StartsWith('www.', [System.StringComparison]::OrdinalIgnoreCase)) {
      $builder.Host = $builder.Host.Substring(4)
    } else {
      $builder.Host = 'www.' + $builder.Host
    }
    $builder.Path = ''
    $builder.Query = ''
    $builder.Fragment = ''
    $variant = $builder.Uri.AbsoluteUri.TrimEnd('/')
    if ($variant -and ($requestedOrigins -notcontains $variant)) { $requestedOrigins += $variant }
  }
} catch {
  # The origin was already validated; keep it even if the twin cannot be built.
}

$origins = @()
foreach ($item in (($existingValue -split ',') + $requestedOrigins)) {
  $value = $item.Trim()
  if ($value -and ($origins -notcontains $value)) { $origins += $value }
}
$escaped = [System.Security.SecurityElement]::Escape(($origins -join ','))
$entry = "  <env name=`"PRINT_AGENT_ALLOWED_ORIGINS`" value=`"$escaped`"/>"
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
Write-Host "Service config now allows: $($origins -join ', ')" -ForegroundColor Green
if ($health.allowedOrigins) {
  Write-Host "Agent reports allowed origins: $($health.allowedOrigins -join ', ')" -ForegroundColor Green
}
