# Capture the home page of an Osmosis web dev server in light and dark.
# Usage: capture.ps1 -Url http://localhost:5191/ -Prefix branch-forest -OutDir <dir>
# Headless Edge, fresh profile per shot, hard timeout, killed by PID.
param(
  [Parameter(Mandatory)][string]$Url,
  [Parameter(Mandatory)][string]$Prefix,
  [Parameter(Mandatory)][string]$OutDir,
  [string]$Page = 'home',
  [int]$TimeoutSec = 60,
  [int]$BudgetMs = 15000
)
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
New-Item -ItemType Directory -Force $OutDir | Out-Null
foreach ($mode in 'light', 'dark') {
  $png = Join-Path $OutDir "$Prefix-$Page-$mode.png"
  $prof = Join-Path $OutDir ("profile-" + [guid]::NewGuid().ToString('N'))
  $args = @('--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
    "--user-data-dir=`"$prof`"", '--window-size=1280,900', "--virtual-time-budget=$BudgetMs",
    "--screenshot=`"$png`"")
  # preferredColorScheme: 0 = dark, 1 = light (verified; --force-prefers-color-scheme is ignored by Edge)
  $args += "--blink-settings=preferredColorScheme=$(if ($mode -eq "dark") { 0 } else { 1 })"
  $args += $Url
  $p = Start-Process $edge -ArgumentList $args -PassThru -WindowStyle Hidden
  if (-not $p.WaitForExit($TimeoutSec * 1000)) {
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    Write-Host "TIMEOUT $png"
  }
  Start-Sleep -Milliseconds 800
  # msedge forks children that outlive the launcher; kill only those using our profile dir
  Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" |
    Where-Object { $_.CommandLine -like "*$prof*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 300
  Remove-Item -Recurse -Force $prof -ErrorAction SilentlyContinue
  Write-Host "$png $(if (Test-Path $png) { (Get-Item $png).Length } else { 'MISSING' })"
}
