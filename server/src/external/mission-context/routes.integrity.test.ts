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
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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
      // EVERY artifact shows as unavailable — a data-integrity problem must
      // never read as "nothing exists". Pinned by KIND, not by count: omitting
      // a kind here would HIDE it on exactly the path where the integrity
      // problem is worst, and a count alone would not catch that.
      expect(ctx.artifacts.map((a: { kind: string }) => a.kind)).toEqual([
        "spec",
        "requirement",
        "tests",
        "review",
        "decisions",
        "commit",
      ]);
      for (const a of ctx.artifacts) expect(a.state).toBe("unavailable");
      expect(persist).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /*
   * SUPERSEDED 2026-07-21 (iterate-2026-07-21-mission-run-identity-recovery).
   *
   * This case used to assert that an unregistered `worktree_path` yields six
   * `unavailable` artifacts. MEASURED on the operator's machine: git registered
   * ZERO of the 20 live pointers' worktrees — a worktree removed at Finalize
   * leaves its directory behind — so the rule fired on the ORDINARY end state of
   * every run and erased artifacts that were sitting in the main root all along.
   *
   * What the original review actually asked for is preserved and pinned below:
   * nothing may be READ from a root git does not vouch for. That is
   * `chooseRoot`'s job and it is unchanged — the resolver now falls back to the
   * project root instead of erasing the rail.
   */
  it("an UNREGISTERED worktree_path falls back to the MAIN root (not an erased rail)", async () => {
    const root = makeProject();
    try {
      // A directory that exists but is not a git worktree — exactly the shape a
      // `git worktree remove` leaves behind.
      mkdirSync(join(root, "not-a-worktree"), { recursive: true });
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
      // A spec that ONLY exists in the unregistered directory would be a read
      // below a root git does not vouch for — it must never be served.
      mkdirSync(join(root, "not-a-worktree", ".shipwright", "planning", "iterate", RUN_ID), {
        recursive: true,
      });
      writeFileSync(
        join(root, "not-a-worktree", ".shipwright", "planning", "iterate", RUN_ID, "adr.md"),
        "# MUST NOT BE READ\n",
      );

      const { app } = harness(root, makeTask());
      const ctx = await getContext(app);
      expect(ctx.scenario).toBe("iterate");
      expect(ctx.runId).toBe(RUN_ID);
      // The main root's own spec resolves — the rail is REAL, not erased.
      const spec = ctx.artifacts.find((a) => a.kind === "spec");
      expect(spec?.state).toBe("available");
      expect(spec?.state).not.toBe("unavailable");
      expect(spec && "detail" in spec ? spec.detail?.title : null).toBe("mini-plan.md");
      // Not live: the pointer names no registered worktree, so the run is not in
      // flight and hide-empty keeps its meaning.
      expect(ctx.runLive).toBe(false);
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
