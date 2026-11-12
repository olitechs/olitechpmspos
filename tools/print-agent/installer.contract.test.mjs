import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (relative) => readFile(new URL(relative, import.meta.url), 'utf8');

test('the installer needs administrator rights and targets modern 64-bit Windows', async () => {
  const iss = await read('./installer/OliTechsPrintAgent.iss');

  assert.ok(iss.includes('AppId={{7F1C2E44-9C3B-4B8E-9E51-3D2B8A6E5C11}'), 'a stable AppId is required for upgrades');
  assert.match(iss, /PrivilegesRequired=admin/);
  assert.match(iss, /ArchitecturesAllowed=x64compatible/);
  assert.match(iss, /ArchitecturesInstallIn64BitMode=x64compatible/);
  assert.match(iss, /MinVersion=10\.0/);
  assert.match(iss, /DefaultDirName=\{autopf\}\\OliTechs\\Print Agent/);
  assert.ok(
    iss.includes('Source: "{#SourceRoot}\\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs'),
    'the payload must be copied recursively into the app directory',
  );
});

test('the installer registers the service with the bundled runtime, not a system Node', async () => {
  const iss = await read('./installer/OliTechsPrintAgent.iss');

  assert.match(iss, /install-service\.ps1/);
  // The service step is built in [Code] so its exit code can be checked.
  assert.match(iss, /-NodeExe "' \+ ExpandConstant\('\{app\}\\node\\node\.exe'\)/);
  assert.match(iss, /-WinSWPath "' \+ ExpandConstant\('\{app\}\\service\\WinSW\.exe'\)/);
  assert.match(iss, /Flags: runhidden waituntilterminated/);
  assert.match(iss, /uninstall-service\.ps1/, 'uninstalling must remove the service');
});

test('staff are offered pairing in a window, never a terminal', async () => {
  const iss = await read('./installer/OliTechsPrintAgent.iss');
  const pairing = await read('./installer/pair-workstation.ps1');

  assert.match(iss, /pair-workstation\.ps1/);
  assert.match(iss, /postinstall runhidden waituntilterminated runasoriginaluser/);
  assert.match(iss, /Name: "\{group\}\\Pair this computer"/);
  assert.ok(!/cmd\.exe/i.test(iss), 'the installer must not open a command prompt');

  assert.match(pairing, /System\.Windows\.Forms/);
  assert.match(pairing, /MessageBox\]::Show/);
  assert.ok(!/Read-Host/.test(pairing), 'pairing input must use a dialog, not a console prompt');
  assert.match(pairing, /CharacterCasing = 'Upper'/);
  assert.match(pairing, /Invoke-RestMethod -Uri "\$base\/pair" -Method Post/);
  assert.match(pairing, /exit 0/);
  assert.match(pairing, /exit 1/);
  assert.match(pairing, /exit 2/, 'skipping pairing is a distinct outcome');
  assert.match(pairing, /exit 3/, 'an unreachable agent is a distinct outcome');
  assert.ok(!/Write-(Host|Output|Verbose)[^\r\n]*pairingCode/i.test(pairing), 'the pairing code must never be written out');
});

test('the installer runs the service scripts from the staged agent folder and stops the service before copying', async () => {
  const iss = await read('./installer/OliTechsPrintAgent.iss');

  // The payload keeps the repository layout: scripts are staged under
  // tools\print-agent\service, only WinSW.exe sits in {app}\service.
  assert.match(iss, /\{app\}\\tools\\print-agent\\service\\install-service\.ps1/);
  assert.match(iss, /\{app\}\\tools\\print-agent\\service\\uninstall-service\.ps1/);
  assert.doesNotMatch(iss, /\{app\}\\service\\install-service\.ps1/);
  assert.doesNotMatch(iss, /\{app\}\\service\\uninstall-service\.ps1/);

  // An upgrade replaces node.exe, which a running service holds open.
  assert.match(iss, /CurStep = ssInstall[\s\S]{0,80}StopExistingAgentService\(\)/);
  assert.match(iss, /sc\.exe stop OliTechsPrintAgent/);
  assert.match(iss, /function AgentServiceRunning\(\): Boolean/);
});

test('a failed service installation is reported to staff, and pairing is skipped', async () => {
  const iss = await read('./installer/OliTechsPrintAgent.iss');

  assert.match(iss, /ewWaitUntilTerminated, Code/);
  assert.match(iss, /if Code <> 0 then/);
  assert.match(iss, /ServiceInstallFailed := True/);
  assert.match(iss, /mbError, MB_OK/);
  assert.match(iss, /Printing will not work until this is fixed/);
  assert.match(iss, /Check: ServiceInstalledOk/);
  assert.match(iss, /function ServiceInstalledOk\(\): Boolean/);
});

test('no installer file mentions a service-role key', async () => {
  for (const file of ['./installer/OliTechsPrintAgent.iss', './installer/pair-workstation.ps1', './installer/build-installer.ps1']) {
    const source = await read(file);
    assert.ok(!/SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE|service_role_key/i.test(source), `${file} must not reference a service-role key`);
  }
});

test('the build refuses to produce a release installer without a signature', async () => {
  const build = await read('./installer/build-installer.ps1');

  assert.match(build, /signtool/);
  assert.match(build, /Get-AuthenticodeSignature/);
  assert.match(build, /if \(\$verification\.Status -ne 'Valid'\)/);
  assert.match(build, /Refusing to produce an unsigned release installer/);
  assert.match(build, /-UNSIGNED\.exe/);
  assert.match(build, /TimestampUrl = 'http:\/\/timestamp\.digicert\.com'/);
  assert.match(build, /\/tr \$TimestampUrl \/td SHA256/);
  assert.ok(!/Invoke-Expression/.test(build), 'build inputs must not be executed as code');
});

test('the build verifies the bundled runtime and the service wrapper', async () => {
  const build = await read('./installer/build-installer.ps1');

  assert.match(build, /Get-FileHash -Path \$NodeZipPath -Algorithm SHA256/);
  assert.match(build, /Node\.js runtime checksum mismatch/);
  assert.match(build, /https:\/\/nodejs\.org\/dist\/v\$NodeVersion\/node-v\$NodeVersion-win-x64\.zip/);
  assert.match(build, /Pass -WinSWPath with the WinSW\.exe/);
  assert.match(build, /A service-role reference was found in the payload/);
  assert.match(build, /Inno Setup 6 was not found/);
});

test('the installer payload mirrors the repository layout the agent imports from', async () => {
  const build = await read('./installer/build-installer.ps1');

  assert.match(build, /Join-Path \$PayloadRoot 'tools\\print-agent'/);
  assert.match(build, /Join-Path \$RepoRoot 'src\\services\\escposJob\.js'/);
  assert.match(build, /Filter '\*\.test\.mjs'/);
  assert.match(build, /agent-config\.json/);
});

test('pairing configuration is injected as environment entries, never credentials', async () => {
  const template = await read('./service/OliTechsPrintAgent.xml.template');
  const install = await read('./service/install-service.ps1');

  assert.ok(template.includes('{{ENV_ENTRIES}}'), 'the template must have a place for public configuration');
  assert.match(template, /<env name="PRINT_AGENT_DATA_DIR" value="\{\{DATA_DIR\}\}"\/>/);
  assert.ok(!/<password|<username/i.test(template));

  assert.match(install, /\[string\]\$NodeExe/);
  assert.match(install, /\$xml\.Replace\('\{\{ENV_ENTRIES\}\}', \$envEntries\)/);
  assert.match(install, /name=`"SUPABASE_URL`" value=`"\$escapedUrl`"/);
  assert.match(install, /VITE_SUPABASE_ANON_KEY/);
  assert.ok(!/service_role_key/i.test(install), 'the workstation installer must not accept a service-role key');
  assert.match(install, /Pairing:  available/, 'the installer must tell staff how to pair');
});
