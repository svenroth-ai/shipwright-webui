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
$client = Join-Path $repo 'client'
$logDir = Join-Path $env:USERPROFILE '.shipwright-webui'
$log    = Join-Path $logDir 'server-manual.log'

Write-Host ''
Write-Host '=== Shipwright WebUI - (re)start Hono (PRODUCTION, background) ===' -ForegroundColor Cyan
Write-Host ''

# 0. Self-heal ~/.claude.json BEFORE anything restarts. This deploy force-kills
#    the server -> every embedded `claude` pty dies -> on reload many `claude`
#    CLIs start at once and race on the (non-atomic, unlocked) ~/.claude.json,
#    which can leave a truncation-tail-corrupt file that breaks every running
#    session. This Step-0 run heals corruption left by a PREVIOUS deploy; the
#    corruption THIS deploy causes happens ~13s later (step 2's server-kill
#    races the embedded writers), so step 5 below re-runs the guard after the
#    restart. BEST EFFORT: the deploy NEVER gates on
#    the result — the exit code is intentionally ignored and a missing `node`
#    or a script error must not block the deploy (server/build don't depend on
#    ~/.claude.json). See scripts/repair-claude-json.mjs.
Write-Host 'Checking ~/.claude.json integrity...' -ForegroundColor Cyan
try {
  & node (Join-Path $PSScriptRoot 'repair-claude-json.mjs')
} catch {
  Write-Host "  (skipped: $($_.Exception.Message))" -ForegroundColor DarkGray
}
# BEST EFFORT, by construction: discard the repair's exit code so NO later step
# can ever gate the deploy on it. DO NOT add an `if ($LASTEXITCODE ...)` check
# here — a corrupt-but-unrepairable file (exit 1) must not stop the deploy.
$global:LASTEXITCODE = 0

# 1. Build FIRST (server + client). If EITHER fails, the running server
#    is left alone. The Hono server serves client/dist in production, so
#    the client must be built too — otherwise the UI is stale/missing.
Set-Location $server
Write-Host 'Building server (npm run build)...' -ForegroundColor Cyan
& npm run build
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host 'SERVER BUILD FAILED - the running server was NOT touched.' -ForegroundColor Red
  Write-Host 'Fix the errors above, then run this script again.' -ForegroundColor Red
  Read-Host 'Press Enter to close'
  exit 1
}

Set-Location $client
Write-Host 'Building client (npm run build)...' -ForegroundColor Cyan
& npm run build
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host 'CLIENT BUILD FAILED - the running server was NOT touched.' -ForegroundColor Red
  Write-Host 'Fix the errors above, then run this script again.' -ForegroundColor Red
  Read-Host 'Press Enter to close'
  exit 1
}
Set-Location $server

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

  # 5. Self-heal ~/.claude.json a SECOND time, now that the server is up. The
  #    Step-0 run can only heal a PREVIOUS deploy's leftover corruption; THIS
  #    deploy's server-kill (step 2) took down every embedded `claude` pty and
  #    the racing shutdown writes are what corrupt the (non-atomic, unlocked)
  #    file. This is the clean window: the old sessions are dead and a UI reload
  #    has not yet spawned new ones, so heal here before the user reconnects.
  #    SAME best-effort contract — exit code ignored; a missing `node` or a
  #    script error must never gate the deploy. (Residual: a reload that spawns
  #    several sessions at once can still re-corrupt; the real fix is upstream —
  #    the CLI must write ~/.claude.json atomically + lock-guarded.)
  Write-Host 'Re-checking ~/.claude.json integrity (post-restart)...' -ForegroundColor Cyan
  try {
    & node (Join-Path $PSScriptRoot 'repair-claude-json.mjs')
  } catch {
    Write-Host "  (skipped: $($_.Exception.Message))" -ForegroundColor DarkGray
  }
  $global:LASTEXITCODE = 0

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
