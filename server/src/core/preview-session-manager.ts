/*
 * Preview dev-server spawn manager (iterate 3 section 03 / plan.md § 4.2).
 *
 * Contract: spawn(projectId, profile, opts?) → {url, sessionId};
 *   get(projectId) → live entry | undefined; killAll() → SIGTERM all + clear.
 *
 * Security model (ADR-044 — `shell: false` on EVERY path). The win32 metachar
 * fence is a BLOCKLIST (separators/substitution + `%`), not a total-safety proof
 * (cmd builtins survive) — it stops the cmd.exe wrapper amplifying a `.cmd` shim
 * into shell semantics or a repo-cwd binary hijack. POSIX: `shell-quote.parse`,
 * operator token → refuse. win32: backslash-safe tokenizer (keeps `C:\…`) +
 * PATH-only bare-name resolution + a `cmd.exe /d /s /c` wrapper (discrete argv,
 * or a verbatim outer-quoted line for spaced paths) — see `preview-win32-spawn.ts`.
 * spawn always runs `shell: false`; env drops `CLAUDE_*` / `SHIPWRIGHT_*`.
 *
 * Error codes (structured class instances handed to the route layer):
 *   - PreviewProfileInvalidError (empty / operators / metachars),
 *     PreviewSpawnFailedError (spawn threw), PreviewPortInUseError (EADDRINUSE),
 *     PreviewExitedEarlyError (child exited pre-ready), PreviewTimeoutError.
 *
 * Dedup: a repeat spawn() for a live projectId returns the cached entry (key =
 * projectId + `profileHash`). Shutdown: index.ts calls killAll(); none here.
 */

import {
  spawn as realSpawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { parse as shellParse } from "shell-quote";
import { resolveSpawn, splitWin32Command } from "./preview-win32-spawn.js";
import {
  drainStdio,
  treeKill,
  awaitExit,
  defaultProbePort,
  defaultProbeReady,
  isValidPort,
  buildPreviewUrl,
  type TreeKillDeps,
} from "./preview-child-lifecycle.js";

export interface PreviewProfile {
  dev_server?: {
    command?: string;
    port?: number;
    ready_path?: string;
    ready_timeout_seconds?: number;
  };
}

export interface PreviewSpawnOptions {
  cwd: string;
  /** Injected for tests — omit to use node's real child_process.spawn. */
  spawn?: typeof realSpawn;
  /** Injected for tests — override port probe. Returns true when free. */
  probePort?: (port: number) => Promise<boolean>;
  /** Injected for tests — readiness probe. Returns true when ready. */
  probeReady?: (args: {
    port: number;
    readyPath: string;
    signal: AbortSignal;
  }) => Promise<boolean>;
  /** Injected for tests — ms clock. */
  now?: () => number;
  /** Sanitized env. Defaults to process.env minus SHIPWRIGHT_* / CLAUDE_*. */
  env?: NodeJS.ProcessEnv;
}

export interface PreviewEntry {
  projectId: string;
  pid: number;
  url: string;
  sessionId: string;
  startedAt: number;
  profileHash: string;
  /** Internal — retained so killAll() can terminate. */
  child: ChildProcessWithoutNullStreams;
}

export class PreviewProfileInvalidError extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super(`Preview profile invalid: ${detail}`);
    this.name = "PreviewProfileInvalidError";
    this.detail = detail;
  }
}

export class PreviewSpawnFailedError extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super(`Preview spawn failed: ${detail}`);
    this.name = "PreviewSpawnFailedError";
    this.detail = detail;
  }
}

export class PreviewPortInUseError extends Error {
  readonly port: number;
  constructor(port: number) {
    super(`Preview port ${port} is already in use`);
    this.name = "PreviewPortInUseError";
    this.port = port;
  }
}

export class PreviewExitedEarlyError extends Error {
  readonly code: number | null;
  /** Captured tail of the child's stdout/stderr (F11 diagnostic). */
  readonly tail: string;
  constructor(code: number | null, tail = "") {
    super(`Preview process exited early (code=${code})`);
    this.name = "PreviewExitedEarlyError";
    this.code = code;
    this.tail = tail;
  }
}

export class PreviewTimeoutError extends Error {
  readonly seconds: number;
  /** Captured tail of the child's stdout/stderr (F11 diagnostic). */
  readonly tail: string;
  constructor(seconds: number, tail = "") {
    super(`Preview ready timeout after ${seconds}s`);
    this.name = "PreviewTimeoutError";
    this.seconds = seconds;
    this.tail = tail;
  }
}

