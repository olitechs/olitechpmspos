import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const skeleton = readFileSync(new URL('./AppLoadingSkeleton.jsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../../App.jsx', import.meta.url), 'utf8');
const protectedRoute = readFileSync(new URL('./ProtectedRoute.jsx', import.meta.url), 'utf8');
const pageFiles = [
  '../modules/Reports.jsx',
  '../modules/Inventory.jsx',
  '../modules/GuestList.jsx',
  '../modules/Receipts.jsx',
  '../modules/Folio.jsx',
  '../modules/RegistrationCards.jsx',
  '../../pages/ShiftReport.jsx',
  '../../pages/FrontOfficeStructure.jsx',
  '../modules/InventoryOperations.jsx',
  '../modules/InventoryReports.jsx',
  '../../pages/admin/AdminAuditLog.jsx',
  '../../pages/admin/AdminUsers.jsx',
  '../../pages/admin/AdminProperties.jsx',
];

test('application entry and protected route use the shared skeleton instead of full-screen spinners', () => {
  assert.match(app, /return <AppLoadingSkeleton variant=/);
  assert.match(protectedRoute, /AppLoadingSkeleton variant="dashboard"/);
  assert.doesNotMatch(app, /animate-spin/);
  assert.doesNotMatch(protectedRoute, /animate-spin/);
});

test('shared loading layouts support full-screen and inline module states', () => {
  assert.match(skeleton, /fullScreen = true/);
  assert.match(skeleton, /relative min-h-\[22rem\] w-full/);
  assert.match(skeleton, /export function PageDataSkeleton/);
  for (const variant of ['table', 'cards', 'list', 'report']) {
    assert.ok(skeleton.includes(`variant === '${variant}'`) || skeleton.includes(`variant === '${variant}' ||`), `missing ${variant} layout`);
  }
});

test('loading placeholders retain responsive breakpoints for phone, tablet and desktop widths', () => {
  for (const breakpoint of ['sm:', 'md:', 'lg:', 'xl:']) {
    assert.ok(skeleton.includes(breakpoint), `missing responsive breakpoint ${breakpoint}`);
  }
  assert.match(skeleton, /grid-cols-2/);
  assert.match(skeleton, /sm:grid-cols-5/);
  assert.match(skeleton, /xl:grid-cols-4/);
});

test('data-driven operational and admin pages use the shared page skeleton', () => {
  for (const relativePath of pageFiles) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    assert.match(source, /PageDataSkeleton/, `${relativePath} should use PageDataSkeleton`);
  }
});
