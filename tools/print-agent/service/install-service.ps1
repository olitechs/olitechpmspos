[CmdletBinding()]
param(
  [string]$WinSWPath = '',
  [string]$NodeExe = '',
  [string]$SupabaseUrl = '',
  [string]$SupabaseAnonKey = '',
  [string]$AgentConfigPath = '',
  [switch]$SkipLegacyTaskCleanup
)

# OliTechs Print Agent service installer.
#
# Exit codes are stable because Inno Setup shows them and deployment scripts
# check them. Keep this table in step with INSTALL-WINDOWS.md.
#   0  success
#   10 required template or agent script missing
#   11 bundled Node.js missing, not executable, or older than 20.6
#   12 WinSW.exe missing
#   13 not running as administrator
#   14 port 8631 is in use by another program
#   15 stale service registration that cannot be removed (usually needs restart)
#   16 WinSW install or service configuration failed
#   17 service did not reach Running
#   18 service is Running but /health did not answer
#   19 required Node module or agent entry point cannot be imported
#   20 Windows 10 or newer is required
#   21 not enough free disk space
#   22 ProgramData is not writable
#   23 .NET Framework 4.6.1 or newer is required by WinSW 2.12
#   24 a legacy scheduled task could not be removed
#   25 unexpected installer error

$ErrorActionPreference = 'Stop'

$ServiceId = 'OliTechsPrintAgent'
$ServiceDisplayName = 'OliTechs Print Agent'
$LegacyTaskName = 'OliTechs Print Agent'
$ServicePort = 8631
$HealthUrl = "http://127.0.0.1:$ServicePort/health"
$MinimumNodeMajor = 20
$MinimumNodeMinor = 6
$MinimumFreeBytes = 200MB
$MinimumDotNetRelease = 394254
$systemRoot = if ($env:SystemRoot) { $env:SystemRoot } else { $env:windir }
$scExe = Join-Path $systemRoot 'System32\sc.exe'

$ServiceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AgentDir = Split-Path -Parent $ServiceRoot
$RepoRoot = Split-Path -Parent (Split-Path -Parent $AgentDir)

$TemplatePath = Join-Path $ServiceRoot 'OliTechsPrintAgent.xml.template'
$AgentScript = Join-Path $AgentDir 'print-agent-v2.js'
$InstrumentScript = Join-Path $AgentDir 'instrument.mjs'

$DataDir = Join-Path $env:ProgramData 'OliTechs\PrintAgent'
$ServiceDir = Join-Path $DataDir 'service'
$LogDir = Join-Path $DataDir 'logs'
$ConfigPath = Join-Path $ServiceDir "$ServiceId.xml"
$WrapperPath = Join-Path $ServiceDir "$ServiceId.exe"

# The installer log must exist even when the install fails before ProgramData is
# writable. Fall back to TEMP for the log/result pair, but never install there.
$InstallLogDir = $LogDir
$LogDirIsProgramData = $true

function Initialize-InstallLog {
  param([string]$Path)
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
  $probe = Join-Path $Path ('.write-test-{0}' -f [guid]::NewGuid().ToString('N'))
  Set-Content -LiteralPath $probe -Value 'ok' -Encoding ASCII
  Remove-Item -LiteralPath $probe -Force
}

try {
  Initialize-InstallLog -Path $InstallLogDir
} catch {
  $LogDirIsProgramData = $false
  $InstallLogDir = Join-Path $env:TEMP 'OliTechsPrintAgent-logs'
  try { Initialize-InstallLog -Path $InstallLogDir } catch {
    Write-Host "Could not create the installer log folder: $($_.Exception.Message)" -ForegroundColor Red
  }
}

$InstallLogPath = Join-Path $InstallLogDir 'install-service.log'
$ResultPath = Join-Path $InstallLogDir 'install-result.json'

$script:InstallLogPath = $InstallLogPath
$script:ResultPath = $ResultPath
$script:NodeVersion = ''
$script:NodeExePath = ''
$script:ResolvedWinSW = ''
$script:WinSWSha256 = ''
$script:AgentVersion = ''
$script:IsElevated = $false
$script:ServiceRegistered = $false
$script:PairingConfigured = $false

function Write-InstallLog {
  param(
    [AllowEmptyString()][string]$Message,
    [string]$Color = 'Gray'
  )
  $line = '{0} {1}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $Message
  try {
    Add-Content -LiteralPath $script:InstallLogPath -Value $line -Encoding UTF8 -ErrorAction Stop
  } catch {
    # A logging failure must never hide the real installer failure.
  }
  Write-Host $Message -ForegroundColor $Color
}

