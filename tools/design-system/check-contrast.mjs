import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

function extractBlock(marker) {
  const start = css.indexOf(marker);
  if (start < 0) throw new Error(`Theme block not found: ${marker}`);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`Unclosed theme block: ${marker}`);
}

function tokensFrom(block) {
  return Object.fromEntries([...block.matchAll(/--([\w-]+)\s*:\s*(#[\da-fA-F]{3,8})\s*;/g)].map(match => [match[1], match[2]]));
}

function rgb(hex) {
  let value = hex.slice(1);
  if (value.length === 3) value = value.split('').map(char => char + char).join('');
  if (value.length !== 6) throw new Error(`Unsupported color token: ${hex}`);
  return [0, 2, 4].map(offset => parseInt(value.slice(offset, offset + 2), 16) / 255).map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
}

function contrast(first, second) {
  const a = rgb(first);
  const b = rgb(second);
  const luminance = color => 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const themes = [
  ['light', tokensFrom(extractBlock(':root'))],
  ['dark', tokensFrom(extractBlock('[data-theme="dark"]'))],
];
const checks = [
  ['body text on background', 'text', 'bg', 4.5],
  ['body text on surface', 'text', 'surface', 4.5],
  ['muted text on background', 'muted', 'bg', 4.5],
  ['action text on action', 'action-text', 'action', 4.5],
  ['success text on surface', 'success-text', 'surface', 4.5],
  ['warning text on surface', 'warning-text', 'surface', 4.5],
  ['info on surface', 'info', 'surface', 4.5],
  ['danger on surface', 'danger', 'surface', 4.5],
];

let failures = 0;
for (const [theme, tokens] of themes) {
  for (const [label, foreground, background, minimum] of checks) {
    const fg = tokens[foreground];
    const bg = tokens[background];
    if (!fg || !bg) {
      console.error(`FAIL ${theme}: missing token ${!fg ? foreground : background}`);
      failures += 1;
      continue;
    }
    const ratio = contrast(fg, bg);
    const passed = ratio >= minimum;
    console.log(`${passed ? 'PASS' : 'FAIL'} ${theme}: ${label} ${ratio.toFixed(2)}:1 (minimum ${minimum}:1)`);
    if (!passed) failures += 1;
  }
}
if (failures) process.exitCode = 1;
