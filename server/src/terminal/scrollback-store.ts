/*
 * scrollback-store.ts — disk-backed terminal scrollback (iterate-2026-05-04, ADR-068-A1).
 *
 * Per-task append-only file at `<scrollbackDir>/<taskId>.log` (rotated to
 * `.log.1` at `maxBytesPerTask`). Read-back combines both files via
 * StringDecoder so multi-byte UTF-8 split across the rotation boundary
 * round-trips cleanly. Replay-on-attach (in routes.ts WS upgrade)
 * reads the last `maxBytesPerTask` bytes and chunks them over the
 * WebSocket.
 *
 * Architecture invariants (frozen by external review v3→v7 + Round 4):
 *   - append() uses fs.appendFileSync (one syscall sequence per call —
 *     open(O_APPEND|O_CREAT|O_WRONLY) → write() → close()). This is the
 *     simplest serialization model: data is visible to subsequent reads
 *     immediately, no batching race. Performance fine for embedded-terminal
 *     workloads (chunks 1B–64KiB at <100Hz; total wall-time per call ≪ 1ms).
 *   - rotate() / read() / clear() ARE serialized through a per-task
 *     PQueue (concurrency=1). p-queue avoids the homegrown promise-chain
 *     bug from v6 review round 3.
 *   - drop-oldest is FORBIDDEN — would bisect multi-byte UTF-8 / ANSI
 *     sequences and permanently corrupt the terminal. Live-data
 *     pressure is handled at the WS layer (pty.pause/resume during
 *     replay; existing per-conn outbound backpressure on saturation).
 *   - Rotation goes through a 3-state machine: NORMAL → ROTATING →
 *     ROTATION_FLUSH → NORMAL. While state ≠ NORMAL, append() writes
 *     to a rotationBuffer (cap rotationBufferMultiplier × maxBytesPerTask).
 *     Overflow throws ScrollbackStoreError + structured-error-log
 *     (should never fire in practice — rotation completes in low ms).
 *   - Path-guard is realpath-at-op-time on every clear/rotate;
 *     boot-time realPathGuard is first-line defense only.
 *   - UUID format /^[0-9a-fA-F-]{36}$/ validated on every public
 *     method — defeats path-traversal at the cheapest possible
 *     layer.
 *   - File mode 0o600 / dir mode 0o700 (POSIX-enforced). Windows
 *     ignores POSIX modes — privacy disclosure UI surfaces this
 *     limitation; user-account ACLs are the real boundary there.
 *   - Disabled mode: maxBytesPerTask === 0 → all public methods
 *     return early; no file is ever created.
 */

import * as fsAsync from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { StringDecoder } from "node:string_decoder";
import PQueue from "p-queue";
import { ScrollbackSanitizer } from "./scrollback-sanitizer.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type RenameFn = (from: string, to: string) => Promise<void>;

export interface ScrollbackStoreOpts {
  /** Cap per-task. 0 = disabled. */
  maxBytesPerTask: number;
  /** POSIX file mode for `<taskId>.log`. Ignored on Windows. */
  fileMode?: number;
  /** POSIX dir mode for the scrollback directory. Ignored on Windows. */
  dirMode?: number;
  /** Multiplier on rotationBuffer cap (×maxBytesPerTask). Default 4. */
  rotationBufferMultiplier?: number;
  /** Hook for tests to override fs.rename retry behavior. */
  renameMaxAttempts?: number;
  /** Custom rename function — used by tests to simulate Windows EBUSY. */
  renameFn?: RenameFn;
  /** Hook for tests to seed the time source (used for sweepExpired). */
  now?: () => number;
}

export interface SweepOpts {
  activeTaskIds: Set<string>;
  maxFilesPerPass?: number;
}

export interface SweepResult {
  deleted: number;
  remaining: number;
  errors: number;
}

