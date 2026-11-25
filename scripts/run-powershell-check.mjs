// Cross-platform entry point for the Windows PowerShell syntax/encoding check.
//
// Windows: runs the check with Windows PowerShell 5.1, because that is the host
// that executes the installer scripts when Inno Setup calls `powershell.exe`.
// Other platforms: skips with a clear message, unless PRINT_AGENT_REQUIRE_POWERSHELL=1.
// CI on Windows requires the check: a missing Windows PowerShell is a failure.
//
// Usage: node scripts/run-powershell-check.mjs
// Exit code 0 = clean or intentionally skipped; 1 = check failed.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECK_SCRIPT = path.join(HERE, 'check-powershell-syntax.ps1');
const REQUIRED_BY_ENV = process.env.PRINT_AGENT_REQUIRE_POWERSHELL === '1';
const IS_CI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
const REQUIRED = REQUIRED_BY_ENV || (process.platform === 'win32' && IS_CI);

if (!fs.existsSync(CHECK_SCRIPT)) {
  console.error(`PowerShell syntax check failed: ${CHECK_SCRIPT} is missing.`);
  process.exit(1);
}

if (process.platform !== 'win32') {
  if (REQUIRED_BY_ENV) {
    console.error(
      'PowerShell syntax check failed: PRINT_AGENT_REQUIRE_POWERSHELL=1 but this is not Windows.',
    );
    process.exit(1);
  }
  console.log(
    'PowerShell syntax check skipped: Windows PowerShell is not available on this platform.',
  );
  process.exit(0);
}

const systemRoot = process.env.SystemRoot || 'C:\\Windows';
const bundledPowerShell = path.join(
  systemRoot,
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
);
const executable = fs.existsSync(bundledPowerShell) ? bundledPowerShell : 'powershell.exe';

const result = spawnSync(
  executable,
  [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    CHECK_SCRIPT,
    '-Require',
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit' },
);

if (result.error) {
  const message = `Windows PowerShell 5.1 could not be started: ${result.error.message}`;
  if (REQUIRED) {
    console.error(`PowerShell syntax check failed: ${message}`);
    process.exit(1);
  }
  console.log(`PowerShell syntax check skipped: ${message}`);
  process.exit(0);
}

process.exit(result.status === null ? 1 : result.status);
