/*
 * Unit coverage for the shared task "last modified" sort helpers
 * (iterate-2026-07-08-board-sort-last-modified).
 *
 * These pin the canonical ordering used by BOTH the Task Board columns and
 * the List view: the precedence chain, descending order, the deterministic
 * `taskId` tiebreak (AC-4), and defensive handling of malformed timestamps
 * (external-review edge-cases #3/#4).
 */
import { describe, it, expect } from "vitest";

import type { ExternalTask } from "./externalApi";
import {
  taskLastModifiedMs,
  compareTasksByLastModifiedDesc,
  sortTasksByLastModifiedDesc,
} from "./taskSort";

function mk(over: Partial<ExternalTask> & { taskId: string }): ExternalTask {
  return {
    sessionUuid: `uuid-${over.taskId}`,
    title: over.taskId,
    cwd: "/tmp/p",
    pluginDirs: [],
    projectId: "p",
    state: "draft",
    createdAt: "2026-01-01T00:00:00Z",
    inbox: {
      pendingToolUseIds: [],
      dismissedToolUseIds: [],
      lastProcessedByteOffset: 0,
    },
    ...over,
  } as ExternalTask;
}

describe("taskLastModifiedMs — precedence chain", () => {
  // @covers FR-01.01
  it("prefers lastJsonlSeenMtimeMs over launchedAt and createdAt", () => {
    const task = mk({
      taskId: "a",
      lastJsonlSeenMtimeMs: 5_000,
      launchedAt: "2026-01-01T00:00:02Z", // 2000 ms
      createdAt: "2026-01-01T00:00:01Z", // 1000 ms
    });
    expect(taskLastModifiedMs(task)).toBe(5_000);
  });

  // @covers FR-01.01
  it("falls back to launchedAt when mtime is absent", () => {
    const task = mk({
      taskId: "a",
      launchedAt: "2026-01-01T00:00:02Z",
      createdAt: "2026-01-01T00:00:01Z",
    });
    expect(taskLastModifiedMs(task)).toBe(Date.parse("2026-01-01T00:00:02Z"));
  });

  // @covers FR-01.01
  it("falls back to createdAt when mtime + launchedAt are absent", () => {
    const task = mk({ taskId: "a", createdAt: "2026-01-01T00:00:01Z" });
    expect(taskLastModifiedMs(task)).toBe(Date.parse("2026-01-01T00:00:01Z"));
  });

  // @covers FR-01.01
  it("returns 0 when no timestamp resolves", () => {
    const task = mk({ taskId: "a", createdAt: "" });
    expect(taskLastModifiedMs(task)).toBe(0);
  });
});

describe("taskLastModifiedMs — defensive against malformed timestamps", () => {
  // @covers FR-01.01
  it("skips a non-finite mtime and uses the next source (never poisons the sort)", () => {
    const task = mk({
      taskId: "a",
      lastJsonlSeenMtimeMs: Number.NaN,
      launchedAt: "2026-01-01T00:00:02Z",
    });
    expect(taskLastModifiedMs(task)).toBe(Date.parse("2026-01-01T00:00:02Z"));
  });

  // @covers FR-01.01
  it("skips an unparseable launchedAt and uses createdAt", () => {
    const task = mk({
      taskId: "a",
      launchedAt: "not-a-date",
      createdAt: "2026-01-01T00:00:01Z",
    });
    expect(taskLastModifiedMs(task)).toBe(Date.parse("2026-01-01T00:00:01Z"));
  });

  // @covers FR-01.01
  it("returns a finite number even when every source is malformed", () => {
    const task = mk({
      taskId: "a",
      lastJsonlSeenMtimeMs: Number.POSITIVE_INFINITY,
      launchedAt: "nope",
      createdAt: "also-nope",
    });
    expect(Number.isFinite(taskLastModifiedMs(task))).toBe(true);
    expect(taskLastModifiedMs(task)).toBe(0);
  });
});

describe("compareTasksByLastModifiedDesc — order + determinism", () => {
  // @covers FR-01.01
  it("orders newest-first", () => {
    const older = mk({ taskId: "older", lastJsonlSeenMtimeMs: 1_000 });
    const newer = mk({ taskId: "newer", lastJsonlSeenMtimeMs: 9_000 });
    expect(compareTasksByLastModifiedDesc(newer, older)).toBeLessThan(0);
    expect(compareTasksByLastModifiedDesc(older, newer)).toBeGreaterThan(0);
  });

  // @covers FR-01.01
  it("breaks ties by taskId ascending (string compare, not numeric)", () => {
    const a = mk({ taskId: "aaa", lastJsonlSeenMtimeMs: 1_000 });
    const b = mk({ taskId: "bbb", lastJsonlSeenMtimeMs: 1_000 });
    expect(compareTasksByLastModifiedDesc(a, b)).toBeLessThan(0);
    expect(compareTasksByLastModifiedDesc(b, a)).toBeGreaterThan(0);
  });

  // @covers FR-01.01
  it("is deterministic: same input in any order yields the same sorted order", () => {
    const t1 = mk({ taskId: "t1", lastJsonlSeenMtimeMs: 1_000 });
    const t2 = mk({ taskId: "t2", lastJsonlSeenMtimeMs: 1_000 });
    const t3 = mk({ taskId: "t3", lastJsonlSeenMtimeMs: 1_000 });
    const forward = [t1, t2, t3].sort(compareTasksByLastModifiedDesc).map((t) => t.taskId);
    const reverse = [t3, t2, t1].sort(compareTasksByLastModifiedDesc).map((t) => t.taskId);
    expect(forward).toEqual(["t1", "t2", "t3"]);
    expect(reverse).toEqual(["t1", "t2", "t3"]);
  });
});

describe("sortTasksByLastModifiedDesc — immutability + full order", () => {
  // @covers FR-01.01
  it("returns a NEW array without mutating the input", () => {
    const input = [
      mk({ taskId: "old", lastJsonlSeenMtimeMs: 1_000 }),
      mk({ taskId: "new", lastJsonlSeenMtimeMs: 9_000 }),
    ];
    const snapshot = input.map((t) => t.taskId);
    const out = sortTasksByLastModifiedDesc(input);
    expect(out).not.toBe(input);
    expect(input.map((t) => t.taskId)).toEqual(snapshot); // input untouched
    expect(out.map((t) => t.taskId)).toEqual(["new", "old"]);
  });

  // @covers FR-01.01
  it("mixes mtime / launchedAt / createdAt sources into one newest-first order", () => {
    const byMtime = mk({ taskId: "m", lastJsonlSeenMtimeMs: 3_000 });
    const byLaunched = mk({ taskId: "l", launchedAt: new Date(2_000).toISOString() });
    const byCreated = mk({ taskId: "c", createdAt: new Date(1_000).toISOString() });
    const out = sortTasksByLastModifiedDesc([byCreated, byMtime, byLaunched]);
    expect(out.map((t) => t.taskId)).toEqual(["m", "l", "c"]);
  });
});
