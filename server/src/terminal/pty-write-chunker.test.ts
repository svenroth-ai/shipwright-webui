/*
 * pty-write-chunker.test.ts — unit tests for chunkUtf8ForPtyWrite +
 * ChunkedPtyWriter, extracted from pty-manager.test.ts as a cohesive split
 * alongside pty-write-chunker.ts (iterate-2026-09-05-terminal-large-command-
 * chunked-pty-write). These exercise the chunker directly against a fake
 * pty-write sink — no PtyManager/spawn harness needed. The PtyManager-level
 * wiring tests (writeMouseReport shares the same writer; kill()/respawn
 * lifecycle interacts correctly with it) stay in pty-manager.test.ts.
 */

import { describe, expect, it, vi } from "vitest";
import {
  chunkUtf8ForPtyWrite,
  ChunkedPtyWriter,
  type ChunkedPtyWriteEntry,
} from "./pty-write-chunker.js";

function makeEntry(): { entry: ChunkedPtyWriteEntry; writes: string[] } {
  const writes: string[] = [];
  const entry: ChunkedPtyWriteEntry = {
    pty: { write: (data: string) => writes.push(data) },
  };
  return { entry, writes };
}

describe("chunkUtf8ForPtyWrite", () => {
  it("returns the whole string as one chunk when under the byte cap", () => {
    expect(chunkUtf8ForPtyWrite("ls\n", 512)).toEqual(["ls\n"]);
  });

  it("splits an oversized ASCII string into chunks no larger than the cap", () => {
    const data = "a".repeat(1300);
    const chunks = chunkUtf8ForPtyWrite(data, 512);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(Buffer.byteLength(c, "utf8")).toBeLessThanOrEqual(512);
    expect(chunks.join("")).toBe(data);
  });

  it("never splits a multi-byte UTF-8 sequence across a chunk boundary", () => {
    // "€" is 3 bytes (E2 82 AC) in UTF-8 — pad so a naive byte-index split
    // would land mid-sequence at the chunk boundary.
    const data = "a".repeat(9) + "€" + "b".repeat(9);
    const chunks = chunkUtf8ForPtyWrite(data, 10);
    // Round-tripping through Buffer.from(chunk, "utf8") must reproduce the
    // original text exactly — a split mid-sequence would corrupt it into
    // replacement characters instead.
    expect(chunks.join("")).toBe(data);
    for (const c of chunks) {
      expect(Buffer.byteLength(c, "utf8")).toBeLessThanOrEqual(10);
    }
  });

  // Code-review finding 1 (2026-09-05): an unclamped maxBytes <= 0 never let
  // `start` advance, spinning the while-loop forever — exactly the "whole
  // main thread blocked" failure this helper exists to eliminate. These
  // cases terminate (the surrounding `it` would time out otherwise) and
  // still round-trip exactly.
  it.each([0, -5, 1, 2, 3])("terminates and round-trips exactly when maxBytes=%d (clamped to a 4-byte floor)", (maxBytes) => {
    const data = "a".repeat(9) + "€" + "b".repeat(9);
    const chunks = chunkUtf8ForPtyWrite(data, maxBytes);
    expect(chunks.join("")).toBe(data);
    for (const c of chunks) {
      expect(Buffer.byteLength(c, "utf8")).toBeLessThanOrEqual(4);
      expect(Buffer.byteLength(c, "utf8")).toBeGreaterThan(0);
    }
  });
});

