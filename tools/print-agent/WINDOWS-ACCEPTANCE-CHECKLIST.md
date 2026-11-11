# Windows Acceptance Checklist — Phase 2 (Print Agent Service)

Use this to prove that the OliTechs Print Agent keeps running when the browser
closes, the terminal closes, the cashier signs out, Windows restarts, or the
service crashes.

**Who does this:** a supervisor, installer or support person. No programming
knowledge is needed; every command is written out to copy exactly.
**Time:** about 45 minutes.
**Do it on:** a spare POS computer, or after closing time. Do not uninstall or
force-stop the service during trading hours.

## Before you start

You need:

- a Windows 10 or 11 POS computer;
- the OliTechs Print Agent installed (see `INSTALL-WINDOWS.md`);
- one printer already configured in Olitech under **Settings → Printers**, with a
  role assigned, so you can print a test page;
- an Olitech login for that property;
- administrator rights for the crash step in Part 6.

Record this now, so the results mean something later:

| Item | Value |
| --- | --- |
| Date and person | |
| Computer name | |
| Windows version (Settings → System → About) | |
| Printer make and model | |
| How the printer connects (USB / network cable / Wi-Fi) | |
| Agent version (from the health page in Part 1) | |

## How to read this checklist

Each step says what to do and **what you should see**. If you see something
else, stop and go to **If something fails** at the end.

Two things you will use again and again:

- **Services window:** press the Windows key, type `Services`, press Enter.
  Find **OliTechs Print Agent**. It must say **Running** and **Automatic**.
- **Health page:** open a browser and go to `http://127.0.0.1:8631/health`.
  It shows a small block of text containing `"ok":true`, the `version`,
  `"mode":"service"`, a `pid` (process number) and `uptimeSeconds` (how long it
  has been running).

> **Why `pid` and `uptimeSeconds` matter:** they prove the service kept running
> without being restarted. If `pid` changes, the service restarted. If
> `uptimeSeconds` keeps growing, it never stopped.

---

## Part 1 — Install and first check (about 5 minutes)

- [ ] **1.1** Sign in as the user who serves at the till.
- [ ] **1.2** Open **Services** and find **OliTechs Print Agent**.
  **Expect:** Status **Running**, Startup type **Automatic**.
- [ ] **1.3** Open the health page `http://127.0.0.1:8631/health`.
  **Expect:** `"ok":true`, `"mode":"service"`, a version number, a `pid`, and an
  `uptimeSeconds`.
- [ ] **1.4** Write down the `pid` and `uptimeSeconds` here: pid ______,
  uptime ______ seconds.
- [ ] **1.5** In Olitech, open **Settings → Printers**, choose the receipt printer
  and press **Test & Print**.
  **Expect:** a test slip prints, and the printer shows as Connected.

## Part 2 — Close the browser

- [ ] **2.1** Close every browser window (and the Olitech desktop shortcut, if
  there is one).
- [ ] **2.2** Wait two minutes.
- [ ] **2.3** Re-open **Services**. **Expect:** still **Running**.
- [ ] **2.4** Open the health page again. **Expect:** the **same `pid`** and a
  **larger** `uptimeSeconds` than in step 1.4.

## Part 3 — Close the terminal

The agent is a service, so no terminal should be able to stop it. Prove it:

- [ ] **3.1** Press the Windows key, type `cmd`, and press Enter.
- [ ] **3.2** Type this and press Enter:

      sc query OliTechsPrintAgent

  **Expect:** `STATE : 4 RUNNING`.
- [ ] **3.3** Close the Command Prompt window immediately.
- [ ] **3.4** Check **Services** again. **Expect:** still **Running**, same `pid`.

## Part 4 — Sign out (the important one)

This is what the old logon-based agent could not survive.

- [ ] **4.1** Note the current `pid` and `uptimeSeconds`.
- [ ] **4.2** Click **Start → your user picture → Sign out**. Wait at the login
  screen for at least one minute.
- [ ] **4.3** Sign back in.
- [ ] **4.4** Open **Services**. **Expect:** **Running**, and Startup type still
  **Automatic**.
- [ ] **4.5** Open the health page. **Expect:** the **same `pid`** as step 4.1 and
  a larger `uptimeSeconds`. This proves the service kept working while nobody was
  signed in.
- [ ] **4.6** Print a test page from **Settings → Printers**.

> **What this does not prove:** with nobody signed in there is no browser, so no
> one can start a print from the web app. Sign-out proves the *service* stays
> alive; printing jobs queued while logged out arrives with Phase 4 (durable
> queue). Do not claim that part yet.

## Part 5 — Restart Windows

- [ ] **5.1** Note the current `pid`.
- [ ] **5.2** **Start → Power → Restart**. When the login screen appears, wait
  two minutes before signing in (this shows the service starts without a user).
- [ ] **5.3** Sign in and open the health page.
  **Expect:** `"ok":true`, a **new `pid`**, and `uptimeSeconds` of a few minutes —
  the service started by itself during boot.