export class ScrollbackStoreError extends Error {
  constructor(
    public readonly code:
      | "invalid_task_id"
      | "rotation_buffer_overflow"
      | "scrollback_path_outside_dir",
    message: string,
  ) {
    super(message);
    this.name = "ScrollbackStoreError";
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const UUID_PATTERN = /^[0-9a-fA-F-]{36}$/;

/**
 * iterate-2026-05-08 v0.8.7 AC-3 — replay-time collapse of repeated
 * PowerShell-startup banner bursts. Pure function over the raw scrollback
 * string; called by `readForReplay()` only — disk content untouched.
 *
 * Trigger conditions (all must hold for each tuple within a single
 * shell-lifetime span — between AC-2 markers / start / end of buffer):
 *   1. Match the bounded banner regex `(?:OSC title)?PowerShell N.N.N
 *      \r\n(?:PS prompt)?` — bounded sub-patterns prevent ReDoS.
 *   2. Tuple is preceded by ≥10 consecutive `\r\n` lines (the post-
 *      resize CRLF block signature observed in pwsh respawn cycles).
 *   3. ≥2 such tuples in the same span trigger the collapse — single
 *      mid-stream banners are preserved verbatim.
 *
 * On collapse: keep the LAST banner-burst (closest to "current state");
 * replace the earlier ones with a single dim-grey marker line:
 *
 *     \r\n\x1b[2m── N earlier banners collapsed ──\x1b[m\r\n
 *
 * Collapse is per-span — never crosses an AC-2 shell-stopped marker.
 */
const SHELL_STOPPED_MARKER_RE =
  /\r\n\x1b\[2m──── shell stopped at \d{2}:\d{2}:\d{2} ────\x1b\[m\r\n/g;

const BANNER_BURST_RE =
  // ≥10 CRLF lines preceding (post-resize signature)
  // (?:\x1b\]0;[^\x07]{0,256}\x07)? — bounded OSC title-set
  // PowerShell N.N.N\r\n — version banner (anchored shape)
  // (?:PS [^\r\n>]{0,512}>[ \t]*)? — bounded prompt path; trailing
  //   whitespace is SPACE/TAB only — NEVER `\s*` because that includes
  //   newlines and would greedily eat the NEXT banner-burst's
  //   ≥10-CRLF prefix, breaking subsequent matches.
  /(?:\r\n){10,}(?:\x1b\]0;[^\x07]{0,256}\x07)?PowerShell \d+\.\d+\.\d+\r\n(?:PS [^\r\n>]{0,512}>[ \t]*)?/g;

function collapseSpan(span: string): string {
  // Reset lastIndex on the global regex (function-scoped reuse).
  BANNER_BURST_RE.lastIndex = 0;
  const matches: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = BANNER_BURST_RE.exec(span)) !== null) {
    matches.push(m);
    // Defensive: zero-width matches would loop forever.
    if (m.index === BANNER_BURST_RE.lastIndex) BANNER_BURST_RE.lastIndex++;
  }
  if (matches.length < 2) return span;

  const earlierCount = matches.length - 1;
  const collapseMarker =
    `\r\n\x1b[2m── ${earlierCount} earlier banner${earlierCount === 1 ? "" : "s"} collapsed ──\x1b[m\r\n`;
  const last = matches[matches.length - 1];
  const first = matches[0];

  // pre-burst content + collapse marker + LAST burst + post-burst content
  return (
    span.slice(0, first.index) +
    collapseMarker +
    span.slice(last.index, last.index + last[0].length) +
    span.slice(last.index + last[0].length)
  );
}

export function collapsePowerShellBoilerplate(raw: string): string {
  // Reset lastIndex on the global marker regex.
  SHELL_STOPPED_MARKER_RE.lastIndex = 0;
  const parts = raw.split(SHELL_STOPPED_MARKER_RE);
  if (parts.length === 1) {
    // No AC-2 markers — single span.
    return collapseSpan(raw);
  }
  // Recover the original markers (split discards them).
  SHELL_STOPPED_MARKER_RE.lastIndex = 0;
  const markers = raw.match(SHELL_STOPPED_MARKER_RE) ?? [];
  let result = collapseSpan(parts[0]);
  for (let i = 0; i < markers.length; i++) {
    result += markers[i];
    result += collapseSpan(parts[i + 1] ?? "");
  }
  return result;
}

type RotationState = "NORMAL" | "ROTATING" | "ROTATION_FLUSH";

interface PerTaskState {
  /** Bytes written to current `.log` file (since open or rotation). */
  size: number;
  /** Rotation state. */
  state: RotationState;
  /** Bytes queued during rotation; flushed once rotation completes. */
  rotationBuffer: Buffer[];
  rotationBufferBytes: number;
  /** Per-task serialized queue for rotate / read / clear. */
  queue: PQueue;
  /**
   * AC-1 (iterate-2026-05-05) — sanitizer that strips cursor-control +
   * repaint sequences from the byte stream before disk persistence.
   * One instance per task so chunk-boundary state (mid-CSI / mid-OSC /
   * mid-CRLF) carries across `pty.onData` calls.
   */
  sanitizer: ScrollbackSanitizer;
}

// ---------------------------------------------------------------------------
// ScrollbackStore
// ---------------------------------------------------------------------------

export class ScrollbackStore {
  private readonly states = new Map<string, PerTaskState>();
  private readonly rotationBufferMultiplier: number;
  private readonly fileMode: number;
  private readonly dirMode: number;
  private readonly renameMaxAttempts: number;
  private readonly renameFn: RenameFn;
  private readonly now: () => number;
  private resolvedDir: string | null = null;

