/*
 * routes.test.ts — GET mission-context (AC1 / AC5 / AC6).
 *
 * The cases carrying the external-review findings:
 *   - the association is written EXACTLY ONCE across repeated polls (the
 *     lazy-GET-persist data-loss fix must not become a per-poll write);
 *   - a client cannot alter server resolution — the pointer's session binding
 *     is enforced against the server's own store (AC5);
 *   - `task.runId` is never overloaded.
 *
 * Document-endpoint cases live in routes.documents.test.ts (file-size rule).
 *
 * @covers FR-01.66
 */

import { beforeEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";

import { _clearResolverCache } from "../../core/mission-context/resolver.js";
import { artifact, getContext, harness, makeProject, makeTask, OTHER_UUID } from "./test-harness.js";

describe("GET mission-context", () => {
  beforeEach(() => _clearResolverCache());

  it("resolves a live iterate to a non-empty Spec + Requirement (AC1)", async () => {
    const root = makeProject();
    try {
      const { app } = harness(root, makeTask());
      const ctx = await getContext(app);
      expect(ctx.scenario).toBe("iterate");
      expect(ctx.runId).toBe("iterate-2026-07-18-demo");
      expect(artifact(ctx, "spec")?.state).toBe("available");
      // Mid-run the Requirement is PLANNED impact read from the spec (AC1) —
      // the whole point is that it is not blank before Finalize.
      expect(artifact(ctx, "requirement")?.state).toBe("available");
      expect(ctx.servesFrId).toBe("FR-01.66");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes the association EXACTLY ONCE across repeated polls (AC1/AC6)", async () => {
    const root = makeProject();
    try {
      const { app, persist, tasks } = harness(root, makeTask());
      for (let i = 0; i < 5; i++) await getContext(app);
      expect(persist).toHaveBeenCalledTimes(1);
      expect(tasks.get("task-1")?.missionContext).toMatchObject({
        kind: "iterate",
        runId: "iterate-2026-07-18-demo",
        source: "iterate_active_pointer",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does NOT overload task.runId (the pipeline join stays clean)", async () => {
    const root = makeProject();
    try {
      const { app, tasks } = harness(root, makeTask());
      await getContext(app);
      expect(tasks.get("task-1")?.runId).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does NOT associate a session that is not live (no post-hoc stamping)", async () => {
    const root = makeProject();
    try {
      const { app, persist, tasks } = harness(root, makeTask({ state: "idle" }));
      await getContext(app);
      expect(persist).not.toHaveBeenCalled();
      expect(tasks.get("task-1")?.missionContext).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("never overwrites an association that already exists", async () => {
    const root = makeProject();
    try {
      const existing = {
        kind: "iterate" as const,
        runId: "iterate-2026-01-01-earlier",
        observedAt: "2026-01-01T00:00:00.000Z",
        source: "iterate_active_pointer" as const,
      };
      const { app, persist, tasks } = harness(root, makeTask({ missionContext: existing }));
      await getContext(app);
      expect(persist).not.toHaveBeenCalled();
      expect(tasks.get("task-1")?.missionContext).toEqual(existing);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("REJECTS a pointer bound to another session (AC5) and does not persist", async () => {
    const root = makeProject();
    try {
      const { app, persist } = harness(root, makeTask({ sessionUuid: OTHER_UUID }));
      const ctx = await getContext(app);
      expect(ctx.scenario).toBe("plain");
      expect(ctx.runId).toBeNull();
      expect(persist).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("404s a task whose project does not resolve (generic, not an oracle)", async () => {
    const root = makeProject();
    try {
      const { app } = harness(root, makeTask({ projectId: "proj-nope" }));
      const res = await app.request("/api/external/tasks/task-1/mission-context");
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("404s an unknown task", async () => {
    const root = makeProject();
    try {
      const { app } = harness(root, makeTask());
      const res = await app.request("/api/external/tasks/task-nope/mission-context");
      expect(res.status).toBe(404);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a FAILING persist does not fail the read (an ELOCKED must not break the poll)", async () => {
    const root = makeProject();
    try {
      const { app } = harness(root, makeTask(), { persistThrows: true });
      const res = await app.request("/api/external/tasks/task-1/mission-context");
      expect(res.status).toBe(200);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a client-supplied transcript cannot forge a merge — the server reads its own", async () => {
    const root = makeProject();
    try {
      // The harness supplies the transcript the way the SERVER would; a client
      // has no channel to inject one at all. A pr-link with no completed run
      // must still not render a merge.
      const { app } = harness(root, makeTask(), {
        transcript: "https://github.com/o/r/pull/999999",
      });
      const ctx = await getContext(app);
      // No work_completed row exists → Commit cannot be `available`.
      expect(artifact(ctx, "commit")?.state).toBe("not_yet_created");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/*
 * The FINALIZED path (AC2) — external plan review openai #2.
 *
 * After Finalize the worktree is gone and `prune_stale_run_pointers` has
 * deleted the pointer. The persisted association is then the ONLY way back to
 * the run. If this regressed, every finished iterate would show "No run data
 * yet" — the exact symptom this whole slice exists to kill.
 */
describe("GET mission-context — pointer pruned after Finalize", () => {
  beforeEach(() => _clearResolverCache());

  const association = {
    kind: "iterate" as const,
    runId: "iterate-2026-07-18-demo",
    observedAt: "2026-07-18T10:00:00.000Z",
    source: "iterate_active_pointer" as const,
  };

  it("STILL resolves the iterate from the stored association (AC2)", async () => {
    const root = makeProject();
    try {
      // Simulate the prune: the pointer file is gone, the spec remains.
      rmSync(join(root, ".shipwright", "iterate_active"), { recursive: true, force: true });
      const { app } = harness(root, makeTask({ state: "done", missionContext: association }));
      const ctx = await getContext(app);
      expect(ctx.scenario).toBe("iterate");
      expect(ctx.runId).toBe("iterate-2026-07-18-demo");
      expect(artifact(ctx, "spec")?.state).toBe("available");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("falls back to `plain` when the run was never observed before the prune", async () => {
    const root = makeProject();
    try {
      rmSync(join(root, ".shipwright", "iterate_active"), { recursive: true, force: true });
      const { app } = harness(root, makeTask({ state: "done" }));
      const ctx = await getContext(app);
      // Honest `plain` — no fabricated run (CONTRACT §5 "no fabrication").
      expect(ctx.scenario).toBe("plain");
      expect(ctx.runId).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes NO new association on the post-hoc path (already associated + not live)", async () => {
    const root = makeProject();
    try {
      rmSync(join(root, ".shipwright", "iterate_active"), { recursive: true, force: true });
      const { app, persist } = harness(root, makeTask({ state: "done", missionContext: association }));
      await getContext(app);
      expect(persist).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
