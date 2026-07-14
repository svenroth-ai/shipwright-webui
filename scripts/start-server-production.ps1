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
# Deploy log: %USERPROFILE%\.shipwright-webui\deploy-swap.log  (+ deploy-status.json)
#
# TWO ORDERING RULES, both load-bearing:
#
# 1. INSTALL + BUILD FIRST, then swap. A failed install/build (or a window closed
#    mid-build) leaves the currently running server UNTOUCHED. You can never end
#    up with no server.
#
# 2. THIS SCRIPT NEVER KILLS THE SERVER ITSELF. When it runs inside the Command
#    Center's embedded terminal — the normal case for a Claude session the WebUI
#    launched — this script is a DESCENDANT of the Hono server:
#
#        Hono (:PORT) -> node-pty shell -> claude -> this script
#
#    Killing Hono tears down the ConPTY, which kills the pty shell and every
#    process under it — this script included. It used to die exactly there, at
#    its own kill step, so the "start the new build" step that followed was never
#    reached: fresh build on disk, no server, and no error message (the process
#    that would have printed one was dead). That is the 2026-07-14 outage.
#    Kill + start + readiness + heal therefore live in scripts/deploy-swap.mjs,
#    spawned DETACHED below BEFORE any kill happens — a Start-Process child
#    provably survives the cascade that kills this script.
# ---------------------------------------------------------------------------
$repo   = Split-Path -Parent $PSScriptRoot
$server = Join-Path $repo 'server'
$client = Join-Path $repo 'client'
$logDir = Join-Path $env:USERPROFILE '.shipwright-webui'
$status = Join-Path $logDir 'deploy-status.json'
# ONE PORT contract, shared by this script, start-server-production.sh and
# deploy-swap.mjs: 1-5 digits and > 0 — anything else (unset, blank, "abc",
# "999999", "0") degrades to 3847. Used for the hand-off, the readiness poll and
# every operator message, so a custom-PORT operator restarts the RIGHT server.
# The regex also keeps the [int] cast below Int32.MaxValue (no overflow throw),
# and the `-gt 0` check keeps `PORT=0` — which the regex alone accepts — from
# leaving this script polling port 0 while the swapper deploys on 3847. The
# swapper applies the SAME rule to its own fallback, so the two cannot disagree.
$Port   = if ($env:PORT -match '^\d{1,5}$' -and [int]$env:PORT -gt 0) { [int]$env:PORT } else { 3847 }

Write-Host ''
Write-Host '=== Shipwright WebUI - (re)start Hono (PRODUCTION, background) ===' -ForegroundColor Cyan
Write-Host ''

# 0. Self-heal ~/.claude.json BEFORE anything restarts. This deploy force-kills
#    the server -> every embedded `claude` pty dies -> on reload many `claude`
#    CLIs start at once and race on the (non-atomic, unlocked) ~/.claude.json,
#    which can leave a truncation-tail-corrupt file that breaks every running
#    session. This Step-0 run heals corruption left by a PREVIOUS deploy. The
#    corruption THIS deploy causes happens later — the server-kill races the
#    embedded writers — and healing THAT is the swapper's job, because this
#    script is usually already dead by then. BEST EFFORT: the deploy NEVER gates
#    on the result — the exit code is intentionally ignored and a missing `node`
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

# 1. Install deps + build FIRST (server + client). If ANY step fails, the running
#    server is left alone: nothing is killed until the swapper runs, and a failed
#    build never spawns it. The Hono server serves client/dist in production, so
#    the client must be installed + built too — otherwise the UI is stale/missing.
#
#    npm install is REQUIRED, not optional: a dependency added by a merged PR
#    lands in package-lock.json on `git pull` but is absent from node_modules
#    until `npm install` syncs it, so the build would otherwise fail with
#    "cannot find module" (e.g. @dnd-kit/core after the drag-and-drop board PR).
#    `npm install` is a near-noop when node_modules already matches the lockfile.
Set-Location $server
Write-Host 'Installing server deps (npm install)...' -ForegroundColor Cyan
& npm install
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host 'SERVER npm install FAILED - the running server was NOT touched.' -ForegroundColor Red
  Write-Host 'Fix the errors above, then run this script again.' -ForegroundColor Red
  Read-Host 'Press Enter to close'
  exit 1
}
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
Write-Host 'Installing client deps (npm install)...' -ForegroundColor Cyan
& npm install
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host 'CLIENT npm install FAILED - the running server was NOT touched.' -ForegroundColor Red
  Write-Host 'Fix the errors above, then run this script again.' -ForegroundColor Red
  Read-Host 'Press Enter to close'
  exit 1
}
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

