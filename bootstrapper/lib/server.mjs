/**
 * server.mjs — AC1c + AC4: port-check, then boot / attach / swap. Open browser.
 *
 * Probe :3847 on 127.0.0.1 (IPv4 — Node resolves `localhost` → ::1 but Hono
 * binds v4; a known trap in this repo). Then:
 *   free                        → boot the packaged server (detached, outlives npx)
 *   Shipwright, same-or-newer   → ATTACH (open browser, no 2nd server)
 *   Shipwright, OLDER           → SWAP via the DETACHED deploy-swap.mjs
 *   foreign                     → FAIL LOUD with a PORT= remediation, incumbent ALIVE
 *
 * This module issues NO kill/taskkill/process.kill — ever. The incumbent on
 * :3847 may be hosting the very terminal this command runs in (PR #249, the
 * deploy self-kill). The swap's kill lives ONLY inside the detached swapper,
 * which is spawned BEFORE any kill so it outlives the caller's death cascade.
 */

import path from "node:path";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";

import { compareSemver } from "./util.mjs";
import { tcpOccupied, checkNativePty } from "./probes.mjs";

// Re-exported so callers/tests keep a single `server.mjs` surface.
export { tcpOccupied, checkNativePty } from "./probes.mjs";

const DEFAULT_PORT = 3847;

/**
 * The Command Center's wire-protocol identity — MUST match `APP_NAME` in the
 * server's diagnostics route. A foreign process that happens to answer
 * `/api/diagnostics` with an `app.version` but NOT this exact name is treated
 * as FOREIGN (left alive, never killed), so a version alone can never
 * misidentify a stranger's server as ours.
 */
export const APP_IDENTITY = "shipwright-command-center";

/**
 * Classify a port. TCP occupancy is decided FIRST, independent of HTTP: a
 * process that accepts connections but never answers /api/diagnostics (or is
 * not HTTP at all) is FOREIGN, not free — booting a second server onto it is
 * exactly the bug AC4 forbids. Only a Shipwright server (200 +
 * `app.name === APP_IDENTITY` + `app.version`) counts as ours. Offline-safe.
 * @param {number} port
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number, tcpProbe?: typeof tcpOccupied }} [deps]
 * @returns {Promise<{ reachable: boolean, shipwright: boolean, version: string | null }>}
 */
