# OliTechs Print Agent 2.2.2 — release notes

> **Release status: awaiting a signed build.** Do not distribute an unsigned
> installer. OliTechs support supplies the signed build when a workstation is
> ready to upgrade.

## What changed

This release fixes `LOCAL_AGENT_ORIGIN_NOT_ALLOWED` when the app is opened at
`https://olitechs.co.ke` or another official OliTechs host.

The agent now trusts every supported production app origin by default:

- `https://olitechpmspos.vercel.app`
- `https://www.olitechpmspos.vercel.app`
- `https://olitechs.co.ke`
- `https://www.olitechs.co.ke`
- `https://app.olitechs.co.ke`

The Windows installer writes those origins into the service configuration, and
the support script that adds an origin now adds the matching `www`/apex variant
as well. This covers final receipts, shift reports, food and drinks orders,
kitchen and bar slips, and the cash-drawer pulse. No arbitrary third-party
origins are allowed, and the agent stays bound to loopback.

## Existing workstations

An installed 2.2.1 agent can be repaired without reinstalling by running:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\print-agent\service\set-allowed-origin.ps1 -Origin "https://olitechs.co.ke"
```

Confirm in **Settings → Printers → Check agent** that the health panel no longer
says the app address is untrusted, then reprint any failed jobs from **Receipts**.
