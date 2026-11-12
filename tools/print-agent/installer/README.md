# OliTechs Print Agent — click-once installer

Staff download one file, double-click it, approve the Windows prompt, and type a
pairing code into a normal window. No terminal, no Node.js, no `npm`, no
PowerShell commands.

## What the installer does

1. Copies the agent, the shared ESC/POS builder and a **bundled** Node.js runtime
   into `C:\Program Files\OliTechs\Print Agent`.
2. Registers the `OliTechsPrintAgent` Windows service through the existing
   `service\install-service.ps1` (runs as `LocalSystem`, starts at boot, recovers
   from crashes). Re-running the installer upgrades in place.
3. Injects the public Supabase URL and anon key as service environment variables,
   so pairing works without anybody editing a file.
4. Starts the service, waits for `http://127.0.0.1:8631/health`, then offers the
   pairing dialog: type the code from **Settings → Printers → Pair this
   computer**, press Pair. It can be skipped and repeated later from the Start
   menu.
5. Adds Start-menu entries for printer status, pairing, logs and uninstall.

Uninstalling removes the service. Printer configuration, logs, the local print
queue and the workstation credential stay in
`C:\ProgramData\OliTechs\PrintAgent` so a reinstall keeps working.

## Build requirements

These are build-machine requirements only. Nothing here is committed to git.

| Requirement | Why |
| --- | --- |
| Windows 10/11 x64 build machine | Inno Setup and `signtool` are Windows tools |
| [Inno Setup 6](https://jrsoftware.org/isdl.php) | Compiles `OliTechsPrintAgent.iss` |
| Windows SDK (`signtool.exe`) | Applies the Authenticode signature |
| A code-signing certificate (OV or EV) | Proves the installer came from OliTechs |
| `WinSW.exe` you have verified | The service wrapper; the repo stores no binaries |
| Node.js win-x64 zip + its official SHA-256 | Bundled runtime, from `https://nodejs.org/dist` |

## Build and sign

```powershell
cd tools\print-agent\installer

# Signed release (certificate installed in the machine/user store):
.\build-installer.ps1 `
  -Version 2.2.0 `
  -WinSWPath C:\build\WinSW.exe `
  -WinSWSha256 <sha256-of-WinSW-x64.exe> `
  -NodeZipPath C:\build\node-v22.14.0-win-x64.zip `
  -NodeSha256 <sha256-from-nodejs.org> `
  -CertificateThumbprint <cert-thumbprint>

# Or with a PFX:
.\build-installer.ps1 -WinSWPath ... -WinSWSha256 ... -NodeSha256 ... `
  -PfxPath C:\build\olitechs.pfx -PfxPassword (Read-Host -AsSecureString | ConvertFrom-SecureString)

# Internal test build only, clearly marked:
.\build-installer.ps1 -WinSWPath ... -SkipWinSWHashCheck -SkipNodeHashCheck -AllowUnsigned
```

The script refuses to bundle an unverified `WinSW.exe` or Node.js archive for a
release build. Pass `-SkipWinSWHashCheck` only for an internal test build.

Output: `dist\installer\OliTechsPrintAgentSetup-<version>.exe` (or
`...-UNSIGNED.exe`). The script refuses to produce an unsigned *release*: if no
certificate is supplied it stops and says so, because SmartScreen would warn
every receptionist and the build would look broken.

Signing happens after compilation with `/fd SHA256 /tr <timestamp> /td SHA256`,
then the script verifies the result with `Get-AuthenticodeSignature` and prints
the publisher, timestamp status and SHA-256. Keep that SHA-256 in the release
notes so a customer can confirm the download.

Once built, add two secrets to the release process: the PowerShell command with
the PFX password, and the SHA-256 recorded for support. Both belong in your
secret store, never in this repository.

## What signing does and does not do

- Windows shows **Unknown publisher** and a blue SmartScreen warning for an
  unsigned or invalidly signed file. A valid signature removes the "unknown
  publisher" warning.
- SmartScreen *reputation* is separate: a brand-new certificate can still warn
  until Windows has seen enough downloads. EV certificates generally establish
  reputation faster, but Microsoft does not guarantee a timeline. Warn the first
  customers, or publish the SHA-256 and a screenshot of the expected prompt.
- Signing proves origin and integrity; it does not make the agent's behaviour
  safe. That is the origin allowlist, loopback binding, rate limits and pairing.

## Automated release pipeline

`.github/workflows/print-agent-release.yml` is the normal path. On a
`print-agent-v*` tag (or a manual dispatch) it runs the print-agent tests, lint,
typecheck and application tests, downloads Node.js and checks it against the
published `SHASUMS256.txt`, downloads WinSW and checks it against the repository
variable `WINSW_SHA256`, compiles with Inno Setup, signs with the imported
certificate, writes `SHA256SUMS.txt`, uploads the artifact and publishes the
GitHub Release.

Required configuration:

| Name | Type | Purpose |
| --- | --- | --- |
| `WINSW_SHA256` | repository variable | Pins the exact WinSW-x64.exe bytes |
| `WINDOWS_CERT_PFX_BASE64` | secret | Base64 of the code-signing PFX |
| `WINDOWS_CERT_PASSWORD` | secret | PFX password |

Without the certificate secrets the workflow stops before compiling a release
installer. A manual dispatch with `allow_unsigned=true` produces an internal
`-UNSIGNED.exe` artifact and never a Release.

## Verify a build by hand

```powershell
Get-AuthenticodeSignature .\OliTechsPrintAgentSetup-2.2.0.exe |
  Format-List Status, StatusMessage, @{n='Signer';e={$_.SignerCertificate.Subject}}

(Get-FileHash .\OliTechsPrintAgentSetup-2.2.0.exe -Algorithm SHA256).Hash
```

Status must be `Valid` and the signer must be OliTechs. Then run Part 13 of
`../WINDOWS-ACCEPTANCE-CHECKLIST.md` on a spare computer: signed install with no
terminal, pairing dialog, restart with no signed-in user, upgrade over the top,
and uninstall that keeps printer data.

## When something fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| SmartScreen "Windows protected your PC" | Unsigned or low-reputation file | Confirm the signature and hash; only trust a signed build |
| "Windows cannot verify the publisher" | Signature invalid or timestamped after expiry | Re-sign with `/tr` and a valid certificate |
| Installer stops at "Installing the service…" | Service could not start | Check `%ProgramData%\OliTechs\PrintAgent\logs\agent.log` |
| Pairing says the agent is not responding | Service stopped, or a firewall blocks loopback | `sc query OliTechsPrintAgent`, then read the log |
| Pairing says unavailable | No Supabase URL/anon key in the build | Rebuild with `-SupabaseUrl`/`-SupabaseAnonKey` or a `.env` present |
| Two copies of a receipt print | An old logon task survived | The installer removes it; otherwise `uninstall-service.ps1` |

## Why the payload layout matters

`server.mjs` imports the shared builder as `../../src/services/escposJob.js`, so
the payload keeps the repository shape (`tools\print-agent\...` and
`src\services\escposJob.js`). Tests and documentation are deliberately stripped
from the payload.
