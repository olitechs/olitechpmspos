import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../src/components/ui/system.jsx', import.meta.url), 'utf8');
const sidebar = readFileSync(new URL('../../src/components/shell/Sidebar.jsx', import.meta.url), 'utf8');
const brandLogo = readFileSync(new URL('../../src/components/ui/BrandLogo.jsx', import.meta.url), 'utf8');
const appShell = readFileSync(new URL('../../src/components/layout/AppShell.jsx', import.meta.url), 'utf8');
const posHeader = readFileSync(new URL('../../src/components/pos/AppHeader.jsx', import.meta.url), 'utf8');
const posGate = readFileSync(new URL('../../src/components/pos/POSAccessGate.jsx', import.meta.url), 'utf8');
const publicSignIn = readFileSync(new URL('../../src/pages/PublicSignIn.jsx', import.meta.url), 'utf8');
const authLayout = readFileSync(new URL('../../src/components/ui/AuthLayout.jsx', import.meta.url), 'utf8');
const adminLayout = readFileSync(new URL('../../src/pages/admin/AdminLayout.jsx', import.meta.url), 'utf8');
const publicHomeBrand = readFileSync(new URL('../../src/pages/PublicHome.jsx', import.meta.url), 'utf8');
const theme = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const roomPlanner = readFileSync(new URL('../../src/components/pms/RoomPlanner.jsx', import.meta.url), 'utf8');
const reservations = readFileSync(new URL('../../src/components/modules/Reservations.jsx', import.meta.url), 'utf8');
const folio = readFileSync(new URL('../../src/components/modules/Folio.jsx', import.meta.url), 'utf8');
const posDevices = readFileSync(new URL('../../src/components/stores/POSDevicesPage.jsx', import.meta.url), 'utf8');
const receiptSettings = readFileSync(new URL('../../src/components/settings/ReceiptSettings.jsx', import.meta.url), 'utf8');
const operationalSettings = readFileSync(new URL('../../src/components/settings/OperationalSettingsPage.jsx', import.meta.url), 'utf8');
const catalogue = readFileSync(new URL('../../src/components/settings/Phase2CataloguePage.jsx', import.meta.url), 'utf8');
const accessError = readFileSync(new URL('../../src/components/ui/UserNotRegisteredError.jsx', import.meta.url), 'utf8');
const nightAudit = readFileSync(new URL('../../src/components/modules/NightAudit.jsx', import.meta.url), 'utf8');
const cashier = readFileSync(new URL('../../src/components/modules/Cashier.jsx', import.meta.url), 'utf8');
const housekeeping = readFileSync(new URL('../../src/components/modules/Housekeeping.jsx', import.meta.url), 'utf8');
const subscriptionPanel = readFileSync(new URL('../../src/components/admin/SubscriptionPanel.jsx', import.meta.url), 'utf8');
const printerSettings = readFileSync(new URL('../../src/pages/SettingsPrinters.jsx', import.meta.url), 'utf8');
const adminProperties = readFileSync(new URL('../../src/pages/admin/AdminProperties.jsx', import.meta.url), 'utf8');
const kitchenDisplay = readFileSync(new URL('../../src/components/modules/KitchenDisplay.jsx', import.meta.url), 'utf8');
const laundry = readFileSync(new URL('../../src/components/modules/Laundry.jsx', import.meta.url), 'utf8');
const transfers = readFileSync(new URL('../../src/components/modules/Transfers.jsx', import.meta.url), 'utf8');
const recipes = readFileSync(new URL('../../src/components/modules/Recipes.jsx', import.meta.url), 'utf8');
const receipts = readFileSync(new URL('../../src/components/modules/Receipts.jsx', import.meta.url), 'utf8');
const maintenance = readFileSync(new URL('../../src/components/modules/Maintenance.jsx', import.meta.url), 'utf8');
const inventory = readFileSync(new URL('../../src/components/modules/Inventory.jsx', import.meta.url), 'utf8');
const roomsPage = readFileSync(new URL('../../src/components/pms/Rooms.jsx', import.meta.url), 'utf8');
const roomManagement = readFileSync(new URL('../../src/components/pms/RoomManagement.jsx', import.meta.url), 'utf8');
const billPayment = readFileSync(new URL('../../src/components/pos/BillPayment.jsx', import.meta.url), 'utf8');
const orderTaking = readFileSync(new URL('../../src/components/pos/OrderTaking.jsx', import.meta.url), 'utf8');
const adminRoute = readFileSync(new URL('../../src/lib/AdminRoute.jsx', import.meta.url), 'utf8');
const protectedRoute = readFileSync(new URL('../../src/components/ui/ProtectedRoute.jsx', import.meta.url), 'utf8');
const employeeList = readFileSync(new URL('../../src/components/settings/EmployeeListPage.jsx', import.meta.url), 'utf8');
const sharedSelect = readFileSync(new URL('../../src/components/ui/select.jsx', import.meta.url), 'utf8');
const productTable = readFileSync(new URL('../../src/components/store/ProductTable.jsx', import.meta.url), 'utf8');
const publicHome = readFileSync(new URL('../../src/pages/PublicHome.jsx', import.meta.url), 'utf8');
const pageNotFound = readFileSync(new URL('../../src/lib/PageNotFound.jsx', import.meta.url), 'utf8');
const timecards = readFileSync(new URL('../../src/components/settings/TimecardsPage.jsx', import.meta.url), 'utf8');
const stockMovements = readFileSync(new URL('../../src/components/store/StockMovements.jsx', import.meta.url), 'utf8');
const storesPage = readFileSync(new URL('../../src/components/stores/StoresPage.jsx', import.meta.url), 'utf8');
const shiftReport = readFileSync(new URL('../../src/pages/ShiftReport.jsx', import.meta.url), 'utf8');
const storePage = readFileSync(new URL('../../src/pages/Store.jsx', import.meta.url), 'utf8');
const inventoryOperations = readFileSync(new URL('../../src/components/modules/InventoryOperations.jsx', import.meta.url), 'utf8');
const inventoryReports = readFileSync(new URL('../../src/components/modules/InventoryReports.jsx', import.meta.url), 'utf8');
const purchasing = readFileSync(new URL('../../src/components/modules/Purchasing.jsx', import.meta.url), 'utf8');
const reports = readFileSync(new URL('../../src/components/modules/Reports.jsx', import.meta.url), 'utf8');
const channelManager = readFileSync(new URL('../../src/components/modules/ChannelManager.jsx', import.meta.url), 'utf8');
const distributionOps = readFileSync(new URL('../../src/components/modules/DistributionOps.jsx', import.meta.url), 'utf8');
const bookingEngine = readFileSync(new URL('../../src/components/modules/BookingEngine.jsx', import.meta.url), 'utf8');
const pinPad = readFileSync(new URL('../../src/components/auth/PinPad.jsx', import.meta.url), 'utf8');
const routeGuard = readFileSync(new URL('../../src/components/auth/RouteGuard.jsx', import.meta.url), 'utf8');
const errorBoundary = readFileSync(new URL('../../src/components/ui/ErrorBoundary.jsx', import.meta.url), 'utf8');
const login = readFileSync(new URL('../../src/pages/Login.jsx', import.meta.url), 'utf8');
const adminCreateProperty = readFileSync(new URL('../../src/pages/admin/AdminCreateProperty.jsx', import.meta.url), 'utf8');
const adminRoles = readFileSync(new URL('../../src/pages/admin/Roles.jsx', import.meta.url), 'utf8');
const unsettledReceiptSettings = readFileSync(new URL('../../src/pages/admin/UnsettledReceiptSettings.jsx', import.meta.url), 'utf8');



