/*
 * snapshot-tmp-sweep.test.ts — D19 (F26), 2026-07-10.
 *
 * Boundary probe (ADR-024 / references/boundary-probes.md — real files, real
 * mtime) for orphaned `<taskId>.snapshot.tmp-*` reclamation.
 *
 * AC2 (RED on pre-fix main): before this iterate, NO cleanup surface matched
 * `<taskId>.snapshot.tmp-*` — the boot wipe + sweepExpired match `.log`, the
 * DELETE cascade unlinks the exact `.snapshot` path. This suite drives the
 * new helpers over a real tmpdir: an aged orphan tmp is reclaimed while a
 * freshly-written tmp, a live `.snapshot`, and a live `.log` are ALL
 * preserved. Reverting snapshot-tmp-sweep.ts makes the import fail → RED.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import {
  clearTaskSnapshotTmp,
  sweepOrphanSnapshotTmp,
} from "./snapshot-tmp-sweep.js";
import { SnapshotStore } from "./snapshot-store.js";
import { runBootWipe } from "./boot-wipe.js";

const UUID = "11111111-2222-3333-4444-555555555555";
const UUID_2 = "22222222-3333-4444-5555-666666666666";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "snap-tmp-sweep-"));
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

describe("sweepOrphanSnapshotTmp — orphan reclamation (D19/F26, AC2)", () => {
  it("reclaims an aged orphan tmp; preserves fresh tmp, live .snapshot, live .log", async () => {
    // Orphaned staging file (interrupted write) — mtime backdated 2h.
    const orphan = path.join(
      dir,
      `${UUID}.snapshot.tmp-1234-1700000000000-abcd1234`,
    );
    await fs.writeFile(orphan, "stranded terminal cell-state (may hold secrets)");
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await fs.utimes(orphan, twoHoursAgo, twoHoursAgo);

    // Fresh tmp — an in-flight write mid-rename; must survive.
    const fresh = path.join(
      dir,
      `${UUID_2}.snapshot.tmp-9999-${Date.now()}-effff000`,
    );
    await fs.writeFile(fresh, "in-flight");

    // Live artifacts the sweep must NEVER touch.
    const liveSnap = path.join(dir, `${UUID}.snapshot`);
    const liveLog = path.join(dir, `${UUID}.log`);
    await fs.writeFile(
      liveSnap,
      "# shipwright-snapshot v2 xterm@6.0.0 80x24\ndata",
    );
    await fs.writeFile(liveLog, "scrollback bytes");

    const r = await sweepOrphanSnapshotTmp({
      dir,
      logWarn: () => {},
      logInfo: () => {},
    });

    expect(r.deleted).toBe(1);
    expect(r.preserved).toBe(1);
    expect(r.errors).toBe(0);
    expect(await exists(orphan)).toBe(false); // reclaimed
    expect(await exists(fresh)).toBe(true); // in-flight write survives
    expect(await exists(liveSnap)).toBe(true); // live snapshot preserved
    expect(await exists(liveLog)).toBe(true); // live scrollback preserved
  });

  it("returns a zero-work result when the dir is missing", async () => {
    const missing = path.join(dir, "does-not-exist");
    const r = await sweepOrphanSnapshotTmp({
      dir: missing,
      logWarn: () => {},
      logInfo: () => {},
    });
    expect(r).toEqual({ deleted: 0, errors: 0, preserved: 0 });
  });

  it("preserves a tmp whose mtime is exactly at the cutoff (>= is inclusive)", async () => {
    // OpenAI plan-review #5 — pin the exact-threshold boundary so a fresh file
    // at `now - maxAgeMs` is never deleted by an off-by-one.
    const r = await sweepOrphanSnapshotTmp({
      dir: "/virtual",
      now: () => 10_000_000,
      maxAgeMs: 1000,
      deps: {
        readdir: async () => [`${UUID}.snapshot.tmp-1-1-aaaa`],
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
    // Code-review #2 — a real dir-read failure must stay visible so the
    // privacy-cleanup gap is not hidden. ENOENT stays silent (benign).
    const warnings: string[] = [];
    const eacces = Object.assign(new Error("EACCES: permission denied"), {
      code: "EACCES",
    });
    const r = await sweepOrphanSnapshotTmp({
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
    await sweepOrphanSnapshotTmp({
      dir: "/virtual",
      deps: { readdir: async () => Promise.reject(enoent) },
      logWarn: (m) => warnings.push(m),
      logInfo: () => {},
    });
    expect(warnings).toEqual([]);
  });

  it("counts a per-file unlink failure as an error and keeps going", async () => {
    const a = `${UUID}.snapshot.tmp-1-1-aaaa`;
    const b = `${UUID_2}.snapshot.tmp-2-2-bbbb`;
    let calls = 0;
    const r = await sweepOrphanSnapshotTmp({
      dir: "/virtual",
      now: () => 10_000_000,
      deps: {
        // "keep.log" + a bare `.snapshot` are non-tmp → never stat'd/unlinked.
        readdir: async () => [a, b, "keep.log", `${UUID}.snapshot`],
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
    expect(calls).toBe(2); // both tmp entries attempted; non-tmp skipped
  });
});

describe("clearTaskSnapshotTmp — DELETE-cascade per-task clear (D19/F26)", () => {
  it("removes only the target task's tmp siblings; leaves other task + live .snapshot", async () => {
    const t1a = path.join(dir, `${UUID}.snapshot.tmp-1-1-aaaa`);
    const t1b = path.join(dir, `${UUID}.snapshot.tmp-2-2-bbbb`);
    const t2 = path.join(dir, `${UUID_2}.snapshot.tmp-3-3-cccc`);
    const snap = path.join(dir, `${UUID}.snapshot`);
    await Promise.all(
      [t1a, t1b, t2, snap].map((p, i) => fs.writeFile(p, `x${i}`)),
    );

    const n = await clearTaskSnapshotTmp({ dir, taskId: UUID, logWarn: () => {} });

    expect(n).toBe(2);
    expect(await exists(t1a)).toBe(false);
    expect(await exists(t1b)).toBe(false);
    expect(await exists(t2)).toBe(true); // other task's tmp untouched
    expect(await exists(snap)).toBe(true); // live snapshot untouched
  });

  it("no-ops (returns 0) on a malformed taskId", async () => {
    const n = await clearTaskSnapshotTmp({ dir, taskId: "not-a-uuid" });
    expect(n).toBe(0);
  });

  it("returns 0 on a missing dir", async () => {
    const n = await clearTaskSnapshotTmp({
      dir: path.join(dir, "nope"),
      taskId: UUID,
    });
    expect(n).toBe(0);
  });
});

describe("existing cleanup surfaces leave `.snapshot.tmp-*` untouched (F26 gap)", () => {
  // OpenAI plan-review #8 — document the defect behaviorally: the ONLY
  // pre-fix boot cleanup (runBootWipe) matches `.log*`, so an orphaned
  // `.snapshot.tmp-*` survives it. This is exactly the leak the new sweep closes.
  it("runBootWipe wipes `.log*` but never a `.snapshot.tmp-*` stray", async () => {
    const unlinked: string[] = [];
    await runBootWipe({
      dir: "/scroll",
      deps: {
        stat: async () => null, // marker absent → wipe runs
        readdir: async () => [
          `${UUID}.snapshot.tmp-1-1-aaaa`,
          `${UUID}.snapshot`,
          `${UUID}.log`,
        ],
        unlink: async (p) => {
          unlinked.push(p);
        },
        writeFile: async () => {},
      },
      logWarn: () => {},
      logInfo: () => {},
    });
    expect(unlinked.some((p) => p.includes(".snapshot.tmp-"))).toBe(false);
    expect(unlinked.some((p) => p.includes(".snapshot") && !p.includes(".tmp-"))).toBe(false);
    expect(unlinked.some((p) => p.endsWith(`${UUID}.log`))).toBe(true);
  });
});

describe("SnapshotStore.clear() sweeps tmp strays behind the fence (D19/F26)", () => {
  // Placed here (not snapshot-store.test.ts, which is at its 423 bloat baseline)
  // since this exercises the tmp-reclamation domain owned by this module.
  it("reclaims orphaned tmp strays even when the final `.snapshot` is absent", async () => {
    const store = new SnapshotStore(dir);
    await store.init();
    // Interrupted write left ONLY a tmp stray (no final `.snapshot`) — the
    // exact F26 scenario; the old ENOENT early-return would have skipped it.
    const stray = path.join(dir, `${UUID}.snapshot.tmp-4-4-dddd`);
    await fs.writeFile(stray, "stranded cell-state");
    const otherTmp = path.join(dir, `${UUID_2}.snapshot.tmp-5-5-eeee`);
    await fs.writeFile(otherTmp, "other task");

    await store.clear(UUID);

    expect(await exists(stray)).toBe(false); // reclaimed despite no final
    expect(await exists(otherTmp)).toBe(true); // sibling task untouched
  });

  it("removes the live `.snapshot` AND its tmp strays together", async () => {
    const store = new SnapshotStore(dir);
    await store.init();
    await store.write(UUID, { cols: 80, rows: 24, data: "live" });
    const stray = path.join(dir, `${UUID}.snapshot.tmp-6-6-ffff`);
    await fs.writeFile(stray, "stray");
    expect(await store.has(UUID)).toBe(true);

    await store.clear(UUID);

    expect(await store.has(UUID)).toBe(false); // final gone
    expect(await exists(stray)).toBe(false); // stray gone
  });
});
