/*
 * preview-child-lifecycle.ts — lifecycle mechanics for ONE preview dev-server
 * child, factored out of preview-session-manager.ts (which sits at its bloat
 * ceiling). Cohesion: everything about a single child from spawn → ready-probe
 * → live → death, minus the projectId→entry state map (that stays in the
 * manager). D20 / audit findings F11 + F12 + F13.
 *
 *   - drainStdio  — consume stdout/stderr into a bounded ring so a never-read
 *     OS pipe buffer (~64KB) can't freeze the previewed dev server mid-session
 *     (F11), and expose the captured tail as a diagnostic for early-exit /
 *     timeout errors.
 *   - treeKill    — terminate the child AND its descendants: win32 `taskkill
 *     /T /F`, POSIX process-group `kill(-pid)` (the child is spawned `detached`
 *     so it leads its own group). SIGTERMs npm's grandchildren, not just npm
 *     (F13).
 *   - awaitExit   — resolve once the child's `exit` fires (bounded), so a
 *     profile-change respawn waits for the old child to release its port
 *     before the new port probe (F13).
 *   - port / readiness probes — gate a child's transition to "ready"; moved
 *     here verbatim from the manager to keep it under the bloat ceiling.
 *
 * Security posture unchanged (ADR-044): the probes only ever touch 127.0.0.1
 * and assert the resolved host before fetching; treeKill spawns `taskkill`
 * with `shell: false` + discrete argv.
 */

import { spawn as realSpawn } from "node:child_process";
import { createServer } from "node:net";

const DEFAULT_RING_CHARS = 16 * 1024;

export interface DrainedStdio {
  /** The last ~maxChars of interleaved stdout+stderr (UTF-8 decoded). */
  tail(): string;
}

interface DrainableChild {
  stdout?: NodeJS.ReadableStream | null;
  stderr?: NodeJS.ReadableStream | null;
}

/**
 * Attach `data` listeners to stdout+stderr so the OS pipe is continuously
 * drained (prevents the ~64KB pipe-buffer backpressure freeze, F11) while
 * retaining only a bounded tail for diagnostics. A no-op on the null streams
 * of a test fake-child.
 */
export function drainStdio(
  child: DrainableChild,
  maxChars = DEFAULT_RING_CHARS,
): DrainedStdio {
  let buf = "";
  const append = (chunk: Buffer | string): void => {
    buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    if (buf.length > maxChars) buf = buf.slice(buf.length - maxChars);
  };
  // Decode across chunk boundaries so a multi-byte UTF-8 sequence split by the
  // pipe isn't mangled into a substitution char in the diagnostic tail.
  if (child.stdout && typeof child.stdout.setEncoding === "function") {
    child.stdout.setEncoding("utf8");
  }
  if (child.stderr && typeof child.stderr.setEncoding === "function") {
    child.stderr.setEncoding("utf8");
  }
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  return { tail: () => buf };
}

export interface TreeKillDeps {
  /** Overrides `process.platform` — lets tests exercise both branches. */
  platform?: NodeJS.Platform;
  /** Injected for tests — POSIX process-group signaller. */
  processKill?: (pid: number, signal?: NodeJS.Signals | number) => void;
  /** Injected for tests — win32 `taskkill` spawner. */
  killSpawn?: typeof realSpawn;
}

interface KillableChild {
  pid?: number;
  kill(signal?: NodeJS.Signals | number): boolean;
}

function safeKill(child: KillableChild, signal: NodeJS.Signals): void {
  try {
    child.kill(signal);
  } catch {
    // already dead / unkillable — nothing more we can do
  }
}

/**
 * Terminate a child AND its descendants. win32: `taskkill /T /F` (the
 * `cmd.exe → npm.cmd → node` chain the D03 win32 spawn creates). POSIX: signal
 * the whole process group via a negative pid (the child leads its own group
 * because the manager spawns it `detached`). Falls back to a direct
 * `child.kill` when no pid is available or the group signal throws.
 */
