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
  for (const placeholder of ['{{NODE_EXE}}', '{{AGENT_SCRIPT}}', '{{WORKING_DIR}}', '{{DATA_DIR}}', '{{LOG_DIR}}']) {
    assert.ok(xml.includes(placeholder), `template must keep the ${placeholder} placeholder`);
  }
  assert.ok(!/<password|<username/i.test(xml), 'the service definition must not contain credentials');
});

test('install script renders the template, sets SCM recovery and removes the legacy task', async () => {
  const script = await read('./service/install-service.ps1');
  assert.match(script, /OliTechsPrintAgent\.xml\.template/);
  for (const placeholder of ['{{NODE_EXE}}', '{{AGENT_SCRIPT}}', '{{WORKING_DIR}}', '{{DATA_DIR}}', '{{LOG_DIR}}']) {
    assert.ok(script.includes(placeholder), `install script must render ${placeholder}`);
  }
  assert.match(script, /sc\.exe failure \$ServiceId reset= 86400 actions= restart\/5000\/restart\/15000\/restart\/60000/);
  assert.match(script, /Start-Service -Name \$ServiceId/);
  assert.match(script, /Unregister-ScheduledTask -TaskName \$LegacyTaskName/);
  assert.match(script, /Invoke-RestMethod -Uri 'http:\/\/127\.0\.0\.1:8631\/health'/);
  assert.ok(!/Invoke-WebRequest[\s\S]*DownloadString/.test(script), 'the installer must not download and run code');
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
