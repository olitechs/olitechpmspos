# Supabase Edge Functions deployment

The PMS uses the `print-proxy` Edge Function for direct LAN thermal printing. The browser cannot open raw TCP sockets to a printer, so the Edge Function is the server-side TCP bridge.

## Required GitHub Actions secrets

Add these repository secrets:

- `SUPABASE_ACCESS_TOKEN`: a Supabase personal access token with permission to deploy functions.
- `SUPABASE_PROJECT_REF`: `mszogmazldxjsiytrlxr`

The workflow at `.github/workflows/deploy-supabase-functions.yml` deploys `print-proxy` whenever the function changes on `main`.

## Manual deployment

From the repository root:

```bash
supabase login
supabase link --project-ref mszogmazldxjsiytrlxr
supabase functions deploy print-proxy --project-ref mszogmazldxjsiytrlxr
```

After deployment, the function URL is:

`https://mszogmazldxjsiytrlxr.supabase.co/functions/v1/print-proxy`

The function validates the authenticated user, property printer record, saved IP/port, and only permits TCP ports 9100, 9101, and 9102.
