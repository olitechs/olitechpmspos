import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const files = [
  'src/components/layout/TopAppNav.jsx',
  'src/components/shell/Sidebar.jsx',
  'src/components/layout/AppShell.jsx',
  'src/components/shell/TopBar.jsx',
];
const excluded = [
  'src/index.css',
  'src/components/settings/ReceiptPreview.jsx',
  'src/components/pos/PrintWarn.jsx',
  'src/components/ui/GoogleIcon.jsx',
];
const errors = [];
const patterns = [
  ['hex colour literal', /#[0-9a-fA-F]{3,8}\b/],
  ['rgb/rgba/hsl/hsla colour literal', /\b(?:rgba?|hsla?)\(\s*[-\d.]+/i],
  ['Tailwind palette colour class', /(?:^|[\s"'\x60])(?:bg|text|border|ring|fill|stroke|divide|outline|from|via|to)-(?:black|white|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-[\w/.[\]%-]+)?(?=$|[\s"'\x60])/],
  ['black/white utility class', /(?:^|[\s"'\x60])(?:text|bg)-(?:black|white)(?:\s|$|["'\x60])/],
  ['opacity-based text muting', /(?:text-[\w:[\]%-]+\s+)?opacity-(?:[0-9]{1,3})(?=\s|$|["'\x60])/],
];
for (const file of files) {
  if (excluded.includes(file) || !existsSync(join(root, file))) continue;
  const content = readFileSync(join(root, file), 'utf8');
  for (const [label, pattern] of patterns) {
    if (pattern.test(content)) errors.push(file + ': ' + label);
  }
}
if (errors.length) {
  console.error('Colour-token guard failed:\n' + errors.map((e) => '- ' + e).join('\n'));
  process.exitCode = 1;
} else {
  console.log('Colour-token guard passed for shared navigation and shell components.');
}
