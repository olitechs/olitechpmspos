# OliTechs Print Agent — Windows Auto-Start

The OliTechs Print Agent is a local Windows process that bridges the PMS browser to LAN ESC/POS printers and Windows-installed printers.

## Install

From the PMS repository on the POS workstation:

```powershell
npm install
npm run print-agent:install
```

The installer creates a Windows Task Scheduler task named **OliTechs Print Agent**.

The task:
- starts automatically when the POS Windows user logs in;
- runs the agent hidden on `127.0.0.1:8631`;
- automatically restarts the agent after an unexpected exit;
- resolves the current `node.exe` at launch;
- does not require a permanent PowerShell window.

## Verify

```powershell
Invoke-RestMethod http://127.0.0.1:8631/health
Test-NetConnection 192.168.2.117 -Port 9100
```

The first command should report `ok: true`. The second should report `TcpTestSucceeded : True` for a reachable network printer.

## Manual start

For diagnostics:

```powershell
npm run print-agent:run
```

## Uninstall

```powershell
npm run print-agent:uninstall
```

Uninstalling removes only the Windows scheduled task. It does not remove printer configuration or the PMS application.

## Updating the PMS

After pulling a new repository version, reinstalling the task is safe:

```powershell
npm run print-agent:install
```

The scheduled task is replaced with the current runner path and configuration.

## Important

The agent must run on the same Windows workstation as the PMS operator. A Vercel-hosted web application cannot directly open TCP connections to a printer on the hotel's private LAN.
