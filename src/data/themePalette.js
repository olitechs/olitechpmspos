// Compatibility exports for existing components.
// Canonical visual values live in src/index.css.
export const NAVY = 'var(--text)';
export const NAVY2 = 'var(--brand-charcoal)';
export const SLATE = 'var(--muted)';
export const TEAL = 'var(--action)';
export const TEAL_DARK = 'var(--action-hover)';
export const TEAL_LIGHT = 'var(--brand-soft)';
export const SAND = 'var(--bg)';
export const SURFACE = 'var(--surface)';
export const SURFACE2 = 'var(--surface-2)';
export const BORDER = 'var(--border)';
export const BORDER_DARK = 'var(--border-strong)';
export const MUTED = 'var(--muted)';
export const MUTED_DARK = 'var(--muted)';
export const DESTRUCTIVE = 'var(--danger)';
export const ERR = 'var(--warning)';

export const STATUS = {
  free: { fill: 'var(--surface)', border: BORDER, text: NAVY, dot: 'var(--table-free)' },
  occupied: { fill: 'var(--surface)', border: 'var(--table-occupied)', text: NAVY, dot: 'var(--table-occupied)' },
  unsettled: { fill: 'var(--brand-soft)', border: 'var(--table-bill)', text: NAVY, dot: 'var(--table-bill)' },
};

export { getTextColorForBg } from '@/utils/textContrast';
