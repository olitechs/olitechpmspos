// Static link audit: every internal navigation target used in src/ must resolve
// to a route declared in src/App.jsx. Run: node scripts/audit-links.mjs
//
// Scope and limits (documented in docs/OPEN_QUESTIONS.md):
// - Parses the <Route> tree in src/App.jsx, including nesting, :params, * and
//   <Navigate> redirects, by normalizing element={...} groups first.
// - Collects targets from Link/NavLink `to`, navigate(), href, and route-like
//   string literals in nav data files.
// - Does NOT execute the app. Authenticated role crawls are a separate manual
//   step (no local Supabase env in this environment).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'v6']);
const SKIP_FILE = /(^|[\\/])\.[^.]|\.test\.|\.config\./;

// ---------- collect source files ----------
function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (SKIP_DIRS.has(entry)) continue;
    const st = statSync(full);
    if (st.isDirectory()) walk(full, files);
    else if (/\.(jsx?|mjs|cjs)$/.test(entry) && !SKIP_FILE.test(entry)) files.push(full);
  }
  return files;
}

// ---------- route table from App.jsx ----------
function parseRoutes(appSource) {
  // Neutralize element={<.../>} groups so their brackets cannot confuse the
  // Route tokenizer (no element attribute in this file nests braces).
  const source = appSource.replace(/element=\{<[^{}]*?(?:\/>|>)\}/g, 'element=NEUTRALIZED');
  const routes = [];
  const redirects = [];
  const stack = [];
  const tokens = source.matchAll(/(<Route\b[^>]*?>)|(<\/Route>)|(<Navigate\b[^>]*?to="([^"]+)"[^>]*?\/>)/g);

  for (const match of tokens) {
    const [whole, routeTag, close, navigateTag, navigateTo] = match;
    if (navigateTag) {
      redirects.push(navigateTo);
      continue;
    }
    if (close) { stack.pop(); continue; }
    const pathAttr = whole.match(/\bpath="([^"]*)"/);
    const path = pathAttr ? pathAttr[1] : undefined;
    if (whole.endsWith('/>')) {
      if (path !== undefined) routes.push(fullPathWith(stack, path));
      else if (/\bindex\b/.test(whole)) routes.push(fullPathWith(stack, '')); // <Route index/>
    } else {
      stack.push(path); // layout/group wrapper (path may be undefined for groups)
    }
  }
  return { routes: routes.filter(Boolean), redirects };
}

function fullPathWith(stack, child) {
  // Child paths written absolute (e.g. path="/backoffice" nested in a layout
  // route) are used verbatim; relative ones join the parent chain.
  if (child.startsWith('/')) return child === '*' ? '/*' : child;
  const parent = '/' + stack.filter((p) => p !== undefined && p !== '*').join('/').replace(/^\/+|\/+$/g, '');
  const parentIsRoot = parent === '/' || parent === '';
  if (child === '*') return (parentIsRoot ? '' : parent) + '/*';
  if (child === undefined || child === '') return parent || '/';
  return (parentIsRoot ? '' : parent) + '/' + child;
}

