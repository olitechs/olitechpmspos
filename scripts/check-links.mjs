// Link checker: verifies every static internal navigation target in src/
// resolves to a route defined in src/App.jsx, and that every /-rooted asset
// path referenced from src/ exists in public/.
//
// Usage: node scripts/check-links.mjs
// Exit code 0 = all targets resolve; 1 = broken targets found.
// Added in Phase 1 of the audit (AUDIT.md B1/B2/F18). Run via `npm run check:links`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const PUBLIC = path.join(ROOT, 'public');

/* ---------- route extraction from src/App.jsx ---------- */

// Walk the JSX <Route> tree of AppRoutes with a stack, resolving relative
// child paths against their parent <Route> paths. Dynamic segments and
// splats are preserved for matching later.
// Note: JSX attribute values may themselves contain '>' and '/>' (e.g.
// element={<Layout/>}), so tags are scanned quote-aware instead of using a
// naive regex.
export function extractRoutes(appJsx) {
  const start = appJsx.indexOf('function AppRoutes');
  const body = start === -1 ? appJsx : appJsx.slice(start);
  const routes = new Set();
  const stack = [];
  const openRe = /<Route(?=[\s/>])/g;
  openRe.lastIndex = 0;
  let i = 0;
  while (i < body.length) {
    openRe.lastIndex = i;
    const openMatch = openRe.exec(body);
    const closeIdx = body.indexOf('</Route>', i);
    if (closeIdx !== -1 && (openMatch === null || closeIdx < openMatch.index)) {
      stack.pop();
      i = closeIdx + '</Route>'.length;
      continue;
    }
    if (openMatch === null) break;
    // scan forward from after the tag name, so the Route tag's own '<'
    // isn't counted as a nested JSX element.
    let j = openMatch.index + '<Route'.length;
    let quote = null;
    let jsxDepth = 0;
    for (; j < body.length; j++) {
      const ch = body[j];
      if (quote) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '<' && /[A-Za-z/]/.test(body[j + 1] || '')) jsxDepth++;
      else if (ch === '>') {
        if (jsxDepth > 0) jsxDepth--;
        else break; // this '>' closes the <Route> tag itself
      }
    }
    if (j >= body.length) break; // truncated source; bail out
    const tag = body.slice(openMatch.index, j + 1);
    let k = j - 1;
    while (k > openMatch.index && /\s/.test(body[k])) k--;
    const selfClosing = body[k] === '/';
    const pathMatch = tag.match(/\bpath="([^"]*)"/) || tag.match(/\bpath='([^']*)'/);
    const raw = pathMatch ? pathMatch[1] : null;
    const parent = stack.length ? stack[stack.length - 1] : '';
    if (raw !== null) {
      const isRelative = raw !== '/' && !raw.startsWith('/');
      const full = isRelative ? `${parent}/${raw}`.replace(/\/+/g, '/') : raw;
      routes.add(full);
      if (!selfClosing) stack.push(full.replace(/\/$/, ''));
    } else if (!selfClosing) {
      // pathless Route (guard wrappers, index groups): keep parent context
      stack.push(parent);
    }
    i = j + 1;
  }
  return routes;
}

function routeToMatcher(routePath) {
  const segments = routePath.split('/').filter(Boolean);
  // Splat routes are fallbacks (resolve to 404 or catch-all redirects), not
  // real destinations — they must never validate a nav target.
  const isFallback = segments.includes('*');
  return {
    segments,
    isFallback,
    matches(targetSegments) {
      if (isFallback) return false;
      let i = 0;
      for (; i < segments.length; i++) {
        const seg = segments[i];
        const t = targetSegments[i];
        if (t === undefined) return false;
        if (seg.startsWith(':')) continue; // dynamic segment matches one part
        if (seg !== t) return false;
      }
      return i === targetSegments.length;
    },
  };
}

/* ---------- target extraction ---------- */

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(jsx?|mjs|cjs)$/.test(entry.name)) yield full;
  }
}

function extractTargets() {
  const targets = [];
  const patterns = [
    /\bto="([^"]+)"/g,
    /\bto='([^']+)'/g,
    /\bnavigate\(\s*['"]([^'"]+)['"]/g,
    /\bhref=["']([/#][^"']*)["']/g,
    // data-driven nav models (navArchitecture, sidebarNavigation, layouts):
    // destinations are plain `path: '...'` object entries
    /\bpath:\s*['"]([^'"]+)['"]/g,
  ];
  for (const file of walk(SRC)) {
    const rel = path.relative(ROOT, file).replaceAll('\\', '/');
    const text = fs.readFileSync(file, 'utf8');
    for (const re of patterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        const value = m[1];
        const line = text.slice(0, m.index).split('\n').length;
        // skip template/interpolated targets
        if (value.includes('${') || value.includes('+')) continue;
        targets.push({ file: rel, line, value });
      }
    }
  }
  return targets;
}

/* ---------- asset existence ---------- */

const ASSET_EXTENSIONS = /\.(svg|png|jpe?g|gif|webp|ico|ttf|otf|woff2?|json|txt|css|webmanifest)$/i;

function publicHas(relPath) {
  const candidate = path.join(PUBLIC, relPath.replace(/^\//, ''));
  return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
}

/* ---------- main ---------- */

export function runCheck({ log = console.log, error = console.error } = {}) {
  const appJsx = fs.readFileSync(path.join(SRC, 'App.jsx'), 'utf8');
  const routes = extractRoutes(appJsx);
  const matchers = [...routes].map(routeToMatcher);

  const broken = [];
  const assetBroken = [];
  for (const target of extractTargets()) {
    const value = target.value.split('?')[0].split('#')[0];
    if (value.startsWith('http')) continue;
    if (ASSET_EXTENSIONS.test(value)) {
      if (!publicHas(value)) assetBroken.push({ ...target, value });
      continue;
    }
    if (!value.startsWith('/')) continue;
    const segs = value.split('/').filter(Boolean);
    if (segs.length === 0) continue; // '/' itself
    if (!matchers.some((matcher) => matcher.matches(segs))) broken.push(target);
  }

  log(`check-links: ${routes.size} routes extracted from src/App.jsx`);
  if (routes.size === 0) {
    error('check-links: could not extract any routes — aborting (parser failure).');
    return 2;
  }

  if (broken.length) {
    error(`\nBROKEN NAV TARGETS (${broken.length}):`);
    for (const b of broken) error(`  ${b.file}:${b.line} -> "${b.value}"`);
  }
  if (assetBroken.length) {
    error(`\nMISSING PUBLIC ASSETS (${assetBroken.length}):`);
    for (const b of assetBroken) error(`  ${b.file}:${b.line} -> "${b.value}"`);
  }
  if (!broken.length && !assetBroken.length) {
    log('check-links: all internal navigation targets and asset references resolve. OK');
    return 0;
  }
  return 1;
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  process.exit(runCheck());
}