  constructor(
    public readonly dir: string,
    public readonly opts: ScrollbackStoreOpts,
  ) {
    this.fileMode = opts.fileMode ?? 0o600;
    this.dirMode = opts.dirMode ?? 0o700;
    this.rotationBufferMultiplier = opts.rotationBufferMultiplier ?? 4;
    this.renameMaxAttempts = opts.renameMaxAttempts ?? 3;
    this.renameFn = opts.renameFn ?? ((from, to) => fsAsync.rename(from, to));
    this.now = opts.now ?? Date.now;
  }

  /** Whether persistence is disabled via env var (`SHIPWRIGHT_TERMINAL_SCROLLBACK_MAX_BYTES=0`). */
  get disabled(): boolean {
    return this.opts.maxBytesPerTask === 0;
  }

  /** Public init — creates dir + caches resolved path. Idempotent. Call from server bootstrap. */
  async init(): Promise<void> {
    if (this.disabled) return;
    await this.ensureDirResolved();
  }

  /**
   * Append raw pty bytes via fs.appendFileSync. Synchronous (one syscall
   * sequence per call). May throw ScrollbackStoreError on rotation buffer
   * overflow or invalid taskId; the caller (pty-manager.onData broadcast)
   * MUST wrap in try/catch to keep the broadcast loop resilient.
   *
   * Returns true if the bytes were either buffered or written, false if
   * disabled.
   */
  append(taskId: string, data: Buffer): boolean {
    if (this.disabled) return false;
    if (data.byteLength === 0) return true;
    this.validateTaskId(taskId);

    const st = this.getOrInitState(taskId);

    // AC-1 (iterate-2026-05-05): sanitize before persistence. The live
    // broadcast in PtyManager keeps the raw bytes; only the disk path
    // runs through the sanitizer. Held state (mid-CSI / mid-OSC / mid-CRLF)
    // carries across calls via st.sanitizer.
    const sanitized = st.sanitizer.feed(data);
    if (sanitized.byteLength === 0) {
      // The chunk was entirely cursor-control / repaint bytes (e.g. a
      // standalone "\x1b[H\x1b[K" frame) — nothing to persist for this
      // chunk. Held state in st.sanitizer is preserved for the next call.
      return true;
    }

    // Rotation in flight → buffer (NEVER drop chunks; ANSI/UTF-8 corruption).
    if (st.state !== "NORMAL") {
      this.bufferDuringRotation(taskId, st, sanitized);
      return true;
    }

    try {
      fsSync.appendFileSync(this.taskFilePath(taskId), sanitized, {
        mode: this.fileMode,
      });
    } catch (err) {
      // Surface as warning; never crash the broadcaster on disk errors.
      // eslint-disable-next-line no-console
      console.warn(
        `[scrollback] appendFileSync failed for ${taskId}: ${(err as Error).message}`,
      );
      return false;
    }

    st.size += sanitized.byteLength;

    if (st.size > this.opts.maxBytesPerTask) {
      this.scheduleRotation(taskId, st);
    }
    return true;
  }

  /**
   * Read the last `maxBytesPerTask` bytes (combines `.log.1` + `.log`
   * if rotation has happened). Returns "" if no scrollback exists or
   * disabled. UTF-8-safe via StringDecoder — multi-byte split across
   * rotation boundary is handled correctly.
   */
  async read(taskId: string): Promise<string> {
    if (this.disabled) return "";
    this.validateTaskId(taskId);

    const st = this.getOrInitState(taskId);
    return st.queue.add(() => this.readLocked(taskId)) as Promise<string>;
  }

