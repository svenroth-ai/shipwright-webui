/**
 * server.mjs — AC1c + AC4: port-check, then boot / attach / swap. Open browser.
 *
 * Probe on the address `resolveProbeHost` resolves (127.0.0.1 by default; a
 * profile-derived address under SHIPWRIGHT_NETWORK_PROFILE — see below). Then:
 *   free                        → boot the packaged server (detached, outlives npx)
 *   Shipwright, same-or-newer   → ATTACH (open browser, no 2nd server)
 *   Shipwright, OLDER           → SWAP via the DETACHED deploy-swap.mjs
 *   foreign                     → FAIL LOUD with a PORT= remediation, incumbent ALIVE
 *
 * webui#415: under `SHIPWRIGHT_NETWORK_PROFILE=tailscale` the server binds
 * ONLY the tailnet interface, never loopback — a hardcoded 127.0.0.1 probe
 * never sees it, so attach/swap/foreign are all unreachable and every launch
 * redundantly re-boots and fails on EADDRINUSE while a healthy incumbent runs.
 * `resolveProbeHost` fixes this by reusing the server's OWN `resolveHonoHost`
 * (staged into `pkgRoot/server/dist`, exactly like `bootSpawnPlan` already
 * reaches into that same directory) instead of re-deriving profile precedence
 * here — a second implementation would drift the moment the server's changes.
 *
 * This module issues NO kill/taskkill/process.kill — ever. The incumbent on
 * :3847 may be hosting the very terminal this command runs in (PR #249, the
 * deploy self-kill). The swap's kill lives ONLY inside the detached swapper,
 * which is spawned BEFORE any kill so it outlives the caller's death cascade.
 */

import path from "node:path";
import { spawn } from "node:child_process";
import { readFileSync, openSync, closeSync, mkdirSync } from "node:fs";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { isIP } from "node:net";

