# OliTechs PMS + POS — cPanel shared-hosting deployment

This guide deploys the Vite/React frontend as static files on cPanel shared hosting.
It does **not** require Docker on the shared server. The existing Docker/GHCR workflow
is retained for a future VPS deployment.

## Safety boundary

- Keep `app.olitechs.co.ke` and the current Vercel production deployment unchanged.
- Use only `staging.olitechs.co.ke` for the first cPanel deployment.
- Do not upload the repository, source files, `.env`, service-role keys, or GitHub secrets
  into the public document root. Upload only the contents of the generated `dist/` folder.
- Do not run Supabase migrations or modify production database records as part of this
  static-hosting deployment.
- A successful static deployment does not prove that local/offline-first Zustand stores
  synchronize between different devices. That requires a separate operational test.

## Build requirements

The project uses Vite. Run:

```bash
npm ci
npm run build
```

Vite writes the deployable site to `dist/`. Files in `public/`, including the Apache
`.htaccess` file, are copied into `dist/` by Vite.

The Supabase browser configuration is compiled into the frontend at build time:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Set these as GitHub Actions secrets/variables for the build workflow, or provide them
to the build environment. The anon/publishable key is intended for browser use and must
be protected by Supabase RLS. Never put `SUPABASE_SERVICE_ROLE_KEY`, database passwords,
or print-agent server secrets in Vite variables or the public build.

## Create the staging subdomain in cPanel

1. In cPanel, open **Domains** and create `staging.olitechs.co.ke`.
2. Note its exact **Document Root** shown by cPanel (do not assume a path).
3. Enable/issue SSL for the staging hostname using cPanel SSL/TLS Status or AutoSSL.
4. Leave DNS and document roots for `app.olitechs.co.ke` and other existing hostnames
   unchanged.

## Upload procedure

1. Build the application using the workflow or a trusted Node.js build environment.
2. Open cPanel **File Manager** and navigate to the staging subdomain's exact document root.
3. Upload the contents of `dist/` (not the `dist` folder itself).
4. Ensure `.htaccess` is uploaded. In File Manager, enable **Show Hidden Files (dotfiles)**.
5. Confirm `index.html` and the `assets/` directory are directly inside the document root.
6. Do not delete or overwrite files belonging to another domain.

For repeat deployments, upload the new build to a temporary folder first, verify that the
upload is complete, then replace the staging document-root contents during a short
maintenance window. Keep a copy of the previous staging build for rollback.

## Apache behavior

The `public/.htaccess` file:
- disables directory listings;
- sends unknown client-side routes to `index.html` for React Router;
- disables caching for `index.html` so users receive the latest asset manifest;
- gives fingerprinted/static assets long-lived cache headers;
- enables compression only when the hosting server has `mod_deflate`.

If the host returns HTTP 500 after upload, temporarily rename `.htaccess` to
`.htaccess.disabled` to confirm whether a directive/module is unsupported, then ask
HostPinnacle support which Apache modules and directives are enabled. Do not leave
routing disabled as the final configuration.

## Staging acceptance checks

- Open `https://staging.olitechs.co.ke` and refresh the page.
- Open a nested React route directly and refresh it; it must not return 404.
- Sign in and sign out using a test account.
- Test password recovery with the staging URL allow-listed in Supabase Auth.
- Check navigation, room rack, reservations, POS, folio, receipts, reports and exports.
- Test printing on the actual property workstation; browser hosting alone does not install
  or run the local print agent.
- Verify data behavior in two separate browsers/devices. Do not assume browser-local state
  is shared between staff devices.
- Check browser console and network requests for missing assets or Supabase errors.

## Rollback

Because this is staging, rollback by restoring the previous staging document-root backup.
Production remains on Vercel throughout these steps. Do not change the production DNS
record until staging has passed the agreed tests and a separate migration plan is approved.
