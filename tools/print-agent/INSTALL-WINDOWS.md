# OliTechs Print Agent — Windows Service

The OliTechs Print Agent runs as a Windows service, not as a console window. That
means it keeps printing when the cashier closes the browser, closes the
terminal, signs out, or is replaced at the till by another user. Windows starts
it during boot, before anyone signs in.

It bridges the Olitech PMS/POS web application to:

- LAN / Wi-Fi ESC/POS printers (raw TCP, normally port 9100);
- printers installed in Windows (USB or Bluetooth through their driver).

## Install

### Option A — the signed installer (recommended, no terminal)

1. Download `OliTechsPrintAgentSetup-<version>.exe` from OliTechs support.
2. Right-click → **Properties → Digital Signatures** and confirm the signer is
   OliTechs. Windows also shows the publisher on the SmartScreen prompt.
3. Double-click it and approve the administrator prompt.
4. When the pairing window opens, type the code from **OliTechs → Settings →
   Printers → Pair this computer**. Pairing can be skipped and repeated later
   from the Start menu.

Nothing else is needed: Node.js, the service wrapper and the agent are bundled.
Build and sign the installer with `installer/build-installer.ps1`; see
`installer/README.md`.

### Option B — install from a checkout (engineers only)

This path is for a technician with the repository already on the computer. It
still needs `WinSW.exe`, and it uses the system Node.js because no bundled
runtime exists outside the installer.

1. Install Node.js 20 or newer.
2. Copy the OliTechs PMS folder to the computer.
3. Run the service installer as an administrator.

```powershell
npm run print-agent:install
```

After a manual install, pair the computer from Settings → Printers so it can
print jobs queued while it was switched off. A manual install without a
`SUPABASE_URL`/anon key in the service environment can print locally but cannot
pair.

The installer creates the service **OliTechsPrintAgent**, which:

- starts automatically with Windows and needs no signed-in user;
- restarts automatically after an unexpected exit (Service Control Manager
  recovery: 5 s, then 15 s, then 60 s, with the counter reset daily);
- serves `http://127.0.0.1:8631` on the loopback interface only;
- writes structured logs to `%ProgramData%\OliTechs\PrintAgent\logs\agent.log`;
- refuses to start if another agent already owns the installation.

The service wrapper (`WinSW.exe`) is a separate binary. This repository does not
store or download executables, so the script requires either:

- `WinSW.exe` next to `service\install-service.ps1`, or
- `-WinSWPath C:\path\to\WinSW.exe`.

The packaged OliTechs installer ships it; a manual install can point at a copy.

## Verify

```powershell
Get-Service OliTechsPrintAgent
Invoke-RestMethod http://127.0.0.1:8631/health
Test-NetConnection 192.168.2.117 -Port 9100
```

The first two commands should report `Running` and a JSON body containing
`ok: true`, the agent `version`, `mode: "service"`, its `pid` and
`uptimeSeconds`. The third checks that a specific printer answers on the network.

The service must be started by Windows, not by a signed-in user. For the full
acceptance run — browser closed, no terminal, sign-out, restart, crash recovery
and log checks — follow `WINDOWS-ACCEPTANCE-CHECKLIST.md`. It is written for a
supervisor and needs no programming knowledge.

## Logs

```
%ProgramData%\OliTechs\PrintAgent\logs\agent.log
```

One JSON object per line, rotated at 2 MB with 5 files kept. Passwords, tokens,
raw ESC/POS payloads, receipt content and guest details are replaced with
`[redacted]` before anything is written.

## Upgrade

Re-run the installer. It stops and re-registers the service, keeps the printer
configuration, and reports the result. Installing is idempotent.

## Manual run (diagnostics only)

```powershell
npm run print-agent
```

This is refused while the service is running: two agents would claim the same
jobs and print the same ticket twice. Stop the service first if you genuinely
need a console session.

## Uninstall

```powershell
npm run print-agent:uninstall
```

Removes the service and any leftover logon task. Printer data and logs stay in
`%ProgramData%\OliTechs\PrintAgent` so a reinstall keeps its configuration; add
`-RemoveData` to delete them as well.

## Known limitations

- The signed installer is built by the `Print Agent Windows Release` workflow
  on a Windows runner with a code-signing certificate. If the signing secrets
  are not configured the workflow refuses to publish, and an unsigned build
  must not be handed to a hotel.
- The bundled runtime is pinned at build time. Rebuild the installer after a Node
  security release instead of updating Node on each workstation.

- The service runs as `LocalSystem`. Printers installed only for one Windows user
  may not be visible to it; install per-machine drivers where possible. This is
  validated per customer in the Phase 10 compatibility matrix, not assumed.
- RAW ESC/POS through the spooler requires a driver that accepts raw data.
  GDI-only drivers will not produce a usable thermal receipt.
- Automatic power-on after a mains failure depends on BIOS/UEFI settings and the
  hardware; a UPS is recommended for the POS computer and printer.
- A successful print response confirms the printer accepted the bytes. It cannot
  prove paper physically emerged.
