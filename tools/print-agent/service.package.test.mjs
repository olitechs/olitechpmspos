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
  for (const placeholder of ['{{NODE_EXE}}', '{{AGENT_SCRIPT}}', '{{INSTRUMENT_SCRIPT}}', '{{WORKING_DIR}}', '{{DATA_DIR}}', '{{LOG_DIR}}']) {
    assert.ok(xml.includes(placeholder), `template must keep the ${placeholder} placeholder`);
  }
  assert.ok(!/<password|<username/i.test(xml), 'the service definition must not contain credentials');
});

test('the preload is a single --import=<url> argument so paths with spaces survive WinSW', async () => {
  const xml = await read('./service/OliTechsPrintAgent.xml.template');
  assert.match(xml, /<arguments>--import="\{\{INSTRUMENT_SCRIPT\}\}" "{{AGENT_SCRIPT}}"<\/arguments>/);
  // A quoted separate argument is split at the space decoded from %20 when the
  // install directory is "C:\Program Files\...", so Node exits before /health.
  assert.doesNotMatch(xml, /--import \{\{INSTRUMENT_SCRIPT\}\}/);
});

test('XML comments contain no double hyphen, which WinSW rejects', async () => {
  const xml = await read('./service/OliTechsPrintAgent.xml.template');
  const comments = [...xml.matchAll(/<!--[\s\S]*?-->/g)].map((match) => match[0]);
  assert.ok(comments.length > 0, 'the template must keep its explanatory comments');
  for (const comment of comments) {
    const body = comment.slice(4, -3);
    assert.ok(!body.includes('--'), `invalid XML comment content: ${body}`);
  }
});

test('install script renders the template, sets SCM recovery and removes the legacy task', async () => {
  const script = await read('./service/install-service.ps1');
  assert.match(script, /OliTechsPrintAgent\.xml\.template/);
  for (const placeholder of ['{{NODE_EXE}}', '{{AGENT_SCRIPT}}', '{{INSTRUMENT_SCRIPT}}', '{{WORKING_DIR}}', '{{DATA_DIR}}', '{{LOG_DIR}}']) {
    assert.ok(script.includes(placeholder), `install script must render ${placeholder}`);
  }
  assert.match(script, /sc\.exe failure \$ServiceId reset= 86400 actions= restart\/5000\/restart\/15000\/restart\/60000/);
  assert.match(script, /Start-Service -Name \$ServiceId/);
  assert.match(script, /Unregister-ScheduledTask -TaskName \$LegacyTaskName/);
  assert.match(script, /Invoke-RestMethod -Uri 'http:\/\/127\.0\.0\.1:8631\/health'/);
  assert.match(script, /function ConvertTo-FileUrl/);
  assert.match(script, /ConvertTo-FileUrl -Path \$InstrumentScript/);
  assert.ok(script.includes("$xml.Replace('{{AGENT_SCRIPT}}', $escape.Invoke($AgentScript))"), 'the main entry point stays a Windows path');
  assert.ok(!/ConvertTo-FileUrl -Path \$AgentScript/.test(script), 'the main entry point must not be rendered as a URL');
  assert.ok(!/Invoke-WebRequest[\s\S]*DownloadString/.test(script), 'the installer must not download and run code');
});

test('install logging uses the transcript instead of reopening the log file', async () => {
  const script = await read('./service/install-service.ps1');
  assert.match(script, /function Write-InstallLog/);
  assert.match(script, /if \(\$script:InstallTranscriptStarted\)[\s\S]*?Write-Host \$line/);
  const directOpens = script.match(/Out-File -FilePath \$InstallLogPath/g) || [];
  assert.equal(directOpens.length, 1, 'only the no-transcript fallback may open the log directly');
});

test('support can add one trusted app origin to an installed service', async () => {
  const script = await read('./service/set-allowed-origin.ps1');
  assert.match(script, /\[Parameter\(Mandatory = \$true\)\]\[string\]\$Origin/);
  assert.match(script, /Test-ExactHttpOrigin/);
  assert.match(script, /PRINT_AGENT_ALLOWED_ORIGINS/);
  assert.match(script, /Restart-Service -Name 'OliTechsPrintAgent'/);
  assert.match(script, /The allowed-origin entry was not saved/);
  assert.match(script, /Service config now allows/);
  assert.match(script, /health\.allowedOrigins/);
  assert.match(script, /New-Object System\.UriBuilder\(\$Origin\)/);
  assert.match(script, /StartsWith\('www\.'/);
  assert.ok(!/Remove-Item|Set-Service -StartupType Disabled/.test(script), 'the fix must not uninstall or disable the agent');
});

test('the support script keeps previously allowed origins when adding one', async () => {
  const script = await read('./service/set-allowed-origin.ps1');
  assert.match(script, /existingValue -split ','/);
  assert.match(script, /\$origins -notcontains \$value/);
  assert.match(script, /\$origins -join ','/);
  assert.match(script, /\[System\.Net\.WebUtility\]::HtmlDecode/);
  // SecurityElement has no Unescape() in Windows PowerShell 5.1.
  assert.doesNotMatch(script, /SecurityElement\]::Unescape/);
  assert.doesNotMatch(script, /Service config now allows: https:\/\/olitechpmspos\.vercel\.app, \$Origin/);
});

test('a fresh install allows every production app origin and both www/apex variants', async () => {
  const script = await read('./service/install-service.ps1');
  for (const origin of [
    'https://olitechpmspos.vercel.app',
    'https://www.olitechpmspos.vercel.app',
    'https://olitechs.co.ke',
    'https://www.olitechs.co.ke',
    'https://app.olitechs.co.ke',
  ]) {
    assert.ok(script.includes(`'${origin}'`), `installer must always allow ${origin}`);
  }
  assert.match(script, /New-Object System\.UriBuilder\(\$candidate\)/);
  assert.match(script, /StartsWith\('www\.'/);
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
