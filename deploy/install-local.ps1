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

# Stop a running node first: npm ci replaces node_modules, and Windows won't
# let it delete files a running process has mapped.
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Log "Stopping '$TaskName' for the rebuild"
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -like "*dist/index.js*" -and $_.CommandLine -like "*.env.local*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

Push-Location $repo
try {
  Log "Installing dependencies"
  npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
  Log "Building engines, web app, server"
  npm run build:lib --workspace=graph-engine;     if ($LASTEXITCODE -ne 0) { throw "graph-engine build failed" }
  npm run build:lib --workspace=document-engine;  if ($LASTEXITCODE -ne 0) { throw "document-engine build failed" }
  npm run build --workspace=cli-core
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
# A hidden-window launcher: an interactive at-logon task would otherwise pop a
# console window for node. wscript waits on node (last arg True) so the task
# stays "running" while the node runs and restarts it if the process dies.
$launcher = Join-Path $data "run-local-node.vbs"
@(
  'Set sh = CreateObject("WScript.Shell")',
  "sh.CurrentDirectory = `"$server`"",
  "sh.Run `"`"`"$node`"`" --env-file=.env.local --no-warnings=ExperimentalWarning dist/index.js`", 0, True"
) | Set-Content -Encoding ascii $launcher
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$launcher`"" -WorkingDirectory $server
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew
# Interactive logon (runs while you're logged in) needs no admin rights and no
# stored password; the launcher above keeps it windowless.
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
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
