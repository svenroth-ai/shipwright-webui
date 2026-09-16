/*
 * codex-task-watcher.delivery.test.ts — §5.1's `delivery_pending` branch,
 * split out of codex-task-watcher.test.ts (300-line guideline). Covers the
 * `evidence.delivery_state` branching correction (2026-09-16 review): a
 * `delivery_pending` verdict must never re-poll-forever-looking when the
 * shipped oracle's own `checks_failed`/`closed` branch (delivery_state=
 * "error") fired, never nudge in either delivery_pending case, and — per
 * an external-code-review finding — must not leave a stale delivery_error
 * notice once a later tick reports anything else.
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

function makeDeps(over: { lastDataAt?: number | null; attachCount?: number; now?: number; oracle: OracleOutcome }) {
  const write = vi.fn();
  const deps = {
    store: { list: () => [makeTask()], patch: vi.fn(), persist: vi.fn(async () => undefined) },
    ptyManager: {
      getLastDataAt: () => (over.lastDataAt === undefined ? 0 : over.lastDataAt),
      attachCount: () => over.attachCount ?? 0,
      write,
    },
    getProjectById: () => ({ path: "/proj" }),
    runOracle: vi.fn(async () => over.oracle),
    now: () => over.now ?? 20 * 60 * 1000,
  };
  return { deps, write };
}

describe("CodexTaskWatcher — delivery_pending classification", () => {
  it("delivery_state absent → never nudges, no notice (still re-pollable)", async () => {
    const { deps, write } = makeDeps({
      oracle: { kind: "ok", result: { verdict: "delivery_pending", phase: "iterate", session: "sess-1", evidence: {} } },
    });
    const w = new CodexTaskWatcher(deps);
    await w.tick();
    expect(write).not.toHaveBeenCalled();
    expect(w.snapshot().some((n) => n.kind === "delivery_error")).toBe(false);
  });

  it("delivery_state='indeterminate' → same as absent, never a delivery_error notice", async () => {
    const { deps } = makeDeps({
      oracle: {
        kind: "ok",
        result: { verdict: "delivery_pending", phase: "iterate", session: "sess-1", evidence: { delivery_state: "indeterminate" } },
      },
    });
    const w = new CodexTaskWatcher(deps);
    await w.tick();
    expect(w.snapshot().some((n) => n.kind === "delivery_error")).toBe(false);
  });

  it("delivery_state='error' → surfaces a delivery_error notice, never nudges", async () => {
    const { deps, write } = makeDeps({
      oracle: {
        kind: "ok",
        result: { verdict: "delivery_pending", phase: "iterate", session: "sess-1", evidence: { delivery_state: "error" } },
      },
    });
    const w = new CodexTaskWatcher(deps);
    await w.tick();
    expect(write).not.toHaveBeenCalled();
    const notice = w.snapshot().find((n) => n.taskId === "t1");
    expect(notice?.kind).toBe("delivery_error");
  });

  it("delivery_error notice clears once a later tick reports delivery_state='indeterminate' (external-review finding)", async () => {
    let evidence: { delivery_state?: "error" | "indeterminate" } = { delivery_state: "error" };
    const deps = {
      store: { list: () => [makeTask()], patch: vi.fn(), persist: vi.fn(async () => undefined) },
      ptyManager: { getLastDataAt: () => 0, attachCount: () => 0, write: vi.fn() },
      getProjectById: () => ({ path: "/proj" }),
      runOracle: vi.fn(async (): Promise<OracleOutcome> => ({
        kind: "ok",
        result: { verdict: "delivery_pending", phase: "iterate", session: "sess-1", evidence },
      })),
      now: () => 20 * 60 * 1000,
    };
    const w = new CodexTaskWatcher(deps);
    await w.tick();
    expect(w.snapshot().find((n) => n.taskId === "t1")?.kind).toBe("delivery_error");

    evidence = { delivery_state: "indeterminate" };
    await w.tick();
    expect(w.snapshot().find((n) => n.taskId === "t1")).toBeUndefined();
  });

  it("delivery_error notice clears once a later tick reports not_done (delivery retry resumed real work)", async () => {
    let outcome: OracleOutcome = {
      kind: "ok",
      result: { verdict: "delivery_pending", phase: "iterate", session: "sess-1", evidence: { delivery_state: "error" } },
    };
    const deps = {
      store: { list: () => [makeTask()], patch: vi.fn(), persist: vi.fn(async () => undefined) },
      ptyManager: { getLastDataAt: () => 0, attachCount: () => 1, write: vi.fn() },
      getProjectById: () => ({ path: "/proj" }),
      runOracle: vi.fn(async (): Promise<OracleOutcome> => outcome),
      now: () => 20 * 60 * 1000,
    };
    const w = new CodexTaskWatcher(deps);
    await w.tick();
    expect(w.snapshot().find((n) => n.taskId === "t1")?.kind).toBe("delivery_error");

    outcome = { kind: "ok", result: { verdict: "not_done", phase: "iterate", session: "sess-1", evidence: {} } };
    await w.tick();
    expect(w.snapshot().find((n) => n.taskId === "t1")).toBeUndefined();
  });
});
