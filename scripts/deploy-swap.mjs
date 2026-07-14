#!/usr/bin/env node
/**
 * deploy-swap.mjs — the detached half of the production deploy.
 *
 * The deploy scripts used to kill the old server and start the new one inline.
 * Run from the Command Center's embedded terminal, the caller is a DESCENDANT of
 * the Hono server it kills (Hono -> node-pty shell -> claude -> the script), so
 * the kill tore down the ConPTY and took the caller with it: the "start the new
 * server" step never ran. Fresh build on disk, NO server, no diagnostic — the
 * process that would have printed one was the one that died (outage 2026-07-14).
 *
 * The caller spawns THIS helper detached *before* any kill happens, so it outlives
 * that cascade and finishes what the caller cannot. Empirically verified: a
 * `Start-Process` (Windows) / `nohup` (POSIX) child survives the kill.
 *
 * Contract — the caller owns install + build (a failed build must leave the running
 * server untouched: it never gets here); this helper owns kill -> start ->
 * readiness -> post-restart heal -> durable status. Full story + evidence:
 * .shipwright/planning/iterate/2026-07-14-deploy-self-kill.md
 *
 * Usage (from the deploy scripts, detached):  node scripts/deploy-swap.mjs --port 3847
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stopOldServer, waitForServerUp } from './deploy-procs.mjs';

const DEFAULT_PORT = 3847;
const READY_TIMEOUT_MS = 12_000;
const PORT_FREE_TIMEOUT_MS = 5_000;
const SWAP_LOG_CAP_BYTES = 256 * 1024;

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const serverDir = path.join(repo, 'server');
const logDir = path.join(os.homedir(), '.shipwright-webui');
const SERVER_LOG = path.join(logDir, 'server-manual.log');
const SWAP_LOG = path.join(logDir, 'deploy-swap.log');
const STATUS_FILE = path.join(logDir, 'deploy-status.json');

// --- Pure helpers (unit-tested in deploy-swap.test.mjs) --------------------

/**
 * Resolve the Hono port. Mirrors the callers' guards (the .ps1's `^\d{1,5}$`,
 * which also keeps the cast under Int32.MaxValue, and the .sh's `${PORT:-3847}`)
 * so caller and swapper can never disagree on the target.
 *
 * @param {Record<string, unknown>} [env]
 * @returns {number}
 */
const isValidPort = (raw) => /^\d{1,5}$/.test(raw) && Number(raw) > 0;

export function resolvePort(env = {}) {
  const raw = env?.PORT === undefined || env?.PORT === null ? '' : String(env.PORT);
  return isValidPort(raw) ? Number(raw) : DEFAULT_PORT;
}

/**
 * `--port` (passed by the caller, which already resolved it for its own readiness
 * poll and operator messages) wins over the environment. One rule, one resolved
 * value in every sink; a malformed flag degrades instead of throwing.
 *
 * @param {string[]} [argv]
 * @param {Record<string, unknown>} [env]
 * @returns {{ port: number }}
 */
export function parseArgs(argv = [], env = {}) {
  const i = argv.indexOf('--port');
  const raw = i !== -1 && argv[i + 1] !== undefined ? String(argv[i + 1]) : '';
  return { port: isValidPort(raw) ? Number(raw) : resolvePort(env) };
}

/**
 * The durable record of the deploy outcome. Inside an embedded terminal the caller
 * is killed mid-deploy, so it cannot be the one to report success or failure —
 * that is precisely how the 2026-07-14 outage stayed invisible for hours.
 *
 * @param {{ok: unknown, port: unknown, pid?: unknown, ts: unknown, error?: unknown, readiness?: string}} o
 */
export function buildStatus({ ok, port, pid = null, ts, error = null, readiness = 'listener' }) {
  return {
    ok: Boolean(ok),
    port: Number(port),
    pid: pid === null || pid === undefined ? null : Number(pid),
    ts: Number(ts),
    error: error ?? null,
    // How `ok` was established: 'listener' (the new child owns the port — the
    // strong claim) or 'process-alive' (no lsof on this host; the child was
    // merely still running). The caller reports the verdict, so it must be able
    // to tell the two apart.
    readiness,
  };
}

// --- Side-effecting steps --------------------------------------------------

