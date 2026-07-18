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
