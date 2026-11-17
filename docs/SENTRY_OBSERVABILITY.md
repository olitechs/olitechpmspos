# Sentry error monitoring

OliTechs sends sanitized JavaScript error events to the Sentry project configured by its DSN. Monitoring is optional: when the DSN is blank or invalid, the application and Print Agent continue normally with no Sentry requests.

## Configure the web application

In Vercel, open the OliTechs project → Settings → Environment Variables and add:
- `VITE_SENTRY_DSN`: the Sentry project DSN supplied by the project owner.
- `VITE_SENTRY_RELEASE`: optional release identifier, ideally the deployed Git commit SHA or release version.

Apply the variables to Production and Preview as required, then redeploy. Vite variables are embedded at build time, so changing them requires a new deployment.

## Configure each Windows Print Agent

The Print Agent reads these machine environment variables:
- `SENTRY_DSN`: the same Sentry project DSN.
- `SENTRY_ENVIRONMENT`: use `production` for hotel workstations, or `staging` for test machines.
- `SENTRY_RELEASE`: optional agent release/version.

From an elevated PowerShell window, configure the machine-level values (replace the placeholder with the project's DSN):

```powershell
[Environment]::SetEnvironmentVariable('SENTRY_DSN', 'https://PUBLIC_KEY@o0.ingest.sentry.io/PROJECT_ID', 'Machine')
[Environment]::SetEnvironmentVariable('SENTRY_ENVIRONMENT', 'production', 'Machine')
Restart-Service -Name OliTechsPrintAgent
```

If the service is not installed, set the variables before starting the agent. Machine-level environment changes are read by newly started processes; restart the service after changing them.

## What is sent

This implementation uses Sentry's envelope ingestion protocol with built-in browser and Node networking, so it adds no runtime package dependency and does not change the npm lockfile.

- Captures uncaught browser errors, unhandled promise rejections and React ErrorBoundary failures.
- Captures Print Agent startup failures, uncaught exceptions and unhandled rejections.
- Includes environment, optional release, safe component/source tags, error type and sanitized stack-frame locations.
- Removes query strings and fragments from browser stack URLs.
- Does not send exception messages, request bodies, user identity, cookies, headers, form values, order/guest details, receipt/ESC-POS data, printer addresses or credentials.
- Does not enable session replay, user feedback capture, tracing or performance sampling.
- Sentry transport failures are swallowed and must never block hotel operations or printing.

The Sentry DSN is a public ingestion identifier, not an authentication secret. Never put a Supabase service-role key, database password, printer credential or other private secret in a Vite variable or Sentry event.

## Verify safely

Run `npm run test:sentry`, `npm run build` and `npm run test:print-agent`.

For an end-to-end check, use a Sentry test project or staging environment and trigger a controlled test exception in a non-production session. Confirm that an event arrives without customer or printer data. Do not deliberately crash a live hotel workstation.
