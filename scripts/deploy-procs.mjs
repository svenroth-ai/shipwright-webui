/**
 * deploy-procs.mjs — OS process discovery + termination for the production deploy.
 *
 * The impure twin of kill-targets.js (port-kill helpers, shared with
 * dev-restart.js) and deploy-tsx-scope.js (tsx-watch repo-scoping helpers) —
 * both pure parsing, unit-tested. Split out of deploy-swap.mjs to keep both
 * files inside the 300-line convention; the swapper owns the deploy
 * CHOREOGRAPHY, this file owns "which processes, and how do we end them".
 *
 * The one rule that must never be broken here: KILL ONE PROCESS, NEVER ITS TREE.
 * See killPid().
 */

import { execSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Audited kill-scope helpers: state-filtered, exact-port, IPv6-aware — see
// kill-targets.js for the WHY on each.
const { parseWindowsListenerPids, buildLsofCommand } = require('./kill-targets.js');
// tsx-watch repo-scoping helpers — see deploy-tsx-scope.js for the WHY.
const {
  parseWindowsTsxEntries,
  parsePosixTsxEntries,
  filterTsxEntriesByRepo,
} = require('./deploy-tsx-scope.js');

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
 * PIDs of a `tsx watch` dev server belonging to `repoRoot`'s own checkout.
 *
 * Why this exists at all: killing only the port listener is not enough when the
 * server runs under `tsx watch` — the watch PARENT would immediately respawn the
 * child and re-take the port. The parent has to go too.
 *
 * Discovery still matches the generic markers `tsx` + `src/index.ts` (that part
 * says nothing about which repo), but the raw candidates are then narrowed to
 * `repoRoot` via filterTsxEntriesByRepo() — see deploy-tsx-scope.js for why
 * matching the repo path this way is safe rather than "silently narrows to nothing"
 * (iterate-2026-09-09-deploy-tsx-kill-scope; fixes the machine-wide scope this
 * function originally inherited verbatim from the pre-fix inline sweep).
 *
 * @param {string} [repoRoot] absolute path to the server dir being deployed —
 *   required to find anything; an empty repoRoot returns [] (fail closed).
 * @param {(diag: {raw: number|null, matched: number|null, error?: string}) => void} [onDiag]
 *   Fires exactly once with raw-candidate / matched-in-repo counts (or an
 *   `error` when discovery itself failed). `[]` is otherwise ambiguous
 *   between "nothing running", "discovery failed", and "candidates existed
 *   but none matched this repo" — three states with the same symptom
 *   (the watch parent survives) but different fixes. Optional and
 *   best-effort so existing callers/tests that ignore it are unaffected.
 */
export function findTsxServerPids(repoRoot, onDiag) {
  if (!repoRoot) return [];
  const diag = (d) => { if (onDiag) onDiag(d); };
  try {
    let raw;
    if (isWin) {
      // spawnSync with shell:false — the argument reaches powershell.exe verbatim.
      // An execSync string would cross JS -> cmd.exe -> powershell, three escaping
      // layers deep, where one added quote silently turns the sweep into a no-op.
      // -Filter "Name='node.exe'" is what bounds the CIM output size; the tsx +
      // src/index.ts marker match now lives in parseWindowsTsxEntries() (JS side)
      // so it can never drift from the POSIX arm's equivalent check — which
      // means, unlike the pre-fix Where-Object clause, this pipe now carries
      // EVERY node.exe process's PID+CommandLine, not just the 2-4 matches.
      // maxBuffer, symmetric with the POSIX arm below: spawnSync's 1 MiB
      // default silently TRUNCATES stdout on overflow (no throw), which would
      // corrupt the JSON and make parseWindowsTsxEntries return [] the same
      // way a genuine "nothing is running" result does.
      // [Console]::OutputEncoding=UTF8: PowerShell 5.1 writes redirected stdout
      // in the OEM codepage by default; any non-ASCII byte in ANY node.exe
      // command line on the machine would otherwise corrupt the JSON stream
      // and drop every candidate, not just the offending one.
      // ParentProcessId: lets filterTsxEntriesByRepo() order a kill-safe
      // parents-before-children sequence instead of trusting raw CIM
      // enumeration order (external review round 5, openai).
      const script =
        '[Console]::OutputEncoding=[Text.Encoding]::UTF8; ' +
        "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
        'Select-Object ProcessId, ParentProcessId, CommandLine | ConvertTo-Json -Compress';
      const r = spawnSync('powershell', ['-NoProfile', '-Command', script], {
        encoding: 'utf-8',
        shell: false,
        maxBuffer: 16 * 1024 * 1024,
      });
      // r.error (spawn itself failed, e.g. powershell missing) and a non-zero
      // exit are both silently-successful-looking to JSON.parse otherwise —
      // partial/garbage stdout would parse as "no candidates" instead of
      // "discovery failed", which is the wrong diagnosis to hand the operator.
      // Empty stdout on a CLEAN exit is NOT an error, though: when zero
      // node.exe processes match the CIM filter, ConvertTo-Json legitimately
      // prints nothing on an empty pipeline — that is "0 candidates", not a
      // failure (external review round 2 caught this ambiguity in the
      // original check, which is exactly the false diagnosis onDiag exists
      // to prevent).
      if (r.error || r.status !== 0) {
        diag({ raw: null, matched: null, error: r.error ? String(r.error) : `powershell exited ${r.status}` });
        return [];
      }
      raw = parseWindowsTsxEntries(r.stdout);
    } else {
      // ps -A -o pid=,args= (NOT pgrep -af): pgrep's -a flag is not portable —
      // it means "include the full command line" on Linux (procps) but "include
      // process ancestors" on macOS/BSD, which would leave every entry's command
      // line empty and silently drop the whole sweep there. See
      // deploy-tsx-scope.js's parsePosixTsxEntries() for the full story; it also owns the tsx +
      // src/index.ts match, since ps -A itself returns every process unfiltered.
      // -ww: never truncate a long command line to terminal width (the match
      // needs the FULL line, including the trailing src/index.ts). maxBuffer:
      // execSync's 1 MiB default is sized for a handful of PIDs (what pgrep
      // used to return); ps -A emits every process's full argv, which can
      // exceed it on a loaded dev machine — an ENOBUFS there would silently
      // return [] through the catch below and leave the watch parent alive.
      const out = execSync('ps -Aww -o pid=,ppid=,args=', { ...CAPTURE, maxBuffer: 16 * 1024 * 1024 });
      raw = parsePosixTsxEntries(out);
    }
    const matched = filterTsxEntriesByRepo(raw, repoRoot);
    diag({ raw: raw.length, matched: matched.length });
    return matched;
  } catch (e) {
    diag({ raw: null, matched: null, error: String(e) });
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
 * Kill ORDER is load-bearing: the tsx-watch PARENT goes first, the port
 * listener (its child, when the two are distinct PIDs) second. Killing the
 * listener first leaves the parent alive for the gap until its own kill
 * lands — long enough, per this function's own justification above, for
 * `tsx watch` to respawn a new child and re-take the port before we ever
 * get to the parent.
 *
 * @param {number} port
 * @param {{timeoutMs?: number, repoRoot?: string, onDiag?: (diag: {raw: number|null, matched: number|null, error?: string}) => void}} [options]
 * @param {number} [options.timeoutMs]
 * @param {string} [options.repoRoot] absolute path to the server dir being
 *   deployed — scopes the tsx-watch sweep to this checkout only, see
 *   findTsxServerPids().
 * @param {(diag: {raw: number|null, matched: number|null, error?: string}) => void} [options.onDiag]
 *   forwarded to findTsxServerPids() — see its doc for why this matters.
 * @returns {Promise<{freed: boolean, killed: string[], survivor: string|null}>}
 */
export async function stopOldServer(port, { timeoutMs = 5000, repoRoot, onDiag } = {}) {
  const killed = [...new Set([...findTsxServerPids(repoRoot, onDiag), ...findListenerPids(port)])];
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
