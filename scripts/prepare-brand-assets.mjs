import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const themeCss = readFileSync(join(root, 'src/index.css'), 'utf8');

function readColorToken(name) {
  const declaration = new RegExp(`--${name}\\s*:\\s*(#[\\da-f]{6})\\s*;`, 'i');
  const value = themeCss.match(declaration)?.[1];
  if (!value) throw new Error(`Missing canonical color token --${name} in src/index.css`);
  return value;
}

const colors = {
  BRAND_NAVY: readColorToken('deep-lagoon'),
  BRAND_BLUE: readColorToken('coastal-teal'),
  WHITE: readColorToken('white'),
  SOFT_WHITE: readColorToken('soft-white'),
};
const templateDir = join(root, 'tools/brand-assets');
const publicDir = join(root, 'public');
mkdirSync(publicDir, { recursive: true });

function buildTemplate(templateName, outputName, outputDir = publicDir) {
  let content = readFileSync(join(templateDir, templateName), 'utf8');
  for (const [key, value] of Object.entries(colors)) content = content.replaceAll(`{{${key}}}`, value);
  if (/\{\{[A-Z_]+\}\}/.test(content)) throw new Error(`Unresolved brand token in ${templateName}`);
  const outputPath = join(outputDir, outputName);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, content.trimEnd() + '\n');
}

buildTemplate('olitechs-logo.svg.in', 'olitechs-logo.svg');
buildTemplate('olitechs-logo.svg.in', 'olitechs-horizontal-light.svg', join(root, 'docs/assets'));
buildTemplate('app-icon.svg.in', 'app-icon.svg');
buildTemplate('favicon.svg.in', 'favicon.svg');
buildTemplate('manifest.json.in', 'manifest.json');
console.log('Generated OliTechs logo, documentation wordmark, icons and PWA manifest from src/index.css tokens.');
