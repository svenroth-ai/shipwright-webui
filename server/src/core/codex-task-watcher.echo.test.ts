/*
 * codex-task-watcher.echo.test.ts — issue #583: a nudge's own terminal echo
 * must not re-arm the stall episode, and a self-report already on screen
 * must be honoured before (not only after) a nudge.
 */
import { describe, expect, it, vi } from "vitest";

import { CodexTaskWatcher, DEFAULT_STALL_TIMEOUT_MS } from "./codex-task-watcher.js";
import { NUDGE_ECHO_GRACE_MS } from "./codex-task-watcher-types.js";
import type { ExternalTask } from "./sdk-sessions-store.js";
import type { OracleOutcome } from "./codex-oracle-runner.js";

const task: ExternalTask = {
  taskId: "t1",
  sessionUuid: "sess-1",
  cwd: "/proj",
  pluginDirs: [],
  state: "active",
  title: "T",
  projectId: "proj-1",
  runtime: "codex",
  phase: "iterate",
  launchedAt: "2026-09-16T00:00:00Z",
  createdAt: "2026-09-16T00:00:00Z",
  inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
};

const STEP = DEFAULT_STALL_TIMEOUT_MS + 1;

function harness(opts: { echo: boolean; screen?: string; verdict?: "no_oracle" | "not_done" }) {
  let now = STEP;
  let lastDataAt = 0;
  const patch = vi.fn();
  const write = vi.fn(() => {
    if (opts.echo) lastDataAt = now; // output caused by the reminder itself
  });
  const w = new CodexTaskWatcher({
    store: { list: () => [task], patch, persist: vi.fn(async () => undefined) },
    ptyManager: { getLastDataAt: () => lastDataAt, attachCount: () => 0, write },
    getProjectById: () => ({ path: "/proj" }),
    runOracle: vi.fn(async (): Promise<OracleOutcome> => ({
      kind: "ok",
      result: { verdict: opts.verdict ?? "no_oracle", phase: "iterate", session: "sess-1", evidence: {} },
    })),
    peekTerminalText: opts.screen === undefined ? undefined : () => opts.screen as string,
    now: () => now,
  });
  const run = async (n: number) => {
    for (let i = 0; i < n; i++) {
      await w.tick();
      now += STEP;
    }
  };
  return { w, write, patch, run };
}

const report = (json: string) => "```SHIPWRIGHT-STATUS\n" + json + "\n```";

describe("CodexTaskWatcher — nudge echo (#583)", () => {
  // @covers FR-01.74
  it("control: no echo → one self-check, then no_oracle_unresolved", async () => {
    const { w, write, run } = harness({ echo: false });
    await run(4);
    expect(write).toHaveBeenCalledTimes(1);
    expect(w.snapshot().some((n) => n.kind === "no_oracle_unresolved")).toBe(true);
  });

  // @covers FR-01.74
  it("no_oracle: the reminder's own echo does not re-arm — one write, then unresolved", async () => {
    const { w, write, run } = harness({ echo: true });
    await run(4);
    expect(write).toHaveBeenCalledTimes(1);
    expect(w.snapshot().some((n) => n.kind === "no_oracle_unresolved")).toBe(true);
  });

  // @covers FR-01.74
  it("not_done: the waker's own echo does not re-arm either", async () => {
    const { write, run } = harness({ echo: true, verdict: "not_done" });
    await run(4);
    expect(write).toHaveBeenCalledTimes(1);
  });

  // @covers FR-01.74
  it("a valid done:false report on screen is never nudged again, even with echo", async () => {
    const { w, write, run } = harness({ echo: true, screen: report('{"phase":"iterate","done":false,"status":"blocked"}') });
    await run(4);
    expect(write).not.toHaveBeenCalled();
    expect(w.snapshot().some((n) => n.kind === "no_oracle_unresolved")).toBe(true);
  });

  // @covers FR-01.74
  it("a valid done:true report is honoured on the FIRST idle check — task done, no nudge", async () => {
    const { write, patch, run } = harness({ echo: true, screen: report('{"phase":"iterate","done":true}') });
    await run(1);
    expect(write).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith("t1", { state: "done", boardColumn: "done" });
  });

  // @covers FR-01.74
  it("a report for ANOTHER phase (stale scrollback) is ignored — still nudged, never marked done", async () => {
    const { write, patch, run } = harness({ echo: false, screen: report('{"phase":"build","done":true}') });
    await run(1);
    expect(patch).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(1);
  });

  // @covers FR-01.74
  it("echo at the grace edge is absorbed; one tick later it is not", async () => {
    let now = STEP;
    let lastDataAt = 0;
    const write = vi.fn();
    const w = new CodexTaskWatcher({
      store: { list: () => [task], patch: vi.fn(), persist: vi.fn(async () => undefined) },
      ptyManager: { getLastDataAt: () => lastDataAt, attachCount: () => 0, write },
      getProjectById: () => ({ path: "/proj" }),
      runOracle: vi.fn(async (): Promise<OracleOutcome> => ({
        kind: "ok",
        result: { verdict: "not_done", phase: "iterate", session: "sess-1", evidence: {} },
      })),
      now: () => now,
    });
    await w.tick();
    const nudgedAt = now;
    lastDataAt = nudgedAt + NUDGE_ECHO_GRACE_MS;
    now = lastDataAt + STEP;
    await w.tick();
    expect(write).toHaveBeenCalledTimes(1); // absorbed
    lastDataAt = nudgedAt + NUDGE_ECHO_GRACE_MS + 1;
    now = lastDataAt + STEP;
    await w.tick();
    expect(write).toHaveBeenCalledTimes(2);
  });

  // @covers FR-01.74
  it("genuinely new agent output AFTER the grace window still starts a new episode", async () => {
    let now = STEP;
    let lastDataAt = 0;
    const write = vi.fn();
    const w = new CodexTaskWatcher({
      store: { list: () => [task], patch: vi.fn(), persist: vi.fn(async () => undefined) },
      ptyManager: { getLastDataAt: () => lastDataAt, attachCount: () => 0, write },
      getProjectById: () => ({ path: "/proj" }),
      runOracle: vi.fn(async (): Promise<OracleOutcome> => ({
        kind: "ok",
        result: { verdict: "not_done", phase: "iterate", session: "sess-1", evidence: {} },
      })),
      now: () => now,
    });
    await w.tick();
    expect(write).toHaveBeenCalledTimes(1);
    lastDataAt = now + 60_000; // real progress, well past the echo grace
    now = lastDataAt + STEP;
    await w.tick();
    expect(write).toHaveBeenCalledTimes(2);
  });
});