// ---------- main ----------
// ---------- target extraction ----------
function collectTargets(files) {
  const targets = new Map(); // target -> [file:line]
  const add = (target, file, line) => {
    if (!target) return;
    if (!targets.has(target)) targets.set(target, []);
    targets.get(target).push(`${relative(ROOT, file)}:${line}`);
  };
  for (const file of files) {
    const isApp = file.endsWith('src' + separator() + 'App.jsx');
    const source = readFileSync(file, 'utf8');
    const lines = source.split('\n');

    lines.forEach((line, index) => {
      // Link/NavLink to="..."
      for (const m of line.matchAll(/\bto="([^"]+)"/g)) add(m[1], file, index + 1);
      // navigate('...') / navigate(`...`) — skip dynamic templates
      for (const m of line.matchAll(/\bnavigate\((['"`])([^'"`]*)\1/g)) add(m[2], file, index + 1);
      // href="..."
      for (const m of line.matchAll(/\bhref="([^"]*)"/g)) add(m[1], file, index + 1);
      // Navigate to="..." inside App.jsx routes (redirect destinations)
      if (isApp) for (const m of line.matchAll(/<Navigate\b[^>]*?to="([^"]+)"/g)) add(m[1], file, index + 1);
      // Route-like string literals in nav data and shell files
      if (!isApp) {
        for (const m of line.matchAll(/['"`](\/(?:backoffice|frontoffice|stores|pos|admin|settings|booking|terms|privacy|pms|rooms|dashboard|store|404|home|signin|signup|login|register|forgot-password|reset-password)[^'"`\s]*)['"`]/g)) {
          add(m[1], file, index + 1);
        }
      }
    });
  }
  return targets;
}

function separator() { return process.platform === 'win32' ? '\\' : '/'; }

// ---------- resolution ----------
const normalize = (target) => String(target || '').split('#')[0].split('?')[0].replace(/\/+$/, '') || '/';

function routeMatches(route, target) {
  if (route === target) return true;
  const routeSegs = route.split('/').filter(Boolean);
  const targetSegs = target.split('/').filter(Boolean);
  if (route.endsWith('/*')) {
    const base = routeSegs.slice(0, -1);
    return targetSegs.slice(0, base.length).join('/') === base.join('/');
  }
  if (routeSegs.length !== targetSegs.length) return false;
  return routeSegs.every((seg, i) => seg.startsWith(':') || seg === targetSegs[i]);
}

function resolve(target, routes, redirects) {
  const path = normalize(target);
  if (redirects.includes(path)) return { ok: true, via: 'redirect-declared' };
  const matches = routes.filter((route) => routeMatches(route, path));
  const specific = matches.filter((route) => !route.endsWith('/*'));
  if (specific.length) return { ok: true };
  if (matches.length) return { ok: false, onlyCatchAll: matches[0] }; // root/frontoffice * swallows it — not a real destination
  // Follow one redirect hop (routes that are Navigate wrappers are not in `routes`,
  // but redirect chains inside App.jsx are declared as plain Navigate targets).
  const redirectTarget = redirects.find((r) => routeMatches(normalize(r), path));
  if (redirectTarget) {
    const t = normalize(redirectTarget);
    const targetMatches = routes.filter((route) => routeMatches(route, t));
    if (targetMatches.some((route) => !route.endsWith('/*'))) return { ok: true, via: `redirect->${t}` };
  }
  return { ok: false };
}

// ---------- main ----------
const appSource = readFileSync(join(SRC, 'App.jsx'), 'utf8');
const { routes, redirects } = parseRoutes(appSource);
const files = walk(SRC);
const targets = collectTargets(files);

// Hash targets are verified against id="..." attributes declared in the same
// file set; a hash with no matching section id is a dead in-page link.
const sectionIds = new Set();
for (const file of files) {
  for (const m of readFileSync(file, 'utf8').matchAll(/\bid="([^"]+)"/g)) sectionIds.add(m[1]);
}

const unresolved = [];
const suspicious = [];
const prefixConstants = [];

for (const [target, locations] of [...targets].sort()) {
  const unique = [...new Set(locations)];
  if (/^https?:\/\//.test(target) || /^(mailto|tel):/.test(target)) continue;
  if (target.startsWith('javascript:')) { suspicious.push(['javascript: link', target, unique]); continue; }
  if (target.startsWith('#')) {
    const id = target.slice(1);
    if (!sectionIds.has(id)) suspicious.push(['hash link with no matching section id', target, unique]);
    continue;
  }
  if (!target.trim()) { suspicious.push(['empty href', target, unique]); continue; }
  if (target.endsWith('/')) { prefixConstants.push([target, unique]); continue; } // startsWith() prefix, not a link
  if (target.includes('${') || target.includes("' +") || target.includes("+ '")) continue; // dynamic — not statically checkable
  const result = resolve(target, routes, redirects);
  if (!result.ok) unresolved.push([target, unique]);
}

console.log(`Routes declared in src/App.jsx: ${routes.length}`);
console.log(`Internal targets checked: ${[...targets.keys()].length}`);
if (unresolved.length) {
  console.log('\nUNRESOLVED targets:');
  for (const [target, locations] of unresolved) console.log(`  ${target}\n    used at ${locations.join(', ')}`);
} else {
  console.log('\nAll internal targets resolve to a declared route.');
}
if (prefixConstants.length) {
  console.log('\nPath prefix constants (startsWith checks, not links):');
  for (const [target, locations] of prefixConstants) console.log(`  ${target}  (${locations.join(', ')})`);
}
if (suspicious.length) {
  console.log('\nSuspicious targets:');
  for (const [kind, target, locations] of suspicious) console.log(`  [${kind}] ${target || '(empty)'}\n    used at ${locations.join(', ')}`);
}

const failed = unresolved.length > 0 || suspicious.some(([kind]) => kind === 'javascript: link');
process.exit(failed ? 1 : 0);
