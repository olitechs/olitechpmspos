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

    npm run print-agent

Default listener: http://127.0.0.1:8631

Health check: http://127.0.0.1:8631/health

Keep the agent running on every Windows POS workstation that uses LAN or Windows-driver printing.

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

## Important

The local agent binds to loopback by default. Do not expose it publicly.

The Supabase print-proxy Edge Function may remain available for supported public transports, but private hotel LAN addresses such as 192.168.x.x should use the local agent.