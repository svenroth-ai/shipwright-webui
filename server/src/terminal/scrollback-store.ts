/*
 * scrollback-store.ts — disk-backed terminal scrollback (iterate-2026-05-04, ADR-068-A1).
 *
 * Per-task append-only file at `<scrollbackDir>/<taskId>.log` (rotated to
 * `.log.1` at `maxBytesPerTask`). Read-back combines both files via
 * StringDecoder so multi-byte UTF-8 split across the rotation boundary
 * round-trips cleanly.
 *
 * Iterate C (ADR-087, 2026-05-12): the chunked-replay path that used
 * to consume `read()` (via the now-deleted `readForReplay()` accessor)
 * is RETIRED. Cell-state snapshots (snapshot-store + @xterm/headless
 * mirror, ADR-088/089) are the sole replay primitive. This module
 * remains for two surviving consumers:
 *   - `bytes()` — surfaced in the WS `ready` envelope `scrollbackBytes`
 *     field so the privacy-disclosure footer can render.
 *   - `clear()` / `clearBestEffort()` — user-clear button + DELETE
 *     cascade still wipe the disk file even though it has no replay
 *     consumer (privacy contract).
 *
 * The sanitizer + replay-time PowerShell-boilerplate collapse (formerly
 * ADR-069 / ADR-077 compensations) are GONE. Disk content is now raw
 * pty bytes; consumers reading via `read()` get those bytes verbatim.
 * No production code path currently calls `read()` post-Iterate-C.
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
  /** Hook for tests to control readdir order in sweepExpired. */
  readdirFn?: (dir: string) => Promise<string[]>;
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
  private readonly readdirFn: (dir: string) => Promise<string[]>;
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
    this.readdirFn = opts.readdirFn ?? ((d) => fsAsync.readdir(d));
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

    // Iterate C (ADR-087): the ADR-069 sanitizer has been retired. Disk
    // content is now raw pty bytes — the cell-state snapshot store
    // (ADR-088/089) is the sole replay primitive, and snapshots are
    // produced by @xterm/headless from the live byte stream regardless
    // of what the disk file holds. `read()` still returns these raw
    // bytes verbatim for any diagnostic consumer.

    // Rotation in flight → buffer (NEVER drop chunks; ANSI/UTF-8 corruption).
    if (st.state !== "NORMAL") {
      this.bufferDuringRotation(taskId, st, data);
      return true;
    }

    try {
      fsSync.appendFileSync(this.taskFilePath(taskId), data, {
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

    st.size += data.byteLength;

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
      entries = await this.readdirFn(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return result;
      throw err;
    }

    // Phase-3 fix (MEDIUM): group by task so `.log` + `.log.1` count as
    // ONE deletion unit against maxFilesPerPass. D16 (F25): TWO-PASS —
    // bucket every file by taskId (flag if ANY is fresh), then unlink only
    // all-expired groups. The old single-pass form mutated the map in
    // readdir order, so a fresh `.log` before an expired `.log.1` deleted it.
    interface TaskGroup {
      taskId: string;
      files: string[];
      newestMtime: number;
      hasFresh: boolean;
    }
    const groupsById = new Map<string, TaskGroup>();
    for (const name of entries) {
      const m = name.match(/^([0-9a-fA-F-]{36})\.log(?:\.1)?$/);
      if (!m) continue;
      const taskId = m[1];
      if (sweepOpts.activeTaskIds.has(taskId)) continue;
      try {
        const mtimeMs = (await fsAsync.stat(path.join(dir, name))).mtimeMs;
        const fresh = mtimeMs >= cutoffMs;
        const g = groupsById.get(taskId);
        if (g) {
          g.files.push(name);
          g.newestMtime = Math.max(g.newestMtime, mtimeMs);
          g.hasFresh = g.hasFresh || fresh;
        } else {
          groupsById.set(taskId, {
            taskId,
            files: [name],
            newestMtime: mtimeMs,
            hasFresh: fresh,
          });
        }
      } catch {
        result.errors++;
      }
    }

    // Any fresh file vetoes the whole task; survivors oldest-first (TTL).
    const groups = [...groupsById.values()]
      .filter((g) => !g.hasFresh)
      .sort((a, b) => a.newestMtime - b.newestMtime);

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

    // Iterate C (ADR-087) — the ADR-069 sanitizer is RETIRED. We return
    // the raw bytes verbatim. UTF-8 decode is still done via
    // StringDecoder so multi-byte codepoints split across the rotation
    // boundary round-trip cleanly.
    const decoder = new StringDecoder("utf8");
    let out = "";
    if (archiveBuf) out += decoder.write(archiveBuf);
    if (liveBuf) out += decoder.write(liveBuf);
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
    }
  }
}
