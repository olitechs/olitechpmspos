import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

const root = process.cwd();
const sourceRoot = join(root, 'src');
const excludedFiles = new Set([
  'src/index.css', // canonical theme token definitions
  'src/components/settings/ReceiptPreview.jsx', // preserve printed receipt appearance
  'src/components/pos/PrintWarn.jsx', // printer/print warning output
  'src/components/ui/GoogleIcon.jsx', // third-party brand glyph colours
]);
const excludedDirectories = new Set([
  'src/assets',
  'src/generated',
]);
const extensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.css']);
const errors = [];
const patterns = [
  ['hex colour literal', /#[0-9a-fA-F]{3,8}\b/],
  ['rgb/rgba/hsl/hsla colour literal', /\b(?:rgba?|hsla?)\(\s*[-\d.]+/i],
  ['Tailwind palette colour class', /(?:^|[\s"'\x60])(?:bg|text|border|ring|fill|stroke|divide|outline|from|via|to)-(?:black|white|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-[\w/.[\]%-]+)?(?=$|[\s"'\x60])/],
  ['black/white utility class', /(?:^|[\s"'\x60])(?:text|bg)-(?:black|white)(?:\s|$|["'\x60])/],
  ['opacity-based text muting', /text-[\w:[\]%-]+(?:\s+[\w:[\]%-]+){0,8}\s+opacity-[0-9]{1,3}/],
];

function collectFiles(directory) {
  const results = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    const path = relative(root, absolute).split(sep).join('/');
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(path)) results.push(...collectFiles(absolute));
      continue;
    }
    if (entry.isFile() && extensions.has(extname(entry.name)) && !excludedFiles.has(path)) {
      results.push({ path, absolute });
    }
  }
  return results;
}

for (const { path, absolute } of collectFiles(sourceRoot)) {
  const content = readFileSync(absolute, 'utf8');
  for (const [label, pattern] of patterns) {
    if (pattern.test(content)) errors.push(path + ': ' + label);
  }
}

if (errors.length) {
  console.error('Colour-token guard failed (' + errors.length + ' finding(s)):\n' + errors.map((e) => '- ' + e).join('\n'));
  process.exitCode = 1;
} else {
  console.log('Colour-token guard passed for active src files.');
}
