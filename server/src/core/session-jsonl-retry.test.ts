/*
 * The torn-read retry envelope + the newline scan. Moved out of
 * `session-watcher.test.ts` with their implementation
 * (iterate-2026-07-21-transcript-positional-tail-read), and kept separate from
 * `session-jsonl-io.test.ts` so each file covers one concern of the module.
 */
import { describe, it, expect } from "vitest";

import { readWithRetry, lastIndexOfByte } from "./session-jsonl-io.js";

describe("readWithRetry", () => {
  it("retries on EBUSY up to the 6-attempt budget and eventually succeeds", async () => {
    let calls = 0;
    const op = async () => {
      calls++;
      if (calls < 3) throw Object.assign(new Error("busy"), { code: "EBUSY" });
      return "ok";
    };
    expect(await readWithRetry(op)).toBe("ok");
    expect(calls).toBe(3);
  });

  it("bails immediately on non-retryable errors", async () => {
    const op = async () => { throw Object.assign(new Error("bad"), { code: "NOTRETRY" }); };
    await expect(readWithRetry(op)).rejects.toThrow("bad");
  });

  it("rethrows after exhausting retries on persistent EBUSY", async () => {
    const op = async () => { throw Object.assign(new Error("still busy"), { code: "EBUSY" }); };
    await expect(readWithRetry(op)).rejects.toThrow("still busy");
  });

  /*
   * The asymmetry that makes the envelope correct: discovery treats ENOENT as
   * an authoritative "no such session", the READ treats it as an AV scanner or
   * sync client momentarily yanking a file discovery just saw.
   */
  it("treats ENOENT as retryable by default, and fatal when the caller says so", async () => {
    let calls = 0;
    const op = async () => {
      calls++;
      if (calls < 2) throw Object.assign(new Error("gone"), { code: "ENOENT" });
      return "ok";
    };
    expect(await readWithRetry(op)).toBe("ok");
    expect(calls).toBe(2);

    let fatalCalls = 0;
    const fatalOp = async () => {
      fatalCalls++;
      throw Object.assign(new Error("gone"), { code: "ENOENT" });
    };
    await expect(readWithRetry(fatalOp, new Set(["ENOENT"]))).rejects.toThrow("gone");
    expect(fatalCalls).toBe(1);
  });
});

describe("lastIndexOfByte", () => {
  it("finds the last occurrence", () => {
    expect(lastIndexOfByte(Buffer.from("a\nb\nc"), 0x0a)).toBe(3);
  });
  it("returns -1 when absent", () => {
    expect(lastIndexOfByte(Buffer.from("abc"), 0x0a)).toBe(-1);
  });
  it("returns -1 for an empty buffer", () => {
    expect(lastIndexOfByte(Buffer.alloc(0), 0x0a)).toBe(-1);
  });
});
