# OliTechs Print Agent 2.2.1 — release notes

**Release status:** signed release, built from tag `print-agent-v2.2.1`.
**Supersedes:** `2.2.0` (`print-agent-unsigned-2.2.0`), an unsigned internal test
build that failed during service installation. Do not deploy `2.2.0` to a hotel.

**For:** hotel managers, front-office and F&B staff, and OliTechs support.
**What it is:** the small program installed on each Windows POS computer that
sends receipts and kitchen tickets to thermal printers.

## Why upgrade

The `2.2.0` installer copied the agent files but could not register the Windows
service on a normal Windows computer. Two PowerShell scripts did not parse under
Windows PowerShell 5.1, so the service step exited before it could log a useful
error. Pairing was also affected by the same encoding class of defect.

`2.2.1` fixes those blockers and makes a failed install impossible to miss:
an unattended install now returns a non-zero exit code instead of silently
succeeding.

## What changed since 2.2.0

- **Windows PowerShell 5.1 compatibility.** Invalid `catch` syntax and
  non-ASCII characters saved without a BOM were removed. A repository check
  now parses every shipped `.ps1` under Windows PowerShell 5.1 and rejects
  unsafe encodings before a release can be built.
- **A real service-install failure signal.** `install-service.ps1` reports
  stable stage codes, writes `install-result.json`, checks elevation, port
  8631, bundled Node, required modules, disk space and ProgramData access, and
  rolls back a partially registered service.
- **Silent installs fail loudly.** Inno Setup now returns the service installer
  exit code from `GetCustomSetupExitCode`. Message boxes are suppressible, so
  `/VERYSILENT /SUPPRESSMSGBOXES` cannot block an automated deployment.
- **Upgrade and uninstall are tested.** The release workflow installs silently,
  checks the service and `/health`, upgrades over the running service, then
  uninstalls and confirms the service is gone. An unpaired agent is still
  healthy by design; pairing is not required for this check.
- **Uninstall is safer.** Native stderr is captured rather than allowed to
  become a terminating PowerShell error. Printer data and logs are still kept
  unless deletion is explicitly requested.
- **CI is green again.** The lifecycle test now passes a proper `file://` URL
  to `node --import`, so the Windows runner reaches the installer build again.
- **The installer payload is staged safely.** Runtime dependencies are installed
  in an isolated build folder, so npm cannot recursively bundle the PMS project
  into `node_modules` and create paths that break Inno Setup. The release
  workflow injects the public Supabase URL and publishable key so pairing works
  out of the box; no service-role key is ever bundled.
- **Silent installs no longer fail with exit code 10.** The service template's
  `{{ENV_ENTRIES}}` token was checked before it was rendered, so every install
  was rejected as an unknown placeholder. The guard now runs after all tokens
  are filled, and failed smoke tests print the setup, result and service logs
  directly into the workflow.

## Before you install

- Allow about 10 minutes per till computer and have an administrator available.
- Keep the printer switched on and connected. For USB or Bluetooth printers,
  the printer must already be installed in Windows with its driver.
- Have a manager sign-in ready for pairing. The code expires after 10 minutes.
- Windows 10 or 11 x64 is required. Node.js does not need to be installed; the
  installer carries a verified runtime.
- Only use the signed `OliTechsPrintAgentSetup-2.2.1.exe` from the GitHub
  Release. Confirm it against `SHA256SUMS.txt` and the Digital Signatures tab.

## Upgrade path

Run `2.2.1` over the existing installation; no manual uninstall is needed. The
installer stops the running service before replacing files and then registers
the new service. If a `2.2.0` install failed, simply run `2.2.1` as
administrator: it will repair the missing service registration.

After installation:

1. Confirm `http://127.0.0.1:8631/health` reports `ok: true` and version
   `2.2.1`. An unpaired agent is healthy; that is expected until step 2.
2. In OliTechs, open **Settings → Printers → Pair this computer** and enter a
   manager's code. Pairing is what enables queued jobs to print.
3. Print one test receipt and one kitchen ticket. If either fails, use
   **Save diagnostics file** and send it to OliTechs support.

## If something looks wrong

1. In **Settings → Printers**, press **Check agent**.
2. If the service is not running, check
   `%ProgramData%\OliTechs\PrintAgent\logs\install-result.json`. Its `stage`
   and `code` identify the failed step.
3. Press **Save diagnostics file** and send it to support with the printer's
   make and model and what you were printing.
4. Do not uninstall or reinstall by yourself while the hotel is trading.
