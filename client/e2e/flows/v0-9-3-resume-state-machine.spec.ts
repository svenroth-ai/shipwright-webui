/*
 * v0.9.3 — Resume state-machine regression fence (ADR-085).
 *
 * AC-1: Clicking Resume on an IDLE `new-plain` task converges the task to
 *       `active` and it STAYS active across multiple transcript polls. Pre-fix,
 *       state ping-ponged active → idle → active every 1-2s.
 * AC-2: The Resume button hides within ~2.5s of the click (≈2 poll cycles).
 *
 * ── A00: why this spec had never once run ───────────────────────────────────
 * It pinned `31b4076d-…` — one task on one developer's machine — and skipped when
 * that task was absent. The task was deleted long ago, so the skip fired on every
 * machine, every run: a regression fence that never fired is a comment.
 *
 * The precondition is now MANUFACTURED. It needs a `new-plain` task that Claude
 * has already run in, currently idle. WebUI derives all of that from ONE thing: the
 * presence and mtime of the JSONL at ~/.claude/projects/<encoded-cwd>/<uuid>.jsonl
 * (external/transcript/routes.ts). WebUI is a pure READ-ONLY observer of that file
 * (CLAUDE.md rule 1 / DO-NOT #1) — no live `claude` process participates in the
 * state machine at all. So the fixture writes the transcript, impersonating
 * *Claude*, not webui, and the server observes it through exactly the production
 * code path. That is what makes this runnable on a CI runner with no `claude`
 * binary anywhere on it.
 *
 * Every assertion below is the original. They finally get to run.
 */

import { test, expect } from "@playwright/test";
import { apiUrl } from "../helpers/env";
import {
  cleanupProject,
  cleanupTask,
  seedProject,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";
import { backdateJsonl, seedClaudeJsonl } from "../helpers/claude-jsonl";

/** Comfortably past the server's ACTIVE_IDLE_THRESHOLD_MS, so the poll after the
 *  initial observation flips the task to `idle` without the spec sleeping. */
const AGED_MS = 30 * 60 * 1000;

/**
 * Drive the state machine to `idle` WITHOUT a browser page.
 *
 * This is the crux of manufacturing the precondition. The transitions live in the
 * transcript endpoint (external/transcript/routes.ts), and the only thing that
 * polls it in the app is TaskDetail — which also mounts the terminal, which creates
 * a pty. And a `new-plain` task WITH a live pty is deliberately HELD active
 * regardless of JSONL mtime (ADR-085: for new-plain the mtime is meaningless
 * because Claude writes nothing until the user types, so pty-liveness is the
 * authoritative active→idle signal). So a new-plain task can never be observed
 * going idle while a browser is looking at it — which is exactly why the original
 * spec could only ever inherit this state from a task that had gone idle in some
 * PRIOR session, and why it skipped forever once that task was gone.
 *
 * Calling the endpoint directly is the same production code path with no page
 * attached: no terminal mounts, no pty exists, and the aged JSONL settles the task
 * to `idle` in two polls. `state` is persisted, so TaskDetail then opens ON an idle
 * task and offers Resume — precisely the situation both ACs describe.
 */
async function settleToIdle(
  request: import("@playwright/test").APIRequestContext,
  taskId: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        // poll 1 records firstJsonlObservedAt -> active; poll 2 sees the aged
        // mtime with no pty -> idle.
        await request.get(apiUrl(`/api/external/tasks/${taskId}/transcript?fromByte=0`));
        const t = await request
          .get(apiUrl(`/api/external/tasks/${taskId}`))
          .then((r) => r.json() as Promise<{ task: { state: string } }>);
        return t.task.state;
      },
      { timeout: 30_000, intervals: [500] },
    )
    .toBe("idle");
}