  /**
   * Total persisted bytes for a task — sum of `.log` (live) + `.log.1`
   * (rotated archive). The cached size in PerTaskState reflects ONLY
   * the live `.log` and resets on rotation, so a callee using `bytes()`
   * to gate replay-presence UI would otherwise get a false 0 right
   * after rotation. Phase-3 review fix (HIGH).
   */
  async bytes(taskId: string): Promise<number> {
    if (this.disabled) return 0;
    this.validateTaskId(taskId);
    const dir = await this.ensureDirResolved();
    let total = 0;
    for (const name of [`${taskId}.log`, `${taskId}.log.1`]) {
      try {
        const stats = await fsAsync.stat(path.join(dir, name));
        total += stats.size;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    }
    // Refresh per-task size cache against the live .log (only the
    // live size is the size cache's contract).
    const st = this.states.get(taskId);
    if (st) {
      try {
        const live = await fsAsync.stat(path.join(dir, `${taskId}.log`));
        st.size = live.size;
      } catch {
        st.size = 0;
      }
    }
    return total;
  }

  /**
   * iterate-2026-05-08 v0.8.7 AC-3 — read the scrollback for **WS replay
   * only**, applying replay-time collapse of repeated PowerShell-startup
   * banner bursts. The disk file is unchanged; this is purely a
   * presentation transform.
   *
   * Per external plan review (gemini high + openai high):
   *   - `read()` and `bytes()` STAY RAW so `scrollback-meta` envelope
   *     accounting + privacy disclosure copy stay accurate.
   *   - Bounded regex (`[^\a]{0,256}` / `[^\r\n>]{0,512}`) — no
   *     ReDoS / catastrophic-backtracking on long histories.
   *   - Collapse never crosses an AC-2 `──── shell stopped at ────`
   *     marker (split by markers, collapse each span, rejoin).
   *   - Whitelist trigger: ≥10-CRLF prefix + bounded banner + ≥2
   *     such tuples within one span. Single mid-stream "PowerShell
   *     7.6.1" is NEVER collapsed.
   */
  async readForReplay(taskId: string): Promise<string> {
    const raw = await this.read(taskId);
    if (!raw) return raw;
    return collapsePowerShellBoilerplate(raw);
  }

  /**
   * Delete `.log` + `.log.1`. THROWS on failure (used by user-clear).
   * Resets per-task state (size cache + rotationBuffer).
   */
  async clear(taskId: string): Promise<void> {
    if (this.disabled) return;
    this.validateTaskId(taskId);

    const st = this.getOrInitState(taskId);
    await st.queue.add(() => this.clearLocked(taskId, /* loud */ true));
  }

  /** Best-effort variant — used by task-delete cascade. Logs warn but does not throw. */
  async clearBestEffort(taskId: string): Promise<void> {
    if (this.disabled) return;
    if (!UUID_PATTERN.test(taskId)) return; // silent — not a real task
    const st = this.getOrInitState(taskId);
    await st.queue.add(() => this.clearLocked(taskId, /* loud */ false));
  }

  /**
   * "Close stream" semantics — kept for API parity with the WriteStream-based
   * implementation. Since we use appendFileSync there is no stream to close,
   * but callers (pty-manager.kill) still call this; we drop the per-task
   * size cache so subsequent reads pick up disk truth, and we remain
   * idempotent.
   */
  async closeStream(taskId: string): Promise<void> {
    if (this.disabled) return;
    if (!UUID_PATTERN.test(taskId)) return; // silent — not a real task
    // Idempotent: drop the in-memory state so size-cache rehydrates from disk
    // on next read/bytes call. Equivalent to the WriteStream close+invalidate.
    // Rotation queue is preserved (not dropped) so any pending rotation
    // completes against the on-disk file.
    const st = this.states.get(taskId);
    if (!st) return;
    // Wait for any pending queue work (rotation/read/clear) to settle.
    await st.queue.onIdle();
  }

  /**
   * Sweep expired files. Bounded — max `maxFilesPerPass` per call,
   * oldest-first by mtime. Skips files for active tasks.
   */
  async sweepExpired(
    ttlDays: number,
    sweepOpts: SweepOpts,
  ): Promise<SweepResult> {
    if (this.disabled) return { deleted: 0, remaining: 0, errors: 0 };

    const dir = await this.ensureDirResolved();
    const cutoffMs = this.now() - ttlDays * 24 * 60 * 60 * 1000;
    const maxFiles = sweepOpts.maxFilesPerPass ?? 100;
    const result: SweepResult = { deleted: 0, remaining: 0, errors: 0 };

    let entries: string[];
    try {
      entries = await fsAsync.readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return result;
      throw err;
    }

    // Phase-3 review fix (MEDIUM): group by task so .log + .log.1 of
    // the same task count as ONE deletion unit against maxFilesPerPass
    // (otherwise a 100-file cap would only free 50 tasks of history).
    interface TaskGroup {
      taskId: string;
      files: string[];
      newestMtime: number;
      oldestMtime: number;
    }
    const groupsById = new Map<string, TaskGroup>();
    for (const name of entries) {
      const m = name.match(/^([0-9a-fA-F-]{36})\.log(?:\.1)?$/);
      if (!m) continue;
      const taskId = m[1];
      if (sweepOpts.activeTaskIds.has(taskId)) continue;
      try {
        const stats = await fsAsync.stat(path.join(dir, name));
        // Keep the WHOLE task only if every file in the group is
        // expired. If any file is fresh, skip the entire task.
        if (stats.mtimeMs >= cutoffMs) {
          groupsById.delete(taskId);
          // Mark "fresh" so we don't add expired siblings later.
          continue;
        }
        const g = groupsById.get(taskId);
        if (g) {
          g.files.push(name);
          g.newestMtime = Math.max(g.newestMtime, stats.mtimeMs);
          g.oldestMtime = Math.min(g.oldestMtime, stats.mtimeMs);
        } else {
          groupsById.set(taskId, {
            taskId,
            files: [name],
            newestMtime: stats.mtimeMs,
            oldestMtime: stats.mtimeMs,
          });
        }
      } catch {
        result.errors++;
      }
    }

    // Oldest-first by newestMtime so the group whose live file is
    // oldest gets cleaned first (aligned with TTL semantics).
    const groups = [...groupsById.values()].sort(
      (a, b) => a.newestMtime - b.newestMtime,
    );

    for (const g of groups) {
      if (result.deleted >= maxFiles) {
        result.remaining++;
        continue;
      }
      let groupFailed = false;
      for (const file of g.files) {
        try {
          await fsAsync.unlink(path.join(dir, file));
        } catch {
          result.errors++;
          groupFailed = true;
        }
      }
      if (!groupFailed) {
        result.deleted++;
        this.states.delete(g.taskId);
      }
    }
    return result;
  }

  /**
   * Graceful shutdown — wait for all per-task PQueues to drain.
   * appendFileSync writes are already synchronous so no flush is
   * needed; only pending rotation/read/clear operations need to
   * finish. timeoutMs is a safety cap.
   */
  async shutdown(timeoutMs = 5000): Promise<void> {
    const drains: Promise<void>[] = [];
    for (const [, st] of this.states) {
      drains.push(st.queue.onIdle());
    }
    const all = Promise.all(drains).then(() => undefined);
    const timer = new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
    });
    await Promise.race([all, timer]);
  }

