[CmdletBinding()]
param(
  [string]$Version = '',
  [string]$NodeZipPath = '',
  [string]$NodeVersion = '22.14.0',
  [string]$NodeSha256 = '',
  [string]$WinSWPath = '',
  [string]$InnoSetupPath = '',
  [string]$SupabaseUrl = '',
  [string]$SupabaseAnonKey = '',
  # Signing: provide either a certificate already installed in the store, or a
  # PFX. Without one the build only produces an internal, clearly marked unsigned
  # artifact.
  [string]$CertificateThumbprint = '',
  [string]$PfxPath = '',
  [string]$PfxPassword = '',
  [string]$TimestampUrl = 'http://timestamp.digicert.com',
  [switch]$AllowUnsigned,
  [switch]$SkipNodeHashCheck
)

# Builds the click-once OliTechs Print Agent installer.
#
# This script does not ship, download into the repository, or sign with anything
# committed to git. It stages a payload, compiles the Inno Setup script, applies
# an Authenticode signature with YOUR certificate, then verifies the result. If
# no certificate is available it refuses to call the output a release.

$ErrorActionPreference = 'Stop'

$InstallerDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AgentDir = Split-Path -Parent $InstallerDir
$RepoRoot = Split-Path -Parent (Split-Path -Parent $AgentDir)
$DistRoot = Join-Path $RepoRoot 'dist\installer'
$PayloadRoot = Join-Path $DistRoot 'payload'

if (-not $Version) {
  $package = Get-Content -Raw -Path (Join-Path $RepoRoot 'package.json') | ConvertFrom-Json
  $agentVersionLine = Select-String -Path (Join-Path $AgentDir 'config.mjs') -Pattern "AGENT_VERSION\s*=\s*'([^']+)'" | Select-Object -First 1
  if ($agentVersionLine) { $Version = $agentVersionLine.Matches[0].Groups[1].Value } else { $Version = '0.0.0-dev' }
}
Write-Host "Building OliTechs Print Agent installer $Version" -ForegroundColor Cyan

function Resolve-Tool([string]$Explicit, [string[]]$Candidates, [string]$Label) {
  if ($Explicit) {
    if (-not (Test-Path $Explicit)) { throw "$Label was not found at $Explicit" }
    return (Resolve-Path $Explicit).Path
  }
  foreach ($candidate in $Candidates) {
    if ($candidate -and (Test-Path $candidate)) { return (Resolve-Path $candidate).Path }
  }
  return ''
}

# 1. Required binaries. The repository deliberately stores none of them.
if (-not $WinSWPath) {
  throw 'Pass -WinSWPath with the WinSW.exe you have verified (SHA-256 + Authenticode). The repository does not store service-wrapper binaries.'
}
$WinSWPath = (Resolve-Path $WinSWPath).Path
$winSwSignature = Get-AuthenticodeSignature $WinSWPath
if ($winSwSignature.Status -ne 'Valid') {
  Write-Host "Warning: WinSW.exe is not validly signed (status: $($winSwSignature.Status))." -ForegroundColor Yellow
}

