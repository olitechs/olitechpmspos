# Print agent deployment checklist — what is now on `main`

For the release that contains the Windows print service, durable queue, pairing,
diagnostics, printer history and compatibility gate. Work top to bottom; do not
start at step 4.

**Needs:** database backup, a staging project, a Windows 10/11 x64 build machine,
Inno Setup 6, Windows SDK `signtool`, a code-signing certificate, a verified
`WinSW.exe`, and the Node win-x64 zip with its published SHA-256.

---

## 1. Run the two migrations (staging first)

Apply in this order, never the other way round:

1. `supabase/migrations/20261111160000_phase5_agent_print_claim.sql`
2. `supabase/migrations/20261111170000_phase7_print_agent_pairing.sql`

Use the Supabase SQL editor or `supabase db push` after linking. Take a snapshot
first. Both are additive and safe to re-run, but neither has ever been executed
against a real database — run them on staging and read the output before
production. Do not run them during trading hours.

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
that the run for this commit succeeded before going further.

If it did not run, deploy by hand:

```bash
supabase functions deploy print-proxy --project-ref <project-ref>
```

Then print one receipt through the app: a rejected origin or a 429 here means the
pin or the limit is wrong, and nothing else in this checklist will behave.

## 3. Build and sign the installer

On the Windows build machine, from `tools\print-agent\installer`:

```powershell
.\build-installer.ps1 `
  -Version 2.2.0 `
  -WinSWPath C:\build\WinSW.exe `
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
