#!/usr/bin/env bash
#
# Boot the isolated WebUI stack and run an E2E project against it.
# A00 (iterate-2026-07-10-harness-hardening). Usage: e2e-stack.sh smoke|visual|full
#
# ── The recipe, and why each piece is load-bearing ──────────────────────────
# SINGLE PROCESS. The built client is served by Hono itself via
# SHIPWRIGHT_STATIC_DIR, so there is no Vite and no /api proxy: app and API are
# literally the same origin. That removes a whole class of CI-only failure (the
# proxy targeting the wrong host) and matches how e2e/helpers/env.ts derives
# API_BASE from the app origin.
#
# TEMP HOME. The server's registryDir is derived from os.homedir(). Pointing
# HOME/USERPROFILE at a throwaway dir is what makes the run isolated: the task
# store, the scrollback and the (synthetic) Claude JSONL all live under it and
# vanish with it. The suite's own self-locks (helpers/isolated-store.ts,
# helpers/claude-jsonl.ts, helpers/fixtures.ts) HARD-ABORT unless the resolved
# home sits under the OS temp dir, so a fumbled env fails loudly here rather than
# quietly mutating a real store.
#
# SHIPWRIGHT_E2E_ISOLATED=1. The explicit opt-in those self-locks require IN
# ADDITION to the temp-dir check — a real-machine run never sets it, so no tmp
# layout can bypass the lock.
#
# IPv4. Node resolves `localhost` to ::1 first while the Hono bind is v4.
# Everything is pinned to 127.0.0.1 for that reason alone.
#
# NO `tsx watch`. Watch mode restarts the server on any file touch, which kills
# every embedded pty it owns — and the terminal specs would then fail for reasons
# that have nothing to do with the code under test.
set -euo pipefail

MODE="${1:-smoke}"
PORT="${PORT:-4847}"
BASE_URL="http://127.0.0.1:${PORT}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMPHOME="$(mktemp -d -t sw-e2e-home-XXXXXX)"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
    kill "${SERVER_PID}" 2>/dev/null || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
  rm -rf "${TMPHOME}" || true
}
trap cleanup EXIT

echo "== booting isolated stack on ${BASE_URL} (home=${TMPHOME}) =="
cd "${REPO_ROOT}/server"
PORT="${PORT}" \
SHIPWRIGHT_STATIC_DIR="${REPO_ROOT}/client/dist" \
HOME="${TMPHOME}" USERPROFILE="${TMPHOME}" \
SHIPWRIGHT_E2E_ISOLATED=1 \
SHIPWRIGHT_NETWORK_PROFILE=local \
  npx tsx src/index.ts > "${TMPHOME}/server.log" 2>&1 &
SERVER_PID=$!

# Wait for the stack to actually answer. Failing here with the server log is far
# more useful than letting Playwright time out 30 specs later with "page not found".
for i in $(seq 1 60); do
  if curl -fsS -o /dev/null "${BASE_URL}/api/projects" 2>/dev/null; then
    echo "== stack up after ${i}s =="
    break
  fi
  if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
    echo "!! server exited during boot:"; cat "${TMPHOME}/server.log"; exit 1
  fi
  if [[ "${i}" -eq 60 ]]; then
    echo "!! stack did not come up within 60s:"; cat "${TMPHOME}/server.log"; exit 1
  fi
  sleep 1
done

cd "${REPO_ROOT}/client"
export BASE_URL
export SHIPWRIGHT_E2E_ISOLATED=1
export HOME="${TMPHOME}"
export USERPROFILE="${TMPHOME}"

# `set -e` would abort before the status could be captured, and the server log is
# the single most useful artefact when a CI-only failure happens. Capture, report,
# then propagate.
STATUS=0
case "${MODE}" in
  smoke)  npx playwright test --project=chromium --grep @smoke || STATUS=$? ;;
  visual) npx playwright test --project=visual || STATUS=$? ;;
  full)   npx playwright test --project=chromium --project=mobile-chromium || STATUS=$? ;;
  # visual-update REGENERATES the committed baselines in the pinned container — the
  # only place they can be produced (no local Docker on the dev box; a Windows
  # baseline would never match the Linux runner). Triggered by workflow_dispatch
  # (visual-baselines.yml), NOT by the PR gate. `--update-snapshots` never fails on a
  # mismatch (it rewrites the baseline), so STATUS stays 0 and the fresh
  # __screenshots__ are uploaded for the branch to commit.
  visual-update) npx playwright test --project=visual --update-snapshots || STATUS=$? ;;
  *) echo "unknown mode: ${MODE} (expected smoke|visual|full|visual-update)"; exit 2 ;;
esac

if [[ "${STATUS}" -ne 0 ]]; then
  echo "== server log (tail) =="
  tail -50 "${TMPHOME}/server.log" || true
fi
exit "${STATUS}"
