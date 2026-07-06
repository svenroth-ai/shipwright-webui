#!/usr/bin/env bash
# stop-server.sh
# Stops the Shipwright WebUI Hono server — whether it was started in production
# mode (start-server-production.sh) or dev mode (tsx watch). Kills the port
# listener plus any `tsx` process on the server entry. macOS / Linux parallel of
# stop-server.ps1.
set -u

PORT="${PORT:-3847}"

if [ -t 1 ]; then
  C_YELLOW=$'\033[33m'; C_GREEN=$'\033[32m'; C_DIM=$'\033[90m'; C_RESET=$'\033[0m'
else
  C_YELLOW=''; C_GREEN=''; C_DIM=''; C_RESET=''
fi
say() { printf '%s%s%s\n' "$1" "$2" "$C_RESET"; }

echo
say "$C_YELLOW" 'Stopping Shipwright WebUI Hono...'
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
if [ -n "$killed" ]; then
  say "$C_GREEN" "  stopped PID(s): $killed"
else
  say "$C_DIM" "  nothing was running on port $PORT."
fi
echo
