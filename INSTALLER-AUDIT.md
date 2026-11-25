# Print Agent Windows Installer Audit (Phase 0)

Date: 2026-11-22
Scope: OliTechs Print Agent Windows installer, release `print-agent-unsigned-2.2.0`
(tag commit `1c98ef1`) and repository HEAD.
Status: evidence only. No product code, workflow or release was changed in this phase.

## 1. Executive summary

The 2.2.0 installer does exactly what the field report says: it copies the payload,
then the service step fails with exit code 1 and the installer shows
"The OliTechs Print Agent service could not be installed (exit code 1)".

Root cause is confirmed:

- At tag `1c98ef1`, `tools/print-agent/service/install-service.ps1` line 146 is
  `} catch (_) {`. That is not valid Windows PowerShell 5.1. The file fails to parse.
  PowerShell aborts before line 1 executes, so no transcript, no log line, no
  service registration and no cleanup happens. The process exits 1.
- The same tag also ships a second unparseable script:
  `tools/print-agent/installer/pair-workstation.ps1`. It is BOM-less UTF-8 with
  U+2192 arrows at lines 12 and 109. Windows PowerShell 5.1 reads it as ANSI and
  reports a missing string terminator at line 120. Pairing would fail even if the
  service step had succeeded.

HEAD fixes only the first script. `install-service.ps1` now parses cleanly, but
`pair-workstation.ps1` is still broken at HEAD. There is no fixed release.

Three process failures let this ship:

1. No CI step parses PowerShell with the Windows PowerShell parser.
2. No CI step installs the built installer, starts the service, or calls `/health`.
3. The installer shows a `[Code]` `MsgBox` and then exits 0, so a silent install
   reports success even when the service failed.

The 2.2.0 release must be treated as broken and superseded, not silently deleted.

## 2. Environment and method

Local evidence machine:

| Item | Value |
| --- | --- |
| Windows PowerShell | 5.1.26100.9818 |
| PowerShell 7 (`pwsh`) | not installed |
| Node.js | v26.13.1 |
| Inno Setup | not installed |
| Elevation | `ELEVATED=False` |
| Repo HEAD | `e13c9b68` (`feat/pos-menu-management-v2`) |
| `origin/main` | `9591ff2a` |

Methods used:

- `git archive` of tag `1c98ef1` into a temporary folder.
- `[System.Management.Automation.Language.Parser]::ParseFile()` for every `.ps1`
  under `tools/print-agent`, plus repo `scripts/*.ps1`, under Windows PowerShell 5.1.
- Byte-level encoding inspection (BOM present, count of bytes above 0x7F).
- Direct execution of the tag installer script via
  `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File`.
- Inno Setup 6 documentation for logging, exit codes, `Exec`, `MsgBox`,
  `SuppressibleMsgBox` and `/SUPPRESSMSGBOXES`.
- GitHub Actions run `44869272239` on `main` (workflow_dispatch, version
  `2.2.0-audit`, unsigned, publish disabled) and its full log.
- Local `npm run test:print-agent` run.

