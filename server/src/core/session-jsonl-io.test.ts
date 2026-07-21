import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import { readTailFromDisk, type TailFileHandle } from "./session-jsonl-io.js";

/**
 * A scriptable stand-in for a `FileHandle`, so the concurrency and failure
 * shapes that a real filesystem will not reproduce on demand (truncation
 * landing exactly between fstat and read, a short read, a throwing close)
 * become ordinary deterministic tests.
 */
function fakeHandle(opts: {
  sizes: number[];
  read: (buf: Buffer, offset: number, length: number, position: number) => number | Error;
  onClose?: () => void;
}): { handle: TailFileHandle; reads: Array<{ offset: number; length: number; position: number }>; closed: () => number } {
  const reads: Array<{ offset: number; length: number; position: number }> = [];
  let statCall = 0;
  let closes = 0;
  const handle: TailFileHandle = {
    async stat() {
      const s = opts.sizes[Math.min(statCall, opts.sizes.length - 1)];
      statCall++;
      return { size: s };
    },
    async read(buf, offset, length, position) {
      reads.push({ offset, length, position });
      const r = opts.read(buf, offset, length, position);
      if (r instanceof Error) throw r;
      return { bytesRead: r };
    },
    async close() {
      closes++;
      opts.onClose?.();
    },
  };
  return { handle, reads, closed: () => closes };
}

describe("readTailFromDisk — positional read over real files", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "jsonl-io-"));
  });
  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function seed(name: string, content: string): string {
    const fp = path.join(dir, name);
    writeFileSync(fp, content);
    return fp;
  }

  it("fromByte 0 returns the whole file", async () => {
    const fp = seed("a.jsonl", "line-a\nline-b\n");
    const r = await readTailFromDisk(fp, 0);
    expect(r.bytes.toString("utf-8")).toBe("line-a\nline-b\n");
    expect(r.size).toBe(14);
  });

  it("returns exactly [fromByte, EOF)", async () => {
    const fp = seed("b.jsonl", "line-a\nline-b\n");
    const r = await readTailFromDisk(fp, 7);
    expect(r.bytes.toString("utf-8")).toBe("line-b\n");
    expect(r.size).toBe(14);
  });

  it("clamps a fromByte past EOF to an empty read", async () => {
    const fp = seed("c.jsonl", "short\n");
    const r = await readTailFromDisk(fp, 5000);
    expect(r.bytes.length).toBe(0);
    expect(r.size).toBe(6);
  });

  it("clamps a negative fromByte to 0", async () => {
    const fp = seed("d.jsonl", "xy\n");
    const r = await readTailFromDisk(fp, -10);
    expect(r.bytes.toString("utf-8")).toBe("xy\n");
  });

  it("handles an empty file", async () => {
    const fp = seed("e.jsonl", "");
    const r = await readTailFromDisk(fp, 0);
    expect(r.bytes.length).toBe(0);
    expect(r.size).toBe(0);
  });

  /*
   * AC-1, at the REAL filesystem boundary. The external plan review (openai,
   * medium) correctly objected that a watcher-level `readTail` spy proves only
   * that the intended offset was PASSED — an injected fake can return any
   * buffer it likes without a positional read ever happening. So wrap a genuine
   * FileHandle and record what `read()` is actually asked for: this is the test
   * that would fail if someone reintroduced a whole-file read behind the same
   * signature.
   */
  it("issues a positional read of only (size - fromByte) bytes — never the whole file", async () => {
    const body = "x".repeat(1_000_000) + "\n";
    const fp = seed("big.jsonl", body);
    const recorded: Array<{ length: number; position: number }> = [];
    const r = await readTailFromDisk(fp, 900_000, async (p) => {
      const fh = await open(p, "r");
      return {
        stat: () => fh.stat(),
        read: async (buf, offset, length, position) => {
          recorded.push({ length, position });
          return fh.read(buf, offset, length, position);
        },
        close: () => fh.close(),
      };
    });
    expect(r.size).toBe(1_000_001);
    expect(r.bytes.length).toBe(100_001);
    expect(recorded[0].position).toBe(900_000);
    // The decisive assertion: bytes REQUESTED are bounded by the tail, not the file.
    const requested = recorded.reduce((s, c) => s + c.length, 0);
    expect(requested).toBe(100_001);
    expect(requested).toBeLessThan(1_000_001);
  });
});

