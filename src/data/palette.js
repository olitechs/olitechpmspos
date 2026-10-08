// OliTechs Grand Hotel — Yellow / Black premium palette.
//
// NOTE: this file was missing from the exported project (it shipped empty),
// so these are newly authored values matching the usage found across the
// existing components (colors like #E0A23C, #9A6616 and the
// rgba(110,138,134,...) muted-dark tone were already hard-coded in several
// files, so they're reused here as the canonical constants).

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
// Warning / "needs attention" tone (bill printed, unsettled, low stock).
export const ERR = 'var(--warning)';

// Floor-plan / table-tile status styling — keyed by session status.
export const STATUS = {
	free: { fill: 'var(--surface)', border: BORDER, text: NAVY, dot: 'var(--table-free)' },
	occupied: { fill: 'var(--table-occupied)', border: 'var(--table-occupied)', text: 'var(--action-text)', dot: 'var(--table-occupied)' },
	unsettled: { fill: 'var(--table-bill)', border: 'var(--table-bill)', text: 'var(--action-text)', dot: 'var(--table-bill)' },
};
