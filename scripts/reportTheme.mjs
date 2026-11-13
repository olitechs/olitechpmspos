import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const THEME_PATH = join(SCRIPT_DIR, '../src/index.css');
const TOKEN_MAP = Object.freeze({
  navy: '--brand-navy',
  blue: '--brand-blue',
  white: '--white',
  softWhite: '--soft-white',
  sidebar: '--sidebar',
  text: '--text',
  accent: '--accent',
  success: '--status-paid',
  danger: '--status-not-paid',
});

export async function readDocumentTheme(cssPath = THEME_PATH) {
  const css = await readFile(cssPath, 'utf8');
  const theme = {};
  for (const [key, token] of Object.entries(TOKEN_MAP)) {
    const value = css.match(new RegExp(`${token}\\s*:\\s*(#[0-9a-f]{3,8})\\b`, 'i'))?.[1];
    if (!value) throw new Error(`Missing canonical brand token ${token} in ${cssPath}`);
    theme[key] = value;
  }
  return Object.freeze(theme);
}
