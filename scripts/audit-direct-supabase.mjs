// Advisory audit: count component/page files that reach Supabase directly
// instead of through src/services/* (the architecture target per
// docs/adr/ADR-0004-services-only-data-access.md). Exits 0 always — it is a
// trend tracker, not a gate; the goal is for the list below to reach zero as
// each screen migrates. Run: node scripts/audit-direct-supabase.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('..', import.meta.url));

function* walk(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (/[/\\]v6[/\\]/.test(join(dir, entry.name))) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

const files = [];
for (const dir of ['src/components', 'src/pages']) {
  for (const f of walk(join(rootDir, dir))) {
    if (/\.(jsx|js)$/.test(f) && !/\.test\./.test(f)) files.push(f);
  }
}

const hits = [];
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  const importsClient = /from ['"]@\/lib\/supabaseClient['"]/.test(text);
  const tables = [...new Set([...text.matchAll(/\.from\(['"]([a-z_0-9]+)['"]\)/g)].map((m) => m[1]))];
  const rpcs = [...new Set([...text.matchAll(/\.rpc\(['"]([a-z_0-9]+)['"]/g)].map((m) => m[1]))];
  const channels = [...new Set([...text.matchAll(/\.channel\(['"]([^'"]+)['"]/g)].map((m) => m[1]))];
  if (!importsClient && !tables.length && !rpcs.length && !channels.length) continue;
  hits.push({ file: f.replace(rootDir, '').replaceAll('\\', '/'), importsClient, tables, rpcs, channels });
}

console.log(`audit-direct-supabase: ${hits.length} component/page files reach Supabase directly (target: 0)`);
for (const h of hits) {
  const parts = [];
  if (h.tables.length) parts.push(`tables: ${h.tables.join(', ')}`);
  if (h.rpcs.length) parts.push(`rpcs: ${h.rpcs.join(', ')}`);
  if (h.channels.length) parts.push(`channels: ${h.channels.join(', ')}`);
  console.log(`  ${h.file}${parts.length ? ' — ' + parts.join('; ') : ''}`);
}
