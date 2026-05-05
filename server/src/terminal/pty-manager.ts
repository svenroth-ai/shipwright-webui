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
  /** Module-level data subscribers (used by tests + observability). */
  dataSubs: Set<(data: string) => void>;
  /** Per-WS-connection subscribers (used by the routes WS bridge). */
  connSubs: Map<unknown, ConnectionSubscription>;
  /** First connection becomes writer; null when no writer is currently bound. */
  writer: unknown | null;
  /** Idle timer for the safety ceiling. */
  idleTimer: ReturnType<typeof setTimeout> | null;
  /** Pending outbound bytes per connection (used for drop-oldest decision). */
  pendingByConn: Map<unknown, { bytes: number; queue: string[] }>;
  /** True while a backpressure event is already raised — avoids fire-flood. */
  backpressureRaised: Map<unknown, boolean>;
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
}

export class PtyManager {
  private readonly entries = new Map<string, PtyEntry>();
  private readonly spawnFn: PtySpawnFn;
  private readonly wsBufferBytes: number;
  private readonly idleTimeoutMs: number;
  private readonly scrollbackStore: ScrollbackStore | undefined;

  constructor(opts: PtyManagerOpts) {
    this.spawnFn = opts.spawn;
    this.wsBufferBytes = opts.wsBufferBytes ?? 1_048_576;
    this.idleTimeoutMs = opts.idleTimeoutMs ?? 1_800_000;
    this.scrollbackStore = opts.scrollbackStore;
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
    const entry: PtyEntry = {
      meta,
      pty,
      dataSubs: new Set(),
      connSubs: new Map(),
      writer: null,
      idleTimer: null,
      pendingByConn: new Map(),
      backpressureRaised: new Map(),
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
      this.cleanup(taskId);
    });

    this.touchIdle(entry);
    return meta;
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
    entry.pty.resize(cols, rows);
  }

  kill(taskId: string): void {
    const entry = this.entries.get(taskId);
    if (!entry) return;
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
  }

  /**
   * Pause the live pty (ADR-068-A1). Called by the WS upgrade `onOpen`
   * before reading scrollback from disk so live output doesn't pile up
   * in the per-conn liveBuffer during replay-render. Pty-pause has a
   * global side-effect: ALL attached connections see no live data
   * until resume() is called. Documented + accepted; multi-tab fairness
   * is deferred (replay completes in <1s typical).
   */
  pause(taskId: string): void {
    const entry = this.entries.get(taskId);
    if (!entry || !entry.pty.pause) return;
    try {
      entry.pty.pause();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[pty-manager] pause failed for ${taskId}: ${(err as Error).message}`,
      );
    }
  }

  /** Counterpart to pause(). Idempotent — calling on a non-paused pty is a no-op. */
  resume(taskId: string): void {
    const entry = this.entries.get(taskId);
    if (!entry || !entry.pty.resume) return;
    try {
      entry.pty.resume();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[pty-manager] resume failed for ${taskId}: ${(err as Error).message}`,
      );
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
    entry.connSubs.delete(conn);
    entry.pendingByConn.delete(conn);
    entry.backpressureRaised.delete(conn);
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
  }

  private touchIdle(entry: PtyEntry): void {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
      // Idle ceiling reached — force kill.
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
}
