/*
 * snapshot-clear-fence.test.ts — D01 / F05 RED regression guards
 * (MUST-NOT-MODIFY, author != fixer).
 *
 * SnapshotStore.clear() MUST fence the per-task write queue: a
 * flushMirrorSnapshot write enqueued BEFORE clear() must NOT resurrect the
 * snapshot after clear() resolves. On pre-fix code clear() unlinks FIRST and
 * only awaits onIdle for Map hygiene (and early-returns on ENOENT before ever
 * touching the queue), so an in-flight tmp->final rename lands the
 * secret-bearing file AFTER the privacy wipe. The gate is released on a timer
 * (not gated on clear()) so a correct fence-first fix cannot deadlock.
 *
 * Uses the store's existing SnapshotStoreOpts.renameFn seam (no new
 * production hook required). Split out of routes.delete-cascade.test.ts to
 * keep every test file <= 300 LOC (Stop-gate).
 *
 * Evidence: Spec/audits/2026-07-10-webui-deep-audit.md § F05 (CASE A + B).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { SnapshotStore } from "../terminal/snapshot-store.js";

describe("SnapshotStore.clear() — in-flight write fence (D01/F05 RED guard)", () => {
  const FENCE_UUID = "11111111-2222-3333-4444-555555555555";
  const sleep = (ms: number): Promise<void> =>
    new Promise((r) => setTimeout(r, ms));
  let fenceDir: string;

  beforeEach(async () => {
    fenceDir = await fsp.mkdtemp(path.join(os.tmpdir(), "d01-f05-"));
  });
  afterEach(async () => {
    try {
      await fsp.rm(fenceDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it("does not resurrect the snapshot when a write is in flight AND a file already exists (F05 CASE A)", async () => {
    let renameCount = 0;
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>((res) => {
      releaseGate = res;
    });
    const store = new SnapshotStore(fenceDir, {
      renameFn: async (from, to) => {
        renameCount += 1;
        // Hold the SECOND write's rename (the in-flight flush) at the gate.
        if (renameCount === 2) await gate;
        await fsp.rename(from, to);
      },
    });
    await store.init();

    // A snapshot already on disk — the artifact the DELETE cascade must wipe.
    await store.write(FENCE_UUID, { cols: 80, rows: 24, data: "OLD-SECRET" });
    // A last-detach flushMirrorSnapshot write, still in flight when clear runs.
    const inFlight = store.write(FENCE_UUID, {
      cols: 80,
      rows: 24,
      data: "SECRET-IN-FLIGHT",
    });
    await sleep(50); // 2nd write's tmp is written; its rename is gated.

    // The in-flight rename lands shortly after — models the flush completing
    // concurrently with / just after the delete. Scheduled BEFORE the clear()
    // await so a fence-first fix that waits on the queue cannot deadlock.
    setTimeout(() => releaseGate(), 60);
    await store.clear(FENCE_UUID);
    await inFlight;

    // Privacy boundary: the snapshot MUST be gone after clear() resolves.
    expect(await store.has(FENCE_UUID)).toBe(false);
  });

  it("does not resurrect the snapshot when no file exists yet at clear() time (F05 CASE B / ENOENT early-return)", async () => {
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>((res) => {
      releaseGate = res;
    });
    let firstRename = true;
    const store = new SnapshotStore(fenceDir, {
      renameFn: async (from, to) => {
        if (firstRename) {
          firstRename = false;
          await gate;
        }
        await fsp.rename(from, to);
      },
    });
    await store.init();

    // Only an in-flight write exists — no snapshot on disk yet, so pre-fix
    // clear() hits ENOENT and early-returns WITHOUT ever fencing the queue.
    const inFlight = store.write(FENCE_UUID, {
      cols: 80,
      rows: 24,
      data: "SECRET-IN-FLIGHT",
    });
    await sleep(50);

    setTimeout(() => releaseGate(), 60);
    await store.clear(FENCE_UUID);
    await inFlight;

    expect(await store.has(FENCE_UUID)).toBe(false);
  });
});
