/*
 * external/inbox/_codex.test.ts — the `codex_watcher` inbox kind
 * (Codex Light AC6). Aggregation post-pass over `CodexTaskWatcher`'s
 * ephemeral `snapshot()`.
 */
import { describe, it, expect } from "vitest";

import { appendCodexWatcherNotices, appendCodexTerminalSignals } from "./_codex.js";
import type { AggregatedEntry } from "./_types.js";
import type { CodexWatcherNotice } from "../../core/codex-task-watcher.js";
import {
  SdkSessionsStore,
  type SdkSessionsStoreDeps,
} from "../../core/sdk-sessions-store.js";

function inMemoryDeps(): SdkSessionsStoreDeps {
  const files = new Map<string, string>();
  const existing = new Set<string>();
  return {
    readFile: async (p) => {
      if (!files.has(p))
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return files.get(p)!;
    },
    writeFile: async (p, data) => {
      files.set(p, data);
      existing.add(p);
    },
    existsSync: (p) => existing.has(p),
    mkdirSync: (p) => {
      existing.add(p);
    },
    ensureFile: (p) => {
      if (!files.has(p)) files.set(p, "");
      existing.add(p);
    },
  };
}

async function makeStore(): Promise<SdkSessionsStore> {
  const store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
  await store.load();
  return store;
}

function fakeWatcher(notices: CodexWatcherNotice[]) {
  return { snapshot: () => notices };
}

describe("appendCodexWatcherNotices", () => {
  it("surfaces a nudge_sent notice as kind codex_watcher", async () => {
    const store = await makeStore();
    const task = store.create({ title: "Codex task", cwd: "/c", pluginDirs: [], runtime: "codex" });

    const entries: AggregatedEntry[] = [];
    appendCodexWatcherNotices(entries, {
      store,
      codexWatcher: fakeWatcher([
        { taskId: task.taskId, kind: "nudge_sent", detail: "Sent a nudge.", at: 1000 },
      ]),
    });

    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry.kind).toBe("codex_watcher");
    if (entry.kind === "codex_watcher") {
      expect(entry.taskId).toBe(task.taskId);
      expect(entry.noticeKind).toBe("nudge_sent");
      expect(entry.detail).toBe("Sent a nudge.");
      expect(entry.bestEffort).toBe(true);
    }
  });

  it("surfaces a launch_confirmation_failed notice distinctly from other kinds", async () => {
    const store = await makeStore();
    const task = store.create({ title: "Codex task", cwd: "/c", pluginDirs: [], runtime: "codex" });

    const entries: AggregatedEntry[] = [];
    appendCodexWatcherNotices(entries, {
      store,
      codexWatcher: fakeWatcher([
        {
          taskId: task.taskId,
          kind: "launch_confirmation_failed",
          detail: "Codex never produced output after launch.",
          at: 1000,
        },
      ]),
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ noticeKind: "launch_confirmation_failed" });
  });

  it("skips a notice for a task that no longer exists (store lookup miss)", async () => {
    const store = await makeStore();
    const entries: AggregatedEntry[] = [];
    appendCodexWatcherNotices(entries, {
      store,
      codexWatcher: fakeWatcher([
        { taskId: "gone", kind: "nudge_sent", detail: "stale", at: 1000 },
      ]),
    });
    expect(entries).toHaveLength(0);
  });

  it("skips a notice for a task already in state done or launch_failed", async () => {
    const store = await makeStore();
    const done = store.create({ title: "Done", cwd: "/c", pluginDirs: [], runtime: "codex" });
    store.patch(done.taskId, { state: "done" });
    const failed = store.create({ title: "Failed", cwd: "/c", pluginDirs: [], runtime: "codex" });
    store.patch(failed.taskId, { state: "launch_failed" });

    const entries: AggregatedEntry[] = [];
    appendCodexWatcherNotices(entries, {
      store,
      codexWatcher: fakeWatcher([
        { taskId: done.taskId, kind: "nudge_sent", detail: "stale", at: 1000 },
        { taskId: failed.taskId, kind: "nudge_sent", detail: "stale", at: 1000 },
      ]),
    });
    expect(entries).toHaveLength(0);
  });
});

function fakePtyManager(byTaskId: Record<string, string | null>) {
  return {
    peekTerminalText: (taskId: string) => byTaskId[taskId] ?? null,
  };
}

describe("appendCodexTerminalSignals", () => {
  it("surfaces a pending approval dialog as kind codex_approval", async () => {
    const store = await makeStore();
    const task = store.create({ title: "Codex task", cwd: "/c", pluginDirs: [], runtime: "codex" });

    const entries: AggregatedEntry[] = [];
    appendCodexTerminalSignals(entries, {
      store,
      ptyManager: fakePtyManager({
        [task.taskId]: "Allow Codex to run `rm -rf node_modules`?\n1. Yes\n2. No",
      }),
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("codex_approval");
    if (entries[0].kind === "codex_approval") {
      expect(entries[0].promptText).toContain("Allow Codex to run");
      expect(entries[0].bestEffort).toBe(true);
    }
  });

  it("surfaces a structured error as kind codex_error", async () => {
    const store = await makeStore();
    const task = store.create({ title: "Codex task", cwd: "/c", pluginDirs: [], runtime: "codex" });

    const entries: AggregatedEntry[] = [];
    appendCodexTerminalSignals(entries, {
      store,
      ptyManager: fakePtyManager({
        [task.taskId]: "turn aborted. Something went wrong? Hit `/feedback` to report the issue.",
      }),
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("codex_error");
    if (entries[0].kind === "codex_error") {
      expect(entries[0].errorText).toContain("Something went wrong");
    }
  });

  it("skips a Claude-runtime task even with matching text", async () => {
    const store = await makeStore();
    const task = store.create({ title: "Claude task", cwd: "/c", pluginDirs: [], runtime: "claude" });

    const entries: AggregatedEntry[] = [];
    appendCodexTerminalSignals(entries, {
      store,
      ptyManager: fakePtyManager({
        [task.taskId]: "Allow Codex to run `echo hi`?",
      }),
    });
    expect(entries).toHaveLength(0);
  });

  it("skips a task already done or launch_failed", async () => {
    const store = await makeStore();
    const done = store.create({ title: "Done", cwd: "/c", pluginDirs: [], runtime: "codex" });
    store.patch(done.taskId, { state: "done" });

    const entries: AggregatedEntry[] = [];
    appendCodexTerminalSignals(entries, {
      store,
      ptyManager: fakePtyManager({ [done.taskId]: "Allow Codex to run `echo hi`?" }),
    });
    expect(entries).toHaveLength(0);
  });

  it("emits nothing when peekTerminalText is absent", async () => {
    const store = await makeStore();
    store.create({ title: "Codex task", cwd: "/c", pluginDirs: [], runtime: "codex" });

    const entries: AggregatedEntry[] = [];
    appendCodexTerminalSignals(entries, { store, ptyManager: {} });
    expect(entries).toHaveLength(0);
  });

  it("emits nothing when neither an approval nor an error is present", async () => {
    const store = await makeStore();
    const task = store.create({ title: "Codex task", cwd: "/c", pluginDirs: [], runtime: "codex" });

    const entries: AggregatedEntry[] = [];
    appendCodexTerminalSignals(entries, {
      store,
      ptyManager: fakePtyManager({ [task.taskId]: "Codex is working normally...\n" }),
    });
    expect(entries).toHaveLength(0);
  });
});
