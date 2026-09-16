/*
 * codex-task-watcher.test.ts — §5.1's classification table (not_done,
 * done, no_oracle, launch-confirmation). `delivery_pending` branch
 * coverage split into codex-task-watcher.delivery.test.ts (300-line
 * guideline).
 */
import { describe, expect, it, vi } from "vitest";

import { CodexTaskWatcher, DEFAULT_STALL_TIMEOUT_MS } from "./codex-task-watcher.js";
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

function makeDeps(over: {
  tasks?: ExternalTask[];
  lastDataAt?: number | null;
  attachCount?: number;
  now?: number;
  oracle: OracleOutcome;
}) {
  const patch = vi.fn();
  const persist = vi.fn(async () => undefined);
  const write = vi.fn();
  const runOracle = vi.fn(async () => over.oracle);
  const deps = {
    store: {
      list: () => over.tasks ?? [makeTask()],
      patch,
      persist,
    },
    ptyManager: {
      getLastDataAt: () => (over.lastDataAt === undefined ? 0 : over.lastDataAt),
      attachCount: () => over.attachCount ?? 0,
      write,
    },
    getProjectById: () => ({ path: "/proj" }),
    runOracle,
    now: () => over.now ?? 20 * 60 * 1000, // 20min after epoch, past the default 15min stall floor
  };
  return { deps, patch, persist, write, runOracle };
}

