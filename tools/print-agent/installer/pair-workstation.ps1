[CmdletBinding()]
param(
  [string]$Code = '',
  [string]$AgentUrl = 'http://127.0.0.1:8631',
  [int]$WaitSeconds = 30,
  [switch]$Quiet
)

# Pairs this computer with OliTechs without a terminal.
#
# The installer runs this hidden after the service starts, so staff see a normal
# window: type the code from Settings → Printers, press OK, done. The code is
# single use and expires in ten minutes; the long-lived workstation credential is
# created and stored by the agent, never handled here.

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms | Out-Null
Add-Type -AssemblyName System.Drawing | Out-Null

function Show-Info([string]$Message, [string]$Title = 'OliTechs Print Agent') {
  if ($Quiet) { Write-Host $Message; return }
  [void][System.Windows.Forms.MessageBox]::Show($Message, $Title, [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)
}

function Show-Warning([string]$Message) {
  if ($Quiet) { Write-Host $Message; return }
  [void][System.Windows.Forms.MessageBox]::Show($Message, 'OliTechs Print Agent', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning)
}

function Read-PairingCode {
  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'Pair this computer'
  $form.Size = New-Object System.Drawing.Size(430, 230)
  $form.StartPosition = 'CenterScreen'
  $form.FormBorderStyle = 'FixedDialog'
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.TopMost = $true

  $title = New-Object System.Windows.Forms.Label
  $title.Text = 'Enter the pairing code from OliTechs'
  $title.Font = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)
  $title.AutoSize = $true
  $title.Location = New-Object System.Drawing.Point(18, 18)
  $form.Controls.Add($title)

  $help = New-Object System.Windows.Forms.Label
  $help.Text = 'In OliTechs, open Settings then Printers and press "Pair this computer" to show a code. The code expires in 10 minutes.'
  $help.AutoSize = $false
  $help.Size = New-Object System.Drawing.Size(380, 48)
  $help.Location = New-Object System.Drawing.Point(18, 48)
  $form.Controls.Add($help)

  $input = New-Object System.Windows.Forms.TextBox
  $input.Location = New-Object System.Drawing.Point(18, 104)
  $input.Size = New-Object System.Drawing.Size(380, 30)
  $input.Font = New-Object System.Drawing.Font('Consolas', 14, [System.Drawing.FontStyle]::Bold)
  $input.CharacterCasing = 'Upper'
  $input.MaxLength = 24
  $form.Controls.Add($input)

  $ok = New-Object System.Windows.Forms.Button
  $ok.Text = 'Pair'
  $ok.Location = New-Object System.Drawing.Point(228, 150)
  $ok.Size = New-Object System.Drawing.Size(80, 30)
  $ok.DialogResult = [System.Windows.Forms.DialogResult]::OK
  $form.Controls.Add($ok)

  $cancel = New-Object System.Windows.Forms.Button
  $cancel.Text = 'Later'
  $cancel.Location = New-Object System.Drawing.Point(318, 150)
  $cancel.Size = New-Object System.Drawing.Size(80, 30)
  $cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
  $form.Controls.Add($cancel)

  $form.AcceptButton = $ok
  $form.CancelButton = $cancel
  $form.Add_Shown({ $input.Select() })

  $result = $form.ShowDialog()
  $value = $input.Text
  $form.Dispose()

  if ($result -ne [System.Windows.Forms.DialogResult]::OK) { return $null }
  return $value
}

# The service is started by the installer just before this runs, but give it a
# moment rather than showing a scary error for a computer that is simply slower.
$base = $AgentUrl.TrimEnd('/')
$ready = $false
for ($attempt = 0; $attempt -lt [Math]::Max(1, $WaitSeconds * 2); $attempt++) {
  try {
    $health = Invoke-RestMethod -Uri "$base/health" -TimeoutSec 2 -ErrorAction Stop
    if ($health.ok) { $ready = $true; break }
  } catch {
    Start-Sleep -Milliseconds 500
  }
}

if (-not $ready) {
  Show-Warning 'The OliTechs Print Agent is not responding on this computer. Restart the computer, then open "Pair this computer" from the OliTechs Print Agent folder in the Start menu.'
  exit 3
}

$pairingCode = if ($Code) { $Code } else { Read-PairingCode }
if ([string]::IsNullOrWhiteSpace($pairingCode)) {
  Show-Info 'Pairing was skipped. You can pair later from "Pair this computer" in the Start menu, or from Settings → Printers in OliTechs.'
  exit 2
}

try {
  $body = @{ code = $pairingCode.Trim() } | ConvertTo-Json -Compress
  $result = Invoke-RestMethod -Uri "$base/pair" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 30 -ErrorAction Stop
  if (-not $result.ok) { throw $result.message }
  Show-Info ("This computer is now paired as '{0}'. It will print jobs that were queued while it was switched off." -f $result.agentName)
  exit 0
} catch {
  $message = 'The pairing code was not accepted. Ask a manager for a new code and try again.'
  try {
    $details = $_.ErrorDetails.Message | ConvertFrom-Json
    if ($details.message) { $message = $details.message }
  } catch {
    if ($_.Exception.Message) { $message = $_.Exception.Message }
  }
  Show-Warning $message
  exit 1
}
