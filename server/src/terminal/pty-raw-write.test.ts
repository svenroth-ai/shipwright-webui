// @covers FR-01.28
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import fs from "node:fs";
import { writePtyChunk } from "./pty-raw-write.js";
import { ChunkedPtyWriter } from "./pty-write-chunker.js";

const realPlatform = process.platform;
// The async-fd path is the Unix path; pin the platform so it is exercised on
// every host (the Windows branch is covered by pty-write-chunker.test.ts).
beforeEach(() => Object.defineProperty(process, "platform", { value: "darwin" }));
afterEach(() => {
  Object.defineProperty(process, "platform", { value: realPlatform });
  vi.restoreAllMocks();
});

describe("writePtyChunk (issue #632: never block the event loop)", () => {
  it("delivers through async fs.write, NOT the blocking pty.write, when an fd exists", async () => {
    const write = vi.fn();
    const spy = vi.spyOn(fs, "write").mockImplementation(((...a: unknown[]) => {
      (a[5] as (e: null, n: number) => void)(null, a[3] as number);
    }) as never);
    await new Promise<void>((res, rej) =>
      writePtyChunk({ pty: { write, fd: 7 } }, "héllo", (e) => (e ? rej(e) : res())),
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
  });

  it("completes a partial write and retries EAGAIN", async () => {
    let calls = 0;
    const lens: number[] = [];
    vi.spyOn(fs, "write").mockImplementation(((...a: unknown[]) => {
      const cb = a[5] as (e: Error | null, n?: number) => void;
      calls++;
      if (calls === 1) return cb(Object.assign(new Error("again"), { code: "EAGAIN" }));
      lens.push(a[3] as number);
      cb(null, 2); // partial
    }) as never);
    await new Promise<void>((res, rej) =>
      writePtyChunk({ pty: { write: vi.fn(), fd: 7 } }, "abcd", (e) => (e ? rej(e) : res())),
    );
    expect(lens).toEqual([4, 2]);
  });

  it("reports a hard error to the caller instead of throwing", async () => {
    vi.spyOn(fs, "write").mockImplementation(((...a: unknown[]) => {
      (a[5] as (e: Error) => void)(new Error("EIO"));
    }) as never);
    const err = await new Promise<Error | undefined>((res) =>
      writePtyChunk({ pty: { write: vi.fn(), fd: 7 } }, "x", res),
    );
    expect(err?.message).toBe("EIO");
  });
});

describe("ChunkedPtyWriter over an async chunk write", () => {
  it("keeps order, never interleaves a queued write, and abandons a burst on error", async () => {
    const out: string[] = [];
    let fail = false;
    vi.spyOn(fs, "write").mockImplementation(((...a: unknown[]) => {
      const cb = a[5] as (e: Error | null, n?: number) => void;
      const s = (a[1] as Buffer).toString("utf8");
      setImmediate(() => {
        if (fail) return cb(new Error("EIO"));
        out.push(s);
        cb(null, (a[1] as Buffer).length);
      });
    }) as never);
    const small: string[] = [];
    const entry = { pty: { write: (d: string) => small.push(d), fd: 9 } } as never;
    const w = new ChunkedPtyWriter({ ptyWriteChunkBytes: 4, ptyWriteChunkDelayMs: 0 });
    w.write(entry, "abcdefghij");
    w.write(entry, "!"); // arrives mid-burst -> queued, delivered after
    await new Promise((r) => setTimeout(r, 60));
    expect(out.join("")).toBe("abcdefghij");
    expect(small).toEqual(["!"]);

    out.length = 0;
    fail = true;
    w.write(entry, "0123456789");
    await new Promise((r) => setTimeout(r, 60));
    expect(out).toEqual([]);
    expect((entry as { chunkWriteBusy?: boolean }).chunkWriteBusy).toBe(false);
  });
});

describe("writePtyChunk teardown guard", () => {
  it("does not write to the fd once the entry is torn down", async () => {
    const spy = vi.spyOn(fs, "write");
    await new Promise<void>((res) =>
      writePtyChunk({ pty: { write: vi.fn(), fd: 7 }, tornDown: true }, "x", () => res()),
    );
    expect(spy).not.toHaveBeenCalled();
  });
});