Raw evidence is stored outside the repo in
`%TEMP%\print-agent-audit\` (`parse-tag.json`, `parse-head.json`,
`tag-run-stdout.txt`, `tag-run-stderr.txt`, `ci-build.log`,
`local-test-print-agent.log`).

## 3. Script parse results (Windows PowerShell 5.1)

### 3.1 Tag `1c98ef1` - FAILS

Nine `.ps1` files were parsed, including the two repo-level `scripts/*.ps1`.
Seven belong to the print agent.

| File | Errors |
| --- | --- |
| `tools/print-agent/service/install-service.ps1` | 2 |
| `tools/print-agent/installer/pair-workstation.ps1` | 2 |
| `tools/print-agent/install-windows.ps1` | 0 |
| `tools/print-agent/run-windows.ps1` | 0 |
| `tools/print-agent/uninstall-windows.ps1` | 0 |
| `tools/print-agent/installer/build-installer.ps1` | 0 |
| `tools/print-agent/service/uninstall-service.ps1` | 0 |
| `scripts/export-production-schema.ps1` | 0 |
| `scripts/verify-production-schema.ps1` | 0 |

`install-service.ps1`:

```
line 146 col 10: The Catch block is missing its statement block.
line 146 col 15: Unexpected token '{' in expression or statement.
```

`pair-workstation.ps1`:

```
line 120 col 93: The string is missing the terminator: '.
line 108 col 49: Missing closing '}' in statement block or type definition.
```

The reported lines are misleading because the real cause is encoding. The file is
UTF-8 without a BOM and contains six non-ASCII bytes (two U+2192 arrows, the rest
in the same characters). Parsing the same bytes explicitly as UTF-8 gives zero
errors; parsing them as Windows PowerShell 5.1 does (ANSI) gives the two errors
above. This is exactly the failure class the user reported.

### 3.2 HEAD - PARTIAL PASS

`install-service.ps1` has zero parse errors at HEAD (`} catch {`). However:

| File | Errors |
| --- | --- |
| `tools/print-agent/installer/pair-workstation.ps1` | 2 (same as tag) |
| all other print-agent `.ps1` files | 0 |

Conclusion: the syntax defect that broke the 2.2.0 service install is fixed on
main, but the pairing path is still broken in the same way at HEAD. A HEAD build
would install the service and then silently fail the pairing step. HEAD is not
release-ready either.

### 3.3 Encoding inventory

| File | UTF-8 BOM | Non-ASCII bytes |
| --- | --- | --- |
| `tools/print-agent/installer/pair-workstation.ps1` | no | 6 |
| every other print-agent `.ps1` | no | 0 |

The repo currently has no encoding rule or check, so a file saved as UTF-8 by a
modern editor can silently become "unparseable" for users running Windows
PowerShell 5.1.

## 4. Runtime proof that the 2.2.0 failure is the parse error

The tag `install-service.ps1` was executed directly:

```
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass \
  -File <tag>\tools\print-agent\service\install-service.ps1 \
  -WinSWPath C:\does-not-exist\WinSW.exe
```

Result:

- Exit code: `1`
- stdout: empty
- stderr:

```
At ...\tools\print-agent\service\install-service.ps1:146 char:10
+   } catch (_) {
+          ~
The Catch block is missing its statement block.
...
FullyQualifiedErrorId : MissingCatchHandlerBlock
```

This matches the dialog text exactly. Because parsing fails before execution, the
`Start-Transcript` at line 18 never runs. The user is told to read
`install-service.log`, but on a fresh 2.2.0 failure that log may not exist at all
or may contain only an older run.

## 5. Inno Setup behaviour verified

### 5.1 Logging

`SetupLogging=yes` is equivalent to passing `/LOG`. Inno writes a uniquely named
log in the current user's `%TEMP%` directory; it never overwrites or appends.
`/LOG="<path>"` forces a fixed path but overwrites. The current installer sets
`SetupLogging=yes` (`.iss` line 43), so a setup log exists after any run, but its
location is not shown to the user and it is not included in support collection.

### 5.2 How the child exit code reaches the dialog

`RunServiceInstaller()` uses:

```pascal
Exec('powershell.exe', Params, ..., ewWaitUntilTerminated, Code)
```

Inno documents that with `ewWaitUntilTerminated`, a successful launch returns
`True` and `ResultCode` receives the child process exit code. The current code
therefore does surface the PowerShell exit code in the dialog (`exit code 1` in
the field), but only as a number, with no stage meaning, no log tail and a
doubled-backslash path.

### 5.3 Silent installs return success on failure

Inno's own exit codes are: 0 success, 1 init failure, 2 user cancel, 3/4 fatal,
5 cancel/abort, and so on. The current `[Code]`:

- shows a `MsgBox` when the service step fails,
- sets an internal `ServiceInstallFailed` flag used only to skip pairing,
- never calls `Abort`, never returns an error from `PrepareToInstall`, and never
  changes the setup exit code.

Therefore a `/VERYSILENT /SUPPRESSMSGBOXES` install whose service step failed
still finishes with exit code 0. Deployment scripts and CI cannot detect it.

Additionally, Inno documents that `MsgBox` from `[Code]` is one of the five
message boxes that `/SUPPRESSMSGBOXES` does **not** suppress. The correct
silent-friendly call is `SuppressibleMsgBox`. The current dialog therefore both
blocks unattended installs and is invisible to their exit codes.

`Abort` is only honoured from specific events (`InitializeSetup`,
`InitializeWizard`, `CurStepChanged(ssInstall)`, and uninstall equivalents). It is
**not** honoured from `CurStepChanged(ssPostInstall)`, which is where the service
install currently runs. A Phase 3 fix must move the failure path to
`PrepareToInstall` or another supported event, or use a supported custom-exit
mechanism, and must test the silent exit code in CI.

## 6. CI build and install attempt (Phase 0 requirement 3)

### 6.1 Build attempt

Command:

```
gh workflow run print-agent-release.yml --ref main \
  -f version=2.2.0-audit -f publish_release=false -f allow_unsigned=true
```

Run: `44869272239`, conclusion `failure`, job `installer`.

The run failed **before** Inno Setup was installed or the installer was built, at
step `Print agent checks` -> `npm run test:print-agent`:

```
not ok 91 - starts as a service, reports health and refuses untrusted browser origins
not ok 92 - refuses to run a second agent against the same installation
not ok 93 - an occupied port produces a clear error instead of a silent half-start
```

All three fail with:

```
Error [ERR_UNSUPPORTED_ESM_URL_SCHEME]: Only URLs with a scheme in: file, data,
and node are supported by the default ESM loader. On Windows, absolute paths must
be valid file:// URLs. Received protocol 'd:'
```

Cause: `tools/print-agent/server.lifecycle.test.mjs` passes an absolute Windows
path (`fileURLToPath(...)`) to `node --import`. Node 22 on the runner interprets
`D:\...` as URL scheme `d:`. This was introduced after the last successful
release run `43817096412` (2026-11-16, `main` at `90b012dd`). The same pattern is
used twice (lines 39 and 155).

Consequence: **no installer artifact was produced**, so the requested "build HEAD
and install it silently on the runner" could not be executed from CI.

### 6.2 Runner install step is absent

Even if the tests passed, `.github/workflows/print-agent-release.yml` only:

1. checks out,
2. installs dependencies,
3. runs print-agent tests,
4. runs lint/typecheck/architecture,
5. installs Inno Setup,
6. downloads and verifies Node and WinSW,
7. builds and uploads the installer,
8. optionally publishes.

It never runs the installer, never checks the service, never calls `/health`,
never upgrades, and never uninstalls. The workflow therefore cannot detect the
2.2.0 defect. The publish step does not depend on any smoke test because none
exists.

### 6.3 Why the runner install was not performed locally

- The local machine is not elevated (`ELEVATED=False`); registering a service
  requires administrator rights.
- Inno Setup is not installed locally, and no prebuilt HEAD installer exists.
- Installing the published 2.2.0 asset would only reproduce the known tag
  failure and would modify this workstation.
- The workflow cannot be changed without a push, which is currently forbidden.

Requirement 3 is therefore **partially blocked**: build attempt evidence exists,
but the runner install must be executed in Phase 4 (or in a temporarily
authorised audit workflow). This is called out for a decision at the end of this
document.

### 6.4 Local test run (context)

For comparison, the same test command locally produced:

```
tests 108
pass 96
fail 11
```

The 11 local failures are `ERR_MODULE_NOT_FOUND: Cannot find package
'@sentry/node'`, because the developer machine has not run the payload
`npm install --prefix tools/print-agent`. They are environmental, not the CI
failure, but they show that `npm run test:print-agent` is not self-contained on a
fresh checkout.

## 7. Additional installer defects found

Severity: Blocker = caused the field failure; High = can silently produce a
non-working install; Medium = support/diagnosis or edge-case failure; Low = docs.

| # | Severity | Finding | Evidence |
| --- | --- | --- | --- |
| 1 | Blocker | 2.2.0 `install-service.ps1` cannot parse in PS 5.1 | Section 3.1, 4 |
| 2 | Blocker | `pair-workstation.ps1` cannot parse in PS 5.1 at tag **and HEAD**; pairing never runs, installer ignores its exit code | Section 3.1, 3.2; `.iss` `[Run]` line 77 |
| 3 | Blocker | Silent install returns 0 when the service step fails | Section 5.3 |
| 4 | High | `MsgBox` is not suppressible; silent install can block or hide failure | Section 5.3 |
| 5 | High | Running service + `/health` not answering is only a yellow warning; install exits 0 | `install-service.ps1` lines 169-195 |
| 6 | High | No elevation preflight; non-admin runs fail with a generic exit 1 after modifying ProgramData | `install-service.ps1` |
| 7 | High | No port 8631 preflight; a stale manual node process / scheduled task causes an opaque start failure | `install-service.ps1`; `service.package.test.mjs` is regex-only |
| 8 | High | No Node version check. `--import` needs 20.6+; a PATH `node.exe` could be older and fail at runtime | `install-service.ps1` lines 45-55; XML template arguments |
| 9 | High | No module-resolution check for `@sentry/node`; bundled runtime failure is only visible in the agent log | `instrument.mjs`, `build-installer.ps1` |
| 10 | High | No ProgramData write / disk space / .NET Framework preflight for WinSW 2.12 | `install-service.ps1` |
| 11 | High | Failure after `WinSW install` leaves a registered service behind; no rollback | `install-service.ps1` lines 133-167 |
| 12 | High | Native commands use `2>&1` and `2>$null` under `$ErrorActionPreference='Stop'`; stderr can become a terminating error in Windows PowerShell 5.1 | lines 88, 90, 133, 139, 145, 146 |
| 13 | Medium | Stale service registration ("marked for deletion") is not detected; WinSW returns a generic failure | lines 82-93, 133-142 |
| 14 | Medium | Doubled backslashes in the log path: `'OliTechs\\PrintAgent\\logs'` | line 15; `.iss` line 173 |
| 15 | Medium | Start failure log does not include the last 50 agent log lines or SCM/Application events | lines 159-167 |
| 16 | Medium | `/health` retry loop does not sleep when a response arrives with `ok: false`; it can exhaust all 20 attempts in milliseconds | lines 170-177 |
| 17 | Medium | `.iss` `StopExistingAgentService` ignores `sc stop` failure and waits 20s; upgrade can hit locked `node.exe` files | `.iss` lines 125-139 |
| 18 | Medium | `.iss` detects "RUNNING" with `findstr /I`; SCM state text can be localized, so the loop can run the full timeout on non-English Windows | `.iss` lines 110-118 |
| 19 | Medium | Upgrade stops the service before file copy but never verifies deletion, and never handles a service marked for deletion | `.iss` lines 120-139 |
| 20 | Medium | Uninstall does not wait for or verify service deletion; failure is swallowed | `uninstall-service.ps1` lines 14-28 |
| 21 | Medium | No log-folder opener and no log tail in the failure dialog | `.iss` lines 167-175 |
| 22 | Medium | No support-bundle collection (setup log, install result, agent logs, `sc qc`, listeners) | none exists |
| 23 | Medium | CI has no syntax check, encoding check, install smoke test, upgrade test, uninstall test, or negative tests | workflow |
| 24 | Medium | Publish step can run without any install evidence | workflow lines 158-175 |
| 25 | Medium | CI is currently red on `main` because of the `--import` absolute-path bug in lifecycle tests | run `44869272239` |
| 26 | Low | `install-print-agent.cmd` still says the agent "starts automatically at Windows logon"; the service starts at boot | `install-print-agent.cmd` |
| 27 | Low | Installer contract tests are regex-only and do not execute the scripts; `installer.contract.test.mjs` is not even in `test:print-agent` | `package.json`, tests |
| 28 | Low | The 2.2.0 release is a prerelease labelled UNSIGNED, but nothing prevents future unsigned builds from being published under a tag | workflow |

## 8. What already works and must be preserved

- WinSW and Node downloads happen at **build** time only; checksums are verified
  in the workflow and in `build-installer.ps1`.
- The payload contains no Supabase service-role key; `build-installer.ps1`
  scans the staged payload for one and fails the build.
- The service runs as `LocalSystem`, starts automatically, and has SCM recovery
  actions.
- Pairing uses a single-use code and stores a scoped workstation credential.
- `/health` reports `ok: true` on an unpaired agent (`paired: { paired: false }`).
  Unpaired must remain a healthy state, not an install failure.
- `install-service.ps1` at HEAD supports reinstall over an existing service,
  removes the legacy logon scheduled task, and writes a transcript.
- The `Unblock`/SmartScreen guidance for the unsigned build is documented only
  partially; Phase 5 will complete it.

## 9. Exit-code plan for Phase 2

These codes are proposed only; Phase 2 will implement and test them.

| Code | Stage |
| --- | --- |
| 10 | Required template or script missing |
| 11 | Node runtime missing, not executable, or older than 20.6 |
| 12 | WinSW missing or not executable |
| 13 | Not elevated |
| 14 | Port 8631 occupied by another process |
| 15 | Stale service registration ("marked for deletion") |
| 16 | WinSW install failed |
| 17 | Service did not reach Running |
| 18 | Service running but `/health` did not answer |
| 19 | Required Node module (`@sentry/node`) or entry point cannot be imported |

Plus `install-result.json` next to `install-service.log`, with stage, code,
message, timestamp, versions and the resolved paths.

## 10. Acceptance status for Phase 0

| Check | Status | Evidence |
| --- | --- | --- |
| 2.2.0 scripts fail the syntax check | PASS | Section 3.1 (2 files) |
| HEAD passes the syntax check | PARTIAL | `install-service.ps1` passes; `pair-workstation.ps1` still fails |
| Tag service step exits 1 before logging | PASS | Section 4 |
| Inno logging/exit-code behaviour understood | PASS | Section 5 |
| Build HEAD installer in CI | BLOCKED | Run `44869272239` failed in tests; no artifact |
| Silent install on runner, record service/health | DEFERRED | Approved decision: executed in Phase 4 as part of the smoke test |
| Every other failure listed | PASS | Section 7 |

## 11. Recommended order after approval

1. Phase 1: syntax + encoding checks, including fixing `pair-workstation.ps1`,
   and fix the doubled backslashes. These are prerequisites for a green CI.
2. Fix the lifecycle `--import` test bug so CI can reach the build step again.
3. Phase 2-4: hardening, silent exit behaviour, and the install-upgrade-uninstall
   smoke test.
4. Phase 5: 2.2.1 release, supersede 2.2.0 with the user's approval, docs.
5. Phase 6: field checklist on a real POS PC.

## 12. Decision required

Requirement 3 asks for a silent install on a Windows runner in Phase 0. That
needs a workflow change, which needs a push. The current rules forbid pushing.

Option A (recommended): defer the runner install to Phase 4, where the smoke test
is a deliverable and will be committed with the product changes. Phase 0 evidence
above already proves the tag defect and the HEAD gaps.

Option B: authorise a temporary audit branch and workflow push solely to run the
silent install now, then delete the branch.

**Decision (2026-11-22): Option A approved by the user.** The runner install and
service/health assertions are deferred to Phase 4. No temporary audit branch or
workflow push will be created.

No product code changes have been made. Stopping here for approval.

## 13. Phase 4 implementation (quiet exit and smoke test)

Status: implemented locally, not pushed, tagged or executed on a hosted runner.

- `OliTechsPrintAgent.iss` now implements `GetCustomSetupExitCode`. When the
  service step fails, a `/VERYSILENT /SUPPRESSMSGBOXES` setup exits with the
  `install-service.ps1` stage code instead of 0. A child that cannot be launched
  returns 26. Staff still get a `SuppressibleMsgBox` in an interactive install,
  so unattended runs are never blocked.
- `smoke-test-installer.ps1` runs an elevated Windows runner through silent
  install, service/`install-result.json`/`/health` checks, a second silent
  install as an upgrade, and a silent uninstall. `/health` is asserted to be
  `ok: true` but pairing is deliberately not required.
- The release workflow runs that smoke test before uploading the artifact or
  publishing a release.
- `uninstall-service.ps1` captures native stdout/stderr through `Start-Process`
  instead of `2>$null`, waits for the service to disappear, and fails visibly if
  it cannot be removed. Printer data and logs are still kept by default.
- `installer.contract.test.mjs` and `service.package.test.mjs` cover these
  behaviours; `installer.contract.test.mjs` is now part of
  `npm run test:print-agent`.

The hosted-runner install/upgrade/uninstall assertions cannot be executed until
this work is pushed and a workflow is run. No `2.2.1` tag or release has been
created, and `print-agent-unsigned-2.2.0` has not been touched.
