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

import path from "node:path";
import type { ScrollbackStore } from "./scrollback-store.js";
import { HeadlessMirror } from "./headless-mirror.js";
import type { SnapshotStore } from "./snapshot-store.js";

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
  /** Idle timer for the safety ceiling. */
  idleTimer: ReturnType<typeof setTimeout> | null;
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
}

/** Sentinel for the legacy token-less pause()/resume() API. */
const ANON_PAUSE_TOKEN: unique symbol = Symbol("pty-manager.anonymous-pause");

export class PtyManager {
  private readonly entries = new Map<string, PtyEntry>();
  private readonly spawnFn: PtySpawnFn;
  private readonly wsBufferBytes: number;
  private readonly idleTimeoutMs: number;
  private readonly scrollbackStore: ScrollbackStore | undefined;
  private readonly snapshotStore: SnapshotStore | undefined;
  private readonly headlessMirrorEnabled: boolean;
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
    this.idleTimeoutMs = opts.idleTimeoutMs ?? 1_800_000;
    this.scrollbackStore = opts.scrollbackStore;
    this.snapshotStore = opts.snapshotStore;
    // Mirror requires BOTH flag-on AND a configured store. Either alone
    // is a no-op so misconfiguration cannot leak in-memory Terminals
    // without a persistence path.
    this.headlessMirrorEnabled =
      (opts.headlessMirrorEnabled ?? false) && !!opts.snapshotStore;
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
    const pty = this.spawnFn(opts.shell, [], {
      cwd: opts.cwd,
      cols: opts.cols ?? 120,
      rows: opts.rows ?? 30,
    });
    // ADR-088: optional headless mirror. Created here so the mirror's
    // lifetime is co-extensive with the entry; disposed in cleanup().
    // Cols/rows match the pty-spawn defaults so the mirror sees the
    // same initial dimensions the shell does. Subsequent resize() calls
    // forward to both pty and mirror.
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
      lastResizeCols: null,
      lastResizeRows: null,
      idleTimer: null,
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
      // ADR-068-A1: persist to disk before broadcast. Synchronous via
      // fs.appendFileSync so subsequent reads see the bytes immediately.
      // Wrapped in try/catch so a disk error / rotation-buffer-overflow
      // never breaks the broadcaster.
      if (this.scrollbackStore) {
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
      // iterate-2026-05-08 v0.8.7 AC-2 — when this exit was triggered by
      // an INTENTIONAL kill (kill(taskId) or idle-ceiling timer set
      // entry.closing=true before invoking pty.kill), append a single
      // dim-grey marker frame to disk-scrollback. Natural exits (user
      // typed `exit`, shell crashed) leave closing=false → no marker.
      // Append happens AFTER the dying-process flush bytes (per external
      // review gemini medium): pty.onExit fires once the process has
      // closed its stdio handles, so onData has drained.
      if (entry.closing && this.scrollbackStore) {
        this.appendShellStoppedMarker(taskId);
      }
      this.cleanup(taskId);
    });

    this.touchIdle(entry);
    return meta;
  }

  /**
   * iterate-2026-05-08 v0.8.7 AC-2 — append a single dim-grey ANSI marker
   * frame to disk-scrollback. Best-effort; failures logged via
   * console.warn and never thrown (caller is in onExit cleanup which
   * MUST be infallible). Exact format:
   *
   *     \r\n\x1b[2m──── shell stopped at HH:MM:SS ────\x1b[m\r\n
   *
   * `\x1b[2m` = SGR dim. Box-drawing char `─` is U+2500 (3 UTF-8 bytes).
   * Marker bytes flow through the same `scrollbackStore.append()` path
   * as live `pty.onData` output, so `scrollbackBytes` accounting on
   * the `scrollback-meta` envelope reflects them correctly.
   *
   * **Timing safety (per external code review openai 2026-05-08 high):**
   *
   * `ScrollbackStore.append()` uses `fs.appendFileSync` (one open-write-
   * close syscall sequence per call — see `scrollback-store.ts` header
   * "Architecture invariants"). It is FULLY SYNCHRONOUS — the marker
   * bytes are durable on disk before this function returns. There is
   * no per-task WriteStream that could be closed mid-write; closeStream
   * is a no-op for the file (only resets the per-task size cache).
   *
   * Therefore: the kill→onExit→appendMarker→cleanup sequence is safe.
   * cleanup deletes the pty entry from `this.entries` BUT does not
   * touch `this.scrollbackStore.states` — append() looks up by taskId
   * + reopens the file via O_APPEND each call, so a deleted entry has
   * no effect on subsequent append correctness.
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

  kill(taskId: string): void {
    const entry = this.entries.get(taskId);
    if (!entry) return;
    // iterate-2026-05-08 v0.8.7 AC-2 — flag intentional kill so onExit
    // appends the marker. Closing-flag dedupe: a duplicate kill() lands
    // here AFTER onExit fired + cleanup ran, so `entries.get` returns
    // undefined and the function returns early — no second marker.
    entry.closing = true;
    try {
      entry.pty.kill();
    } catch {
      // best-effort
    }
    this.cleanup(taskId);
    // ADR-068-A1: release scrollback FD lifecycle. Best-effort + non-throwing
    // — if the queue is busy with rotation, closeStream resolves after that
    // settles. Detached from kill() return so kill() stays sync.
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
  }

  killAll(): void {
    const taskIds = [...this.entries.keys()];
    for (const id of taskIds) this.kill(id);
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
    let role: "writer" | "reader";
    if (entry.writer === null) {
      entry.writer = conn;
      role = "writer";
    } else if (entry.writer === conn) {
      // Re-attach by the same conn — keep its writer role.
      role = "writer";
    } else {
      role = "reader";
    }
    if (!entry.connSubs.has(conn)) {
      // Placeholder — the routes layer calls subscribeForConnection right after.
      entry.connSubs.set(conn, { onData: () => undefined });
    }
    return { role };
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
  }

  // --- internals -----------------------------------------------------------

  private cleanup(taskId: string): void {
    const entry = this.entries.get(taskId);
    if (!entry) return;
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    this.entries.delete(taskId);
    // ADR-088: finalize the headless mirror snapshot, then dispose.
    // Detached from the cleanup return because serializeStable() is
    // async and cleanup is sync (called from onExit + kill). Failures
    // never propagate — kill path must stay infallible. The mirror's
    // own resources are freed in the finally block.
    if (entry.mirror && this.snapshotStore) {
      void this.finalizeMirrorSnapshot(taskId, entry.mirror);
    } else if (entry.mirror) {
      // No snapshot store wired — just dispose so the Terminal frees.
      try {
        entry.mirror.dispose();
      } catch {
        /* ignore */
      }
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
   */
  private async finalizeMirrorSnapshot(
    taskId: string,
    mirror: HeadlessMirror,
  ): Promise<void> {
    try {
      const stable = await mirror.serializeStable();
      const { cols, rows } = mirror.dimensions;
      if (this.snapshotStore) {
        await this.snapshotStore.write(taskId, {
          cols,
          rows,
          data: stable,
        });
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
    }
  }

  private touchIdle(entry: PtyEntry): void {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
      // Idle ceiling reached — force kill. iterate-2026-05-08 v0.8.7
      // AC-2: flag intentional kill so the onExit handler appends
      // the marker before cleanup deletes the entry.
      entry.closing = true;
      try {
        entry.pty.kill();
      } catch {
        /* ignore */
      }
      this.cleanup(entry.meta.taskId);
    }, this.idleTimeoutMs);
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
