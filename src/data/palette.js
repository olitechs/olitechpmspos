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
  free: { fill: 'var(--surface)', border: BORDER, text: NAVY, dot: 'var(--text-muted)' },
  occupied: { fill: 'var(--surface)', border: 'var(--room-occupied)', text: NAVY, dot: 'var(--room-occupied)' },
  unsettled: { fill: 'var(--warning-soft)', border: 'var(--warning)', text: NAVY, dot: 'var(--warning)' },
};