import { compareSemverFull } from "./util.mjs";
import { tcpOccupied, checkNativePty } from "./probes.mjs";
import { win32CmdWrap } from "./win32-spawn.mjs";

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
 * Guards against shell/URL METACHARACTERS only — NOT a judgment on whether
 * `host` is an appropriate network target. A probe host is safe here when it
 * is either a valid IPv4/IPv6 literal (`net.isIP`) or a plain hostname
 * (letters/digits/`.`/`-` only — covers "localhost" and any profile-provided
 * value). Anything else (e.g. a stray `%`, `&`, quote) is REJECTED rather
 * than passed through: `resolveProbeHost`'s result is later spliced into a
 * fetch URL and, via `ensureServer`'s reported `url`, into `openBrowserPlan`'s
 * win32 `cmd.exe` invocation, where an unvalidated `%VAR%` would expand
 * inside the quoted argument — so anything reaching it from HONO_HOST must be
 * validated HERE, at the source, not trusted downstream (see
 * `openBrowserPlan`'s own comment for the receiving side). A value that
 * passes here can still be a real external hostname the bootstrapper CLI
 * will itself issue outbound TCP + `/api/diagnostics` HTTP requests to
 * (webui#415 doubt review) — that egress is the intended behaviour of probing
 * where the server will actually bind, not a gap this function is meant to
 * close.
 * @param {string} host
 * @returns {boolean}
 */
function isSafeProbeHost(host) {
  return typeof host === "string" && host.length > 0 && (isIP(host) !== 0 || /^[A-Za-z0-9.-]+$/.test(host));
}

/**
 * Format a probe host for use as a URL authority — bracket an IPv6 literal
 * (`::1` -> `[::1]`), otherwise pass through unchanged. Without this, a
 * bracket-less IPv6 host makes `new URL()` throw inside `fetchImpl`
 * (`probeServer`'s catch then misreports the probe as FOREIGN — a loud,
 * wrong "port held by a non-Shipwright process" for the user's own healthy
 * server; webui#415 code review).
 * @param {string} host
 * @returns {string}
 */
function formatHostForUrl(host) {
  return host.includes(":") ? `[${host}]` : host;
}

/**
 * Resolve the address to PROBE — not necessarily the address the server
 * BINDS. Reuses the server's own `resolveHonoHost` (compiled into
 * `pkgRoot/server/dist/lib/`, which ships in this package the same way
 * `bootSpawnPlan` already targets `pkgRoot/server/dist/index.js`) so
 * SHIPWRIGHT_NETWORK_PROFILE precedence is never re-implemented here.
 *
 * A wildcard bind ("0.0.0.0" — `open` profile, or "::" — `HONO_HOST=true`)
 * still accepts loopback connections, so it maps back down to 127.0.0.1;
 * anything concrete (the `tailscale` profile's resolved IP, or an explicit
 * non-wildcard HONO_HOST) is probed directly, since loopback would not see
 * it (webui#415).
 *
 * Reverse-direction gap, accepted (not fixed here): if the INCUMBENT is
 * bound to loopback while this env resolves to a non-loopback host (e.g. a
 * previously-launched server still on `local`, now re-launched with
 * SHIPWRIGHT_NETWORK_PROFILE=tailscale), the probe never sees it — no
 * EADDRINUSE, but two live Command Centers on the same port, sharing
 * `sdk-sessions.json` / the scrollback store / two `PtyManager`s. The
 * issue's alternative fix (probe loopback FIRST, then fall back to the
 * profile address) would cover both directions; this function implements
 * the issue's PRIMARY suggestion (resolve the intended bind host directly)
 * instead, which is simpler and covers the reported failure mode.
 *
 * Never fatal: an import failure (no build staged, e.g. running from
 * source), a resolution failure (`tailscale ip -4` unreachable, an invalid
 * SHIPWRIGHT_NETWORK_PROFILE value), or an unsafe/malformed resolved host
 * all fall back to 127.0.0.1 — the pre-fix probe, not a crash. `onFallback`
 * (best-effort logging only, never throws itself) is called with the reason
 * so a real misconfiguration (as opposed to "no build staged") is not
 * silently swallowed — see `ensureServer`, which wires it to its own `log`.
 *
 * Accepted, narrow window (webui#415 doubt review): this resolution runs
 * fresh on EVERY launch, not pinned to what an already-running incumbent
 * bound to at ITS boot. If `tailscale ip -4` fails only on THIS invocation
 * (the 2s exec timeout in `resolveTailscaleIp`, a transient daemon hiccup)
 * while a healthy incumbent is genuinely bound to a tailscale IP from an
 * earlier, successful resolution, this falls back to loopback, reads the
 * healthy incumbent as "port free", and triggers a redundant boot attempt —
 * the SAME symptom `SHIPWRIGHT_NETWORK_PROFILE=tailscale` always produced
 * pre-fix (this was the reported bug), now rare instead of constant. Not
 * chased further: differentiating "resolution failed" from "server not
 * running" would need `ensureServer` to treat a probe-host fallback as a
 * distinct outcome from a genuinely free port, which is more machinery than
 * this narrow, already-rare window (a transient CLI failure, not a
 * SHIPWRIGHT_NETWORK_PROFILE=tailscale user's steady state) earns.
 * @param {string} pkgRoot
 * @param {NodeJS.ProcessEnv} [env]
 * @param {(specifier: string) => Promise<any>} [importFn]
 * @param {(reason: string) => void} [onFallback]
 * @returns {Promise<string>}
 */
export async function resolveProbeHost(pkgRoot, env = process.env, importFn = (m) => import(m), onFallback = () => {}) {
  try {
    const modUrl = pathToFileURL(path.join(pkgRoot, "server", "dist", "lib", "resolveHonoHost.js")).href;
    const { resolveHonoHost } = await importFn(modUrl);
    const host = resolveHonoHost(env);
    if (host === "0.0.0.0" || host === "::") return "127.0.0.1";
    if (!isSafeProbeHost(host)) {
      try { onFallback(`resolved host "${host}" is not a safe IP/hostname`); } catch { /* logging must never throw */ }
      return "127.0.0.1";
    }
    return host;
  } catch (e) {
    try { onFallback(String(e?.message ?? e)); } catch { /* logging must never throw */ }
    return "127.0.0.1";
  }
}

/**
 * Classify a port. TCP occupancy is decided FIRST, independent of HTTP: a
 * process that accepts connections but never answers /api/diagnostics (or is
 * not HTTP at all) is FOREIGN, not free — booting a second server onto it is
 * exactly the bug AC4 forbids. Only a Shipwright server (200 +
 * `app.name === APP_IDENTITY` + `app.version`) counts as ours. Offline-safe.
 * @param {number} port
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number, tcpProbe?: typeof tcpOccupied, host?: string }} [deps]
 * @returns {Promise<{ reachable: boolean, shipwright: boolean, version: string | null }>}
 */
export async function probeServer(port, deps = {}) {
  const {
    fetchImpl = typeof fetch === "function" ? fetch : undefined,
    timeoutMs = 2000,
    tcpProbe = tcpOccupied,
    host = "127.0.0.1",
  } = deps;

  const occupied = await tcpProbe(port, { host, timeoutMs: Math.min(timeoutMs, 1500) });
  if (!occupied) return { reachable: false, shipwright: false, version: null };
  if (!fetchImpl) return { reachable: true, shipwright: false, version: null };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`http://${formatHostForUrl(host)}:${port}/api/diagnostics`, { signal: ctrl.signal });
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
  // Full compare (pre-release tail included): successive `@next` builds share a
  // triple and differ only in `-next.N`; a triple-only compare would call them
  // equal and ATTACH to the stale server, leaving the freshly published build
  // un-run (verified 2026-08-23 — new client served, old server code in memory).
  return compareSemverFull(probe.version ?? "", packageVersion) < 0 ? "swap" : "attach";
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

/**
 * The file the DETACHED packaged server's stdout+stderr is redirected to — and
 * the SAME path the boot readiness-timeout error tells the user to read. Kept as
 * one exported function so the two can never drift apart again: the boot used to
 * spawn with `stdio:"ignore"` (output discarded) while the error pointed the
 * user at this log, which nothing wrote — an undiagnosable dead end.
 */
export function bootLogPath() {
  return path.join(os.homedir(), ".shipwright-webui", "server-manual.log");
}

/** Open the boot log for append, creating its dir. Returns an fd, or null when
 * it cannot be opened — logging is best-effort and must NEVER block the boot. */
function defaultOpenBootLog() {
  try {
    mkdirSync(path.dirname(bootLogPath()), { recursive: true });
    return openSync(bootLogPath(), "a");
  } catch {
    return null;
  }
}

/**
 * Resolve the `stdio` for the detached boot: route BOTH stdout and stderr at the
 * log fd when it opens, else fall back to `"ignore"` (the pre-fix behaviour, now
 * only the degraded path). Pure over its `open` seam so both branches are
 * unit-testable without touching the filesystem.
 * @param {() => number | null} [open]
 */
export function resolveBootStdio(open = defaultOpenBootLog) {
  const fd = open();
  return fd == null ? "ignore" : ["ignore", fd, fd];
}

const defaultBootServer = (port, pkgRoot) => {
  const plan = bootSpawnPlan(port, pkgRoot);
  const stdio = resolveBootStdio();
  const child = spawn(plan.command, plan.args, { ...plan.options, stdio });
  child.unref();
  // The child dups the fd at spawn time; drop the parent's copy so the
  // short-lived npx process leaves no handle open (both slots share one fd).
  if (Array.isArray(stdio) && typeof stdio[1] === "number") {
    try { closeSync(stdio[1]); } catch { /* already gone — nothing to do */ }
  }
  return child.pid ?? null;
};
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

/**
 * Pure spawn PLAN for opening the browser. Exported so the shell-free property
 * is unit-testable on every platform without a real spawn.
 *
 * Windows needs cmd.exe because `start` is a cmd BUILTIN, not an executable —
 * but it gets it EXPLICITLY (the resolved ComSpec, discrete argv, `shell: false`)
 * rather than by asking Node to build a shell command line for us. Nothing here
 * needs PATHEXT resolution, so this is the one of the four remediated sites that
 * reaches for `win32ComSpec` directly instead of `resolveSpawn`.
 */
export function openBrowserPlan(url, platform = process.platform, env = process.env) {
  if (platform === "win32") {
    // Built through the SAME wrap as every other cmd.exe invocation rather than
    // splicing the url into discrete argv. That is not decoration: a url with a
    // query string (`http://h/?a=1&b=2`) would otherwise reach cmd.exe with a
    // bare `&` and run `b=2` as a second command. This is exported public API in
    // a published package, so it must not depend on what today's caller passes.
    // The empty string is `start`'s window-TITLE argument; without it `start`
    // consumes a quoted URL as the title and opens nothing.
    //
    // A literal `"` is the ONE character quoting cannot contain — it would close
    // the quoted region early and let the rest be read as a command — so it is
    // percent-encoded here rather than trusted. `"` is never valid unescaped in a
    // URL, so this cannot corrupt a legitimate one. Residual, stated rather than
    // implied: `%VAR%` still expands inside double quotes, so a url carrying a
    // real environment-variable reference would be substituted — closed at the
    // SOURCE since webui#415, not here: `ensureServer`'s host is no longer
    // always `localhost` (a profile/HONO_HOST-derived value is possible), but
    // `resolveProbeHost`'s `isSafeProbeHost` rejects anything that is not a
    // valid IP literal or a plain `[A-Za-z0-9.-]+` hostname before it ever
    // reaches this function — a `%`, `&`, or `"` in HONO_HOST cannot arrive here.
    return win32CmdWrap("start", ["", url.replace(/"/g, "%22")], env);
  }
  return { command: platform === "darwin" ? "open" : "xdg-open", args: [url] };
}

/**
 * Default: open the browser per platform. Never fatal.
 *
 * Exported ONLY so the never-fatal contract is testable — without a way to call
 * it, the async-error guard below could not be falsified, and a guard that
 * cannot be falsified is decoration.
 */
export function defaultOpenBrowser(url) {
  const plan = openBrowserPlan(url);
  try {
    const child = spawn(plan.command, plan.args, { detached: true, stdio: "ignore", shell: false });
    // `spawn` reports a launch failure ASYNCHRONOUSLY via the "error" event, so
    // the try/catch above cannot see it — and an unhandled "error" on an
    // EventEmitter throws, which would take the bootstrapper down and break the
    // "Never fatal" contract one line above. A bad ComSpec or a missing
    // xdg-open is exactly that case.
    child.on("error", () => {
      /* headless / no opener — the URL is printed by the caller regardless */
    });
    child.unref();
  } catch {
    /* synchronous spawn failure — same non-fatal outcome */
  }
}

/**
 * Orchestrate boot / attach / swap + browser open. Pure over its seams.
 * @param {{
 *   port?: number, pkgRoot: string, packageVersion: string, noOpen?: boolean,
 *   probeFn?: () => Promise<Awaited<ReturnType<typeof probeServer>>>,
 *   resolveProbeHost?: (pkgRoot: string) => Promise<string>,
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
  const log = opts.log ?? (() => {});
  // Under the tailscale profile this resolves `tailscale ip -4` once here; the
  // BOOTED server (bootSpawnPlan, below) independently resolves it again at its
  // own startup. Deliberately not forwarded as SHIPWRIGHT_TAILSCALE_IP — that
  // would change the packaged server's own env-precedence semantics for a
  // bootstrapper-internal convenience. Paid at most once per launch either way
  // (not a loop), and bounded by resolveTailscaleIp's own 2s exec timeout.
  const resolveHost = opts.resolveProbeHost
    ?? ((pkgRoot) => resolveProbeHost(pkgRoot, process.env, undefined, (reason) => log(`probe host resolution fell back to loopback: ${reason}`)));
  const probeHost = await resolveHost(opts.pkgRoot);
  // "localhost" (not the literal 127.0.0.1) preserves today's reported/opened
  // address for the loopback case — only a genuinely non-loopback resolution
  // (webui#415: tailscale) changes what the user is shown and what opens.
  // formatHostForUrl brackets an IPv6 literal (e.g. HONO_HOST=::1) so it forms
  // a valid URL authority instead of throwing inside probeServer's fetch.
  const url = probeHost === "127.0.0.1" ? `http://localhost:${port}` : `http://${formatHostForUrl(probeHost)}:${port}`;
  const probeFn = opts.probeFn ?? (() => probeServer(port, { host: probeHost }));
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
          `check ${bootLogPath()} (if that file is empty or absent, its directory was unwritable — ` +
          `re-run from a terminal to see the server's output directly)`,
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
      // Full compare: readiness is the port serving EXACTLY the package version,
      // pre-release tail included — otherwise a stale `@next` at the same triple
      // (the very thing we are swapping away from) would satisfy `=== 0` and the
      // swap would report success while the old server still holds the port.
      (p) => p.shipwright && compareSemverFull(p.version ?? "", opts.packageVersion) === 0,
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