function Write-InstallResult {
  param(
    [string]$Stage,
    [int]$Code,
    [string]$Message,
    [hashtable]$Details = @{}
  )
  $result = [ordered]@{
    stage              = $Stage
    code               = $Code
    message            = $Message
    time               = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    service            = $ServiceId
    serviceDisplayName = $ServiceDisplayName
    agentVersion       = $script:AgentVersion
    nodeVersion        = $script:NodeVersion
    powershellVersion  = $PSVersionTable.PSVersion.ToString()
    osVersion          = [Environment]::OSVersion.VersionString
    elevated           = $script:IsElevated
    logPath            = $script:InstallLogPath
    resultPath         = $script:ResultPath
    dataDir            = $DataDir
    serviceDir         = $ServiceDir
    port               = $ServicePort
    winswPath          = $script:ResolvedWinSW
    winswSha256        = $script:WinSWSha256
  }
  foreach ($key in $Details.Keys) {
    $result[$key] = $Details[$key]
  }
  try {
    $result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $script:ResultPath -Encoding UTF8 -ErrorAction Stop
  } catch {
    Write-Host "Could not write the install result file: $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

function Format-NativeArgument {
  param([string]$Value)
  if ($Value -match '[\s"]') {
    return '"' + ($Value -replace '"', '\"') + '"'
  }
  return $Value
}

function Invoke-NativeCommand {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$Arguments = @(),
    [string]$WorkingDirectory = '',
    [string]$Label = '',
    [switch]$Quiet
  )
  if (-not $Label) { $Label = Split-Path -Leaf $FilePath }
  $token = '{0}-{1}' -f $PID, [guid]::NewGuid().ToString('N')
  $stdoutFile = Join-Path $env:TEMP "olitechs-native-$token.out"
  $stderrFile = Join-Path $env:TEMP "olitechs-native-$token.err"
  $exitCode = -1
  $startError = ''

  $startArgs = @{
    FilePath               = $FilePath
    ArgumentList           = $Arguments
    Wait                   = $true
    PassThru               = $true
    RedirectStandardOutput = $stdoutFile
    RedirectStandardError  = $stderrFile
    NoNewWindow            = $true
    ErrorAction            = 'Stop'
  }
  if ($WorkingDirectory) { $startArgs.WorkingDirectory = $WorkingDirectory }

  try {
    $process = Start-Process @startArgs
    $exitCode = $process.ExitCode
  } catch {
    $startError = $_.Exception.Message
  }

  $stdout = ''
  $stderr = ''
  if (Test-Path -LiteralPath $stdoutFile) {
    $stdout = Get-Content -LiteralPath $stdoutFile -Raw -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $stderrFile) {
    $stderr = Get-Content -LiteralPath $stderrFile -Raw -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $stdoutFile -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $stderrFile -Force -ErrorAction SilentlyContinue

  if (-not $Quiet) {
    Write-InstallLog ("[{0}] exit code {1}" -f $Label, $exitCode)
    if ($startError) {
      Write-InstallLog ("[{0}] could not start: {1}" -f $Label, $startError) 'Red'
    }
    foreach ($stream in @(
      @{ Name = 'stdout'; Text = $stdout },
      @{ Name = 'stderr'; Text = $stderr }
    )) {
      if (-not $stream.Text) { continue }
      $lines = @($stream.Text -split '\r?\n' | Where-Object { $_.Trim().Length -gt 0 })
      if ($lines.Count -gt 200) {
        Write-InstallLog ("[{0}] {1} truncated to the last 200 lines" -f $Label, $stream.Name) 'Yellow'
        $lines = @($lines | Select-Object -Last 200)
      }
      foreach ($line in $lines) {
        $color = if ($stream.Name -eq 'stderr') { 'Yellow' } else { 'Gray' }
        Write-InstallLog ("[{0}] {1}" -f $Label, $line) $color
      }
    }
  }

  return [pscustomobject]@{
    ExitCode  = $exitCode
    StdOut    = [string]$stdout
    StdErr    = [string]$stderr
    StartError = $startError
  }
}

function Test-IsElevated {
  try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object -TypeName Security.Principal.WindowsPrincipal -ArgumentList $identity
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  } catch {
    return $false
  }
}

function Get-DotNetRelease {
  try {
    $item = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -Name Release -ErrorAction Stop
    return [int]$item.Release
  } catch {
    return 0
  }
}

function Get-FreeBytes {
  param([string]$Path)
  try {
    $full = [System.IO.Path]::GetFullPath($Path)
    $root = [System.IO.Path]::GetPathRoot($full)
    $drive = New-Object -TypeName System.IO.DriveInfo -ArgumentList $root
    return [long]$drive.AvailableFreeSpace
  } catch {
    return -1
  }
}

function ConvertTo-FileUrl {
  param([Parameter(Mandatory = $true)][string]$Path)
  # Node's ESM loader only accepts file:// URLs for absolute module paths on
  # Windows. WinSW reads these values from the generated service XML.
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  return (New-Object System.Uri -ArgumentList $fullPath).AbsoluteUri
}

function Get-AgentVersion {
  try {
    $configFile = Join-Path $AgentDir 'config.mjs'
    if (-not (Test-Path -LiteralPath $configFile)) { return '' }
    $match = Select-String -LiteralPath $configFile -Pattern "AGENT_VERSION\s*=\s*'([^']+)'" | Select-Object -First 1
    if ($match -and $match.Matches.Count -gt 0) {
      return $match.Matches[0].Groups[1].Value
    }
  } catch {
  }
  return ''
}

function Test-OliTechsAgentCommandLine {
  param([string]$CommandLine)
  if (-not $CommandLine) { return $false }
  if ($CommandLine -notmatch '(?i)(print-agent-v2\.js|instrument\.mjs)') { return $false }
  return ($CommandLine -match '(?i)(OliTechs\\PrintAgent|tools\\print-agent)')
}

function Get-ServiceProcessId {
  try {
    $service = Get-CimInstance -ClassName Win32_Service -Filter "Name='$ServiceId'" -ErrorAction SilentlyContinue
    if ($service -and $service.ProcessId) { return [int]$service.ProcessId }
  } catch {
  }
  return 0
}

function Get-ProcessDetails {
  param([int]$ProcessId)
  $name = ''
  $commandLine = ''
  try { $name = (Get-Process -Id $ProcessId -ErrorAction Stop).ProcessName } catch {}
  try {
    $info = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
    if ($info) { $commandLine = [string]$info.CommandLine }
  } catch {}
  return [pscustomobject]@{
    ProcessId   = $ProcessId
    Name        = $name
    CommandLine = $commandLine
  }
}

function Get-PortOwner {
  param([int]$Port)
  $cmdletWorked = $false
  try {
    $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
    $cmdletWorked = $true
    if (-not $connection) { return $null }
    return Get-ProcessDetails -ProcessId ([int]$connection.OwningProcess)
  } catch {
    $cmdletWorked = $false
  }

  if ($cmdletWorked) { return $null }

  # Older Windows builds may not have Get-NetTCPConnection. Fall back to netstat
  # without letting its stderr touch the PowerShell error stream.
  $netstat = Join-Path $systemRoot 'System32\netstat.exe'
  if (-not (Test-Path -LiteralPath $netstat)) { return $null }
  $result = Invoke-NativeCommand -FilePath $netstat -Arguments @('-ano') -Label 'netstat' -Quiet
  $pattern = '^\s*TCP\s+\S+:' + $Port + '\s+\S+\s+LISTENING\s+(\d+)'
  foreach ($line in ($result.StdOut -split '\r?\n')) {
    if ($line -match $pattern) {
      return Get-ProcessDetails -ProcessId ([int]$Matches[1])
    }
  }
  return $null
}

function Wait-ForPortFree {
  param([int]$Port, [int]$TimeoutSeconds = 10)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    if (-not (Get-PortOwner -Port $Port)) { return $true }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  return $false
}

function Stop-OliTechsAgentProcesses {
  $currentPid = $PID
  $servicePid = Get-ServiceProcessId
  $stopped = @()
  try {
    $processes = Get-CimInstance -ClassName Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue
    foreach ($process in $processes) {
      $processId = [int]$process.ProcessId
      if ($processId -eq $currentPid -or $processId -eq $servicePid) { continue }
      if (-not (Test-OliTechsAgentCommandLine ([string]$process.CommandLine))) { continue }
      try {
        Stop-Process -Id $processId -Force -ErrorAction Stop
        $stopped += $processId
      } catch {
        Write-InstallLog "Could not stop print agent process ${processId}: $($_.Exception.Message)" 'Yellow'
      }
    }
  } catch {
    Write-InstallLog "Could not inspect running processes: $($_.Exception.Message)" 'Yellow'
  }
  if ($stopped.Count -gt 0) {
    Write-InstallLog ("Stopped manual print agent process(es): {0}" -f ($stopped -join ', ')) 'Yellow'
  }
}

function Remove-ServiceBestEffort {
  try {
    $service = Get-Service -Name $ServiceId -ErrorAction SilentlyContinue
    if ($service -and $service.Status -ne 'Stopped') {
      try {
        Stop-Service -Name $ServiceId -Force -ErrorAction Stop
      } catch {
        Write-InstallLog "Could not stop the existing service: $($_.Exception.Message)" 'Yellow'
      }
      $deadline = (Get-Date).AddSeconds(30)
      do {
        Start-Sleep -Milliseconds 500
        $service = Get-Service -Name $ServiceId -ErrorAction SilentlyContinue
      } while ($service -and $service.Status -ne 'Stopped' -and (Get-Date) -lt $deadline)
    }

    if (Test-Path -LiteralPath $WrapperPath) {
      $uninstall = Invoke-NativeCommand -FilePath $WrapperPath -Arguments @('uninstall') -WorkingDirectory $ServiceDir -Label 'WinSW uninstall'
      if ($uninstall.ExitCode -ne 0) {
        Write-InstallLog "WinSW uninstall returned $($uninstall.ExitCode); trying sc.exe delete." 'Yellow'
      }
    }

    $query = Invoke-NativeCommand -FilePath $scExe -Arguments @('query', $ServiceId) -Label 'sc query' -Quiet
    if ($query.ExitCode -eq 0) {
      [void](Invoke-NativeCommand -FilePath $scExe -Arguments @('delete', $ServiceId) -Label 'sc delete')
    }

    $deadline = (Get-Date).AddSeconds(20)
    do {
      Start-Sleep -Milliseconds 500
      $service = Get-Service -Name $ServiceId -ErrorAction SilentlyContinue
    } while ($service -and (Get-Date) -lt $deadline)
  } catch {
    Write-InstallLog "Service cleanup warning: $($_.Exception.Message)" 'Yellow'
  } finally {
    $script:ServiceRegistered = $false
  }
}

function Remove-ExistingService {
  $service = Get-Service -Name $ServiceId -ErrorAction SilentlyContinue
  if ($service) {
    Write-InstallLog "Stopping the existing OliTechs Print Agent service (status: $($service.Status))..." 'Yellow'
    Remove-ServiceBestEffort
    $service = Get-Service -Name $ServiceId -ErrorAction SilentlyContinue
    if ($service) {
      Fail-Install -Stage 'stale-service' -Code 15 -Message ("The existing OliTechs Print Agent service could not be removed (status: {0}). Windows may have marked it for deletion. Restart the computer and run this installer again." -f $service.Status)
    }
  }
}

function Fail-Install {
  param(
    [string]$Stage,
    [int]$Code,
    [string]$Message,
    [hashtable]$Details = @{}
  )
  Write-InstallLog "FAILED [$Code] ${Stage}: $Message" 'Red'
  Write-InstallResult -Stage $Stage -Code $Code -Message $Message -Details $Details
  if ($script:ServiceRegistered) {
    Write-InstallLog 'Removing the partially installed service so a rerun starts clean.' 'Yellow'
    Remove-ServiceBestEffort
  }
  exit $Code
}

function Test-Preflight {
  $script:IsElevated = Test-IsElevated
  if (-not $script:IsElevated) {
    Fail-Install -Stage 'elevation' -Code 13 -Message 'Administrator rights are required to install the OliTechs Print Agent service. Right-click the installer and choose "Run as administrator".'
  }

  $osVersion = [Environment]::OSVersion.Version
  if ($osVersion.Major -lt 10) {
    Fail-Install -Stage 'windows-version' -Code 20 -Message ("Windows 10 or newer is required. This computer reports {0}." -f [Environment]::OSVersion.VersionString)
  }

  if (-not $LogDirIsProgramData) {
    Fail-Install -Stage 'programdata' -Code 22 -Message ("The installer could not write to {0}. Check permissions on ProgramData, or run the installer as an administrator." -f $LogDir)
  }

  $dotNetRelease = Get-DotNetRelease
  if ($dotNetRelease -lt $MinimumDotNetRelease) {
    Fail-Install -Stage 'dotnet' -Code 23 -Message ("The Windows service wrapper needs .NET Framework 4.6.1 or newer. The detected release is {0}. Install the .NET Framework update and run the installer again." -f $dotNetRelease)
  }

  foreach ($path in @($env:ProgramData, $AgentDir)) {
    $freeBytes = Get-FreeBytes -Path $path
    if ($freeBytes -ge 0 -and $freeBytes -lt $MinimumFreeBytes) {
      Fail-Install -Stage 'disk' -Code 21 -Message ("Not enough free disk space on {0}. At least {1} MB is required; {2} MB is free." -f $path, [int]($MinimumFreeBytes / 1MB), [int]($freeBytes / 1MB))
    }
  }
}

function Resolve-InstallerPaths {
  if (-not (Test-Path -LiteralPath $TemplatePath)) {
    Fail-Install -Stage 'template' -Code 10 -Message "The service template is missing: $TemplatePath. Reinstall the print agent package."
  }
  if (-not (Test-Path -LiteralPath $AgentScript)) {
    Fail-Install -Stage 'agent-script' -Code 10 -Message "The print agent entry point is missing: $AgentScript. Reinstall the print agent package."
  }
  if (-not (Test-Path -LiteralPath $InstrumentScript)) {
    Fail-Install -Stage 'instrument-script' -Code 10 -Message "The print agent instrumentation file is missing: $InstrumentScript. Reinstall the print agent package."
  }
  if (-not (Test-Path -LiteralPath $scExe)) {
    Fail-Install -Stage 'windows-tools' -Code 10 -Message "Windows service control (sc.exe) was not found at $scExe."
  }

  if ($NodeExe) {
    if (-not (Test-Path -LiteralPath $NodeExe)) {
      Fail-Install -Stage 'node' -Code 11 -Message "The bundled Node.js runtime was not found: $NodeExe. Reinstall the print agent package."
    }
    $script:NodeExePath = (Resolve-Path -LiteralPath $NodeExe).Path
  } else {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $nodeCommand) {
      Fail-Install -Stage 'node' -Code 11 -Message 'Node.js was not found on this computer. Run the OliTechs Print Agent installer, or install Node.js 20.6 or newer.'
    }
    $script:NodeExePath = $nodeCommand.Source
  }

  if ($WinSWPath) {
    if (-not (Test-Path -LiteralPath $WinSWPath)) {
      Fail-Install -Stage 'winsw' -Code 12 -Message "The Windows service wrapper (WinSW.exe) was not found: $WinSWPath. Reinstall the print agent package."
    }
    $script:ResolvedWinSW = (Resolve-Path -LiteralPath $WinSWPath).Path
  } else {
    $candidates = @((Join-Path $ServiceRoot 'WinSW.exe'), (Join-Path $DataDir 'bin\WinSW.exe'))
    foreach ($candidate in $candidates) {
      if (Test-Path -LiteralPath $candidate) {
        $script:ResolvedWinSW = (Resolve-Path -LiteralPath $candidate).Path
        break
      }
    }
    if (-not $script:ResolvedWinSW) {
      Fail-Install -Stage 'winsw' -Code 12 -Message 'The Windows service wrapper (WinSW.exe) is missing from the print agent package.'
    }
  }

  $script:AgentVersion = Get-AgentVersion
}

