# Print agent deployment checklist

For the release that contains the Windows print service, durable queue, pairing,
diagnostics, printer history and compatibility gate. Work top to bottom; do not
start at step 4.

**Needs:** database backup, a staging project, a Windows 10/11 x64 build machine,
Inno Setup 6, Windows SDK `signtool`, a code-signing certificate, a verified
`WinSW.exe`, and the Node win-x64 zip with its published SHA-256.

## Current release audit (2026-11-19)

The latest published GitHub Release is still
`print-agent-unsigned-2.2.0`, published 2026-11-12. It contains
`OliTechsPrintAgentSetup-2.2.0-UNSIGNED.exe` and is explicitly marked
**UNSIGNED TEST BUILD — NOT FOR HOTEL INSTALLATION**. Its published SHA-256 is
`31cb8e943730056099749217b272b6dee7c89b1dad64ab1a42f6f5cc6c2e5a26`.
Do not distribute or install it on a hotel workstation.

The agent source has newer changes after that artifact:
- 2026-11-16: one-click download and clearer installer diagnostics
  (`8f1b9851`), plus Windows SDK signing-tool discovery fix (`7d82a48a`).
- 2026-11-17: official Sentry Node SDK integration and packaged-service preload
  (`73e7abf5`).

The current source still reports `AGENT_VERSION = 2.2.0`; therefore the
published unsigned installer is not evidence that the 16–17 November source
changes are packaged. The release workflow only runs on a `print-agent-v*` tag
or manual dispatch. A customer release is published only when the installer is
signed; the required repository secrets are
`WINDOWS_CERT_PFX_BASE64` and `WINDOWS_CERT_PASSWORD`, and the
`WINSW_SHA256` repository variable must also be set.

**Release gate: BLOCKED.** No signed customer installer is currently published.
Do not upgrade the reception/POS computer until a signed release has been
published, its SHA-256 and Authenticode signer are verified, and the spare-PC
acceptance checklist has passed.

## Safe in-place upgrade procedure

The installed service keeps its durable state outside the application folder:
`%ProgramData%\\OliTechs\\PrintAgent`. In particular:
- `queue\\journal.ndjson` and `queue\\snapshot.json` hold durable print jobs;
- `agent-credential.json` holds this workstation's pairing credential;
- `logs\\` and `diagnostics\\` hold support evidence.

The installer uses a stable Inno Setup AppId and upgrades the application folder
in place. It does not delete the ProgramData state folder. The service's queue
writes accepted jobs to disk before printing; a job interrupted while marked
`printing` is recovered as `uncertain`, not silently resent. This prevents an
automatic duplicate, but requires a staff member to check the paper before
choosing a deliberate reprint.

1. Schedule the upgrade after trading hours. Stop new print submissions and
   allow any currently printing receipt or ticket to finish.
2. Before installing, inspect
   `http://127.0.0.1:8631/queue` and save the result for the handover. Note any
   `queued`, `printing`, `failed` or `uncertain` jobs. Do not clear or retry
   them just to make the queue look empty.
3. Stop the Windows service after active printing has finished:
   `Stop-Service OliTechsPrintAgent`. Confirm it is stopped.
4. Make a local, access-restricted backup of the complete
   `%ProgramData%\\OliTechs\\PrintAgent` folder before continuing. It contains
   a workstation credential; do not email it, upload it to a public location,
   or share it with guests. Keep the backup on the same protected workstation
   or an approved encrypted support location.
5. Verify the release installer has a valid Authenticode signature from
   **OliTechs** and its SHA-256 matches the release's `SHA256SUMS.txt`.
   If the publisher is unknown, the signature is invalid, or the file is
   marked `UNSIGNED`, stop.
6. Run the signed installer over the existing installation as administrator.
   Do not uninstall first, choose a data-removal option, delete ProgramData, or
   generate a new pairing code unless health confirms the workstation is no
   longer paired.
7. Confirm the service is Running and
   `http://127.0.0.1:8631/health` reports `ok: true`, the expected version and
   `paired: true`. Then inspect `/queue` again. Jobs that were already queued
   should still be present. Any `uncertain` job must be checked against the
   physical printer before a deliberate reprint.
8. Print one test receipt and one kitchen ticket. Confirm correct routing,
   feed and cut. Only then resume normal printing.

The installer now also aborts before replacing application files if the existing
service remains running after its 20-second stop window. This avoids replacing
the bundled runtime underneath a live service. If that guard aborts, do not
force-delete the service or its data; resolve the service stop issue first.

### Rollback

Keep the previous signed installer and the protected ProgramData backup until
the new version has passed the acceptance checks. If rollback is needed, stop
the service, install the previous signed build over the top, and retain the
same ProgramData state. Do not restore an older queue snapshot over newer jobs
unless support has first reconciled the job states; doing so could lose or
duplicate work.


---

## 1. Confirm the two migrations on the production project

Phase 5 (`20261111160000_phase5_agent_print_claim.sql`) and Phase 7
(`20261111170000_phase7_print_agent_pairing.sql`), including the RPC
argument-order compatibility fix, have already been applied to the production
project `mszogmazldxjsiytrlxr`. **Verify; do not reapply them blindly.**

If a fresh environment is being built, apply them in this order and take a
snapshot first. Both are additive, but neither should be run during trading
hours.

Verify (all should return rows):

