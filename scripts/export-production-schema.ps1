# Export a schema-only Supabase baseline from production.
# Safety: does not dump table data and does not modify the database.
# Requirements: Supabase CLI installed and a database connection string supplied
# in SUPABASE_DB_URL via a secure local environment variable. Never commit it.
#
# Usage (PowerShell):
#   $env:SUPABASE_DB_URL = Read-Host "Production database URL (do not paste into chat)"
#   .\scripts\export-production-schema.ps1
#
# Output is written under ./artifacts/schema-baseline/ and is git-ignored by
# default guidance; inspect the generated file before sharing or committing.

$ErrorActionPreference = "Stop"

if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
  throw "Supabase CLI is required. Install it from the official Supabase CLI instructions, then retry."
}
if ([string]::IsNullOrWhiteSpace($env:SUPABASE_DB_URL)) {
  throw "SUPABASE_DB_URL is not set. Set it locally from the Supabase Dashboard; do not put credentials in source control."
}

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root "artifacts/schema-baseline"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outFile = Join-Path $outDir "production-schema.sql"
$hashFile = Join-Path $outDir "production-schema.sha256"
$manifestFile = Join-Path $outDir "manifest.txt"

# Supabase CLI's db dump is schema-only by default. Explicitly scope the dump
# to application and Supabase-managed schemas needed for policy/function review.
# No --data-only or --use-copy flags are used.
supabase db dump --db-url $env:SUPABASE_DB_URL --schema public,auth,storage,extensions --file $outFile
if ($LASTEXITCODE -ne 0) {
  throw "Supabase schema dump failed with exit code $LASTEXITCODE. No baseline is accepted."
}
if (-not (Test-Path $outFile) -or (Get-Item $outFile).Length -lt 100) {
  throw "Dump file is missing or suspiciously small; baseline rejected."
}

$sql = Get-Content -Raw -Path $outFile
if ($sql -match '(?im)^\s*(INSERT\s+INTO|COPY\s+[^\n]+\s+FROM\s+stdin)\b') {
  Remove-Item -Force $outFile
  throw "Data-bearing INSERT/COPY statements detected. Dump removed and baseline rejected."
}

$hash = (Get-FileHash -Algorithm SHA256 -Path $outFile).Hash.ToLowerInvariant()
Set-Content -Path $hashFile -Value "$hash  production-schema.sql" -Encoding ascii
@(
  "Purpose: schema-only production baseline"
  "Created UTC: $([DateTime]::UtcNow.ToString('o'))"
  "Included schemas: public, auth, storage, extensions"
  "Data statements check: no INSERT/COPY FROM STDIN patterns detected"
  "SHA256: $hash"
  "Note: schema equivalence is NOT established by export alone; restore to the existing disposable and compare all objects before migration replay."
) | Set-Content -Path $manifestFile -Encoding utf8

Write-Host "Schema-only export created: $outFile"
Write-Host "SHA-256: $hash"
Write-Host "This export has not been restored or compared; do not treat it as a validated disposable baseline."
