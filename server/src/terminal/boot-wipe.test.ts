/*
 * boot-wipe.test.ts — Iterate C (ADR-087).
 *
 * Coverage:
 *   - Wipes `.log` + `.log.1` etc., preserves `.snapshot`.
 *   - Writes marker AFTER unlinks, returns deleted count.
 *   - Idempotent — second call with marker present is a no-op.
 *   - Marker-write failure does NOT trigger re-wipe semantically (we
 *     verify the result's `markerWritten=false`; callers know to log).
 *   - Per-file unlink failure is non-fatal (other files still wiped).
 *   - Dir-read failure is non-fatal (returns without marker).
 *
 * Strategy: stub the deps so we never touch real disk in unit tests.
 * The boot-wipe-integration.test.ts (separate file) runs the real
 * code path against a tmpdir for end-to-end confidence.
 */

import { describe, expect, it, vi } from "vitest";

import {
  ITERATE_C_WIPE_MARKER,
  runBootWipe,
  type BootWipeDeps,
} from "./boot-wipe.js";

function makeDeps(overrides: Partial<BootWipeDeps> = {}): BootWipeDeps {
  return {
    readdir: vi.fn().mockResolvedValue([]),
    unlink: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe("runBootWipe — first boot (no marker)", () => {
  it("wipes .log + .log.1 + .log.2 files; preserves .snapshot", async () => {
    const unlinkCalls: string[] = [];
    const deps = makeDeps({
      readdir: vi
        .fn()
        .mockResolvedValue([
          "task-a.log",
          "task-a.log.1",
          "task-b.log",
          "task-c.snapshot",
          "task-d.log.5",
          "unrelated.txt",
        ]),
      unlink: vi.fn().mockImplementation((p: string) => {
        unlinkCalls.push(p);
        return Promise.resolve();
      }),
      stat: vi.fn().mockResolvedValue(null),
    });
    const r = await runBootWipe({ dir: "/scroll", deps, logWarn: () => {}, logInfo: () => {} });
    expect(r.skipped).toBe(false);
    expect(r.deleted).toBe(4);
    expect(r.errors).toBe(0);
    expect(r.markerWritten).toBe(true);
    expect(unlinkCalls).toEqual([
      expect.stringContaining("task-a.log"),
      expect.stringContaining("task-a.log.1"),
      expect.stringContaining("task-b.log"),
      expect.stringContaining("task-d.log.5"),
    ]);
    // None of the snapshot or unrelated file paths got unlinked.
    expect(unlinkCalls.find((p) => p.endsWith(".snapshot"))).toBeUndefined();
    expect(unlinkCalls.find((p) => p.endsWith("unrelated.txt"))).toBeUndefined();
  });

  it("writes the marker AFTER unlinks complete", async () => {
    const callOrder: string[] = [];
    const deps = makeDeps({
      readdir: vi.fn().mockResolvedValue(["a.log", "b.log"]),
      unlink: vi.fn().mockImplementation(async (p: string) => {
        callOrder.push(`unlink:${p}`);
      }),
      writeFile: vi.fn().mockImplementation(async (p: string) => {
        callOrder.push(`writeFile:${p}`);
      }),
      stat: vi.fn().mockResolvedValue(null),
    });
    await runBootWipe({ dir: "/scroll", deps, logWarn: () => {}, logInfo: () => {} });
    // Last entry is the marker write.
    expect(callOrder[callOrder.length - 1]).toContain(ITERATE_C_WIPE_MARKER);
    // Both unlinks ran first.
    expect(callOrder.slice(0, 2)).toEqual([
      expect.stringContaining("unlink"),
      expect.stringContaining("unlink"),
    ]);
  });
});

describe("runBootWipe — second boot (marker exists)", () => {
  it("is a no-op when the marker file exists", async () => {
    const deps = makeDeps({
      stat: vi.fn().mockResolvedValue({ isFile: () => true }),
      readdir: vi.fn().mockResolvedValue(["should-not-be-wiped.log"]),
      unlink: vi.fn(),
      writeFile: vi.fn(),
    });
    const r = await runBootWipe({ dir: "/scroll", deps, logWarn: () => {}, logInfo: () => {} });
    expect(r.skipped).toBe(true);
    expect(r.deleted).toBe(0);
    expect(r.markerWritten).toBe(false);
    expect(deps.unlink).not.toHaveBeenCalled();
    expect(deps.readdir).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });
});

describe("runBootWipe — partial failure", () => {
  it("continues past a single unlink failure and writes the marker", async () => {
    const deps = makeDeps({
      readdir: vi.fn().mockResolvedValue(["a.log", "b.log", "c.log"]),
      unlink: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("EBUSY"))
        .mockResolvedValueOnce(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
      stat: vi.fn().mockResolvedValue(null),
    });
    const r = await runBootWipe({ dir: "/scroll", deps, logWarn: () => {}, logInfo: () => {} });
    expect(r.deleted).toBe(2);
    expect(r.errors).toBe(1);
    expect(r.markerWritten).toBe(true);
  });

  it("does NOT write the marker when readdir fails (so next boot retries)", async () => {
    const deps = makeDeps({
      readdir: vi.fn().mockRejectedValue(new Error("ENOENT")),
      stat: vi.fn().mockResolvedValue(null),
    });
    const r = await runBootWipe({ dir: "/missing", deps, logWarn: () => {}, logInfo: () => {} });
    expect(r.skipped).toBe(false);
    expect(r.deleted).toBe(0);
    expect(r.markerWritten).toBe(false);
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it("treats marker-write failure as recoverable; deletions still counted", async () => {
    const deps = makeDeps({
      readdir: vi.fn().mockResolvedValue(["a.log"]),
      unlink: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockRejectedValue(new Error("EACCES")),
      stat: vi.fn().mockResolvedValue(null),
    });
    const r = await runBootWipe({ dir: "/scroll", deps, logWarn: () => {}, logInfo: () => {} });
    expect(r.deleted).toBe(1);
    expect(r.errors).toBe(0);
    expect(r.markerWritten).toBe(false);
  });
});
