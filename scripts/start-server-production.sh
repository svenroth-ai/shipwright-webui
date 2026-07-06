#!/usr/bin/env bash
# start-server-production.sh
# ---------------------------------------------------------------------------
# (Re)starts the Shipwright WebUI Hono server in PRODUCTION mode
# (`node dist/index.js`, NO `tsx watch`) — in the BACKGROUND.
#
# macOS / Linux parallel of start-server-production.ps1. Same contract: rebuild
# both halves, stop the old server, start the fresh build detached, and heal a
# corrupted ~/.claude.json around the restart.
#
# Why production: `tsx watch` (the `npm run dev` script) restarts the server on
# every server-file change, which kills ALL embedded-terminal ptys. Production
# has no watcher -> stable for multi-task use.
#
# Run it:  bash scripts/start-server-production.sh   (or ./scripts/start-server-production.sh)
# Stop it: bash scripts/stop-server.sh
# Server log: ~/.shipwright-webui/server-manual.log
#
# ORDER MATTERS — install + build FIRST, then swap. A failed install/build (or
# a window closed mid-build) leaves the currently running server UNTOUCHED. You
# can never end up with no server.
# ---------------------------------------------------------------------------
set -u

PORT="${PORT:-3847}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER="$REPO/server"
CLIENT="$REPO/client"
LOG_DIR="$HOME/.shipwright-webui"
LOG="$LOG_DIR/server-manual.log"

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
#    session. This Step-0 run heals corruption left by a PREVIOUS deploy; the
#    corruption THIS deploy causes happens seconds later (step 2's server-kill
#    races the embedded writers), so step 5 below re-runs the guard after the
#    restart. BEST EFFORT: the deploy NEVER gates on the result — a missing
#    `node` or a script error must not block the deploy (server/build don't
#    depend on ~/.claude.json). See scripts/repair-claude-json.mjs.
say "$C_CYAN" 'Checking ~/.claude.json integrity...'
node "$SCRIPT_DIR/repair-claude-json.mjs" \
  || say "$C_DIM" '  (skipped: repair-claude-json.mjs did not run cleanly)'

# 1. Install deps + build FIRST (server + client). If ANY step fails, the
#    running server is left alone (it is not killed until step 2). The Hono
#    server serves client/dist in production, so the client must be installed +
#    built too — otherwise the UI is stale/missing.
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

# 2. Build OK -> stop the old Hono: the port listener + any `tsx` process
#    running this repo's server entry (the watch parent and its child).
echo
say "$C_YELLOW" 'Build OK. Stopping the old server...'
killed=''
if command -v lsof >/dev/null 2>&1; then
  port_pids="$(lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null || true)"
else
  port_pids=''
fi
tsx_pids="$(pgrep -f 'tsx.*src/index\.ts' 2>/dev/null || true)"
for pid in $port_pids $tsx_pids; do
  if kill "$pid" 2>/dev/null; then killed="$killed $pid"; fi
done
# escalate to SIGKILL for anything still alive after a grace period
sleep 0.3
for pid in $port_pids $tsx_pids; do
  if kill -0 "$pid" 2>/dev/null; then kill -9 "$pid" 2>/dev/null || true; fi
done
killed="$(echo "$killed" | tr ' ' '\n' | sort -un | tr '\n' ' ' | sed 's/^ *//;s/ *$//')"
if [ -n "$killed" ]; then say "$C_DIM" "  stopped PID(s): $killed"; fi
sleep 0.7

# 3. Launch the fresh build in the BACKGROUND, detached, output -> log file.
mkdir -p "$LOG_DIR"
echo
say "$C_CYAN" 'Starting in background...'
# Node's --env-file-if-exists loads the repo-root .env.local (network profile
# etc.) — same as the `npm run dev` script. Without it the server would bind
# differently (e.g. loopback instead of the Tailscale address) and the UI would
# be unreachable on the address you normally use.
PORT="$PORT" nohup node --env-file-if-exists=../.env.local dist/index.js > "$LOG" 2>&1 &
server_pid=$!
disown "$server_pid" 2>/dev/null || true

# 4. Confirm it bound the port.
up=false
for _ in $(seq 1 16); do
  sleep 0.5
  if ! kill -0 "$server_pid" 2>/dev/null; then break; fi   # process exited early
  if command -v lsof >/dev/null 2>&1; then
    if lsof -ti "tcp:$PORT" -sTCP:LISTEN >/dev/null 2>&1; then up=true; break; fi
  else
    up=true; break   # no lsof: settle for "process still alive"
  fi
done

echo
if [ "$up" = true ]; then
  say "$C_GREEN" '  OK - Hono runs in the background, no window.'
  say "$C_GREEN" '  Restart: run this again.  Stop: bash scripts/stop-server.sh'
  say "$C_GREEN" "  Log: $LOG"
  echo

  # 5. Self-heal ~/.claude.json a SECOND time, now that the server is up. The
  #    Step-0 run can only heal a PREVIOUS deploy's leftover corruption; THIS
  #    deploy's server-kill (step 2) took down every embedded `claude` pty and
  #    the racing shutdown writes are what corrupt the (non-atomic, unlocked)
  #    file. This is the clean window: the old sessions are dead and a UI reload
  #    has not yet spawned new ones, so heal here before the user reconnects.
  #    SAME best-effort contract — result is never gated on.
  say "$C_CYAN" 'Re-checking ~/.claude.json integrity (post-restart)...'
  node "$SCRIPT_DIR/repair-claude-json.mjs" \
    || say "$C_DIM" '  (skipped: repair-claude-json.mjs did not run cleanly)'
  echo
else
  say "$C_RED" "  Server did NOT come up on port $PORT."
  if [ -f "$LOG" ]; then
    say "$C_RED" '  --- last lines of server-manual.log ---'
    tail -n 25 "$LOG" 2>/dev/null || true
  fi
  exit 1
fi
