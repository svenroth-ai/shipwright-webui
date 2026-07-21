/*
 * resolver.live-run.test.ts — `runLive` and the main-root fallback
 * (iterate-2026-07-21-mission-run-identity-recovery).
 *
 * Two behaviours that used to be one wrong answer:
 *
 *   - A pointer whose worktree git STILL registers is a run IN FLIGHT →
 *     `runLive: true`, and the client shows its not-yet-written artifacts as
 *     pending instead of hiding the entire rail.
 *   - A pointer whose worktree git does NOT register is the ordinary
 *     post-Finalize state (MEASURED: 20 of 20 real pointers) → read the MAIN
 *     root and render the real artifacts, `runLive: false`. It is emphatically
 *     NOT a licence to read the unregistered directory — that is asserted here
 *     with a decoy document.
 *
 * git is INJECTED, so the worktree registration is exercised without needing a
 * real second checkout.
 *
 * @covers FR-01.66
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { _clearEventIndexCache } from "./iterate-record.js";
import { _clearRecoveryMemo } from "./run-id-recovery.js";
import { _clearResolverCache, resolveMissionContext } from "./resolver.js";
import { _clearRootsCache } from "./worktree-roots.js";
import type { GitRunner } from "./worktree-roots.js";

const UUID = "3c9e3e11-4b53-424e-8062-f9f5a24f6b68";
const RUN_ID = "iterate-2026-07-21-live-demo";

let roots: string[] = [];

function project(opts: { worktreePath: string | null; mainSpec: boolean }): string {
  const root = mkdtempSync(join(tmpdir(), "mc-live-"));
  roots.push(root);
  mkdirSync(join(root, ".shipwright", "iterate_active"), { recursive: true });
  if (opts.mainSpec) {
    mkdirSync(join(root, ".shipwright", "planning", "iterate", RUN_ID), { recursive: true });
    writeFileSync(
      join(root, ".shipwright", "planning", "iterate", RUN_ID, "mini-plan.md"),
      "# The plan\n\n## Affected Boundaries\n\nThe rail (FR-01.66).\n",
    );
  }
  writeFileSync(
    join(root, ".shipwright", "iterate_active", `${UUID}.json`),
    JSON.stringify({
      run_id: RUN_ID,
      slug: "live-demo",
      worktree_path: opts.worktreePath,
      main_root: root,
      session_id: UUID,
      created_at: "2026-07-21T10:00:00Z",
    }),
  );
  return root;
}

/** `git worktree list --porcelain` reporting exactly `registered`. */
function gitWith(registered: string[]): GitRunner {
  return (args) => {
    if (args[0] === "worktree") return registered.map((p) => `worktree ${p}\n`).join("\n");
    return "";
  };
}

function resolve(projectRoot: string, git: GitRunner) {
  return resolveMissionContext(
    {
      taskId: "task-1",
      sessionUuid: UUID,
      projectId: "proj-1",
      projectRoot,
      transcript: "",
      phaseTaskId: null,
      taskRunId: null,
      campaignSlug: null,
      hasCampaignRecord: false,
      actions: null,
      runConfigStatus: "ok",
    },
    { git },
  );
}