describe("ChunkedPtyWriter", () => {
  // @covers FR-01.28
  it("an oversized single-burst write (repro: 6 KB launch command) is split into sub-cap chunks, none of which individually exceeds the cap", () => {
    const scheduled: Array<() => void> = [];
    const writer = new ChunkedPtyWriter({
      ptyWriteChunkBytes: 512,
      scheduleChunkWrite: (cb) => scheduled.push(cb),
    });
    const { entry, writes } = makeEntry();
    const command = `claude --session-id abc "${"x".repeat(6000)}"\r`;
    writer.write(entry, command);

    // First chunk is written synchronously; the rest wait on the injected
    // scheduler — proving the whole burst is NOT written in one atomic call.
    expect(writes.length).toBe(1);
    expect(scheduled.length).toBe(1);

    while (scheduled.length > 0) {
      const next = scheduled.shift()!;
      next();
    }

    expect(writes.length).toBeGreaterThan(10); // 6KB / 512B ≈ 12 chunks
    for (const w of writes) {
      expect(Buffer.byteLength(w, "utf8")).toBeLessThanOrEqual(512);
    }
    expect(writes.join("")).toBe(command);
  });

  // @covers FR-01.28
  it("the default scheduler yields real event-loop turns between chunks (does not write the whole burst in one microtask)", () => {
    vi.useFakeTimers();
    try {
      const writer = new ChunkedPtyWriter({ ptyWriteChunkBytes: 512 });
      const { entry, writes } = makeEntry();
      writer.write(entry, "y".repeat(2000));

      // Only the first chunk should have landed before any timer fires.
      expect(writes.length).toBe(1);

      vi.advanceTimersByTime(5);
      expect(writes.length).toBe(2);

      vi.runAllTimers();
      expect(writes.length).toBe(4); // ceil(2000/512)
      expect(writes.join("")).toBe("y".repeat(2000));
    } finally {
      vi.useRealTimers();
    }
  });

  // Code-review finding 2 (2026-09-05): a second write() for the same task
  // arriving mid-drain (e.g. a keystroke, or the paste-image insertion)
  // must NOT interleave into the still-draining first burst — it queues
  // and is delivered only once the in-flight burst fully drains.
  it("a write arriving mid-drain is queued, not interleaved, behind the in-flight chunked write", () => {
    const scheduled: Array<() => void> = [];
    const writer = new ChunkedPtyWriter({
      ptyWriteChunkBytes: 512,
      scheduleChunkWrite: (cb) => scheduled.push(cb),
    });
    const { entry, writes } = makeEntry();
    const firstBurst = "x".repeat(2000); // 4 chunks at 512B
    writer.write(entry, firstBurst);
    expect(writes.length).toBe(1);
    expect(scheduled.length).toBe(1);

    // A keystroke lands while the first burst is still mid-drain.
    writer.write(entry, "y");
    // Must NOT land immediately — that would interleave it into the burst.
    expect(writes.length).toBe(1);
    expect(scheduled.length).toBe(1);

    while (scheduled.length > 0) {
      const next = scheduled.shift()!;
      next();
    }

    // The queued keystroke is delivered LAST, as its own write call — never
    // spliced into the middle of the burst's chunks.
    expect(writes[writes.length - 1]).toBe("y");
    expect(writes.slice(0, -1).join("")).toBe(firstBurst);
  });

  // Same guard, but the queued write is itself oversized — proves the
  // queue re-chunks a queued burst rather than only handling small ones.
  it("a second oversized write queued mid-drain is itself chunked once its turn comes", () => {
    const scheduled: Array<() => void> = [];
    const writer = new ChunkedPtyWriter({
      ptyWriteChunkBytes: 512,
      scheduleChunkWrite: (cb) => scheduled.push(cb),
    });
    const { entry, writes } = makeEntry();
    const firstBurst = "x".repeat(1000);
    const secondBurst = "y".repeat(1000);
    writer.write(entry, firstBurst);
    writer.write(entry, secondBurst);

    while (scheduled.length > 0) {
      const next = scheduled.shift()!;
      next();
    }

    expect(writes.join("")).toBe(firstBurst + secondBurst);
    for (const w of writes) expect(Buffer.byteLength(w, "utf8")).toBeLessThanOrEqual(512);
  });

  // Doubt-review finding (2026-09-05): pendingWrites must not grow without
  // bound under a flooding/buggy client — the new write is dropped whole
  // (never truncated/corrupted) once the cap is exceeded.
  it("a write that would exceed the pendingWrites byte cap is dropped whole, without corrupting the already-queued writes", () => {
    const scheduled: Array<() => void> = [];
    const writer = new ChunkedPtyWriter({
      ptyWriteChunkBytes: 512,
      pendingWriteBytesCap: 100,
      scheduleChunkWrite: (cb) => scheduled.push(cb),
    });
    const { entry, writes } = makeEntry();
    writer.write(entry, "x".repeat(1000)); // starts draining, chunkWriteBusy = true
    writer.write(entry, "y".repeat(50)); // queued: 50 bytes, under the 100-byte cap
    writer.write(entry, "z".repeat(80)); // would push the queue to 130 bytes — dropped

    while (scheduled.length > 0) {
      const next = scheduled.shift()!;
      next();
    }

    const joined = writes.join("");
    expect(joined).toContain("y".repeat(50));
    expect(joined).not.toContain("z");
  });

  // External-review finding (2026-09-05, Tier-3, BLOCKING): draining a large
  // queue of small writes used to recurse one stack frame per queued write
  // (deliverOrChunk -> drainPendingWrites -> deliverOrChunk -> ...), so a
  // client flooding tiny writes during a burst's ~60ms drain window could
  // blow the call stack and crash the whole process — the exact "frozen/
  // dead server" failure this fix exists to eliminate. Draining is now an
  // iterative loop; this proves a very large queue drains without throwing
  // and preserves delivery order.
  it("draining a very large queue of small writes does not overflow the stack, and preserves delivery order", () => {
    const scheduled: Array<() => void> = [];
    const writer = new ChunkedPtyWriter({
      ptyWriteChunkBytes: 512,
      pendingWriteBytesCap: 10_000_000,
      scheduleChunkWrite: (cb) => scheduled.push(cb),
    });
    const { entry, writes } = makeEntry();
    writer.write(entry, "x".repeat(1000)); // starts draining, chunkWriteBusy = true

    const QUEUED = 20_000;
    for (let i = 0; i < QUEUED; i++) {
      writer.write(entry, `${i}\n`);
    }

    expect(() => {
      while (scheduled.length > 0) {
        const next = scheduled.shift()!;
        next();
      }
    }).not.toThrow();

    // The 1000-byte burst chunks, followed by every queued write, in order.
    const tail = writes.slice(-QUEUED);
    expect(tail.join("")).toBe(
      Array.from({ length: QUEUED }, (_, i) => `${i}\n`).join(""),
    );
  });

  // External-review finding (2026-09-05, Tier-3, BLOCKING, 2nd pass): a
  // synchronous scheduleChunkWrite used to make the chunk-delivery loop call
  // itself directly, one stack frame per chunk — a large enough payload
  // would overflow the call stack. The trampoline fix keeps the loop in the
  // ORIGINAL call frame regardless of whether the scheduler is sync or
  // async; this proves a synchronous scheduler with many chunks neither
  // throws nor recurses, and still delivers every byte in order.
  it("a synchronous scheduler chunking a very large payload does not overflow the stack", () => {
    const writer = new ChunkedPtyWriter({
      ptyWriteChunkBytes: 16,
      scheduleChunkWrite: (cb) => cb(), // fires synchronously, no deferral
    });
    const { entry, writes } = makeEntry();
    const data = "z".repeat(200_000); // 200,000 / 16 = 12,500 chunks

    expect(() => writer.write(entry, data)).not.toThrow();
    expect(writes.join("")).toBe(data);
    for (const w of writes) expect(Buffer.byteLength(w, "utf8")).toBeLessThanOrEqual(16);
  });
});
