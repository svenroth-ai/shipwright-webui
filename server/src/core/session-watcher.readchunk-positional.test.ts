/*
 * iterate-2026-07-21-transcript-positional-tail-read — `readChunk` now reads
 * only `[fromByte, EOF)` instead of loading the whole JSONL and slicing.
 *
 * The load-bearing property is EQUIVALENCE: this is a performance change, and a
 * performance change that alters a byte of the transcript contract is a
 * regression. So the suite carries a reference implementation of the previous
 * whole-file algorithm and asserts the two agree — plus ABSOLUTE expectations
 * alongside, because a differential probe cannot find a defect that is present
 * in both sides.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { SessionWatcher } from "./session-watcher.js";
import type { TailRead } from "./session-jsonl-io.js";

const UUID = "11111111-2222-3333-4444-555555555555";

/** The algorithm exactly as it stood before this run (whole file, then slice). */
function referenceReadChunk(
  fileBytes: Buffer,
  fromByte: number,
): { fromByte: number; toByte: number; content: string } {
  const from = Math.min(Math.max(fromByte, 0), fileBytes.length);
  let slice = fileBytes.subarray(from);
  let endExclusive = from + slice.length;
  const lastNl = slice.lastIndexOf(0x0a);
  if (lastNl === -1) {
    slice = Buffer.alloc(0);
    endExclusive = from;
  } else {
    slice = slice.subarray(0, lastNl + 1);
    endExclusive = from + lastNl + 1;
  }
  return { fromByte: from, toByte: endExclusive, content: slice.toString("utf-8") };
}

