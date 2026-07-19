/*
 * routes.tests-git-recovery.test.ts — a TRANSIENT git failure must not be
 * cached (internal code review, FIX-IF-CHEAP; CONTRACT §5.2).
 *
 * git's answer is not a statted file, so it cannot participate in `sourceRev`.
 * That is correct — a commit sha is immutable — but it means a caching bug here
 * has no self-healing path: once a transient failure (an `index.lock`, a GC
 * race, a briefly unreachable object) is cached, Tests stays pinned at
 * "currently unavailable" until some UNRELATED source file happens to change.
 *
 * THE TEST THAT WOULD HAVE CAUGHT IT: fail git once, then succeed, touching no
 * file in between. Before the fix the second poll returned the cached failure.
 *
 * The distinction the fix rests on: `git_failed` is transient and must not be
 * cached; `bad_commit` ("this run recorded no commit") is a STABLE fact about
 * the run and stays cacheable. Both are asserted.
 *
 * @covers FR-01.66
 */

import { beforeEach, describe, expect, it } from "vitest";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { _clearResolverCache } from "../../core/mission-context/resolver.js";
import { _clearMergeCache, _clearOriginSlugCache } from "../../core/mission-context/merge-check.js";
import { createMissionContextRouter } from "./routes.js";
import { makeProject, makeTask, RUN_ID, type ContextLike } from "./test-harness.js";
import type { ExternalTask, SdkSessionsStore } from "../../core/sdk-sessions-store.js";

/** A finalized run carrying a real sha, so Tests reaches the git call. */
function finalize(root: string, commit: string): void {
  writeFileSync(
    join(root, "shipwright_events.jsonl"),
    JSON.stringify({
      id: "evt-1",
      type: "work_completed",
      ts: "2026-07-19T12:00:00Z",
      adr_id: RUN_ID,
      commit,
      summary: "Ship the slice.",
      spec_impact: "modify",
      affected_frs: ["FR-01.66"],
    }) + "\n",
  );
}

const NUL = "\0";

function harness(root: string, task: ExternalTask) {
  const tasks = new Map([[task.taskId, task]]);
  const state = { failShow: true, showCalls: 0 };

  const git = (args: string[]) => {
    if (args[0] === "worktree") return `worktree ${root}${NUL ? "" : ""}\n\n`;
    if (args[0] === "remote") return "";
    if (args[0] === "show") {
      state.showCalls++;
      if (state.failShow) throw new Error("fatal: unable to read tree (index.lock)");
      return `A${NUL}client/src/lib/recovered.test.ts${NUL}`;
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
    readTranscriptTail: async () => "",
    getScenarioFacts: async () => ({
      actions: { fromUser: false, hasDiagnostics: false, actionIds: ["new-iterate"] },
      runConfigStatus: "missing",
      campaignSlug: null,
      hasCampaignRecord: false,
    }),
    resolveDeps: { git },
  });

  return {
    state,
    async poll(): Promise<ContextLike> {
      const res = await app.request("/api/external/tasks/task-1/mission-context");
      return ((await res.json()) as { context: ContextLike }).context;
    },
  };
}

function tests(ctx: ContextLike) {
  return ctx.artifacts.find((a) => a.kind === "tests") as
    | { state?: string; detail?: { rows?: unknown[] } }
    | undefined;
}

describe("Tests artifact — transient git failure is not cached", () => {
  beforeEach(() => {
    _clearResolverCache();
    _clearMergeCache();
    _clearOriginSlugCache();
  });

  it("RECOVERS on the next poll once git works again, with no file touched", async () => {
    const root = makeProject();
    try {
      finalize(root, "abc1234def5678");
      const h = harness(root, makeTask());

      const first = await h.poll();
      // git failed: a VISIBLE integrity signal, never a false "no tests".
      expect(tests(first)?.state).toBe("unavailable");

      h.state.failShow = false;
      const second = await h.poll();

      // No source file changed, so `sourceRev` is identical — the ONLY way
      // this recovers is if the failure was never cached.
      expect(second.sourceRev).toBe(first.sourceRev);
      expect(tests(second)?.state).toBe("available");
      expect(tests(second)?.detail?.rows).toHaveLength(1);
      expect(h.state.showCalls).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("still CACHES a stable 'no commit recorded' — that is a fact, not a fault", async () => {
    const root = makeProject();
    try {
      // A finalized run whose commit was never recorded (measured: the common
      // case — only 49 of 210 real rows carry a non-empty commit).
      finalize(root, "");
      const h = harness(root, makeTask());

      const first = await h.poll();
      expect(tests(first)?.state).toBe("unavailable");
      const second = await h.poll();
      expect(second.sourceRev).toBe(first.sourceRev);
      expect(tests(second)?.state).toBe("unavailable");
      // Cached: the sha is rejected before git is ever invoked, on both polls.
      expect(h.state.showCalls).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