- [ ] **5.4** Open **Services**. **Expect:** **Running**, **Automatic**.
- [ ] **5.5** In Olitech, open **Settings → Printers**.
  **Expect:** the printers and their roles are still listed (configuration
  survived the restart).
- [ ] **5.6** Print a test page.

## Part 6 — Crash recovery (needs administrator)

This simulates the agent dying unexpectedly. Windows must bring it back on its
own.

- [ ] **6.1** Note the current `pid`.
- [ ] **6.2** Press **Ctrl + Shift + Esc** to open Task Manager. Click **More
  details** if it is small, then open the **Details** tab.
- [ ] **6.3** Find `node.exe` in the list, right-click it, choose **End task**, and
  confirm. (You are stopping the agent's process on purpose.)
- [ ] **6.4** Wait 60 seconds. The recovery policy waits 5 seconds, then 15, then
  60 before restarting.
- [ ] **6.5** Open the health page.
  **Expect:** it answers again, with a **new `pid`** and a small `uptimeSeconds`.
- [ ] **6.6** Open **Services**. **Expect:** **Running**.
- [ ] **6.7** Print a test page.

## Part 7 — Only one agent can run (optional, for support)

- [ ] **7.1** Open the OliTechs folder, hold **Shift**, right-click in the folder
  and choose **Open PowerShell window here**.
- [ ] **7.2** Type this and press Enter:

      node tools\print-agent\print-agent-v2.js

  **Expect:** a red message containing `AGENT_ALREADY_RUNNING` and "already
  running". It must **not** start a second agent.
- [ ] **7.3** Close the window. The service is still **Running**.

## Part 8 — Logs exist and are safe to share

- [ ] **8.1** Open `C:\ProgramData\OliTechs\PrintAgent\logs` in File Explorer.
  **Expect:** `agent.log` (and possibly `agent.log.1`, `agent.log.2`, …).
- [ ] **8.2** Open `agent.log` in Notepad. **Expect:** one line per event, each
  starting with a date. Look for `print agent starting` and `print agent listening`.
- [ ] **8.3** Search the file for the word `password`, your Wi-Fi password and
  any guest name you typed during the test.
  **Expect:** no real values — sensitive fields appear as `[redacted]`.
- [ ] **8.4** Keep a copy of `agent.log` with your results.

## Part 9 — Clean removal (optional, only on a spare computer)

- [ ] **9.1** In the OliTechs folder run `npm run print-agent:uninstall`.
- [ ] **9.2** Open **Services**. **Expect:** **OliTechs Print Agent** is gone.
- [ ] **9.3** Open `C:\ProgramData\OliTechs\PrintAgent`.
  **Expect:** the folder still exists with your logs (configuration is kept
  unless `-RemoveData` is used).
- [ ] **9.4** Re-install with `npm run print-agent:install` and confirm the
  printers are still configured.

---

## Results

Tick each part and write what you saw.

| Part | Test | Pass? | Notes |
| --- | --- | --- | --- |
| 1 | Installed, Automatic, health responds, test print | | |
| 2 | Browser closed, service keeps running | | |
| 3 | Terminal closed, service keeps running | | |
| 4 | Sign-out, same pid, printing after sign-in | | |
| 5 | Restart, service auto-starts, config kept | | |
| 6 | Crash, service restarted by Windows | | |
| 7 | Second agent refused | | |
| 8 | Logs written, secrets redacted | | |
| 9 | Uninstall removes service, keeps data | | |

**Signed off by:** ____________________  **Date:** ____________

## If something fails

Do not reinstall repeatedly. Collect these four things and send them to support:

1. the exact step number that failed and what you saw;
2. the health page text (copy it, or take a photo);
3. the last 50 lines of `C:\ProgramData\OliTechs\PrintAgent\logs\agent.log`;
4. the output of this command in Command Prompt:

       sc query OliTechsPrintAgent

Common causes, in plain language:

| What you see | Most likely cause |
| --- | --- |
| Service is not in the list | The installer did not finish; re-run it as administrator |
| Service shows **Stopped** and will not start | Node.js is missing or was moved; re-install Node.js 20+ and re-run the installer |
| Health page does not open | Another program is using port 8631, or the service is stopped |
| Health opens but prints fail | Printer is off, out of paper, or its IP address changed |
| Windows printer missing from Olitech | The printer is installed for another Windows user only; install a per-machine driver |
| Test print is garbled | The printer's driver does not accept raw ESC/POS; use a generic/text-only or ESC/POS driver |

## Not covered by this checklist

These belong to later phases and must not be marked as passed here:

- automatic printing of jobs queued while nobody was signed in (Phase 4);
- duplicate protection when a print button is pressed twice (Phase 4);
- USB or network printer disconnect and reconnect handling (Phase 5);
- out-of-paper reporting (Phase 5);
- the in-app printer dashboard (Phase 6);
- installing with no terminal at all, from a signed installer (Phase 8);
- diagnostics export (Phase 9);
- the full printer/Windows compatibility matrix (Phase 10).
