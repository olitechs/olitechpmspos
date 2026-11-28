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

The agent is bound to loopback and rejects printer commands from untrusted browser origins. The official production hosts `https://olitechpmspos.vercel.app`, `https://olitechs.co.ke`, `https://www.olitechs.co.ke` and `https://app.olitechs.co.ke` are allowed, as are localhost origins for development. A custom deployment must be added as an exact origin. These origins cover every local-agent print path: final receipts, shift reports, food/drinks orders, kitchen and bar void slips, and the cash drawer pulse.

`GET /health` is deliberately readable from any browser origin so Printer Settings can explain a mismatch instead of showing only "Failed to fetch". Its JSON includes `requestOrigin`, `originAllowed`, and `allowedOrigins`. Only `GET`/`OPTIONS /health` are public; `/print`, `/pair`, `/discover`, `/queue` and every other route stay allowlisted.

For a development console run, set the extra origin before starting the agent:

```powershell
$env:PRINT_AGENT_ALLOWED_ORIGINS = "https://your-approved-domain.example"
npm run print-agent
```

For the Windows service installer, pass the same value at build time so every workstation receives it in the service XML:

```powershell
./tools/print-agent/installer/build-installer.ps1 -AppOrigin "https://your-approved-domain.example"
```

The release workflow reads `PRINT_AGENT_APP_ORIGIN` (and the public `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`) from repository variables. For an already installed service, run the support script from the installed agent folder (or the repository checkout). It updates the service XML, adds the matching `www`/apex variant, and restarts the service. If staff opened the app at `https://olitechs.co.ke`, use that exact address:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\print-agent\service\set-allowed-origin.ps1 -Origin "https://olitechs.co.ke"
```

The underlying entry in `%ProgramData%\OliTechs\PrintAgent\service\OliTechsPrintAgent.xml` is:

```xml
<env name="PRINT_AGENT_ALLOWED_ORIGINS" value="https://olitechs.co.ke,https://www.olitechs.co.ke" />
```

Do not expose the agent on a LAN interface or add arbitrary origins. A page on an allowed origin can send jobs to the workstation printers, so only exact company-controlled app origins belong here. Browsers cannot open raw TCP connections to printer port 9100 directly, so network printing must pass through this local service.

## Supported connection limitations

- Network/Ethernet/Wi-Fi printing uses the local agent and raw ESC/POS TCP.
- Windows-installed printers use the Windows spooler through the agent.
- USB, Bluetooth and serial devices use the browser APIs and require supported Chrome/Edge builds, HTTPS or localhost, and explicit user permission.
- A successful agent response confirms that bytes were accepted by the socket; it cannot confirm paper actually emerged from the printer.
