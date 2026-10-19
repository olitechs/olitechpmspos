const YELLOW_BGS = ['var(--accent)', 'var(--primary-soft)'];
const DARK_BGS = ['var(--text)', 'var(--sidebar)'];

function normalizeColor(value) {
  return String(value || '').trim().toLowerCase();
}

/** Returns a foreground token for a semantic background token. */
export function getTextColorForBg(background) {
  const value = normalizeColor(background);
  if (value.includes('--table-free-bg')) return 'var(--table-free-fg)';
  if (value.includes('--table-occupied-bg')) return 'var(--table-occupied-fg)';
  if (value.includes('--table-bill-bg')) return 'var(--table-bill-fg)';
  if (value.includes('--danger')) return 'var(--danger-foreground)';
  if (value.includes('--primary') || value.includes('--success')) return value.includes('--success') ? 'var(--success-text)' : 'var(--primary-foreground)';
  return 'var(--text)';
}

export { YELLOW_BGS, DARK_BGS };
