/*
 * codex-task-watcher.thread-discovery.test.ts — Codex Light §4's threadId
 * discovery integration: `CodexTaskWatcher` attempts `discoverThreadId` for
 * any Codex task that doesn't have one yet, patches + persists a hit, and
 * de-dups against threadIds already claimed elsewhere in the store. Split
 * out from `codex-task-watcher.test.ts` to keep both files under the
 * 300-line guideline.
 */
import { describe, expect, it, vi } from "vitest";

import { CodexTaskWatcher } from "./codex-task-watcher.js";
import type { ExternalTask } from "./sdk-sessions-store.js";
import type { OracleOutcome } from "./codex-oracle-runner.js";

function makeTask(over: Partial<ExternalTask> = {}): ExternalTask {
  return {
    taskId: "t1",
    sessionUuid: "sess-1",
    cwd: "/proj",
    pluginDirs: [],
    state: "active",
    title: "T",
    projectId: "proj-1",
    runtime: "codex",
    phase: "build",
    launchedAt: "2026-09-16T00:00:00Z",
    createdAt: "2026-09-16T00:00:00Z",
    inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
    ...over,
  };
}

const NOT_DONE_ORACLE: OracleOutcome = {
  kind: "ok",
  result: { verdict: "not_done", phase: "build", session: "sess-1", evidence: {} },
};