describe("readTailFromDisk — concurrency + failure shapes", () => {
  it("fills the buffer across a short read instead of truncating the tail", async () => {
    // Kernel hands back one byte at a time; the loop must still assemble [10, 20).
    const source = Buffer.from("0123456789abcdefghij");
    const { handle, reads } = fakeHandle({
      sizes: [20],
      read: (buf, offset, _length, position) => {
        if (position >= source.length) return 0;
        buf[offset] = source[position];
        return 1;
      },
    });
    const r = await readTailFromDisk("/x", 10, async () => handle);
    expect(r.bytes.toString("utf-8")).toBe("abcdefghij");
    expect(r.size).toBe(20);
    expect(reads.length).toBe(10); // proves the fill loop ran, not one big read
  });

  /*
   * External plan review finding 1 (HIGH), raised independently by BOTH
   * reviewers. If the file is truncated between fstat and read, returning the
   * PRE-read size makes the caller clamp `fromByte` against a size that no
   * longer exists — where the old whole-file reader clamped against the bytes
   * it actually obtained. Re-stat on the short-read path restores that.
   */
  it("re-stats after a short read so the caller clamps against the post-truncation size", async () => {
    const { handle } = fakeHandle({
      sizes: [100, 50], // fstat says 100; by the time we read, it is 50
      read: () => 0, // reading at 75 is past the new EOF
    });
    const r = await readTailFromDisk("/x", 75, async () => handle);
    expect(r.bytes.length).toBe(0);
    expect(r.size).toBe(50); // NOT 100 — this is the whole point
  });

  /*
   * The SAME race, but with bytes already in hand — the half the first fix
   * missed, caught independently by the internal reviewer and the external
   * openai pass. Returning `size: effective` makes the caller clamp `from`
   * DOWN; bytes read at `start` would then be handed back under an offset they
   * never occupied, and the caller's cursor would jump past live content.
   */
  it("drops bytes that the post-truncation size can no longer address", async () => {
    let call = 0;
    const { handle } = fakeHandle({
      sizes: [1000, 200], // truncated to 200 while we were reading at 900
      read: (buf, offset) => {
        call++;
        if (call > 1) return 0;
        buf.fill(0x61, offset, offset + 50);
        return 50; // 50 bytes that live at file offset 900
      },
    });
    const r = await readTailFromDisk("/x", 900, async () => handle);
    expect(r.size).toBe(200);
    // 900 is past the new EOF entirely, so nothing is addressable.
    expect(r.bytes.length).toBe(0);
  });

  it("caps a partial read at the post-truncation end instead of over-delivering", async () => {
    let call = 0;
    const { handle } = fakeHandle({
      sizes: [1000, 300], // truncated to 300 mid-read
      read: (buf, offset) => {
        call++;
        if (call > 1) return 0;
        buf.fill(0x62, offset, offset + 500);
        return 500; // bytes at file offsets 100..600
      },
    });
    const r = await readTailFromDisk("/x", 100, async () => handle);
    expect(r.size).toBe(300);
    // Only [100, 300) survives the truncation — exactly what a whole-file read
    // of the 300-byte file, sliced at 100, would have yielded.
    expect(r.bytes.length).toBe(200);
  });

  it("never reports a size larger than the one the read observed", async () => {
    const { handle } = fakeHandle({
      sizes: [100, 400], // a re-stat that grew must not inflate the clamp
      read: () => 0,
    });
    const r = await readTailFromDisk("/x", 50, async () => handle);
    expect(r.size).toBe(100);
  });

  it("closes the handle when the read throws (no descriptor leak)", async () => {
    const { handle, closed } = fakeHandle({
      sizes: [10],
      read: () => Object.assign(new Error("boom"), { code: "EIO" }),
    });
    await expect(readTailFromDisk("/x", 0, async () => handle)).rejects.toThrow("boom");
    expect(closed()).toBe(1);
  });

  it("closes the handle when fstat throws", async () => {
    let closes = 0;
    const handle: TailFileHandle = {
      stat: async () => { throw Object.assign(new Error("stat-boom"), { code: "EIO" }); },
      read: async () => ({ bytesRead: 0 }),
      close: async () => { closes++; },
    };
    await expect(readTailFromDisk("/x", 0, async () => handle)).rejects.toThrow("stat-boom");
    expect(closes).toBe(1);
  });

  /*
   * External plan review finding 5 (LOW). A throwing close() must not replace
   * the real I/O error: `readWithRetry` classifies on `err.code`, so a close
   * failure surfacing instead of the read failure would change RETRY behavior,
   * not merely the message.
   */
  it("propagates the READ error, not a close() failure, when both fail", async () => {
    const handle: TailFileHandle = {
      stat: async () => ({ size: 10 }),
      read: async () => { throw Object.assign(new Error("read-failed"), { code: "EBUSY" }); },
      close: async () => { throw Object.assign(new Error("close-failed"), { code: "EPERM" }); },
    };
    await expect(readTailFromDisk("/x", 0, async () => handle)).rejects.toThrow("read-failed");
  });

  it("does not fail a successful read because close() threw", async () => {
    const source = Buffer.from("ok\n");
    const handle: TailFileHandle = {
      stat: async () => ({ size: 3 }),
      read: async (buf, offset, length, position) => {
        source.copy(buf, offset, position, position + length);
        return { bytesRead: Math.min(length, source.length - position) };
      },
      close: async () => { throw new Error("close-failed"); },
    };
    const r = await readTailFromDisk("/x", 0, async () => handle);
    expect(r.bytes.toString("utf-8")).toBe("ok\n");
  });

  it("does not read at all when fromByte is already at EOF", async () => {
    const { handle, reads } = fakeHandle({ sizes: [42], read: () => 0 });
    const r = await readTailFromDisk("/x", 42, async () => handle);
    expect(r.bytes.length).toBe(0);
    expect(r.size).toBe(42);
    expect(reads.length).toBe(0);
  });
});

// `readWithRetry` + `lastIndexOfByte` are covered in session-jsonl-retry.test.ts.
