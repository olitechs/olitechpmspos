import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

const root = process.cwd();
const sourceRoot = join(root, 'src');
const excludedFiles = new Set([
  'src/index.css', // canonical theme token definitions
  'src/components/settings/ReceiptPreview.jsx', // preserve printed receipt appearance
  'src/components/settings/ReceiptSettings.jsx', // receipt formatting and printer output controls
  'src/components/modules/Receipts.jsx', // receipt output surface
  'src/components/pos/PrintWarn.jsx', // printer/print warning output
  'src/pages/SettingsPrinters.jsx', // printer test/receipt output controls
  'src/services/printService.js', // generated print documents
  'src/components/ui/GoogleIcon.jsx', // third-party brand glyph colours
]);
const excludedDirectories = new Set([
  'src/assets',
  'src/generated',
]);
// Existing token-debt files are tracked explicitly so this guard can prevent
// regressions in clean files without blocking builds on pre-existing UI debt.
// Remove each entry when that file has been migrated to semantic tokens.
const legacyDebtFiles = new Set([
  'src/components/admin/SubscriptionPanel.jsx',
  'src/components/admin/TableSetup.jsx',
  'src/components/auth/PinPad.jsx',
  'src/components/auth/RouteGuard.jsx',
  'src/components/modules/BookingEngine.jsx',
  'src/components/modules/Cashier.jsx',
  'src/components/modules/ChannelManager.jsx',
  'src/components/modules/DistributionOps.jsx',
  'src/components/modules/Folio.jsx',
  'src/components/modules/Housekeeping.jsx',
  'src/components/modules/Inventory.jsx',
  'src/components/modules/InventoryOperations.jsx',
  'src/components/modules/InventoryReports.jsx',
  'src/components/modules/KitchenDisplay.jsx',
  'src/components/modules/Laundry.jsx',
  'src/components/modules/Maintenance.jsx',
  'src/components/modules/NightAudit.jsx',
  'src/components/modules/Purchasing.jsx',
  'src/components/modules/Recipes.jsx',
  'src/components/modules/Reports.jsx',
  'src/components/modules/Reservations.jsx',
  'src/components/modules/Transfers.jsx',
  'src/components/pms/RoomManagement.jsx',
  'src/components/pms/RoomPanel.jsx',
  'src/components/pms/RoomPlanner.jsx',
  'src/components/pms/Rooms.jsx',
  'src/components/pos/AppHeader.jsx',
  'src/components/pos/BillPayment.jsx',
  'src/components/pos/CloseShiftModal.jsx',
  'src/components/pos/OpenTableDialog.jsx',
  'src/components/pos/OrderTaking.jsx',
  'src/components/pos/POSContainer.jsx',
  'src/components/settings/EmployeeListPage.jsx',
  'src/components/settings/OperationalSettingsPage.jsx',
  'src/components/settings/Phase2CataloguePage.jsx',
  'src/components/settings/PrinterGroupModal.jsx',
  'src/components/settings/TimecardsPage.jsx',
  'src/components/shell/SocialFAB.jsx',
  'src/components/store/ProductTable.jsx',
  'src/components/store/StockMovements.jsx',
  'src/components/store/SupplierList.jsx',
  'src/components/stores/POSDevicesPage.jsx',
  'src/components/stores/StoresPage.jsx',
  'src/components/ui/AuthLayout.jsx',
  'src/components/ui/ErrorBoundary.jsx',
  'src/components/ui/ProtectedRoute.jsx',
  'src/components/ui/UserNotRegisteredError.jsx',
  'src/components/ui/dialog.jsx',
  'src/components/ui/system.jsx',
  'src/data/PmsStore.jsx',
  'src/lib/AdminRoute.jsx',
  'src/lib/PageNotFound.jsx',
  'src/pages/Login.jsx',
  'src/pages/PublicHome.jsx',
  'src/pages/Register.jsx',
  'src/pages/ShiftReport.jsx',
  'src/pages/Store.jsx',
  'src/pages/admin/AdminCreateProperty.jsx',
  'src/pages/admin/AdminProperties.jsx',
  'src/pages/admin/Roles.jsx',
  'src/pages/admin/UnsettledReceiptSettings.jsx',
  'src/theme/ThemeProvider.jsx',
]);
const extensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.css']);
const errors = [];
const patterns = [
  ['hex colour literal', /#[0-9a-fA-F]{3,8}\b/],
  ['rgb/rgba/hsl/hsla colour literal', /\b(?:rgba?|hsla?)\(\s*[-\d.]+/i],
  ['Tailwind palette colour class', /(?:^|[\s"'\x60])(?:bg|text|border|ring|fill|stroke|divide|outline|from|via|to)-(?:black|white|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-[\w/.[\]%-]+)?(?=$|[\s"'\x60])/],
  ['black/white utility class', /(?:^|[\s"'\x60])(?:text|bg)-(?:black|white)(?:\s|$|["'\x60])/],
  ['opacity-based text muting', /text-[\w:[\]%-]+(?:\s+[\w:[\]%-]+){0,8}\s+opacity-[0-9]{1,3}/],
];

function collectFiles(directory) {
  const results = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    const path = relative(root, absolute).split(sep).join('/');
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(path)) results.push(...collectFiles(absolute));
      continue;
    }
    if (entry.isFile() && extensions.has(extname(entry.name)) && !excludedFiles.has(path)) {
      results.push({ path, absolute });
    }
  }
  return results;
}

for (const { path, absolute } of collectFiles(sourceRoot)) {
  const content = readFileSync(absolute, 'utf8');
  for (const [label, pattern] of patterns) {
    if (pattern.test(content) && !legacyDebtFiles.has(path)) errors.push(path + ': ' + label);
  }
}

if (errors.length) {
  console.error('Colour-token guard failed (' + errors.length + ' finding(s)):\n' + errors.map((e) => '- ' + e).join('\n'));
  process.exitCode = 1;
} else {
  console.log('Colour-token guard passed for clean active src files. Existing token debt remains tracked in legacyDebtFiles.');
}
