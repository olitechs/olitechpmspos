# OliTechs Print Agent 2.2.0 — release notes

**For:** hotel managers, front-office and F&B staff, and OliTechs support
**What it is:** the small program installed on each Windows POS computer that
sends receipts and kitchen tickets to your thermal printers.

This release makes printing keep working when nobody is watching the computer,
and gives your team a way to see and fix a printing problem without calling a
developer.

## What changed

- **Printing continues with the browser closed.** The agent now runs as a
  Windows service: it starts with the computer, survives sign-out and restarts
  itself after a crash. Closing the till screen no longer stops printing.
- **Nothing is lost or printed twice.** Every ticket is saved to disk before it
  goes to the printer. If the power goes off or the service stops mid-ticket,
  that ticket is marked **"Needs checking"** instead of being resent
  automatically, so a guest never gets two copies of one receipt.
- **Tickets queued while the computer was off still print.** Once a computer is
  paired (one manager, one code from **Settings → Printers**), it collects
  tickets that were raised while it was switched off and prints them when it
  comes back.
- **You can see printer health in the app.** Each printer shows a plain
  sentence such as "All 6 jobs printed in the last 7 days" or "2 jobs in a row
  did not print", with the printer's own error underneath, plus the last five
  jobs and a **Reprint** button.
- **One-click diagnostics for support.** **Save diagnostics file** in
  **Settings → Printers** creates a single file with the agent's health and
  recent logs — with passwords, pairing codes and receipt contents removed — so
  support can help without a remote session.
- **Guided printer setup and a signed installer.** Staff are walked through
  adding a printer and printing a test page; no Command Prompt, PowerShell or
  Node is needed. The installer is signed by OliTechs.

## Before you install

- **OliTechs applies a database update first.** This release needs two database
  changes on our side. Do not run the installer until we confirm they are in
  place; there is nothing for the hotel to do.
- **Allow about 10 minutes per till computer**, and have an administrator
  available — the installer needs admin rights once.
- **Have the printer switched on and connected**, and know its make and model.
  For USB or Bluetooth printers, the printer must already be installed in
  Windows (Printers & scanners) with its driver.
- **Have a manager sign-in ready.** Pairing each computer needs a manager, and
  the pairing code expires after 10 minutes.
- **Run the new installer over the old one.** It replaces the previous agent on
  that computer; you do not need to uninstall first. If Windows shows a warning
  that the publisher is unverified, stop and call OliTechs — a genuine 2.2.0
  installer is signed.
- **Only Windows 10 or 11 computers are supported.** No Node.js needs to be
  installed; the installer includes everything it needs.

## Good to know

- Receipts and tickets are printed as text. Logos and images are not printed,
  and on some printers accented letters or the currency symbol may look wrong —
  tell support if you see this.
- The cash drawer opens only through a network (LAN) receipt printer that has
  the drawer cable plugged into it. USB-only printers cannot open a drawer.
- Very cheap or unbranded printers, and ordinary office laser printers, may not
  work; support keeps a list of models we have tested.
- After installation, the first thing to do is print one test receipt and one
  kitchen ticket. If either fails, save a diagnostics file and send it to
  support before trying anything else.

## If something looks wrong

1. In **Settings → Printers**, press **Check agent**.
2. If it says the agent is not running, restart the computer once.
3. Press **Save diagnostics file** and send the file to OliTechs support with the
   printer's make and model and what you were printing.
4. Do not uninstall or reinstall by yourself while the hotel is trading.
