/*
 * iterate-2026-07-22-transcript-cursor-single-walk — AC-4.
 *
 * `readChunk` already resolves a `JsonlLocation` and used to throw it away, so
 * every caller that needed the file's mtime/size walked `~/.claude/projects` a
 * SECOND time for the same answer. The reader is now symmetric:
 *
 *   out — `{ status: "ok", ..., location }`, so the transcript route can drop
 *         its own `findByUuid`.
 *   in  — an optional pre-resolved `location`, so a caller that HAS to walk
 *         first (mission-context needs `sizeBytes` to compute the tail offset;
 *         the inbox cold path walks for its cache) does not pay for a second.
 *
 * Measured on this machine: one walk is 0.45 ms (HIT) / 0.47 ms (full MISS)
 * over 5 subdirs and 336 entries. After the client cursor lands, two walks are
 * ~80 % of what a transcript poll costs, which is why this is worth a field.
 *
 * The assertions here count `readdir` on the injected dep rather than timing
 * anything — a walk that did not happen is the claim, and only a call count can
 * prove it (external plan review, openai #3: an assertion on the RETURN value
 * proves an offset was passed, never that a walk was skipped).
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, appendFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { SessionWatcher, type JsonlLocation } from "./session-watcher.js";

const UUID = "11111111-2222-4333-8444-555555555555";

let projectsDir = "";
afterEach(() => {
  if (projectsDir) {
    try {
      rmSync(projectsDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  projectsDir = "";
});

/** A watcher over a REAL temp tree whose `readdir` calls are counted. */
function seed(content: string): {
  watcher: SessionWatcher;
  walks: () => number;
  readdirCalls: () => number;
  file: string;
} {
  projectsDir = mkdtempSync(path.join(tmpdir(), "single-walk-"));
  const enc = path.join(projectsDir, "enc-project");
  mkdirSync(enc, { recursive: true });
  const file = path.join(enc, `${UUID}.jsonl`);
  writeFileSync(file, content, "utf-8");

  let walkCount = 0;
  let readdirCount = 0;
  const dir = projectsDir;
  const watcher = new SessionWatcher({
    projectsDir: dir,
    readdir: async (p) => {
      readdirCount++;
      // A `findByUuid` walk always begins by listing the projects dir itself;
      // counting that is a stable proxy for "one walk" that does not depend on
      // how many subdirs the tree happens to have.
      if (path.resolve(p) === path.resolve(dir)) walkCount++;
      return readdir(p);
    },
  });
  return { watcher, walks: () => walkCount, readdirCalls: () => readdirCount, file };
}

describe("readChunk — hands back the location it resolved (AC-4, out)", () => {
  it("returns the same location findByUuid would have returned", async () => {
    const { watcher } = seed("a\nb\n");
    const expected = await watcher.findByUuid(UUID);
    const r = await watcher.readChunk({ sessionUuid: UUID, fromByte: 0, expectFingerprint: null });

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.location).toEqual(expected);
    // The location is what the chunk was READ from, so its size must agree with
    // the size the chunk reports — the pairing the route now relies on.
    expect(r.location.sizeBytes).toBe(r.chunk.size);
    expect(r.location.path).toContain(`${UUID}.jsonl`);
  });

  it("resolving through readChunk costs exactly ONE walk", async () => {
    const { watcher, walks } = seed("a\nb\n");
    await watcher.readChunk({ sessionUuid: UUID, fromByte: 0, expectFingerprint: null });
    // Pre-change this was still 1 — the second walk lived in the ROUTE. This
    // pins that readChunk itself never grows a second one.
    expect(walks()).toBe(1);
  });
});

