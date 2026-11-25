[CmdletBinding()]
param(
  # Repository root, or any extracted tag/release tree, to check.
  [string]$Root = '',

  # Fail unless this is running under Windows PowerShell 5.1 (the runtime used
  # when the installer calls a .ps1 with powershell.exe -File).
  [switch]$Require
)

$ErrorActionPreference = 'Stop'

if (-not $Root) {
  # $PSScriptRoot is not reliably populated while parameter defaults are bound
  # in Windows PowerShell 5.1, but it is available once the script body runs.
  # This file lives in <repo>\scripts, so the repo root is one level up.
  $Root = Split-Path -Parent $PSScriptRoot
}

if ($Require) {
  $version = $PSVersionTable.PSVersion
  if ($version.Major -ne 5 -or $version.Minor -lt 1 -or $PSVersionTable.PSEdition -ne 'Desktop') {
    Write-Host "PowerShell syntax check must run under Windows PowerShell 5.1, but this host is $version ($($PSVersionTable.PSEdition))." -ForegroundColor Red
    Write-Host 'Run: powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\check-powershell-syntax.ps1 -Require' -ForegroundColor Yellow
    exit 1
  }
}

if (-not (Test-Path -LiteralPath $Root)) {
  Write-Host "PowerShell syntax check: root not found: $Root" -ForegroundColor Red
  exit 1
}

$Root = (Resolve-Path -LiteralPath $Root).Path
$agentRoot = Join-Path $Root 'tools\print-agent'
if (-not (Test-Path -LiteralPath $agentRoot)) {
  Write-Host "PowerShell syntax check: tools\print-agent not found under $Root" -ForegroundColor Red
  exit 1
}

$fileMap = @{}

function Get-CheckFileKey([string]$Path) {
  # The same script can be reached through an 8.3 path (from Resolve-Path) and a
  # long path (from Get-ChildItem). Key on the stable part under the agent
  # folder so each file is checked exactly once.
  $marker = '\tools\print-agent\'
  $index = $Path.IndexOf($marker, [System.StringComparison]::OrdinalIgnoreCase)
  if ($index -ge 0) { return $Path.Substring($index).ToLowerInvariant() }
  return $Path.ToLowerInvariant()
}

# Every script that ships inside/next to the print agent.
Get-ChildItem -LiteralPath $agentRoot -Recurse -File -Filter '*.ps1' |
  ForEach-Object { $fileMap[(Get-CheckFileKey $_.FullName)] = $_.FullName }

# The repo-level command file is another documented entry point. Add the
# targets it invokes, so a renamed or moved script cannot escape the check.
$commandFile = Join-Path $Root 'install-print-agent.cmd'
if (Test-Path -LiteralPath $commandFile) {
  $commandText = Get-Content -Raw -LiteralPath $commandFile
  $pattern = '(?i)(tools\\print-agent\\[A-Za-z0-9_.\-\\]+\.ps1)'
  foreach ($match in [regex]::Matches($commandText, $pattern)) {
    $target = Join-Path $Root ($match.Groups[1].Value -replace '/', '\')
    if (Test-Path -LiteralPath $target) {
      $resolved = (Resolve-Path -LiteralPath $target).Path
      $fileMap[(Get-CheckFileKey $resolved)] = $resolved
    } else {
      Write-Host "PowerShell syntax check: install-print-agent.cmd points at a missing script: $target" -ForegroundColor Red
      exit 1
    }
  }
}

$ordered = @($fileMap.Values | Sort-Object)
if ($ordered.Count -eq 0) {
  Write-Host "PowerShell syntax check: no .ps1 files found under $agentRoot" -ForegroundColor Red
  exit 1
}

Write-Host 'PowerShell syntax and encoding check'
Write-Host "  Host:  $($PSVersionTable.PSVersion) ($($PSVersionTable.PSEdition))"
Write-Host "  Root:  $Root"
Write-Host "  Files: $($ordered.Count)"
Write-Host ''

$utf8Strict = New-Object System.Text.UTF8Encoding($false, $true)
$failedFiles = 0
$failedErrors = 0
$encodingProblems = 0

foreach ($file in $ordered) {
  # Resolve-Path can return an 8.3 path while Get-ChildItem returns the long
  # path, so a simple substring of $Root is not reliable. Anchor on the folder
  # that every checked script must live under.
  $marker = '\tools\print-agent\'
  $markerIndex = $file.IndexOf($marker, [System.StringComparison]::OrdinalIgnoreCase)
  if ($markerIndex -ge 0) {
    $relative = 'tools\print-agent\' + $file.Substring($markerIndex + $marker.Length)
  } else {
    $relative = Split-Path -Leaf $file
  }
  $fileFailed = $false
  $bytes = [System.IO.File]::ReadAllBytes($file)

  $hasUtf8Bom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
  $hasUtf16Bom = $bytes.Length -ge 2 -and (
    ($bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) -or
    ($bytes[0] -eq 0xFE -and $bytes[1] -eq 0xFF)
  )

  if ($hasUtf16Bom) {
    Write-Host "ENCODING $relative" -ForegroundColor Red
    Write-Host '  UTF-16 is not allowed. Save the script as ASCII or UTF-8 with a BOM.' -ForegroundColor Red
    $fileFailed = $true
    $encodingProblems++
  } elseif ($hasUtf8Bom) {
    try {
      [void]$utf8Strict.GetString($bytes, 3, $bytes.Length - 3)
    } catch {
      Write-Host "ENCODING $relative" -ForegroundColor Red
      Write-Host "  The UTF-8 BOM is followed by invalid UTF-8 bytes: $($_.Exception.Message)" -ForegroundColor Red
      $fileFailed = $true
      $encodingProblems++
    }
  } else {
    $nonAscii = 0
    foreach ($byte in $bytes) {
      if ($byte -gt 0x7F) { $nonAscii++ }
    }
    if ($nonAscii -gt 0) {
      Write-Host "ENCODING $relative" -ForegroundColor Red
      Write-Host "  $nonAscii non-ASCII byte(s) without a UTF-8 BOM. Windows PowerShell 5.1 reads BOM-less files as ANSI and can misparse them." -ForegroundColor Red
      Write-Host '  Save the script as ASCII, or as UTF-8 with a BOM.' -ForegroundColor Red
      $fileFailed = $true
      $encodingProblems++
    }
  }

  $tokens = $null
  $parseErrors = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile($file, [ref]$tokens, [ref]$parseErrors)
  if ($parseErrors -and $parseErrors.Count -gt 0) {
    Write-Host "PARSE $relative" -ForegroundColor Red
    foreach ($parseError in $parseErrors) {
      Write-Host ("  line {0}, column {1}: {2}" -f $parseError.Extent.StartLineNumber, $parseError.Extent.StartColumnNumber, $parseError.Message) -ForegroundColor Red
    }
    $fileFailed = $true
    $failedErrors += @($parseErrors).Count
  }

  if ($fileFailed) {
    $failedFiles++
    Write-Host ''
  }
}

if ($failedFiles -gt 0) {
  Write-Host "FAILED: $failedFiles file(s), $failedErrors parse error(s), $encodingProblems encoding problem(s)." -ForegroundColor Red
  exit 1
}

Write-Host "PASS: $($ordered.Count) script(s) parse cleanly and use an allowed encoding." -ForegroundColor Green
exit 0