describe("CodexTaskWatcher — classification", () => {
  it("not_done + silent + no attach → nudges once", async () => {
    const { deps, write } = makeDeps({
      oracle: { kind: "ok", result: { verdict: "not_done", phase: "build", session: "sess-1", evidence: {} } },
    });
    const w = new CodexTaskWatcher(deps);
    await w.tick();
    expect(write).toHaveBeenCalledTimes(1);
    expect(deps.ptyManager.write).toBeDefined();
    expect(w.snapshot().some((n) => n.kind === "nudge_sent")).toBe(true);
  });

  it("not_done + attached client → does NOT nudge", async () => {
    const { deps, write } = makeDeps({
      attachCount: 1,
      oracle: { kind: "ok", result: { verdict: "not_done", phase: "build", session: "sess-1", evidence: {} } },
    });
    const w = new CodexTaskWatcher(deps);
    await w.tick();
    expect(write).not.toHaveBeenCalled();
  });

  it("not_done → nudges at most once per stall episode (same lastDataAt across ticks)", async () => {
    const { deps, write } = makeDeps({
      oracle: { kind: "ok", result: { verdict: "not_done", phase: "build", session: "sess-1", evidence: {} } },
    });
    const w = new CodexTaskWatcher(deps);
    await w.tick();
    await w.tick();
    await w.tick();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("done → labels the task done AND syncs boardColumn (doubt-review finding — AC-6 parity with /close), pty untouched", async () => {
    const { deps, patch, persist, write } = makeDeps({
      oracle: { kind: "ok", result: { verdict: "done", phase: "build", session: "sess-1", evidence: {} } },
    });
    const w = new CodexTaskWatcher(deps);
    await w.tick();
    expect(patch).toHaveBeenCalledWith("t1", { state: "done", boardColumn: "done" });
    expect(persist).toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  // delivery_pending branch coverage lives in codex-task-watcher.delivery.test.ts.

  it("no_oracle → one self-check nudge, then Inbox-only once spent", async () => {
    const { deps, write } = makeDeps({
      oracle: { kind: "ok", result: { verdict: "no_oracle", phase: "adopt", session: "sess-1", evidence: {} } },
    });
    const w = new CodexTaskWatcher(deps);
    await w.tick();
    expect(write).toHaveBeenCalledTimes(1);
    expect(w.snapshot().some((n) => n.kind === "nudge_sent")).toBe(true);

    await w.tick();
    expect(write).toHaveBeenCalledTimes(1); // no second nudge
    expect(w.snapshot().some((n) => n.kind === "no_oracle_unresolved")).toBe(true);
  });

  it("§5.4 — no_oracle + a done:true self-report on-screen after the spent nudge marks the task done (external-review finding)", async () => {
    const patch = vi.fn();
    const persist = vi.fn(async () => undefined);
    const deps = {
      store: { list: () => [makeTask()], patch, persist },
      ptyManager: { getLastDataAt: () => 0, attachCount: () => 0, write: vi.fn() },
      getProjectById: () => ({ path: "/proj" }),
      runOracle: vi.fn(async (): Promise<OracleOutcome> => ({
        kind: "ok",
        result: { verdict: "no_oracle", phase: "adopt", session: "sess-1", evidence: {} },
      })),
      peekTerminalText: () => '```SHIPWRIGHT-STATUS\n{"phase":"adopt","done":true}\n```',
      now: () => 20 * 60 * 1000,
    };
    const w = new CodexTaskWatcher(deps);
    await w.tick(); // first pass: nudge sent, self-report not consulted yet
    await w.tick(); // second pass: nudge already spent — self-report consulted
    expect(patch).toHaveBeenCalledWith("t1", { state: "done", boardColumn: "done" });
    expect(persist).toHaveBeenCalled();
  });

  it("§5.4 — no_oracle + a done:false (or absent) self-report still falls back to no_oracle_unresolved", async () => {
    const { deps } = makeDeps({
      oracle: { kind: "ok", result: { verdict: "no_oracle", phase: "adopt", session: "sess-1", evidence: {} } },
    });
    (deps as typeof deps & { peekTerminalText: () => string }).peekTerminalText = () =>
      '```SHIPWRIGHT-STATUS\n{"phase":"adopt","done":false}\n```';
    const w = new CodexTaskWatcher(deps);
    await w.tick();
    await w.tick();
    expect(w.snapshot().some((n) => n.kind === "no_oracle_unresolved")).toBe(true);
  });

  it("fresh pty output resets the episode — a new stall gets a new nudge", async () => {
    let lastDataAt = 0;
    let now = 20 * 60 * 1000; // 20min — past the 15min default stall floor
    const write = vi.fn();
    const deps = {
      store: { list: () => [makeTask()], patch: vi.fn(), persist: vi.fn(async () => undefined) },
      ptyManager: { getLastDataAt: () => lastDataAt, attachCount: () => 0, write },
      getProjectById: () => ({ path: "/proj" }),
      runOracle: vi.fn(async (): Promise<OracleOutcome> => ({
        kind: "ok",
        result: { verdict: "not_done", phase: "build", session: "sess-1", evidence: {} },
      })),
      now: () => now,
    };
    const w = new CodexTaskWatcher(deps);
    await w.tick();
    expect(write).toHaveBeenCalledTimes(1);
    // Fresh output arrives (new episode), then the pty goes silent again for
    // another full stall window.
    lastDataAt = 21 * 60 * 1000;
    now = 21 * 60 * 1000; // not stalled yet relative to the new lastDataAt
    await w.tick();
    expect(write).toHaveBeenCalledTimes(1); // still just the first nudge
    now = 21 * 60 * 1000 + DEFAULT_STALL_TIMEOUT_MS;
    await w.tick();
    expect(write).toHaveBeenCalledTimes(2); // new episode → new nudge
  });

  it("local PR-review preflight finding — a nudge_sent notice clears once fresh output starts a new episode, even before the next stall", async () => {
    let lastDataAt = 0;
    let now = 20 * 60 * 1000;
    const deps = {
      store: { list: () => [makeTask()], patch: vi.fn(), persist: vi.fn(async () => undefined) },
      ptyManager: { getLastDataAt: () => lastDataAt, attachCount: () => 0, write: vi.fn() },
      getProjectById: () => ({ path: "/proj" }),
      runOracle: vi.fn(async (): Promise<OracleOutcome> => ({
        kind: "ok",
        result: { verdict: "not_done", phase: "build", session: "sess-1", evidence: {} },
      })),
      now: () => now,
    };
    const w = new CodexTaskWatcher(deps);
    await w.tick();
    expect(w.snapshot().some((n) => n.kind === "nudge_sent")).toBe(true);
    // Fresh output arrives — the task resumes without ever reaching "done".
    // The stale nudge must not keep sitting in the Inbox for a running task.
    lastDataAt = 21 * 60 * 1000;
    now = 21 * 60 * 1000;
    await w.tick();
    expect(w.snapshot().some((n) => n.kind === "nudge_sent")).toBe(false);
  });

  it("silence below the stall threshold does nothing (oracle never called)", async () => {
    const { deps, runOracle } = makeDeps({
      lastDataAt: 19 * 60 * 1000, // 1 minute of silence, under the 15min default
      oracle: { kind: "ok", result: { verdict: "not_done", phase: "build", session: "sess-1", evidence: {} } },
    });
    const w = new CodexTaskWatcher(deps);
    await w.tick();
    expect(runOracle).not.toHaveBeenCalled();
  });

  it("§5.2 — awaiting_external_start with no output past the launch-confirm window surfaces a distinct notice", async () => {
    const { deps, runOracle } = makeDeps({
      tasks: [makeTask({ state: "awaiting_external_start" })],
      lastDataAt: 0,
      now: 2 * 60 * 1000, // 2 minutes since launch — past the 90s default
      oracle: { kind: "ok", result: { verdict: "not_done", phase: "build", session: "sess-1", evidence: {} } },
    });
    const w = new CodexTaskWatcher(deps);
    await w.tick();
    expect(runOracle).not.toHaveBeenCalled(); // launch-confirmation is distinct from the stall/oracle loop
    const notice = w.snapshot().find((n) => n.taskId === "t1");
    expect(notice?.kind).toBe("launch_confirmation_failed");
  });

  it("§5.2 — a launch_confirmation_failed notice clears once the task leaves awaiting_external_start (doubt-review finding)", async () => {
    let state: ExternalTask["state"] = "awaiting_external_start";
    let lastDataAt = 0;
    let now = 2 * 60 * 1000; // past the 90s default launch-confirm window
    const deps = {
      store: { list: () => [makeTask({ state })], patch: vi.fn(), persist: vi.fn(async () => undefined) },
      ptyManager: { getLastDataAt: () => lastDataAt, attachCount: () => 0, write: vi.fn() },
      getProjectById: () => ({ path: "/proj" }),
      runOracle: vi.fn(async (): Promise<OracleOutcome> => ({
        kind: "ok",
        result: { verdict: "not_done", phase: "build", session: "sess-1", evidence: {} },
      })),
      now: () => now,
    };
    const w = new CodexTaskWatcher(deps);
    await w.tick();
    expect(w.snapshot().find((n) => n.taskId === "t1")?.kind).toBe("launch_confirmation_failed");

    // Task recovers: state moves on and the pty starts producing output —
    // still well under the ordinary 15min stall floor, so nothing NEW would
    // trigger a notice; the stale one must be the thing that clears.
    state = "active";
    lastDataAt = now;
    now += 1000;
    await w.tick();
    expect(w.snapshot().find((n) => n.taskId === "t1")).toBeUndefined();
  });

  it("skips a task with no live pty (getLastDataAt → null)", async () => {
    const { deps, runOracle } = makeDeps({
      lastDataAt: null,
      oracle: { kind: "ok", result: { verdict: "not_done", phase: "build", session: "sess-1", evidence: {} } },
    });
    const w = new CodexTaskWatcher(deps);
    await w.tick();
    expect(runOracle).not.toHaveBeenCalled();
  });

  it("skips a claude-runtime task entirely", async () => {
    const { deps, runOracle } = makeDeps({
      tasks: [makeTask({ runtime: "claude" })],
      oracle: { kind: "ok", result: { verdict: "not_done", phase: "build", session: "sess-1", evidence: {} } },
    });
    const w = new CodexTaskWatcher(deps);
    await w.tick();
    expect(runOracle).not.toHaveBeenCalled();
  });
});
