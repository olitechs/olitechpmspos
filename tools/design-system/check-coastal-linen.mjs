import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const css = readFileSync(join(root, 'src/index.css'), 'utf8');
const required = [
  '--canvas: #F4F7F8', '--surface: #FFFFFF', '--sidebar: #E6EFF0',
  '--primary: #0F7C86', '--primary-hover: #0B6169', '--primary-soft: #DDF0F1',
  '--primary-foreground: #FFFFFF', '--accent: #C98A52', '--text: #14232B',
  '--text-muted: #566A73', '--border: #DCE5E8', '--floor-bg: #D7D7D7',
  '--table-free-bg: #74C365', '--table-occupied-bg: #FA003F', '--table-bill-bg: #FAFAFA',
];
const darkRequired = [
  '--canvas:#0E1417', '--surface:#151D21', '--sidebar:#11191C',
  '--primary:#2BB3BF', '--primary-hover:#4CC7D1', '--primary-soft:#12343A',
  '--text:#E6EEF0', '--text-muted:#93A5AD', '--border:#26343A', '--floor-bg:#1B2327',
];
const errors = [];
for (const token of required) if (!css.includes(token)) errors.push('Missing canonical token: ' + token);
if (!/:root\[data-theme="dark"\]\s*\{/.test(css)) errors.push('Dark theme token block is missing.');
for (const token of darkRequired) if (!css.includes(token)) errors.push('Missing dark token: ' + token);
const lightRootStart = css.indexOf(':root {');
const darkRootStart = css.indexOf(':root[data-theme="dark"]');
const componentsStart = css.indexOf('@layer components');
const globalTokens = css.slice(lightRootStart, darkRootStart);
if (/--pay-(?:paid|deposit|unpaid|none|partial|total)\s*:/.test(globalTokens)) errors.push('Payment token is global; it must be scoped to .room-planner.');
if (!/\.room-planner\s*\{[^}]*--pay-paid/.test(css)) errors.push('Room Planner payment tokens are not scoped under .room-planner.');
if (componentsStart < 0) errors.push('CSS component layer is missing.');

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { walk(path); continue; }
    if (!/\.(jsx?|tsx?)$/.test(entry.name)) continue;
    const rel = relative(root, path).replaceAll('\\\\', '/');
    if (rel.startsWith('src/components/pms/RoomPlanner') || /Receipt|Print|Thermal/i.test(rel)) continue;
    if (readFileSync(path, 'utf8').includes('var(--pay-')) errors.push('Payment token outside Room Planner: ' + rel);
  }
}
walk(join(root, 'src'));
if (errors.length) {
  console.error('Theme token contract failed:\\n' + errors.map((e) => '- ' + e).join('\\n'));
  process.exitCode = 1;
} else console.log('Light/dark token contract, floor colours and Room Planner payment scope passed.');
