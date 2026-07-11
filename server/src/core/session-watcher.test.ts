import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  utimesSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import {
  SessionWatcher,
  readWithRetry,
  computeFingerprint,
  type JsonlLocation,
} from "./session-watcher.js";

const UUID = "11111111-2222-3333-4444-555555555555";

describe("SessionWatcher.findByUuid", () => {
  let projectsDir: string;
  beforeEach(() => {
    projectsDir = mkdtempSync(path.join(tmpdir(), "sw-"));
  });
  afterEach(() => {
    try { rmSync(projectsDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("finds the JSONL by filename match", async () => {
    const encoded = path.join(projectsDir, "encodedA");
    mkdirSync(encoded, { recursive: true });
    writeFileSync(path.join(encoded, `${UUID}.jsonl`), "hello\n");
    const watcher = new SessionWatcher({ projectsDir });
    const loc = await watcher.findByUuid(UUID);
    expect(loc?.path.endsWith(`${UUID}.jsonl`)).toBe(true);
    expect(loc?.encodedCwd).toBe("encodedA");
  });

  it("returns null if no file matches", async () => {
    const watcher = new SessionWatcher({ projectsDir });
    const loc = await watcher.findByUuid(UUID);
    expect(loc).toBeNull();
  });

  it("is case-insensitive on the filename match", async () => {
    // Windows filesystems are case-insensitive by default so we can't drop
    // two files that differ only in case. Verify the lookup itself uses
    // `toLowerCase()` by seeding lowercase and querying uppercase.
    const encoded = path.join(projectsDir, "enc");
    mkdirSync(encoded, { recursive: true });
    writeFileSync(path.join(encoded, `${UUID.toLowerCase()}.jsonl`), "x\n");
    const watcher = new SessionWatcher({ projectsDir });
    const loc = await watcher.findByUuid(UUID.toUpperCase());
    expect(loc).not.toBeNull();
  });

  // D06/F24 (iterate-2026-07-10-transcript-state-guards) — the torn-read
  // retry envelope must also cover discovery's per-file stat. Before the
  // fix, a single transient EBUSY on the matched file's stat returned an
  // authoritative `null` (== "JSONL missing"), which the transcript-poll
  // state machine then persisted as a state flip. AV scanner / OneDrive
  // sync momentary locks are the exact threat the 6-attempt envelope was
  // built for (module header lines 15-19).
  it("retries a one-shot EBUSY on the matched file's stat and still finds it", async () => {
    const wanted = `${UUID}.jsonl`;
    let fileStatCalls = 0;
    const watcher = new SessionWatcher({
      projectsDir: "/projects",
      readdir: async (p: string) =>
        // top-level projectsDir → the single subdir; the subdir → the file
        p.toLowerCase().endsWith("enc") ? [wanted] : ["enc"],
      stat: async (p: string) => {
        if (p.toLowerCase().endsWith(".jsonl")) {
          fileStatCalls++;
          if (fileStatCalls === 1) {
            throw Object.assign(new Error("busy"), { code: "EBUSY" });
          }
          return { mtimeMs: 42, size: 7, isDirectory: () => false };
        }
        return { mtimeMs: 1, size: 0, isDirectory: () => true };
      },
    });
    const loc = await watcher.findByUuid(UUID);
    expect(loc).not.toBeNull();
    expect(loc?.mtimeMs).toBe(42);
    expect(loc?.sizeBytes).toBe(7);
    // Proves the retry actually fired (call 1 threw, call 2 succeeded).
    expect(fileStatCalls).toBe(2);
  });
});

describe("SessionWatcher.readChunk", () => {
  let projectsDir: string;
  beforeEach(() => {
    projectsDir = mkdtempSync(path.join(tmpdir(), "sw-"));
  });
  afterEach(() => {
    try { rmSync(projectsDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function seed(content: string): void {
    const encoded = path.join(projectsDir, "enc");
    mkdirSync(encoded, { recursive: true });
    writeFileSync(path.join(encoded, `${UUID}.jsonl`), content);
  }

  it("returns status=missing when no JSONL yet", async () => {
    const watcher = new SessionWatcher({ projectsDir });
    const r = await watcher.readChunk({ sessionUuid: UUID, fromByte: 0, expectFingerprint: null });
    expect(r.status).toBe("missing");
  });

  it("returns chunk ending on \\n boundary", async () => {
    seed("line-a\nline-b\nline-c");
    const watcher = new SessionWatcher({ projectsDir });
    const r = await watcher.readChunk({ sessionUuid: UUID, fromByte: 0, expectFingerprint: null });
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.chunk.content.endsWith("\n")).toBe(true);
      expect(r.chunk.content).toBe("line-a\nline-b\n");
      expect(r.chunk.toByte).toBe("line-a\nline-b\n".length);
    }
  });

  it("reads only from fromByte onwards", async () => {
    seed("line-a\nline-b\nline-c\n");
    const watcher = new SessionWatcher({ projectsDir });
    const r = await watcher.readChunk({ sessionUuid: UUID, fromByte: 7, expectFingerprint: null });
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.chunk.content).toBe("line-b\nline-c\n");
      expect(r.chunk.fromByte).toBe(7);
    }
  });

  it("detects rotation when fingerprint mismatch + size shrank", async () => {
    seed("short\n");
    const watcher = new SessionWatcher({ projectsDir });
    const staleFp = "100:999"; // previous mtime + larger size
    const r = await watcher.readChunk({
      sessionUuid: UUID,
      fromByte: 500,
      expectFingerprint: staleFp,
    });
    expect(r.status).toBe("rotated");
  });
});

describe("readWithRetry", () => {
  it("retries on EBUSY up to the 6-attempt budget and eventually succeeds", async () => {
    let calls = 0;
    const op = async () => {
      calls++;
      if (calls < 3) throw Object.assign(new Error("busy"), { code: "EBUSY" });
      return "ok";
    };
    const value = await readWithRetry(op);
    expect(value).toBe("ok");
    expect(calls).toBe(3);
  });

  it("bails immediately on non-retryable errors", async () => {
    const op = async () => {
      throw Object.assign(new Error("bad"), { code: "NOTRETRY" });
    };
    await expect(readWithRetry(op)).rejects.toThrow("bad");
  });

  it("rethrows after exhausting retries on persistent EBUSY", async () => {
    const op = async () => {
      throw Object.assign(new Error("still busy"), { code: "EBUSY" });
    };
    await expect(readWithRetry(op)).rejects.toThrow("still busy");
  });
});

describe("computeFingerprint", () => {
  it("encodes <mtime-ms>:<size-bytes>", () => {
    const loc: JsonlLocation = {
      path: "",
      encodedCwd: "",
      mtimeMs: 1234.7,
      sizeBytes: 999,
    };
    expect(computeFingerprint(loc)).toBe("1234:999");
  });
});

// ADR-102 (resume-cta-jsonl-signal) — batch JSONL discovery. `GET
// /api/external/tasks` needs a LIVE mtime for every task in one walk so
// the board's Resume-CTA gate is not fed a stale persisted value.
describe("SessionWatcher.findManyByUuid", () => {
  const UUID_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const UUID_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const UUID_C = "cccccccc-cccc-cccc-cccc-cccccccccccc";

  let projectsDir: string;
  beforeEach(() => {
    projectsDir = mkdtempSync(path.join(tmpdir(), "sw-many-"));
  });
  afterEach(() => {
    try { rmSync(projectsDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("resolves multiple uuids across separate project dirs in one walk", async () => {
    const encA = path.join(projectsDir, "encA");
    const encB = path.join(projectsDir, "encB");
    mkdirSync(encA, { recursive: true });
    mkdirSync(encB, { recursive: true });
    writeFileSync(path.join(encA, `${UUID_A}.jsonl`), "a\n");
    writeFileSync(path.join(encB, `${UUID_B}.jsonl`), "bb\n");
    const watcher = new SessionWatcher({ projectsDir });
    const out = await watcher.findManyByUuid(new Set([UUID_A, UUID_B]));
    expect(out.get(UUID_A)?.encodedCwd).toBe("encA");
    expect(out.get(UUID_B)?.sizeBytes).toBe(3);
    expect(typeof out.get(UUID_A)?.mtimeMs).toBe("number");
  });

  it("omits uuids with no matching file (board tasks whose JSONL doesn't exist yet)", async () => {
    const enc = path.join(projectsDir, "enc");
    mkdirSync(enc, { recursive: true });
    writeFileSync(path.join(enc, `${UUID_A}.jsonl`), "a\n");
    const watcher = new SessionWatcher({ projectsDir });
    const out = await watcher.findManyByUuid(new Set([UUID_A, UUID_C]));
    expect(out.has(UUID_A)).toBe(true);
    expect(out.has(UUID_C)).toBe(false);
  });

  it("returns an empty map for an empty input set (no directory walk needed)", async () => {
    const watcher = new SessionWatcher({ projectsDir });
    const out = await watcher.findManyByUuid(new Set());
    expect(out.size).toBe(0);
  });

  it("keys the result by lowercase uuid regardless of input casing", async () => {
    const enc = path.join(projectsDir, "enc");
    mkdirSync(enc, { recursive: true });
    writeFileSync(path.join(enc, `${UUID_A}.jsonl`), "a\n");
    const watcher = new SessionWatcher({ projectsDir });
    const out = await watcher.findManyByUuid(new Set([UUID_A.toUpperCase()]));
    expect(out.get(UUID_A)).toBeDefined();
  });

  it("re-stats live — a fresh write moves the reported mtime forward", async () => {
    // This is the property the H-1 fix depends on: the board endpoint
    // must see the JSONL mtime as it is NOW, not a frozen store value.
    const enc = path.join(projectsDir, "enc");
    mkdirSync(enc, { recursive: true });
    const fp = path.join(enc, `${UUID_A}.jsonl`);
    writeFileSync(fp, "first\n");
    const watcher = new SessionWatcher({ projectsDir });
    const before = (await watcher.findManyByUuid(new Set([UUID_A]))).get(UUID_A)!;
    const future = new Date(Date.now() + 120_000);
    utimesSync(fp, future, future);
    const after = (await watcher.findManyByUuid(new Set([UUID_A]))).get(UUID_A)!;
    expect(after.mtimeMs).toBeGreaterThan(before.mtimeMs);
  });
});
