# start-server-production.ps1
# ---------------------------------------------------------------------------
# (Re)starts the Shipwright WebUI Hono server in PRODUCTION mode
# (`node dist/index.js`, NO `tsx watch`) — HIDDEN in the background.
#
# Why production: `tsx watch` (the `npm run dev` script) restarts the server
# on every server-file change, which kills ALL embedded-terminal ptys.
# Production has no watcher → stable for multi-task use.
#
# Run it:  right-click -> "Run with PowerShell".  Re-run anytime to restart.
# Stop it: run stop-server.ps1 the same way.
# Server log: %USERPROFILE%\.shipwright-webui\server-manual.log
#
# ORDER MATTERS — build FIRST, then swap. A failed build (or a window closed
# mid-build) leaves the currently running server UNTOUCHED. You can never end
# up with no server.
# ---------------------------------------------------------------------------
$repo   = Split-Path -Parent $PSScriptRoot
$server = Join-Path $repo 'server'
$logDir = Join-Path $env:USERPROFILE '.shipwright-webui'
$log    = Join-Path $logDir 'server-manual.log'

Write-Host ''
Write-Host '=== Shipwright WebUI - (re)start Hono (PRODUCTION, background) ===' -ForegroundColor Cyan
Write-Host ''

# 1. Build FIRST. If this fails, the running server is left alone.
Set-Location $server
Write-Host 'Building server (npm run build)...' -ForegroundColor Cyan
& npm run build
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host 'BUILD FAILED - the running server was NOT touched.' -ForegroundColor Red
  Write-Host 'Fix the errors above, then run this script again.' -ForegroundColor Red
  Read-Host 'Press Enter to close'
  exit 1
}

# 2. Build OK -> stop the old Hono: port-3847 listener + any `tsx` process
#    running this repo's server entry (the watch parent and its child).
Write-Host ''
Write-Host 'Build OK. Stopping the old server...' -ForegroundColor Yellow
$killed = New-Object System.Collections.Generic.List[int]
Get-NetTCPConnection -LocalPort 3847 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { $killed.Add([int]$_); Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and ($_.CommandLine -match 'tsx') -and ($_.CommandLine -match 'src[\\/]index\.ts') } |
  ForEach-Object { $killed.Add([int]$_.ProcessId); Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
$ids = ($killed | Sort-Object -Unique) -join ' '
if ($ids) { Write-Host "  stopped PID(s): $ids" -ForegroundColor DarkGray }
Start-Sleep -Milliseconds 700

# 3. Launch the fresh build HIDDEN + detached, output -> log file.
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$inner = "node --env-file-if-exists=../.env.local dist/index.js > `"$log`" 2>&1"
$proc  = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $inner `
  -WorkingDirectory $server -WindowStyle Hidden -PassThru

# 4. Confirm it bound port 3847.
Write-Host ''
Write-Host 'Starting in background...' -ForegroundColor Cyan
$up = $false
for ($i = 0; $i -lt 16; $i++) {
  Start-Sleep -Milliseconds 500
  if ($proc.HasExited) { break }
  if (Get-NetTCPConnection -LocalPort 3847 -State Listen -ErrorAction SilentlyContinue) { $up = $true; break }
}
Write-Host ''
if ($up) {
  Write-Host '  OK - Hono runs in the background, no window.' -ForegroundColor Green
  Write-Host '  Restart: run this again.  Stop: stop-server.ps1' -ForegroundColor Green
  Write-Host "  Log: $log" -ForegroundColor Green
  Write-Host ''
  Write-Host '  This window closes itself in 4s...' -ForegroundColor DarkGray
  Start-Sleep -Seconds 4
} else {
  Write-Host '  Server did NOT come up on port 3847.' -ForegroundColor Red
  if (Test-Path $log) {
    Write-Host '  --- last lines of server-manual.log ---' -ForegroundColor Red
    Get-Content $log -Tail 25 -ErrorAction SilentlyContinue
  }
  Read-Host 'Press Enter to close'
  exit 1
}
