/*
 * pty-manager.ts — embedded-terminal pty lifecycle (iterate-2026-05-03).
 *
 * Plan-D'' compliance: webui hosts a NEUTRAL shell (pwsh / cmd / bash / …)
 * — never `claude` directly. Whitelist enforced by basename normalisation
 * so absolute paths like `/usr/local/bin/claude` cannot slip through.
 *
 * External-review (2026-05-03) drove these contracts:
 *   - WS upgrade is the authoritative ensure-or-create entrypoint;
 *     spawn() is idempotent for the same taskId (no dual-creation race).
 *   - Writer ownership is bound to the live WS connection identity;
 *     detach clears the writer slot synchronously.
 *   - Last-connection-close keeps the pty alive (ADR-068-A1 Replay-on-
 *     Attach contract). Navigation away from TaskDetail must NOT kill
 *     a running claude session; the user re-attaches by navigating back.
 *   - 30-min idle ceiling forces kill (the orphan GC mechanism). Plus
 *     explicit user "Stop terminal session" + DELETE task cascade.
 *   - Per-conn outbound buffer cap with drop-oldest backpressure.
 *   - Shell-aware path quoting via quotePathForShell() — used by the
 *     image-paste flow so cwd-with-spaces does not break the prompt.
 *
 * The actual node-pty backend is injected via PtySpawnFn so unit tests
 * can stay native-binary-free.
 */

import type { ScrollbackStore } from "./scrollback-store.js";
import { HeadlessMirror } from "./headless-mirror.js";
import { IdleReaper, DEFAULT_IDLE_TIMEOUT_MS } from "./idle-reaper.js";
import type { SnapshotRecord, SnapshotStore } from "./snapshot-store.js";
import { writeSnapshotPreservingLarger } from "./snapshot-preserve.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Subset of node-pty's IPty surface that we depend on. */
export interface PtyHandleApi {
  onData(cb: (data: string) => void): { dispose(): void };
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): { dispose(): void };
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  /**
   * Optional pause/resume — used by the replay-on-attach flow (ADR-068-A1)
   * to halt live pty output while the WS replays scrollback from disk.
   * `@lydell/node-pty`'s IPty exposes both; tests with a fake pty can
   * leave them undefined (no-op semantics).
   */
  pause?(): void;
  resume?(): void;
}

export type PtySpawnFn = (
  shell: string,
  args: string[],
  opts: {
    cwd: string;
    name?: string;
    cols?: number;
    rows?: number;
    env?: Record<string, string | undefined>;
  },
) => PtyHandleApi;

export type ShellKind = "pwsh" | "cmd" | "posix";

export interface PtyHandleMeta {
  taskId: string;
  cwd: string;
  shell: string;
  shellKind: ShellKind;
}

export interface PtySpawnOpts {
  cwd: string;
  shell: string;
  cols?: number;
  rows?: number;
}

export interface AttachResult {
  role: "writer" | "reader";
  /**
   * iterate-2026-05-27-fix-pty-reused-prewarm-race — `true` iff a
   * writer had EVER attached BEFORE this call. Atomic snapshot taken
   * inside `attach()` so back-to-back upgrades resolve sequentially.
   * Routes layer emits as `ready.ptyReused`. Distinct from
   * `ptyManager.get() !== undefined` (which still feeds ADR-104
   * `terminalReset`) — split to prevent re-conflation.
   */
  hadPriorWriter: boolean;
}

export interface ConnectionSubscription {
  onData: (data: string) => void;
  onBackpressure?: (info: { droppedBytes: number }) => void;
  /**
   * Fired when this connection is promoted from reader to writer because
   * the previous writer detached (typical: React StrictMode dev double-
   * mount → first WS becomes writer, gets unmounted + closed; second WS
   * opens BEFORE the first close arrives, gets reader role; then first
   * close arrives, freeing the slot — we promote second to writer and
   * call this hook so the routes layer can notify the client).
   */
  onPromoteToWriter?: () => void;
}

export class PtySpawnRejectedError extends Error {
  constructor(target: string) {
    super(
      `pty-manager: refusing to spawn '${target}' — only whitelisted shells are allowed (Plan-D''/ADR-067)`,
    );
    this.name = "PtySpawnRejectedError";
  }
}

/**
 * iterate-2026-07-15-e2e-pty-spawn-cwd-267 — the injected `spawnFn`
 * (node-pty's `CreateProcess`) threw. Dominant cause on Windows: a spawn
 * `cwd` that was removed / is delete-pending → `error code: 267`
 * (ERROR_DIRECTORY). Distinct from `PtySpawnRejectedError` (whitelist);
 * callers convert it to a clean rejection, not an uncaught throw. Full
 * root-cause (267 ≠ resource exhaustion) is in the run's decision drop.
 */
export class PtySpawnFailedError extends Error {
  /** Parsed native code when present (267 = ERROR_DIRECTORY on win32), else null. */
  readonly code: number | null;
  constructor(cwd: string, cause: unknown) {
    const causeMsg = cause instanceof Error ? cause.message : String(cause);
    super(`pty-manager: failed to spawn a shell in cwd '${cwd}': ${causeMsg}`);
    this.name = "PtySpawnFailedError";
    const m = /error code:\s*(\d+)/i.exec(causeMsg);
    this.code = m ? Number(m[1]) : null;
    (this as { cause?: unknown }).cause = cause;
  }

  /** True when the failure is an unusable cwd (win32 267 / POSIX ENOENT /
   *  ENOTDIR) — the user-actionable case; other failures (EMFILE/EPERM) are
   *  NOT labelled as a cwd problem, so callers stay accurate (code-review N1). */
  get isLikelyCwdError(): boolean {
    return this.code === 267 || /\b(ENOENT|ENOTDIR)\b/.test(this.message);
  }
}

// ---------------------------------------------------------------------------
// Whitelist + shell-kind inference
// ---------------------------------------------------------------------------

const WHITELIST = new Set([
  "pwsh",
  "pwsh.exe",
  "powershell",
  "powershell.exe",
  "cmd",
  "cmd.exe",
  "bash",
  "bash.exe",
  "zsh",
  "sh",
  "fish",
]);