describe("readChunk — accepts a pre-resolved location (AC-4, in)", () => {
  it("performs ZERO readdir calls when the caller already walked", async () => {
    const { watcher, readdirCalls } = seed("hello\nworld\n");
    const loc = await watcher.findByUuid(UUID);
    expect(loc).not.toBeNull();

    const before = readdirCalls();
    const r = await watcher.readChunk({
      sessionUuid: UUID,
      fromByte: 0,
      expectFingerprint: null,
      location: loc,
    });
    // Not "fewer" — none. The whole point of the field.
    expect(readdirCalls() - before).toBe(0);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.chunk.content).toBe("hello\nworld\n");
  });

  it("produces a byte-identical chunk with and without the pre-resolved location", async () => {
    const { watcher } = seed("one\ntwo\nthree\n");
    const loc = await watcher.findByUuid(UUID);

    const walked = await watcher.readChunk({ sessionUuid: UUID, fromByte: 4, expectFingerprint: null });
    const passed = await watcher.readChunk({
      sessionUuid: UUID,
      fromByte: 4,
      expectFingerprint: null,
      location: loc,
    });
    expect(walked.status).toBe("ok");
    expect(passed.status).toBe("ok");
    if (walked.status !== "ok" || passed.status !== "ok") return;
    // Equivalence is the contract: the location changes WHERE the metadata came
    // from, never WHAT is delivered.
    expect(passed.chunk).toEqual(walked.chunk);
  });

  it("a passed location does not make ENOENT on the READ fatal (CLAUDE.md rule 6 asymmetry)", async () => {
    const { watcher: base } = seed("x\ny\n");
    const loc = await base.findByUuid(UUID);
    let attempts = 0;
    const watcher = new SessionWatcher({
      projectsDir,
      readTail: async () => {
        attempts++;
        if (attempts === 1) {
          throw Object.assign(new Error("gone"), { code: "ENOENT" });
        }
        return { bytes: Buffer.from("x\ny\n"), size: 4 };
      },
    });
    const r = await watcher.readChunk({
      sessionUuid: UUID,
      fromByte: 0,
      expectFingerprint: null,
      location: loc,
    });
    // ENOENT is retryable on the READ and fatal only for DISCOVERY. Supplying a
    // location skips discovery — it must not silently re-classify the read.
    expect(attempts).toBe(2);
    expect(r.status).toBe("ok");
  });
});

describe("readChunk — a stale location cannot truncate or throw (plan review, gemini #3)", () => {
  it("delivers everything on disk even when location.sizeBytes predates a write", async () => {
    const { watcher, file } = seed("first\n");
    const stale = (await watcher.findByUuid(UUID)) as JsonlLocation;
    expect(stale.sizeBytes).toBe(6);

    // The file grows AFTER the caller's walk — the exact race the reviewer
    // raised. `readTailFromDisk` opens the path and runs its own fstat, so the
    // read is bounded by what IT observes, not by the caller's stale size.
    appendFileSync(file, "second\n", "utf-8");

    const r = await watcher.readChunk({
      sessionUuid: UUID,
      fromByte: 0,
      expectFingerprint: null,
      location: stale,
    });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.chunk.content).toBe("first\nsecond\n");
    // `size` mirrors the location the caller supplied — documented, and
    // harmless because the only callers that pass one ignore `size` and send
    // `expectFingerprint: null`.
    expect(r.chunk.size).toBe(6);
    expect(r.location).toEqual(stale);
  });
});

describe("readChunk — discovery is unchanged when no location is supplied", () => {
  it("still reports missing when nothing matches the uuid", async () => {
    const { watcher, walks } = seed("a\n");
    const r = await watcher.readChunk({
      sessionUuid: "99999999-9999-4999-8999-999999999999",
      fromByte: 0,
      expectFingerprint: null,
    });
    expect(r.status).toBe("missing");
    expect(walks()).toBe(1);
  });

  it("an explicitly null location falls back to walking (not treated as 'missing')", async () => {
    const { watcher, walks } = seed("a\nb\n");
    const r = await watcher.readChunk({
      sessionUuid: UUID,
      fromByte: 0,
      expectFingerprint: null,
      location: null,
    });
    expect(r.status).toBe("ok");
    expect(walks()).toBe(1);
  });
});