function Test-NodeRuntime {
  $version = Invoke-NativeCommand -FilePath $script:NodeExePath -Arguments @('--version') -Label 'node --version'
  if ($version.ExitCode -ne 0) {
    Fail-Install -Stage 'node-version' -Code 11 -Message "The bundled Node.js runtime could not run (exit code $($version.ExitCode)). Reinstall the print agent package."
  }
  $text = $version.StdOut.Trim()
  if ($text -notmatch '^v(\d+)\.(\d+)\.(\d+)') {
    Fail-Install -Stage 'node-version' -Code 11 -Message "Could not read the bundled Node.js version (output: $text). Reinstall the print agent package."
  }
  $script:NodeVersion = $text
  $major = [int]$Matches[1]
  $minor = [int]$Matches[2]
  if ($major -lt $MinimumNodeMajor -or ($major -eq $MinimumNodeMajor -and $minor -lt $MinimumNodeMinor)) {
    Fail-Install -Stage 'node-version' -Code 11 -Message ("Node.js {0}.{1} or newer is required for service mode; the bundled runtime is {2}." -f $MinimumNodeMajor, $MinimumNodeMinor, $text)
  }
}

function Test-AgentModules {
  # Resolve the module from the agent folder so the bundled runtime uses the
  # payload's own node_modules, not a developer machine's global install.
  $probeCode = "import('@sentry/node').then(() => {}, (error) => { console.error(error && error.message ? error.message : String(error)); process.exit(1); });"
  $import = Invoke-NativeCommand -FilePath $script:NodeExePath -Arguments @('--input-type=module', '-e', (Format-NativeArgument $probeCode)) -WorkingDirectory $AgentDir -Label 'node @sentry/node'
  if ($import.ExitCode -ne 0) {
    Fail-Install -Stage 'node-module' -Code 19 -Message 'The bundled Node.js runtime cannot import @sentry/node. Reinstall the print agent package.'
  }

  $checkEntry = Invoke-NativeCommand -FilePath $script:NodeExePath -Arguments @('--check', (Format-NativeArgument $AgentScript)) -WorkingDirectory $AgentDir -Label 'node --check agent'
  if ($checkEntry.ExitCode -ne 0) {
    Fail-Install -Stage 'agent-syntax' -Code 19 -Message 'The print agent entry point could not be parsed by the bundled Node.js runtime. Reinstall the print agent package.'
  }

  $checkInstrument = Invoke-NativeCommand -FilePath $script:NodeExePath -Arguments @('--check', (Format-NativeArgument $InstrumentScript)) -WorkingDirectory $AgentDir -Label 'node --check instrument'
  if ($checkInstrument.ExitCode -ne 0) {
    Fail-Install -Stage 'instrument-syntax' -Code 19 -Message 'The print agent instrumentation file could not be parsed by the bundled Node.js runtime. Reinstall the print agent package.'
  }
}

