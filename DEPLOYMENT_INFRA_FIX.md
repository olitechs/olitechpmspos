# OliTechs Vercel / SPA Infrastructure Fix

This release fixes the infrastructure layer behind the intermittent module fallback screens and Vercel SPA 404s.

## Included

- `vercel.json` SPA rewrite to `/index.html`.
- `index.html` is served with `no-store, no-cache, must-revalidate`.
- Vite entry chunks use deterministic hashed filenames: `assets/[name]-[hash].js`.
- No service worker files or service-worker registration code are present.
- `.env` is excluded from this release archive; `.gitignore` already ignores `.env` and local variants.
- `ErrorBoundary` now exposes the actual error message/stack and recovery controls.
- `AuthContext` exposes `window.__AUTH_CONTEXT__` for diagnostics.
- `PmsStore` exposes `window.__PMS_STORE__.getState()` and safely handles a missing property id.
- `FeatureGate` safely handles undefined entitlements.
- PMS service calls are isolated behind a catch boundary and return safe fallbacks instead of throwing into module-level ErrorBoundaries.

## Vercel deployment

1. Ensure these Vercel Environment Variables exist for the relevant deployment environments:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
2. Deploy using **Clear Cache and Redeploy**.
3. Test `/`, `/home`, `/dashboard`, and `/reservations` in an Incognito window.
4. If a module still fails, open DevTools Console and filter for `[ErrorBoundary]`. The fallback now shows the real error and stack.

Do not commit a real `.env` file or Supabase credentials to the repository.