export function treeKill(
  child: KillableChild,
  signal: NodeJS.Signals = "SIGTERM",
  deps: TreeKillDeps = {},
): void {
  const platform = deps.platform ?? process.platform;
  const pid = typeof child.pid === "number" && child.pid > 0 ? child.pid : null;

  if (platform === "win32") {
    if (pid !== null) {
      const spawnFn = deps.killSpawn ?? realSpawn;
      try {
        const killer = spawnFn("taskkill", ["/pid", String(pid), "/t", "/f"], {
          stdio: "ignore",
          windowsHide: true,
          shell: false,
        });
        // If taskkill itself can't launch, fall back to the direct child.
        if (killer && typeof killer.once === "function") {
          killer.once("error", () => safeKill(child, signal));
        }
        return;
      } catch {
        // fall through to the direct kill below
      }
    }
    safeKill(child, signal);
    return;
  }

  if (pid !== null) {
    const processKill =
      deps.processKill ?? ((p, s) => void process.kill(p, s));
    try {
      processKill(-pid, signal);
      return;
    } catch {
      // group gone, or the child wasn't a group leader — signal it directly
    }
  }
  safeKill(child, signal);
}

interface ExitableChild {
  exitCode: number | null;
  once(event: string, listener: (...args: unknown[]) => void): unknown;
}

/**
 * Resolve once the child's `exit` event fires, or after `timeoutMs` as a
 * bounded escape hatch. Lets a profile-change respawn wait for the old child
 * to release its port before probing it again (F13).
 */
export function awaitExit(
  child: ExitableChild,
  timeoutMs = 5000,
): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    if (typeof (timer as { unref?: () => void }).unref === "function") {
      (timer as { unref: () => void }).unref();
    }
    child.once("exit", finish);
  });
}

// ── Port / readiness probes (moved verbatim from preview-session-manager.ts) ──

export async function defaultProbePort(port: number): Promise<boolean> {
  // `free` = we could create + bind a server on that port right now.
  return await new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    try {
      server.listen(port, "127.0.0.1");
    } catch {
      resolve(false);
    }
  });
}

/**
 * Defense: a malicious profile file could set ready_path to something
 * like `@evil.com/` which, when concatenated into the URL string, would
 * redirect the readiness probe off-host. We build the URL via the URL
 * constructor and assert the resolved host is 127.0.0.1 before fetching.
 */
export function buildReadyUrl(port: number, readyPath: string): URL | null {
  try {
    const base = new URL(`http://127.0.0.1:${port}/`);
    // Treat readyPath as a pathname+search segment. Strip any leading
    // authority / scheme characters so a malicious string can't smuggle
    // another host through the URL constructor.
    const clean = readyPath.replace(/^[/@]+/, "/").trim() || "/";
    const url = new URL(clean, base);
    if (url.hostname !== "127.0.0.1") return null;
    if (url.port !== String(port)) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * A dev-server port must be a positive integer inside the TCP range (F30). A
 * missing / zero / non-integer port would otherwise skip the pre-spawn probe
 * and leave the readiness poll hammering port 0 for the full timeout before it
 * tree-kills the healthy dev server and misreports preview_timeout.
 */
export function isValidPort(port: unknown): port is number {
  return (
    typeof port === "number" &&
    Number.isInteger(port) &&
    port > 0 &&
    port <= 65535
  );
}

/**
 * Build the RETURNED preview URL (the one handed to window.open in the
 * browser). Mirrors buildReadyUrl's host-pinning (F10): a malicious profile
 * ready_path like "@evil.com/" — or an absolute "http://evil.com/" — must not
 * smuggle a new authority into the string. We resolve the path through the URL
 * constructor against a localhost origin and reject any host drift, preserving
 * the historical host-only shape for a root path.
 */
export function buildPreviewUrl(port: number, readyPath: string): string {
  const origin = `http://localhost:${port}`;
  try {
    const clean = readyPath.replace(/^[/@]+/, "/").trim() || "/";
    const url = new URL(clean, `${origin}/`);
    // Reject any host OR scheme drift: an absolute "http://evil.com/", a
    // "//"/"\\" authority smuggle, or a "javascript:"/"data:" scheme all
    // resolve away from the pinned http://localhost origin.
    if (url.protocol !== "http:" || url.hostname !== "localhost") return origin;
    if (url.pathname === "/" && !url.search && !url.hash) return origin;
    return `${origin}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return origin;
  }
}

export async function defaultProbeReady(args: {
  port: number;
  readyPath: string;
  signal: AbortSignal;
}): Promise<boolean> {
  const url = buildReadyUrl(args.port, args.readyPath);
  if (!url) return false;
  try {
    const res = await fetch(url.toString(), { signal: args.signal });
    // Any HTTP response at all (even 404) proves the server bound the port
    // and is routable. Vite's default index sometimes 404s on `/`.
    return res.status >= 0;
  } catch {
    return false;
  }
}
