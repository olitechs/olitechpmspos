import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (relative) => readFile(new URL(relative, import.meta.url), 'utf8');

test('service definition starts with Windows and restarts after a failure', async () => {
  const xml = await read('./service/OliTechsPrintAgent.xml.template');
  assert.match(xml, /<id>OliTechsPrintAgent<\/id>/);
  assert.match(xml, /<name>OliTechs Print Agent<\/name>/);
  assert.match(xml, /<startmode>Automatic<\/startmode>/);
  assert.match(xml, /<onfailure action="restart"/);
  assert.match(xml, /<resetfailure>/);
  assert.match(xml, /<stoptimeout>20 sec<\/stoptimeout>/);
  assert.match(xml, /<log mode="roll-by-size">/);
  assert.match(xml, /<env name="PRINT_AGENT_MODE" value="service"\/>/);
  const placeholders = ['{{NODE_EXE}}', '{{AGENT_SCRIPT}}', '{{INSTRUMENT_SCRIPT}}', '{{WORKING_DIR}}', '{{DATA_DIR}}', '{{LOG_DIR}}', '{{ENV_ENTRIES}}'];
  for (const placeholder of placeholders) {
    assert.ok(xml.includes(placeholder), `template must keep the ${placeholder} placeholder`);
  }
  // install-service.ps1 refuses to install if any {{TOKEN}} survives rendering,
  // so every token in the template must be one it knows how to replace.
  for (const token of new Set([...xml.matchAll(/\{\{[A-Z_]+\}\}/g)].map((match) => match[0]))) {
    assert.ok(placeholders.includes(token), `template token ${token} is not rendered by install-service.ps1`);
  }
  assert.ok(!/<password|<username/i.test(xml), 'the service definition must not contain credentials');
});

test('install script renders the template, sets SCM recovery and removes the legacy task', async () => {
  const script = await read('./service/install-service.ps1');
  assert.match(script, /OliTechsPrintAgent\.xml\.template/);
  for (const placeholder of ['{{NODE_EXE}}', '{{AGENT_SCRIPT}}', '{{INSTRUMENT_SCRIPT}}', '{{WORKING_DIR}}', '{{DATA_DIR}}', '{{LOG_DIR}}', '{{ENV_ENTRIES}}']) {
    assert.ok(script.includes(placeholder), `install script must render ${placeholder}`);
  }
  assert.match(script, /\$scExe = Join-Path \$systemRoot 'System32\\sc\.exe'/);
  assert.match(script, /'failure', \$ServiceId, 'reset=', '86400', 'actions=', 'restart\/5000\/restart\/15000\/restart\/60000'/);
  assert.match(script, /Start-Service -Name \$ServiceId/);
  assert.match(script, /Unregister-ScheduledTask -TaskName \$LegacyTaskName/);
  assert.match(script, /\$HealthUrl = "http:\/\/127\.0\.0\.1:\$ServicePort\/health"/);
  assert.match(script, /Invoke-RestMethod -Uri \$HealthUrl/);
  assert.ok(!/(Invoke-WebRequest|Start-BitsTransfer|DownloadFile|DownloadString)/i.test(script), 'the installer must not download and run code');
});

test('the installer never lets native stderr become a PowerShell terminating error', async () => {
  const script = await read('./service/install-service.ps1');
  assert.ok(!/2>&1/.test(script), 'native stderr must not be merged into the success stream');
  assert.ok(!/2>\$null/.test(script), 'use the native helper instead of redirecting stderr to $null');
  assert.ok(!/Start-Transcript/.test(script), 'a transcript hides native-command failures');
  assert.match(script, /function Invoke-NativeCommand/);
  assert.match(script, /RedirectStandardOutput/);
  assert.match(script, /RedirectStandardError/);
  assert.match(script, /Wait\s+=\s+\$true/);
  assert.match(script, /PassThru\s+=\s+\$true/);
  assert.match(script, /ExitCode\s+=\s+\$exitCode/);
});

test('each install stage has a stable exit code and writes install-result.json', async () => {
  const script = await read('./service/install-service.ps1');
  const expectedCodes = {
    10: 'template',
    11: 'node',
    12: 'winsw',
    13: 'elevation',
    14: 'port',
    15: 'stale-service',
    16: 'winsw-install',
    17: 'start',
    18: 'health',
    19: 'node-module',
    20: 'windows-version',
    21: 'disk',
    22: 'programdata',
    23: 'dotnet',
    24: 'legacy-task',
    25: 'unexpected',
  };
  for (const [code, stage] of Object.entries(expectedCodes)) {
    assert.match(script, new RegExp(`-Code ${code}\\b`), `missing exit code ${code}`);
    assert.match(script, new RegExp(`'${stage}'`), `missing stage ${stage}`);
  }
  assert.match(script, /install-result\.json/);
  assert.match(script, /function Write-InstallResult/);
  for (const field of ['stage', 'code', 'message', 'time', 'agentVersion', 'nodeVersion', 'powershellVersion', 'osVersion', 'logPath']) {
    assert.match(script, new RegExp(`\\b${field}\\s+=`), `result file must include ${field}`);
  }
  assert.match(script, /ConvertTo-Json -Depth 6/);
});

