import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const css = readFileSync(join(root, 'src/index.css'), 'utf8');
const tailwind = readFileSync(join(root, 'tailwind.config.js'), 'utf8');
const lightTokens = [
  '--canvas:#E3F2FD', '--surface:#FFFFFF', '--sidebar:#EAF4FD', '--border:#B8D7F2',
  '--input-border:#6F9FC7', '--panel-head:#E3F2FD', '--text:#123B63', '--text-muted:#456987',
  '--primary:#2196F3', '--on-primary:#062C50', '--primary-hover:#0D47A1',
  '--primary-text:#0D47A1', '--primary-soft:#E3F2FD', '--accent:#90CAF9',
  '--success:#1B7A57', '--success-soft:#E3F3EC', '--danger:#B42318',
  '--danger-soft:#FBE8E6', '--warning:#8F5400', '--warning-soft:#FBEFD9',
  '--info:#0D47A1', '--info-soft:#E3F2FD', '--pay-none:#FC7F2C',
  '--pay-part:#E0CD29', '--pay-paid:#79AB3E', '--pay-opt:#3CB5AE',
];
const darkTokens = [
  '--canvas:#0B1726', '--surface:#12243A', '--sidebar:#102D4C', '--border:#2C4F70',
  '--input-border:#6F91B1', '--panel-head:#173653', '--text:#EAF4FD', '--text-muted:#B4CDE3',
  '--primary:#0D47A1', '--on-primary:#FFFFFF', '--primary-hover:#2196F3',
  '--primary-text:#90CAF9', '--primary-soft:#153B5C', '--accent:#90CAF9',
  '--success:#4CC39A', '--success-soft:#143A2D', '--danger:#FF8A84',
  '--danger-soft:#3E1E1E', '--warning:#F0A56F', '--warning-soft:#3F2318',
  '--info:#90CAF9', '--info-soft:#153B5C', '--pay-none:#8F4118',
  '--pay-part:#7A5A10', '--pay-paid:#33591C', '--pay-opt:#17524F',
];
const errors = [];
for (const token of lightTokens) if (!css.includes(token)) errors.push('Missing light theme token: ' + token);
if (!css.includes(':root[data-theme="dark"] {')) errors.push('Dark theme token block is missing.');
for (const token of darkTokens) if (!css.includes(token)) errors.push('Missing dark theme token: ' + token);
if (!css.includes('color-scheme:dark')) errors.push('Dark theme must set the native control colour scheme.');
if (!css.includes('body { margin:0; background:var(--canvas); color:var(--text);')) errors.push('Body must use canonical canvas and text tokens.');
if (!css.includes('--primary-foreground:var(--on-primary)')) errors.push('Primary foreground must alias the separate on-primary token.');
if (!tailwind.includes("darkMode: ['class']")) errors.push('Tailwind dark mode must remain class-based.');
if (!tailwind.includes("background: 'var(--background)'") || !tailwind.includes("border: 'var(--border)'")) errors.push('Tailwind/shadcn semantic mappings are incomplete.');
if (!/\.room-planner\s*\{[^}]*--pay-unpaid:var\(--pay-none\)/.test(css)) errors.push('Room Planner payment compatibility aliases are missing.');

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { walk(path); continue; }
    if (!/\.(jsx?|tsx?)$/.test(entry.name)) continue;
    const rel = relative(root, path).replaceAll('\\\\', '/');
    if (rel.startsWith('src/components/pms/RoomPlanner') || /Receipt|Print|Thermal/i.test(rel)) continue;
    if (readFileSync(path, 'utf8').includes('var(--pay-')) errors.push('Planner payment token referenced outside Room Planner: ' + rel);
  }
}
walk(join(root, 'src'));
if (errors.length) {
  console.error('Light/dark design-token contract failed:\\n' + errors.map((e) => '- ' + e).join('\\n'));
  process.exitCode = 1;
} else console.log('Light/dark design tokens, theme mode and Tailwind/shadcn mappings passed.');
