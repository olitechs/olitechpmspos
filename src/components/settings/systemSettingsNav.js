// System settings live inside the Back Office workspace. These helpers used to
// build `/settings/system/<slug>` URLs, which the router redirected wholesale to
// the Features page, so every item below opened Features instead of its own
// section. They now point at the routes that actually render each section, and
// still understand the old URLs so existing bookmarks keep working.
const SETTINGS_ROOT = '/backoffice/settings/';

export const SYSTEM_SETTINGS_NAV = [
  { slug: 'features', label: 'Features' },
  { slug: 'billing', label: 'Billing & subscriptions' },
  { slug: 'payment-types', label: 'Payment types' },
  { slug: 'loyalty', label: 'Loyalty' },
  { slug: 'taxes', label: 'Taxes' },
  { slug: 'receipt', label: 'Receipt' },
  { slug: 'open-tickets', label: 'Open tickets' },
  { slug: 'kitchen-printers', label: 'Kitchen printers' },
  { slug: 'modifiers', label: 'Modifiers' },
  { slug: 'discounts', label: 'Discounts' },
  { slug: 'suppliers', label: 'Suppliers' },
  { slug: 'dining-options', label: 'Dining options' },
];

export const navPath = (item) => `${SETTINGS_ROOT}${item.slug}`;

export function isSystemSettingsPath(pathname = '') {
  return pathname === '/backoffice/settings'
    || pathname.startsWith(SETTINGS_ROOT)
    || pathname === '/settings/kitchen-printers'
    || pathname === '/settings/system'
    || pathname.startsWith('/settings/system/');
}

export function slugFromPath(pathname = '') {
  const backOffice = pathname.match(/^\/backoffice\/settings\/([^/]+)/);
  if (backOffice) return backOffice[1];
  if (pathname === '/settings/kitchen-printers') return 'kitchen-printers';
  if (pathname === '/settings/stores') return 'stores';
  const legacy = pathname.match(/^\/settings\/system\/([^/]+)/);
  return legacy ? legacy[1] : '';
}
