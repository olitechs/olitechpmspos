import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
const rootStart = css.indexOf(':root');
const rootOpen = css.indexOf('{', rootStart);
const rootClose = css.indexOf('}', rootOpen);
if (rootStart < 0 || rootClose < 0) throw new Error('Canonical :root token block is missing.');
const root = css.slice(rootOpen + 1, rootClose);
const tokens = Object.fromEntries([...root.matchAll(/--([\w-]+)\s*:\s*(#[\da-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2]]));

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
const checks = [
  ['body text on canvas', tokens.text, tokens.canvas],
  ['body text on surface', tokens.text, tokens.surface],
  ['muted text on canvas', tokens['text-muted'], tokens.canvas],
  ['muted text on surface', tokens['text-muted'], tokens.surface],
  ['primary text on surface', tokens.primary, tokens.surface],
  ['white primary-action text', '#FFFFFF', tokens.primary],
  ['success semantic text', tokens['success-text'], tokens['success-soft']],
  ['danger semantic text', tokens['danger-text'], tokens['danger-soft']],
  ['warning semantic text', tokens['warning-text'], tokens['warning-soft']],
  ['planner paid text', tokens.text, '#3FA77A'],
  ['planner deposit text', '#5A4310', '#F2C14E'],
  ['planner unpaid text', tokens.text, '#EE8A3C'],
];
let failures = 0;
for (const [label, foreground, background] of checks) {
  if (!foreground || !background) {
    console.error('FAIL ' + label + ': missing colour token');
    failures += 1;
    continue;
  }
  const value = contrast(foreground, background);
  const pass = value >= 4.5;
  console.log((pass ? 'PASS ' : 'FAIL ') + label + ': ' + value.toFixed(2) + ':1 (minimum 4.50:1)');
  if (!pass) failures += 1;
}
if (failures) process.exitCode = 1;
