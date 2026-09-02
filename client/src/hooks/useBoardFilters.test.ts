/*
 * useBoardFilters — the board's status + lead-tag filter state (FR-04.11).
 */
import { act, renderHook } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { useBoardFilters } from "./useBoardFilters";
import { LEAD_ORIGIN_TAG_PREFIX, LEAD_WAIT_TAG_PREFIX, LEAD_DEDUP_TAG_PREFIX } from "../lib/leadTags";
import type { ExternalTask, ExternalTaskState } from "../lib/externalApi";

function task(
  opts: { state?: ExternalTaskState; tags?: string[]; claimedBy?: string } = {},
): ExternalTask {
  return {
    taskId: `t-${Math.random()}`,
    sessionUuid: "u",
    title: "t",
    cwd: "/tmp",
    pluginDirs: [],
    projectId: "p",
    state: opts.state ?? "draft",
    createdAt: "2026-04-23T15:00:00Z",
    inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
    tags: opts.tags,
    claimedBy: opts.claimedBy,
  };
}

describe("useBoardFilters — status filter", () => {
  // @covers FR-01.01
  it("starts with an empty filter and zeroed counts", () => {
    const { result } = renderHook(() => useBoardFilters([]));
    expect(result.current.statusFilter.size).toBe(0);
    expect(result.current.statusCounts.draft).toBe(0);
  });

  // @covers FR-01.01
  it("toggleStatus adds/removes and filteredTasks narrows to the selected states", () => {
    const tasks = [task({ state: "draft" }), task({ state: "done" })];
    const { result } = renderHook(() => useBoardFilters(tasks));
    act(() => result.current.toggleStatus("draft"));
    expect(result.current.filteredTasks).toHaveLength(1);
    expect(result.current.filteredTasks[0].state).toBe("draft");
    act(() => result.current.clearStatusFilter());
    expect(result.current.filteredTasks).toHaveLength(2);
  });
});

describe("useBoardFilters — lead-tag filter", () => {
  // @covers FR-01.01
  it("computes per-prefix counts over the given task list", () => {
    const tasks = [task({ tags: ["lead:a"] }), task({ tags: ["lead:b"] }), task({ tags: ["lead-wait:po"] }), task({ tags: ["lead-dedup:x"] })];
    const { result } = renderHook(() => useBoardFilters(tasks));
    expect(result.current.leadTagCounts[LEAD_ORIGIN_TAG_PREFIX]).toBe(2);
    expect(result.current.leadTagCounts[LEAD_WAIT_TAG_PREFIX]).toBe(1);
    expect(result.current.leadTagCounts[LEAD_DEDUP_TAG_PREFIX]).toBe(1);
  });

  // @covers FR-01.01
  it("leadTagTotal is the project-filtered task count, NOT the sum of per-prefix counts", () => {
    // One task carries TWO prefixes — a naive sum would double-count it, and
    // TWO ordinary tasks contribute 0 to any sum despite being part of "All".
    // (external code review, iterate-2026-09-01-lead-board-surface: with only
    // one ordinary task, sumOfBuckets and leadTagTotal both land on 3 and the
    // test can't tell the correct total from the buggy sum-of-buckets — two
    // ordinary tasks makes them diverge: sum=3, total=4.)
    const tasks = [
      task({ tags: ["lead:a", "lead-wait:po"] }),
      task({ tags: ["lead-dedup:x"] }),
      task({}), // ordinary, no lead tags
      task({}), // ordinary, no lead tags
    ];
    const { result } = renderHook(() => useBoardFilters(tasks));
    const sumOfBuckets =
      result.current.leadTagCounts[LEAD_ORIGIN_TAG_PREFIX] +
      result.current.leadTagCounts[LEAD_WAIT_TAG_PREFIX] +
      result.current.leadTagCounts[LEAD_DEDUP_TAG_PREFIX];
    expect(sumOfBuckets).toBe(3); // would be double-counted + missing both ordinary tasks
    expect(result.current.leadTagTotal).toBe(4);
    expect(result.current.leadTagTotal).not.toBe(sumOfBuckets);
  });

  // @covers FR-01.01
  it("toggleLeadTag adds and removes a prefix from the filter Set", () => {
    const { result } = renderHook(() => useBoardFilters([]));
    act(() => result.current.toggleLeadTag(LEAD_ORIGIN_TAG_PREFIX));
    expect(result.current.leadTagFilter.has(LEAD_ORIGIN_TAG_PREFIX)).toBe(true);
    act(() => result.current.toggleLeadTag(LEAD_ORIGIN_TAG_PREFIX));
    expect(result.current.leadTagFilter.has(LEAD_ORIGIN_TAG_PREFIX)).toBe(false);
  });

  // @covers FR-01.01
  it("clearLeadTagFilter resets to empty", () => {
    const { result } = renderHook(() => useBoardFilters([]));
    act(() => result.current.toggleLeadTag(LEAD_WAIT_TAG_PREFIX));
    act(() => result.current.clearLeadTagFilter());
    expect(result.current.leadTagFilter.size).toBe(0);
  });

  // @covers FR-01.01
  it("counts stay stable across re-renders that only change the filter, not the task list", () => {
    const tasks = [task({ tags: ["lead:a"] })];
    const { result, rerender } = renderHook(({ list }) => useBoardFilters(list), {
      initialProps: { list: tasks },
    });
    act(() => result.current.toggleLeadTag(LEAD_ORIGIN_TAG_PREFIX));
    rerender({ list: tasks });
    expect(result.current.leadTagCounts[LEAD_ORIGIN_TAG_PREFIX]).toBe(1);
  });
});

