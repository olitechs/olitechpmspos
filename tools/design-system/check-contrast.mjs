import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const css = readFileSync(resolve(root, 'src/index.css'), 'utf8');
const declarations = new Map();
for (const match of css.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
  if (!declarations.has(match[1])) declarations.set(match[1], match[2].trim());
}

function resolveToken(name, seen = new Set()) {
  if (seen.has(name)) return null;
  seen.add(name);
  const value = declarations.get(name);
  if (!value) return null;
  const alias = value.match(/^var\(--([\w-]+)\)$/);
  if (alias) return resolveToken(alias[1], seen);
  const literal = value.match(/^#[\da-fA-F]{6}$/);
  if (literal) return value;
  const mix = value.match(/^color-mix\(in srgb,\s*var\(--([\w-]+)\)\s+([\d.]+)%,\s*var\(--([\w-]+)\)\s*\)$/);
  if (mix) return mixHex(resolveToken(mix[1], seen), resolveToken(mix[3], seen), Number(mix[2]) / 100);
  return null;
}
function mixHex(foreground, background, strength) {
  if (!foreground || !background) return null;
  const channels = [1, 3, 5].map((index) => {
    const front = parseInt(foreground.slice(index, index + 2), 16);
    const back = parseInt(background.slice(index, index + 2), 16);
    return Math.round(front * strength + back * (1 - strength)).toString(16).padStart(2, '0');
  });
  return '#' + channels.join('');
}
function luminance(hex) {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
function contrast(foreground, background) {
  if (!foreground || !background) return null;
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

const white = resolveToken('white');
const checks = [
  ['body text / canvas', 'text', 'canvas', 4.5],
  ['body text / surface', 'text', 'surface', 4.5],
  ['muted text / canvas', 'text-muted', 'canvas', 4.5],
  ['white / primary button', 'on-primary', 'primary', 4.5],
  ['deposit-paid text / fill', 'status-deposit-foreground', 'status-deposit-paid', 4.5],
  ['vacant-clean text / fill', 'room-clean-foreground', 'room-clean', 4.5],
  ['vacant-dirty text / fill', 'room-dirty-foreground', 'room-dirty', 4.5],
  ['occupied-room text / fill', 'room-occupied-foreground', 'room-occupied', 4.5],
  ['checkout-room text / fill', 'room-checkout-foreground', 'room-checkout', 4.5],
  ['out-of-order text / gray', 'room-out-of-order-foreground', 'room-out-of-order', 4.5],
];
let failures = 0;
for (const [label, foregroundToken, backgroundToken, minimum] of checks) {
  const value = contrast(resolveToken(foregroundToken), resolveToken(backgroundToken));
  if (value === null) {
    console.error(`FAIL ${label}: missing or unsupported CSS token.`);
    failures += 1;
  } else if (value < minimum) {
    console.error(`FAIL ${label}: ${value.toFixed(2)}:1 (minimum ${minimum.toFixed(2)}:1).`);
    failures += 1;
  } else {
    console.log(`PASS ${label}: ${value.toFixed(2)}:1.`);
  }
}

for (const [label, token] of [['Paid white text', 'status-paid'], ['Not-paid white text', 'status-not-paid']]) {
  const value = contrast(white, resolveToken(token));
  if (value === null) {
    console.error(`FAIL ${label}: missing required fill token.`);
    failures += 1;
  } else if (value < 4.5) {
    console.warn(`EXCEPTION ${label}: ${value.toFixed(2)}:1 is below WCAG AA normal text because the required brand/status fill and white foreground are fixed by specification. Keep the status label explicit and bold; do not alter the mandated colors.`);
  } else {
    console.log(`PASS ${label}: ${value.toFixed(2)}:1.`);
  }
}

const floorPlan = readFileSync(resolve(root, 'src/components/pos/FloorPlan.jsx'), 'utf8');
if (!floorPlan.includes('statusMeta.label')) {
  console.error('FAIL room/table status labels: include text labels in addition to color.');
  failures += 1;
} else {
  console.log('PASS room/table status has a text label in addition to color.');
}
if (failures) process.exitCode = 1;
