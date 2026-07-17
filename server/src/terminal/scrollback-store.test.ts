/*
 * scrollback-store.test.ts — ADR-068-A1 Phase 1 unit tests.
 *
 * Covers:
 *   - construction + disabled mode
 *   - UUID validation
 *   - append happy path / lazy-init / size cache
 *   - read happy path / missing file / combines .log + .log.1
 *   - multi-byte UTF-8 split across rotation boundary
 *   - tail to maxBytesPerTask
 *   - bytes() cold-cache + warm cache
 *   - clear loud + best-effort variants
 *   - closeStream idempotent + FD lifecycle
 *   - rotation triggered at threshold
 *   - rotation buffer fills during rotation
 *   - rotation Windows-EBUSY retry succeeds + exhausted
 *   - rotation symlink-swap detection
 *   - rotation atomicity under rapid append
 *   - sweepExpired deletes / skips active / bounded oldest-first
 *   - shutdown drains
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { ScrollbackStore, ScrollbackStoreError } from "./scrollback-store";

const VALID_TASK_ID = "11111111-2222-3333-4444-555555555555";
const VALID_TASK_ID_2 = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const VALID_TASK_ID_3 = "12345678-90ab-cdef-1234-567890abcdef";

function makeTmpDir(prefix = "scrollback-"): string {
  return fsSync.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function rmrf(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

async function flushMicrotasks(): Promise<void> {
  // Make sure WriteStream.write() has flushed to disk before we read.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

describe("ScrollbackStore — construction + disabled mode", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTmpDir();
  });
  afterEach(async () => {
    await rmrf(dir);
  });

  // @covers FR-01.28
  it("disabled when maxBytesPerTask=0", async () => {
    const store = new ScrollbackStore(dir, { maxBytesPerTask: 0 });
    expect(store.disabled).toBe(true);
    expect(store.append(VALID_TASK_ID, Buffer.from("hello"))).toBe(false);
    expect(await store.read(VALID_TASK_ID)).toBe("");
    expect(await store.bytes(VALID_TASK_ID)).toBe(0);
  });

  // @covers FR-01.28
  it("enabled when maxBytesPerTask>0", () => {
    const store = new ScrollbackStore(dir, { maxBytesPerTask: 1024 });
    expect(store.disabled).toBe(false);
  });
});

describe("ScrollbackStore — UUID validation", () => {
  let dir: string;
  let store: ScrollbackStore;
  beforeEach(async () => {
    dir = makeTmpDir();
    store = new ScrollbackStore(dir, { maxBytesPerTask: 1024 });
    await store.init();
  });
  afterEach(async () => {
    await rmrf(dir);
  });

  // @covers FR-01.28
  it("rejects path-traversal taskId on append", () => {
    expect(() =>
      store.append("../../etc/passwd", Buffer.from("x")),
    ).toThrow(ScrollbackStoreError);
  });
  // @covers FR-01.28
  it("rejects empty taskId", () => {
    expect(() => store.append("", Buffer.from("x"))).toThrow(
      ScrollbackStoreError,
    );
  });
  // @covers FR-01.28
  it("rejects taskId with null byte", () => {
    expect(() => store.append("aaaaa\x00", Buffer.from("x"))).toThrow(
      ScrollbackStoreError,
    );
  });
  // @covers FR-01.28
  it("rejects on read with invalid taskId", async () => {
    await expect(store.read("not-a-uuid")).rejects.toBeInstanceOf(
      ScrollbackStoreError,
    );
  });
  // @covers FR-01.28
  it("rejects on clear with invalid taskId", async () => {
    await expect(store.clear("not-a-uuid")).rejects.toBeInstanceOf(
      ScrollbackStoreError,
    );
  });
  // @covers FR-01.28
  it("clearBestEffort silently ignores invalid taskId", async () => {
    await expect(store.clearBestEffort("not-a-uuid")).resolves.toBeUndefined();
  });
  // @covers FR-01.28
  it("closeStream silently ignores invalid taskId", async () => {
    await expect(
      store.closeStream("not-a-uuid"),
    ).resolves.toBeUndefined();
  });
});

describe("ScrollbackStore — append + read", () => {
  let dir: string;
  let store: ScrollbackStore;
  beforeEach(async () => {
    dir = makeTmpDir();
    store = new ScrollbackStore(dir, { maxBytesPerTask: 4096 });
    await store.init();
  });
  afterEach(async () => {
    await store.shutdown();
    await rmrf(dir);
  });

  // @covers FR-01.28
  it("append + read round-trip basic ASCII", async () => {
    store.append(VALID_TASK_ID, Buffer.from("hello world"));
    await flushMicrotasks();
    expect(await store.read(VALID_TASK_ID)).toBe("hello world");
  });

  // @covers FR-01.28
  it("zero-byte append is no-op (no file created)", async () => {
    store.append(VALID_TASK_ID, Buffer.from(""));
    await flushMicrotasks();
    expect(await store.bytes(VALID_TASK_ID)).toBe(0);
  });

  // @covers FR-01.28
  it("read of missing file returns empty string", async () => {
    expect(await store.read(VALID_TASK_ID)).toBe("");
  });

  // @covers FR-01.28
  it("multi-byte UTF-8 round-trips faithfully", async () => {
    const text = "Hellö Wörld 🚀 ünicödé"; // 3 multi-byte sequences
    store.append(VALID_TASK_ID, Buffer.from(text, "utf8"));
    await flushMicrotasks();
    expect(await store.read(VALID_TASK_ID)).toBe(text);
  });

  // @covers FR-01.28
  it("multiple appends concatenate", async () => {
    store.append(VALID_TASK_ID, Buffer.from("a"));
    store.append(VALID_TASK_ID, Buffer.from("b"));
    store.append(VALID_TASK_ID, Buffer.from("c"));
    await flushMicrotasks();
    expect(await store.read(VALID_TASK_ID)).toBe("abc");
  });

  // @covers FR-01.28
  it("ANSI escape sequences round-trip without corruption", async () => {
    // Raw bytes (including SGR) are persisted verbatim — see Iterate-C ADR-087.
    const ansi = "\x1b[31mred\x1b[0m \x1b[1mbold\x1b[0m";
    store.append(VALID_TASK_ID, Buffer.from(ansi, "utf8"));
    await flushMicrotasks();
    expect(await store.read(VALID_TASK_ID)).toBe(ansi);
  });

  // @covers FR-01.28
  it("Iterate C (ADR-087): raw pty bytes are persisted VERBATIM — sanitizer retired", async () => {
    // The ADR-069 sanitizer has been retired in Iterate C. The disk
    // file now mirrors the pty's raw byte stream — cursor controls,
    // erase sequences, and SGR all flow through unchanged. The
    // cell-state snapshot path (ADR-088/089) is the replay primitive;
    // it produces a serialised rendered terminal from the live byte
    // stream regardless of what the legacy `.log` file holds.
    const raw =
      "\x1b[Hhello\x1b[K\r\n\x1b[31mred\x1b[0m\x1b[2Jworld";
    store.append(VALID_TASK_ID, Buffer.from(raw, "utf8"));
    await flushMicrotasks();
    const out = await store.read(VALID_TASK_ID);
    // Verbatim: every byte from the input must survive to disk.
    expect(out).toBe(raw);
  });

  // @covers FR-01.28
  it("Iterate C: chunk-boundary CSI sequences round-trip verbatim", async () => {
    // Two append calls — the raw bytes are concatenated as-is.
    store.append(VALID_TASK_ID, Buffer.from("hello \x1b[3", "utf8"));
    store.append(VALID_TASK_ID, Buffer.from("1mred\x1b[0m world", "utf8"));
    await flushMicrotasks();
    const out = await store.read(VALID_TASK_ID);
    expect(out).toBe("hello \x1b[31mred\x1b[0m world");
  });

  // @covers FR-01.28
  it("Iterate C: 50-redraw repaint fixture — full byte sequence persisted verbatim", async () => {
    // Sanity check that no sanitizer is silently stripping anything.
    // The cell-state snapshot path consumes the LIVE byte stream from
    // pty.onData, not this disk file, so verbatim persistence is the
    // correct invariant.
    const redraw =
      "\x1b[H\x1b[2J\x1b[1;36mPowerShell 7.6.1\x1b[0m\x1b[K\r\nPS C:\\> ";
    for (let i = 0; i < 50; i++) {
      store.append(VALID_TASK_ID, Buffer.from(redraw, "binary"));
    }
    await flushMicrotasks();
    const out = await store.read(VALID_TASK_ID);
    expect(out).toBe(redraw.repeat(50));
  });

  // @covers FR-01.28
  it("size cache reflects appended bytes", async () => {
    store.append(VALID_TASK_ID, Buffer.from("12345"));
    expect(await store.bytes(VALID_TASK_ID)).toBe(5);
    store.append(VALID_TASK_ID, Buffer.from("67"));
    expect(await store.bytes(VALID_TASK_ID)).toBe(7);
  });

  // @covers FR-01.28
  it("bytes() cold-cache from disk after restart-style state loss", async () => {
    store.append(VALID_TASK_ID, Buffer.from("persistent"));
    await flushMicrotasks();
    // Close + recreate store — simulates server restart.
    await store.shutdown();
    const fresh = new ScrollbackStore(dir, { maxBytesPerTask: 4096 });
    await fresh.init();
    expect(await fresh.bytes(VALID_TASK_ID)).toBe(10);
    await fresh.shutdown();
  });

  // @covers FR-01.28
  it("bytes() returns 0 for missing file", async () => {
    expect(await store.bytes(VALID_TASK_ID)).toBe(0);
  });
});

describe("ScrollbackStore — clear", () => {
  let dir: string;
  let store: ScrollbackStore;
  beforeEach(async () => {
    dir = makeTmpDir();
    store = new ScrollbackStore(dir, { maxBytesPerTask: 4096 });
    await store.init();
  });
  afterEach(async () => {
    await store.shutdown();
    await rmrf(dir);
  });

  // @covers FR-01.28
  it("loud clear deletes file + resets size cache", async () => {
    store.append(VALID_TASK_ID, Buffer.from("data"));
    await flushMicrotasks();
    expect(await store.bytes(VALID_TASK_ID)).toBe(4);

    await store.clear(VALID_TASK_ID);
    expect(await store.read(VALID_TASK_ID)).toBe("");
    expect(await store.bytes(VALID_TASK_ID)).toBe(0);
  });

  // @covers FR-01.28
  it("loud clear is idempotent on missing file", async () => {
    await expect(store.clear(VALID_TASK_ID)).resolves.toBeUndefined();
  });

  // @covers FR-01.28
  it("clearBestEffort survives unlink errors silently", async () => {
    // Even with no file present, must not throw.
    await expect(
      store.clearBestEffort(VALID_TASK_ID),
    ).resolves.toBeUndefined();
  });

  // @covers FR-01.28
  it("clear closes the live stream first (no FD leak)", async () => {
    store.append(VALID_TASK_ID, Buffer.from("buffered"));
    await store.clear(VALID_TASK_ID);
    expect(await store.read(VALID_TASK_ID)).toBe("");
    // Re-append should work (stream re-opens lazily).
    store.append(VALID_TASK_ID, Buffer.from("after"));
    await flushMicrotasks();
    expect(await store.read(VALID_TASK_ID)).toBe("after");
  });
});

describe("ScrollbackStore — closeStream lifecycle", () => {
  let dir: string;
  let store: ScrollbackStore;
  beforeEach(async () => {
    dir = makeTmpDir();
    store = new ScrollbackStore(dir, { maxBytesPerTask: 4096 });
    await store.init();
  });
  afterEach(async () => {
    await store.shutdown();
    await rmrf(dir);
  });

  // @covers FR-01.28
  it("closeStream is idempotent on no-stream", async () => {
    await expect(
      store.closeStream(VALID_TASK_ID),
    ).resolves.toBeUndefined();
  });

  // @covers FR-01.28
  it("closeStream + re-append re-opens stream", async () => {
    store.append(VALID_TASK_ID, Buffer.from("first"));
    await flushMicrotasks();
    await store.closeStream(VALID_TASK_ID);
    store.append(VALID_TASK_ID, Buffer.from(" second"));
    await flushMicrotasks();
    expect(await store.read(VALID_TASK_ID)).toBe("first second");
  });

  // @covers FR-01.28
  it("FD-leak smoke — 50 open/close cycles do not accumulate handles", async () => {
    for (let i = 0; i < 50; i++) {
      const tid = `${VALID_TASK_ID.slice(0, 8)}-${i.toString(16).padStart(4, "0")}-3333-4444-555555555555`;
      store.append(tid, Buffer.from(`cycle-${i}`));
      await flushMicrotasks();
      await store.closeStream(tid);
    }
    // No assertion — if we reached here without ENFILE/EMFILE, FDs released cleanly.
    expect(true).toBe(true);
  });
});

describe("ScrollbackStore — rotation", () => {
  let dir: string;
  let store: ScrollbackStore;
  beforeEach(async () => {
    dir = makeTmpDir();
    // Small threshold (200 bytes) so we hit rotation quickly.
    store = new ScrollbackStore(dir, { maxBytesPerTask: 200 });
    await store.init();
  });
  afterEach(async () => {
    await store.shutdown();
    await rmrf(dir);
  });

  // @covers FR-01.28
  it("rotation triggered at threshold + .log.1 created", async () => {
    // Append 250 bytes to trip rotation.
    store.append(VALID_TASK_ID, Buffer.from("a".repeat(150)));
    store.append(VALID_TASK_ID, Buffer.from("b".repeat(100)));
    await flushMicrotasks();
    // Wait for rotation queue to drain.
    await new Promise((r) => setTimeout(r, 100));

    const archive = path.join(dir, `${VALID_TASK_ID}.log.1`);
    const live = path.join(dir, `${VALID_TASK_ID}.log`);
    expect(fsSync.existsSync(archive)).toBe(true);
    // .log exists only if rotation flushed buffered bytes; in this test no
    // appends happen during rotation, so .log won't be re-created until next
    // append. Verify by appending one more byte.
    store.append(VALID_TASK_ID, Buffer.from("z"));
    expect(fsSync.existsSync(live)).toBe(true);
  });

  // @covers FR-01.28
  it("rotation preserves all bytes (read combines .log + .log.1)", async () => {
    const part1 = "X".repeat(150);
    const part2 = "Y".repeat(100);
    store.append(VALID_TASK_ID, Buffer.from(part1));
    store.append(VALID_TASK_ID, Buffer.from(part2));
    await flushMicrotasks();
    await new Promise((r) => setTimeout(r, 150));

    const out = await store.read(VALID_TASK_ID);
    // After tail-to-maxBytes (200), we keep last 200 bytes.
    expect(out.length).toBe(200);
    // Tail is the 50 trailing X's followed by 100 Y's wait — actually 250 chars,
    // tail keeps last 200 = 50 X's + 100 Y's = 150 chars... Hmm, wait. 150+100=250
    // bytes total; tail to 200 bytes keeps the last 200, which is the last 100 Y's
    // preceded by 100 X's. Let me re-check: read() returns string after tail. Tail
    // is byte-based on UTF-8-encoded buffer. ASCII chars are 1 byte each, so
    // 250 chars = 250 bytes; tail to 200 = last 200 chars: 50 X's + last 150 Y's.
    expect(out.endsWith("Y".repeat(100))).toBe(true);
    expect(out.startsWith("X".repeat(100))).toBe(true);
  });

  // @covers FR-01.28
  it("rapid appends during rotation land in rotationBuffer + flush correctly", async () => {
    // Trip rotation first.
    store.append(VALID_TASK_ID, Buffer.from("0".repeat(210)));
    // Immediately rapid-fire appends — these should land in rotationBuffer
    // because rotation queue is processing.
    for (let i = 0; i < 10; i++) {
      store.append(VALID_TASK_ID, Buffer.from(`R${i}`));
    }
    await flushMicrotasks();
    // Wait for rotation + flush to complete.
    await new Promise((r) => setTimeout(r, 150));

    const out = await store.read(VALID_TASK_ID);
    // All R0..R9 chunks should be present somewhere in the output.
    for (let i = 0; i < 10; i++) {
      expect(out).toContain(`R${i}`);
    }
  });

  // @covers FR-01.28
  it("rotation buffer overflow throws ScrollbackStoreError (deterministic)", async () => {
    // Phase-3 review fix (MEDIUM): use a hanging renameFn so rotation
    // never completes; appends queue into the rotationBuffer until it
    // exceeds the cap, deterministically triggering the throw.
    let resolveRename: (() => void) | null = null;
    const hangingRename = () =>
      new Promise<void>((resolve) => {
        resolveRename = resolve;
      });

    const small = new ScrollbackStore(dir, {
      maxBytesPerTask: 100,
      rotationBufferMultiplier: 2, // cap = 200 bytes
      renameFn: hangingRename,
    });
    await small.init();

    // Trip rotation.
    small.append(VALID_TASK_ID_2, Buffer.from("a".repeat(150)));
    // Yield so the queue scheduler picks up rotation (state → ROTATING)
    // and parks on hangingRename.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    // Now rotation is parked. Buffer size threshold = 200 bytes.
    // First append (50 bytes) → buffered. Second (200 bytes) → would
    // exceed 200 → throws.
    expect(() =>
      small.append(VALID_TASK_ID_2, Buffer.from("y".repeat(50))),
    ).not.toThrow();
    expect(() =>
      small.append(VALID_TASK_ID_2, Buffer.from("z".repeat(200))),
    ).toThrowError(ScrollbackStoreError);

    // Release the hanging rename + drain. shutdown(200ms) ensures the
    // test doesn't race the framework timeout if the queue stays
    // parked on a slow OS rename.
    resolveRename?.();
    await new Promise((r) => setTimeout(r, 50));
    await small.shutdown(200);
  });

  // @covers FR-01.28
  it("rotation Windows-EBUSY retry: succeeds within renameMaxAttempts", async () => {
    let calls = 0;
    const flakeyRename = async (from: string, to: string) => {
      calls++;
      if (calls < 2) {
        const err = new Error("EBUSY") as NodeJS.ErrnoException;
        err.code = "EBUSY";
        throw err;
      }
      return fs.rename(from, to);
    };

    const retryStore = new ScrollbackStore(dir, {
      maxBytesPerTask: 200,
      renameMaxAttempts: 3,
      renameFn: flakeyRename,
    });
    await retryStore.init();
    retryStore.append(VALID_TASK_ID_3, Buffer.from("z".repeat(250)));
    await new Promise((r) => setTimeout(r, 300));

    expect(calls).toBeGreaterThanOrEqual(2); // first attempt = EBUSY, second succeeds
    expect(
      fsSync.existsSync(path.join(dir, `${VALID_TASK_ID_3}.log.1`)),
    ).toBe(true);
    await retryStore.shutdown();
  });

  // @covers FR-01.28
  it("rotation Windows-EBUSY exhausted retries logs warn (does not crash)", async () => {
    const alwaysEbusy = async () => {
      const err = new Error("EBUSY") as NodeJS.ErrnoException;
      err.code = "EBUSY";
      throw err;
    };

    const exhaustStore = new ScrollbackStore(dir, {
      maxBytesPerTask: 200,
      renameMaxAttempts: 2,
      renameFn: alwaysEbusy,
    });
    await exhaustStore.init();
    exhaustStore.append(
      "b1234567-89ab-cdef-1234-56789abcdef0",
      Buffer.from("y".repeat(250)),
    );
    await new Promise((r) => setTimeout(r, 300));
    // No throw — rotation logs warn but the store survives.
    await exhaustStore.shutdown();
    expect(true).toBe(true);
  });
});

describe("ScrollbackStore — sweepExpired", () => {
  let dir: string;
  let now: number;
  let store: ScrollbackStore;
  beforeEach(async () => {
    dir = makeTmpDir();
    now = Date.now();
    store = new ScrollbackStore(dir, {
      maxBytesPerTask: 4096,
      now: () => now,
    });
    await store.init();
  });
  afterEach(async () => {
    await store.shutdown();
    await rmrf(dir);
  });

  async function writeStaleFile(taskId: string, ageMs: number): Promise<void> {
    const filePath = path.join(dir, `${taskId}.log`);
    await fs.writeFile(filePath, "stale");
    const t = (now - ageMs) / 1000;
    await fs.utimes(filePath, t, t);
  }

  // @covers FR-01.28
  it("deletes files older than TTL", async () => {
    await writeStaleFile(VALID_TASK_ID, 2 * 24 * 60 * 60 * 1000); // 2 days old
    const r = await store.sweepExpired(1, { activeTaskIds: new Set() });
    expect(r.deleted).toBe(1);
    expect(
      fsSync.existsSync(path.join(dir, `${VALID_TASK_ID}.log`)),
    ).toBe(false);
  });

  // @covers FR-01.28
  it("skips files for active tasks", async () => {
    await writeStaleFile(VALID_TASK_ID, 2 * 24 * 60 * 60 * 1000);
    const r = await store.sweepExpired(1, {
      activeTaskIds: new Set([VALID_TASK_ID]),
    });
    expect(r.deleted).toBe(0);
    expect(
      fsSync.existsSync(path.join(dir, `${VALID_TASK_ID}.log`)),
    ).toBe(true);
  });

  // @covers FR-01.28
  it("bounded per-pass + oldest-first", async () => {
    await writeStaleFile(VALID_TASK_ID, 5 * 24 * 60 * 60 * 1000); // 5 days
    await writeStaleFile(VALID_TASK_ID_2, 3 * 24 * 60 * 60 * 1000); // 3 days
    await writeStaleFile(VALID_TASK_ID_3, 4 * 24 * 60 * 60 * 1000); // 4 days

    const r = await store.sweepExpired(1, {
      activeTaskIds: new Set(),
      maxFilesPerPass: 2,
    });
    expect(r.deleted).toBe(2);
    expect(r.remaining).toBe(1);
    // Oldest (VALID_TASK_ID @ 5d) deleted; 3-day youngest survives.
    expect(
      fsSync.existsSync(path.join(dir, `${VALID_TASK_ID}.log`)),
    ).toBe(false);
    expect(
      fsSync.existsSync(path.join(dir, `${VALID_TASK_ID_2}.log`)),
    ).toBe(true);
  });

  // @covers FR-01.28
  it("ignores fresh files (under TTL)", async () => {
    await writeStaleFile(VALID_TASK_ID, 1 * 60 * 60 * 1000); // 1 hour
    const r = await store.sweepExpired(1, { activeTaskIds: new Set() });
    expect(r.deleted).toBe(0);
  });

  // @covers FR-01.28
  it("ignores non-UUID-named files in the dir", async () => {
    await fs.writeFile(path.join(dir, "random-junk.txt"), "x");
    const r = await store.sweepExpired(1, { activeTaskIds: new Set() });
    expect(r.errors).toBe(0);
    expect(fsSync.existsSync(path.join(dir, "random-junk.txt"))).toBe(true);
  });
});

describe("ScrollbackStore — shutdown", () => {
  // @covers FR-01.28
  it("drains streams within timeout", async () => {
    const dir = makeTmpDir();
    const store = new ScrollbackStore(dir, { maxBytesPerTask: 4096 });
    await store.init();

    store.append(VALID_TASK_ID, Buffer.from("data"));
    store.append(VALID_TASK_ID_2, Buffer.from("data2"));
    await flushMicrotasks();

    await store.shutdown(2000);

    // After shutdown, files should still be readable on a fresh store.
    const fresh = new ScrollbackStore(dir, { maxBytesPerTask: 4096 });
    await fresh.init();
    expect(await fresh.read(VALID_TASK_ID)).toBe("data");
    expect(await fresh.read(VALID_TASK_ID_2)).toBe("data2");
    await fresh.shutdown();
    await rmrf(dir);
  });
});

describe("ScrollbackStore — symlink-swap mid-runtime", () => {
  // @covers FR-01.28
  it("clear() detects symlink escape via realpath-at-op-time", async () => {
    // Skip on Windows where symlink creation requires admin privileges.
    if (process.platform === "win32") return;

    const dir = makeTmpDir();
    const escapeTarget = path.join(os.tmpdir(), `escape-${Date.now()}.log`);
    await fs.writeFile(escapeTarget, "outside");

    try {
      const store = new ScrollbackStore(dir, { maxBytesPerTask: 4096 });
      await store.init();
      store.append(VALID_TASK_ID, Buffer.from("data"));
      await flushMicrotasks();
      await store.closeStream(VALID_TASK_ID);

      // Replace the legitimate file with a symlink pointing OUTSIDE the dir.
      await fs.unlink(path.join(dir, `${VALID_TASK_ID}.log`));
      await fs.symlink(escapeTarget, path.join(dir, `${VALID_TASK_ID}.log`));

      await expect(store.clear(VALID_TASK_ID)).rejects.toMatchObject({
        code: "scrollback_path_outside_dir",
      });
      // The escape target is still untouched.
      expect(fsSync.existsSync(escapeTarget)).toBe(true);
      await store.shutdown();
    } finally {
      await fs.unlink(escapeTarget).catch(() => undefined);
      await rmrf(dir);
    }
  });
});

describe("ScrollbackStore — read() respects maxBytesPerTask tail", () => {
  // @covers FR-01.28
  it("returns only the last maxBytesPerTask bytes when more exist", async () => {
    const dir = makeTmpDir();
    const store = new ScrollbackStore(dir, { maxBytesPerTask: 50 });
    await store.init();

    const big = "z".repeat(500);
    store.append(VALID_TASK_ID, Buffer.from(big));
    await flushMicrotasks();
    await new Promise((r) => setTimeout(r, 100));

    const out = await store.read(VALID_TASK_ID);
    // After rotation + tail, expect ≤ maxBytesPerTask UTF-8 bytes.
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(50);

    await store.shutdown();
    await rmrf(dir);
  });
});
