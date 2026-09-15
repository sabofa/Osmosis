# Osmosis local node installer for Windows.
#
# Builds the project, writes server\.env.local (first run only), and registers
# a Scheduled Task that starts the node at logon and restarts it if it dies.
# Re-run after `git pull` to rebuild and restart. No admin rights needed.
#
#   powershell -ExecutionPolicy Bypass -File deploy\install-local.ps1 -RemoteUrl http://100.86.89.59:8081
#
# The app is then at http://localhost:8081/ and keeps working offline for
# every test you have downloaded in Library.
param(
  [string]$RemoteUrl = "http://100.86.89.59:8081",
  [int]$Port = 8081,
  [string]$TaskName = "Osmosis Local Node"
)
$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$server = Join-Path $repo "server"
$envFile = Join-Path $server ".env.local"
$node = (Get-Command node -ErrorAction Stop).Source
$major = [int](node -p "process.versions.node.split('.')[0]")
if ($major -lt 22) { throw "Node $(node -v) is too old: node:sqlite needs 22.13+ (24 LTS recommended)." }

function Log($m) { Write-Host "`n==> $m" }

Push-Location $repo
try {
  Log "Installing dependencies"
  npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
  Log "Building engines, web app, server"
  npm run build:lib --workspace=graph-engine;     if ($LASTEXITCODE -ne 0) { throw "graph-engine build failed" }
  npm run build:lib --workspace=document-engine;  if ($LASTEXITCODE -ne 0) { throw "document-engine build failed" }
  npm run build --workspace=web;                  if ($LASTEXITCODE -ne 0) { throw "web build failed" }
  npm run build --workspace=server;               if ($LASTEXITCODE -ne 0) { throw "server build failed" }
} finally { Pop-Location }

$data = Join-Path $repo "data"
New-Item -ItemType Directory -Force (Join-Path $data "uploads") | Out-Null

if (-not (Test-Path $envFile)) {
  Log "Writing $envFile (first run)"
  $label = $env:COMPUTERNAME.ToLower()
  $dbPath = (Join-Path $data "local.db") -replace "\\", "/"
  $uploads = (Join-Path $data "uploads") -replace "\\", "/"
  $dist = (Join-Path $repo "web\dist") -replace "\\", "/"
  @(
    "NODE_ROLE=local",
    "NODE_LABEL=$label",
    "PORT=$Port",
    "REMOTE_URL=$RemoteUrl",
    "DB_PATH=$dbPath",
    "UPLOADS_DIR=$uploads",
    "WEB_DIST_DIR=$dist"
  ) | Set-Content -Encoding ascii $envFile
} else {
  Log "Keeping existing $envFile"
}

Log "Registering scheduled task '$TaskName' (at logon, restart on failure)"
$action = New-ScheduledTaskAction -Execute $node `
  -Argument "--env-file=.env.local --no-warnings=ExperimentalWarning dist/index.js" `
  -WorkingDirectory $server
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
# S4U: runs in the background with no console window and no stored password.
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

Log "Starting"
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3
try {
  $status = Invoke-RestMethod "http://127.0.0.1:$Port/api/status"
  Log "Local node '$($status.node.label)' is up at http://localhost:$Port/ (online: $($status.online))"
} catch {
  Write-Warning "Node did not answer on port $Port yet. Check: Get-ScheduledTaskInfo '$TaskName'"
}
