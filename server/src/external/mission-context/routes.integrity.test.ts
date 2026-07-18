/*
 * routes.integrity.test.ts — regressions for the defects the external CODE
 * review found in the first implementation of this slice (openai, 2026-07-18).
 *
 * Kept separate from routes.test.ts so each file stays within the size rule and
 * so the "what the review caught" cases read as a group.
 *
 * @covers FR-01.66
 */

import { beforeEach, describe, expect, it } from "vitest";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { _clearResolverCache } from "../../core/mission-context/resolver.js";
import {
  getContext,
  harness,
  makeProject,
  makeTask,
  OTHER_UUID,
  RUN_ID,
  UUID,
} from "./test-harness.js";

/*
 * External CODE review fixes (openai, 2026-07-18). Each case pins a defect the
 * review found in the first implementation of this slice.
 */
describe("GET mission-context — code-review regressions", () => {
  beforeEach(() => _clearResolverCache());

  it("HIGH: a failed persist ROLLS BACK the in-memory association so a later poll retries", async () => {
    const root = makeProject();
    try {
      const { app, persist, tasks } = harness(root, makeTask(), { persistThrows: true });
      await getContext(app);
      // Without the rollback the field would be set in memory, every later poll
      // would skip the write, and the association would never reach disk.
      expect(tasks.get("task-1")?.missionContext).toBeUndefined();
      expect(persist).toHaveBeenCalledTimes(1);

      // The retry on the next poll is what proves the rollback is effective.
      await getContext(app);
      expect(persist).toHaveBeenCalledTimes(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("HIGH: an INVALID pointer surfaces typed `unavailable` artifacts, not a silent blank (AC5)", async () => {
    const root = makeProject();
    try {
      // The pointer FILE is named for this session (so it is found) but its
      // `session_id` names another — the stale-pointer case §5.1(a) rejects.
      writeFileSync(
        join(root, ".shipwright", "iterate_active", `${UUID}.json`),
        JSON.stringify({
          run_id: RUN_ID,
          slug: "demo",
          main_root: root,
          session_id: OTHER_UUID,
          created_at: "2026-07-18T10:00:00Z",
        }),
      );
      const { app, persist } = harness(root, makeTask());
      const ctx = await getContext(app);
      // All three artifacts show as unavailable — a data-integrity problem must
      // never read as "nothing exists".
      expect(ctx.artifacts).toHaveLength(3);
      for (const a of ctx.artifacts) expect(a.state).toBe("unavailable");
      expect(persist).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("HIGH: an UNREGISTERED worktree_path yields `unavailable` and is NOT persisted (AC5)", async () => {
    const root = makeProject();
    try {
      // Re-point the pointer at a directory git does not report as a worktree.
      writeFileSync(
        join(root, ".shipwright", "iterate_active", `${UUID}.json`),
        JSON.stringify({
          run_id: RUN_ID,
          slug: "demo",
          worktree_path: join(root, "not-a-worktree"),
          main_root: root,
          session_id: UUID,
          created_at: "2026-07-18T10:00:00Z",
        }),
      );
      const { app, persist } = harness(root, makeTask());
      const ctx = await getContext(app);
      expect(ctx.scenario).toBe("iterate");
      for (const a of ctx.artifacts) expect(a.state).toBe("unavailable");
      expect(persist).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("MEDIUM: editing ONLY the iterate document invalidates the cache", async () => {
    const root = makeProject();
    try {
      const { app } = harness(root, makeTask());
      const first = await getContext(app);
      const specPath = join(root, ".shipwright", "planning", "iterate", RUN_ID, "mini-plan.md");
      // A different size guarantees a different fingerprint even if the mtime
      // resolution is coarse.
      writeFileSync(specPath, "# Demo plan\n\nNow touches FR-01.28 as well.\n\nExtra body.\n");
      const second = await getContext(app);
      expect(second.sourceRev).not.toBe(first.sourceRev);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/*
 * AC1 must not fail SILENTLY (internal code review, MEDIUM).
 *
 * The Requirement artifact previously depended on a literal FR id appearing in
 * the spec. With none, rows were empty -> `not_yet_created` -> the client's
 * hide-empty rule removed the node, and "a live standalone iterate shows a
 * non-empty Spec + Requirement" failed with no signal at all. The earlier route
 * test only passed because its fixture happened to contain `FR-01.66`.
 */
describe("AC1 — a live iterate always shows a Requirement", () => {
  beforeEach(() => _clearResolverCache());

  function writeSpec(root: string, body: string): void {
    writeFileSync(
      join(root, ".shipwright", "planning", "iterate", RUN_ID, "mini-plan.md"),
      body,
      "utf-8",
    );
  }

  it("renders PLANNED PROSE when the spec names no FR id (the silent-failure case)", async () => {
    const root = makeProject();
    try {
      writeSpec(
        root,
        [
          "# Fix the replay flake",
          "",
          "## Affected Boundaries",
          "",
          "The snapshot envelope written by the server and read by the E2E harness.",
          "",
        ].join("\n"),
      );
      const { app } = harness(root, makeTask());
      const ctx = await getContext(app);
      const req = ctx.artifacts.find((a) => a.kind === "requirement") as
        | { state: string; summary?: string | null; detail?: { confidence?: string } }
        | undefined;
      // Visible (not hidden), honest, and labelled as PLANNED — never finalized.
      expect(req?.state).toBe("available");
      expect(req?.summary).toContain("snapshot envelope");
      expect(req?.detail?.confidence).toBe("planned");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does NOT report an FR cited only under References as impact", async () => {
    const root = makeProject();
    try {
      writeSpec(
        root,
        [
          "# Demo",
          "",
          "## Affected Boundaries",
          "",
          "The resolver response shape.",
          "",
          "## References",
          "",
          "Prior art: FR-01.28 — unchanged by this run.",
          "",
        ].join("\n"),
      );
      const { app } = harness(root, makeTask());
      const ctx = await getContext(app);
      // FR-01.28 is a citation, not impact: it must not reach the chip.
      expect(ctx.servesFrId).toBeNull();
      const req = ctx.artifacts.find((a) => a.kind === "requirement") as
        | { summary?: string | null }
        | undefined;
      expect(req?.summary).not.toContain("FR-01.28");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/*
 * Internal code review (test gap) — the spec asked for the idempotent write
 * under CONCURRENT polls; the existing case runs five SEQUENTIAL ones.
 *
 * The interleaving is safe today only because the compare-and-set in
 * `setMissionContextOnce` is synchronous (no await between the read of
 * `task.missionContext` and the patch). Nothing pinned that, so a refactor
 * moving the check outside the CAS — or making it async — would still pass the
 * sequential test while double-writing in production. This pins the property.
 */
describe("association write under CONCURRENT polls", () => {
  beforeEach(() => _clearResolverCache());

  it("writes EXACTLY ONCE when five polls are in flight simultaneously", async () => {
    const root = makeProject();
    try {
      const { app, persist, tasks } = harness(root, makeTask());
      // No awaits between the requests: all five enter the handler before any
      // of them completes its persist.
      await Promise.all(Array.from({ length: 5 }, () => getContext(app)));
      expect(persist).toHaveBeenCalledTimes(1);
      expect(tasks.get("task-1")?.missionContext?.runId).toBe(RUN_ID);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("still writes exactly once when a concurrent burst follows a failed persist", async () => {
    const root = makeProject();
    try {
      // First burst fails to persist and rolls back; the second must retry and
      // then settle on a single durable write.
      const failing = harness(root, makeTask(), { persistThrows: true });
      await Promise.all(Array.from({ length: 3 }, () => getContext(failing.app)));
      expect(failing.tasks.get("task-1")?.missionContext).toBeUndefined();

      const ok = harness(root, makeTask());
      await Promise.all(Array.from({ length: 3 }, () => getContext(ok.app)));
      expect(ok.persist).toHaveBeenCalledTimes(1);
      expect(ok.tasks.get("task-1")?.missionContext?.runId).toBe(RUN_ID);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