test('shared operational UI exports the Phase 1 primitives', () => {
  for (const component of [
    'PageHeader', 'Card', 'StatTile', 'StatusBadge', 'EmptyState', 'Skeleton',
    'FilterBar', 'DataTable', 'ConfirmDialog', 'Drawer', 'Tabs',
    'SegmentedControl', 'FormField',
  ]) {
    assert.ok(source.includes('export function ' + component + '('), component + ' should be exported');
  }
});

test('status badges use semantic theme tokens instead of fixed palette colors', () => {
  const block = source.match(/const STATUS_TONES = \{([\s\S]*?)\n\};/);
  assert.ok(block, 'STATUS_TONES map should exist');
  for (const tone of ['success', 'warning', 'danger', 'info', 'neutral']) assert.match(block[1], new RegExp(tone + ':'));
  assert.match(block[1], /var\(--success-text\)/);
  assert.match(block[1], /var\(--warning-text\)/);
  assert.match(block[1], /var\(--danger-text\)/);
  assert.match(block[1], /var\(--primary\)/);
  assert.doesNotMatch(block[1], /(?:emerald|amber|red|blue)-(?:50|800|950|300)/);
});

test('shared primitives retain responsive overflow and stacking safeguards', () => {
  assert.match(source, /sm:flex-row sm:items-start sm:justify-between/);
  assert.match(source, /flex-col gap-2 sm:flex-row sm:flex-wrap/);
  assert.match(source, /w-full overflow-x-auto/);
  assert.match(source, /overflow-x-auto border-b/);
  assert.match(source, /min-w-0 flex-1/);
});

