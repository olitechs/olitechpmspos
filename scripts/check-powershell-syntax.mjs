import { spawnSync } from 'node:child_process';
import { platform } from 'node:os';
import { resolve } from 'node:path';

const candidates = platform() === 'win32' ? ['pwsh.exe', 'powershell.exe'] : ['pwsh', 'powershell'];
let shell = null;
for (const candidate of candidates) {
  const probe = spawnSync(candidate, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (!probe.error && probe.status === 0) {
    shell = candidate;
    break;
  }
}

if (!shell) {
  if (process.env.CI === 'true' && platform() === 'win32') {
    console.error('PowerShell is required in Windows CI but neither pwsh nor powershell is available.');
    process.exit(1);
  }
  console.log('SKIP: PowerShell syntax/encoding check (pwsh/powershell is not installed).');
  process.exit(0);
}

const checker = resolve('scripts/check-powershell-syntax.ps1');
const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', checker], {
  stdio: 'inherit',
  windowsHide: true,
});
if (result.error) {
  console.error(\`Could not launch \${shell}: \${result.error.message}\`);
  process.exit(1);
}
process.exit(result.status ?? 1);