  // --- Internal --------------------------------------------------------------

  private validateTaskId(taskId: string): void {
    if (!UUID_PATTERN.test(taskId)) {
      throw new ScrollbackStoreError(
        "invalid_task_id",
        `taskId does not match UUID pattern: ${taskId}`,
      );
    }
  }

  private getOrInitState(taskId: string): PerTaskState {
    let st = this.states.get(taskId);
    if (!st) {
      st = {
        size: 0,
        state: "NORMAL",
        rotationBuffer: [],
        rotationBufferBytes: 0,
        queue: new PQueue({ concurrency: 1 }),
        sanitizer: new ScrollbackSanitizer(),
      };
      this.states.set(taskId, st);
    }
    return st;
  }

  private bufferDuringRotation(
    taskId: string,
    st: PerTaskState,
    data: Buffer,
  ): void {
    const cap = this.opts.maxBytesPerTask * this.rotationBufferMultiplier;
    if (st.rotationBufferBytes + data.byteLength > cap) {
      // eslint-disable-next-line no-console
      console.warn(
        `[scrollback] rotation buffer overflow for ${taskId}: ${st.rotationBufferBytes + data.byteLength}/${cap} bytes`,
      );
      throw new ScrollbackStoreError(
        "rotation_buffer_overflow",
        `rotationBuffer overflow for ${taskId}`,
      );
    }
    st.rotationBuffer.push(data);
    st.rotationBufferBytes += data.byteLength;
  }