function hashProfile(p: PreviewProfile): string {
  const payload = JSON.stringify({
    cmd: p.dev_server?.command ?? "",
    port: p.dev_server?.port ?? 0,
    ready: p.dev_server?.ready_path ?? "/",
    timeout: p.dev_server?.ready_timeout_seconds ?? 60,
  });
  return createHash("sha1").update(payload).digest("hex").slice(0, 12);
}

function sanitizeEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) {
    if (k.startsWith("SHIPWRIGHT_")) continue;
    if (k.startsWith("CLAUDE_")) continue;
    out[k] = v;
  }
  return out;
}

/** Lifecycle deps (test seams for tree-kill + respawn exit-wait). */
export interface PreviewLifecycleDeps extends TreeKillDeps {
  /** Bounded wait (ms) for an old child to exit before a respawn port probe. */
  awaitExitMs?: number;
}

export class PreviewSessionManager {
  private entries = new Map<string, PreviewEntry>();
  /** In-flight spawns keyed by projectId — dedup for concurrent clicks (F12). */
  private inFlight = new Map<
    string,
    { hash: string; promise: Promise<PreviewEntry> }
  >();

  constructor(private readonly lifecycle: PreviewLifecycleDeps = {}) {}

  /**
   * Validate + tokenize a dev command. Exposed for tests and for the
   * routes layer, which can dry-validate without mutating state.
   * Returns argv on success; throws PreviewProfileInvalidError otherwise.
   */
  static tokenizeCommand(command: string | undefined): string[] {
    if (!command || !command.trim()) {
      throw new PreviewProfileInvalidError(
        "dev_server.command is empty or missing",
      );
    }
    // win32: backslash-safe tokenize (F31) + injection fence. `process.platform`
    // is read at call time so tests can stub it; POSIX shell-quote path unchanged.
    if (process.platform === "win32") {
      if (/[&|;`$<>%\r\n]/.test(command)) {
        throw new PreviewProfileInvalidError(
          "dev_server.command contains a shell metacharacter — webui runs no shell",
        );
      }
      return splitWin32Command(command);
    }
    const parsed = shellParse(command);
    const argv: string[] = [];
    for (const tok of parsed) {
      if (typeof tok === "string") {
        argv.push(tok);
      } else {
        // Any non-string token = shell operator (`op`) or pattern glob — both
        // require a shell to interpret, which we refuse to run.
        throw new PreviewProfileInvalidError(
          "dev_server.command must be a single executable plus args, not a shell pipeline",
        );
      }
    }
    if (argv.length === 0) {
      throw new PreviewProfileInvalidError(
        "dev_server.command tokenized to zero tokens",
      );
    }
    return argv;
  }

  get(projectId: string): PreviewEntry | undefined {
    const entry = this.entries.get(projectId);
    if (!entry) return undefined;
    // Purge dead entries on lookup — killAll() normally does this, but an
    // unexpected exit outside our control should not return a stale URL.
    if (entry.child.exitCode !== null || entry.child.killed) {
      this.entries.delete(projectId);
      return undefined;
    }
    return entry;
  }

  async spawn(
    projectId: string,
    profile: PreviewProfile,
    opts: PreviewSpawnOptions,
  ): Promise<PreviewEntry> {
    const profileHash = hashProfile(profile);
    // In-flight dedup (F12): same-profile concurrent spawns coalesce onto the
    // pending child; a different profile serializes then respawns (no orphan).
    const inflight = this.inFlight.get(projectId);
    if (inflight?.hash === profileHash) return inflight.promise;
    if (inflight) {
      await inflight.promise.catch(() => undefined);
      return this.spawn(projectId, profile, opts);
    }

    const promise = this.doSpawn(projectId, profile, profileHash, opts);
    this.inFlight.set(projectId, { hash: profileHash, promise });
    try {
      return await promise;
    } finally {
      if (this.inFlight.get(projectId)?.promise === promise) {
        this.inFlight.delete(projectId);
      }
    }
  }

  private async doSpawn(
    projectId: string,
    profile: PreviewProfile,
    profileHash: string,
    opts: PreviewSpawnOptions,
  ): Promise<PreviewEntry> {
    const spawnFn = opts.spawn ?? realSpawn;
    const probePort = opts.probePort ?? defaultProbePort;
    const probeReady = opts.probeReady ?? defaultProbeReady;
    const now = opts.now ?? (() => Date.now());

    // Dedup: live entry with matching profile hash → return cached.
    const cached = this.get(projectId);
    if (cached && cached.profileHash === profileHash) {
      return cached;
    }
    // Profile changed under us — tree-kill the old child (npm + grandchildren)
    // and WAIT for it to exit (release its port) before we probe/respawn (F13).
    if (cached) {
      treeKill(cached.child, "SIGTERM", this.lifecycle);
      this.entries.delete(projectId);
      await awaitExit(cached.child, this.lifecycle.awaitExitMs);
    }

    const argv = PreviewSessionManager.tokenizeCommand(
      profile.dev_server?.command,
    );
    const port = profile.dev_server?.port;
    if (!isValidPort(port)) throw new PreviewProfileInvalidError("dev_server.port must be a positive integer");
    const readyPath = profile.dev_server?.ready_path ?? "/";
    const readyTimeoutSec = profile.dev_server?.ready_timeout_seconds ?? 60;

    // Port probe before spawn — a port owned by another process is worse than a clear error.
    const free = await probePort(port);
    if (!free) throw new PreviewPortInUseError(port);

    const resolved = resolveSpawn(argv, opts.cwd);
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawnFn(resolved.command, resolved.args, {
        cwd: opts.cwd,
        env: opts.env ?? sanitizeEnv(process.env),
        shell: false,
        // POSIX: lead our own group so treeKill can kill(-pid) the whole
        // npm→sh→node tree (win32: taskkill /T). Same effective platform as
        // treeKill, so spawn/kill agree on whether a group exists (F13).
        detached: (this.lifecycle.platform ?? process.platform) !== "win32",
        stdio: "pipe",
        windowsVerbatimArguments: resolved.windowsVerbatimArguments,
      }) as ChildProcessWithoutNullStreams;
    } catch (err) {
      const detail =
        (err as NodeJS.ErrnoException)?.code === "ENOENT"
          ? `command not found: ${argv[0]}`
          : String(err).slice(0, 200);
      throw new PreviewSpawnFailedError(detail);
    }

    // Continuously drain stdout/stderr so a full OS pipe buffer can't freeze
    // the dev server (F11); retain a bounded tail for the diagnostics below.
    const drained = drainStdio(child);

    // Spawn-time error event can still fire after the constructor returned
    // (e.g. Windows sometimes reports ENOENT asynchronously). Race it
    // against the readiness / exit probes below.
    const earlyExit = new Promise<never>((_resolve, reject) => {
      child.once("error", (err) => {
        const detail =
          (err as NodeJS.ErrnoException)?.code === "ENOENT"
            ? `command not found: ${argv[0]}`
            : String(err).slice(0, 200);
        reject(new PreviewSpawnFailedError(detail));
      });
      child.once("exit", (code) => {
        reject(new PreviewExitedEarlyError(code, drained.tail()));
      });
    });

    const readyAbort = new AbortController();
    const readinessPoll = (async (): Promise<void> => {
      const deadline = now() + readyTimeoutSec * 1000;
      while (now() < deadline) {
        if (readyAbort.signal.aborted) return;
        try {
          const ok = await probeReady({
            port,
            readyPath,
            signal: readyAbort.signal,
          });
          if (ok) return;
        } catch {
          // fall through and retry
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new PreviewTimeoutError(readyTimeoutSec, drained.tail());
    })();

    try {
      await Promise.race([readinessPoll, earlyExit]);
    } catch (err) {
      // Tree-kill on cleanup too: the child is spawned detached (POSIX), so a
      // plain child.kill would orphan its grandchildren (F13). An ESRCH on an
      // already-exited child is swallowed inside treeKill.
      readyAbort.abort();
      treeKill(child, "SIGTERM", this.lifecycle);
      throw err;
    }

    readyAbort.abort();
    // Readiness won; the child's later exit must not surface as an unhandled
    // rejection through the (now-settled) earlyExit race loser.
    void earlyExit.catch(() => {});

    const entry: PreviewEntry = {
      projectId,
      pid: child.pid ?? -1,
      url: buildPreviewUrl(port, readyPath),
      sessionId: randomUUID(),
      startedAt: now(),
      profileHash,
      child,
    };
    // Auto-purge the entry if the child exits after we've cached it.
    child.once("exit", () => {
      const current = this.entries.get(projectId);
      if (current === entry) this.entries.delete(projectId);
    });
    this.entries.set(projectId, entry);
    return entry;
  }

  killAll(): void {
    // Tree-kill every child so npm's grandchildren die with it (F13).
    for (const entry of this.entries.values()) {
      treeKill(entry.child, "SIGTERM", this.lifecycle);
    }
    this.entries.clear();
  }

  /** Test helper — exposes the internal map size without leaking entries. */
  size(): number {
    return this.entries.size;
  }
}
