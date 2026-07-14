/**
 * deploy-procs.mjs — OS process discovery + termination for the production deploy.
 *
 * The impure twin of kill-targets.js (which is pure parsing, unit-tested, shared
 * with dev-restart.js). Split out of deploy-swap.mjs to keep both files inside the
 * 300-line convention; the swapper owns the deploy CHOREOGRAPHY, this file owns
 * "which processes, and how do we end them".
 *
 * The one rule that must never be broken here: KILL ONE PROCESS, NEVER ITS TREE.
 * See killPid().
 */

import { execSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Audited kill-scope helpers: state-filtered, exact-port, IPv6-aware.
const { parseWindowsListenerPids, buildLsofCommand } = require('./kill-targets.js');

const isWin = process.platform === 'win32';
const CAPTURE = { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] };

/**
 * The kill scope is EXACTLY the Hono port — never Vite. Deliberately NOT
 * kill-targets.computeKillTargets(), which returns [PORT, VITE_PORT] for
 * `dev:fresh` (that restarts both halves): a production deploy which swept the
 * Vite port too would kill the operator's dev server as a side effect.
 *
 * @param {number} port
 * @returns {number[]}
 */
export function killPortsFor(port) {
  return [Number(port)];
}

/**
 * Can we enumerate listeners at all? Windows always has netstat; POSIX needs lsof.
 * Without it findListenerPids() returns [] for "nothing is listening" AND for "I
 * cannot see listeners" — which would report a perfectly healthy server as a failed
 * deploy. The pre-fix .sh had this fallback ("no lsof: settle for the process still
 * being alive"); callers must keep it rather than lie about the outcome.
 */
