import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = process.cwd();
const viteCli = resolve(root, 'node_modules/vite/bin/vite.js');
const restoreScript = resolve(root, 'scripts/restore-brand-assets.mjs');
const vite = spawn(process.execPath, [viteCli, ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' });
let receivedSignal = null;
let cleaned = false;

function finish(exitCode) {
  if (cleaned) return;
  cleaned = true;
  const restore = spawnSync(process.execPath, [restoreScript], { cwd: root, stdio: 'inherit' });
  if (restore.error) {
    console.error('Could not restore theme-placeholder brand assets:', restore.error.message);
    process.exitCode = 1;
    return;
  }
  process.exitCode = restore.status === 0 ? exitCode : (restore.status ?? 1);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    receivedSignal ??= signal;
    if (!vite.killed) vite.kill(signal);
  });
}

vite.once('error', (error) => {
  console.error('Could not start Vite:', error.message);
  finish(1);
});

vite.once('exit', (code, signal) => {
  const endedBy = receivedSignal || signal;
  const exitCode = endedBy === 'SIGINT' ? 130 : endedBy === 'SIGTERM' ? 143 : (code ?? 1);
  finish(exitCode);
});
