# Verify a schema-only PostgreSQL dump before restoring or sharing it.
# Reads the SQL locally and never prints matched secret values.
# Usage:
#   .\scripts\verify-production-schema.ps1
#   .\scripts\verify-production-schema.ps1 -Path .\artifacts\schema-baseline\production-schema.sql

[CmdletBinding()]
param(
  [string]$Path = (Join-Path (Split-Path -Parent $PSScriptRoot) "artifacts/schema-baseline/production-schema.sql")
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
  throw "SQL dump not found. Generate the schema-only export first."
}

$resolved = (Resolve-Path -LiteralPath $Path).Path
$sql = [System.IO.File]::ReadAllText($resolved)
if ([string]::IsNullOrWhiteSpace($sql)) { throw "Dump is empty; verification failed." }

$findings = [System.Collections.Generic.List[string]]::new()
function Add-Matches([string]$Text, [string]$Pattern, [string]$Label) {
  $options = [System.Text.RegularExpressions.RegexOptions]::IgnoreCase -bor [System.Text.RegularExpressions.RegexOptions]::Multiline
  $matches = [regex]::Matches($Text, $Pattern, $options)
  foreach ($match in $matches) {
    $line = 1 + ([regex]::Matches($Text.Substring(0, $match.Index), "\n")).Count
    $script:findings.Add("$Label at line $line")
  }
}

# Data-bearing pg_dump output patterns. Schema-only dumps should not contain these.
Add-Matches $sql '^\s*INSERT\s+INTO\b' 'Potential table-data INSERT'
Add-Matches $sql '^\s*COPY\s+.+\s+FROM\s+stdin\s*;' 'Potential table-data COPY block'
Add-Matches $sql '^\\\.(?:\s*)$' 'COPY data terminator (review surrounding block)'

# Credential/secret indicators. Only report the line and rule, never the value.
Add-Matches $sql '\bpostgres(?:ql)?://[^\s''"<>:]+:[^\s''"<>@]+@' 'Database URL containing username/password'
Add-Matches $sql '\b(password|passwd|secret|service_role|anon_key|api[_-]?key|access[_-]?token|refresh[_-]?token)\b\s*(?:=|:)\s*[''"][^''"]{8,}[''"]' 'Possible embedded credential assignment'
Add-Matches $sql '\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b' 'JWT-like token'
Add-Matches $sql '\bsk-[A-Za-z0-9_-]{20,}\b' 'API-key-like token'
Add-Matches $sql '-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----' 'Private-key material'
Add-Matches $sql '\bAKIA[0-9A-Z]{16}\b' 'AWS access-key-like token'

# Require recognizable DDL so an error page or empty file cannot pass.
if ($sql -notmatch '(?im)^\s*CREATE\s+(TABLE|FUNCTION|TYPE|SCHEMA|VIEW|TRIGGER|POLICY|INDEX)\b') {
  $findings.Add('No recognizable schema DDL found')
}

if ($findings.Count -gt 0) {
  Write-Host "FAIL: schema dump requires manual review. No secret values are printed."
  $findings | Sort-Object -Unique | ForEach-Object { Write-Host " - $_" }
  throw "Verification failed with $($findings.Count) finding(s). Do not restore or share this dump."
}

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $resolved).Hash.ToLowerInvariant()
Write-Host "PASS: no configured data-bearing statement or credential patterns detected."
Write-Host "File: $resolved"
Write-Host "Bytes: $([System.IO.FileInfo]::new($resolved).Length)"
Write-Host "SHA-256: $hash"
Write-Host "Limit: pattern scanning cannot guarantee absence of every secret; inspect SQL defaults, function bodies, comments, and custom settings before sharing."
