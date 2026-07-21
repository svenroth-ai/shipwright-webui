/*
 * routes.merge-freshness.test.ts — the merge state must stay LIVE across
 * resolver cache hits (internal code review, HIGH; CONTRACT §5.3 + §11).
 *
 * THE TEST THAT WOULD HAVE CAUGHT THE BUG, per the reviewer: poll twice with
 * NO file touched and the clock advanced. Before the fix the resolver returned
 * the cached context verbatim, so `detail.merge` was frozen at "pending"
 * forever once the run's source files went quiescent — which is always, after
 * finalization. merge-check's asymmetric TTL was unreachable, and §11's
 * required "pending -> merged after the TTL re-check" was impossible.
 *
 * @covers FR-01.66
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { _clearResolverCache } from "../../core/mission-context/resolver.js";
import { _clearMergeCache, _clearOriginSlugCache } from "../../core/mission-context/merge-check.js";
import { _clearRootsCache } from "../../core/mission-context/worktree-roots.js";
import { _clearEventIndexCache } from "../../core/mission-context/iterate-record.js";
import { createMissionContextRouter } from "./routes.js";
import { makeProject, makeTask, RUN_ID, type ContextLike } from "./test-harness.js";
import type { ExternalTask, SdkSessionsStore } from "../../core/sdk-sessions-store.js";

const PR_URL = "https://github.com/svenroth-ai/shipwright-webui/pull/292";

/** A finalized run, so the Commit artifact reaches `available`. */
function finalize(root: string): void {
  writeFileSync(
    join(root, "shipwright_events.jsonl"),
    JSON.stringify({
      id: "evt-1",
      type: "work_completed",
      ts: "2026-07-18T12:00:00Z",
      adr_id: RUN_ID,
      commit: "abc1234def5678",
      summary: "Ship the resolver.",
      spec_impact: "modify",
      affected_frs: ["FR-01.66"],
    }) + "\n",
  );
}

/**
 * A harness whose git double reports the squash only AFTER `merged` flips —
 * the real-world sequence: the PR is open at finalize time and lands later.
 */
function mergeHarness(root: string, task: ExternalTask) {
  const tasks = new Map([[task.taskId, task]]);
  const state = { merged: false, logCalls: 0 };
  let clock = 1_000_000;

  const git = (args: string[]) => {
    if (args[0] === "remote") return "https://github.com/svenroth-ai/shipwright-webui.git\n";
    if (args[0] === "worktree") return `worktree ${root}\n\n`;
    if (args[0] === "log") {
      state.logCalls++;
      return state.merged ? "feat(mission): resolver (#292)\n" : "";
    }
    return "";
  };

  const app = createMissionContextRouter({
    store: {
      get: (id: string) => tasks.get(id),
      patch: (id: string, patch: Partial<ExternalTask>) => {
        const t = tasks.get(id);
        if (t) Object.assign(t, patch);
        return t;
      },
      persist: async () => {},
    } as unknown as SdkSessionsStore,
    getProjectById: (id) => (id === "proj-1" ? { id: "proj-1", name: "P", path: root } : undefined),
    readTranscriptTail: async () => ({ text: `opened ${PR_URL}`, revision: "rev-1" }),
    getScenarioFacts: async () => ({
      actions: { fromUser: false, hasDiagnostics: false, actionIds: ["new-iterate"] },
      runConfigStatus: "missing",
      campaignSlug: null,
      hasCampaignRecord: false,
    }),
    resolveDeps: { git, merge: { git, now: () => clock, pendingTtlMs: 60_000 } },
  });

  return {
    app,
    state,
    advance: (ms: number) => {
      clock += ms;
    },
    async poll(): Promise<ContextLike> {
      const res = await app.request("/api/external/tasks/task-1/mission-context");
      return ((await res.json()) as { context: ContextLike }).context;
    },
  };
}

function mergeOf(ctx: ContextLike): string | undefined {
  const commit = ctx.artifacts.find((a) => a.kind === "commit") as
    | { detail?: { merge?: string } }
    | undefined;
  return commit?.detail?.merge;
}

describe("merge state across resolver cache hits", () => {
  beforeEach(() => {
    _clearResolverCache();
    _clearMergeCache();
    _clearOriginSlugCache();
    // The resolver now populates two more module-level caches (worktree root set,
    // event-log run_id index) keyed on real time / real paths; clear them too so
    // this same-root repeated-poll suite stays isolated per case.
    _clearRootsCache();
    _clearEventIndexCache();
    vi.restoreAllMocks();
  });

  it("goes pending -> merged on a later poll with NO file touched (§11)", async () => {
    const root = makeProject();
    try {
      finalize(root);
      const h = mergeHarness(root, makeTask());

      const first = await h.poll();
      expect(mergeOf(first)).toBe("pending");

      // The squash lands. NOTHING on disk that the rev covers changes — the
      // spec, the event log and the agent-doc are all quiescent, so every
      // later poll is a resolver cache HIT. This is the exact shape that used
      // to freeze the artifact at "pending" forever.
      h.state.merged = true;
      h.advance(61_000); // past merge-check's pending TTL

      const second = await h.poll();
      expect(mergeOf(second)).toBe("merged");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not re-shell inside the pending TTL (the cache still does its job)", async () => {
    const root = makeProject();
    try {
      finalize(root);
      const h = mergeHarness(root, makeTask());
      await h.poll();
      const afterFirst = h.state.logCalls;
      await h.poll();
      await h.poll();
      expect(h.state.logCalls).toBe(afterFirst); // served from merge-check's TTL cache
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("treats `merged` as TERMINAL — never re-asks, never regresses", async () => {
    const root = makeProject();
    try {
      finalize(root);
      const h = mergeHarness(root, makeTask());
      h.state.merged = true;
      expect(mergeOf(await h.poll())).toBe("merged");

      const afterMerged = h.state.logCalls;
      // Even if git would now answer "not found", a merge cannot un-happen.
      h.state.merged = false;
      h.advance(10 * 60 * 60 * 1000);
      expect(mergeOf(await h.poll())).toBe("merged");
      expect(h.state.logCalls).toBe(afterMerged);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports `unknown` when the transcript only cites a SIBLING repo's PR", async () => {
    const root = makeProject();
    try {
      finalize(root);
      const tasks = new Map([["task-1", makeTask()]]);
      const git = (args: string[]) => {
        if (args[0] === "remote") return "https://github.com/svenroth-ai/shipwright-webui.git\n";
        if (args[0] === "worktree") return `worktree ${root}\n\n`;
        // If this is ever reached the binding failed — a foreign number would
        // be grepped against OUR origin/main and could render a false merge.
        if (args[0] === "log") throw new Error("must not check a foreign PR number");
        return "";
      };
      const app = createMissionContextRouter({
        store: {
          get: (id: string) => tasks.get(id),
          patch: () => undefined,
          persist: async () => {},
        } as unknown as SdkSessionsStore,
        getProjectById: () => ({ id: "proj-1", name: "P", path: root }),
        readTranscriptTail: async () => ({
          text: "see https://github.com/svenroth-ai/shipwright/pull/290 for context",
          revision: "rev-1",
        }),
        getScenarioFacts: async () => ({
          actions: { fromUser: false, hasDiagnostics: false, actionIds: ["new-iterate"] },
          runConfigStatus: "missing",
          campaignSlug: null,
          hasCampaignRecord: false,
        }),
        resolveDeps: { git },
      });
      const res = await app.request("/api/external/tasks/task-1/mission-context");
      const ctx = ((await res.json()) as { context: ContextLike }).context;
      expect(mergeOf(ctx)).toBe("unknown");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
