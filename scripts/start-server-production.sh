#!/usr/bin/env bash
# start-server-production.sh
# ---------------------------------------------------------------------------
# (Re)starts the Shipwright WebUI Hono server in PRODUCTION mode
# (`node dist/index.js`, NO `tsx watch`) — in the BACKGROUND.
#
# macOS / Linux parallel of start-server-production.ps1. Same contract: rebuild
# both halves, hand the swap to the detached helper, and heal a corrupted
# ~/.claude.json around the restart.
#
# Why production: `tsx watch` (the `npm run dev` script) restarts the server on
# every server-file change, which kills ALL embedded-terminal ptys. Production
# has no watcher -> stable for multi-task use.
#
# Run it:  bash scripts/start-server-production.sh   (or ./scripts/start-server-production.sh)
# Stop it: bash scripts/stop-server.sh
# Server log: ~/.shipwright-webui/server-manual.log
# Deploy log: ~/.shipwright-webui/deploy-swap.log  (+ deploy-status.json)
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
#    Tearing down the server tears down the pty, which kills the shell and every
#    process under it — this script included. It used to die exactly there, at
#    its own kill step, so the "start the new build" step that followed was never
#    reached: fresh build on disk, no server, no error message (the process that
#    would have printed one was dead). That is the 2026-07-14 outage.
#    Kill + start + readiness + heal therefore live in scripts/deploy-swap.mjs,
#    spawned DETACHED below BEFORE any kill happens — nohup/setsid make it ignore
#    the SIGHUP the dying pty sends, so it survives and finishes the job.
# ---------------------------------------------------------------------------
set -u

# ONE PORT contract, shared by this script, start-server-production.ps1 and
# deploy-swap.mjs: 1-5 digits and > 0 — anything else (unset, blank, "abc",
# "999999", "0") degrades to 3847. The guard is not cosmetic: the caller passes
# its resolved value to the swapper via --port, and the swapper applies the SAME
# rule to its own fallback. Without the guard here, `PORT=abc` would leave this
# script polling/reporting "abc" while the swapper silently deployed on 3847.
PORT="${PORT:-3847}"
case "$PORT" in
  '' | *[!0-9]*) PORT=3847 ;;
esac
if [ "${#PORT}" -gt 5 ] || [ "$PORT" -le 0 ]; then PORT=3847; fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER="$REPO/server"
CLIENT="$REPO/client"
LOG_DIR="$HOME/.shipwright-webui"
LOG="$LOG_DIR/server-manual.log"
SWAP_LOG="$LOG_DIR/deploy-swap.log"
STATUS="$LOG_DIR/deploy-status.json"

# Colored output when stdout is a tty; plain otherwise.
if [ -t 1 ]; then
  C_CYAN=$'\033[36m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
  C_RED=$'\033[31m'; C_DIM=$'\033[90m'; C_RESET=$'\033[0m'
else
  C_CYAN=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_DIM=''; C_RESET=''
fi
say() { printf '%s%s%s\n' "$1" "$2" "$C_RESET"; }

echo
say "$C_CYAN" '=== Shipwright WebUI - (re)start Hono (PRODUCTION, background) ==='
echo

# 0. Self-heal ~/.claude.json BEFORE anything restarts. This deploy force-kills
#    the server -> every embedded `claude` pty dies -> on reload many `claude`
#    CLIs start at once and race on the (non-atomic, unlocked) ~/.claude.json,
#    which can leave a truncation-tail-corrupt file that breaks every running
#    session. This Step-0 run heals corruption left by a PREVIOUS deploy. The
#    corruption THIS deploy causes happens later — the server-kill races the
#    embedded writers — and healing THAT is the swapper's job, because this
#    script is usually already dead by then. BEST EFFORT: the deploy NEVER gates
#    on the result — a missing `node` or a script error must not block the deploy
#    (server/build don't depend on ~/.claude.json).
say "$C_CYAN" 'Checking ~/.claude.json integrity...'
node "$SCRIPT_DIR/repair-claude-json.mjs" \
  || say "$C_DIM" '  (skipped: repair-claude-json.mjs did not run cleanly)'

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
fail_untouched() {
  echo
  say "$C_RED" "$1"
  say "$C_RED" 'The running server was NOT touched. Fix the errors above, then run this script again.'
  exit 1
}

cd "$SERVER" || fail_untouched "Cannot cd into $SERVER."
say "$C_CYAN" 'Installing server deps (npm install)...'
npm install || fail_untouched 'SERVER npm install FAILED.'
say "$C_CYAN" 'Building server (npm run build)...'
npm run build || fail_untouched 'SERVER BUILD FAILED.'