function Test-PortAvailable {
  $owner = Get-PortOwner -Port $ServicePort
  if (-not $owner) { return }

  $servicePid = Get-ServiceProcessId
  if ($servicePid -and $owner.ProcessId -eq $servicePid) {
    Write-InstallLog "Port $ServicePort is held by the existing OliTechs service (PID $($owner.ProcessId)); it will be stopped for the upgrade." 'Yellow'
    return
  }

  if (Test-OliTechsAgentCommandLine $owner.CommandLine) {
    Write-InstallLog "Port $ServicePort is held by a manual OliTechs agent process (PID $($owner.ProcessId)); stopping it." 'Yellow'
    try {
      Stop-Process -Id $owner.ProcessId -Force -ErrorAction Stop
    } catch {
      Fail-Install -Stage 'port' -Code 14 -Message ("Port {0} is in use by an OliTechs agent process (PID {1}) that could not be stopped: {2}" -f $ServicePort, $owner.ProcessId, $_.Exception.Message)
    }
    if (-not (Wait-ForPortFree -Port $ServicePort -TimeoutSeconds 10)) {
      Fail-Install -Stage 'port' -Code 14 -Message ("Port {0} is still in use after stopping the manual OliTechs agent (PID {1})." -f $ServicePort, $owner.ProcessId)
    }
    return
  }

  $name = if ($owner.Name) { $owner.Name } else { 'another program' }
  Fail-Install -Stage 'port' -Code 14 -Message ("Port {0} is already in use by {1} (PID {2}). Stop that program or restart the computer, then run the installer again." -f $ServicePort, $name, $owner.ProcessId) -Details @{
    portOwnerPid  = $owner.ProcessId
    portOwnerName = $name
  }
}

