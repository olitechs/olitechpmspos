# Sentry error monitoring

OliTechs uses two independent Sentry integrations. The browser reporter remains in `src/lib/sentry.js` and is initialized by the Vite/React application. The Windows Print Agent uses the official `@sentry/node` SDK and preloads it before the agent entry point. Monitoring is optional; without a valid DSN, both applications continue normally.

## Browser application

In Vercel, configure:
- `VITE_SENTRY_DSN`: the Sentry project DSN.
- `VITE_SENTRY_RELEASE`: optional release identifier.

Vite variables are embedded at build time, so redeploy after changing them. Browser verification is independent:

```bash
npm run test:sentry:frontend
```

These tests verify that the browser reporter stays disabled without a DSN and emits a sanitized event envelope when enabled.

## Node.js Print Agent

The repository dependency is `@sentry/node`. The agent initializes the SDK in `tools/print-agent/instrument.mjs` and loads it before application modules with Node's `--import` flag.

The supported launch command is:

```bash
node --import ./tools/print-agent/instrument.mjs tools/print-agent/print-agent-v2.js
```

Configure each Windows workstation/service with:
- `SENTRY_DSN`: the Sentry project DSN.
- `SENTRY_ENVIRONMENT`: `production` for hotel workstations or `staging` for test machines.
- `SENTRY_RELEASE`: optional agent version or commit SHA.

The Windows service template preloads the same instrumentation. The click-once installer installs the SDK runtime dependencies into its staged Print Agent payload, so the bundled Node runtime can resolve `@sentry/node` without requiring Node or npm on the hotel workstation.

After setting machine-level variables, restart the Windows service so the new process reads them. Do not use a real guest workstation to trigger test failures.

Node verification is independent:

```bash
npm run test:sentry:node
npm run test:print-agent
```

The SDK adapter tests use a controlled mock SDK and do not send a live event. The Node instrumentation's `beforeSend` hook strips exception messages, request/user context, breadcrumbs and unsafe tags while retaining a generic error type and sanitized stack locations. `sendDefaultPii` is disabled.

## Privacy and transport

- The browser integration continues using its existing sanitized envelope reporter; it is not replaced with the Node SDK.
- The Print Agent uses the official SDK for exception capture, delivery retries/transport and process integrations.
- Exception messages, user identity, request bodies, cookies, headers, guest/order/payment details, receipt contents, printer addresses and credentials must not be sent.
- Sentry transport failures must not block printing or agent startup.
- No Session Replay or performance tracing is enabled.

The DSN is a public ingestion identifier, not an authentication secret. Never put a Supabase service-role key or another private credential in a Vite variable or Sentry event.

## Controlled end-to-end check

Use a Sentry staging project or staging environment and trigger a controlled exception only on a test workstation. Confirm receipt in the Sentry project and verify that the event contains no customer or printer data. The automated tests above validate local reporting behavior; they do not prove that a live Sentry project received an event.
