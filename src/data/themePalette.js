// Compatibility exports mapped to the canonical Coastal Linen CSS tokens.
export const NAVY = 'var(--text)';
export const NAVY2 = 'var(--text)';
export const SLATE = 'var(--text-muted)';
export const TEAL = 'var(--primary)';
export const TEAL_DARK = 'var(--primary-hover)';
export const TEAL_LIGHT = 'var(--primary-soft)';
export const SAND = 'var(--canvas)';
export const SURFACE = 'var(--surface)';
export const SURFACE2 = 'var(--sidebar)';
export const BORDER = 'var(--border)';
export const BORDER_DARK = 'var(--border)';
export const MUTED = 'var(--text-muted)';
export const MUTED_DARK = 'var(--text-muted)';
export const DESTRUCTIVE = 'var(--danger)';
export const ERR = 'var(--warning)';
export const STATUS = {
  free: { fill: 'var(--table-free-bg)', border: 'var(--table-free-border)', text: 'var(--table-free-fg)', dot: 'var(--table-free-border)' },
  occupied: { fill: 'var(--table-occupied-bg)', border: 'var(--table-occupied-border)', text: 'var(--table-occupied-fg)', dot: 'var(--table-occupied-border)' },
  unsettled: { fill: 'var(--table-bill-bg)', border: 'var(--table-bill-border)', text: 'var(--table-bill-fg)', dot: 'var(--table-bill-border)' },
};
export { getTextColorForBg } from '@/utils/textContrast';
