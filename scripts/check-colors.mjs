import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

const root = process.cwd();
const errors = [];
const extensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.css', '.html', '.svg', '.json', '.mjs', '.in']);
const colorAuditExemptions = new Set([
  'public/olitechs-logo.svg',
  'public/app-icon.svg',
  'public/favicon.svg',
  'public/manifest.json',
]);
const roots = ['src', 'public', 'tools/brand-assets', 'tools/print-agent', 'supabase/functions'];
const files = [];

function collect(directory) {
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    const absolute = join(root, directory, entry.name);
    const path = relative(root, absolute).split(sep).join('/');
    if (entry.isDirectory()) {
      collect(path);
      continue;
    }
    if (entry.isFile() && extensions.has(extname(entry.name)) && !colorAuditExemptions.has(path)) files.push({ path, absolute });
  }
}

for (const directory of roots) collect(directory);
files.push({ path: 'index.html', absolute: join(root, 'index.html') });
files.push({ path: 'tailwind.config.js', absolute: join(root, 'tailwind.config.js') });
files.push({ path: 'README.md', absolute: join(root, 'README.md') });
files.push({ path: 'Design.md', absolute: join(root, 'Design.md') });

const patterns = [
  ['hex color literal', /#[0-9a-fA-F]{3,8}\b/],
  ['rgb/hsl color literal', /\b(?:rgba?|hsla?)\(\s*[-\d.]+/i],
  ['Tailwind palette color utility', /(?<![\w-])(?:(?:[a-z-]+):)*(?:bg|text|border|ring|fill|stroke|divide|outline|from|via|to|accent)-(?:black|white|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-[\w/.[\]%-]+)?(?![\w-])/],
  ['literal black/white CSS color', /(?:^|[;{\s])(?:color|background(?:-color)?|border(?:-color)?|fill|stroke)\s*:\s*['"]?(?:black|white)\b/i],
];

for (const { path, absolute } of files) {
  if (path === 'src/index.css') continue;
  const content = readFileSync(absolute, 'utf8');
  for (const [label, pattern] of patterns) {
    if (pattern.test(content)) errors.push(`${path}: ${label}`);
  }
}

const css = readFileSync(join(root, 'src/index.css'), 'utf8');
const themeValues = new Set((css.match(/#[0-9a-fA-F]{3,8}\b/g) || []).map((value) => value.toUpperCase()));
if (themeValues.size !== 17) errors.push(`src/index.css: expected 17 approved unique canonical color values, found ${themeValues.size}`);
const definedTokens = new Set([...css.matchAll(/--([\w-]+)\s*:/g)].map((match) => match[1]));
const tokenSources = [{ path: 'src/index.css', content: css }, ...files.map(({ path, absolute }) => ({ path, content: readFileSync(absolute, 'utf8') }))];
for (const { path, content } of tokenSources) {
  for (const match of content.matchAll(/var\(\s*--([\w-]+)/g)) {
    if (!definedTokens.has(match[1]) && !match[1].startsWith('radix-')) {
      errors.push(`${path}: unresolved CSS token --${match[1]}`);
    }
  }
}

if (errors.length) {
  console.error(`Color-token audit failed (${errors.length} finding(s)):\n${errors.map((error) => '- ' + error).join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`Color-token audit passed: ${files.length} active source/template files; color literals are confined to src/index.css.`);
}
