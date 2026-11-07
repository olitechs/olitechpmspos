import { copyFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const assets = [
  ['tools/brand-assets/olitechs-logo.svg.in', 'public/olitechs-logo.svg'],
  ['tools/brand-assets/app-icon.svg.in', 'public/app-icon.svg'],
  ['tools/brand-assets/favicon.svg.in', 'public/favicon.svg'],
  ['tools/brand-assets/manifest.json.in', 'public/manifest.json'],
  ['tools/brand-assets/olitechs-logo.svg.in', 'docs/assets/olitechs-horizontal-light.svg'],
];

for (const [template, target] of assets) copyFileSync(join(root, template), join(root, target));
console.log('Restored OliTechs brand assets to token-placeholder templates.');
