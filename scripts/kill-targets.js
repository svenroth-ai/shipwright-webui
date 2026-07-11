/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Port-selection helper for dev-restart.js.
 *
 * Pure function: no subprocess calls, no filesystem. The kill-scope is
 * exactly the two configured ports (Hono + Vite), each with a default.
 *
 * Worktree-parallel contract: if the operator sets PORT and VITE_PORT for
 * their worktree, this function returns ONLY those ports — nothing
 * hardcoded, nothing leaked from a different worktree's config. The
 * historic VITE_ALT_PORT=5177 hardcode was removed in v0.3.2.
 */

const DEFAULT_HONO_PORT = 3847;
const DEFAULT_VITE_PORT = 5173;

/**
 * @param {Record<string,string|undefined>} env
 * @param {string} _platform  // reserved for future platform-specific overrides
 * @returns {number[]} deduped, finite, positive kill targets
 */
function computeKillTargets(env, _platform) {
  const honoPort = parsePort(env.PORT, DEFAULT_HONO_PORT);
  const vitePort = parsePort(env.VITE_PORT, DEFAULT_VITE_PORT);
  const seen = new Set();
  const out = [];
  for (const p of [honoPort, vitePort]) {
    if (!Number.isFinite(p) || p <= 0) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

function parsePort(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

/**
 * Extract the numeric port from a netstat "Local Address" token.
 *
 * Handles IPv4 (`0.0.0.0:5173`, `127.0.0.1:5173`) and IPv6
 * (`[::]:5173`, `[::1]:5173`) — the port is always the run of digits after
 * the LAST colon. Returns null when no numeric port is present.
 *
 * @param {string} addr
 * @returns {number|null}
 */
function localAddressPort(addr) {
  if (typeof addr !== 'string') return null;
  const idx = addr.lastIndexOf(':');
  if (idx === -1) return null;
  const portStr = addr.slice(idx + 1);
  if (!/^\d+$/.test(portStr)) return null;
  return Number(portStr);
}

/**
 * Structurally parse Windows `netstat -ano -p TCP` output and return the PIDs
 * of processes LISTENING on one of the given ports.
 *
 * Fixes F16 (D11): the prior `netstat … | findstr :<port>` did plain substring
 * matching over the whole line with no state filter, so it also caught
 *   (1) ESTABLISHED browser sockets whose FOREIGN address ended `:<port>`, and
 *   (2) port-prefix collisions (`:5173` is a substring of `:51730`),
 * and taskkill /F /T'd those unrelated PIDs. This parser requires
 * state === LISTENING AND an EXACT local-address port match.
 *
 * Handles IPv4 AND IPv6: plain `netstat -ano` output labels IPv6 rows proto
 * `TCP` (distinguished by the `[::]` address), and some Windows builds use
 * `TCPv6` — the proto check is `startsWith('TCP')` to cover both. UDP rows
 * (`*:*` foreign, no State column, 4 tokens) fall out via the < 5 / state
 * checks. Feed it `netstat -ano` (NOT `-p TCP`, which drops IPv6 listeners).
 *
 * @param {string} netstatOutput  raw stdout of `netstat -ano`
 * @param {number[]} ports        kill-target ports (already validated)
 * @returns {string[]}            deduped PID strings, in first-seen order
 */
function parseWindowsListenerPids(netstatOutput, ports) {
  const wanted = new Set(ports.map(Number));
  const seen = new Set();
  const pids = [];
  for (const rawLine of String(netstatOutput ?? '').split(/\r?\n/)) {
    const cols = rawLine.trim().split(/\s+/);
    // A TCP row is: Proto  LocalAddr  ForeignAddr  State  PID
    if (cols.length < 5) continue;
    if (!cols[0].toUpperCase().startsWith('TCP')) continue;
    const state = cols[cols.length - 2].toUpperCase();
    if (state !== 'LISTENING') continue;
    const port = localAddressPort(cols[1]);
    if (port === null || !wanted.has(port)) continue;
    const pid = cols[cols.length - 1];
    if (!/^\d+$/.test(pid)) continue;
    if (seen.has(pid)) continue;
    seen.add(pid);
    pids.push(pid);
  }
  return pids;
}

/**
 * Build the POSIX lsof command that lists only LISTENING PIDs on the given
 * ports. The `-sTCP:LISTEN` state filter is the POSIX half of the F16 fix —
 * without it, `lsof -ti tcp:<ports>` returns every socket (incl. the
 * ESTABLISHED browser connections) bound to those ports.
 *
 * The command is run via `execSync` (shell), so — although callers pass ports
 * already validated by computeKillTargets — every port is coerced to a positive
 * integer and non-integers are dropped here too. That keeps the exported helper
 * injection-proof regardless of caller (defense in depth at the boundary).
 *
 * @param {number[]} ports
 * @returns {string} shell command string for execSync
 */
function buildLsofCommand(ports) {
  const portList = ports
    .map(Number)
    .filter((p) => Number.isInteger(p) && p > 0)
    .join(',');
  return `lsof -ti -sTCP:LISTEN tcp:${portList}`;
}

module.exports = {
  computeKillTargets,
  parseWindowsListenerPids,
  buildLsofCommand,
};
