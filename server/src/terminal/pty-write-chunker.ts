/*
 * pty-write-chunker.ts — UTF-8-safe chunking + same-task write serialization
 * for a single pty.write() chokepoint (iterate-2026-09-05-terminal-large-
 * command-chunked-pty-write, FR-01.28).
 *
 * WHY THIS MODULE EXISTS. A task's first launch bakes the full task prompt
 * into the launch command as a `--session-id ... "<prompt>"` argument; a
 * long prompt produces a multi-KB command, auto-typed into the embedded
 * terminal in one shot. `PtyManager.write()` used to forward the whole
 * burst to `entry.pty.write()` in a single call. On macOS, canonical-mode
 * tty input queues (~1 KiB) hold an unterminated line unread until its
 * trailing newline arrives, so one write() bigger than the queue blocks
 * the Node main thread forever waiting for room a blocked event loop can
 * never free — freezing every other session on the same process.
 *
 * This module owns two things that belong together:
 *
 *   1. CHUNKING — `chunkUtf8ForPtyWrite` splits a burst into sub-cap,
 *      UTF-8-safe pieces (never splitting a multi-byte sequence across a
 *      chunk boundary).
 *   2. SERIALIZATION — `ChunkedPtyWriter` spaces those pieces out over
 *      real scheduler ticks so the shell can drain its queue between
 *      writes, and queues (never interleaves) a second same-task write
 *      that arrives while a chunked burst is still draining — a keystroke,
 *      the paste-image path, or a mouse report would otherwise splice
 *      bytes into the middle of the still-draining first burst.
 *
 * Extracted from `pty-manager.ts` (which already carries an ADR-101 bloat
 * exception) as a cohesive split, mirroring `backpressure-telemetry.ts`'s
 * precedent: the concern only ever touches an entry's `pty.write()` call
 * and its own busy/queue bookkeeping, never anything else `PtyManager`
 * owns, so `ChunkedPtyWriteEntry` below is a narrow structural interface
 * rather than a dependency on `PtyEntry` itself.
 *
 * Four review passes hardened this: two HIGH code-review findings (an
 * unclamped chunk size could spin forever; a second same-task write could
 * interleave mid-drain), two doubt-review findings (a mouse report bypassed
 * the same gate; the pending queue had no byte cap), and one external
 * Tier-3 finding (the drain was mutually recursive with `deliverOrChunk`,
 * one stack frame per queued write — a flooding client could overflow the
 * stack and crash the process, the exact failure this module exists to
 * eliminate). Full history: the run-id's ADR.
 */

/** Callback scheduler used to space out chunked pty writes (see `ptyWriteChunkBytes`). */
export type ChunkWriteScheduler = (cb: () => void, delayMs: number) => void;

export const DEFAULT_PTY_WRITE_CHUNK_BYTES = 512;
export const DEFAULT_PTY_WRITE_CHUNK_DELAY_MS = 5;

/**
 * Split `data` into chunks whose UTF-8 byte length is <= maxBytes, never
 * splitting a multi-byte UTF-8 sequence across a chunk boundary. Exported
 * for direct unit coverage.
 */
export function chunkUtf8ForPtyWrite(data: string, maxBytes: number): string[] {
  const buf = Buffer.from(data, "utf8");
  if (buf.length === 0) return [data];
  // Code-review finding (2026-09-05): an unclamped maxBytes <= 0 never lets
  // `start` advance below, spinning the while-loop forever — exactly the
  // "whole main thread blocked" failure this chunking exists to eliminate,
  // just triggered by a bad config value instead of an oversized burst. A
  // UTF-8 code point is at most 4 bytes, so clamping the floor to 4
  // guarantees both termination and that a chunk boundary always has room
  // to land clear of a multi-byte sequence.
  // External-review finding (2026-09-05, Tier-3): Math.max(4, NaN) is NaN,
  // so a non-finite maxBytes (misconfiguration, not just <= 0) must also
  // fall back rather than silently propagate NaN into subarray() below,
  // which would clamp to an empty first chunk and drop the whole write.
  const safeMaxBytes = Math.max(
    4,
    Number.isFinite(maxBytes) ? Math.floor(maxBytes) : DEFAULT_PTY_WRITE_CHUNK_BYTES,
  );
  const chunks: string[] = [];
  let start = 0;
  while (start < buf.length) {
    let end = Math.min(start + safeMaxBytes, buf.length);
    // Back off past continuation bytes (0b10xxxxxx) so a multi-byte UTF-8
    // sequence is never split across a chunk boundary.
    while (end > start && end < buf.length && (buf[end]! & 0xc0) === 0x80) {
      end--;
    }
    if (end === start) {
      // No valid split point within safeMaxBytes — unreachable for
      // well-formed UTF-8 given the >=4 floor above, but fail safe by
      // forcing progress rather than looping forever on malformed input.
      end = Math.min(start + safeMaxBytes, buf.length);
    }
    chunks.push(buf.subarray(start, end).toString("utf8"));
    start = end;
  }
  return chunks;
}

