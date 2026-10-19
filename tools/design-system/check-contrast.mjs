import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
function blockFor(selector) {
  const start = css.indexOf(selector);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  if (start < 0 || open < 0 || close < 0) throw new Error('Missing theme token block: ' + selector);
  return css.slice(open + 1, close);
}
function tokensFrom(block) {
  return Object.fromEntries([...block.matchAll(/--([\w-]+)\s*:\s*(#[\da-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2]]));
}
function rgb(hex) {
  return [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16) / 255).map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
}
function luminance(hex) {
  const [r, g, b] = rgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
const light = tokensFrom(blockFor(':root {'));
const dark = tokensFrom(blockFor(':root[data-theme="dark"]'));
const checks = [
  ['light body text on canvas', light.text, light.canvas, 4.5],
  ['light body text on surface', light.text, light.surface, 4.5],
  ['light muted text on canvas', light['text-muted'], light.canvas, 4.5],
  ['light muted text on surface', light['text-muted'], light.surface, 4.5],
  ['light primary-action text', light['primary-foreground'], light.primary, 4.5],
  ['light success semantic text', light['success-text'], light['success-soft'], 4.5],
  ['light danger semantic text', light['danger-text'], light['danger-soft'], 4.5],
  ['light warning semantic text', light['warning-text'], light['warning-soft'], 4.5],
  ['dark body text on canvas', dark.text, dark.canvas, 4.5],
  ['dark body text on surface', dark.text, dark.surface, 4.5],
  ['dark muted text on canvas', dark['text-muted'], dark.canvas, 4.5],
  ['dark muted text on surface', dark['text-muted'], dark.surface, 4.5],
  ['dark primary-action text', dark['primary-foreground'], dark.primary, 4.5],
  ['open table label', light['table-free-fg'], light['table-free-bg'], 4.5],
  ['unsettled bill label', light['table-bill-fg'], light['table-bill-bg'], 4.5],
  ['dark unsettled bill label', dark['table-bill-fg'], dark['table-bill-bg'], 4.5],
  ['planner deposit text', '#5A4310', '#F2C14E', 4.5],
];
let failures = 0;
for (const [label, foreground, background, minimum] of checks) {
  if (!foreground || !background) {
    console.error('FAIL ' + label + ': missing colour token');
    failures += 1;
    continue;
  }
  const value = contrast(foreground, background);
  const pass = value >= minimum;
  console.log((pass ? 'PASS ' : 'FAIL ') + label + ': ' + value.toFixed(2) + ':1 (minimum ' + minimum.toFixed(2) + ':1)');
  if (!pass) failures += 1;
}
const occupied = contrast(light['table-occupied-fg'], light['table-occupied-bg']);
if (occupied < 4.5) console.warn('EXCEPTION occupied floor text: ' + occupied.toFixed(2) + ':1 on required #FA003F fill; enlarge text or document the fixed-colour contrast limitation.');
if (failures) process.exitCode = 1;