function Remove-LegacyTask {
  if ($SkipLegacyTaskCleanup) { return }
  try {
    $legacyTask = Get-ScheduledTask -TaskName $LegacyTaskName -ErrorAction SilentlyContinue
    if (-not $legacyTask) { return }
    # Older installs started the agent at logon. A scheduled task and a service
    # would fight over port 8631 and print the same job twice.
    Stop-ScheduledTask -TaskName $LegacyTaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $LegacyTaskName -Confirm:$false -ErrorAction Stop
    Write-InstallLog 'Removed the previous logon-based Print Agent task.' 'Yellow'
  } catch {
    Fail-Install -Stage 'legacy-task' -Code 24 -Message ("The old logon-based Print Agent task could not be removed: {0}" -f $_.Exception.Message)
  }
}

function Install-ServiceRegistration {
  try {
    New-Item -ItemType Directory -Force -Path $ServiceDir, $LogDir | Out-Null
  } catch {
    Fail-Install -Stage 'programdata' -Code 22 -Message ("Could not create the service folders under {0}: {1}" -f $DataDir, $_.Exception.Message)
  }

  $escape = [System.Security.SecurityElement]::Escape
  $xml = Get-Content -Raw -LiteralPath $TemplatePath
  $xml = $xml.Replace('{{NODE_EXE}}', $escape.Invoke($script:NodeExePath))
  $xml = $xml.Replace('{{AGENT_SCRIPT}}', $escape.Invoke((ConvertTo-FileUrl -Path $AgentScript)))
  $xml = $xml.Replace('{{INSTRUMENT_SCRIPT}}', $escape.Invoke((ConvertTo-FileUrl -Path $InstrumentScript)))
  $xml = $xml.Replace('{{WORKING_DIR}}', $escape.Invoke($RepoRoot))
  $xml = $xml.Replace('{{DATA_DIR}}', $escape.Invoke($DataDir))
  $xml = $xml.Replace('{{LOG_DIR}}', $escape.Invoke($LogDir))

  # Pairing needs the public Supabase URL and anon key. Neither is a secret in
  # the credential sense (the anon key ships in the web app), and the workstation
  # gets its own print credential through pairing. A service-role key is never
  # installed here, so a copied workstation cannot read another property's data.
  if (-not $AgentConfigPath) { $AgentConfigPath = Join-Path $RepoRoot 'agent-config.json' }
  if ((-not $SupabaseUrl -or -not $SupabaseAnonKey) -and (Test-Path -LiteralPath $AgentConfigPath)) {
    try {
      $agentConfig = Get-Content -Raw -LiteralPath $AgentConfigPath | ConvertFrom-Json
      if (-not $SupabaseUrl) { $SupabaseUrl = [string]$agentConfig.supabaseUrl }
      if (-not $SupabaseAnonKey) { $SupabaseAnonKey = [string]$agentConfig.supabaseAnonKey }
    } catch {
      Write-InstallLog "Could not read $AgentConfigPath. Pairing will stay unavailable until the agent is configured." 'Yellow'
    }
  }

  $envEntries = ''
  $script:PairingConfigured = [bool]($SupabaseUrl -and $SupabaseAnonKey)
  if ($script:PairingConfigured) {
    $escapedUrl = $escape.Invoke($SupabaseUrl)
    $escapedKey = $escape.Invoke($SupabaseAnonKey)
    $envEntries = "  <env name=`"SUPABASE_URL`" value=`"$escapedUrl`"/>`r`n  <env name=`"VITE_SUPABASE_ANON_KEY`" value=`"$escapedKey`"/>"
  }
  $xml = $xml.Replace('{{ENV_ENTRIES}}', $envEntries)

  # Check after every supported token has been rendered. An earlier guard saw
  # the ENV_ENTRIES token in the source template and made every silent install
  # exit 10 before the service could be registered.
  if ($xml -match '\{\{[A-Z_]+\}\}') {
    Fail-Install -Stage 'template' -Code 10 -Message 'The service template contains a placeholder that this installer does not know how to fill. Reinstall the print agent package.'
  }

  try {
    Set-Content -LiteralPath $ConfigPath -Value $xml -Encoding UTF8 -ErrorAction Stop
    Copy-Item -LiteralPath $script:ResolvedWinSW -Destination $WrapperPath -Force -ErrorAction Stop
  } catch {
    Fail-Install -Stage 'service-files' -Code 22 -Message ("Could not write the service configuration under {0}: {1}" -f $ServiceDir, $_.Exception.Message)
  }
  try {
    $script:WinSWSha256 = (Get-FileHash -LiteralPath $WrapperPath -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
  } catch {
    $script:WinSWSha256 = ''
  }

  $install = Invoke-NativeCommand -FilePath $WrapperPath -Arguments @('install') -WorkingDirectory $ServiceDir -Label 'WinSW install'
  if ($install.ExitCode -ne 0) {
    $query = Invoke-NativeCommand -FilePath $scExe -Arguments @('query', $ServiceId) -Label 'sc query after WinSW failure'
    $combined = '{0}\n{1}\n{2}' -f $install.StdOut, $install.StdErr, $query.StdOut
    if ($combined -match '(?i)marked for deletion|1072') {
      Fail-Install -Stage 'stale-service' -Code 15 -Message 'Windows still has an old OliTechs Print Agent service marked for deletion. Restart the computer and run the installer again.'
    }
    Fail-Install -Stage 'winsw-install' -Code 16 -Message ("The Windows service could not be registered (WinSW exit code {0}). See {1} for details." -f $install.ExitCode, $InstallLogPath)
  }
  $script:ServiceRegistered = $true

  $recovery = Invoke-NativeCommand -FilePath $scExe -Arguments @('failure', $ServiceId, 'reset=', '86400', 'actions=', 'restart/5000/restart/15000/restart/60000') -Label 'sc failure'
  if ($recovery.ExitCode -ne 0) {
    Fail-Install -Stage 'recovery' -Code 16 -Message ("The service was registered but its recovery actions could not be set (sc.exe exit code {0})." -f $recovery.ExitCode)
  }
  $description = 'OliTechs local print agent: LAN ESC/POS and Windows spooler printing for Olitech PMS/POS.'
  $descriptionResult = Invoke-NativeCommand -FilePath $scExe -Arguments @('description', $ServiceId, (Format-NativeArgument $description)) -Label 'sc description'
  if ($descriptionResult.ExitCode -ne 0) {
    Write-InstallLog "The service description could not be set (sc.exe exit code $($descriptionResult.ExitCode)); the service is still usable." 'Yellow'
  }
}

function Start-AgentService {
  Write-InstallLog 'Starting the OliTechs Print Agent service...'
  try {
    Start-Service -Name $ServiceId -ErrorAction Stop
  } catch {
    Write-InstallLog "Start-Service reported: $($_.Exception.Message)" 'Yellow'
  }

  $deadline = (Get-Date).AddSeconds(45)
  $status = $null
  do {
    Start-Sleep -Milliseconds 500
    $service = Get-Service -Name $ServiceId -ErrorAction SilentlyContinue
    if ($service) { $status = $service.Status } else { $status = $null }
  } while ($status -ne 'Running' -and (Get-Date) -lt $deadline)

  if ($status -ne 'Running') {
    Write-ServiceDiagnostics
    Fail-Install -Stage 'start' -Code 17 -Message ("The OliTechs Print Agent service did not reach Running (status: {0}). See {1} and the diagnostic entries above." -f $status, $InstallLogPath)
  }
  Write-InstallLog "Service status: $status" 'Green'
}

function Wait-AgentHealth {
  $lastError = 'no response'
  $deadline = (Get-Date).AddSeconds(30)
  do {
    $service = Get-Service -Name $ServiceId -ErrorAction SilentlyContinue
    if ($service -and $service.Status -ne 'Running') {
      Write-ServiceDiagnostics
      Fail-Install -Stage 'start' -Code 17 -Message ("The OliTechs Print Agent service stopped before /health answered (status: {0}). See {1}." -f $service.Status, $InstallLogPath)
    }

    try {
      $health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2 -ErrorAction Stop
      if ($health -and $health.ok -eq $true) {
        $paired = $false
        if ($health.paired) { $paired = [bool]$health.paired.paired }
        Write-InstallLog ("Health: responding (version {0}, paired: {1})" -f $health.version, $paired) 'Green'
        return [pscustomobject]@{
          Ok     = $true
          Health = $health
          Paired = $paired
        }
      }
      $lastError = 'the health endpoint returned ok=false'
    } catch {
      $lastError = $_.Exception.Message
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)

  Write-ServiceDiagnostics
  Fail-Install -Stage 'health' -Code 18 -Message ("The service is running but {0} did not answer correctly within 30 seconds. Last error: {1}. See {2}." -f $HealthUrl, $lastError, $InstallLogPath)
}

function Write-ServiceDiagnostics {
  Write-InstallLog '--- Service diagnostics ---' 'Yellow'
  try {
    [void](Invoke-NativeCommand -FilePath $scExe -Arguments @('query', $ServiceId) -Label 'sc query')
    [void](Invoke-NativeCommand -FilePath $scExe -Arguments @('qc', $ServiceId) -Label 'sc qc')
  } catch {
    Write-InstallLog "Could not query the service: $($_.Exception.Message)" 'Yellow'
  }

  $agentLog = Join-Path $LogDir 'agent.log'
  if (Test-Path -LiteralPath $agentLog) {
    Write-InstallLog "Last 50 lines of $agentLog"
    try {
      Get-Content -LiteralPath $agentLog -Tail 50 -ErrorAction Stop | ForEach-Object { Write-InstallLog "  $_" }
    } catch {
      Write-InstallLog "Could not read the agent log: $($_.Exception.Message)" 'Yellow'
    }
  } else {
    Write-InstallLog "Agent log not found: $agentLog" 'Yellow'
  }

  foreach ($name in @("$ServiceId.out.log", "$ServiceId.err.log", "$ServiceId.wrapper.log")) {
    $logFile = Join-Path $LogDir $name
    if (-not (Test-Path -LiteralPath $logFile)) { continue }
    Write-InstallLog "Last 20 lines of $logFile"
    try {
      Get-Content -LiteralPath $logFile -Tail 20 -ErrorAction Stop | ForEach-Object { Write-InstallLog "  $_" }
    } catch {
      Write-InstallLog "Could not read $name : $($_.Exception.Message)" 'Yellow'
    }
  }

  $since = (Get-Date).AddMinutes(-10)
  try {
    $systemEvents = Get-WinEvent -FilterHashtable @{ LogName = 'System'; StartTime = $since } -MaxEvents 100 -ErrorAction Stop |
      Where-Object { $_.ProviderName -match 'Service Control Manager' -or $_.Message -match 'OliTechs|PrintAgent' } |
      Select-Object -First 20
    foreach ($event in $systemEvents) {
      $text = ($event.Message -replace '\s+', ' ').Trim()
      if ($text.Length -gt 400) { $text = $text.Substring(0, 400) + '...' }
      Write-InstallLog ("EVENT System/{0} {1}: {2}" -f $event.Id, $event.TimeCreated, $text)
    }
  } catch {
    Write-InstallLog "System event log unavailable: $($_.Exception.Message)" 'Yellow'
  }

  try {
    $applicationEvents = Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = $since } -MaxEvents 100 -ErrorAction Stop |
      Where-Object { $_.Message -match 'OliTechs|PrintAgent|node\.exe|WinSW' } |
      Select-Object -First 20
    foreach ($event in $applicationEvents) {
      $text = ($event.Message -replace '\s+', ' ').Trim()
      if ($text.Length -gt 400) { $text = $text.Substring(0, 400) + '...' }
      Write-InstallLog ("EVENT Application/{0} {1}: {2}" -f $event.Id, $event.TimeCreated, $text)
    }
  } catch {
    Write-InstallLog "Application event log unavailable: $($_.Exception.Message)" 'Yellow'
  }
  Write-InstallLog '--- End of service diagnostics ---' 'Yellow'
}

trap {
  $message = $_.Exception.Message
  try { Write-InstallLog "UNEXPECTED ERROR: $message" 'Red' } catch {}
  try {
    if ($script:ServiceRegistered) { Remove-ServiceBestEffort }
  } catch {}
  try {
    Write-InstallResult -Stage 'unexpected' -Code 25 -Message $message
  } catch {}
  exit 25
}

Write-InstallLog 'OliTechs Print Agent installer starting.'
Write-InstallLog ("Host: {0} | OS: {1} | PowerShell: {2}" -f $env:COMPUTERNAME, [Environment]::OSVersion.VersionString, $PSVersionTable.PSVersion)
Write-InstallLog ("Install log: {0}" -f $InstallLogPath)

Test-Preflight
Resolve-InstallerPaths
Test-NodeRuntime
Test-AgentModules
Test-PortAvailable
Remove-ExistingService
Stop-OliTechsAgentProcesses
if (-not (Wait-ForPortFree -Port $ServicePort -TimeoutSeconds 10)) {
  Fail-Install -Stage 'port' -Code 14 -Message "Port $ServicePort is still in use after stopping the previous print agent."
}
Remove-LegacyTask
Install-ServiceRegistration
Start-AgentService
$healthResult = Wait-AgentHealth

$finalService = Get-Service -Name $ServiceId -ErrorAction SilentlyContinue
if (-not $finalService -or $finalService.Status -ne 'Running') {
  Write-ServiceDiagnostics
  Fail-Install -Stage 'start' -Code 17 -Message ("The OliTechs Print Agent service is not Running after the health check (status: {0}). See {1}." -f $(if ($finalService) { $finalService.Status } else { 'missing' }), $InstallLogPath)
}

Write-InstallResult -Stage 'complete' -Code 0 -Message 'The OliTechs Print Agent service was installed and is responding to health checks.' -Details @{
  serviceStatus = 'Running'
  healthOk      = $true
  paired        = $healthResult.Paired
}

Write-InstallLog ''
Write-InstallLog 'OliTechs Print Agent service installed successfully.' 'Green'
Write-InstallLog "Service:  $ServiceDisplayName ($ServiceId)"
Write-InstallLog "Status:   $((Get-Service -Name $ServiceId).Status)"
Write-InstallLog 'Accounts: runs as LocalSystem and starts with Windows, before anyone signs in'
Write-InstallLog "Endpoint: http://127.0.0.1:$ServicePort"
Write-InstallLog "Logs:     $LogDir"
if ($script:PairingConfigured) {
  Write-InstallLog 'Pairing:  available. Open OliTechs, Settings, Printers and press "Pair this computer".'
} else {
  Write-InstallLog 'Pairing:  unavailable until SUPABASE_URL and the anon key are configured for the agent.' 'Yellow'
}
Write-InstallLog 'Health:   responding' 'Green'
Write-InstallLog ''
exit 0