test('sidebar has accessible mobile open/close controls and a scrollable navigation region', () => {
  assert.match(sidebar, /aria-label="OliTechs dashboard navigation"/);
  assert.match(sidebar, /aria-label="Open navigation"/);
  assert.match(sidebar, /aria-label="Close navigation"/);
  assert.match(sidebar, /md:translate-x-0/);
  assert.match(sidebar, /-translate-x-\[calc\(100%\+16px\)\]/);
  assert.match(sidebar, /min-h-0 flex-1 overflow-y-auto/);
  assert.match(sidebar, /aria-label="Search navigation"/);
});

test('official OliTechs identity is shared across all application workspaces and entry screens', () => {
  for (const source of [appShell, sidebar, posHeader, posGate, login, publicSignIn, authLayout, adminLayout, publicHomeBrand]) {
    assert.match(source, /BrandLogo/);
  }
  assert.match(brandLogo, /olitechs-logo\.svg/);
  assert.match(brandLogo, /app-icon\.svg/);
  assert.match(theme, /--primary:\s*var\(--coastal-teal\)/);
  assert.match(theme, /--primary-hover:\s*var\(--deep-lagoon\)/);
  assert.match(theme, /--pos-gate-accent:\s*var\(--primary\)/);
  assert.match(html, /<title>OliTechs PMS \+ POS \| Hospitality Operations<\/title>/);
});