test('the unresolved placeholder guard runs after ENV_ENTRIES is rendered', async () => {
  const script = await read('./service/install-service.ps1');
  const renderAt = script.indexOf("$xml = $xml.Replace('{{ENV_ENTRIES}}', $envEntries)");
  const guardAt = script.indexOf("if ($xml -match '\\{\\{[A-Z_]+\\}\\}')");
  assert.ok(renderAt > -1, 'ENV_ENTRIES must be rendered');
  assert.ok(guardAt > -1, 'an unresolved placeholder guard must exist');
  assert.ok(guardAt > renderAt, 'the guard must run after ENV_ENTRIES is rendered');
});

test('preflight checks the machine before the service is registered', async () => {
  const script = await read('./service/install-service.ps1');
  assert.match(script, /function Test-Preflight/);
  assert.match(script, /IsInRole\(\[Security\.Principal\.WindowsBuiltInRole\]::Administrator\)/);
  assert.match(script, /OSVersion\.Version/);
  assert.match(script, /MinimumDotNetRelease = 394254/);
  assert.match(script, /function Get-FreeBytes/);
  assert.match(script, /MinimumFreeBytes = 200MB/);
  assert.match(script, /function Test-PortAvailable/);
  assert.match(script, /Get-NetTCPConnection -LocalPort \$Port/);
  assert.match(script, /Test-OliTechsAgentCommandLine/);
  assert.match(script, /function Test-NodeRuntime/);
  assert.match(script, /MinimumNodeMajor = 20/);
  assert.match(script, /MinimumNodeMinor = 6/);
  assert.match(script, /function Test-AgentModules/);
  assert.match(script, /import\('@sentry\/node'\)/);
  assert.match(script, /--check/);
});

test('health is a real gate, but an unpaired workstation is still healthy', async () => {
  const script = await read('./service/install-service.ps1');
  assert.match(script, /function Wait-AgentHealth/);
  assert.match(script, /\$health\.ok -eq \$true/);
  assert.match(script, /\$health\.paired/);
  assert.match(script, /-Stage 'health' -Code 18/);
  assert.ok(!/paired.*(Fail-Install|Code 18)/i.test(script), 'an unpaired agent is not a health failure');
  assert.match(script, /-Stage 'start' -Code 17/);
});

test('a failed registration is cleaned up and reruns are idempotent', async () => {
  const script = await read('./service/install-service.ps1');
  assert.match(script, /function Remove-ServiceBestEffort/);
  assert.match(script, /function Remove-ExistingService/);
  assert.match(script, /Stop-Service -Name \$ServiceId -Force/);
  assert.match(script, /'delete', \$ServiceId/);
  assert.match(script, /function Stop-OliTechsAgentProcesses/);
  assert.match(script, /Get-CimInstance -ClassName Win32_Process/);
  assert.match(script, /Removing the partially installed service/);
  assert.match(script, /Unregister-ScheduledTask -TaskName \$LegacyTaskName/);
  assert.match(script, /marked for deletion/);
});

test('start and health failures collect agent, SCM and event-log diagnostics', async () => {
  const script = await read('./service/install-service.ps1');
  assert.match(script, /function Write-ServiceDiagnostics/);
  assert.match(script, /agent\.log/);
  assert.match(script, /-Tail 50/);
  assert.match(script, /'query', \$ServiceId/);
  assert.match(script, /'qc', \$ServiceId/);
  assert.match(script, /Get-WinEvent/);
  assert.match(script, /Service Control Manager/);
  assert.match(script, /LogName = 'Application'/);
});


test('uninstall does not let native stderr become a terminating error', async () => {
  const script = await read('./service/uninstall-service.ps1');
  assert.match(script, /function Invoke-NativeSilently/);
  assert.match(script, /RedirectStandardOutput/);
  assert.match(script, /RedirectStandardError/);
  assert.ok(!/2>\$null/.test(script), 'native stderr must be captured, not redirected with 2>$null');
  assert.match(script, /service was not removed/);
});

test('uninstall keeps printer data unless deletion is explicitly requested', async () => {
  const script = await read('./service/uninstall-service.ps1');
  assert.match(script, /\[switch\]\$RemoveData/);
  assert.match(script, /if \(\$RemoveData\)/);
  assert.match(script, /Printer data and logs were kept/);
  assert.match(script, /Unregister-ScheduledTask -TaskName \$LegacyTaskName/);
});

test('npm entry points resolve to the service scripts', async () => {
  const pkg = JSON.parse(await read('../../package.json'));
  assert.match(pkg.scripts['print-agent:install'], /install-windows\.ps1/);
  assert.match(pkg.scripts['print-agent:service:install'], /service[\\/]install-service\.ps1/);
  assert.match(pkg.scripts['print-agent:service:uninstall'], /service[\\/]uninstall-service\.ps1/);
  assert.match(pkg.scripts['test:print-agent'], /server\.lifecycle\.test\.mjs/);
});

test('top-level installers delegate instead of duplicating service logic', async () => {
  assert.match(await read('./install-windows.ps1'), /service\\install-service\.ps1/);
  assert.match(await read('./uninstall-windows.ps1'), /service\\uninstall-service\.ps1/);
});

test('the agent entry point never swallows a failed start', async () => {
  const entry = await read('./print-agent-v2.js');
  assert.match(entry, /startPrintAgent/);
  assert.match(entry, /process\.exit\(1\)/);
});
