/*
 * codextender-auth-file-sweep.test.ts — PR-review round 10 (iterate-2026-09-23).
 *
 * Boundary probe (real files, real mtime) mirroring
 * terminal/snapshot-tmp-sweep.test.ts's shape: an aged orphan credential
 * file is reclaimed while a freshly-written one, and an unrelated file in
 * the same dir, are both preserved.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import { sweepOrphanCodextenderAuthFiles } from "./codextender-auth-file-sweep.js";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "codextender-auth-sweep-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
});

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

describe("sweepOrphanCodextenderAuthFiles — orphan reclamation (PR-review round 10)", () => {
  it("reclaims an aged orphan credential file; preserves a fresh one and an unrelated file", async () => {
    const orphan = path.join(
      dir,
      "codextender-auth-11111111-2222-3333-4444-555555555555.tmp",
    );
    await fs.writeFile(orphan, "stranded-bearer-token");
    const twentyMinAgo = new Date(Date.now() - 20 * 60 * 1000);
    await fs.utimes(orphan, twentyMinAgo, twentyMinAgo);

    // Fresh file — a launch still in flight; must survive.
    const fresh = path.join(
      dir,
      "codextender-auth-22222222-3333-4444-5555-666666666666.tmp",
    );
    await fs.writeFile(fresh, "in-flight-token");

    // Unrelated tmp file the sweep must never touch.
    const unrelated = path.join(dir, "some-other-tool.tmp");
    await fs.writeFile(unrelated, "not ours");

    const r = await sweepOrphanCodextenderAuthFiles({
      dir,
      logWarn: () => {},
      logInfo: () => {},
    });

    expect(r.deleted).toBe(1);
    expect(r.preserved).toBe(1);
    expect(r.errors).toBe(0);
    expect(await exists(orphan)).toBe(false); // reclaimed
    expect(await exists(fresh)).toBe(true); // in-flight survives
    expect(await exists(unrelated)).toBe(true); // never matched the pattern
  });

  it("returns a zero-work result when the dir is missing", async () => {
    const missing = path.join(dir, "does-not-exist");
    const r = await sweepOrphanCodextenderAuthFiles({
      dir: missing,
      logWarn: () => {},
      logInfo: () => {},
    });
    expect(r).toEqual({ deleted: 0, errors: 0, preserved: 0 });
  });

  it("preserves a file whose mtime is exactly at the cutoff (>= is inclusive)", async () => {
    const r = await sweepOrphanCodextenderAuthFiles({
      dir: "/virtual",
      now: () => 10_000_000,
      maxAgeMs: 1000,
      deps: {
        readdir: async () => ["codextender-auth-11111111-2222-3333-4444-555555555555.tmp"],
        stat: async () => ({ mtimeMs: 10_000_000 - 1000 }), // exactly at cutoff
        unlink: async () => {
          throw new Error("must not unlink a file exactly at the cutoff");
        },
      },
      logWarn: () => {},
      logInfo: () => {},
    });
    expect(r.deleted).toBe(0);
    expect(r.preserved).toBe(1);
  });

  it("surfaces a non-ENOENT readdir failure (EACCES) instead of silently no-op'ing", async () => {
    const warnings: string[] = [];
    const eacces = Object.assign(new Error("EACCES: permission denied"), {
      code: "EACCES",
    });
    const r = await sweepOrphanCodextenderAuthFiles({
      dir: "/virtual",
      deps: { readdir: async () => Promise.reject(eacces) },
      logWarn: (m) => warnings.push(m),
      logInfo: () => {},
    });
    expect(r).toEqual({ deleted: 0, errors: 0, preserved: 0 });
    expect(warnings.some((w) => w.includes("readdir failed"))).toBe(true);
  });

  it("stays silent on a benign ENOENT (dir not created yet)", async () => {
    const warnings: string[] = [];
    const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    await sweepOrphanCodextenderAuthFiles({
      dir: "/virtual",
      deps: { readdir: async () => Promise.reject(enoent) },
      logWarn: (m) => warnings.push(m),
      logInfo: () => {},
    });
    expect(warnings).toEqual([]);
  });

  it("counts a per-file unlink failure as an error and keeps going", async () => {
    const a = "codextender-auth-11111111-2222-3333-4444-555555555555.tmp";
    const b = "codextender-auth-22222222-3333-4444-5555-666666666666.tmp";
    let calls = 0;
    const r = await sweepOrphanCodextenderAuthFiles({
      dir: "/virtual",
      now: () => 10_000_000,
      deps: {
        // A non-matching file is never stat'd/unlinked.
        readdir: async () => [a, b, "unrelated.tmp"],
        stat: async () => ({ mtimeMs: 0 }), // ancient → both eligible
        unlink: async () => {
          calls++;
          if (calls === 1) throw new Error("EBUSY");
        },
      },
      logWarn: () => {},
      logInfo: () => {},
    });
    expect(r.deleted).toBe(1);
    expect(r.errors).toBe(1);
    expect(calls).toBe(2); // both matching entries attempted; unrelated skipped
  });
});