describe("CodexTaskWatcher — §4 threadId discovery", () => {
  it("patches and persists a discovered threadId onto a task that doesn't have one yet", async () => {
    const patch = vi.fn();
    const persist = vi.fn(async () => undefined);
    // `excludeThreadIds` is the SAME Set object across the tick (mutated
    // in place as ids get claimed) — snapshot it at call time rather than
    // relying on `toHaveBeenCalledWith`, which would otherwise compare
    // against its post-mutation state.
    let capturedArgs: { cwd: string; sinceIso: string; excludeThreadIds?: ReadonlySet<string> } | undefined;
    const discoverThreadId = vi.fn(async (args: typeof capturedArgs) => {
      capturedArgs = args && { ...args, excludeThreadIds: new Set(args.excludeThreadIds) };
      return "thread-abc";
    });
    const deps = {
      store: { list: () => [makeTask({ threadId: undefined })], patch, persist },
      ptyManager: { getLastDataAt: () => 0, attachCount: () => 0, write: vi.fn() },
      getProjectById: () => ({ path: "/proj" }),
      runOracle: vi.fn(async (): Promise<OracleOutcome> => NOT_DONE_ORACLE),
      discoverThreadId,
      now: () => 0, // not stalled — isolates the discovery assertion from the nudge path
    };
    const w = new CodexTaskWatcher(deps);
    await w.tick();
    expect(capturedArgs).toEqual({
      cwd: "/proj",
      sinceIso: "2026-09-16T00:00:00Z",
      excludeThreadIds: new Set(),
    });
    expect(patch).toHaveBeenCalledWith("t1", { threadId: "thread-abc" });
    expect(persist).toHaveBeenCalled();
  });

  it("does not attempt discovery for a task that already has a threadId", async () => {
    const discoverThreadId = vi.fn(async () => "thread-should-not-be-called");
    const deps = {
      store: {
        list: () => [makeTask({ threadId: "thread-existing" })],
        patch: vi.fn(),
        persist: vi.fn(async () => undefined),
      },
      ptyManager: { getLastDataAt: () => 0, attachCount: () => 0, write: vi.fn() },
      getProjectById: () => ({ path: "/proj" }),
      runOracle: vi.fn(async (): Promise<OracleOutcome> => NOT_DONE_ORACLE),
      discoverThreadId,
      now: () => 0,
    };
    const w = new CodexTaskWatcher(deps);
    await w.tick();
    expect(discoverThreadId).not.toHaveBeenCalled();
  });

  it("excludes threadIds already claimed by other tasks in the store", async () => {
    const discoverThreadId = vi.fn(async () => null);
    const deps = {
      store: {
        list: () => [
          makeTask({ taskId: "t1", threadId: undefined }),
          makeTask({ taskId: "t2", threadId: "thread-claimed" }),
        ],
        patch: vi.fn(),
        persist: vi.fn(async () => undefined),
      },
      ptyManager: { getLastDataAt: () => 0, attachCount: () => 0, write: vi.fn() },
      getProjectById: () => ({ path: "/proj" }),
      runOracle: vi.fn(async (): Promise<OracleOutcome> => NOT_DONE_ORACLE),
      discoverThreadId,
      now: () => 0,
    };
    const w = new CodexTaskWatcher(deps);
    await w.tick();
    expect(discoverThreadId).toHaveBeenCalledWith(
      expect.objectContaining({ excludeThreadIds: new Set(["thread-claimed"]) }),
    );
  });

  it("a discovered threadId is available to the same tick's stall logic (no stale task reference)", async () => {
    const discoverThreadId = vi.fn(async () => "thread-fresh");
    const patch = vi.fn();
    const write = vi.fn();
    const deps = {
      store: { list: () => [makeTask({ threadId: undefined })], patch, persist: vi.fn(async () => undefined) },
      ptyManager: { getLastDataAt: () => 0, attachCount: () => 0, write },
      getProjectById: () => ({ path: "/proj" }),
      runOracle: vi.fn(async (): Promise<OracleOutcome> => NOT_DONE_ORACLE),
      discoverThreadId,
      now: () => 20 * 60 * 1000, // past the default stall floor
    };
    const w = new CodexTaskWatcher(deps);
    await w.tick();
    expect(patch).toHaveBeenCalledWith("t1", { threadId: "thread-fresh" });
    expect(write).toHaveBeenCalledTimes(1); // stall logic still ran against the (now-discovered) task
  });

  it("skips discovery for a task with no launchedAt (nothing to bound the search by)", async () => {
    const discoverThreadId = vi.fn(async () => "thread-should-not-be-called");
    const deps = {
      store: {
        list: () => [makeTask({ threadId: undefined, launchedAt: undefined })],
        patch: vi.fn(),
        persist: vi.fn(async () => undefined),
      },
      ptyManager: { getLastDataAt: () => 0, attachCount: () => 0, write: vi.fn() },
      getProjectById: () => ({ path: "/proj" }),
      runOracle: vi.fn(async (): Promise<OracleOutcome> => NOT_DONE_ORACLE),
      discoverThreadId,
      now: () => 0,
    };
    const w = new CodexTaskWatcher(deps);
    await w.tick();
    expect(discoverThreadId).not.toHaveBeenCalled();
  });

  // Doubt-review finding: index.ts's setInterval never awaits the prior
  // tick(), so two ticks could overlap. Without a reentrancy guard, each
  // overlapping tick would build its OWN claimedThreadIds from store.list()
  // and never see the other's in-flight discovery — two threadId-less
  // tasks in the same cwd could then be permanently bound to the same
  // rollout file.
  it("skips an overlapping tick() rather than racing thread-id discovery across ticks", async () => {
    const discoverThreadId = vi.fn(async () => "thread-abc");
    let listCalls = 0;
    const deps = {
      store: {
        list: () => {
          listCalls++;
          return [makeTask({ threadId: undefined })];
        },
        patch: vi.fn(),
        persist: vi.fn(async () => undefined),
      },
      ptyManager: { getLastDataAt: () => 0, attachCount: () => 0, write: vi.fn() },
      getProjectById: () => ({ path: "/proj" }),
      runOracle: vi.fn(async (): Promise<OracleOutcome> => NOT_DONE_ORACLE),
      discoverThreadId,
      now: () => 0,
    };
    const w = new CodexTaskWatcher(deps);
    // Fired back-to-back, NOT awaited between calls — this is what a
    // fire-and-forget setInterval callback does when a prior tick is slow.
    const p1 = w.tick();
    const p2 = w.tick();
    await Promise.all([p1, p2]);
    expect(listCalls).toBe(1); // the second call returned immediately, never ran
    expect(discoverThreadId).toHaveBeenCalledTimes(1);
  });

  it("a tick after the previous one has fully completed runs normally (guard resets)", async () => {
    const discoverThreadId = vi.fn(async () => null);
    const deps = {
      store: {
        list: () => [makeTask({ threadId: "already-has-one" })],
        patch: vi.fn(),
        persist: vi.fn(async () => undefined),
      },
      ptyManager: { getLastDataAt: () => 0, attachCount: () => 0, write: vi.fn() },
      getProjectById: () => ({ path: "/proj" }),
      runOracle: vi.fn(async (): Promise<OracleOutcome> => NOT_DONE_ORACLE),
      discoverThreadId,
      now: () => 20 * 60 * 1000, // past the default stall floor, so runOracle actually runs
    };
    const w = new CodexTaskWatcher(deps);
    await w.tick();
    await w.tick();
    expect(deps.runOracle).toHaveBeenCalledTimes(2);
  });
});