export function canDiscoverListeners() {
  if (isWin) return true;
  try {
    execSync('command -v lsof', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** PIDs LISTENING on the port (state-filtered + exact-port on both platforms). */
export function findListenerPids(port) {
  const ports = killPortsFor(port);
  try {
    if (isWin) {
      // Plain `netstat -ano` (NOT `-p TCP`, which drops IPv6 listeners).
      return parseWindowsListenerPids(execSync('netstat -ano', CAPTURE), ports);
    }
    const cmd = buildLsofCommand(ports);
    if (!cmd) return [];
    return execSync(cmd, CAPTURE).split(/\s+/).filter(Boolean);
  } catch {
    // netstat/lsof missing, or lsof exits 1 when nothing matches — nothing to kill.
    return [];
  }
}

/**
 * PIDs of a `tsx watch` dev server on a webui server entry.
 *
 * Why this exists at all: killing only the port listener is not enough when the
 * server runs under `tsx watch` — the watch PARENT would immediately respawn the
 * child and re-take the port. The parent has to go too.
 *
 * KNOWN over-broad scope (inherited verbatim from the pre-fix inline sweep, kept
 * for behavior parity): the match is `tsx` + `src/index.ts`, which also hits a
 * *different* project's dev server, because a `tsx watch` command line carries the
 * entry path relatively (`src/index.ts`) and not the repo it belongs to. Narrowing
 * it needs per-PID cwd resolution — deliberately out of scope for the self-kill fix
 * (see the iterate's decision drop).
 */
export function findTsxServerPids() {
  try {
    if (isWin) {
      // spawnSync with shell:false — the argument reaches powershell.exe verbatim.
      // An execSync string would cross JS -> cmd.exe -> powershell, three escaping
      // layers deep, where one added quote silently turns the sweep into a no-op.
      const script =
        "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
        "Where-Object { $_.CommandLine -match 'tsx' -and $_.CommandLine -match 'src[\\\\/]index\\.ts' } | " +
        'Select-Object -ExpandProperty ProcessId';
      const r = spawnSync('powershell', ['-NoProfile', '-Command', script], {
        encoding: 'utf-8',
        shell: false,
      });
      return String(r.stdout ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    }
    return execSync("pgrep -f 'tsx.*src/index\\.ts'", CAPTURE).split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Kill ONE process — never its tree.
 *
 * LOAD-BEARING: `taskkill /F /T` (what dev-restart.js uses) kills the target's
 * DESCENDANTS too — and when the deploy runs from an embedded terminal, the swapper
 * *is* a descendant of the Hono server it is about to kill. A /T sweep would
 * therefore kill the swapper itself and re-create the very outage the swapper
 * exists to prevent. Same on POSIX: signal the PID, never the process group.
 */
export function killPid(pid) {
  try {
    if (isWin) {
      execSync(`taskkill /F /PID ${Number(pid)}`, { stdio: 'ignore' });
    } else {
      process.kill(Number(pid), 'SIGTERM');
    }
    return true;
  } catch {
    return false;
  }
}

/** SIGKILL escalation for anything still alive after the grace period (POSIX only). */
export function killPidHard(pid) {
  try {
    if (!isWin) process.kill(Number(pid), 'SIGKILL');
  } catch { /* already gone */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Stop whatever serves the port and WAIT FOR EVIDENCE that it is free.
 *
 * The pre-fix scripts slept a flat 700 ms and started regardless. If the kill did
 * not land (a PID the user may not touch, a wedged process), the new server walks
 * straight into EADDRINUSE and dies — leaving the machine with NO server. A stale
 * old server is a bad outcome; no server at all is a far worse one. So when the
 * port refuses to free, the caller must NOT start: `freed: false` means "leave the
 * old server alone and report it".
 *
 * POSIX gets a real grace period first (SIGTERM), because the server flushes
 * terminal snapshots on shutdown (ADR-092/096) and an immediate axe truncates that;
 * SIGKILL follows only if it is still there. Windows has no graceful signal —
 * taskkill /F was immediate before this change too.
 *
 * @returns {Promise<{freed: boolean, killed: string[], survivor: string|null}>}
 */
export async function stopOldServer(port, { timeoutMs = 5000 } = {}) {
  const killed = [...new Set([...findListenerPids(port), ...findTsxServerPids()])];
  for (const pid of killed) killPid(pid);

  // Cannot observe listeners (no lsof) — fall back to the pre-fix behavior.
  if (!canDiscoverListeners()) {
    await sleep(700);
    return { freed: true, killed, survivor: null };
  }

  const deadline = Date.now() + timeoutMs;
  let escalated = false;
  while (Date.now() < deadline) {
    await sleep(250);
    const still = findListenerPids(port);
    if (still.length === 0) return { freed: true, killed, survivor: null };
    if (!escalated && Date.now() > deadline - timeoutMs / 2) {
      for (const pid of still) killPidHard(pid);
      escalated = true;
    }
  }
  return { freed: false, killed, survivor: findListenerPids(port)[0] ?? null };
}

/**
 * Ready = a listener on the port owned by OUR child. A stale listener (an old
 * server that survived the kill) can therefore never fake success. Fails fast when
 * the child exits (EADDRINUSE, missing dist, crash on boot), and degrades to a
 * liveness check where listeners are not observable.
 *
 * @returns {Promise<{ok: boolean, readiness: 'listener'|'process-alive', exited: boolean, exitCode: number|null}>}
 */
export async function waitForServerUp(port, child, { timeoutMs = 12000 } = {}) {
  let exited = false;
  let exitCode = null;
  child.on('exit', (code) => {
    exited = true;
    exitCode = code;
  });

  if (!canDiscoverListeners()) {
    await sleep(2500);
    return { ok: !exited, readiness: 'process-alive', exited, exitCode };
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(500);
    if (exited) return { ok: false, readiness: 'listener', exited, exitCode };
    if (findListenerPids(port).includes(String(child.pid))) {
      return { ok: true, readiness: 'listener', exited: false, exitCode: null };
    }
  }
  return { ok: false, readiness: 'listener', exited, exitCode };
}