describe("readChunk — equivalence with the whole-file reader (AC-2)", () => {
  let projectsDir: string;
  beforeEach(() => {
    projectsDir = mkdtempSync(path.join(tmpdir(), "sw-pos-"));
  });
  afterEach(() => {
    try { rmSync(projectsDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function seed(content: string): Buffer {
    const encoded = path.join(projectsDir, "enc");
    mkdirSync(encoded, { recursive: true });
    const buf = Buffer.from(content, "utf-8");
    writeFileSync(path.join(encoded, UUID + ".jsonl"), buf);
    return buf;
  }

  const CASES: Array<{ name: string; content: string; fromByte: number }> = [
    { name: "from 0, newline-terminated", content: "a\nb\nc\n", fromByte: 0 },
    { name: "from 0, trailing partial line", content: "a\nb\nc", fromByte: 0 },
    { name: "mid-file on a line boundary", content: "aaaa\nbbbb\ncccc\n", fromByte: 5 },
    { name: "mid-file mid-line", content: "aaaa\nbbbb\ncccc\n", fromByte: 7 },
    { name: "tail contains no newline at all", content: "aaaa\nbbbbbbbb", fromByte: 5 },
    { name: "fromByte exactly at EOF", content: "a\nb\n", fromByte: 4 },
    { name: "fromByte past EOF", content: "a\nb\n", fromByte: 9999 },
    { name: "negative fromByte", content: "a\nb\n", fromByte: -5 },
    { name: "empty file", content: "", fromByte: 0 },
    { name: "single newline only", content: "\n", fromByte: 0 },
    { name: "multi-byte utf-8, aligned", content: "grün\nweiß\n", fromByte: 0 },
    // `grün` is 5 bytes; byte 3 lands INSIDE the ü. Both readers decode from the
    // same byte, so both emit the same replacement char — equivalence, not beauty.
    { name: "multi-byte utf-8, fromByte mid-character", content: "grün\nweiß\n", fromByte: 3 },
  ];

  for (const c of CASES) {
    it("matches the reference: " + c.name, async () => {
      const buf = seed(c.content);
      const watcher = new SessionWatcher({ projectsDir });
      const r = await watcher.readChunk({
        sessionUuid: UUID,
        fromByte: c.fromByte,
        expectFingerprint: null,
      });
      expect(r.status).toBe("ok");
      if (r.status !== "ok") return;
      const ref = referenceReadChunk(buf, c.fromByte);
      expect(r.chunk.content).toBe(ref.content);
      expect(r.chunk.fromByte).toBe(ref.fromByte);
      expect(r.chunk.toByte).toBe(ref.toByte);
      // `size` stays the DISCOVERY stat, exactly as before.
      expect(r.chunk.size).toBe(buf.length);
      // Absolute invariants, independent of the reference.
      expect(r.chunk.content === "" || r.chunk.content.endsWith("\n")).toBe(true);
      expect(r.chunk.toByte).toBeGreaterThanOrEqual(r.chunk.fromByte);
      expect(r.chunk.toByte).toBeLessThanOrEqual(buf.length);
    });
  }

  it("still reports rotation before reading anything", async () => {
    seed("short\n");
    const watcher = new SessionWatcher({ projectsDir });
    const r = await watcher.readChunk({
      sessionUuid: UUID,
      fromByte: 500,
      expectFingerprint: "100:999",
    });
    expect(r.status).toBe("rotated");
  });

  it("still reports missing when no JSONL exists", async () => {
    const watcher = new SessionWatcher({ projectsDir });
    const r = await watcher.readChunk({ sessionUuid: UUID, fromByte: 0, expectFingerprint: null });
    expect(r.status).toBe("missing");
  });

  /* Sequential polling — the transcript endpoint's actual usage pattern. */
  it("walks a growing file with no duplicated or skipped bytes", async () => {
    const encoded = path.join(projectsDir, "enc");
    mkdirSync(encoded, { recursive: true });
    const fp = path.join(encoded, UUID + ".jsonl");
    writeFileSync(fp, "one\ntwo\n");
    const watcher = new SessionWatcher({ projectsDir });

    let cursor = 0;
    let seen = "";
    const first = await watcher.readChunk({ sessionUuid: UUID, fromByte: cursor, expectFingerprint: null });
    if (first.status === "ok") { seen += first.chunk.content; cursor = first.chunk.toByte; }
    expect(seen).toBe("one\ntwo\n");

    writeFileSync(fp, "one\ntwo\nthree\nfour\n");
    const second = await watcher.readChunk({ sessionUuid: UUID, fromByte: cursor, expectFingerprint: null });
    if (second.status === "ok") { seen += second.chunk.content; cursor = second.chunk.toByte; }
    expect(seen).toBe("one\ntwo\nthree\nfour\n");
    expect(cursor).toBe(19);
  });
});

describe("readChunk — positional read contract (AC-1, AC-3, AC-4)", () => {
  let projectsDir: string;
  beforeEach(() => {
    projectsDir = mkdtempSync(path.join(tmpdir(), "sw-pos2-"));
  });
  afterEach(() => {
    try { rmSync(projectsDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function seed(content: string): void {
    const encoded = path.join(projectsDir, "enc");
    mkdirSync(encoded, { recursive: true });
    writeFileSync(path.join(encoded, UUID + ".jsonl"), content);
  }

  it("AC-1 — forwards fromByte to the reader instead of asking for the whole file", async () => {
    seed("aaaa\nbbbb\ncccc\n");
    const calls: Array<{ p: string; fromByte: number }> = [];
    const watcher = new SessionWatcher({
      projectsDir,
      readTail: async (p, fromByte): Promise<TailRead> => {
        calls.push({ p, fromByte });
        return { bytes: Buffer.from("cccc\n"), size: 15 };
      },
    });
    const r = await watcher.readChunk({ sessionUuid: UUID, fromByte: 10, expectFingerprint: null });
    expect(calls.length).toBe(1);
    expect(calls[0].fromByte).toBe(10);
    expect(calls[0].p.endsWith(UUID + ".jsonl")).toBe(true);
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.chunk.content).toBe("cccc\n");
      expect(r.chunk.fromByte).toBe(10);
      expect(r.chunk.toByte).toBe(15);
    }
  });

  it("AC-3 — a one-shot EBUSY on the tail read is retried, not surfaced", async () => {
    seed("a\nb\n");
    let calls = 0;
    const watcher = new SessionWatcher({
      projectsDir,
      readTail: async (): Promise<TailRead> => {
        calls++;
        if (calls === 1) throw Object.assign(new Error("busy"), { code: "EBUSY" });
        return { bytes: Buffer.from("a\nb\n"), size: 4 };
      },
    });
    const r = await watcher.readChunk({ sessionUuid: UUID, fromByte: 0, expectFingerprint: null });
    expect(r.status).toBe("ok");
    expect(calls).toBe(2);
  });

  /*
   * ENOENT is FATAL for discovery (an absent file is an authoritative miss) but
   * RETRYABLE for the read — a transient ENOENT there is an AV scanner or
   * OneDrive sync momentarily yanking a file that discovery just saw. That
   * asymmetry predates this run; pinning it here stops the extraction from
   * quietly hardening the read path into discovery's policy.
   */
  it("AC-3 — ENOENT on the read is retried (unlike discovery, where it is fatal)", async () => {
    seed("a\n");
    let calls = 0;
    const watcher = new SessionWatcher({
      projectsDir,
      readTail: async (): Promise<TailRead> => {
        calls++;
        if (calls === 1) throw Object.assign(new Error("gone"), { code: "ENOENT" });
        return { bytes: Buffer.from("a\n"), size: 2 };
      },
    });
    const r = await watcher.readChunk({ sessionUuid: UUID, fromByte: 0, expectFingerprint: null });
    expect(r.status).toBe("ok");
    expect(calls).toBe(2);
  });

  it("AC-4 — a short read still yields a newline-terminated chunk with a matching toByte", async () => {
    seed("aaaa\nbbbb\ncccc\n");
    const watcher = new SessionWatcher({
      projectsDir,
      // The reader got only "bbbb\ncc" of the 10 bytes it asked for.
      readTail: async (): Promise<TailRead> => ({ bytes: Buffer.from("bbbb\ncc"), size: 15 }),
    });
    const r = await watcher.readChunk({ sessionUuid: UUID, fromByte: 5, expectFingerprint: null });
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.chunk.content).toBe("bbbb\n");
      expect(r.chunk.fromByte).toBe(5);
      // Cursor must land on what was DELIVERED, so the next poll resumes at 10.
      expect(r.chunk.toByte).toBe(10);
    }
  });

  /*
   * External plan review finding 1 (HIGH). A truncation between discovery and
   * the read makes the reader report the post-truncation size; `readChunk` must
   * clamp `fromByte` against THAT, as the whole-file reader implicitly did.
   */
  it("clamps fromByte against the size the read observed, not the discovery stat", async () => {
    seed("x".repeat(100));
    const watcher = new SessionWatcher({
      projectsDir,
      readTail: async (): Promise<TailRead> => ({ bytes: Buffer.alloc(0), size: 50 }),
    });
    const r = await watcher.readChunk({ sessionUuid: UUID, fromByte: 75, expectFingerprint: null });
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.chunk.fromByte).toBe(50);
      expect(r.chunk.toByte).toBe(50);
      expect(r.chunk.content).toBe("");
    }
  });

  /*
   * External plan review finding 2 (MEDIUM). The read runs through the EOF the
   * OPEN HANDLE observed, so bytes appended mid-read are deferred to the next
   * poll. That is fine for a polling endpoint — but only if the cursor stays
   * safe, which is what this pins.
   */
  it("defers bytes appended mid-read to the next poll without duplicating or skipping", async () => {
    seed("one\ntwo\nthree\n");
    let call = 0;
    const watcher = new SessionWatcher({
      projectsDir,
      readTail: async (_p, fromByte): Promise<TailRead> => {
        call++;
        // First poll: the handle saw only the first 8 bytes.
        if (call === 1) return { bytes: Buffer.from("one\ntwo\n"), size: 8 };
        return { bytes: Buffer.from("three\n".slice(Math.max(0, fromByte - 8))), size: 14 };
      },
    });
    const a = await watcher.readChunk({ sessionUuid: UUID, fromByte: 0, expectFingerprint: null });
    expect(a.status).toBe("ok");
    const cursor = a.status === "ok" ? a.chunk.toByte : -1;
    expect(cursor).toBe(8);
    const b = await watcher.readChunk({ sessionUuid: UUID, fromByte: cursor, expectFingerprint: null });
    expect(b.status).toBe("ok");
    if (b.status === "ok") {
      expect(b.chunk.content).toBe("three\n");
      expect(b.chunk.fromByte).toBe(8);
      expect(b.chunk.toByte).toBe(14);
    }
  });
});