cd "$CLIENT" || fail_untouched "Cannot cd into $CLIENT."
say "$C_CYAN" 'Installing client deps (npm install)...'
npm install || fail_untouched 'CLIENT npm install FAILED.'
say "$C_CYAN" 'Building client (npm run build)...'
npm run build || fail_untouched 'CLIENT BUILD FAILED.'

cd "$SERVER" || fail_untouched "Cannot cd into $SERVER."

# 2. Build OK -> hand the swap to the DETACHED helper and let go. Everything below
#    this point may never execute: the swapper's first act is to kill the old
#    server, and when this script runs inside an embedded terminal that kill takes
#    this very process down with it (header rule 2). `setsid` puts the helper in
#    its own session (immune to the pty's SIGHUP); where setsid is absent (macOS)
#    `nohup` alone makes it ignore SIGHUP. Either way it outlives this script.
mkdir -p "$LOG_DIR"
echo
say "$C_YELLOW" 'Build OK. Handing the restart to the detached swapper...'
started_at="$(node -e 'process.stdout.write(String(Date.now()))')"
# `</dev/null` matters: BSD/macOS nohup — the branch macOS actually takes, setsid
# being Linux-only — does NOT redirect stdin, so without it the swapper keeps the
# dying pty's stdin fd open: the last handle tying it to the terminal it must outlive.
if command -v setsid >/dev/null 2>&1; then
  setsid nohup node "$SCRIPT_DIR/deploy-swap.mjs" --port "$PORT" </dev/null >>"$SWAP_LOG" 2>&1 &
else
  nohup node "$SCRIPT_DIR/deploy-swap.mjs" --port "$PORT" </dev/null >>"$SWAP_LOG" 2>&1 &
fi
disown "$!" 2>/dev/null || true

# 3. Report the outcome — from the SWAPPER'S OWN VERDICT, never from a weaker
#    signal. Watching the port ourselves is NOT good enough and would be actively
#    dangerous: the first probe lands before the swapper can even have killed the
#    old server, so we would see the PRE-KILL listener and print a green OK over a
#    deploy that has not happened yet — and if the swap then failed, the operator
#    would close a success message over a machine with no server. The swapper checks
#    that the listener belongs to the child IT started, so only its fresh verdict
#    (ts >= $started_at) counts. No verdict within the window = FAILURE, because the
#    swapper writes one in every path it can still run in.
#    If the swapper's kill already took this process down, nobody reads any of
#    this — deploy-status.json + deploy-swap.log carry the same verdict on disk.
say "$C_CYAN" 'Waiting for the server to come back...'
up=false
verdict=false
# exit 0 = fresh verdict, deploy OK · 1 = fresh verdict, deploy FAILED
# exit 2 = no usable verdict yet (stale file from a previous deploy, half-written
#          JSON, unreadable) -> keep waiting rather than misreading it
read_verdict='
  try {
    const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    if (!Number.isFinite(s.ts) || s.ts < Number(process.argv[2])) process.exit(2);
    process.exit(s.ok === true ? 0 : 1);
  } catch { process.exit(2); }
'
for _ in $(seq 1 60); do
  sleep 0.5
  [ -f "$STATUS" ] || continue
  node -e "$read_verdict" "$STATUS" "$started_at" 2>/dev/null
  rc=$?
  if [ "$rc" -eq 0 ]; then verdict=true; up=true;  break; fi
  if [ "$rc" -eq 1 ]; then verdict=true; up=false; break; fi
done

echo
if [ "$up" = true ]; then
  say "$C_GREEN" '  OK - Hono runs in the background, no window.'
  say "$C_GREEN" '  Restart: run this again.  Stop: bash scripts/stop-server.sh'
  say "$C_GREEN" "  Log: $LOG"
  echo
else
  say "$C_RED" "  Server did NOT come up on port $PORT."
  if [ "$verdict" = true ]; then
    # Only THIS deploy's verdict — printing a previous run's `ok: true` under a
    # failure headline would be the most misleading thing we could do.
    say "$C_RED" '  --- deploy-status.json (this deploy) ---'
    cat "$STATUS" 2>/dev/null || true
  else
    say "$C_RED" '  The swapper never reported back (it may not have started at all).'
    if command -v lsof >/dev/null 2>&1 && lsof -ti "tcp:$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      say "$C_YELLOW" "  NOTE: something is still listening on port $PORT — most likely the OLD server, not the new build."
    fi
  fi
  say "$C_RED" "  Swapper log: $SWAP_LOG"
  exit 1
fi
