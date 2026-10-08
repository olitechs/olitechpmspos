// Global OliTechs "Yellow / Black Premium" palette.
// Room Planner uses src/data/palette.js and is intentionally kept unchanged.
export const NAVY = 'var(--text)';
export const NAVY2 = 'var(--surface)';
export const SLATE = 'var(--muted)';
export const TEAL = 'var(--action)';
export const TEAL_DARK = 'var(--action)';
export const TEAL_LIGHT = 'var(--action)';
export const SAND = 'var(--bg)';
export const SURFACE = 'var(--surface)';
export const SURFACE2 = 'var(--bg)';
export const BORDER = 'var(--border)';
export const BORDER_DARK = 'var(--muted)';
export const MUTED = 'var(--muted)';
export const MUTED_DARK = 'var(--muted)';
export const DESTRUCTIVE = 'var(--danger)';
export const ERR = 'var(--warning)';

export const STATUS = {
  free: { fill: 'var(--surface)', border: BORDER, text: NAVY, dot: 'var(--table-free)' },
  occupied: { fill: 'var(--table-occupied)', border: 'var(--table-occupied)', text: 'var(--action-text)', dot: 'var(--table-occupied)' },
  unsettled: { fill: 'var(--action)', border: TEAL_DARK, text: NAVY, dot: ERR },
};

export { getTextColorForBg } from '@/utils/textContrast';