```sql
select conname from pg_constraint where conname = 'fnb_print_jobs_status_check';
select column_name from information_schema.columns
 where table_name = 'fnb_print_jobs' and column_name in ('claimed_by','lease_expires_at','uncertain_at');
select count(*) from public.print_agent_credentials;
select proname from pg_proc where proname in (
  'fn_claim_fnb_print_jobs','fn_complete_fnb_print_job','fn_expire_fnb_print_leases',
  'fn_create_print_agent_pairing','fn_redeem_print_agent_pairing',
  'fn_print_agent_claim','fn_print_agent_complete',
  'fn_list_print_agent_credentials','fn_revoke_print_agent_credential');
```

Smoke test: print one receipt from the browser as before. The browser path must
be unchanged — this release adds an agent path beside it, not instead of it.

## 2. Confirm the edge function deployed

`supabase/functions/print-proxy/index.ts` changed (origin pin and rate limiting).
The workflow `.github/workflows/deploy-supabase-functions.yml` deploys it
automatically on a push to `main` that touches `supabase/functions/**` — check
that the run for this commit succeeded before going further. If this release
did not touch `supabase/functions/**`, the function was not redeployed and
needs no action.

If it did not run, deploy by hand:

```bash
supabase functions deploy print-proxy --project-ref <project-ref>
```

Then print one receipt through the app: a rejected origin or a 429 here means the
pin or the limit is wrong, and nothing else in this checklist will behave.

## 3. Build and sign the installer

Preferred path: run the **Print Agent Windows Release** workflow. It runs tests,
lint and typecheck, verifies the Node.js download against the published
`SHASUMS256.txt`, verifies `WinSW.exe` against the `WINSW_SHA256` repository
variable, imports the signing certificate from secrets, compiles with Inno
Setup, writes `SHA256SUMS.txt`, uploads the artifact and creates the GitHub
Release only when the result is signed.

Manual fallback on a Windows build machine, from `tools\print-agent\installer`:

```powershell
.\build-installer.ps1 `
  -Version 2.2.0 `
  -WinSWPath C:\build\WinSW.exe `
  -WinSWSha256 <sha256-of-WinSW-x64.exe> `
  -NodeZipPath C:\build\node-v22.14.0-win-x64.zip `
  -NodeSha256 <sha256-from-nodejs.org> `
  -CertificateThumbprint <cert-thumbprint>
```

Or pass `-PfxPath` / `-PfxPassword` instead of the thumbprint. Output:
`dist\installer\OliTechsPrintAgentSetup-2.2.0.exe`.

- The version must match `AGENT_VERSION` in `tools/print-agent/config.mjs` (2.2.0).
- Record the installer's SHA-256 in the release notes, and confirm
  `Get-AuthenticodeSignature` reports a valid signature and timestamp.
- The script refuses to build an unsigned release. An `-AllowUnsigned` build is
  for internal testing only — never give one to a hotel.

## 4. Install one workstation end to end

- [ ] Run the installer as administrator. It installs the service, bundles Node,
      and starts with Windows; no terminal, Node or PowerShell for staff.
- [ ] Service is running in `services.msc`, and
      `http://127.0.0.1:8631/health` returns `ok` with the right version.
- [ ] Logs exist at `%ProgramData%\OliTechs\PrintAgent\logs\agent.log`.
- [ ] Sign in as a manager → **Settings → Printers → Pair this computer**. Health
      then reports `paired: true` with the workstation name. Pairing is what
      makes queued jobs print; a paired agent claims automatically and needs no
      service-role key. (Unpaired agents can still claim only with the Phase 5
      service-key opt-in, which hotels must not use.)
- [ ] Print a test order and a test receipt. Both arrive, cut cleanly.
- [ ] Switch the printer off, print something, switch it back on: the job should
      be waiting, then print once. Switch off and on again mid-job: it must show
      as **Needs checking**, never print twice on its own.
- [ ] Restart the print service with a job queued: no duplicate, no lost job.
- [ ] **Save diagnostics file** produces a JSON file with no tokens or receipt
      text in it.
- [ ] Walk `tools/print-agent/WINDOWS-ACCEPTANCE-CHECKLIST.md` Parts 1–15.

## 5. Printer validation gate — before the hotel goes live

For every printer role in use (receipts, each kitchen/bar point, reports, drawer):

- [ ] Run the eight checks on real paper, including reprint, offline recovery and
      service-restart recovery.
- [ ] Write the record from the template in
      `docs/print-agent/PRINTER-COMPATIBILITY-MATRIX.md`. Never mark a required
      check `pass` if it did not pass.
- [ ] Record it:

```bash
npm run print-agent:compatibility record -- path/to/record.json
npm run print-agent:compatibility status
```

- [ ] Commit the updated `tools/print-agent/compatibility-evidence.json` so the
      evidence is kept with the code.
- [ ] The gate is closed only when `status` prints **`Go-live: ready`**. A
      `conditional` record closes nothing by itself: get the caveat accepted in
      writing by whoever signs off the installation.

An empty evidence log means unvalidated, not "probably fine".

## 6. Rollback

- **Migrations:** additive only, no down migration. Prefer a forward fix; a full
  restore is the fallback and will lose data written since the snapshot.
- **Installer:** stop and remove the service, then install the previous signed
  build. Pairing state lives in `%ProgramData%\OliTechs\PrintAgent\agent-credential.json`.
- **Agent credential:** revoke with `fn_revoke_print_agent_credential`; jobs that
  workstation held become `uncertain`, they are not lost.
- **Edge function:** revert the `print-proxy` change and let CI redeploy, or
  deploy the previous version.

## Do not

- Put a Supabase service-role key on any workstation. Pairing exists for exactly
  this reason.
- Ship an unsigned installer, or skip the reprint/restart checks because the test
  page looked fine.
- Treat a green test suite as hardware proof: the code is tested, the printers
  and Windows service are not until this checklist has been walked on a real POS
  computer.
