/**
 * Tailwind cannot apply an opacity modifier to a colour declared as a plain CSS
 * variable: when `primary` is the string "var(--primary)", Tailwind drops
 * `bg-primary/10` entirely (no rule is emitted, so the element silently loses
 * its background/ring/border tint).
 *
 * Declaring every palette entry as a colour function gives Tailwind the
 * requested alpha, so it emits a real `color-mix()` value instead. Without an
 * alpha modifier the token is used verbatim, exactly as before.
 */
const token = (name) => ({ opacityValue } = {}) => {
  // Plain utilities pass the legacy --tw-bg-opacity indirection, which cannot
  // be evaluated at build time; only numeric modifiers carry a real alpha.
  const alpha = Number(opacityValue);
  if (opacityValue === undefined || Number.isNaN(alpha)) return `var(--${name})`;
  return `color-mix(in srgb, var(--${name}) ${+(alpha * 100).toFixed(2)}%, transparent)`;
};

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      opacity: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [i, `${i / 100}`])),
      borderRadius: { lg: 'var(--radius)', md: 'var(--radius-control)', sm: '6px' },
      boxShadow: { card: 'none', overlay: 'var(--shadow-overlay)' },
      colors: {
        brand: { dark: token('deep-lagoon'), charcoal: token('sidebar'), primary: token('primary'), hover: token('primary-hover'), soft: token('primary-soft') },
        action: { DEFAULT: token('primary'), hover: token('primary-hover'), foreground: token('on-primary') },
        table: { free: token('table-free-bg'), occupied: token('table-occupied-bg'), bill: token('table-bill-bg') },
        room: { clean: token('room-clean'), dirty: token('room-dirty'), occupied: token('room-occupied'), checkout: token('room-checkout'), 'out-of-order': token('room-out-of-order') },
        payment: { paid: token('status-paid'), deposit: token('status-deposit-paid'), unpaid: token('status-not-paid') },
        info: token('info'),
        success: { DEFAULT: token('success'), foreground: token('success-text'), soft: token('success-soft') },
        warning: { DEFAULT: token('warning'), foreground: token('warning-text'), soft: token('warning-soft') },
        danger: { DEFAULT: token('danger'), foreground: token('danger-foreground'), text: token('danger-text'), soft: token('danger-soft') },
        surface: { DEFAULT: token('surface'), secondary: token('sidebar') },
        canvas: token('canvas'),
        'soft-white': token('soft-white'),
        text: { DEFAULT: token('text'), muted: token('text-muted') },
        background: token('background'),
        foreground: token('foreground'),
        card: { DEFAULT: token('card'), foreground: token('card-foreground') },
        popover: { DEFAULT: token('popover'), foreground: token('popover-foreground') },
        primary: { DEFAULT: token('primary'), foreground: token('on-primary') },
        secondary: { DEFAULT: token('secondary'), foreground: token('secondary-foreground') },
        muted: { DEFAULT: token('sidebar'), foreground: token('text-muted') },
        accent: { DEFAULT: token('accent'), foreground: token('accent-foreground') },
        destructive: { DEFAULT: token('destructive'), foreground: token('destructive-foreground') },
        border: token('border'), input: token('input'), ring: token('ring'),
        chart: { 1: token('primary'), 2: token('success'), 3: token('accent'), 4: token('danger'), 5: token('primary-soft') },
        sidebar: { DEFAULT: token('sidebar'), foreground: token('text'), primary: token('primary'), 'primary-foreground': token('primary-foreground'), accent: token('primary-soft'), 'accent-foreground': token('primary'), border: token('border'), ring: token('primary') },
      },
      fontFamily: { heading: ['var(--font-heading)'], body: ['var(--font-body)'], display: ['var(--font-display)'], mono: ['var(--font-mono)'] },
      fontSize: {
        'ui-xs': ['12px', { lineHeight: '16px' }], 'ui-sm': ['13px', { lineHeight: '18px' }],
        'ui-base': ['14px', { lineHeight: '20px' }], 'ui-lg': ['16px', { lineHeight: '24px' }],
        'ui-xl': ['20px', { lineHeight: '28px' }], 'ui-2xl': ['22px', { lineHeight: '30px' }],
      },
      keyframes: {
        'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up': { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
      },
      animation: { 'accordion-down': 'accordion-down 0.15s ease-out', 'accordion-up': 'accordion-up 0.15s ease-out' },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