describe("runLive + the unregistered-worktree fallback", () => {
  beforeEach(() => {
    _clearResolverCache();
    _clearEventIndexCache();
    _clearRootsCache();
    _clearRecoveryMemo();
  });
  afterEach(() => {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
    roots = [];
  });

  it("a REGISTERED worktree means the run is IN FLIGHT (runLive)", async () => {
    const root = project({ worktreePath: null, mainSpec: false });
    const wt = mkdtempSync(join(tmpdir(), "mc-wt-"));
    roots.push(wt);
    mkdirSync(join(wt, ".shipwright", "planning", "iterate", RUN_ID), { recursive: true });
    writeFileSync(
      join(wt, ".shipwright", "planning", "iterate", RUN_ID, "mini-plan.md"),
      "# In-flight plan\n",
    );
    writeFileSync(
      join(root, ".shipwright", "iterate_active", `${UUID}.json`),
      JSON.stringify({
        run_id: RUN_ID,
        slug: "live-demo",
        worktree_path: wt,
        main_root: root,
        session_id: UUID,
      }),
    );

    const { context } = await resolve(root, gitWith([root, wt]));
    expect(context.scenario).toBe("iterate");
    expect(context.runLive).toBe(true);
    // Read from the worktree, which is where a run in flight writes.
    expect(context.artifacts.find((a) => a.kind === "spec")?.state).toBe("available");
  });

  it("an UNREGISTERED worktree falls back to the main root and is NOT live", async () => {
    const root = project({ worktreePath: null, mainSpec: true });
    const stale = join(root, ".worktrees", "live-demo");
    // The directory LINGERS after `git worktree remove` — the measured shape.
    mkdirSync(join(stale, ".shipwright", "planning", "iterate", RUN_ID), { recursive: true });
    writeFileSync(
      join(stale, ".shipwright", "planning", "iterate", RUN_ID, "adr.md"),
      "# DECOY — must never be read\n",
    );
    writeFileSync(
      join(root, ".shipwright", "iterate_active", `${UUID}.json`),
      JSON.stringify({
        run_id: RUN_ID,
        slug: "live-demo",
        worktree_path: stale,
        main_root: root,
        session_id: UUID,
      }),
    );

    const { context } = await resolve(root, gitWith([root]));
    expect(context.scenario).toBe("iterate");
    expect(context.runLive).toBe(false);
    const spec = context.artifacts.find((a) => a.kind === "spec");
    // The rail is REAL (this is the regression: it used to be six `unavailable`).
    expect(spec?.state).toBe("available");
    expect(spec?.kind === "spec" ? spec.detail?.title : null).toBe("mini-plan.md");
  });

  /*
   * External plan review (openai MEDIUM): a registered worktree is a filesystem
   * PROXY for "in flight". An abandoned or already-finished run leaves one
   * behind, and calling that live would show "not written yet" for a run that is
   * over — the same lie, mirrored. A `work_completed` record is terminal.
   */
  it("is NOT live once the run recorded completion, worktree or not", async () => {
    const root = project({ worktreePath: null, mainSpec: true });
    const wt = mkdtempSync(join(tmpdir(), "mc-wt3-"));
    roots.push(wt);
    writeFileSync(
      join(root, "shipwright_events.jsonl"),
      `${JSON.stringify({
        v: 1,
        type: "work_completed",
        id: RUN_ID,
        adr_id: RUN_ID,
        ts: "2026-07-21T12:00:00Z",
        summary: "Finished",
      })}\n`,
      "utf-8",
    );
    writeFileSync(
      join(root, ".shipwright", "iterate_active", `${UUID}.json`),
      JSON.stringify({
        run_id: RUN_ID,
        slug: "live-demo",
        worktree_path: wt,
        main_root: root,
        session_id: UUID,
      }),
    );

    const { context } = await resolve(root, gitWith([root, wt]));
    expect(context.runLive).toBe(false);
  });

  it("a pointer with NO worktree at all is not live either", async () => {
    const root = project({ worktreePath: null, mainSpec: true });
    const { context } = await resolve(root, gitWith([root]));
    expect(context.runLive).toBe(false);
  });

  it("`runLive` is re-derived when the worktree goes away (not frozen by the cache)", async () => {
    const root = project({ worktreePath: null, mainSpec: true });
    const wt = mkdtempSync(join(tmpdir(), "mc-wt2-"));
    roots.push(wt);
    writeFileSync(
      join(root, ".shipwright", "iterate_active", `${UUID}.json`),
      JSON.stringify({
        run_id: RUN_ID,
        slug: "live-demo",
        worktree_path: wt,
        main_root: root,
        session_id: UUID,
      }),
    );

    const live = await resolve(root, gitWith([root, wt]));
    expect(live.context.runLive).toBe(true);

    // Finalize: git stops reporting it. The response cache must not keep saying
    // "live" — `chosen.root` participates in the rev, so the entry is a miss.
    _clearRootsCache();
    const after = await resolve(root, gitWith([root]));
    expect(after.context.runLive).toBe(false);
    expect(after.context.sourceRev).not.toBe(live.context.sourceRev);
  });
});
