import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const css = readFileSync(join(root, 'src/index.css'), 'utf8');
const tailwind = readFileSync(join(root, 'tailwind.config.js'), 'utf8');
const provider = readFileSync(join(root, 'src/theme/ThemeProvider.jsx'), 'utf8');
const design = readFileSync(join(root, 'Design.md'), 'utf8');
const master = readFileSync(join(root, 'design-system/olitechs-pms-pos/MASTER.md'), 'utf8');
const errors = [];

/**
 * The approved OliTechs brand block. Exact values are fixed by the product
 * owner; this gate fails if any of them drifts. --deep-lagoon and
 * --coastal-teal are the approved historical token names for navy and blue.
 */
const requiredTokens = [
  ['--brand-navy', '#101A35'],
  ['--brand-blue', '#285FE7'],
  ['--brand-blue-hover', '#174AC8'],
  ['--brand-blue-soft', '#F3F7FF'],
  ['--brand-canvas', '#F8FAFF'],
  ['--brand-white', '#FFFFFF'],
  ['--deep-lagoon', '#101A35'],
  ['--coastal-teal', '#285FE7'],
  ['--white', '#FFFFFF'],
  ['--soft-white', '#F8FAFF'],
  ['--canvas', '#F8FAFF'],
  ['--sidebar', '#EEF3FC'],
  ['--text', '#101A35'],
  ['--accent', '#E8955A'],
  ['--status-paid', '#3FA77A'],
  ['--status-deposit-paid', '#F2C14E'],
  ['--status-deposit-foreground', '#5A4310'],
  ['--status-not-paid', '#EE8A3C'],
  ['--room-occupied', '#2F6F9F'],
  ['--room-checkout', '#3949AB'],
  ['--room-out-of-order', '#65727A'],
  ['--print-ink', '#000000'],
  ['--print-void', '#DC2626'],
];

for (const [name, value] of requiredTokens) {
  const declaration = new RegExp(`${name}\\s*:\\s*${value}\\s*;`, 'i');
  if (!declaration.test(css)) errors.push(`Canonical token ${name} must be ${value}.`);
}

const expectedColors = new Set(requiredTokens.map(([, value]) => value.toUpperCase()));
const actualColors = new Set((css.match(/#[0-9a-fA-F]{3,8}\b/g) || []).map((value) => value.toUpperCase()));
if (actualColors.size !== expectedColors.size || [...actualColors].some((value) => !expectedColors.has(value))) {
  errors.push(`src/index.css must use only the ${expectedColors.size} approved OliTechs brand and status colors.`);
}
if (/\[data-theme=["']dark|color-scheme\s*:\s*dark|\.dark\b/.test(css + provider)) {
  errors.push('Dark theme selectors must not be present in the active theme or provider.');
}
if (!/darkMode\s*:\s*["']class["']/.test(tailwind)) {
  errors.push('Tailwind must use class-only dark activation so system dark mode cannot affect the light UI.');
}
if (!provider.includes("root.setAttribute('data-theme', 'light')") || provider.includes('prefers-color-scheme')) {
  errors.push('ThemeProvider must enforce a fixed light appearance without system-mode detection.');
}
if (!css.includes('--primary: var(--coastal-teal)') || !css.includes('--on-primary: var(--white)')) {
  errors.push('Primary and primary-foreground aliases must use the official brand blue/white tokens.');
}
if (!css.includes('--primary-hover: var(--brand-blue-hover)')) {
  errors.push('Primary hover must use the approved --brand-blue-hover value.');
}
if (!css.includes('--pay-none: var(--status-not-paid)') || !css.includes('--pay-part: var(--status-deposit-paid)') || !css.includes('--pay-paid: var(--status-paid)')) {
  errors.push('Payment status compatibility tokens must map to the mandated paid/deposit/not-paid colors.');
}
if (!css.includes('--room-clean: var(--status-paid)') || !css.includes('--room-dirty: var(--status-deposit-paid)')) {
  errors.push('Vacant clean/dirty room states must use green/amber status tokens.');
}
if (!css.includes('--room-out-of-order-stripe: repeating-linear-gradient(135deg')) {
  errors.push('Out-of-order rooms must retain a diagonal gray stripe treatment.');
}
if (!design.includes('light-only') || !design.includes('src/index.css')) errors.push('Design.md must document the light-only single-token-file contract.');
if (!/--brand-navy/.test(design) || !/--brand-blue/.test(design)) errors.push('Design.md must document the approved OliTechs navy/blue brand tokens.');
if (/Coastal Linen|Coastal Teal|Deep Lagoon/.test(design)) errors.push('Design.md still describes the retired "Coastal Linen" naming.');
if (/Choose light, dark|Dark palette|enable system-color-mode listener|support both light and dark/.test(design)) {
  errors.push('Design.md still describes a selectable/dark theme.');
}
if (/Coastal Linen/.test(master)) errors.push('MASTER.md still describes the retired "Coastal Linen" naming.');

if (errors.length) {
  console.error('OliTechs brand contract failed:\n' + errors.map((error) => '- ' + error).join('\n'));
  process.exitCode = 1;
} else {
  console.log('OliTechs navy/blue light-only tokens, payment/room status semantics and Tailwind mappings passed.');
}
