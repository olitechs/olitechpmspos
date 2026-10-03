# OliTechs Local Print Agent

The browser cannot open raw TCP connections to LAN thermal printers. This small Node.js service runs on the POS workstation and owns the TCP connection to ESC/POS printers on the hotel LAN.

## Run

From the repository root:

    npm run print-agent

The default listener is:

    http://127.0.0.1:8631

Health check:

    http://127.0.0.1:8631/health

Keep the agent running on every workstation that needs to print to a LAN thermal printer.

## Optional environment variables

Windows PowerShell:

    $env:PRINT_AGENT_PORT=8631
    $env:PRINT_AGENT_TIMEOUT_MS=6000
    npm run print-agent

The agent only accepts thermal TCP ports 9100, 9101 and 9102 and binds to loopback by default.

## Printer setup

In OliTechs PMS/POS → Settings → Printers:

- Connection type: LAN / Printer API
- IP address: the printer's LAN address, for example 192.168.2.117
- Port: normally 9100
- Print agent URL: http://127.0.0.1:8631
- Assign the purpose: Order, Bill or Receipt

Click Test Connection. The test sends a real ESC/POS test page to the configured printer. Only a successful response from the local agent after the TCP write is treated as Connected.

The Supabase print-proxy Edge Function remains available for platform-side transport, but LAN/private RFC1918 printers should use this local agent because the Supabase cloud cannot normally route into the hotel's private LAN.