test('theme foundation defines exact light-only OliTechs navy/blue brand, payment and room tokens', () => {
  for (const token of [
    '--brand-navy: #101A35', '--brand-blue: #285FE7', '--brand-blue-hover: #174AC8',
    '--brand-blue-soft: #F3F7FF', '--brand-canvas: #F8FAFF', '--brand-white: #FFFFFF',
    '--deep-lagoon: #101A35', '--coastal-teal: #285FE7', '--white: #FFFFFF', '--soft-white: #F8FAFF',
    '--canvas: #F8FAFF', '--sidebar: #EEF3FC', '--text: #101A35', '--accent: #E8955A',
    '--status-paid: #3FA77A', '--status-deposit-paid: #F2C14E', '--status-deposit-foreground: #5A4310',
    '--status-not-paid: #EE8A3C', '--room-occupied: #2F6F9F', '--room-checkout: #3949AB', '--room-out-of-order: #65727A',
    '--print-ink: #000000', '--print-void: #DC2626',
  ]) assert.ok(theme.includes(token), 'missing canonical token ' + token);
  assert.match(theme, /--primary:\s*var\(--coastal-teal\)/);
  assert.match(theme, /--on-primary:\s*var\(--white\)/);
  assert.match(theme, /--pay-none:\s*var\(--status-not-paid\)/);
  assert.match(theme, /--pay-part:\s*var\(--status-deposit-paid\)/);
  assert.match(theme, /--pay-paid:\s*var\(--status-paid\)/);
  assert.match(theme, /--room-out-of-order-stripe:\s*repeating-linear-gradient\(135deg/);
  assert.doesNotMatch(theme, /data-theme=["']dark|color-scheme\s*:\s*dark/);
  assert.match(theme, /color-scheme:\s*light/);
  assert.match(theme, /prefers-reduced-motion:\s*reduce/);
  assert.match(theme, /--status-optioned:\s*color-mix\(in srgb, var\(--coastal-teal\) 18%, var\(--white\)\)/);
  assert.match(theme, /--pay-opt:\s*var\(--status-optioned\)/);
  assert.ok(html.includes('https://fonts.googleapis.com/css2?family=Inter'));
  for (const token of ['--surface', '--surface-2', '--border', '--text', '--muted', '--focus']) {
    assert.match(theme, new RegExp(token + ':'));
  }
});

test('light-only theme maps every major surface and foreground through semantic variables', () => {
  for (const declaration of [
    '--background: var(--canvas)',
    '--foreground: var(--text)',
    '--card: var(--surface)',
    '--secondary: var(--sidebar)',
    '--muted-foreground: var(--text-muted)',
    '--ring: var(--primary)',
  ]) assert.ok(theme.includes(declaration), 'missing semantic mapping: ' + declaration);
  assert.doesNotMatch(theme, /data-theme=["']dark|color-scheme\s*:\s*dark/);
  assert.doesNotMatch(theme, /\.bg-(?:gray|slate)-(?:50|100|200|300|400|500|600|700|800|900)/);
});

test('mobile sidebar exposes expanded state and closes with Escape', () => {
  assert.match(sidebar, /aria-expanded=\{mobileOpen\}/);
  assert.match(sidebar, /event\.key===\"Escape\"/);
});



test('operational screens use semantic theme tokens for text, surfaces, focus and feedback', () => {
  const screens = {
    reservations, folio, posDevices, receiptSettings, operationalSettings, catalogue, accessError, nightAudit, cashier, housekeeping, subscriptionPanel, printerSettings, adminProperties, adminRoute, protectedRoute, employeeList, sharedSelect, productTable, pageNotFound,
  };
  for (const [name, source] of Object.entries(screens)) {
    assert.doesNotMatch(
      source,
      /\b(?:focus:ring|focus:border|text|bg|border|divide|ring)-(?:slate|gray|zinc|neutral)-(?:50|100|200|300|400|500|600|700|800|900|950)\b/,
      name + ' should not reintroduce fixed neutral utility colours',
    );
  }
  assert.match(reservations, /var\(--danger-soft\)/);
  assert.match(folio, /bg-primary text-primary-foreground/);
  assert.match(posDevices, /var\(--success-text\)/);
  assert.match(receiptSettings, /var\(--danger-text\)/);
  assert.match(operationalSettings, /bg-primary text-primary-foreground/);
  assert.match(catalogue, /bg-primary text-primary-foreground/);
  assert.match(accessError, /bg-surface/);

  assert.match(nightAudit, /var\(--danger-soft\)/);
  assert.match(nightAudit, /bg-primary text-primary-foreground/);
  assert.match(cashier, /var\(--danger-text\)/);
  assert.match(housekeeping, /var\(--success-soft\)/);
  assert.match(subscriptionPanel, /var\(--danger-soft\)/);
  assert.match(printerSettings, /bg-primary/);
  assert.match(printerSettings, /text-primary-foreground/);
  assert.match(adminProperties, /var\(--danger-soft\)/);
  assert.match(adminRoute, /border-\[var\(--border\)\]/);
  assert.match(protectedRoute, /border-\[var\(--border\)\]/);
  for (const [name, source] of Object.entries({nightAudit, cashier, housekeeping, subscriptionPanel, printerSettings, adminProperties})) {
    assert.doesNotMatch(source, /(?:text|bg|border)-(?:red|amber|emerald|teal|blue|rose)-(?:50|100|200|300|400|500|600|700|800|900)\b/, name + ' should use semantic status colours');
  }
  assert.match(nightAudit, /var\(--success-soft\)/);
  assert.match(housekeeping, /var\(--warning-soft\)/);
  assert.match(cashier, /var\(--success-text\)/);
  assert.match(subscriptionPanel, /var\(--warning-soft\)/);
  assert.match(printerSettings, /var\(--danger-soft\)/);
  assert.match(adminProperties, /var\(--success-soft\)/);
  assert.match(employeeList, /bg-primary text-primary-foreground/);
  assert.match(sharedSelect, /var\(--surface-2\)/);
  assert.doesNotMatch(sharedSelect, /NAVY|SURFACE2|data-\[highlighted\]:bg-slate/);
  assert.match(productTable, /var\(--danger\)/);
  assert.doesNotMatch(productTable, /#EF4444|#EAB308|#22C55E|#FFD300/);
  assert.match(publicHome, /className="olitechs-marketing/);
  assert.match(pageNotFound, /font-family:var\(--font-heading\)/);
  assert.doesNotMatch(pageNotFound, /Roboto/);
});

test('timecards, stock movements and store operations use semantic theme colours', () => {
  for (const [name, source] of Object.entries({timecards, stockMovements, storesPage, shiftReport, storePage, inventoryOperations, inventoryReports, purchasing, reports, channelManager, distributionOps, bookingEngine, pinPad, routeGuard, errorBoundary, login, adminCreateProperty, adminRoles, unsettledReceiptSettings, adminProperties, kitchenDisplay, laundry, transfers, recipes, receipts, maintenance, inventory, roomsPage, roomManagement, billPayment, orderTaking})) {
    assert.doesNotMatch(source, /\b(?:text|bg|border)-(?:slate|gray|zinc|neutral|red|amber|emerald|teal|blue|rose|green|yellow|orange)-(?:50|100|200|300|400|500|600|700|800|900|950)\b/, name + ' should not use fixed palette utilities');
  }
  assert.match(timecards, /bg-canvas/);
  assert.match(timecards, /var\(--warning-soft\)/);
  assert.match(stockMovements, /var\(--success-soft\)/);
  assert.match(stockMovements, /var\(--danger-soft\)/);
  assert.match(storesPage, /var\(--warning-soft\)/);
  assert.match(shiftReport, /var\(--danger-soft\)/);
  assert.match(storePage, /var\(--danger-soft\)/);
  assert.match(inventoryOperations, /var\(--warning-text\)/);
  assert.match(inventoryReports, /var\(--success-text\)/);
  assert.match(purchasing, /var\(--danger-text\)/);
  assert.match(reports, /var\(--danger-soft\)/);
  assert.match(channelManager, /var\(--danger-text\)/);
  assert.match(distributionOps, /var\(--danger-text\)/);
  assert.ok(distributionOps.includes('var(--canvas)'));
  assert.doesNotMatch(distributionOps, /#[0-9a-fA-F]{3,8}/);
  assert.match(bookingEngine, /var\(--danger-text\)/);
  assert.match(pinPad, /var\(--danger-soft\)/);
  assert.match(routeGuard, /var\(--danger-text\)/);
  assert.match(errorBoundary, /var\(--danger-soft\)/);
  assert.match(login, /var\(--danger-text\)/);
  assert.match(adminCreateProperty, /var\(--success-soft\)/);
  assert.match(adminRoles, /var\(--danger-soft\)/);
  assert.match(unsettledReceiptSettings, /var\(--success-soft\)/);
  assert.match(adminProperties, /var\(--warning-soft\)/);
  assert.match(kitchenDisplay, /var\(--danger-soft\)/);
  assert.match(laundry, /var\(--danger-text\)/);
  assert.match(transfers, /var\(--danger-text\)/);
  assert.match(recipes, /var\(--danger-text\)/);
  assert.match(receipts, /var\(--danger-soft\)/);
  assert.match(maintenance, /var\(--warning-text\)/);
  assert.match(maintenance, /var\(--primary-foreground\)/);
  assert.match(inventory, /var\(--primary-foreground\)/);
  assert.match(roomManagement, /var\(--danger-soft\)/);
  assert.match(billPayment, /var\(--danger-soft\)/);
  assert.match(orderTaking, /var\(--danger-soft\)/);
});

test('Room Planner toolbar exposes the approved controls and responsive dimensions', () => {
  for (const label of ['Add Closures', 'New reservation', 'Today', 'Start date', 'End date', 'Select month']) {
    assert.ok(roomPlanner.includes(label), 'missing toolbar control: ' + label);
  }
  // Redesign: fluid toolbar (no hard-coded pixel widths), 38px desktop / 44px touch controls.
  assert.doesNotMatch(roomPlanner, /style=\{\{width:(141|131|267|130)\}\}/);
  assert.match(roomPlanner, /height:38px/);
  assert.match(roomPlanner, /pointer:coarse[^ {]*\{[^}]*height:44px/);
  assert.match(roomPlanner, /@media\(max-width:1099px\)/);
  assert.match(roomPlanner, /shiftVisibleRange\(-\(Number\(viewLength\)\|\|15\)\)/);
  assert.match(roomPlanner, /shiftVisibleRange\(Number\(viewLength\)\|\|15\)/);
  assert.match(roomPlanner, /applyViewLength\(days\)/);
  assert.match(roomPlanner, /subDays\(today, 2\)/);
  assert.match(roomPlanner, /addDays\(today, 12\)/);
  assert.match(roomPlanner, /onClick=\{addClosure\}/);
  assert.match(roomPlanner, /onClick=\{\(\) => openCreate/);
});