  private taskFilePath(taskId: string): string {
    return path.join(this.resolvedDir ?? this.dir, `${taskId}.log`);
  }

  /**
   * Resolve task file path with realpath-at-op-time. Used for clear / rotate
   * — defends against mid-runtime symlink swap. Throws scrollback_path_outside_dir
   * if the resolved target falls outside the scrollback dir.
   */
  private async resolveTaskFile(taskId: string): Promise<string> {
    const dir = await this.ensureDirResolved();
    const candidate = path.join(dir, `${taskId}.log`);

    let realCandidate: string;
    try {
      realCandidate = await fsAsync.realpath(candidate);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return candidate;
      throw err;
    }
    const rel = path.relative(dir, realCandidate);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new ScrollbackStoreError(
        "scrollback_path_outside_dir",
        `realpath escape for ${taskId}: ${realCandidate}`,
      );
    }
    return realCandidate;
  }

  /** Idempotent — creates dir + caches resolved path. Throws on dir-creation failure. */
  async ensureDirResolved(): Promise<string> {
    if (this.resolvedDir) return this.resolvedDir;
    await fsAsync.mkdir(this.dir, { recursive: true, mode: this.dirMode });
    this.resolvedDir = await fsAsync.realpath(this.dir);
    return this.resolvedDir;
  }

  private scheduleRotation(taskId: string, st: PerTaskState): void {
    if (st.state !== "NORMAL") return; // already in flight
    st.state = "ROTATING";
    void st.queue.add(() => this.rotateLocked(taskId, st));
  }

  private async rotateLocked(
    taskId: string,
    st: PerTaskState,
  ): Promise<void> {
    try {
      const dir = await this.ensureDirResolved();
      const live = path.join(dir, `${taskId}.log`);
      const archive = path.join(dir, `${taskId}.log.1`);

      // Realpath-at-op-time defeats symlink-swap mid-runtime.
      try {
        const real = await fsAsync.realpath(live);
        const rel = path.relative(dir, real);
        if (rel.startsWith("..") || path.isAbsolute(rel)) {
          throw new ScrollbackStoreError(
            "scrollback_path_outside_dir",
            `realpath escape during rotate for ${taskId}: ${real}`,
          );
        }
      } catch (err) {
        // ENOENT = nothing to rotate (cleared mid-flight). OK.
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }

      // Phase-3 review fix (MEDIUM): unlink any existing `.log.1`
      // BEFORE renaming. fs.rename overwrite semantics differ across
      // Node versions / OSes — explicit unlink makes rotation
      // deterministic + idempotent.
      try {
        await fsAsync.unlink(archive);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          // eslint-disable-next-line no-console
          console.warn(
            `[scrollback] rotate pre-unlink archive failed for ${taskId}: ${(err as Error).message}`,
          );
        }
      }

      try {
        await this.safeRename(live, archive);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          // Rename failed after retries. Don't drop bytes — the
          // rotationBuffer carries data; flush goes to a fresh `.log`.
          // eslint-disable-next-line no-console
          console.warn(
            `[scrollback] rotate rename failed for ${taskId}: ${(err as Error).message}`,
          );
        }
      }

      // Reset size; next write will create a fresh `.log`.
      st.size = 0;

      // State → ROTATION_FLUSH; drain rotationBuffer to fresh `.log`.
      st.state = "ROTATION_FLUSH";
      while (st.rotationBuffer.length > 0) {
        const chunk = st.rotationBuffer.shift()!;
        try {
          fsSync.appendFileSync(this.taskFilePath(taskId), chunk, {
            mode: this.fileMode,
          });
          st.size += chunk.byteLength;
          st.rotationBufferBytes -= chunk.byteLength;
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            `[scrollback] flush after rotate failed for ${taskId}: ${(err as Error).message}`,
          );
          break;
        }
      }
    } finally {
      st.state = "NORMAL";
    }
  }

  private async safeRename(from: string, to: string): Promise<void> {
    let lastErr: NodeJS.ErrnoException | null = null;
    for (let attempt = 0; attempt < this.renameMaxAttempts; attempt++) {
      try {
        await this.renameFn(from, to);
        return;
      } catch (err) {
        lastErr = err as NodeJS.ErrnoException;
        const code = lastErr.code;
        if (code !== "EBUSY" && code !== "EPERM") throw err;
        await new Promise((r) =>
          setTimeout(r, 50 + Math.floor(Math.random() * 50)),
        );
      }
    }
    if (lastErr) throw lastErr;
  }

  private async readLocked(taskId: string): Promise<string> {
    const dir = await this.ensureDirResolved();
    const live = path.join(dir, `${taskId}.log`);
    const archive = path.join(dir, `${taskId}.log.1`);

    let liveBuf: Buffer | null = null;
    let archiveBuf: Buffer | null = null;
    try {
      liveBuf = await fsAsync.readFile(live);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    try {
      archiveBuf = await fsAsync.readFile(archive);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }

    if (!liveBuf && !archiveBuf) return "";

    // AC-1 (iterate-2026-05-05): legacy-file compat. v0.8.0 wrote raw
    // pty bytes to disk, including cursor-control sequences that re-execute
    // on replay and corrupt the rendered scrollback. Re-run the sanitizer
    // here — for v0.8.1+ files it's a near-no-op (already sanitized on
    // append); for v0.8.0 files it strips the corruption-causing bytes.
    const readSanitizer = new ScrollbackSanitizer();
    let cleanArchive: Buffer | null = null;
    let cleanLive: Buffer | null = null;
    if (archiveBuf) {
      cleanArchive = readSanitizer.feed(archiveBuf);
    }
    if (liveBuf) {
      cleanLive = readSanitizer.feed(liveBuf);
    }
    const flush = readSanitizer.flush();

    const decoder = new StringDecoder("utf8");
    let out = "";
    if (cleanArchive) out += decoder.write(cleanArchive);
    if (cleanLive) out += decoder.write(cleanLive);
    if (flush.byteLength > 0) out += decoder.write(flush);
    out += decoder.end();

    // Tail to maxBytesPerTask of UTF-8-encoded length.
    const maxBytes = this.opts.maxBytesPerTask;
    const utf8Buf = Buffer.from(out, "utf8");
    if (utf8Buf.byteLength <= maxBytes) return out;
    const tail = utf8Buf.subarray(utf8Buf.byteLength - maxBytes);
    return new StringDecoder("utf8").end(tail);
  }

  private async clearLocked(
    taskId: string,
    loud: boolean,
  ): Promise<void> {
    let resolvedFile: string;
    try {
      resolvedFile = await this.resolveTaskFile(taskId);
    } catch (err) {
      if (loud) throw err;
      // eslint-disable-next-line no-console
      console.warn(
        `[scrollback] clear best-effort path-resolve failed for ${taskId}: ${(err as Error).message}`,
      );
      return;
    }

    const dir = await this.ensureDirResolved();
    const archive = path.join(dir, `${taskId}.log.1`);

    const operations: Promise<void>[] = [];
    operations.push(
      fsAsync.unlink(resolvedFile).catch((err) => {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
        if (loud) throw err;
        // eslint-disable-next-line no-console
        console.warn(
          `[scrollback] clear .log failed for ${taskId}: ${(err as Error).message}`,
        );
      }),
    );
    operations.push(
      fsAsync.unlink(archive).catch((err) => {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
        if (loud) throw err;
        // eslint-disable-next-line no-console
        console.warn(
          `[scrollback] clear .log.1 failed for ${taskId}: ${(err as Error).message}`,
        );
      }),
    );
    await Promise.all(operations);

    const st = this.states.get(taskId);
    if (st) {
      st.size = 0;
      st.rotationBuffer = [];
      st.rotationBufferBytes = 0;
      st.state = "NORMAL";
      // AC-1: clear() resets the disk file; the sanitizer must
      // forget any in-progress sequence so the next append starts
      // from GROUND state.
      st.sanitizer.reset();
    }
  }
}
