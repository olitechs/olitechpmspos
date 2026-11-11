# OliTechs Local Print Agent

The OliTechs Local Print Agent runs on each Windows POS workstation and bridges the web application to physical thermal printers.

## Supported transports

### 1. LAN / Network IP
- Raw ESC/POS over TCP.
- Default port: 9100.
- Uses /test and /print.
- Suitable for Ethernet/Wi-Fi thermal printers.

### 2. Windows installed printer / printer driver
- Works with printers installed in Windows Printers & scanners.
- Covers USB printers using a Windows driver and Bluetooth printers paired/installed as a Windows printer.
- OliTechs enumerates installed printers through the Windows spooler.
- Raw ESC/POS is submitted to the selected Windows printer driver using the Windows print spooler.
- Uses /windows-printers, /windows-test and /windows-print.

### 3. USB direct
- Uses browser WebUSB.
- Requires a browser/device that supports WebUSB and a compatible ESC/POS printer.
- The user grants the device permission from OliTechs.

### 4. Bluetooth direct
- Uses browser Web Bluetooth for compatible BLE thermal printers.
- The user pairs the printer from OliTechs.
- The printer must expose a compatible thermal-printer GATT service/characteristic.

### 5. USB / Bluetooth Serial
- Uses Web Serial for printers exposed as a COM/serial device.
- Configurable baud rate: 9600, 19200, 38400, 57600 or 115200.

## Run

On Windows, install it once as a service so it starts with the computer and keeps printing when nobody is signed in:

    npm run print-agent:install

Manual/diagnostic run only (refused while the service is running):

    npm run print-agent

Default listener: http://127.0.0.1:8631

Health check: http://127.0.0.1:8631/health

Structured logs: `%ProgramData%\OliTechs\PrintAgent\logs\agent.log`

The service runs on every Windows POS workstation that uses LAN or Windows-driver printing. See `INSTALL-WINDOWS.md` for service installation, recovery, upgrades and uninstallation.

## Windows printer workflow

1. Install the thermal printer normally in Windows.
2. Confirm it appears under Windows Printers & scanners.
3. Start the OliTechs Print Agent.
4. In Settings → Printers, choose Windows installed printer (USB / Bluetooth driver).
5. Select/enter the Windows printer name.
6. Click Test & Print.
7. OliTechs marks the printer Connected only after the Windows spooler accepts the real ESC/POS test job.

This means a USB or Bluetooth printer does not need to expose a raw TCP port when its Windows driver is installed.

## LAN workflow

1. Select LAN / Network IP.
2. Enter the printer IP, e.g. 192.168.2.117.
3. Use TCP port 9100.
4. Keep agent URL at http://127.0.0.1:8631.
5. Click Test & Print.

The test sends a real ESC/POS page. A configured printer is not shown as Connected merely because its settings were saved.

## Durable print queue

Every real print job is written to disk before any bytes go to the printer, and is only marked printed once the printer confirms it. Test-button pages are deliberately not recorded, because staff expect to repeat them. The record is what makes these promises true:

- **A restart cannot lose a job or print it twice.** A job interrupted by a service stop, crash, power cut or sign-out is reported as `uncertain`, never resent automatically. Someone checks the paper and reprints deliberately if it is missing.
- **A duplicate submission prints once.** The app sends the `fnb_print_jobs` id as an idempotency key (`X-Idempotency-Key`, or `idempotencyKey` in the body). The same job arriving twice — a retried request, a double click, a resend after a browser timeout — finds the existing record instead of producing a second copy. An intentional reprint is a new job row, so it always prints.
- **A switched-off printer stays safe.** A refused connection is `failed` because nothing was sent, so it can be retried. A connection that drops mid-job is `uncertain`, because the paper may already carry part of a receipt.

Queue files live in `%ProgramData%\OliTechs\PrintAgent\queue\`: an append-only journal plus a compacted snapshot. Print data is discarded as soon as a job prints, and finished records are pruned after 7 days or 500 jobs.

Endpoints on the local agent:

- `GET /queue` — counts and the latest 100 jobs (`queued`, `printing`, `printed`, `failed`, `uncertain`).
- `POST /queue/retry` with `{"id":"<job id>"}` — deliberate reprint of a failed or uncertain job. A job that already printed is refused, so a receipt is never silently duplicated.
- `POST /print` and `POST /windows-print` accept `defer: true` to queue a job without waiting for the printer.

`GET /health` includes `queue` counts, so support can see stuck work without opening the app.

Settings: `PRINT_AGENT_QUEUE_MAX_ATTEMPTS` (default 3), `PRINT_AGENT_QUEUE_RETENTION_DAYS` (7), `PRINT_AGENT_QUEUE_MAX_RECORDS` (500), `PRINT_AGENT_QUEUE_DRAIN_MS` (1500).

## Important

The local agent binds to loopback by default. Do not expose it publicly.

The Supabase print-proxy Edge Function may remain available for supported public transports, but private hotel LAN addresses such as 192.168.x.x should use the local agent.