/** Falls back to `fallback` for any non-finite or negative input. */
function normalizeNonNegative(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * The narrow slice of `PtyEntry` this module needs. Kept structural
 * (rather than importing `PtyEntry` itself) so this module has no
 * dependency on `pty-manager.ts` — `PtyEntry` satisfies this shape
 * without any change on its side, and a fresh entry naturally starts
 * with `chunkWriteBusy`/`pendingWrites`/`pendingWritesBytes` unset,
 * which is what makes a respawn's write queue clean by construction.
 */
export interface ChunkedPtyWriteEntry {
  readonly pty: { write(data: string): void };
  /** Set once the underlying pty has been torn down (kill()); no further chunks are delivered. */
  tornDown?: boolean;
  /**
   * True while a chunked write is still draining its remaining chunks over
   * multiple scheduler ticks. A `write()` call that lands while this is set
   * must NOT execute immediately (it would interleave into the middle of
   * the still-draining burst); it queues onto `pendingWrites` instead and
   * is delivered, in order, once the in-flight burst finishes.
   */
  chunkWriteBusy?: boolean;
  /** FIFO of `write()` payloads that arrived while `chunkWriteBusy` was set. */
  pendingWrites?: string[];
  /**
   * Running total of `pendingWrites`' UTF-8 byte length, maintained
   * incrementally on push/shift so the `pendingWriteBytesCap` check is
   * O(1) instead of an O(n) `reduce` per queued write (which made
   * flooding the queue O(n^2) overall).
   */
  pendingWritesBytes?: number;
}

export interface ChunkedPtyWriterOpts {
  /**
   * Max UTF-8 bytes per single `entry.pty.write()` call. Default 512, kept
   * safely under the ~1 KiB canonical-mode tty input queue macOS enforces.
   * Tests lower this to force the chunked path deterministically.
   */
  ptyWriteChunkBytes?: number;
  /** Real-time delay between chunk writes; default 5ms. */
  ptyWriteChunkDelayMs?: number;
  /** Scheduler for the delay between chunk writes. Defaults to setTimeout; tests substitute a synchronous or fake-timer-friendly stub. */
  scheduleChunkWrite?: ChunkWriteScheduler;
  /**
   * Cap (bytes) on a task's `pendingWrites` queue (writes that arrive while
   * a chunked burst is still draining). Mirrors `wsBufferBytes`, the
   * existing cap on the opposite (pty->WS) direction. Default 1 MiB; a
   * write that would push the queue over this is dropped whole (never
   * truncated) with a console.warn — guards a pathological flood, not
   * normal use.
   */
  pendingWriteBytesCap?: number;
}

/** Serializes and, when oversized, chunks writes to a single pty entry. */
export class ChunkedPtyWriter {
  private readonly ptyWriteChunkBytes: number;
  private readonly ptyWriteChunkDelayMs: number;
  private readonly scheduleChunkWrite: ChunkWriteScheduler;
  private readonly pendingWriteBytesCap: number;

  constructor(opts: ChunkedPtyWriterOpts = {}) {
    this.ptyWriteChunkBytes = opts.ptyWriteChunkBytes ?? DEFAULT_PTY_WRITE_CHUNK_BYTES;
    // External-review finding (2026-09-05, Tier-3, non-blocking): a
    // non-finite/negative delay or cap produced "surprising" behavior
    // (setTimeout clamping a bad delay; a NaN cap making every `>` comparison
    // false, so the cap check would never fire and the queue could grow
    // unboundedly). Normalized at construction so a misconfigured option
    // degrades to the documented default instead of silently misbehaving.
    this.ptyWriteChunkDelayMs = normalizeNonNegative(opts.ptyWriteChunkDelayMs, DEFAULT_PTY_WRITE_CHUNK_DELAY_MS);
    // Code-review finding 3: unref so a lone pending chunk-write timer can't
    // hold the process open a beat past graceful shutdown.
    this.scheduleChunkWrite = opts.scheduleChunkWrite ?? ((cb, ms) => { setTimeout(cb, ms).unref?.(); });
    this.pendingWriteBytesCap = normalizeNonNegative(opts.pendingWriteBytesCap, 1_048_576);
  }

  /**
   * Write `data` to `entry`, chunking it if oversized and queuing it
   * (rather than executing immediately) if a chunked write for this same
   * entry is already draining.
   */
  write(entry: ChunkedPtyWriteEntry, data: string): void {
    if (entry.chunkWriteBusy) {
      const queue = (entry.pendingWrites ??= []);
      const queuedBytes = entry.pendingWritesBytes ?? 0;
      const dataBytes = Buffer.byteLength(data, "utf8");
      // Doubt-review finding (2026-09-05): the queue itself must not become
      // an unbounded-memory vector. Failing safe means dropping the NEW
      // write whole (never truncating/corrupting an already-queued item).
      if (queuedBytes + dataBytes > this.pendingWriteBytesCap) {
        // eslint-disable-next-line no-console
        console.warn(
          `[pty-write-chunker] pendingWrites cap exceeded for a chunked write in flight — dropping a queued write (${dataBytes} bytes)`,
        );
        return;
      }
      queue.push(data);
      entry.pendingWritesBytes = queuedBytes + dataBytes;
      return;
    }
    this.deliverOrChunk(entry, data);
  }

  /**
   * External-review finding (2026-09-05, Tier-3, BLOCKING, 2nd pass): a
   * synchronous `scheduleChunkWrite` (a public, injectable option) used to
   * make `writeNext` recurse into itself once per chunk — same stack-depth
   * bug as `drainPendingWrites` above, different call site. Trampoline fix:
   * `step`'s own `for(;;)` loop advances through chunks; a synchronous
   * reentrant call is caught by `running` and just flags "keep going" for
   * that loop, while a genuinely async call finds `running` already false
   * and re-enters fresh, preserving the real event-loop yield.
   */
  private deliverOrChunk(entry: ChunkedPtyWriteEntry, data: string): void {
    if (Buffer.byteLength(data, "utf8") <= this.ptyWriteChunkBytes) {
      entry.pty.write(data);
      this.drainPendingWrites(entry);
      return;
    }
    entry.chunkWriteBusy = true;
    const chunks = chunkUtf8ForPtyWrite(data, this.ptyWriteChunkBytes);
    let i = 0;
    let running = false;
    let scheduledSynchronously = false;
    const step = (): void => {
      if (running) {
        // Reentrant synchronous call from inside scheduleChunkWrite below —
        // do not recurse; tell the in-progress loop to keep going instead.
        scheduledSynchronously = true;
        return;
      }
      running = true;
      try {
        for (;;) {
          // The task may have been closed/killed mid-flight.
          if (entry.tornDown) {
            entry.chunkWriteBusy = false;
            // Doubt-review finding (2026-09-05): any writes still queued
            // behind a torn-down burst are intentionally DROPPED here (not
            // delivered, not logged) — there is nothing left to deliver
            // them to.
            return;
          }
          entry.pty.write(chunks[i]!);
          i++;
          if (i >= chunks.length) {
            entry.chunkWriteBusy = false;
            this.drainPendingWrites(entry);
            return;
          }
          scheduledSynchronously = false;
          this.scheduleChunkWrite(step, this.ptyWriteChunkDelayMs);
          if (!scheduledSynchronously) return; // async scheduler — its own later call continues this
          // else: scheduler invoked step() synchronously (caught by the
          // `running` guard above) — loop again ourselves instead.
        }
      } finally {
        running = false;
      }
    };
    step();
  }

  /**
   * Delivers (or re-chunks) queued writes once the entry is free.
   *
   * External-review finding (2026-09-05, Tier-3, BLOCKING): this used to
   * call `deliverOrChunk`, which for a small write calls straight back into
   * `drainPendingWrites` — mutual recursion with one stack frame per queued
   * write. `pendingWriteBytesCap` bounds bytes, not COUNT, so a client
   * flooding thousands of tiny writes during a burst's drain window could
   * exceed the call stack and crash the whole process with an uncaught
   * `RangeError` — the exact "frozen/dead server" failure this fix exists
   * to eliminate, now reachable via the very flooding scenario the cap was
   * added to guard against. Small queued writes are now delivered directly
   * in an iterative loop (no re-entry into `deliverOrChunk`), so stack depth
   * stays O(1) regardless of queue length. An oversized queued write still
   * hands off to `deliverOrChunk`'s async chunked path (which sets
   * `chunkWriteBusy` and returns after scheduling — not a recursive call),
   * and the loop stops there; that path's own completion calls
   * `drainPendingWrites` again to continue the queue.
   */
  private drainPendingWrites(entry: ChunkedPtyWriteEntry): void {
    while (!entry.chunkWriteBusy) {
      const next = entry.pendingWrites?.shift();
      if (next === undefined) return;
      const nextBytes = Buffer.byteLength(next, "utf8");
      entry.pendingWritesBytes = Math.max(0, (entry.pendingWritesBytes ?? 0) - nextBytes);
      if (nextBytes <= this.ptyWriteChunkBytes) {
        entry.pty.write(next);
        continue;
      }
      this.deliverOrChunk(entry, next);
      return;
    }
  }
}
