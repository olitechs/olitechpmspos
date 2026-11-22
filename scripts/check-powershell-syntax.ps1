[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$rootPath = [System.IO.Path]::GetFullPath($Root)
$agentRoot = Join-Path $rootPath 'tools\print-agent'
if (-not (Test-Path -LiteralPath $agentRoot -PathType Container)) {
    Write-Error "Print Agent directory not found: $agentRoot"
    exit 2
}

$failed = $false
$files = @(Get-ChildItem -LiteralPath $agentRoot -Filter '*.ps1' -File -Recurse | Sort-Object FullName)

# Windows PowerShell 5.1 interprets BOM-less UTF-8 as the active ANSI code page.
# Require ASCII or a UTF-8 BOM for every script shipped/run by the installer.
foreach ($file in $files) {
    $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
    $hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
    $hasNonAscii = $false
    foreach ($byte in $bytes) {
        if ($byte -gt 0x7F) { $hasNonAscii = $true; break }
    }
    if ($hasNonAscii -and -not $hasBom) {
        Write-Host ("ENCODING ERROR: {0} (non-ASCII bytes without UTF-8 BOM)" -f $file.FullName) -ForegroundColor Red
        $failed = $true
    }

    $tokens = $null
    $parseErrors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile(
        $file.FullName, [ref]$tokens, [ref]$parseErrors
    )
    foreach ($parseError in $parseErrors) {
        $line = $parseError.Extent.StartLineNumber
        $column = $parseError.Extent.StartColumnNumber
        Write-Host ("SYNTAX ERROR: {0}:{1}:{2}: {3}" -f $file.FullName, $line, $column, $parseError.Message) -ForegroundColor Red
        $failed = $true
    }
}

# The root CMD launcher invokes this PowerShell target. Validate that every
# referenced .ps1 exists and is included in the parser pass above.
$cmdPath = Join-Path $rootPath 'install-print-agent.cmd'
if (Test-Path -LiteralPath $cmdPath -PathType Leaf) {
    $cmdText = [System.IO.File]::ReadAllText($cmdPath)
    $matches = [regex]::Matches($cmdText, '(?i)(?:%~dp0)?(?:[A-Z0-9_.-]+\\)*[A-Z0-9_.-]+\.ps1')
    foreach ($match in $matches) {
        $target = $match.Value
        $target = $target.Replace('%~dp0', '')
        $targetPath = [System.IO.Path]::GetFullPath((Join-Path $rootPath $target))
        if (-not (Test-Path -LiteralPath $targetPath -PathType Leaf)) {
            Write-Host ("CMD TARGET ERROR: {0} references missing PowerShell target {1}" -f $cmdPath, $target) -ForegroundColor Red
            $failed = $true
        } elseif (-not ($files.FullName -contains $targetPath)) {
            $tokens = $null
            $parseErrors = $null
            [void][System.Management.Automation.Language.Parser]::ParseFile($targetPath, [ref]$tokens, [ref]$parseErrors)
            foreach ($parseError in $parseErrors) {
                Write-Host ("SYNTAX ERROR: {0}:{1}: {2}" -f $targetPath, $parseError.Extent.StartLineNumber, $parseError.Message) -ForegroundColor Red
                $failed = $true
            }
        }
    }
}

if ($failed) {
    Write-Host 'PowerShell syntax/encoding validation FAILED.' -ForegroundColor Red
    exit 1
}
Write-Host ("PowerShell syntax/encoding validation passed ({0} scripts)." -f $files.Count) -ForegroundColor Green
exit 0
