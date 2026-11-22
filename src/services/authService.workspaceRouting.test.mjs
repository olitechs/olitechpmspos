import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const auth = read('./authService.js');
const routes = read('../routes/AppRoutes.jsx');

test('an active employee assignment is sufficient to enter its assigned workspace', () => {
  assert.ok(auth.includes('function assignedWorkspaceModules(user)'));
  assert.ok(auth.includes("module === 'stores' ? 'store' : module"));
  assert.ok(auth.includes('assignedWorkspaceModules(user).includes(workspace)'));
  assert.ok(auth.includes('if (!user.staff || user.staff.is_active === false) return false;'));
});

test('workspace assignment grants only the workspace landing access, not granular permissions', () => {
  assert.ok(auth.includes('const baseWorkspace = Object.entries(WORKSPACE_ACCESS_CODES)'));
  assert.ok(auth.includes('return !!normalizedWorkspace && assigned.includes(normalizedWorkspace);'));
  assert.ok(auth.includes('Workspace assignment grants only the workspace landing page.'));
  assert.ok(auth.includes('return rule ? hasPermissionCode(user, rule[1]) : false;'));
});

test('sign-in redirects employees to the first workspace they are authorised to use', () => {
  assert.ok(routes.includes('const allowed=MAIN_NAV.find(item=>canUseApp(user,item.id))'));
  assert.ok(routes.includes('return allowed?<Navigate to={allowed.path} replace/>:<PendingApproval/>;'));
});
