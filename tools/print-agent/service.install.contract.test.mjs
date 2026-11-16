import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (relative) => readFile(new URL(relative, import.meta.url), 'utf8');

test('service installation records every stage with timestamps and commands', async () => {
  const script = await read('./service/install-service.ps1');

  assert.match(script, /function Write-InstallLog/, 'a dedicated install log writer must exist');
  assert.match(script, /function Write-Stage/, 'stages must be labelled in the log');
  assert.match(script, /"Failed stage: \$Stage"/, 'the failed stage is recorded for the installer dialog');
  for (const stage of ["'start'", "'validate'", "'pre-clean'", "'configure'", "'register'", "'recovery'", "'legacy-cleanup'", "'health'", "'done'"]) {
    assert.ok(script.includes(stage), `missing stage: ${stage}`);
  }
  assert.match(script, /WinSW version check/, 'the WinSW version is recorded');
  assert.match(script, /Node\.js version check/, 'the Node.js version is recorded');
  assert.match(script, /Running: \{0\}/, 'each executed command is recorded');
  assert.match(script, /exit code: \{1\}/, 'each command exit code is recorded');
});

test('the diagnostic log path has no doubled backslashes', async () => {
  const script = await read('./service/install-service.ps1');
  const uninstall = await read('./service/uninstall-service.ps1');
  const iss = await read('./installer/OliTechsPrintAgent.iss');

  assert.doesNotMatch(script, /OliTechs\\\\PrintAgent/, 'install-service.ps1 must not double backslashes');
  assert.doesNotMatch(uninstall, /OliTechs\\\\PrintAgent/, 'uninstall-service.ps1 must not double backslashes');
  assert.doesNotMatch(iss, /\{commonappdata\}\\\\OliTechs/, 'the installer dialog must not show a doubled-backslash path');
});

test('reinstalling stops the agent fully and waits until Windows forgets the old registration', async () => {
  const script = await read('./service/install-service.ps1');

  assert.match(script, /Wait-ServiceState -ServiceName \$ServiceId -DesiredStates @\('STOPPED'\)/,
    'the stop must be awaited to the Stopped state, not a fixed sleep');
  assert.doesNotMatch(script, /Start-Sleep -Seconds 2/, 'no fixed sleep may replace waiting for the real service state');
  assert.match(script, /function Wait-ServiceGone/, 'removal must be confirmed, not assumed');
  assert.match(script, /marked for deletion|still holds the previous/i,
    'a pending deletion must produce an actionable recovery message');
  assert.match(script, /Restart Windows and run this installer again/i,
    'the recovery message must tell staff what to do');
});

test('the service registration is verified before recovery options and start-up', async () => {
  const script = await read('./service/install-service.ps1');

  assert.match(script, /function Wait-ServiceExists/, 'post-install verification must exist');
  const installIndex = script.indexOf("ArgumentList @('install')");
  const verifyIndex = script.indexOf('Wait-ServiceExists -ServiceName $ServiceId');
  const failureIndex = script.indexOf('sc.exe failure $ServiceId');
  const startIndex = script.indexOf('Start-Service -Name $ServiceId');
  assert.ok(installIndex >= 0 && verifyIndex > installIndex, 'the service must be verified right after WinSW install');
  assert.ok(failureIndex > verifyIndex, 'sc.exe failure must run only once Windows recognises the service');
  assert.ok(startIndex > failureIndex, 'the service must be started after the recovery policy is set');
});

test('a failed start is diagnosed and leaves no broken registration', async () => {
  const script = await read('./service/install-service.ps1');

  assert.match(script, /sc\.exe query \$ServiceId/, 'the reported state is captured on failure');
  assert.match(script, /sc\.exe qc \$ServiceId/, 'the service configuration is captured on failure');
  assert.match(script, /Latest agent wrapper log/, 'the agent wrapper log is surfaced on failure');
  assert.match(script, /Service Control Manager/, 'SCM events are captured on failure');
  assert.match(script, /ArgumentList @\('uninstall'\)/, 'the broken registration is rolled back');
  assert.match(script, /Configuration, pairing data and logs are kept/, 'rollback must not destroy customer data');
});

test('failure details are written for the installer dialog without leaking secrets', async () => {
  const script = await read('./service/install-service.ps1');

  assert.match(script, /install-last-error\.txt/, 'the companion error file is the dialog source');
  assert.match(script, /\[\^\\x20-\\x7E\]/, 'the companion file is sanitised to ASCII for the ANSI reader');
  assert.ok(!/Write-InstallLog[^r]*\$SupabaseAnonKey/.test(script), 'the anon key value is never written to the log');
  assert.ok(!/Write-Stage[^r]*\$SupabaseAnonKey/.test(script), 'the anon key value is never written to the log');
  assert.match(script, /values not logged/, 'the log explains why configuration values are omitted');
  assert.match(script, /Remove-Item -Path \$LastErrorPath/, 'a stale error file is cleared on success');
});

test('uninstall also waits for the real service states instead of a fixed sleep', async () => {
  const uninstall = await read('./service/uninstall-service.ps1');

  assert.match(uninstall, /Wait-ServiceState -ServiceName \$ServiceId -DesiredStates @\('STOPPED'\)/);
  assert.match(uninstall, /function Wait-ServiceGone/);
  assert.doesNotMatch(uninstall, /Start-Sleep -Seconds 2/, 'no fixed sleep may replace the real state check');
  assert.match(uninstall, /marked for deletion/i, 'a pending deletion is reported, not hidden');
  assert.match(uninstall, /Printer data and logs were kept/, 'uninstall keeps printer data unless explicitly removed');
});

test('the structured log is the single writer for install-service.log', async () => {
  const script = await read('./service/install-service.ps1');

  // An active transcript holds an exclusive write lock on the same log file:
  // in the released installer this silently swallowed the captured WinSW
  // output and turned even successful installs into "could not be installed
  // (exit code 1)". The structured logger must be the only writer.
  assert.doesNotMatch(script, /try \{ Start-Transcript/, 'no transcript may hold the log lock');
  assert.doesNotMatch(script, /Stop-Transcript/);
  assert.match(script, /New-Item -ItemType Directory -Force -Path \$InstallLogDir/,
    'the log directory is created before any stage can fail');
});

test('the installer dialog shows the failed stage and single-backslash log path', async () => {
  const iss = await read('./installer/OliTechsPrintAgent.iss');

  assert.match(iss, /function AgentServiceStoppedOrGone\(\): Boolean/,
    'the upgrade wait must accept only STOPPED or a removed registration');
  assert.match(iss, /findstr \/I "STOPPED"/, 'STOP_PENDING must not be mistaken for a stopped service');
  assert.match(iss, /install-last-error\.txt/, 'the dialog surfaces the failed stage from the companion file');
  assert.match(iss, /no manual cleanup is needed/, 'the dialog tells staff a rerun is safe');
  assert.match(iss, /\{commonappdata\}\\OliTechs\\PrintAgent\\logs\\install-service\.log/, 'the log path renders with single backslashes');
});
