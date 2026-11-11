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

## Pairing this computer (recommended)

A paired workstation prints jobs queued in the cloud with its **own** credential, not a service-role key:

1. On the POS computer, open **Settings → Printers** while signed in as a manager.
2. Press **Pair this computer** in the print agent panel. OliTechs asks the server for a 10-minute, single-use code and hands it to the agent on `127.0.0.1`.
3. The agent exchanges the code for a random secret, stores it at `%ProgramData%\OliTechs\PrintAgent\agent-credential.json` (readable only by the service account) and starts claiming jobs for that property.

The browser is only a courier for the short code: the long-lived secret never reaches the browser, a log line or the network from this machine. The database stores `md5(secret)`, so a database copy cannot be replayed. Unpairing through `fn_revoke_print_agent_credential` invalidates the credential and turns any job that workstation was holding into `uncertain` rather than losing it.

No terminal is needed on the workstation, and no service-role key is collected by the installer. `POST /pair` (local only, five requests a minute) accepts `{"code":"ABCD2345"}`; `GET /health` reports `paired` and the agent name without the secret.

The local API is also rate limited per client and route class (prints 60/min, queue 30/min, discovery 6/min, pairing 5/min) so a stuck retry loop cannot empty a roll of paper.

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

## Printing jobs queued in the cloud (opt-in)

By default the agent only prints what the open app sends it. It can also poll the cloud queue so a ticket fired while this workstation was switched off still prints when it comes back:

    PRINT_AGENT_CLAIM_JOBS=1
    PRINT_AGENT_ID=<a stable name for this workstation>
    SUPABASE_SERVICE_ROLE_KEY=<agent credential>   # Phase 7 replaces this with pairing
    PRINT_AGENT_PROPERTY_ID=<property uuid>        # optional; default is every property

How it stays safe:

- the claim function is `for update skip locked`, so two agents never take the same row;
- a claim has a lease (default 120s); an expired lease becomes `uncertain`, never `queued` again, because the paper may already be printed;
- each claimed job enters the local durable queue with the key `fnb:<job id>`, so a re-claim after a restart finds the existing record instead of printing again;
- claiming needs a service-role key, and the Windows installer deliberately does **not** collect one, so this stays off until Phase 7 adds scoped pairing. Without a key the agent simply logs that claims are off and keeps printing locally.

Other settings: `PRINT_AGENT_CLAIM_INTERVAL_MS` (15000), `PRINT_AGENT_CLAIM_BATCH_SIZE` (3), `PRINT_AGENT_CLAIM_LEASE_SECONDS` (120).

Database side: `supabase/migrations/20261111160000_phase5_agent_print_claim.sql` adds the `uncertain` status, `claimed_by` / `claimed_at` / `lease_expires_at` / `uncertain_at`, and the service-role RPCs `fn_claim_fnb_print_jobs`, `fn_complete_fnb_print_job` and `fn_expire_fnb_print_leases`. The app stores the ESC/POS bytes and printer target on the job (`payload.escposBase64`, `payload.printTarget`) so a queued job is printable without the browser.

## Important

The local agent binds to loopback by default. Do not expose it publicly.

The Supabase print-proxy Edge Function may remain available for supported public transports, but private hotel LAN addresses such as 192.168.x.x should use the local agent.