export async function probeServer(port, deps = {}) {
  const {
    fetchImpl = typeof fetch === "function" ? fetch : undefined,
    timeoutMs = 2000,
    tcpProbe = tcpOccupied,
  } = deps;

  const occupied = await tcpProbe(port, { timeoutMs: Math.min(timeoutMs, 1500) });
  if (!occupied) return { reachable: false, shipwright: false, version: null };
  if (!fetchImpl) return { reachable: true, shipwright: false, version: null };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`http://127.0.0.1:${port}/api/diagnostics`, { signal: ctrl.signal });
    if (!res || !res.ok) return { reachable: true, shipwright: false, version: null };
    const body = await res.json();
    const app = body && typeof body.app === "object" ? body.app : null;
    const isOurs = app != null && app.name === APP_IDENTITY && typeof app.version === "string";
    return { reachable: true, shipwright: isOurs, version: isOurs ? app.version : null };
  } catch {
    // Occupied but not identifiable over HTTP → foreign (reachable, not ours).
    return { reachable: true, shipwright: false, version: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Decide the action from a probe result. Pure — the heart of AC1c/AC4.
 * @param {{ reachable: boolean, shipwright: boolean, version: string | null }} probe
 * @param {string} packageVersion
 * @returns {"boot"|"attach"|"swap"|"foreign"}
 */
export function decideAction(probe, packageVersion) {
  if (!probe.reachable) return "boot";
  if (!probe.shipwright) return "foreign";
  // Older running server → swap (a naive attach serves the OLD UI: silent
  // no-op update). Same or newer → attach (never needlessly restart or downgrade).
  return compareSemver(probe.version ?? "", packageVersion) < 0 ? "swap" : "attach";
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll the probe until `predicate(probe)` holds or the deadline passes.
 * @returns {Promise<{ ok: boolean, probe: Awaited<ReturnType<typeof probeServer>> }>}
 */
export async function pollUntil(probeFn, predicate, { timeoutMs = 15000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = { reachable: false, shipwright: false, version: null };
  while (Date.now() < deadline) {
    last = await probeFn();
    if (predicate(last)) return { ok: true, probe: last };
    await sleep(intervalMs);
  }
  return { ok: false, probe: last };
}

/**
 * Pure spawn PLAN for booting the packaged server. Detached so it outlives the
 * short-lived npx process; env points the resolver at the packaged static +
 * profiles dirs. Exported so the detached property is unit-testable without a
 * real spawn.
 */
export function bootSpawnPlan(port, pkgRoot) {
  return {
    command: process.execPath,
    args: [path.join(pkgRoot, "server", "dist", "index.js")],
    options: {
      env: {
        ...process.env,
        PORT: String(port),
        SHIPWRIGHT_STATIC_DIR: path.join(pkgRoot, "client", "dist"),
        SHIPWRIGHT_PROFILES_DIR: path.join(pkgRoot, "server", "profiles"),
      },
      detached: true,
      stdio: "ignore",
      shell: false,
    },
  };
}

/**
 * Pure spawn PLAN for the DETACHED swapper. It — not the bootstrapper — owns
 * the kill, and it is spawned detached BEFORE any kill so an invocation from
 * inside the Command Center's own terminal survives the death cascade (AC1c).
 */
export function swapperSpawnPlan(port, pkgRoot) {
  return {
    command: process.execPath,
    args: [path.join(pkgRoot, "scripts", "deploy-swap.mjs"), "--port", String(port)],
    options: { detached: true, stdio: "ignore", shell: false },
  };
}

function runPlan(plan) {
  const child = spawn(plan.command, plan.args, plan.options);
  child.unref();
  return child.pid ?? null;
}

const defaultBootServer = (port, pkgRoot) => runPlan(bootSpawnPlan(port, pkgRoot));
const defaultSpawnSwapper = (port, pkgRoot) => runPlan(swapperSpawnPlan(port, pkgRoot));

/** Default: read the swapper's durable verdict (pid + ok) if present. */
function defaultReadDeployStatus() {
  try {
    const p = path.join(os.homedir(), ".shipwright-webui", "deploy-status.json");
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

/** Default: open the browser per platform. Never fatal. */
function defaultOpenBrowser(url) {
  const plat = process.platform;
  const [cmd, args] =
    plat === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : plat === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    // nosemgrep: javascript.lang.security.audit.spawn-shell-true.spawn-shell-true -- url is `http://localhost:${port}` with port validated to an integer 1-65535 upstream; no shell metacharacter is expressible, shell:true is only for the Windows `start` builtin.
    spawn(cmd, args, { detached: true, stdio: "ignore", shell: plat === "win32" }).unref();
  } catch {
    /* headless / no browser — the URL is printed by the caller regardless */
  }
}

/**
 * Orchestrate boot / attach / swap + browser open. Pure over its seams.
 * @param {{
 *   port?: number, pkgRoot: string, packageVersion: string, noOpen?: boolean,
 *   probeFn?: () => Promise<Awaited<ReturnType<typeof probeServer>>>,
 *   bootServer?: (port:number, pkgRoot:string) => number | null,
 *   spawnSwapper?: (port:number, pkgRoot:string) => number | null,
 *   readDeployStatus?: () => any,
 *   openBrowser?: (url:string) => void,
 *   log?: (msg:string) => void,
 *   timeoutMs?: number,
 * }} opts
 */
export async function ensureServer(opts) {
  const port = opts.port ?? DEFAULT_PORT;
  const url = `http://localhost:${port}`;
  const log = opts.log ?? (() => {});
  const probeFn = opts.probeFn ?? (() => probeServer(port));
  const bootServer = opts.bootServer ?? defaultBootServer;
  const spawnSwapper = opts.spawnSwapper ?? defaultSpawnSwapper;
  const readDeployStatus = opts.readDeployStatus ?? defaultReadDeployStatus;
  const openBrowser = opts.openBrowser ?? defaultOpenBrowser;
  const nativePtyCheck = opts.nativePtyCheck ?? checkNativePty;
  const timeoutMs = opts.timeoutMs ?? 15000;

  const probe = await probeFn();
  const action = decideAction(probe, opts.packageVersion);
  let result = { action, url, port, version: probe.version };

  if (action === "foreign") {
    throw new Error(
      `port ${port} is held by a NON-Shipwright process — it was left running and NOT killed. ` +
        `Free the port or pick another: re-run with  PORT=<n> npx @svenroth-ai/shipwright@latest`,
    );
  }

  // Starting a new server (boot OR swap) requires a working native terminal —
  // never start one that cannot spawn (spec §1). Attach skips this: the
  // incumbent already proved itself.
  if (action === "boot" || action === "swap") {
    const pty = await nativePtyCheck();
    if (!pty.ok) {
      throw new Error(
        `the embedded terminal's native module (@lydell/node-pty) failed to load: ${pty.error}. ` +
          `Ensure Node >= 20.12 and your platform's build tools are present, then re-run. ` +
          `A Command Center whose terminal cannot spawn was NOT started.`,
      );
    }
  }

  if (action === "attach") {
    log(`Shipwright ${probe.version} already running on ${url} — attaching (no second server).`);
  } else if (action === "boot") {
    log(`Port ${port} free — starting the Command Center.`);
    const pid = bootServer(port, opts.pkgRoot);
    const ready = await pollUntil(probeFn, (p) => p.shipwright, { timeoutMs });
    if (!ready.ok) {
      throw new Error(
        `the packaged server did not become ready on ${url} within ${timeoutMs} ms — ` +
          `check ~/.shipwright-webui/server-manual.log`,
      );
    }
    result = { ...result, pid, version: ready.probe.version };
  } else if (action === "swap") {
    log(`Older server (${probe.version}) on ${url} — swapping to ${opts.packageVersion} via the detached swapper.`);
    const swapperPid = spawnSwapper(port, opts.pkgRoot);
    // Readiness = the port now serves EXACTLY the package version (AC1c: "the
    // version the server reports afterwards equals the package's"). `>=` would
    // let an unexpected newer instance winning the race masquerade as our swap.
    const ready = await pollUntil(
      probeFn,
      (p) => p.shipwright && compareSemver(p.version ?? "", opts.packageVersion) === 0,
      { timeoutMs: Math.max(timeoutMs, 20000) },
    );
    const status = readDeployStatus();
    if (!ready.ok) {
      throw new Error(
        `the swap did not reach ${opts.packageVersion} on ${url} in time — ` +
          `see ~/.shipwright-webui/deploy-swap.log${status?.error ? ` (${status.error})` : ""}`,
      );
    }
    result = {
      ...result,
      swapperPid,
      newPid: status && typeof status.pid === "number" ? status.pid : null,
      previousVersion: probe.version,
      version: ready.probe.version,
    };
  }

  if (!opts.noOpen) openBrowser(url);
  return result;
}