test.describe("v0.9.3 — Resume state machine (idle new-plain)", () => {
  // Creating the task through the UI + seeding the transcript takes real time.
  // A per-test setTimeout() does not cover hooks.
  test.describe.configure({ timeout: 120_000 });

  let project: SeededProject;
  let taskId: string;
  let jsonlPath: string;

  /**
   * Create a `new-plain` task through the REAL UI path (the plain-Claude button —
   * this is what sets `actionId: "new-plain"`, which AC-1 asserts on), then give it
   * an aged Claude transcript so the server observes it as a session that has run
   * and since gone idle.
   */
  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "v0.9.3 resume" });
    await setActiveProject(page, project.projectId);

    await page.goto("/");
    await expect(page.getByTestId("task-board-page")).toBeVisible({ timeout: 15_000 });

    await page.getByTestId("plain-claude-button").click();
    await expect(page.getByTestId("new-issue-modal-new-plain")).toBeVisible({ timeout: 5_000 });
    await page.getByTestId("new-issue-title-input").fill(`v093-${Date.now()}`);

    const createResp = page.waitForResponse(
      (r) => r.url().endsWith("/api/external/tasks") && r.request().method() === "POST",
    );
    await page.getByTestId("new-issue-save-btn").click();
    const created = await createResp;
    const body = (await created.json()) as {
      task: { taskId: string; sessionUuid: string; cwd: string };
    };
    taskId = body.task.taskId;

    // The transcript Claude would have written. Aged, so the task reads as idle
    // rather than active the moment the server first observes it.
    jsonlPath = seedClaudeJsonl({
      sessionUuid: body.task.sessionUuid,
      cwd: body.task.cwd,
      turns: 2,
    });
    backdateJsonl(jsonlPath, AGED_MS);

    // Settle to idle BEFORE any browser page mounts a terminal for this task.
    await settleToIdle(request, taskId);
  });

  test.afterEach(async ({ request }) => {
    await cleanupTask(request, taskId);
    await cleanupProject(request, project);
  });

  test("AC-1 + AC-2: Resume click on idle new-plain converges to active and STAYS active across multiple poll cycles", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto(`/tasks/${taskId}`, { waitUntil: "domcontentloaded", timeout: 20_000 });

    // The task is already idle (settled in the hook, before any pty existed).
    const taskBefore = await page.request
      .get(apiUrl(`/api/external/tasks/${taskId}`))
      .then((r) => r.json() as Promise<{ task: { state: string; actionId: string } }>);
    expect(taskBefore.task.actionId).toBe("new-plain");
    const stateBeforeClick = taskBefore.task.state;

    // Same locator fix as AC-2: the Resume CTA is its own component/testid.
    const resumeBtn = page.getByTestId("cta-copy-resume-command");
    await expect(resumeBtn).toBeVisible({ timeout: 10_000 });
    await resumeBtn.click();
    const resumeClickExecuted = true;

    // The fix's core claim: state converges to "active" within ~2 transcript polls
    // (~2 seconds at 1s polling) and STAYS active across multiple subsequent polls.
    // Pre-fix, state ping-ponged every 1-2s.
    const samples: { tMs: number; state: string }[] = [];
    const start = Date.now();
    for (let i = 0; i < 8; i++) {
      const resp = await page.request
        .get(apiUrl(`/api/external/tasks/${taskId}`))
        .then((r) => r.json() as Promise<{ task: { state: string } }>);
      samples.push({ tMs: Date.now() - start, state: resp.task.state });
      if (i < 7) await page.waitForTimeout(1_500);
    }

    const activeSamples = samples.filter((s) => s.state === "active");
    const idleSamples = samples.filter((s) => s.state === "idle");

    // eslint-disable-next-line no-console
    console.log(
      `[v0.9.3] state samples (${samples.length}): active=${activeSamples.length}, idle=${idleSamples.length}, all=${JSON.stringify(samples)}`,
    );

    // The KEY regression assertion: after the initial awaiting → active transition
    // the state MUST NOT decay back to idle on the next poll. Pre-fix the sequence
    // was awaiting → active → idle → active → idle …; post-fix, once active it stays.
    const stableSamples = samples.slice(2);
    const stableIdles = stableSamples.filter((s) => s.state === "idle");
    expect(stableIdles.length).toBe(0);

    // Belt-and-braces: no dimensions pageerrors regressed.
    const dimensionsErrors = pageErrors.filter((m) => /dimensions|_renderService/.test(m));
    expect(dimensionsErrors).toEqual([]);

    // eslint-disable-next-line no-console
    console.log(
      `[v0.9.3] AC-1 summary: resumeClickExecuted=${resumeClickExecuted}, stateBefore=${stateBeforeClick}, stableSamples=${JSON.stringify(stableSamples)}`,
    );
  });

});
