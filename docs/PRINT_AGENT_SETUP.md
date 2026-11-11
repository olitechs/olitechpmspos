# OliTechs Local Print Agent

The current local agent listens on `127.0.0.1:8631`. Keep this port consistent with the printer settings UI and the Windows installer; changing it to another port without updating those clients will break existing installations.

## Start and verify

On a Windows POS computer, install the agent once as a Windows service so it starts with the computer and keeps printing when nobody is signed in:

```powershell
npm run print-agent:install
```

Open `http://127.0.0.1:8631/health` on the POS workstation. The agent should return JSON with `ok: true`, the agent `version`, `mode: "service"`, its `pid` and `uptimeSeconds`.

Logs are written to `%ProgramData%\OliTechs\PrintAgent\logs\agent.log` (JSON lines, size-rotated, with credentials, raw ESC/POS payloads and guest details redacted). For a manual diagnostic run only, use `npm run print-agent`; it is refused while the service is running because two agents would print the same job twice.

## Network thermal printers

Connect the printer and POS workstation to the same LAN. Give the printer a stable IP address and use its raw ESC/POS TCP port (normally `9100`). From Printer Management, scan the LAN or enter the IP manually, then run **Test & Print**.

The local agent supports the existing endpoints and compatibility aliases:

- `GET /health` or `GET /status` — agent health
- `GET /discover` or `GET /scan-network` — scan private LAN interfaces
- `GET /printers/list` — discover network thermal printers
- `POST /print` — print text or a base64 ESC/POS payload
- `POST /test` — print the connection test receipt
- `POST /open-drawer` — send an ESC/POS cash-drawer pulse
- `GET /windows-printers`, `POST /windows-print`, `POST /windows-test` — Windows spooler transport

For `POST /print`, send `host` and `port` plus either `text` or `escposBase64` (base64-encoded raw ESC/POS bytes). For `POST /open-drawer`, send `host` and `port`. The drawer must be physically connected to the printer's drawer port, and the printer must support the ESC/POS pulse command.

### Automatic drawer opening after cash sales

1. Apply migration `0066_printer_cash_drawer_configuration.sql` through the project's reviewed migration workflow before enabling the setting. The migration is additive and has **not** been applied to production as part of this code change.
2. In **Settings → Printer Management**, edit the LAN receipt printer assigned to **Final Receipts**.
3. Enable **Open cash drawer after cash sale**, then save and run **Test & Print** to verify the printer first.
4. The POS sends the drawer pulse after a completed Cash sale or a Split Payment that includes cash. Card, M-Pesa, bank-transfer, and room-charge-only sales do not trigger it. The setting is off by default.
5. This only sends a pulse; it cannot prove that a drawer physically opened. Confirm the drawer cable is connected to the printer's kick port and verify behavior with the actual hardware.

## Browser origin security

The agent is bound to loopback and now rejects browser requests from untrusted origins. The production app origin `https://olitechpmspos.vercel.app` is allowed, as are localhost origins for development. If using another trusted deployment domain, set `PRINT_AGENT_ALLOWED_ORIGINS` to a comma-separated list of exact origins before starting the agent, for example:

```powershell
$env:PRINT_AGENT_ALLOWED_ORIGINS = "https://your-approved-domain.example"
npm run print-agent
```

Do not expose the agent on a LAN interface or add arbitrary origins. Browsers cannot open raw TCP connections to printer port 9100 directly, so network printing must pass through this local service.

## Supported connection limitations

- Network/Ethernet/Wi-Fi printing uses the local agent and raw ESC/POS TCP.
- Windows-installed printers use the Windows spooler through the agent.
- USB, Bluetooth and serial devices use the browser APIs and require supported Chrome/Edge builds, HTTPS or localhost, and explicit user permission.
- A successful agent response confirms that bytes were accepted by the socket; it cannot confirm paper actually emerged from the printer.