describe("useBoardFilters — claim filter (FR-04.22)", () => {
  // @covers FR-04.22
  it("starts inactive and filteredTasks is unaffected", () => {
    const tasks = [task({ claimedBy: "po" }), task({})];
    const { result } = renderHook(() => useBoardFilters(tasks));
    expect(result.current.claimFilter).toBe(false);
    expect(result.current.filteredTasks).toHaveLength(2);
  });

  // @covers FR-04.22
  it("toggleClaim narrows to tasks carrying claimedBy, keyed off claimedBy not state", () => {
    const tasks = [
      task({ state: "done", claimedBy: "po" }), // claimed while state is "done"
      task({ state: "draft" }),
    ];
    const { result } = renderHook(() => useBoardFilters(tasks));
    act(() => result.current.toggleClaim());
    expect(result.current.filteredTasks).toHaveLength(1);
    expect(result.current.filteredTasks[0].claimedBy).toBe("po");
    act(() => result.current.toggleClaim());
    expect(result.current.filteredTasks).toHaveLength(2);
  });

  // @covers FR-04.22
  it("clearClaimFilter resets to inactive", () => {
    const { result } = renderHook(() => useBoardFilters([]));
    act(() => result.current.toggleClaim());
    act(() => result.current.clearClaimFilter());
    expect(result.current.claimFilter).toBe(false);
  });

  // @covers FR-04.22
  it("is its own axis: does not change statusFilter's behaviour", () => {
    const tasks = [
      task({ state: "draft", claimedBy: "po" }),
      task({ state: "draft" }),
      task({ state: "done" }),
    ];
    const { result } = renderHook(() => useBoardFilters(tasks));
    act(() => result.current.toggleStatus("draft"));
    expect(result.current.filteredTasks).toHaveLength(2); // status filter alone: unaffected by claim
    act(() => result.current.toggleClaim());
    expect(result.current.filteredTasks).toHaveLength(1); // status AND claim
    expect(result.current.filteredTasks[0].claimedBy).toBe("po");
  });

  // @covers FR-04.22
  it("clearAllFilters also resets the claim axis", () => {
    const { result } = renderHook(() => useBoardFilters([]));
    act(() => result.current.toggleClaim());
    act(() => result.current.clearAllFilters());
    expect(result.current.claimFilter).toBe(false);
  });
});

describe("useBoardFilters — combined status + lead-tag filtering", () => {
  // @covers FR-01.01
  it("ANDs both filters together in filteredTasks", () => {
    const tasks = [
      task({ state: "draft", tags: ["lead:a"] }),
      task({ state: "done", tags: ["lead:b"] }),
      task({ state: "draft", tags: [] }),
    ];
    const { result } = renderHook(() => useBoardFilters(tasks));
    act(() => result.current.toggleStatus("draft"));
    act(() => result.current.toggleLeadTag(LEAD_ORIGIN_TAG_PREFIX));
    expect(result.current.filteredTasks).toHaveLength(1);
    expect(result.current.filteredTasks[0].state).toBe("draft");
  });

  // @covers FR-01.01
  it("noFilterMatches is true only when a filter is active, the project has tasks, but none match", () => {
    const tasks = [task({ state: "draft", tags: [] })];
    const { result } = renderHook(() => useBoardFilters(tasks));
    expect(result.current.noFilterMatches).toBe(false);
    act(() => result.current.toggleLeadTag(LEAD_ORIGIN_TAG_PREFIX));
    expect(result.current.noFilterMatches).toBe(true);
    act(() => result.current.clearAllFilters());
    expect(result.current.noFilterMatches).toBe(false);
    expect(result.current.leadTagFilter.size).toBe(0);
    expect(result.current.statusFilter.size).toBe(0);
  });

  // @covers FR-01.01
  it("noFilterMatches is false for a genuinely empty project (no filter needed to explain zero cards)", () => {
    const { result } = renderHook(() => useBoardFilters([]));
    act(() => result.current.toggleLeadTag(LEAD_ORIGIN_TAG_PREFIX));
    expect(result.current.noFilterMatches).toBe(false);
  });
});
