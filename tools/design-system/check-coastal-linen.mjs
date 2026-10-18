import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const css = readFileSync(join(root, 'src/index.css'), 'utf8');
const required = [
  '--canvas: #F6F9F9',
  '--surface: #FFFFFF',
  '--sidebar: #EAF3F3',
  '--primary: #0F7C86',
  '--primary-hover: #0C6870',
  '--primary-soft: #DDF0F1',
  '--accent: #E8955A',
  '--text: #223039',
  '--text-muted: #6B7C85',
  '--border: #E1EAEC',
];
const errors = [];
for (const token of required) {
  if (!css.includes(token)) errors.push('Missing canonical token: ' + token);
}
if (css.includes('[data-theme="dark"]') || css.includes('.dark {')) {
  errors.push('Dark theme selector remains in src/index.css.');
}

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(path);
      continue;
    }
    if (!/\.(jsx?|tsx?)$/.test(entry.name)) continue;
    const rel = relative(root, path).replaceAll('\\\\', '/');
    if (rel.startsWith('src/components/pms/RoomPlanner') || /Receipt|Print|Thermal/i.test(rel)) continue;
    const source = readFileSync(path, 'utf8');
    if (source.includes('var(--pay-')) errors.push('Payment token outside Room Planner: ' + rel);
  }
}
walk(join(root, 'src'));
if (errors.length) {
  console.error('Coastal Linen theme checks failed:\\n' + errors.map((e) => '- ' + e).join('\\n'));
  process.exitCode = 1;
} else {
  console.log('Coastal Linen canonical tokens and payment-token scope passed.');
}
