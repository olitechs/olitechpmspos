import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { splitStaffForDock, staffInitials } from '../../lib/posStaff.js';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

test('staff initials come from the one field the POS staff list carries', () => {
  // authService.listStaff() rows are normalised to { id, name }. Reading a
  // `full_name`/`avatar` field that does not exist is what left every circle
  // blank and every tooltip reading "Switch to undefined".
  assert.equal(staffInitials('Amina Hassan'), 'AH');
  assert.equal(staffInitials('Brian'), 'B');
  assert.equal(staffInitials('  mary  wanjiku  kamau '), 'MK');
  assert.equal(staffInitials(''), '?');
  assert.equal(staffInitials(null), '?');
});

test('the staff dock bounds how many people it shows and reports the rest', () => {
  const staff = Array.from({ length: 9 }, (_, index) => ({ id: `s${index}`, name: `Staff ${index}` }));
  const { visible, hiddenCount } = splitStaffForDock(staff, 6);
  assert.equal(visible.length, 6);
  assert.equal(hiddenCount, 3);
  assert.deepEqual(splitStaffForDock([], 6), { visible: [], hiddenCount: 0 });
  assert.deepEqual(splitStaffForDock(null, 6), { visible: [], hiddenCount: 0 });
});

test('POS screens never read staff fields the staff list does not provide', () => {
  const container = read('./POSContainer.jsx');
  assert.ok(container.includes('map((row) => ({ id: row.id, name: row.full_name }))'));
  assert.doesNotMatch(container, /switchStaff\.full_name/);
  assert.doesNotMatch(container, /person\.full_name/);
  assert.doesNotMatch(container, /person\.avatar/);
  assert.ok(container.includes('staffName={switchStaff.name}'));
  assert.ok(container.includes('<StaffDock staff={posStaff} activeStaffId={activeStaffId}'));
});

test('the staff dock keeps 44px targets and an accessible switch control', () => {
  const dock = read('./StaffDock.jsx');
  assert.match(dock, /h-11 w-11/);
  assert.match(dock, /aria-label=\{`Switch POS staff to \$\{person\.name\}`\}/);
  assert.match(dock, /aria-pressed=\{isActive\}/);
});
