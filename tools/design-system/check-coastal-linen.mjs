import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const css = readFileSync(join(root, 'src/index.css'), 'utf8');
const tailwind = readFileSync(join(root, 'tailwind.config.js'), 'utf8');
const lightTokens = [
  '--canvas:#F4F7F8', '--surface:#FFFFFF', '--sidebar:#E6EFF0', '--border:#C9D6DA',
  '--input-border:#7C9199', '--panel-head:#E6EFF0', '--text:#14232B', '--text-muted:#4F646D',
  '--primary:#0F7C86', '--on-primary:#FFFFFF', '--primary-hover:#0B6169',
  '--primary-text:#0B6169', '--primary-soft:#DDF0F1', '--accent:#9A5F2B',
  '--success:#1B7A57', '--success-soft:#E3F3EC', '--danger:#B42318',
  '--danger-soft:#FBE8E6', '--warning:#8F5400', '--warning-soft:#FBEFD9',
  '--info:#2A5AA7', '--info-soft:#E4EDF9', '--pay-none:#FC7F2C',
  '--pay-part:#E0CD29', '--pay-paid:#79AB3E', '--pay-opt:#3CB5AE',
];
const darkTokens = [
  '--canvas:#10171A', '--surface:#172126', '--sidebar:#131C20', '--border:#2C3B42',
  '--input-border:#5A6F77', '--panel-head:#1E2B31', '--text:#E3EBED', '--text-muted:#9DB0B8',
  '--primary:#137682', '--on-primary:#F2F8F9', '--primary-hover:#0E6A75',
  '--primary-text:#5CC6D0', '--primary-soft:#17353B', '--accent:#D4A06E',
  '--success:#4CC39A', '--success-soft:#143A2D', '--danger:#FF8A84',
  '--danger-soft:#3E1E1E', '--warning:#F0A56F', '--warning-soft:#3F2318',
  '--info:#8DB4F0', '--info-soft:#1A2E52', '--pay-none:#8F4118',
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