# 2. Build OK -> hand the swap to a DETACHED helper and let go. Everything below
#    this point may never execute: the swapper's first act is to kill the old
#    server, and when this script runs inside an embedded terminal that kill takes
#    this very process down with it (header rule 2). The swapper is a
#    Start-Process child — it provably survives that cascade and finishes alone.
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
Write-Host ''
Write-Host 'Build OK. Handing the restart to the detached swapper...' -ForegroundColor Yellow
$startedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
# Kept on ONE line on purpose: script path, --port and the detach flag together are
# the contract, and the structural tests assert it by reading this line.
#
# The path is EMBEDDED IN QUOTES ('"' + path + '"'): Start-Process joins
# -ArgumentList with spaces and does NOT quote the elements, so a repo under e.g.
# "C:\Users\Sven Roth\..." would hand node a truncated path — the swapper would
# never run, nothing would be killed, and the deploy would look like it did
# something. Verified: unquoted + spaced path = "Cannot find module".
#
# String CONCATENATION, not "`"$(...)`"": the embedded terminal spawns
# powershell.exe (Windows PowerShell 5.1, NOT pwsh 7), and 5.1's parser chokes on
# an escaped quote wrapping a subexpression that itself contains quotes — the whole
# script then fails to parse and the deploy silently never starts. Keep this
# 5.1-safe; it is the shell the Command Center actually runs it in.
Start-Process -FilePath 'node' -ArgumentList ('"' + (Join-Path $PSScriptRoot 'deploy-swap.mjs') + '"'), '--port', $Port -WorkingDirectory $repo -WindowStyle Hidden | Out-Null

# 3. Report the outcome — from the SWAPPER'S OWN VERDICT, never from a weaker
#    signal. Watching the port ourselves is NOT good enough and would be actively
#    dangerous: the first probe lands before the swapper can even have killed the
#    old server, so we would see the PRE-KILL listener and print a green OK over a
#    deploy that has not happened yet — and if the swap then failed, the operator
#    would close a success message over a machine with no server. The swapper
#    checks that the listener belongs to the child IT started, so only its fresh
#    verdict (ts >= $startedAt) counts. No verdict within the window = FAILURE,
#    because the swapper writes one in every path it can still run in.
#    If the swapper's kill already took this process down, nobody reads any of
#    this — deploy-status.json + deploy-swap.log carry the same verdict on disk.
Write-Host 'Waiting for the server to come back...' -ForegroundColor Cyan
$verdict = $null
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 500
  if (Test-Path $status) {
    try { $s = Get-Content $status -Raw | ConvertFrom-Json } catch { $s = $null }
    if ($s -and $null -ne $s.ts -and [int64]$s.ts -ge $startedAt) { $verdict = $s; break }
  }
}

Write-Host ''
if ($null -ne $verdict -and $verdict.ok) {
  Write-Host "  OK - Hono runs in the background, no window (pid $($verdict.pid), port $($verdict.port))." -ForegroundColor Green
  Write-Host '  Restart: run this again.  Stop: stop-server.ps1' -ForegroundColor Green
  Write-Host "  Log: $(Join-Path $logDir 'server-manual.log')" -ForegroundColor Green
  Write-Host ''
  Write-Host '  This window closes itself in 4s...' -ForegroundColor DarkGray
  Start-Sleep -Seconds 4
} else {
  Write-Host "  Server did NOT come up on port $Port." -ForegroundColor Red
  if ($null -ne $verdict) {
    Write-Host "  deploy-status.json: $($verdict.error)" -ForegroundColor Red
  } else {
    Write-Host '  The swapper never reported back (it may not have started at all).' -ForegroundColor Red
    # A listener here means the OLD server is still up — worth saying, so nobody
    # mistakes a surviving old build for a successful deploy.
    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
      Write-Host "  NOTE: something is still listening on port $Port - most likely the OLD server, not the new build." -ForegroundColor Yellow
    }
  }
  Write-Host "  Swapper log: $(Join-Path $logDir 'deploy-swap.log')" -ForegroundColor Red
  Read-Host 'Press Enter to close'
  exit 1
}