function log(msg) {
  const line = `[deploy-swap] ${new Date().toISOString()} ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(SWAP_LOG, line + '\n');
  } catch {
    // The log is a convenience; never fail the deploy over it.
  }
}

/** Last lines of the server log — the only thing that explains an EADDRINUSE or a crash on boot. */
function serverLogTail(lines = 12) {
  try {
    return fs
      .readFileSync(SERVER_LOG, 'utf-8')
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-lines)
      .join(' | ');
  } catch {
    return '(no server log)';
  }
}

/**
 * Open the server log — and NEVER let it block the deploy.
 *
 * `w` (truncate) matches the old `> $log`. But the file can be held by another
 * instance: a second webui on a different PORT shares this path, and a server
 * launched the old way (a `cmd` redirect) holds it with restrictive sharing, so
 * openSync throws EBUSY. Losing the log is a nuisance; losing the SERVER because
 * we could not open a log file would be the very outage this helper exists to
 * prevent. Degrade: truncate -> append -> no log at all.
 */
function openServerLog() {
  for (const flags of ['w', 'a']) {
    try {
      return fs.openSync(SERVER_LOG, flags);
    } catch { /* held by another instance — try the next mode */ }
  }
  log(`WARNING: ${SERVER_LOG} is not writable — starting the server without a log`);
  return 'ignore';
}

/** Start the freshly built server, detached, so it outlives THIS helper too. */
function startServer(port) {
  const out = openServerLog();
  const child = spawn(
    process.execPath,
    ['--env-file-if-exists=../.env.local', 'dist/index.js'],
    {
      cwd: serverDir,
      env: { ...process.env, PORT: String(port) },
      detached: true,
      stdio: ['ignore', out, out],
      shell: false,
    },
  );
  child.unref();
  return child;
}

/**
 * Post-restart ~/.claude.json heal. It used to sit in the CALLER — i.e. in code
 * already dead by the time it matters, because the server-kill it waits on is the
 * same kill that takes the caller down. Best effort: never gated on.
 */
function heal(label) {
  try {
    spawnSync(process.execPath, [path.join(here, 'repair-claude-json.mjs')], {
      stdio: 'ignore',
    });
    log(`~/.claude.json integrity check done (${label})`);
  } catch {
    log(`~/.claude.json integrity check skipped (${label})`);
  }
}

function writeStatus(status) {
  try {
    fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2) + '\n');
  } catch (e) {
    log(`could not write ${STATUS_FILE}: ${String(e)}`);
  }
}

/**
 * Keep the swapper's history, but bounded. server-manual.log is truncated on every
 * deploy; this one is appended to (it must survive the restart that truncates the
 * other), so without a cap it grows forever.
 */
function capSwapLog() {
  try {
    if (fs.statSync(SWAP_LOG).size <= SWAP_LOG_CAP_BYTES) return;
    const kept = fs.readFileSync(SWAP_LOG, 'utf-8').slice(-SWAP_LOG_CAP_BYTES / 2);
    fs.writeFileSync(SWAP_LOG, kept);
  } catch { /* no log yet, or unreadable — nothing to cap */ }
}

async function main() {
  fs.mkdirSync(logDir, { recursive: true });
  capSwapLog();
  // A stale status file from a PREVIOUS deploy must never be mistaken for this
  // run's verdict by the (possibly still alive) caller.
  fs.rmSync(STATUS_FILE, { force: true });

  const { port } = parseArgs(process.argv.slice(2), process.env);
  const finish = (ok, extra) => {
    // The verdict is written BEFORE the (best-effort, possibly slow) heal, so a
    // caller waiting on it is never blocked by a step that cannot change it.
    writeStatus(buildStatus({ ok, port, ts: Date.now(), ...extra }));
    log(ok ? `OK — ${extra.pid ? `server up on ${port} (pid ${extra.pid})` : 'done'}` : `FAILED — ${extra.error}`);
    return ok;
  };

  log(`swap starting (port ${port}, pid ${process.pid})`);

  // 1. Stop the old server. From here on the caller may die at any moment — this
  //    kill tears down the ConPTY that hosts it.
  const { freed, killed, survivor } = await stopOldServer(port, {
    timeoutMs: PORT_FREE_TIMEOUT_MS,
  });
  log(killed.length ? `stopped PID(s): ${killed.join(' ')}` : `nothing was listening on ${port}`);

  if (!freed) {
    // The port never came free. Starting now would only hit EADDRINUSE and leave
    // the machine with NOTHING. The old server is still up — worse than a fresh
    // one, far better than none. Say so loudly and stop here.
    heal('kill-failed');
    return finish(false, {
      readiness: 'listener',
      error:
        `port ${port} is still held by PID ${survivor} after ${PORT_FREE_TIMEOUT_MS} ms — ` +
        `the OLD server is still running and was NOT replaced (nothing new was started)`,
    });
  }

  // 2. Start the fresh build.
  const child = startServer(port);
  log(`started node dist/index.js (pid ${child.pid})`);

  // 3. Confirm OUR child took the port (or, without lsof, that it is alive).
  const { ok, readiness, exited, exitCode } = await waitForServerUp(port, child, {
    timeoutMs: READY_TIMEOUT_MS,
  });

  // 4. Heal ~/.claude.json in the clean window: the old embedded sessions are
  //    dead and a UI reload has not spawned new ones yet.
  heal('post-restart');

  return finish(ok, {
    pid: ok ? child.pid : null,
    readiness,
    error: ok
      ? null
      : exited
        ? `the new server exited on startup (code ${exitCode}) — ${serverLogTail()}`
        : `the new server did not take port ${port} within ${READY_TIMEOUT_MS} ms — ${serverLogTail()}`,
  });
}

// Only run when invoked as a script — importing it (tests) must stay side-effect free.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main()
    .then((ok) => process.exit(ok ? 0 : 1))
    .catch((e) => {
      // A throw AFTER the kill (spawn EACCES, an unwritable log) would otherwise
      // leave no server AND no status file — the failure mode that made the
      // original outage invisible. The record survives even the unexpected.
      try {
        const { port } = parseArgs(process.argv.slice(2), process.env);
        writeStatus(buildStatus({ ok: false, port, ts: Date.now(), error: `swap crashed: ${String(e)}` }));
      } catch { /* nothing left to do */ }
      log(`CRASHED — ${String(e)}`);
      process.exit(1);
    });
}