$Iscc = Resolve-Tool -Explicit $InnoSetupPath -Candidates @(
  (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
  (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe')
) -Label 'Inno Setup compiler (ISCC.exe)'
if (-not $Iscc) {
  throw 'Inno Setup 6 was not found. Install it from https://jrsoftware.org/isdl.php, or pass -InnoSetupPath with ISCC.exe.'
}

# 2. Stage the payload exactly as it will sit on the POS computer.
if (Test-Path $PayloadRoot) { Remove-Item -Path $PayloadRoot -Recurse -Force }
$agentDest = Join-Path $PayloadRoot 'tools\print-agent'
$servicesDest = Join-Path $PayloadRoot 'src\services'
$nodeDest = Join-Path $PayloadRoot 'node'
$serviceDest = Join-Path $PayloadRoot 'service'
foreach ($dir in @($agentDest, $servicesDest, $nodeDest, $serviceDest)) {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
}

Copy-Item -Path (Join-Path $AgentDir '*') -Destination $agentDest -Recurse -Force
# Tests, docs and source patches have no place on a reception PC.
Get-ChildItem -Path $agentDest -Filter '*.test.mjs' -File | Remove-Item -Force
Get-ChildItem -Path $agentDest -Filter '*.patch' -File | Remove-Item -Force
Remove-Item -Path (Join-Path $agentDest 'installer') -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path (Join-Path $agentDest 'WINDOWS-ACCEPTANCE-CHECKLIST.md') -Force -ErrorAction SilentlyContinue

$escposJob = Join-Path $RepoRoot 'src\services\escposJob.js'
if (-not (Test-Path $escposJob)) { throw "The shared ESC/POS builder is missing: $escposJob" }
Copy-Item -Path $escposJob -Destination (Join-Path $servicesDest 'escposJob.js') -Force

Copy-Item -Path (Join-Path $InstallerDir 'pair-workstation.ps1') -Destination (Join-Path $PayloadRoot 'pair-workstation.ps1') -Force
Copy-Item -Path $WinSWPath -Destination (Join-Path $serviceDest 'WinSW.exe') -Force

# 3. Bundle Node so nobody installs it by hand.
if (-not $NodeZipPath) {
  $cacheDir = Join-Path $DistRoot 'cache'
  New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
  $NodeZipPath = Join-Path $cacheDir "node-v$NodeVersion-win-x64.zip"
  if (-not (Test-Path $NodeZipPath)) {
    $url = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip"
    Write-Host "Downloading $url" -ForegroundColor Cyan
    Invoke-WebRequest -Uri $url -OutFile $NodeZipPath -UseBasicParsing
  }
}
if (-not $NodeSha256 -and -not $SkipNodeHashCheck) {
  throw 'Pass -NodeSha256 with the official checksum from https://nodejs.org/dist, or -SkipNodeHashCheck for an internal test build. An unverified runtime is never bundled for release.'
}
if ($NodeSha256) {
  $actual = (Get-FileHash -Path $NodeZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $NodeSha256.ToLowerInvariant()) {
    throw "Node.js runtime checksum mismatch. Expected $NodeSha256 but the file is $actual."
  }
}

$extractDir = Join-Path $DistRoot 'node-extract'
if (Test-Path $extractDir) { Remove-Item -Path $extractDir -Recurse -Force }
Expand-Archive -Path $NodeZipPath -DestinationPath $extractDir -Force
$nodeExe = Get-ChildItem -Path $extractDir -Recurse -Filter 'node.exe' -File | Select-Object -First 1
if (-not $nodeExe) { throw 'The downloaded Node.js archive did not contain node.exe.' }
Copy-Item -Path $nodeExe.FullName -Destination (Join-Path $nodeDest 'node.exe') -Force

$nodeSignature = Get-AuthenticodeSignature (Join-Path $nodeDest 'node.exe')
if ($nodeSignature.Status -ne 'Valid') {
  Write-Host "Warning: the bundled node.exe signature is $($nodeSignature.Status). The official archive is signed; verify -NodeSha256." -ForegroundColor Yellow
}

# 4. Public cloud configuration, so pairing works without a terminal.
if (-not $SupabaseUrl -or -not $SupabaseAnonKey) {
  $envFile = Join-Path $RepoRoot '.env'
  if (Test-Path $envFile) {
    foreach ($line in Get-Content $envFile) {
      if ($line -match '^\s*VITE_SUPABASE_URL\s*=\s*(.+)\s*$' -and -not $SupabaseUrl) { $SupabaseUrl = $Matches[1].Trim().Trim('"') }
      if ($line -match '^\s*VITE_SUPABASE_ANON_KEY\s*=\s*(.+)\s*$' -and -not $SupabaseAnonKey) { $SupabaseAnonKey = $Matches[1].Trim().Trim('"') }
    }
  }
}
if ($SupabaseUrl -and $SupabaseAnonKey) {
  @{ supabaseUrl = $SupabaseUrl; supabaseAnonKey = $SupabaseAnonKey } |
    ConvertTo-Json | Set-Content -Path (Join-Path $PayloadRoot 'agent-config.json') -Encoding UTF8
} else {
  Write-Host 'Warning: no Supabase URL/anon key found. The installer will still work, but pairing stays unavailable until the agent is configured.' -ForegroundColor Yellow
}
# A service-role key must never be staged: assert that nothing secret is in the payload.
$leaked = Get-ChildItem -Path $PayloadRoot -Recurse -File | Select-String -Pattern 'SERVICE_ROLE|service_role' -SimpleMatch -ErrorAction SilentlyContinue
if ($leaked) { throw 'A service-role reference was found in the payload. Workstations get their own credential through pairing; nothing else may be bundled.' }

# 5. Compile.
if (Test-Path $DistRoot) {
  Get-ChildItem -Path $DistRoot -Filter 'OliTechsPrintAgentSetup-*.exe' -File | Remove-Item -Force -ErrorAction SilentlyContinue
}
& $Iscc "/DAppVersion=$Version" "/DSourceRoot=$PayloadRoot" "/DOutputRoot=$DistRoot" (Join-Path $InstallerDir 'OliTechsPrintAgent.iss')
if ($LASTEXITCODE -ne 0) { throw "Inno Setup compilation failed (exit code $LASTEXITCODE)." }

$setup = Get-ChildItem -Path $DistRoot -Filter 'OliTechsPrintAgentSetup-*.exe' -File |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $setup) { throw 'Inno Setup reported success but no installer was produced.' }

# 6. Sign and verify. An unsigned setup is not a release artifact.
$signtool = Resolve-Tool -Explicit '' -Candidates @(
  (Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin\x64\signtool.exe')
) -Label 'signtool'
if (-not $signtool) {
  $found = Get-Command signtool.exe -ErrorAction SilentlyContinue
  if ($found) { $signtool = $found.Source }
}

$canSign = $CertificateThumbprint -or $PfxPath
if ($canSign) {
  if (-not $signtool) { throw 'signtool.exe was not found. Install the Windows SDK signing tools.' }
  if ($CertificateThumbprint) {
    & $signtool sign /sha1 $CertificateThumbprint /fd SHA256 /tr $TimestampUrl /td SHA256 $setup.FullName
  } else {
    & $signtool sign /f $PfxPath /p $PfxPassword /fd SHA256 /tr $TimestampUrl /td SHA256 $setup.FullName
  }
  if ($LASTEXITCODE -ne 0) { throw "Code signing failed (exit code $LASTEXITCODE)." }

  $verification = Get-AuthenticodeSignature $setup.FullName
  if ($verification.Status -ne 'Valid') {
    throw "The signed installer is not valid: $($verification.Status) $($verification.StatusMessage)"
  }
  Write-Host "Signed and verified: $($setup.FullName)" -ForegroundColor Green
  Write-Host "Publisher: $($verification.SignerCertificate.Subject)"
  Write-Host "SHA-256:  $((Get-FileHash $setup.FullName -Algorithm SHA256).Hash)"
} elseif ($AllowUnsigned) {
  $unsigned = Join-Path $setup.DirectoryName ($setup.BaseName + '-UNSIGNED.exe')
  Move-Item -Path $setup.FullName -Destination $unsigned -Force
  Write-Host 'WARNING: this build is UNSIGNED. Windows SmartScreen will warn, and it must not be given to a customer.' -ForegroundColor Yellow
  Write-Host "Unsigned test artifact: $unsigned"
} else {
  throw 'Refusing to produce an unsigned release installer. Pass -CertificateThumbprint or -PfxPath/-PfxPassword, or -AllowUnsigned for an internal test build.'
}

Write-Host ''
Write-Host 'Installer build complete.' -ForegroundColor Green
Write-Host "Version: $Version"
Write-Host 'Next: install it on a spare Windows 10/11 x64 computer and run Part 13 of WINDOWS-ACCEPTANCE-CHECKLIST.md.'