function basenameLower(target: string): string {
  // Handle both "/" and "\\" so a Windows path passed on a POSIX host
  // still normalizes correctly during tests.
  const lastSlash = Math.max(
    target.lastIndexOf("/"),
    target.lastIndexOf("\\"),
  );
  const base = lastSlash === -1 ? target : target.slice(lastSlash + 1);
  return base.toLowerCase();
}

function inferShellKind(target: string): ShellKind {
  const b = basenameLower(target);
  if (b === "pwsh" || b === "pwsh.exe" || b === "powershell" || b === "powershell.exe") {
    return "pwsh";
  }
  if (b === "cmd" || b === "cmd.exe") {
    return "cmd";
  }
  return "posix";
}

function isWhitelistedShell(target: string): boolean {
  return WHITELIST.has(basenameLower(target));
}

// ---------------------------------------------------------------------------
// quotePathForShell — used by image-paste route so paths with spaces work.
// ---------------------------------------------------------------------------

export function quotePathForShell(absPath: string, kind: ShellKind): string {
  if (kind === "pwsh") {
    // PowerShell single-quoted strings: only ' itself needs escaping (doubled).
    return "'" + absPath.replace(/'/g, "''") + "'";
  }
  if (kind === "cmd") {
    // cmd.exe: double-quoted, " escaped as "" (de-facto rule for argv parsing).
    return '"' + absPath.replace(/"/g, '""') + '"';
  }
  // POSIX: single-quoted; close-quote, escaped quote, re-open-quote.
  return "'" + absPath.replace(/'/g, "'\\''") + "'";
}

// ---------------------------------------------------------------------------
// PtyManager
// ---------------------------------------------------------------------------

interface PtyEntry {
  meta: PtyHandleMeta;
  pty: PtyHandleApi;
  /**
   * Iterate-2026-05-11 (ADR-088) — optional @xterm/headless mirror.
   * Present when `headlessMirrorEnabled` was true at construction time.
   * Lifetime mirrors the pty entry: created in spawn(), serialized to
   * disk and disposed in cleanup() (via the snapshot-finalize path).
   *
   * Architecture invariant #1 from the plan-of-record: headless mirrors
   * exist only for LIVE ptys. There is no in-memory mirror for
   * idle/completed tasks — only the on-disk snapshot file.
   */
  mirror: HeadlessMirror | null;
  /** Module-level data subscribers (used by tests + observability). */
  dataSubs: Set<(data: string) => void>;
  /** Per-WS-connection subscribers (used by the routes WS bridge). */
  connSubs: Map<unknown, ConnectionSubscription>;
  /** First connection becomes writer; null when no writer is currently bound. */
  writer: unknown | null;
  /** iterate-2026-05-27-fix-pty-reused-prewarm-race — latched-true once
   *  any writer has attached. Surfaced via `AttachResult.hadPriorWriter`. */
  hadWriterAttach: boolean;
  /**
   * Iterate v0.8.6 AC-2 — last (cols, rows) handed to pty.resize().
   * Used to dedupe no-op resizes that otherwise trigger PowerShell to
   * repaint its READLINE buffer (version banner + prompt + typed line)
   * via SIGWINCH on every WS attach. Each repaint is ~1 KiB of data
   * envelope flooding the xterm buffer with duplicate content — visible
   * as the "100 banner" accumulation. ConPTY emits the redraw on every
   * resize call, even when dims are unchanged, so the dedupe must live
   * here (node-pty / ConPTY does not gate it internally).
   */
  lastResizeCols: number | null;
  lastResizeRows: number | null;
  /** Pending outbound bytes per connection (used for drop-oldest decision). */
  pendingByConn: Map<unknown, { bytes: number; queue: string[] }>;
  /** True while a backpressure event is already raised — avoids fire-flood. */
  backpressureRaised: Map<unknown, boolean>;
  /**
   * AC-3a (iterate-2026-05-05) — per-task pause refcount. Multi-tab
   * replay-on-attach has each tab calling pause() / resume() independently;
   * we MUST gate pty.pause / pty.resume on the 0↔1 transitions so one tab's
   * resume doesn't unpause for the other tab mid-replay.
   */
  pauseRefCount: number;
  /** Set of conn-tokens that currently hold a pause stake. */
  pausedConns: Set<unknown>;
  /**
   * AC-3b — per-conn timestamp recording when the WS bufferedAmount first
   * crossed the watchdog threshold. `null` = below threshold (drained).
   * Used by the watchdog to evict stuck writers based on socket DRAINAGE,
   * NOT pty emission (per external review v2: gemini-2 + openai-9 — a
   * runaway pty keeps its `lastDataAt` fresh forever, so the original
   * "lastDataAt > 2s" heuristic was inverted under exactly the load
   * conditions that trigger the bug).
   */
  bufferedExceededSince: Map<unknown, number | null>;
  /**
   * iterate-2026-05-08 v0.8.7 AC-2 — set to `true` by `kill(taskId)` and
   * by the idle-ceiling timer BEFORE invoking `entry.pty.kill()`. The
   * `pty.onExit` handler appends a `──── shell stopped at HH:MM:SS ────`
   * marker to disk-scrollback when this flag is true; a natural shell
   * exit (closing=false) writes no marker. Closing-flag dedupe ensures
   * duplicate kill() calls produce ONE marker total — the second
   * kill sees the entry already gone (cleanup ran via onExit) and
   * is a no-op.
   */
  closing: boolean;
  /** D01/F01 — resolved in onExit so kill() can await teardown before a delete wipes side-files. */
  onExitDone?: () => void;
  /** D01 #3 — the single finalize promise both onExit + kill() await (no double cleanup). */
  finalizePromise?: Promise<void>;
  /** D01 #2 — set true by kill(): gates post-serialize snapshot writes + post-kill
   *  scrollback appends so a parked flush / stuck shell can't resurrect a wiped
   *  side-file. Lives on the entry (which the parked flush holds) → no leak. */
  tornDown?: boolean;
}

export interface PtyManagerOpts {
  spawn: PtySpawnFn;
  /** Per-WS outbound buffer cap (bytes) before drop-oldest; default 1 MiB. */
  wsBufferBytes?: number;
  /** PTY auto-kill ceiling on idleness; default 30 min. */
  idleTimeoutMs?: number;
  /**
   * Optional scrollback store (ADR-068-A1). When provided, every pty.onData
   * chunk is appended to disk before broadcast. closeStream is called on
   * pty.kill so file descriptors are released cleanly. Tests can omit this
   * for native-binary-free coverage.
   */
  scrollbackStore?: ScrollbackStore;
  /**
   * AC-3b (iterate-2026-05-05) — watchdog config. The watchdog evicts a
   * writer whose WS bufferedAmount has been above `stuckThresholdBytes`
   * for at least `stuckDurationMs` of wall-clock time. Default OFF in
   * unit tests (no setInterval leaks); routes wires it on at construction.
   */
  watchdogEnabled?: boolean;
  watchdogStuckThresholdBytes?: number;
  watchdogStuckDurationMs?: number;
  watchdogIntervalMs?: number;
  /** Time source override for tests. Defaults to Date.now. */
  now?: () => number;
  /**
   * Iterate-2026-05-11 (ADR-088) — wire the @xterm/headless mirror per
   * live pty. Disk persistence is delegated to `snapshotStore.write()`
   * on pty.kill. Default OFF (Iterate A flag-off contract). Both
   * `headlessMirrorEnabled === true` AND a non-undefined `snapshotStore`
   * are required for the mirror to be wired; either alone is a no-op.
   */
  headlessMirrorEnabled?: boolean;
  snapshotStore?: SnapshotStore;
  /**
   * Iterate-2026-05-12 (ADR-092) — pinned `@xterm/headless` version
   * string. Used by `serializeMirrorIfLive()` so the in-memory
   * SnapshotRecord it returns carries the same `terminalVersion` value
   * that the WS replay path's `tryReadSnapshot` version-gate expects.
   * When undefined (test config), the returned record's
   * `terminalVersion` defaults to `"unknown"` — matching SnapshotStore's
   * last-resort sentinel. Disk-write path (flushMirrorSnapshot) does
   * NOT use this value; SnapshotStore.write() reads its own from
   * @xterm/headless's package.json on disk.
   */
  expectedTerminalVersion?: string;
}

/** Sentinel for the legacy token-less pause()/resume() API. */
const ANON_PAUSE_TOKEN: unique symbol = Symbol("pty-manager.anonymous-pause");

export class PtyManager {
  private readonly entries = new Map<string, PtyEntry>();
  private readonly spawnFn: PtySpawnFn;
  private readonly wsBufferBytes: number;
  private readonly idleTimeoutMs: number;
  private readonly idleReaper: IdleReaper;
  private readonly scrollbackStore: ScrollbackStore | undefined;
  private readonly snapshotStore: SnapshotStore | undefined;
  private readonly headlessMirrorEnabled: boolean;
  private readonly expectedTerminalVersion: string;
  private readonly watchdogStuckThresholdBytes: number;
  private readonly watchdogStuckDurationMs: number;
  private readonly watchdogIntervalMs: number;
  private readonly watchdogEnabledOpt: boolean;
  private readonly nowFn: () => number;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * Per-conn capability tracking (per external review code-pass —
   * openai-5). `Map<conn, "ok" | "missing">`: "ok" = bufferedAmount
   * returned a number; "missing" = bufferedAmount was undefined →
   * skip THAT conn's eviction without disabling the watchdog globally.
   * Conns absent from the map haven't been probed yet — first
   * deliverWithBackpressure / watchdogTick that sees them stamps
   * the result. Earlier global-disable design was rejected because
   * a single legacy adapter would have permanently disabled stuck-
   * writer eviction for healthy conns sharing the same PtyManager.
   */
  private connCapability = new Map<unknown, "ok" | "missing">();
  /** Whether the capability-missing warning has already been logged (rate-limit). */
  private capabilityWarnLogged = false;

  constructor(opts: PtyManagerOpts) {
    this.spawnFn = opts.spawn;
    this.wsBufferBytes = opts.wsBufferBytes ?? 1_048_576;
    this.idleTimeoutMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    // Orphan-GC (attachment-gated, iterate-2026-06-02): the idle ceiling
    // fires ONLY when no client is attached; reap = the existing kill() path
    // (flags the intentional close → v0.8.7 marker). Policy in idle-reaper.ts.
    this.idleReaper = new IdleReaper({
      timeoutMs: this.idleTimeoutMs,
      onReap: (taskId) => this.kill(taskId),
    });
    this.scrollbackStore = opts.scrollbackStore;
    this.snapshotStore = opts.snapshotStore;
    // Mirror requires BOTH flag-on AND a configured store. Either alone
    // is a no-op so misconfiguration cannot leak in-memory Terminals
    // without a persistence path.
    this.headlessMirrorEnabled =
      (opts.headlessMirrorEnabled ?? false) && !!opts.snapshotStore;
    this.expectedTerminalVersion = opts.expectedTerminalVersion ?? "unknown";
    this.watchdogStuckThresholdBytes =
      opts.watchdogStuckThresholdBytes ?? 524_288; // 512 KiB
    this.watchdogStuckDurationMs = opts.watchdogStuckDurationMs ?? 2_000;
    this.watchdogIntervalMs = opts.watchdogIntervalMs ?? 2_000;
    this.watchdogEnabledOpt = opts.watchdogEnabled ?? false;
    this.nowFn = opts.now ?? Date.now;
    if (this.watchdogEnabledOpt) {
      this.watchdogTimer = setInterval(
        () => this.watchdogTick(),
        this.watchdogIntervalMs,
      );
      // Avoid keeping a Node event loop alive solely for the watchdog.
      const t = this.watchdogTimer as { unref?: () => void };
      if (typeof t.unref === "function") t.unref();
    }
  }

  /** Look up a handle by taskId. Returns undefined if not yet spawned. */
  get(taskId: string): PtyHandleMeta | undefined {
    return this.entries.get(taskId)?.meta;
  }

  /**
   * Return the set of taskIds with a live pty entry. Used by the daily
   * scrollback sweep (ADR-068-A1, AC-11) to skip clearing files for
   * tasks whose pty is still running but whose `sdk-sessions.json` state
   * has drifted (e.g. session ended mid-run).
   */
  getLiveTaskIds(): Set<string> {
    return new Set(this.entries.keys());
  }

  /** Idempotent ensure-or-create. */
  spawn(taskId: string, opts: PtySpawnOpts): PtyHandleMeta {
    const existing = this.entries.get(taskId);
    if (existing) return existing.meta;

    if (!isWhitelistedShell(opts.shell)) {
      throw new PtySpawnRejectedError(opts.shell);
    }
    const meta: PtyHandleMeta = {
      taskId,
      cwd: opts.cwd,
      shell: opts.shell,
      shellKind: inferShellKind(opts.shell),
    };
    // iterate-2026-07-15 — node-pty's CreateProcess throws synchronously on an
    // unusable cwd (267). Type it so WS-upgrade + prewarm callers degrade
    // cleanly; no entry is registered yet, so a failed spawn leaks nothing.
    let pty: PtyHandleApi;
    try {
      pty = this.spawnFn(opts.shell, [], {
        cwd: opts.cwd,
        cols: opts.cols ?? 120,
        rows: opts.rows ?? 30,
      });
    } catch (err) {
      throw new PtySpawnFailedError(opts.cwd, err);
    }
    // ADR-088: optional headless mirror — lifetime co-extensive with the
    // entry (disposed in cleanup()); dims match the pty-spawn defaults.
    const mirror = this.headlessMirrorEnabled
      ? new HeadlessMirror({
          taskId,
          cols: opts.cols ?? 120,
          rows: opts.rows ?? 30,
        })
      : null;

    const entry: PtyEntry = {
      meta,
      pty,
      mirror,
      dataSubs: new Set(),
      connSubs: new Map(),
      writer: null,
      hadWriterAttach: false,
      lastResizeCols: null,
      lastResizeRows: null,
      pendingByConn: new Map(),
      backpressureRaised: new Map(),
      pauseRefCount: 0,
      pausedConns: new Set(),
      bufferedExceededSince: new Map(),
      closing: false,
    };
    this.entries.set(taskId, entry);

    // Forward pty output to all subscribers + reset idle timer.
    pty.onData((data) => {
      this.touchIdle(entry);
      // ADR-068-A1: persist to disk before broadcast (fs.appendFileSync;
      // try/catch so a disk error never breaks the broadcaster). D01 #2 —
      // skip once torn down so a stuck shell can't re-create <taskId>.log.
      if (this.scrollbackStore && !entry.tornDown) {
        try {
          this.scrollbackStore.append(taskId, Buffer.from(data, "utf8"));
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            `[pty-manager] scrollback append failed for ${taskId}: ${(err as Error).message}`,
          );
        }
      }
      // ADR-088: shadow-write to the headless mirror. The mirror's
      // write() returns a Promise that resolves after the parser
      // callback fires; we kick it off but DO NOT await — the
      // broadcast must stay synchronous so the WS write loop is not
      // serialized behind xterm.js's parser. The promise resolves on
      // the next microtask and any throw is swallowed by `.catch`.
      // Architecture invariant #3 (await before serialize) is held by
      // serializeStable() at snapshot time — not by every chunk write.
      if (entry.mirror) {
        entry.mirror.write(data).catch((err) => {
          // eslint-disable-next-line no-console
          console.warn(
            `[pty-manager] headless mirror write failed for ${taskId}: ${(err as Error).message}`,
          );
        });
      }
      for (const cb of entry.dataSubs) {
        try {
          cb(data);
        } catch {
          // ignore
        }
      }
      for (const [conn, sub] of entry.connSubs) {
        this.deliverWithBackpressure(entry, conn, sub, data);
      }
    });

    pty.onExit(() => {
      // AC-2 — intentional kill (closing=true) appends a dim-grey
      // "shell stopped" marker AFTER the dying-process flush drains
      // (onExit fires once stdio handles closed). Natural exit → none.
      if (entry.closing && this.scrollbackStore) {
        this.appendShellStoppedMarker(taskId);
      }
      this.cleanup(taskId);
      // D01/F01 — release a delete-cascade kill() awaiting full teardown.
      entry.onExitDone?.();
    });

    this.touchIdle(entry);
    return meta;
  }

  /**
   * iterate-2026-05-08 v0.8.7 AC-2 — append a single dim-grey ANSI marker
   * frame to disk-scrollback on intentional kill. Best-effort; never throws
   * (onExit cleanup must stay infallible). Format:
   *
   *     \r\n\x1b[2m──── shell stopped at HH:MM:SS ────\x1b[m\r\n
   *
   * Timing safety (openai 2026-05-08 high; D01 #5): ScrollbackStore.append()
   * is fs.appendFileSync — one open(O_APPEND)→write→close per call, no
   * per-task WriteStream. closeStream() only resets the size cache, so the
   * marker append in onExit CANNOT land on a closed handle even though kill()
   * fires closeStream before awaiting onExit; a deleted entry doesn't affect
   * append correctness (lookup by taskId + reopen each call).
   */
  private appendShellStoppedMarker(taskId: string): void {
    if (!this.scrollbackStore) return;
    try {
      const ts = new Date().toISOString().slice(11, 19);
      const marker = `\r\n\x1b[2m──── shell stopped at ${ts} ────\x1b[m\r\n`;
      this.scrollbackStore.append(taskId, Buffer.from(marker, "utf8"));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[pty-manager] shell-stopped marker append failed for ${taskId}: ${(err as Error).message}`,
      );
    }
  }

  write(taskId: string, data: string): void {
    const entry = this.entries.get(taskId);
    if (!entry) return;
    this.touchIdle(entry);
    entry.pty.write(data);
  }

  resize(taskId: string, cols: number, rows: number): void {
    const entry = this.entries.get(taskId);
    if (!entry) return;
    // Iterate v0.8.6 AC-2 — dedupe no-op resizes. ConPTY (and node-pty)
    // emit a SIGWINCH-driven redraw on EVERY pty.resize call, even when
    // (cols, rows) match the current state. PowerShell's READLINE
    // responds to that by repainting "version banner + prompt + typed
    // line" — ~1 KiB per redraw. With multiple WS attaches per visit
    // (StrictMode double-mount) and multiple visits per session, this
    // accumulates as the "100 Claude banner" symptom in xterm. Skip
    // the call when nothing changed; the pty already has the right
    // dimensions.
    if (entry.lastResizeCols === cols && entry.lastResizeRows === rows) {
      return;
    }
    entry.lastResizeCols = cols;
    entry.lastResizeRows = rows;
    entry.pty.resize(cols, rows);
    // ADR-088: keep the headless mirror's dimensions in lockstep so the
    // M2 stabilization at snapshot time uses the right cols/rows.
    if (entry.mirror) {
      try {
        entry.mirror.resize(cols, rows);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[pty-manager] mirror resize failed for ${taskId}: ${(err as Error).message}`,
        );
      }
    }
  }

  async kill(taskId: string): Promise<void> {
    const entry = this.entries.get(taskId);
    if (!entry) return;
    // AC-2 — flag intentional kill so onExit appends the marker; a duplicate
    // kill() is a no-op (entry already gone). D01 #2 — tombstone the entry first
    // so a parked flush / stuck-shell onData can't resurrect the wiped side-files.
    entry.closing = true;
    entry.tornDown = true;
    // D01/F01 — a live entry guarantees onExit fires; `exited` = the marker append.
    const exited = new Promise<void>((r) => { entry.onExitDone = r; });
    try {
      entry.pty.kill();
    } catch {
      // best-effort
    }
    // D01 #3 — cleanup stores the SINGLE finalize on the entry; read it here so
    // a synchronous onExit (which ran cleanup already) is still awaited.
    this.cleanup(taskId);
    const finalize = entry.finalizePromise ?? Promise.resolve();
    if (this.scrollbackStore) {
      void this.scrollbackStore
        .closeStream(taskId)
        .catch((err: unknown) => {
          // eslint-disable-next-line no-console
          console.warn(
            `[pty-manager] scrollback closeStream failed for ${taskId}: ${(err as Error).message}`,
          );
        });
    }
    // D01 #1 — never hang the DELETE: finalize (privacy) is fully awaited; the
    // proof-of-death `exited` degrades to a bounded 3 s ceiling (onExit is
    // reliable for a live entry, but pty.kill() could throw / child could wedge).
    await Promise.allSettled([
      Promise.race([exited, new Promise<void>((r) => { setTimeout(r, 3000).unref?.(); })]),
      finalize,
    ]);
  }

  killAll(): void {
    // D01 #4 — kill() is async now, but shutdown must not block on per-pty
    // teardown; finalize writes are best-effort on process death (pre-existing
    // F26, orphaned tmps swept by snapshot-tmp-sweep). Fire-and-forget.
    const taskIds = [...this.entries.keys()];
    for (const id of taskIds) void this.kill(id);
    if (this.watchdogTimer !== null) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  /**
   * Pause the live pty (ADR-068-A1) — anonymous-token API kept for
   * backwards compat. Per-conn pause ownership is preferred via
   * `pauseForConn(taskId, connToken)` so the watchdog's force-evict
   * path can clean up specific stakes (per Gemini #3 + OpenAI #12).
   */
  pause(taskId: string): void {
    this.pauseForConn(taskId, ANON_PAUSE_TOKEN);
  }

  /** Counterpart to pause(). Idempotent — calling on a non-paused pty is a no-op. */
  resume(taskId: string): void {
    this.resumeForConn(taskId, ANON_PAUSE_TOKEN);
  }

  /**
   * AC-3a (iterate-2026-05-05). Pause the live pty under per-conn refcount
   * ownership. Multiple conns can each hold their own pause stake;
   * `pty.pause()` fires only on the 0→1 transition, `pty.resume()` only
   * on the 1→0 transition. Idempotent for the same conn.
   */
  pauseForConn(taskId: string, connToken: unknown): void {
    const entry = this.entries.get(taskId);
    if (!entry) return;
    if (entry.pausedConns.has(connToken)) return;
    entry.pausedConns.add(connToken);
    entry.pauseRefCount++;
    if (entry.pauseRefCount === 1 && entry.pty.pause) {
      try {
        entry.pty.pause();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[pty-manager] pause failed for ${taskId}: ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * Counterpart to pauseForConn. Idempotent — silent no-op when the
   * conn was not pausing (e.g. force-evicted twice, or never paused).
   */
  resumeForConn(taskId: string, connToken: unknown): void {
    const entry = this.entries.get(taskId);
    if (!entry) return;
    if (!entry.pausedConns.has(connToken)) return;
    entry.pausedConns.delete(connToken);
    entry.pauseRefCount = Math.max(0, entry.pauseRefCount - 1);
    if (entry.pauseRefCount === 0 && entry.pty.resume) {
      try {
        entry.pty.resume();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[pty-manager] resume failed for ${taskId}: ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * Generic data subscription used by tests + non-WS observers. Do NOT use
   * for WS connections — those go through subscribeForConnection so the
   * backpressure machinery sees them.
   */
  subscribe(taskId: string, cb: (data: string) => void): () => void {
    const entry = this.entries.get(taskId);
    if (!entry) return () => undefined;
    entry.dataSubs.add(cb);
    return () => {
      entry.dataSubs.delete(cb);
    };
  }

  /**
   * Bind a WS connection. First attach is writer, the rest are readers.
   * Idempotent: re-attaching the same `conn` returns its existing role
   * (so onMessage can re-call attach to look up role without flipping
   * the writer-slot — closes external code-review F6).
   */
  attach(taskId: string, conn: unknown): AttachResult {
    const entry = this.entries.get(taskId);
    if (!entry) throw new Error(`pty-manager: attach to unknown task ${taskId}`);
    // Atomic snapshot BEFORE mutation — closes the race a separate
    // public read would expose against concurrent attach() calls
    // (external review HIGH, iterate-2026-05-27-fix-pty-reused-prewarm-race).
    const hadPriorWriter = entry.hadWriterAttach;
    let role: "writer" | "reader";
    if (entry.writer === null) {
      entry.writer = conn;
      entry.hadWriterAttach = true;
      role = "writer";
    } else if (entry.writer === conn) {
      // Re-attach by the same conn — keep its writer role + latch
      // (this conn IS a prior writer; idempotent).
      entry.hadWriterAttach = true;
      role = "writer";
    } else {
      role = "reader";
    }
    if (!entry.connSubs.has(conn)) {
      // Placeholder — the routes layer calls subscribeForConnection right after.
      entry.connSubs.set(conn, { onData: () => undefined });
    }
    // Attachment-gating (2026-06-02): a watching client disarms the grace.
    this.touchIdle(entry);
    return { role, hadPriorWriter };
  }

  /**
   * Non-mutating role lookup. Use this in hot paths (e.g. onMessage)
   * where calling `attach` would re-run the writer-slot decision logic.
   * Returns `null` for unknown task or unbound connection.
   */
  getRole(taskId: string, conn: unknown): "writer" | "reader" | null {
    const entry = this.entries.get(taskId);
    if (!entry) return null;
    if (!entry.connSubs.has(conn)) return null;
    return entry.writer === conn ? "writer" : "reader";
  }

  /**
   * Whether the entry currently has any writer bound. Used by
   * /paste-image to refuse pty-injection when no live writer exists
   * (external code-review F3 — writer-ownership tightening).
   */
  hasActiveWriter(taskId: string): boolean {
    const entry = this.entries.get(taskId);
    if (!entry) return false;
    return entry.writer !== null;
  }

  /**
   * Iterate E (ADR-092) — number of currently-attached WS connections
   * for the task. Includes writer + every reader. The routes WS-close
   * handler uses this to decide whether to trigger
   * `flushMirrorSnapshot` (only when the count drops to 0).
   *
   * Returns 0 for unknown tasks (no entry).
   */
  attachCount(taskId: string): number {
    const entry = this.entries.get(taskId);
    if (!entry) return 0;
    return entry.connSubs.size;
  }

  /**
   * Iterate E (ADR-092) — serialize the live headless mirror on demand
   * and return a SnapshotRecord (NOT written to disk). Used by the WS
   * attach replay flow as a fallback when `tryReadSnapshot` returns
   * null for a LIVE pty: without this path, re-attach to a live pty
   * yields a blank terminal (the original ADR-091 bug).
   *
   * Returns null when:
   *   - no entry for `taskId`,
   *   - entry exists but `mirror === null` (flag-disabled OR
   *     initialization refused),
   *   - `mirror.serializeStable()` throws (e.g. mirror in cleanup).
   *
   * The returned record's `terminalVersion` is the value passed via
   * `PtyManagerOpts.expectedTerminalVersion` at construction time —
   * keeping it coupled to the same pinned `@xterm/headless` version
   * the WS replay path's version-gate expects. When unset, defaults
   * to `"unknown"` matching SnapshotStore's last-resort sentinel.
   *
   * Best-effort: never throws; logs warn on serialize failure.
   */
  async serializeMirrorIfLive(taskId: string): Promise<SnapshotRecord | null> {
    const entry = this.entries.get(taskId);
    if (!entry || !entry.mirror) return null;
    try {
      const stable = await entry.mirror.serializeStable();
      const { cols, rows } = entry.mirror.dimensions;
      return {
        version: "v2",
        terminalVersion: this.expectedTerminalVersion,
        cols,
        rows,
        data: stable,
      };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[pty-manager] live-mirror serialize failed for ${taskId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * iterate-2026-05-18-inbox-terminal-prompts — decoded visible-viewport
   * text of the live headless mirror, or `null` when there is no live
   * mirror for `taskId` (no entry, or `mirror === null` — flag off /
   * pty exited / external-terminal launch).
   *
   * Consumed by the `/api/external/inbox` route to detect a waiting
   * `AskUserQuestion` picker — the picker is on-screen, never journaled
   * to the JSONL. Synchronous + best-effort: never throws (it sits
   * behind a 3 s inbox poll).
   */
  peekTerminalText(taskId: string): string | null {
    const entry = this.entries.get(taskId);
    if (!entry || !entry.mirror) return null;
    try {
      return entry.mirror.getVisibleText();
    } catch {
      return null;
    }
  }

  /**
   * Iterate E (ADR-092) — persist the live headless mirror to disk via
   * `SnapshotStore.write()`, but do NOT dispose the mirror. The pty
   * stays alive so subsequent `pty.onData` chunks keep mirroring and
   * subsequent `serializeMirrorIfLive()` calls still return fresh
   * state.
   *
   * This is the "snapshot-on-detach" half of the ADR-092 fix: when the
   * last WS subscriber detaches, the routes layer fires this so the
   * next attach (potentially after server restart) finds an on-disk
   * snapshot at `tryReadSnapshot`. Without it, a Hono restart loses
   * every live-pty's state since the last `pty.kill`.
   *
   * The write goes through the shared ADR-096 preservation gate
   * (`writeSnapshotPreservingLarger`, snapshot-preserve.ts) — SAME gate
   * finalizeMirrorSnapshot uses. Before this was shared, flush wrote
   * unconditionally and could clobber a richer on-disk snapshot with a
   * thin mirror (Claude TUI alt-screen exit) on the 2nd detach→reopen
   * cycle, blanking the scrollback. The gate skips the write when the
   * new payload is substantially smaller than the existing one.
   *
   * CLAUDE.md rule 21 / ADR-092: flush is a KEEP-ALIVE path — it MUST
   * NOT dispose the mirror (the pty stays alive so subsequent onData
   * keeps mirroring). Only finalizeMirrorSnapshot disposes.
   *
   * No-op when:
   *   - no entry for `taskId`,
   *   - entry has no mirror (flag off),
   *   - no `snapshotStore` wired.
   *
   * Best-effort: never throws. Caller can fire-and-forget.
   */
  async flushMirrorSnapshot(taskId: string): Promise<void> {
    const entry = this.entries.get(taskId);
    if (!entry || !entry.mirror || !this.snapshotStore) return;
    try {
      const stable = await entry.mirror.serializeStable();
      // D01 #2 — re-check the captured entry on THIS tick: a flush that parked
      // at serializeStable across a delete's kill+clear must NOT re-land the file.
      if (entry.tornDown) return;
      const { cols, rows } = entry.mirror.dimensions;
      // ADR-096 shared preservation gate — do NOT clobber a richer on-disk
      // snapshot with a thinner mirror (see snapshot-preserve.ts). Same gate
      // as finalizeMirrorSnapshot. Mirror is NOT disposed here (rule 21).
      //
      // shouldProceed re-checks entry.tornDown SYNCHRONOUSLY immediately
      // before the write enqueue — the helper's unqueued `await store.read`
      // yields the loop after the guard above, so a delete cascade that lands
      // in that gap (kill sets tornDown + clear() unlinks the snapshot) MUST
      // abort this write, or it would resurrect the just-wiped secret-bearing
      // snapshot (doubt-review HIGH, iterate-2026-07-12). finalize OMITS this
      // predicate — its kill-path write is authoritative and must land.
      await writeSnapshotPreservingLarger(
        this.snapshotStore,
        taskId,
        { cols, rows, data: stable },
        { caller: "flushMirrorSnapshot", shouldProceed: () => !entry.tornDown },
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[pty-manager] flushMirrorSnapshot failed for ${taskId}: ${(err as Error).message}`,
      );
    }
  }

  /** Replace the placeholder subscription with the routes' real callbacks. */
  subscribeForConnection(taskId: string, conn: unknown, sub: ConnectionSubscription): void {
    const entry = this.entries.get(taskId);
    if (!entry) return;
    entry.connSubs.set(conn, sub);
    if (!entry.pendingByConn.has(conn)) {
      entry.pendingByConn.set(conn, { bytes: 0, queue: [] });
    }
  }

  /**
   * Iterate E (ADR-092) — detach + count-after.
   *
   * Returns `{ remainingAttachCount }` so routes layer can decide on the
   * snapshot-on-last-detach trigger atomically with the detach itself —
   * closes the race the external code review (OpenAI HIGH #1) flagged
   * in the original split-step design (check count → detach → check
   * count again was vulnerable to concurrent attach landing in
   * between).
   *
   * Detaches AND returns the post-detach count in one observation; the
   * caller's "becameZero" branch is `remainingAttachCount === 0`. The
   * underlying `connSubs.delete` is synchronous, so no inter-step
   * window remains.
   */
  detachAndCount(taskId: string, conn: unknown): { remainingAttachCount: number } {
    this.detach(taskId, conn);
    return { remainingAttachCount: this.attachCount(taskId) };
  }

  /**
   * Detach a WS conn. If conn was writer, the slot is freed and any
   * remaining reader connection is promoted to writer (with onPromoteToWriter
   * fired so the routes layer can notify that client).
   *
   * 2026-05-05 — last-detach NO LONGER kills the pty. The previous
   * "no orphan tab leak" policy collided fundamentally with ADR-068-A1
   * (Iterate 5) Replay-on-Attach: any TaskBoard ↔ TaskDetail navigation
   * closes the WS, the server killed the pty, and re-attaching produced
   * a brand-new shell with no claude session — the symptom users report
   * as "Session bleibt nicht aktiv". Orphan management now relies on:
   *   - 30-min idle ceiling (touchIdle on every pty.onData)
   *   - explicit user "Stop terminal session" menu action
   *   - DELETE task cascade (Phase 4 Close-task-kills-pty)
   *   - server shutdown
   * The pty's process tree is bounded, the scrollback file is bounded
   * (1 MiB rotated), and the daily sweep TTL also catches abandoned
   * scrollback for tasks whose pty has long since exited.
   */
  detach(taskId: string, conn: unknown): void {
    const entry = this.entries.get(taskId);
    if (!entry) return;
    // AC-3 cleanup (per Gemini #3 + OpenAI #12): if the detached conn
    // held a pause stake (e.g. mid-replay watchdog eviction), release
    // it so pty.resume fires and the refcount doesn't leak.
    if (entry.pausedConns.has(conn)) {
      this.resumeForConn(taskId, conn);
    }
    entry.connSubs.delete(conn);
    entry.pendingByConn.delete(conn);
    entry.backpressureRaised.delete(conn);
    entry.bufferedExceededSince.delete(conn);
    this.connCapability.delete(conn);
    const wasWriter = entry.writer === conn;
    if (wasWriter) entry.writer = null;
    if (wasWriter) {
      // Promote the oldest remaining connection to writer (Map iteration
      // order is insertion order). Closes the StrictMode double-mount race
      // where the second WS opens BEFORE the first close arrives, takes
      // reader role, and only learns about the freed writer slot via
      // this promotion hook.
      const next = entry.connSubs.keys().next();
      if (!next.done) {
        const promoted = next.value;
        entry.writer = promoted;
        entry.hadWriterAttach = true; // defensive latch (openai #3 medium)
        const sub = entry.connSubs.get(promoted);
        if (sub?.onPromoteToWriter) {
          try {
            sub.onPromoteToWriter();
          } catch {
            /* ignore */
          }
        }
      }
    }
    // Attachment-gating (2026-06-02): arm the grace iff that was the last client.
    this.touchIdle(entry);
  }

  // --- internals -----------------------------------------------------------

  private cleanup(taskId: string): void {
    const entry = this.entries.get(taskId);
    if (!entry) return;
    this.idleReaper.cancel(taskId);
    this.entries.delete(taskId);
    // ADR-088: finalize the headless mirror snapshot, then dispose. D01 #3 —
    // store the promise on the entry so BOTH onExit and kill() await the SAME
    // finalize (a synchronous onExit no longer drops kill()'s await). Failures
    // never propagate — finalizeMirrorSnapshot is best-effort/infallible.
    if (entry.mirror && this.snapshotStore) {
      entry.finalizePromise = this.finalizeMirrorSnapshot(taskId, entry.mirror);
    } else {
      if (entry.mirror) { try { entry.mirror.dispose(); } catch { /* ignore */ } }
      entry.finalizePromise = Promise.resolve();
    }
  }

  /**
   * ADR-088 — produce the M2 stable snapshot and persist it. Best-effort:
   * a disk failure here MUST NOT crash kill / onExit. Logs a structured
   * warn on failure so observability picks it up.
   *
   * Why this is detached + async: kill() / onExit are synchronous
   * lifecycle hooks. The double-serialize cycle costs ~10 ms per the
   * spike — small but non-zero. Detaching keeps the close path
   * responsive and avoids back-pressuring the broadcaster.
   *
   * Iterate H (ADR-096) — the write goes through the shared preservation
   * gate `writeSnapshotPreservingLarger` (snapshot-preserve.ts): if an
   * existing on-disk snapshot is substantially larger than the about-to-
   * write one (a Claude TUI alt-screen-exit clear yields a near-empty
   * cell-state), the write is SKIPPED so the richer replay artifact
   * survives. Same gate flushMirrorSnapshot now uses (iterate-2026-07-12
   * de-dup). mirror.dispose() + releaseQueue still run in `finally` on
   * every branch (skip or write).
   */
  private async finalizeMirrorSnapshot(
    taskId: string,
    mirror: HeadlessMirror,
  ): Promise<void> {
    try {
      const stable = await mirror.serializeStable();
      const { cols, rows } = mirror.dimensions;
      if (this.snapshotStore) {
        await writeSnapshotPreservingLarger(
          this.snapshotStore,
          taskId,
          { cols, rows, data: stable },
          { caller: "finalizeMirrorSnapshot" },
        );
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[pty-manager] snapshot finalize failed for ${taskId}: ${(err as Error).message}`,
      );
    } finally {
      try {
        mirror.dispose();
      } catch {
        /* ignore */
      }
      // ADR-089 (external review gemini): release the snapshot-store's
      // per-task write queue so the Map cannot grow unboundedly for
      // long-lived processes that churn through many tasks. The
      // queue's onIdle() is awaited internally so any concurrent
      // write (rare — finalize is the only write surface) completes
      // before the entry is dropped.
      if (this.snapshotStore) {
        try {
          await this.snapshotStore.releaseQueue(taskId);
        } catch {
          /* best-effort */
        }
      }
    }
  }

  // Orphan grace is attachment-gated (idle-reaper.ts): armed only when no client is attached.
  private touchIdle(entry: PtyEntry): void {
    this.idleReaper.touch(entry.meta.taskId, entry.connSubs.size);
  }

  /**
   * Deliver outgoing pty data to a single WS connection subscriber,
   * applying drop-while-saturated backpressure: if the WS already has
   * more than `wsBufferBytes` queued on the wire, drop the new chunk
   * and fire `onBackpressure` (rate-limited to once per saturation
   * episode). Once `bufferedAmount` drops back, deliveries resume.
   *
   * Note (vs external code-review F7): the spec wording said
   * "drop-oldest", which strictly requires a server-side drain hook
   * (the @hono/node-ws adapter doesn't expose one) plus a periodic
   * bufferedAmount-poll loop to flush a queue. The functional outcome
   * for an interactive pty is equivalent under both policies — bytes
   * arrive in stream order; the loss window is "during saturation".
   * Drop-while-saturated is simpler and avoids unbounded server-side
   * buffer growth that drop-oldest could exhibit if drains stall.
   * Documented in the iterate spec deviation list + ADR-067 addendum.
   */
  private deliverWithBackpressure(
    entry: PtyEntry,
    conn: unknown,
    sub: ConnectionSubscription,
    data: string,
  ): void {
    const live = (conn as { bufferedAmount?: number }).bufferedAmount;
    const incoming = Buffer.byteLength(data, "utf8");

    // AC-3b — per-conn capability stamp (post-code-review v3, openai-5).
    if (!this.connCapability.has(conn)) {
      this.connCapability.set(conn, typeof live === "number" ? "ok" : "missing");
    }

    // AC-3b — track when this conn's buffered backlog first exceeded
    // the stuck threshold. The watchdog evicts based on this timestamp,
    // NOT on pty.onData freshness (per external review v2 — gemini-2 +
    // openai-9: a runaway pty would otherwise keep the writer pinned
    // forever).
    if (typeof live === "number") {
      const exceeded = live > this.watchdogStuckThresholdBytes;
      const prev = entry.bufferedExceededSince.get(conn);
      if (exceeded && (prev === undefined || prev === null)) {
        entry.bufferedExceededSince.set(conn, this.nowFn());
      } else if (!exceeded && prev !== null && prev !== undefined) {
        entry.bufferedExceededSince.set(conn, null);
      }
    }

    if (typeof live === "number" && live + incoming > this.wsBufferBytes) {
      // Saturated — drop this chunk, raise backpressure once per episode.
      if (!entry.backpressureRaised.get(conn) && sub.onBackpressure) {
        entry.backpressureRaised.set(conn, true);
        try {
          sub.onBackpressure({ droppedBytes: incoming });
        } catch { /* ignore */ }
      }
      return;
    }

    if (entry.backpressureRaised.get(conn)) {
      entry.backpressureRaised.set(conn, false);
    }

    try {
      sub.onData(data);
    } catch { /* ignore */ }
  }

  /**
   * AC-3b watchdog tick. Walks every entry; for each one with a writer,
   * checks how long the writer's WS bufferedAmount has been above the
   * stuck threshold. Beyond `watchdogStuckDurationMs`, evict via
   * `detach()` so the cleanup chain (pause refcount release + reader
   * promotion + onPromoteToWriter) runs.
   *
   * Capability is tracked PER-CONN (post-code-review openai-5). A
   * single legacy WS adapter without bufferedAmount no longer disables
   * eviction for healthy conns sharing the same manager.
   */
  private watchdogTick(): void {
    for (const [taskId, entry] of this.entries) {
      const writer = entry.writer;
      if (writer === null) continue;
      // Per-conn capability check.
      if (this.connCapability.get(writer) === "missing") continue;
      const live = (writer as { bufferedAmount?: number }).bufferedAmount;
      if (typeof live !== "number") {
        // Stamp this writer as missing-capability + warn once globally.
        this.connCapability.set(writer, "missing");
        if (!this.capabilityWarnLogged) {
          this.capabilityWarnLogged = true;
          // eslint-disable-next-line no-console
          console.warn(
            "[pty-manager] watchdog disabled for one or more writers — WSContext does not expose bufferedAmount; falling back to ws.close-driven release for affected conns",
          );
        }
        continue;
      }
      this.connCapability.set(writer, "ok");
      // If the writer's backlog crossed threshold mid-tick (no prior
      // delivery to record it via deliverWithBackpressure), record now.
      const prev = entry.bufferedExceededSince.get(writer);
      const exceeded = live > this.watchdogStuckThresholdBytes;
      if (exceeded && (prev === undefined || prev === null)) {
        entry.bufferedExceededSince.set(writer, this.nowFn());
        continue;
      }
      if (!exceeded) {
        if (prev !== null && prev !== undefined) {
          entry.bufferedExceededSince.set(writer, null);
        }
        continue;
      }
      // exceeded === true && prev !== null/undefined — check stuck duration.
      if (typeof prev === "number" && this.nowFn() - prev >= this.watchdogStuckDurationMs) {
        // Stuck — evict. detach() runs the pause-refcount cleanup +
        // promotes the next reader. Log so UAT can correlate.
        // eslint-disable-next-line no-console
        console.warn(
          `[pty-manager] watchdog evicting stuck writer for task ${taskId} (bufferedAmount=${live}B for ${this.nowFn() - prev}ms)`,
        );
        this.detach(taskId, writer);
      }
    }
  }
}
